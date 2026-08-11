# Job Board Quality Hybrid Design

**Date:** 2026-08-06  
**Status:** Approved; implementation landed 2026-08-06  
**Product:** Scout-X / FirstStep job board (`maxun_job_board`)

## Problem

Google Careers cards look good because of a dedicated ATS adapter and URL/title logic. Ford, Carrier, Toyota (and similar Phenom-style sites) fall through to generic `scrape.do` HTML parsing. That captures SPA shell chrome instead of real job content, marks rows `ready` too eagerly, and paints bad badges (e.g. Remote). Carrier also enqueues non-job hub/landing/legal pages. Company facets are fragmented (Carrier*, Meta/Metacareers, Sia-partners).

## Goals

1. No junk / non-job cards on the board.
2. No marketing-shell titles or search-form descriptions as “ready” jobs.
3. Ford cards show real titles (at least from URL slug) and correct location/remote; descriptions improve via re-enrichment.
4. Carrier facet is a single **Carrier**; only `/job/...` postings remain.
5. Toyota stops showing identical Overview boilerplate as a full JD when that is all we have.
6. Quality rules are host-agnostic where possible so Sia Partners and future companies benefit.

## Non-goals (this pass)

- Paid Phenom developer API keys.
- Rewriting browser-extension list extractors.
- Perfect parity with Google for every employer on day one.
- Changing job-seeker UI layout (HiringCafe card/modal stays).

## Current pipeline (context)

```
list scrape → shouldKeepExtractedJobRow → maxun_extracteddata
  → enqueueJobBoardEnrichments (jobUrlKey dedupe)
  → enrichment worker: ATS (Tier 0) else scrape.do + parseJobPageHtml
  → maxun_job_board status ready|partial|failed|expired
  → GET /api/jobs
```

Google uses `detectAts` → `googlecareers`. Ford/Carrier/Toyota have no adapters today.

## Design

### Pillar A — Quality gates (all companies)

**Extract / enqueue**

- Extend `shouldKeepExtractedJobRow` (`automation.ts`):
  - Drop Phenom non-job paths: `saved-jobs`, `candidate-hub`, `inclusion`, `events`, privacy notices, bare careers roots, category landing pages without `/job/{…}/{id}` shape.
  - Drop obvious non-job titles (Saved Jobs, Candidate Hub, Inclusion, privacy notice, “Search our Job Opportunities…”, “Working at …”).
- Optionally refuse enqueue (or mark failed immediately) when URL is not a job detail URL for known Phenom hosts (`careers.ford.com`, `jobs.carrier.com`, `careers.toyota.com`).

**Parse / score**

- Expand `isGenericTitle` / marketing-title helpers (`jobPageParser.ts` + worker duplicate):
  - `Working at…`, `Careers at…`, `Search our Job Opportunities…`, bare `Careers`, hub names.
- Expand `isJunkDescription` / `NAV_CHROME_RE`:
  - `Keyword(s)`, `Radius`, `Search … Jobs`, radius unit chrome, repeated search-widget text.
- Treat Toyota-style shared Overview-only bodies (“Who we are / Collaborative. Respectful…”) as thin/junk for readiness when they lack role-specific job signals beyond company marketing.

**Enrichment ready rules**

- Align `scrape.do` success with ATS: `ready` only if title + description and `descriptionQualityScore(desc) > 0`.
- Call `deriveFieldsFromDescription` only when quality score &gt; 0 (prevents false Remote from chrome containing “Remote” as a filter option).
- Prefer non-empty list snapshot title over generic scraped title; prefer slug-derived title over marketing title when applicable.

**Company canonicalization**

- Extend `canonicalizeCompanyName`:
  - Carrier / Carrierjobs / Carrier (Home) / Carrier Corporate / C01 Carrier Corporation → `Carrier`
  - Metacareers / Meta Careers / Facebook (careers context) → `Meta`
  - Sia-partners / SiaPartners → `Sia Partners` (already partially present)
  - Ford Motor / Ford Motor Company → `Ford`
  - Toyota Motor / Toyota Motor North America → `Toyota`

**API safety net**

- In `mapListingToJob` / list filter (`jobs.ts`): exclude rows that fail the same junk/generic checks so stale DB rows do not paint bad cards while cleanup runs.

### Pillar B — Ford

- **Title from URL:** Pattern  
  `careers.ford.com/job/{locationSlug}/{titleSlug}/{orgId}/{jobSeqNo}`  
  → humanize `titleSlug` when list/scraped title is missing or generic (same idea as Google numeric-id slug fallback).
- Keep unique real `applyUrl`/`jobUrl` (already correct); do not invent URLs.
- Clear false `remoteType` when derived from junk; keep list `location` when present.
- After gates land: requeue all Ford board rows for enrichment; prefer higher scrape render tier when parse is thin/marketing shell (extend `isThinParse` / escalate logic in `scrapeDoClient` / parser).
- Optional later: dedicated `ford` / shared `phenom` mapper mirroring `mapGoogleCareersHtml` if render still fails.

### Pillar C — Carrier junk purge

- URL allowlist for board visibility: must match job detail pattern  
  `/job/{location}/{slug}/{orgId}/{jobSeqNo}` (with optional `/en` prefix).
- Delete or mark `expired`/`failed` existing non-job Carrier rows (hubs, events, privacy, category landings).
- Rewrite fragmented `companyName` → `Carrier` on remaining rows.
- Real Carrier job rows that already have decent titles may keep descriptions that start with “About Carrier…” if they also contain role-specific body after the boilerplate; prefer stripping leading company About block only when the remainder has job signals (nice-to-have, not blocking).

### Pillar D — Toyota descriptions

- Detect Overview marketing block as insufficient for `ready`.
- Requeue Toyota rows; escalate scrape tier when description hashes/matches known boilerplate prefix.
- If still only marketing after max attempts → leave `partial` and hide from default board list (API gate) rather than showing identical Overview cards.

### Pillar E — Cleanup script

One-shot script (pattern: `dedupeJobBoardByUrlKey.ts`):

1. Re-canonicalize company names.
2. Soft-delete / expire / remove non-job URL rows (Carrier hubs, etc.).
3. Clear junk titles/descriptions to empty + set `partial` or requeue.
4. Requeue Ford + Toyota + remaining Carrier jobs with `status: queued`, reset nextAttemptAt.
5. Print counts: deleted, requeued, remaining by company.

Operator runs enrichment worker afterward.

## Testing

- Unit tests for:
  - Generic title / junk description patterns (Ford shell, Carrier search chrome, Toyota Overview).
  - Phenom job URL vs non-job URL helpers.
  - Company canonicalization aliases.
  - `deriveFieldsFromDescription` not applied path (worker or helper): Remote not set from junk text containing “Remote”.
  - Ford/Carrier slug → title humanization.
- Existing `jobPageParser.test.ts` / `jobUrlNormalize.test.ts` extended; add focused cases rather than huge fixtures.

## Rollout order

1. Quality gates + canonicalize + API hide (stops bleeding).
2. Ford slug titles + requeue.
3. Carrier URL gate + purge + rename.
4. Toyota boilerplate detection + requeue.
5. Cleanup script + verify board counts/cards.

## Success criteria

- Ford: distinct titles per card; not all Remote; Apply URLs still unique real job links.
- Carrier: single company facet; no privacy/hub/events cards; job cards only.
- Toyota: no grid of identical Overview snippets as ready jobs.
- Google / JPMorgan: unchanged or improved (no regression).
- Facet list: no Carrierjobs / Metacareers / Sia-partners aliases.

## Risks

- Stricter gates may temporarily shrink board counts until re-enrichment fills JDs.
- Higher scrape.do tiers cost credits; respect daily budget; requeue with backoff.
- List scrapers may still emit non-jobs; server gates must remain the source of truth.
