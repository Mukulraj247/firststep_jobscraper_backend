# Scout-X — Backend, Computation, Chromium, Models & Collection Guide

> **Audience:** Engineers who need to understand how Scout-X works end-to-end (backend-first).  
> **Date:** 2026-08-21  
> **Repo:** Maxun fork monorepo (`package.json` name still `maxun`; product name is **Scout-X**).  
> **Security:** This document lists env **names** only. Never paste `.env` secrets into shared chats.

This guide explains:

1. What Scout-X is (and is not)
2. Process topology (API, scheduler, scraper, enrichment, aggregators)
3. How scrapes are **computed** (scheduled → queued → executed → persisted)
4. Chromium: browser pool, slot lease, memory mode
5. Collection paths (ATS JSON vs browser list vs Hiring Cafe)
6. Data models and Mongo collections
7. Canonical job shape, job board, enrichment, tagging
8. Key APIs and where to read code next

---

## 0. One-sentence product definition

**Scout-X** is a job-ingestion and automation platform that:

1. Finds job listings from company career sites (and aggregators like Hiring Cafe),
2. Normalizes and stores them,
3. Enriches each posting with full details,
4. Shows them on the Scout-X / FirstStep **Job board**.

It is **not** a candidate–job matching ML recommender. “Computation” here means scrape scheduling, browser/ATS collection, URL dedupe heuristics, JD quality scoring, ops capacity metrics, and optional Gemini structuring of job text.

---

## 1. Names and identity

| Name | Meaning |
|------|---------|
| **Scout-X / ScoutX / scout-x** | Product and ops brand (UI, PM2, docs, hosting) |
| **Maxun** | Upstream open-source no-code scraper this fork is based on |
| **FirstStep / First Step** | Parent company product (auth, users, resume, etc.) — **separate system** |
| **ScoutId** | Human-facing automation ID on robots, format like `SX47KX19` (`recording_meta.scoutId`) |
| **Robot / Automation / Scraper** | Same entity in Mongo (`maxun_robots`) — a configured career-site or aggregator scrape |
| **Run** | One execution attempt of a robot |
| **Collection** | Act of gathering list rows (ATS API or Chromium list scrape) — **not** a separate product entity |
| **Canonical job** | Fixed field shape for extracted rows — **a TypeScript data shape**, not a Mongo collection |
| **Model (tag)** | Work model tag `model:Remote` / `Hybrid` / `On-site` — **not** an ML model |
| **Model (ML)** | Optional Google **Gemini** used only to structure JD text into sections |

**Relationship to FirstStep:** Keep systems separate. FirstStep should consume Scout-X via API if it needs job-board data.

---

## 2. Tech stack (backend-relevant)

| Layer | Technology |
|-------|------------|
| Language | TypeScript (Node) |
| API | Express 4, Socket.IO, express-session + MongoStore, JWT |
| DB | **MongoDB** via Mongoose (source of truth for robots, runs, jobs, Agenda, sessions) |
| Queue / schedule | **Agenda** on MongoDB (`agendaJobs` or `AGENDA_COLLECTION`) |
| Browser | Playwright Chromium (`playwright-extra` + stealth), optional Camoufox / remote browser service |
| Enrichment | ATS adapters, scrape.do (paid HTML), Cheerio/Turndown parse, optional Gemini |
| Process manager (prod) | PM2 via `ecosystem.config.cjs` |
| Tests | Vitest |

---

## 3. Monorepo map

```
maxun-develop/          (repo root)
├── src/                # React + Vite SPA (dashboard, job board, automations, runs)
├── server/             # Express API, workers, services, models
│   └── src/
│       ├── api/                # REST handlers
│       ├── models/             # Mongoose models
│       ├── services/           # Business logic
│       ├── workers/            # Scraper + enrichment + child scrape
│       ├── queue/              # Agenda helpers
│       ├── browser-management/ # Recording / remote browser controller
│       ├── server.ts           # API entry
│       ├── worker.ts           # Career scraper entry
│       ├── schedule-worker.ts  # Schedules only
│       ├── enrichmentWorker.ts # Job-board enrichment
│       └── aggregatorWorker.ts # Hiring Cafe / aggregators
├── maxun-core/         # Classic recorded-workflow interpreter
├── browser/            # Optional remote Playwright microservice
├── chrome-extension/   # Visual list picker → “Send to Scout-X”
├── docs/               # This guide + deployment / design specs
├── ecosystem.config.cjs
├── ENVEXAMPLE
└── package.json
```

---

## 4. Production process topology (PM2)

Designed for a **single DigitalOcean droplet** (~2 GB Basic) with **process isolation** so Chromium does not live in the API process.

| PM2 app | Entry script | Role | Chromium? |
|---------|--------------|------|-----------|
| `scout-x` | `server.ts` | HTTP API + Socket.IO only (`RUN_EMBEDDED_WORKERS=false`) | No |
| `scoutx-scheduler` | `schedule-worker.ts` | Agenda `schedule-triggers`, missed-schedule catch-up, ops digest | No |
| `scoutx-scraper` | `worker.ts` | Agenda `scraper-jobs` (career scrapes) | **Yes** |
| `scoutx-enrichment` | `enrichmentWorker.ts` | Detail enrichment via ATS / scrape.do / Gemini | Rare Playwright only (not career pool) |
| `scoutx-aggregators` | `aggregatorWorker.ts` | Agenda `aggregator-jobs` (Hiring Cafe) | **Yes** |

### Soft memory caps (`ecosystem.config.cjs`)

| Process | `max_memory_restart` (approx) |
|---------|-------------------------------|
| API | 400M |
| Scheduler | 200M |
| Enrichment | 300M |
| Scraper | 1200M (hosts up to 2 lean Chromiums) |
| Aggregators | 700M |

### Critical ops rules

- Do **not** set `RUN_EMBEDDED_WORKERS=true` on the API while scraper/aggregator PM2 apps run — that double-starts Chromium workers.
- If `scoutx-scraper` is not running → career runs stay **pending forever**.
- If `scoutx-aggregators` is not running → Hiring Cafe / aggregator runs stay pending.
- If `scoutx-scheduler` is not running (and scraper has `SCHEDULER_ENABLED=false`) → schedules never fire.
- Keep exactly **one** `scoutx-enrichment` instance (credit budget / rate limits are per-process).

### Concurrency knobs (current droplet defaults)

| Env | Typical value | Meaning |
|-----|---------------|---------|
| `SCRAPER_WORKER_CONCURRENCY` | `2` | Parallel career Agenda jobs in scraper process |
| `AGGREGATOR_WORKER_CONCURRENCY` | `1` | Parallel aggregator jobs |
| `CHROMIUM_MAX_SLOTS` | `2` | Max shared career Chromium slots (Mongo lease) |
| `CHROMIUM_SLOT_LEASE_ENABLED` | `true` | Cross-process Chromium mutex |
| `LOW_MEMORY_MODE` | `true` | Lean Chromium (block CSS, short pool life, etc.) |

---

## 5. Big-picture data flow

```
  Career site / Hiring Cafe
            │
            ▼
  ┌──────────────────────────┐
  │  SCHEDULE or MANUAL RUN  │  Robot → Run doc → Agenda job
  └────────────┬─────────────┘
               │
               ▼
  ┌──────────────────────────┐
  │  COLLECTION              │
  │  A) ATS board JSON       │  No Chromium (preferred when detected)
  │  B) Playwright list      │  Chromium + slot lease
  │  C) Hiring Cafe path     │  Exclusive Chromium + optional detail visits
  └────────────┬─────────────┘
               │
               ├──────────────────────────────┐
               ▼                              ▼
     maxun_extracteddata              maxun_job_board
     (per-run canonical rows)         (deduped board stubs)
               │                              │
               │                              ▼
               │                    ┌─────────────────────┐
               │                    │  ENRICHMENT WORKER  │
               │                    │  ATS → scrape.do    │
               │                    │  → optional Gemini  │
               │                    └──────────┬──────────┘
               │                               ▼
               │                      status: ready / partial / …
               ▼
         Dashboard runs / exports          Job board UI (GET /api/jobs)
```

**Mental model in one line:**  
API admits work → Agenda schedules it → scraper/aggregator collects lists (Chromium slot-leased or ATS JSON) → rows land in ExtractedData + JobBoard stubs → enrichment fills details without competing for career Chromium.

---

## 6. Scout “computation” — how a scrape actually runs

### 6.1 Trigger paths

1. **Manual:** UI or API `POST /api/automations/:id/run`
2. **Schedule:** `scoutx-scheduler` fires Agenda job `schedule-triggers` → admission → create run → enqueue
3. **Catch-up:** Missed schedules are swept by the scheduler catch-up loop
4. **API / SDK / extension:** Create or run robots via recording/SDK routes

Core create path: `createQueuedAutomationRun` in `server/src/services/automationRun.ts`.

- Creates a **Run** document (`pending` / `scheduled`)
- Enqueues either `scraper-jobs` or `aggregator-jobs` based on `isAggregatorRobot`

Scheduler: `server/src/services/automationScheduler.ts`  
Queue helpers: `server/src/queue/scraperQueue.ts`

### 6.2 Agenda job payload

Typical scraper job data:

```ts
{
  automationId,  // robot / recording meta id
  runId,
  userId,
  config,
  _attemptsMade?,
  _failedProxyServers?,
  // …
}
```

Job names:

| Job name | Consumer process |
|----------|------------------|
| `scraper-jobs` | `scoutx-scraper` |
| `aggregator-jobs` | `scoutx-aggregators` |
| `schedule-triggers` | `scoutx-scheduler` |
| recording / execute-run jobs | historical `pgboss-worker` path (Agenda-backed despite the name) |

### 6.3 Career scraper execution stack

```
Agenda picks scraper-jobs
  → processScraperJob (scraperWorker.ts)
  → [optional] scrapeJobSupervisor forks scrapeJobChild.ts
  → runScraperJobPayload
       ├─ tryAtsBoardCollection   (no browser if ATS board works)
       └─ processConfiguredListExtraction
            → acquirePooledPage (claim Chromium slot + Playwright page)
            → runListExtraction (selectors, scroll, pagination)
            → unblockers / captcha / popup handling as configured
            → evaluateRunDrift
            → finalizeExtractedListRows
                 → persistExtractedDataForRun
                 → enqueueJobBoardEnrichments
                 → webhooks / socket events
  → releasePooledPage (always in finally) → releaseChromiumSlot
```

Key files:

| File | Role |
|------|------|
| `server/src/workers/scraperWorker.ts` | Main career scrape logic (`runScraperJobPayload`, ATS + list paths) |
| `server/src/workers/scrapeJobSupervisor.ts` | Child-process hard cancel / timeout kill |
| `server/src/workers/scrapeJobChild.ts` | Child entry that calls `runScraperJobPayload` |
| `server/src/services/listExtractor.ts` | Paginated list scrape |
| `server/src/services/atsAdapters.ts` | Greenhouse / Lever / Ashby / Oracle CE / … |
| `server/src/services/runDrift.ts` | Zero-row / row-drop anomaly detection |
| `server/src/services/runLifecycle.ts` | Status machine, failure classification |
| `server/src/services/runAdmission.ts` | Per-account active-run slots / guards |

### 6.4 Child process isolation

- Toggle: `SCRAPE_JOB_CHILD_PROCESS` (default on for hard cancel).
- Parent can SIGKILL the child when `SCRAPER_JOB_TIMEOUT_MS` is exceeded.
- Aggregators typically run **in-process** (no child fork) with longer timeouts (`AGGREGATOR_JOB_TIMEOUT_MS`, default ~600s).

### 6.5 Run lifecycle statuses

| Phase | Statuses |
|-------|----------|
| Active | `pending`, `queued`, `scheduled`, `running`, `aborting` |
| Terminal success | `completed`, `success` |
| Terminal failure | `failed`, `dead` (attempts exhausted), `aborted` |

Heartbeats (`heartbeatAt`) support orphan recovery if a worker dies mid-run.

Run fields worth knowing:

- `rowsExtracted` — list rows found
- `jobsAddedToBoard` / `jobsBoardConsidered` / `jobsBoardDeduped` — board enqueue stats
- `anomaly` / `anomalyMeta` — drift taxonomy
- `scoutId` — copied from robot at create time
- `failureReason` / `failureReasonSource` — operator taxonomy (`suggested` | `confirmed` | `override`)

---

## 7. Collection paths (what “collection” means)

There is **no** separate Scout “Collection” product object. Collection = gathering job list rows into run output.

### Path A — ATS board collection (preferred when available)

- Function: `tryAtsBoardCollection` in `scraperWorker.ts`
- Uses `detectAtsBoard` / `fetchAtsBoardJobs` in `atsAdapters.ts`
- Talks to public/semi-public company board APIs (Greenhouse, Lever, Ashby, Oracle CE, etc.)
- **No Chromium** on the droplet for the list phase
- Controlled by robot config such as `preferAtsCollection` (Hiring Cafe usually prefers browser)

### Path B — Browser list collection (career scrapers)

- Extension or UI records CSS selectors / pagination into `recording_meta.saasConfig.listExtraction`
- Playwright opens the career search/results page
- `runListExtraction`:
  - Finds item containers
  - Scores hrefs (`jobHrefScore`) to prefer real detail URLs over `/jobs` indexes
  - Paginates: `next-button` | `infinite-scroll` | `page-number-loop`
  - Respects **Max pages** (default page limit if unset is typically 10 — raising it is how you get more jobs)
- May wait for Cloudflare / Amazon / Microsoft challenges (`unblocker.ts`)

### Path C — Aggregators (Hiring Cafe)

| Aspect | Career scrapers | Aggregators |
|--------|-----------------|-------------|
| Agenda job | `scraper-jobs` | `aggregator-jobs` |
| PM2 | `scoutx-scraper` | `scoutx-aggregators` |
| Chromium lease | Shared (up to N slots) | **Exclusive** (only when zero holders) |
| Identity | Company robots | `aggregatorProvider: hiring_cafe` (`aggregatorIdentity.ts`) |
| Post-list | Enqueue board → scrape.do enrichment | Same board (`source: hiring_cafe`); may also visit details **in Chromium** (`hiringCafeDetailScrape.ts`) to resolve employer apply URLs |
| Normalize | Canonical aliases | `hiringCafeNormalize.ts` maps `__NEXT_DATA__` JSON |

Detection: `isAggregatorRobot`, URL stamping via `applyAggregatorProviderFromUrl`.

### Chrome extension “Send to Scout-X”

1. User visually picks list/table on a careers page
2. Extension POSTs automation create
3. Robot stored in `maxun_robots` with selectors + URL + ScoutId
4. Later runs use Path A or B above

---

## 8. Chromium — how browsers are controlled

### 8.1 Why leasing exists

`scoutx-scraper` and `scoutx-aggregators` are **separate OS processes**. Agenda concurrency is per process, so without coordination both can open Chromium and OOM a 2 GB droplet.

Operators want:

1. Up to **2** concurrent **career** Chromium scrapes
2. Aggregators must **not** open Chromium while any career scrape holds a slot (and vice versa)

Design doc: `docs/superpowers/specs/2026-08-21-chromium-slot-lease-design.md`  
Optional next phase (RAM/CPU gates): `docs/superpowers/plans/2026-08-21-adaptive-chromium-admission.md`

### 8.2 Topology

```
Agenda scraper-jobs     → scoutx-scraper      → claim shared slot (1 of N) → Chromium
Agenda aggregator-jobs  → scoutx-aggregators  → claim exclusive           → Chromium
                              ▲
                              │
                   Mongo maxun_chromium_slot_leases
                   (_id: 'droplet')
```

### 8.3 Lease document shape

Collection: `maxun_chromium_slot_leases`  
Model: `server/src/models/ChromiumSlotLease.ts`  
Service: `server/src/services/chromiumSlotLease.ts`

```ts
{
  _id: 'droplet',
  mode: 'shared' | 'exclusive',  // exclusive = aggregator holding
  holders: [
    {
      holderId: string,          // process + pid + uuid
      kind: 'scraper' | 'aggregator',
      leaseUntil: Date,
      runId?: string,
    }
  ],
  updatedAt: Date,
}
```

### 8.4 Claim rules

| Caller | Rule |
|--------|------|
| Career scraper (`kind: 'scraper'`) | Succeed if no aggregator holds and `holders.length < CHROMIUM_MAX_SLOTS`. Mode → `shared`. |
| Aggregator (`kind: 'aggregator'`) | Succeed only if **zero** active holders. Single holder, mode → `exclusive`. |

- Expired holders (`leaseUntil < now`) are stripped before applying rules.
- `claimChromiumSlot` polls/waits until a slot is free or wait budget expires.
- `renewChromiumSlot` keeps `leaseUntil` fresh while the page lease is held.
- `releaseChromiumSlot` removes the holder; empty holders clear exclusive mode.
- Crash recovery: next claim strips expired holders (no separate sweeper required for correctness).

Process kind is set at worker boot:

- `worker.ts` → `setChromiumSlotProcessKind('scraper')`
- `aggregatorWorker.ts` → `setChromiumSlotProcessKind('aggregator')`

### 8.5 Browser reuse pool

File: `server/src/services/browserReusePool.ts`

| Function | Behavior |
|----------|----------|
| `acquirePooledPage` | Claim Chromium slot → get/create pooled browser → new context+page → return lease |
| `releasePooledPage` | Close page/context → optionally evict browser → **always** release Chromium slot in `finally` |

Pool key factors: browser type, proxy, stealth, HTTP2 flags.

Request blocking:

- Always: images, fonts, media (where configured)
- In `LOW_MEMORY_MODE`: also stylesheets

### 8.6 LOW_MEMORY_MODE

File: `server/src/utils/memoryMode.ts`  
Also true when `RENDER_FREE_TIER=true`.

Effects (high level):

- Lean pool (1 page, close after job, short TTL, maxJobs 1, smaller viewport)
- Block CSS
- Shorter anti-bot waits
- Smaller run logs

Keep `true` on 2 GB droplets.

### 8.7 Env knobs (Chromium)

| Env | Role |
|-----|------|
| `CHROMIUM_SLOT_LEASE_ENABLED` | On/off (off = local/dev overlap escape hatch) |
| `CHROMIUM_MAX_SLOTS` | Shared career slots (default 2) |
| `CHROMIUM_SLOT_LEASE_MS` | Holder TTL (defaults from longest job timeout + grace) |
| `CHROMIUM_SLOT_WAIT_MS` | How long acquire waits for a free slot |
| `BROWSER_POOL_*` | Pool size / TTL / max jobs |
| `CHROMIUM_ORPHAN_REAPER*` | Orphan Chromium process hygiene |
| `SCRAPER_JOB_TIMEOUT_MS` | Career job wall timeout |
| `AGGREGATOR_JOB_TIMEOUT_MS` | Aggregator job wall timeout |

**Multi-droplet note:** Two droplets sharing the same `MONGODB_URI` share the lease. That is intentional only for **one** Chromium droplet. Scale-out needs a per-droplet lease id later.

---

## 9. After collection — persistence & canonical shape

### 9.1 Persist extracted rows

`persistExtractedDataForRun` (via automation services) writes per-run rows to **`maxun_extracteddata`**.

Before persist, rows are normalized through:

1. Legacy alias fill (`url` → `jobUrl`, `title` → `jobTitle`, …) — `applyLegacyJobAliases`
2. Column overrides from the recording
3. `buildCanonicalJobDataSync` / `finalizeRowsWithCanonicalData` in `canonicalJobRecord.ts`
4. Structured `jobId` allocation via `jobIdGenerator` / `JobIdCounter`

### 9.2 Canonical job field order

**CanonicalJob is a data shape, not a Mongoose model.**

Fixed keys under `ExtractedData.data` (order matters for consistency):

```
jobId, jobUrl, applyUrl, jobTitle, companyName, jobDescription, jobCategory,
date, job_creation_type, status, isFlagged, jobExperience, sectorIndustry, f500,
location, salaryRange, employmentType, remoteType, companyLogoUrl, about,
skills, responsibilities, minimumQualifications, preferredQualifications, benefits
```

- `job_creation_type` is always `'automation'` for this pipeline
- Destinations (Sheets / Airtable / webhooks) consume this shape

### 9.3 Enqueue to job board

`enqueueJobBoardEnrichments` in `jobBoardEnrichment.ts`:

1. Normalize URL → `jobUrlKey` = SHA-256 of normalized URL (`jobUrlNormalize.ts`)
2. Prefer employer/ATS apply URL over Hiring Cafe listing URL when present
3. Upsert into `maxun_job_board`
4. Skip if already complete (`skippedDedup` / `skippedComplete`)
5. Set status `queued`, or `ready` immediately if list snapshot already has a complete-enough description

Board identity is **`jobUrlKey`**, not `jobId`.

---

## 10. Enrichment computation (detail fill)

**Process:** `enrichmentWorker.ts` → `startJobEnrichmentLoop` → `jobEnrichmentWorker.ts`

### 10.1 What enrichment does vs list scrape

| List scrape (scraper/aggregator) | Enrichment |
|----------------------------------|------------|
| Collects **list** of jobs | Loads **detail** pages |
| Chromium or ATS board JSON | Prefer ATS detail APIs, then scrape.do HTTP |
| Writes ExtractedData + board stubs | Upgrades board rows to `ready` / `partial` / `failed` / `expired` |
| Competes for Chromium slots | Uses scrape.do credits (+ optional Gemini); rare Playwright for hard WAF sites |

### 10.2 Board statuses

| Status | Meaning |
|--------|---------|
| `queued` | Waiting for enrichment |
| `enriching` | Worker claimed this row (`leaseUntil` / `claimedBy`) |
| `ready` | Good enough for Job board UI |
| `partial` | Some fields; weak/incomplete description |
| `failed` | Could not enrich |
| `expired` | ATS says posting is gone |

### 10.3 Attempt order (cheapest / best first)

```
1) ATS / company detail API     → free, structured JSON
2) scrape.do                    → paid HTML (tiers 1 → 2 → 3, geo on tier 3)
3) Gemini (optional)            → structure long text into sections
```

- Client: `scrapeDoClient.ts`
- HTML → fields: `jobPageParser.ts` (includes `descriptionQualityScore` heuristic)
- LLM: `geminiJobExtractor.ts` (`GEMINI_MODEL`, e.g. `gemini-2.5-flash`)
- Host memory of successful tiers: `ScrapeProfile` (`maxun_scrape_profiles`)
- Daily scrape.do budget: `EnrichmentCreditBudget`
- Daily LLM budget: `LlmUsageBudget`

`enrichment.method` values: `list` | `ats` | `scrape.do` | `browser` | `llm` | `none`  
UI badge **“AI-parsed”** ≈ `enrichment.method === 'llm'`.

### 10.4 Enrichment leases (not Chromium)

On each `JobBoardListing`:

- `leaseUntil`, `claimedBy` — worker claims `queued` → `enriching`
- Expired leases are reclaimable by another enrichment loop tick

---

## 11. Mongo models & collections

| Model file | Collection | Purpose |
|------------|------------|---------|
| `Robot.ts` | `maxun_robots` | Automations: `recording_meta` (id, **scoutId**, url, name, saasConfig, tags), workflow `recording`, schedule, webhooks, Sheets/Airtable tokens |
| `Run.ts` | `maxun_runs` | One scrape attempt: status, logs, output, drift, board counters, heartbeat, admission keys |
| `ExtractedData.ts` | `maxun_extracteddata` | Per-run normalized job rows |
| `JobBoardListing.ts` | `maxun_job_board` | Deduped board of record for UI + enrichment state |
| `ChromiumSlotLease.ts` | `maxun_chromium_slot_leases` | Droplet-wide Chromium mutex |
| `EnrichmentCreditBudget.ts` | `maxun_enrichment_credit_budget` | Daily scrape.do spend |
| `LlmUsageBudget.ts` | `maxun_llm_usage_budget` | Daily Gemini usage |
| `ScrapeProfile.ts` | `maxun_scrape_profiles` | Per-host successful scrape.do tier stats |
| `JobIdCounter.ts` | (counter collection) | Sequential structured job IDs |
| `User.ts` | users | Accounts / API keys |
| `OpsDigestSettings.ts` | ops digest prefs | Email digest configuration |
| Agenda | `agendaJobs` / `AGENDA_COLLECTION` | Queue + schedules |
| sessions | `sessions` | express-session store |

### Robot (`maxun_robots`) highlights

- Unique name per user
- Unique `recording_meta.scoutId` per user when present
- Indexes on URL and newest-first listing
- `recording_meta.saasConfig.listExtraction` holds selectors, pagination, max pages, prefer-ATS flags

### JobBoardListing highlights

- Unique index on `jobUrlKey`
- `listSnapshot` — fields known from list scrape
- `enrichment` — method, tier, attempts, credits, llm metadata
- `source` — e.g. `hiring_cafe` for aggregators; empty for company scrapers
- `robotMetaIds` / `runIds` — provenance across scrapes

---

## 12. Tagging (“model” as work arrangement)

File: `server/src/constants/tagCatalog.ts`

Curated **automation** tags as `namespace:value` (typically max 5 per robot).

Namespaces include: `role`, `industry`, `company`, `auth`, **`model`** (Remote / Hybrid / On-site), geo, `level`, `function`, etc.

Used for:

- Filtering robots in the dashboard
- Rollups like “jobs by tag”

**Not** used for ML classification of individual postings.

---

## 13. Heuristics people call “scoring” (not ML ranking)

| Logic | Purpose | Where |
|-------|---------|-------|
| Href scoring | Prefer real job-detail URLs over list indexes | `src/shared/jobHrefScore.ts`, `listExtractor.ts` |
| Description quality | Prefer real JD text over teasers/chrome | `jobPageParser.ts` |
| Ranked CSS selectors | Try item/field selectors; promote winners | `listExtractor.ts` |
| Failure classify | Map errors → `failureReason` | `runLifecycle.ts` |
| Ops “compute” | Worker capacity, memory, queue depth | `opsMetrics.ts`, dashboard |
| Aggregator timeout estimate | Wall-time estimate for Hiring Cafe runs | `hiringCafeRuntime.ts` |

Gemini is **only** for structuring JD text into sections — not matching candidates to jobs.

---

## 14. API surface (backend)

Mounted under `/api` from `server/src/api/*` (plus legacy `/record`, `/storage`, `/auth`, …).

### Automations / dashboard (`api/automations.ts`)

- `GET /dashboard/metrics`, `/dashboard/automations`, `/dashboard/aggregators`
- Schedule heatmap, digest endpoints
- CRUD: `POST /automations`, `GET/PUT /automations/:id…`
- Run: `POST /automations/:id/run`, stop / resume / repack schedules
- Runs: `GET /runs`, `GET /runs/:id`, logs/rows, retry, failure-reason patch
- Lookup: `GET /automations/lookup?scoutId=`

### Jobs board (`api/jobs.ts`)

- `GET /jobs`, `GET /jobs/:id` — enriched listings for consumers / UI

### Admin (`api/admin.ts`)

- Admin login, overview, all-account runs, users, DigitalOcean metrics, digest test — gated by `ADMIN_PASSWORD`

### Recording / SDK

- `api/record.ts` — API-key robot/run APIs
- `api/sdk.ts` — SDK robots, execute, crawl, search
- Chrome extension uses recording routes for “Send to Scout-X”

---

## 15. Key services index (`server/src/services/`)

| Service | Role |
|---------|------|
| `listExtractor.ts` | Playwright paginated list scrape |
| `atsAdapters.ts` | ATS board + detail APIs |
| `automation.ts` | Persist extract, canonical rows, board enqueue |
| `automationRun.ts` | Create/queue runs |
| `automationScheduler.ts` | Schedules + catch-up |
| `jobBoardEnrichment.ts` | Upsert board stubs; dedupe; ready-from-list |
| `jobUrlNormalize.ts` | URL normalize + `jobUrlKey` |
| `canonicalJobRecord.ts` | Canonical extracted field shape |
| `hiringCafeNormalize.ts` / `hiringCafeDetail*.ts` / `hiringCafeRuntime.ts` | Aggregator path |
| `aggregatorIdentity.ts` | Hiring Cafe vs company scrapers |
| `scrapeDoClient.ts` | Paid HTML fetch + tier escalation |
| `jobPageParser.ts` | HTML → fields; quality scoring |
| `geminiJobExtractor.ts` | LLM structured sections |
| `browserReusePool.ts` | Playwright page pool |
| `chromiumSlotLease.ts` | Cross-process Chromium mutex |
| `runLifecycle.ts` / `runAdmission.ts` / `orphanRunRecovery.ts` / `runDrift.ts` | Run state & recovery |
| `opsMetrics.ts` / `opsDigest.ts` / `enrichmentMetrics.ts` | Ops dashboard + digests |
| `scraperIdentity.ts` / `proxyManager.ts` / `unblocker.ts` | Browser identity / proxy / challenges |

---

## 16. Important env groups (names only)

Copy from `ENVEXAMPLE` → `.env`. Production process-specific overrides live in `ecosystem.config.cjs`.

| Group | Examples |
|-------|----------|
| Core | `MONGODB_URI`, `NODE_ENV`, `AGENDA_COLLECTION` |
| Process split | `RUN_EMBEDDED_WORKERS`, `SCHEDULER_ENABLED` |
| Scraper | `SCRAPER_WORKER_CONCURRENCY`, `SCRAPER_JOB_TIMEOUT_MS`, `SCRAPE_JOB_CHILD_PROCESS`, `SCRAPE_DRAIN_MS` |
| Aggregator | `AGGREGATOR_WORKER_CONCURRENCY`, `AGGREGATOR_JOB_TIMEOUT_MS` |
| Chromium | `LOW_MEMORY_MODE`, `CHROMIUM_*`, `BROWSER_POOL_*` |
| Proxy | `SCRAPER_PROXY_ENABLED`, `DEFAULT_PROXY_URL`, `PROXY_POOL` |
| Enrichment | `SCRAPE_DO_TOKEN`, `SCRAPE_DO_DAILY_CREDIT_BUDGET`, `JOB_ENRICHMENT_*`, `JOB_BOARD_*` |
| LLM | `GEMINI_*`, `LLM_*` |
| Ops | `ADMIN_PASSWORD`, schedule catch-up vars, ZeptoMail digest vars |

---

## 17. Failure modes & ops tips

| Symptom | Likely cause |
|---------|--------------|
| Career runs stuck `pending` | `scoutx-scraper` not running |
| Hiring Cafe stuck `pending` | `scoutx-aggregators` not running |
| Schedules never fire | `scoutx-scheduler` down (and scraper has scheduler disabled) |
| OOM / PM2 restarts on scraper | Too many Chromiums / `LOW_MEMORY_MODE` off / concurrency too high |
| Aggregator waits a long time | Career scrapes holding shared slots (expected under lease) |
| Career waits while Hiring Cafe runs | Aggregator exclusive lease (expected) |
| Slot stuck after kill -9 | Wait until `leaseUntil` expires; next claim strips it |
| Empty / few jobs | Max pages too low; selector drift; ATS path failed silently into browser |
| Board rows stuck `queued` | Enrichment worker down / scrape.do budget exhausted / lease stuck |
| Double Chromium | API with `RUN_EMBEDDED_WORKERS=true` while worker PM2 apps also run |

---

## 18. What to read next (code order for a new engineer)

1. `ecosystem.config.cjs` — process topology  
2. `server/src/services/automationRun.ts` — how runs get queued  
3. `server/src/workers/scraperWorker.ts` — `runScraperJobPayload` collection paths  
4. `server/src/services/browserReusePool.ts` + `chromiumSlotLease.ts` — browsers  
5. `server/src/services/canonicalJobRecord.ts` + `jobBoardEnrichment.ts` — store shape  
6. `server/src/workers/jobEnrichmentWorker.ts` — detail fill  
7. `server/src/models/*` — Mongo contracts  
8. `SCOUTX_JOB_PIPELINE_GUIDE.md` — product-facing pipeline narrative  
9. `docs/superpowers/specs/2026-08-21-chromium-slot-lease-design.md` — Chromium lease design  

---

## 19. Glossary (quick)

| Term | Definition |
|------|------------|
| Robot / Automation | Configured scraper stored in `maxun_robots` |
| ScoutId | Human ID like `SX47KX19` on a robot |
| Run | One execution in `maxun_runs` |
| Collection | Gathering list rows (ATS or Chromium) |
| Canonical job | Normalized field map for extracted rows |
| Job board | Deduped long-lived listings in `maxun_job_board` |
| Enrichment | Filling full JD details after list collection |
| Chromium slot | Mongo lease unit for droplet browser capacity |
| Shared vs exclusive | Career scrapers share N slots; aggregators take the whole droplet browser budget alone |
| Agenda | Mongo-backed job queue / scheduler |

---

## 20. Bottom line

Scout-X backend is a **job ingestion pipeline**:

**Admit → Schedule → Collect (ATS or Chromium under a Mongo slot lease) → Normalize → Store (ExtractedData + JobBoard) → Enrich (ATS / scrape.do / Gemini) → Serve (Job board API/UI).**

Chromium is carefully budgeted for a small droplet: career scrapers may run **two** lean browsers in parallel; aggregators wait for exclusive access. Enrichment is intentionally **off** the career Chromium path so detail filling does not fight list scrapes for RAM.

If something “computes,” it is almost always **scheduling, admission, URL/JD heuristics, capacity metrics, or Gemini structuring** — not a Scout ML matching model.
