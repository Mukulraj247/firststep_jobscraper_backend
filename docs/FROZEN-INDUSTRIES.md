# Frozen industries (career + aggregator)

Shared industry categories for job board listings so career robots and aggregators write the same field (`frozenIndustries`). Later, ScoutText clusters filter this field only — no second industry system.

## Resolution precedence

`resolveFrozenIndustries()` walks these tiers in order and returns on the first hit.

| # | Tier | Method | Applies to |
| - | ---- | ------ | ---------- |
| 1 | `sectorIndustry` selector — Job Metadata `saasConfig.rowContext.sectorIndustry` for career, scraped field for aggregators | `row_context` / `scrape_alias` | All sources |
| 2 | Role / job title — high-precision function hints, merged with company when compatible | `role_title` | All sources |
| 3 | Company name → curated map (~330 companies) | `company_exact` | All sources |
| 4 | Company name → regex patterns (hospitals, banks, universities, gov bodies, contractors) | `company_pattern` | All sources |
| 5 | Keyword hints over company + title | `aggregator_hint` | Aggregators only |
| 6 | Nothing matched | `none` | — |

**The selector always wins.** When automation starts populating `sectorIndustry`, it
overrides everything inferred below it — no migration needed, just re-run the backfill.

**Why role title exists:** the company map alone tagged every McKesson opening as
Healthcare (McKesson is a healthcare distributor). That correctly kept
"Ambulatory Surgery Center Sales" in Healthcare, but also put Salesforce architects,
data engineers, and CVS truck drivers in the same filter. Role patterns now fire for
clear function titles:

- Salesforce / software / platform / enterprise architect → `Software / SaaS`
  (drops conflicting employer Healthcare / Retail / Insurance)
- Pharmacy tech / ambulatory / clinical → `Healthcare` (keeps employer Healthcare)
- CDL / truck driver / warehouse → `Logistics / Supply Chain`

Compatible employer tags are kept (Google SWE → Software / SaaS + Big Tech).
Ambiguous titles ("Analyst", "HR Business Partner") still use the company map only.

Persisted on the job as:

- `frozenIndustries: string[]` — controlled taxonomy (max 2 per job)
- `industryClassification` — `{ method, rulesVersion, classifiedAt, contentHash }`

An unresolved job is written as `frozenIndustries: []` with method `none` and a current
`rulesVersion`, so "classified, found nothing" is distinguishable from "never classified".



## What was added



### Shared taxonomy


| File                                  | Role                                                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/frozenIndustries.ts`      | Canonical list (`FROZEN_INDUSTRIES`), aliases, `resolveFrozenIndustries()`, `normalizeFrozenIndustryFilter()`, `INDUSTRY_RULES_VERSION` |
| `src/shared/companyIndustry.ts`       | `normalizeCompanyName()`, curated company map, regex patterns, `resolveIndustryFromCompany()`                                           |
| `src/shared/roleIndustry.ts`          | Title → industry hints (`resolveIndustryFromTitle`) for function overrides                                                              |
| `src/shared/frozenIndustries.test.ts` | Precedence and sector-parsing tests                                                                                                     |
| `src/shared/companyIndustry.test.ts`  | Company normalization, exact/pattern tiers, refusal-to-guess tests                                                                      |
| `src/shared/roleIndustry.test.ts`     | Salesforce@McKesson, ambulatory sales, truck driver, pharmacy tech                                                                      |


Export `FROZEN_INDUSTRIES` for future cluster definitions / browse pills. The API facets
and the job board filter both derive their option list from it, so appending a label is
enough to surface it end to end.

### Taxonomy versions

`industry-v3` adds role-title overrides so employer industry does not swamp the filter
when the job function is clearly tech or logistics.

`industry-v2` appended ten labels to close gaps found when auditing real listings —
Hiring Cafe sector strings that could not canonicalize, and high-volume companies with no
sensible home:

`Construction & Engineering`, `Scientific Research`, `Cloud Infrastructure`,
`Marketing & Advertising`, `Legal`, `Staffing & Recruiting`, `Food & Beverage`,
`Mining & Metals`, `Security Services`, `Waste & Environmental`.

They are appended rather than inserted, so existing filter ordering is unchanged.

### Server wiring


| File                                             | Change                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------- |
| `server/src/models/JobBoardListing.ts`           | Schema fields + index on `frozenIndustries`                                       |
| `server/src/workers/jobEnrichmentWorker.ts`      | Resolve + persist on ready/partial; keep HC `sectorIndustry` on `ParsedJobFields` |
| `server/src/services/jobBoardEnrichment.ts`      | Same on list-complete path                                                        |
| `server/src/services/jobPageParser.ts`           | Optional `sectorIndustry` on `ParsedJobFields` / merge                            |
| `server/src/services/aggregatorIdentity.ts`      | `isAggregatorListingSource()`                                                     |
| `server/src/api/jobs.ts`                         | Filter `frozenIndustry`, facets, project field on list/detail                     |
| `server/src/scripts/backfillFrozenIndustries.ts` | Optional backfill for rows missing industries                                     |




### Ops UI + client API


| File                                        | Change                                             |
| ------------------------------------------- | -------------------------------------------------- |
| `src/api/jobs.ts`                           | `frozenIndustries` on job + filters; query param   |
| `src/components/jobs/JobBoardPage.tsx`      | Industry multi-select filter (mirrors Specialty)   |
| `src/features/jobs/jobBoardPageBehavior.ts` | `frozenIndustry` in filter controls / active state |

## Backfill

Preview the method distribution without writing anything:

```bash
npx ts-node --project server/tsconfig.json \
  server/src/scripts/backfillFrozenIndustries.ts --limit 999999 --batch 500 --dry-run
```

Apply it:

```bash
npx ts-node --project server/tsconfig.json \
  server/src/scripts/backfillFrozenIndustries.ts --limit 999999 --batch 500
```

Check coverage across all three frozen taxonomies:

```bash
npx ts-node --project server/tsconfig.json server/src/scripts/countFrozenTags.ts
```

Notes:

- The cursor walks by `_id` with `allowDiskUse(true)`. Sorting by `updatedAt` is unindexed
  and Atlas rejects the in-memory sort past ~32MB, which is well under the collection size.
- Re-run after bumping `INDUSTRY_RULES_VERSION`; the skip check compares the stored version,
  so unchanged rows still get re-stamped.
- Bump the `v:` counter in the `countKey` in `server/src/api/jobs.ts` when tag values change,
  otherwise cached counts and facets serve stale data.

