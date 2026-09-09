# Frozen experience (career + aggregator)

Two controlled experience tags on every job board listing so cluster filters can target seniority without inventing a second taxonomy.

## Fields

| Field | Meaning |
| --- | --- |
| `frozenExperienceLevels: string[]` | At most one career level |
| `frozenExperienceYears: string[]` | Zero or one year band (highest YOE) |
| `experienceClassification` | `{ method, rulesVersion, classifiedAt, contentHash, matchedSignals }` |

Numeric `jobExperience` continues to hold the max extracted year for existing UI copy.

## Taxonomies

**Levels** (`FROZEN_EXPERIENCE_LEVELS`):

- `Entry Level`
- `Mid-Senior Level`
- `Senior Level`
- `People Manager Level`
- `Leadership Level`

**Years** (`FROZEN_EXPERIENCE_YEARS`) — lower-inclusive, upper-exclusive:

`0-3` · `3-5` · `5-7` · `7-10` · `10-15` · `15+`

A single extracted number maps to one band. When the JD lists several YOE lines
(minimum 5y, infrastructure 3y, preferred 1y), **only the highest number** is
banded — secondary mentions must not produce a second chip. An explicit range
(`5-7 years`) maps to the single band that covers that range. **Never guess** a
band with no year evidence — empty is correct.

## Level model

Title family is evaluated first:

1. Exec tokens (`director`, `VP`, `chief`, `president`, `partner`, `head of`) → `Leadership Level`
2. Manager tokens (excluding IC compounds like `product manager`) → `People Manager Level`, demoted to `Mid-Senior Level` when max YOE ≤ 2
3. Otherwise IC ladder: title points + years points → Entry (0–3) / Mid-Senior (4–8) / Senior (9+)
4. Title-only (no YOE): junior → Entry; senior/lead/staff/architect → Mid-Senior; principal → Senior

## Signal precedence

1. `hc_structured` — Hiring Cafe `min_industry_and_role_yoe` / `max_industry_and_role_yoe`
2. `scrape_badge` — mapped `seniorityLevel` wins for **level**; bands still from year evidence
3. `rules` — title + description scoring
4. `title_only` — level without inventing years
5. `none`

## Shared module

| File | Role |
| --- | --- |
| `src/shared/frozenExperience.ts` | Taxonomies, extractor, `resolveFrozenExperience()` |
| `src/shared/frozenExperience.test.ts` | Transcript fixtures + edge cases |

Rules version: `EXPERIENCE_RULES_VERSION = 'exp-2026-09-6'` (bump to re-tag).

IC floor: untitled / non-junior roles with max YOE ≥ 4 are at least `Mid-Senior Level` (avoids 4–5y plain titles landing as Entry).

Intern titles (`intern` / `internship`): always `Entry Level` + `0-3`, and structured/extracted YOE is ignored (company-history and age lines must not become the years chip).

Junior / associate titles: Entry ceiling only when YOE ≤ 3 or missing. If the JD asks for 4+ years (`Junior ISSO, 5+ years`), level follows the YOE ladder (typically Mid-Senior) so Entry + 5-7 never co-exist.

Scrape badge: `Entry Level` / `Internship` badges are overridden when max YOE ≥ 4 and rules disagree — bad ATS badges must not create Entry + 5-7 chips.

Extractor rejects: `N years of age`, company-history spans (`for more than 25 years`, `spans nearly 40 years`), founded / years-ago phrasing. Numbers ≥ 15 only count when phrased as `years of experience`.

## Wiring

| Path | Behavior |
| --- | --- |
| Enrichment worker | Resolve next to industries; skip when hash + rulesVersion match |
| List-complete enqueue | Same resolve on snapshot fields |
| `deriveFieldsFromDescription` | Delegates years extraction to the shared module |
| Hiring Cafe normalize | Captures `max_industry_and_role_yoe` as `jobExperienceMax` / `_jobExperienceMax` |

## Scripts

```bash
# Review before writes
npx ts-node --project server/tsconfig.json \
  server/src/scripts/auditFrozenExperience.ts --limit 1000 --out tmp-exp-audit.csv

# Sample backfill
npx ts-node --project server/tsconfig.json \
  server/src/scripts/backfillFrozenExperience.ts --limit 100 --only-untagged
```

## Board API

Query params: `frozenExperienceLevel`, `frozenExperienceYear` (comma-separated). Facets return labels that currently have jobs, in taxonomy order.
