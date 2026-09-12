# Frozen locations (US states for clusters)

Shared US geography tags on job board listings so career scrapers and aggregators write the same fields (`frozenStates`, `frozenCities`, …). Later, ScoutText clusters filter `frozenStates` only — no second location system and no free-text guessing at query time.

## Fields

| Field | Meaning |
| --- | --- |
| `frozenStates: string[]` | USPS codes (`CA`, `DC`, `PR`, …). Empty when remote-only, non-US, or unresolved |
| `frozenCities: { name, state }[]` | Canonical city + state when known |
| `locationIsRemote` | Remote / WFH with no fixed US site |
| `locationIsUs` | `false` for clear non-US jobs (job stays on the board) |
| `locationClassification` | `{ method, confidence, rulesVersion, classifiedAt, contentHash, candidates? }` |

Free-text `location` remains the display chip. Cluster membership must use **`frozenStates`** (and remote / `locationIsUs` flags), never substring match on `location`.

## Geography

50 states + `DC` + territories: `PR`, `GU`, `VI`, `AS`, `MP`.

- **DB / API:** always USPS codes
- **UI:** `stateCodeToLabel()` — full name, or shortened English for long names (`Mass.`, `N. Carolina`, `W. Virginia`, `D.C.`, …)

## Resolution precedence

`resolveFrozenLocation()` / `classifyJobLocation()` walks each site in a multi-site string (`·` / `|` / `/`) and unions states.

| # | Signal | Method |
| - | ------ | ------ |
| 1 | Explicit `City, ST` / full state name | `explicit_state` |
| 2 | ZIP5 / ZIP3 map | `zip` |
| 3 | Unique city in offline gazetteer | `unique_city` |
| 4 | Ambiguous city, population ≥ 10× next | `population` |
| 5 | Ambiguous city, company HQ map | `company_hq` |
| 6 | Ambiguous city, modal prior `frozenStates` for company | `company_history` |
| 7 | Still ambiguous | `ambiguous` — **do not guess**; leave `frozenStates: []` |
| — | Remote-only (`Remote`, `Remote - USA`, …) | `remote` — `locationIsRemote: true`, empty states |
| — | Clear non-US (`London, UK`, …) | `non_us` — `locationIsUs: false`, empty states |
| — | Empty / unparseable | `none` |

Rules version: `LOCATION_RULES_VERSION = 'location-2026-09-1'` (bump to re-tag).

## Shared modules

| File | Role |
| --- | --- |
| `src/shared/frozenLocations.ts` | Taxonomy, resolver, display helpers, filter normalize |
| `src/shared/usCityGazetteer.ts` | Offline city → states + ZIP maps |
| `src/shared/companyLocation.ts` | Curated company → HQ state |
| `server/src/services/companyHistoricalStates.ts` | Recent jobs’ modal states for a company |
| `server/src/scripts/backfillFrozenLocations.ts` | Backfill / re-tag |

## Wiring

- Enrichment enqueue: `jobBoardEnrichment.ts`
- Worker: `jobEnrichmentWorker.ts`
- Board API: `GET /api/jobs` supports `frozenState` (`$in`) + facet `filters.frozenStates`
- Ops UI: State multi-select shows short English labels; query sends codes

## Backfill

```bash
npx ts-node --project server/tsconfig.json \
  server/src/scripts/backfillFrozenLocations.ts --limit 500 --only-untagged
```

Options: `--batch N`, `--dry-run`, `--only-untagged` (also re-runs when `rulesVersion` differs).

## Edge cases

| Input | Expected |
| --- | --- |
| `San Francisco, CA` | `['CA']` |
| `Boston, Massachusetts` | `['MA']` |
| `Springfield` | ambiguous (empty) unless company context |
| `Portland` + Nike | `['OR']` via `company_hq` |
| `Remote` / `Remote - USA` | remote, empty states, `locationIsUs: true` |
| `NYC · Austin, TX` | `['NY','TX']` |
| `London, UK` | non-US, empty states |
| `94105` | `['CA']` |
| Empty | `none`, empty states |
| `Guam` / `San Juan, PR` | `['GU']` / `['PR']` |

## Out of scope

Cluster membership engine, live geocoding APIs, non-US structured geo.
