# SuccessFactors Board Adapter Design

**Date:** 2026-08-10  
**Status:** Approved  
**Product:** Scout-X scheduled URL collector (Engine 2 ATS-first board path)

## Problem

SAP SuccessFactors RMK career search URLs (e.g. EY
`careers.ey.com/search-3?...&startrow=500`) often ship mid-pagination offsets.
There is no public JSON board API like Greenhouse/Findly. Jobs are in
server-rendered HTML pages keyed by `startrow`. Chromium works but is slow and
flaky (cookie banners). Saving `startrow=500` yields only the last page (~8 of
~508) unless pagination is correct.

## Goals

1. ATS-first collection for **general** SuccessFactors RMK search boards without Chromium.
2. Fail closed to browser when HTML confirmation is weak (no false “success” on partial last-page scrapes).
3. Preserve URL facets (`optionsFacetsDD_*`, sort, `q`, locale).
4. Reset offset pagination correctly (`startrow`/`offset`/`from` → `0`) for ATS and browser paths.
5. Production guardrails: timeouts, page/job caps, inter-page delay, dedupe, run-log visibility.

## Non-goals

- Official SAP OData / authenticated APIs
- Cookie-consent UI automation (SSR HTML does not require it)
- Non-RMK boards (Yello, Workday, etc.)
- Per-job description fetch (existing enrichment)

## Architecture

```
robot start URL
  → detectAtsBoard (successfactors)
  → fetchAtsBoardJobs
       → normalize startrow=0 (keep facets)
       → GET page HTML
       → confirm ≥2 SF signals or return null
       → parse job links → paginate startrow += pageSize
       → AtsBoardJobRow[]
  → tryAtsBoardCollection / finalizeExtractedListRows (ats_board)
  → on null/empty → Chromium listExtractor (with offset→0 fix)
```

## Detection (URL)

Match when any of:

1. Host contains `successfactors.com` or `successfactors.eu`
2. Path matches `/search` or `/search-\d+` **and** query has `startrow` **or** any `optionsFacetsDD_*`

Do **not** treat bare `/job/.../\d+/` detail URLs as boards.

## HTML confirmation (≥2 signals required)

After first page fetch, require at least two of:

- Body mentions `successfactors` or `rmkcdn.successfactors`
- Results region (`#searchresults`, `#search-results`, table search results) present
- ≥1 anchor matching `/job/.../\d+/`
- `Page X of Y` or `Results … of N` text

Else return `null` (browser fallback).

## Pagination & parse

- Force `startrow=0`; keep facets/sort/`q`/`locale`
- `pageSize` = unique job ids on page 0 (fallback 25 if ≥1 job but size unclear)
- Prefer total pages from `Page X of Y` / results-of-N; else stop on 0 new ids
- **Honor robot/extension `listExtraction.pagination.maxPages` when > 0** (same cap as browser list extraction). Env `SF_BOARD_MAX_PAGES` remains a hard ceiling.
- Caps: 200 pages / 5000 jobs (env-overridable); 20s timeout; ~150–300ms delay; ~4MB body
- Dedupe by numeric job id
- Location: strip `+N more…`; use `normalizeLocation` when available
- Partial mid-run HTTP failure: keep rows if ≥1 full page already collected; else null

## Shared URL normalizer

`normalizeListStartUrl`: offset keys (`startrow`, `offset`, `from`) → `0`;
page keys (`pg`, `page`, `p`) → `startPage` (default 1).

## Observability

Run logs: provider detect, confirmation signals, startrow reset, pageSize, pages, rows, page errors.

## Tests

Detect / reject non-SF; confirm gate; fixture parse; pagination offsets; offset normalizer; location strip; mocked multi-page fetch.

## Rollout

Existing `preferAtsCollection` (default on). Browser remains fallback with fixed offsets.
