# Scout-X — Complete Project Context for Claude Projects

> **How to use this file:** Paste or upload this entire document into a Claude Project as project knowledge. It is the single source of truth for product purpose, architecture, pipeline, data model, ops, and coding conventions.  
> **Security:** Do **not** paste `.env` secrets into Claude. Only variable *names* and purposes are listed here.  
> **Repo root:** This monorepo folder is commonly named `maxun-develop` / `maxun` on disk; product name is **Scout-X**. Package name in `package.json` is still `maxun` (legacy Maxun fork).

---

## 0. One-sentence product definition

**Scout-X** is a job-ingestion and automation platform (forked from Maxun) that finds job listings from company career sites, enriches each posting with full details, and displays them on a FirstStep / Scout-X job board — without writing a custom scraper per company when possible.

---

## 1. Product identity and business context

### 1.1 Names and branding

| Name | Meaning |
|------|---------|
| **Scout-X** | Product / ops name (UI, PM2 processes, docs, hosting) |
| **Maxun** | Upstream open-source no-code scraper this repo is based on (`package.json` name `maxun`, AGPL-3.0) |
| **First Step / FirstStep** | Parent company product (auth, users, resume, etc.) — **separate system** |
| **ScoutId** | Human-facing scrape ID on robots, format like `SX12AB34` (`recording_meta.scoutId`) |

### 1.2 Relationship: Scout-X vs First Step

- Scout-X and First Step stay **two separate systems**.
- Do **not** merge Scout-X into the First Step backend.
- If First Step needs job-board data, it should **call Scout-X via API**.
- Scout-X can also be sold **standalone** (“watch this career site for me”).

### 1.3 Published GitHub remotes (same monorepo, naming only)

- `firststep_jobscraper_ui`
- `firststep_jobscraper_backend`

There is **no split subtree** — one codebase contains UI + API + workers.

### 1.4 What Scout-X is NOT

- Not a simple static website.
- Not “download HTML once and done.”
- Not designed for free sleeping hosts (Render Free) as production — Chromium + schedules need always-on RAM.
- Not First Step’s main app (login/payments/resume live elsewhere).

---

## 2. Tech stack

| Layer | Technology |
|-------|------------|
| Language | TypeScript (frontend + backend), some Python (Camoufox helper) |
| Frontend | React 18, Vite 5, MUI 5, Emotion, React Router 6, TanStack React Query, i18next, Socket.IO client, styled-components |
| Backend | Node.js, Express 4, Socket.IO, Mongoose 9, express-session + connect-mongo, JWT, Joi, Winston |
| Queue / schedule | **Agenda** on MongoDB (collections like `agendaJobs` / `agendaJobs_local`) |
| Browser automation | Playwright 1.58 Chromium (`playwright-core` / `playwright-extra` + stealth), optional Camoufox, optional remote browser service |
| Scraping / enrichment | Cheerio, Turndown, scrape.do (paid HTML fetch), Google Gemini (`@google/genai`) |
| Database | **MongoDB** (required — app data, sessions, Agenda, job board). Postgres env vars may exist in legacy templates but Mongo is the source of truth for Scout-X |
| Optional integrations | Google Sheets OAuth, Airtable OAuth, Firebase Storage (screenshots), webhooks, n8n exports, ZeptoMail (ops digests), DigitalOcean metrics API |
| Process manager (prod) | PM2 via `ecosystem.config.cjs` |
| Tests | Vitest (unit), Playwright (e2e smoke) |
| Lint | ESLint 9 |
| License | AGPL-3.0-or-later |

---

## 3. Monorepo directory map

```
maxun-develop/   (repo root)
├── src/                    # React + Vite SPA (Scout-X dashboard, job board, robots, runs)
├── server/                 # Express API, workers, services, models
│   └── src/
│       ├── api/            # REST handlers (jobs, automations, admin, record, sdk)
│       ├── routes/         # Express routers (auth, storage, workflow, webhook, proxy, record)
│       ├── models/         # Mongoose models
│       ├── services/       # Business logic (ATS, list extract, enrichment, scheduler, scrape.do, Gemini…)
│       ├── workers/        # Scraper + enrichment workers, child scrape process
│       ├── queue/          # Agenda / scraper queue helpers
│       ├── browser-management/
│       ├── middlewares/
│       ├── storage/        # DB connect
│       ├── server.ts       # API process entry
│       ├── worker.ts       # Scraper worker entry
│       ├── schedule-worker.ts
│       ├── enrichmentWorker.ts
│       └── …
├── maxun-core/             # Recorded-workflow interpreter (Engine 1 — classic Maxun recordings)
├── browser/                # Optional remote Playwright browser microservice
├── chrome-extension/       # Visual list picker → “Send to Scout-X / Maxun”
├── docs/                   # Hosting, reliability designs, job-board specs, n8n
├── e2e/                    # Playwright e2e
├── public/                 # Static assets
├── scripts/                # Ops / migration helpers
├── ecosystem.config.cjs    # PM2: scout-x, scoutx-scheduler, scoutx-scraper, scoutx-enrichment
├── ENVEXAMPLE              # Env template (copy to .env)
├── SCOUTX_JOB_PIPELINE_GUIDE.md
├── SETUP.md / README.md / GAPS_TRACKER.md
└── package.json
```

### Frontend (`src/`) purpose map

| Path | Purpose |
|------|---------|
| `pages/` | Login, Register, Dashboard shell, Automation config/data, Run details, Admin, Recording |
| `components/jobs/` | **Job board UI** (`JobBoardPage.tsx`) |
| `components/robot/` | Robot create/edit/settings/schedule/integrations |
| `components/run/` | Runs list / abort / live logs |
| `components/dashboard/` | Nav, menus, chrome-extension handoff |
| `components/recorder/` | Live recording browser UI |
| `api/` | Client API wrappers |
| `context/` | Auth, global info, socket, theme |
| `routes/userRoute.tsx` | Auth gate |

### Backend (`server/src/`) purpose map

| Path | Purpose |
|------|---------|
| `services/listExtractor.ts` | Paginated list scrape (Playwright) |
| `services/atsAdapters.ts` | ATS detail + board list APIs |
| `services/jobBoardEnrichment.ts` | Enqueue / upsert board stubs |
| `services/jobPageParser.ts` | HTML → fields; thin/junk detection |
| `services/scrapeDoClient.ts` | Paid fetch + tier escalation |
| `services/geminiJobExtractor.ts` | LLM structured JD sections |
| `services/automationScheduler.ts` | Schedule rehydrate, fire, catch-up |
| `services/canonicalJobRecord.ts` | Field aliases / normalization |
| `workers/scraperWorker.ts` | Consume `scraper-jobs`, run scrape |
| `workers/jobEnrichmentWorker.ts` | Claim queued board rows, enrich |
| `workers/scrapeJobChild.ts` / `.cjs` | Isolated child scrape process |
| `api/jobs.ts` | Public job board API |
| `api/automations.ts` | Robot CRUD / run / schedule |
| `api/admin.ts` | Admin ops / compute overview |

---

## 4. Runtime processes (critical mental model)

Scout-X is **multi-process**. Chromium must not live in the API process in production.

### 4.1 Local development commands

| Command | Role |
|---------|------|
| `npm run start:dev` | API (`nodemon server.ts`) + Vite UI |
| `npm run client` | Vite only → http://localhost:5173 |
| `npm run server:dev` | API only → http://localhost:8080 (`/api`) |
| `npm run worker:dev` | Scraper worker (Agenda `scraper-jobs`, Chromium) |
| `npm run worker:scheduler:dev` | Scheduler only (alarms + catch-up) |
| `npm run worker:enrichment:dev` | Enrichment worker (ATS / scrape.do / Gemini; **no Chromium**) |
| `npm run playwright:install` | Install Chromium 1.58 |
| `npm run build` / `build:server` | Production UI → `build/`, server → `server/dist/` |
| `npm test` / `npm run test:e2e` / `npm run lint` | Quality gates |
| `npm run backfill:job-board` / `repair:job-board` | Ops scripts |

Set `VITE_BACKEND_URL` to API **origin** (e.g. `http://localhost:8080`). UI appends `/api` where needed.

### 4.2 Production PM2 (`ecosystem.config.cjs`)

| Process | Script | Chromium? | Notes |
|---------|--------|-----------|-------|
| `scout-x` | `server.js` | No | API + dashboard; `RUN_EMBEDDED_WORKERS=false` |
| `scoutx-scheduler` | `schedule-worker.js` | No | Agenda schedules + catch-up + ops digest |
| `scoutx-scraper` | `worker.js` | **Yes** | `SCHEDULER_ENABLED=false`; concurrency usually 1 on DO |
| `scoutx-enrichment` | `enrichmentWorker.js` | No | Exactly **one** instance (rate limits / credit budget) |

**Never** set `RUN_EMBEDDED_WORKERS=true` on API while `scoutx-scraper` is also running — double Chromium waste.  
If scraper is down → runs stay `pending` forever.  
If scheduler is down (and scraper has `SCHEDULER_ENABLED=false`) → schedules never fire.

### 4.3 Recommended DigitalOcean sizing

- **Recommended:** Basic **4 GiB RAM / 2 vCPU / ~80 GiB SSD**
- **Minimum:** 2 GiB only with concurrency 1 and careful settings
- Job data lives in **MongoDB Atlas**, not on droplet disk
- RAM-bound because of Chromium, not disk-bound

---

## 5. End-to-end architecture

```
Company careers site
        │
        ▼
┌──────────────────────┐
│ 1. LIST / BOARD      │  Scheduler fires → Run → Agenda "scraper-jobs"
│    SCRAPE            │  Prefer ATS board API; else Playwright list scrape
└─────────┬────────────┘
          │ stubs: title, company, job URL (+ optional teaser)
          ▼
┌──────────────────────┐
│ 2. EXTRACTED DATA    │  maxun_extracteddata (per-run audit / destinations)
└─────────┬────────────┘
          ▼
┌──────────────────────┐
│ 3. JOB BOARD QUEUE   │  maxun_job_board — dedupe by jobUrlKey
│                      │  status: queued → enriching → ready|partial|failed|expired
└─────────┬────────────┘
          ▼
┌──────────────────────┐
│ 4. ENRICHMENT        │  ATS detail → scrape.do tiers → optional Gemini
│    WORKER            │  method: ats | scrape.do | llm | list | browser | none
└─────────┬────────────┘
          ▼
┌──────────────────────┐
│ 5. JOB BOARD UI      │  GET /api/jobs → JobBoardPage cards + detail modal
└──────────────────────┘
```

**Functional meaning:** Users see real roles with real text — not empty shells.  
**Technical meaning:** List scrape is cheap/browser-based; enrichment is a separate budget-gated worker.

---

## 6. Job pipeline — detailed

### 6.1 Robots (automations)

- Stored in Mongo collection **`maxun_robots`** (`models/Robot.ts`).
- Key blob: `recording_meta` + `recording` (workflow / SaaS config).
- List extraction config: `recording_meta.saasConfig.listExtraction`
- Schedule: `recording_meta.saasConfig.schedule` and/or `robot.schedule` (merged via `resolveEffectiveScheduleState`)
- Unique indexes: `(userId, recording_meta.name)`, `(userId, recording_meta.scoutId)` when scoutId present
- Max pages on list scrape is a **hard cap** (default page limit often 10 if unset). Raising Max pages increases jobs collected.

Pagination modes: `next-button`, `infinite-scroll`, `page-number-loop` (`listExtractor.ts`).

### 6.2 Scheduler vs scraper

| Role | Plain English | Process |
|------|---------------|---------|
| **Scheduler** | Alarm clock | `schedule-worker` / Agenda job `schedule-triggers` |
| **Scraper** | Does the work | `worker` / Agenda job `scraper-jobs` |

Scheduler **does not scrape**. On fire it:

1. Validates robot still enabled  
2. Single-flight (skip if pending/running)  
3. Creates **Run** (`source: scheduled`)  
4. Enqueues `scraper-jobs` with `runId`  
5. Updates `lastRunAt` / `nextRunAt`  

Missed catch-up loop enqueues overdue robots gradually after downtime.

**Schedule packing (thousands of companies):**

- Daily cron presets become **per-robot 24h intervals**, not everyone at midnight  
- First start randomized within ~24h  
- Packed with **≥ 90s gap** (`MIN_AUTOMATION_GAP_MS`) via `findPackedNextRunAt` / `randomPreferredStartMs` in `utils/schedule.ts`  
- Packing spreads start times; it does **not** create infinite CPU  

### 6.3 Scraper worker path

1. Claim Agenda `scraper-jobs`  
2. Often fork **child process** (hard-kill hung Chromium)  
3. Try **ATS board API** first (`detectAtsBoard` → `fetchAtsBoardJobs`)  
4. Else Playwright / Camoufox **list extraction**  
5. Finalize rows → `persistExtractedDataForRun` → `enqueueJobBoardEnrichments`  
6. Recoverable failures can requeue with backoff  

Code: `workers/scraperWorker.ts`, `listExtractor.ts`, `atsAdapters.ts`, `automation.ts`.

### 6.4 Two Mongo stores for jobs

| Collection | Model | Role |
|------------|-------|------|
| `maxun_extracteddata` | `ExtractedData` | Per-run audit / Sheets-Airtable-webhook destinations; canonical row shape |
| `maxun_job_board` | `JobBoardListing` | Deduped board of record for UI; status + enrichment + structured sections |

**Dedupe key:** `jobUrlKey` (normalized URL), **not** `jobId`.

### 6.5 Job board status lifecycle

| Status | Meaning |
|--------|---------|
| `queued` | Waiting for enrichment |
| `enriching` | Worker leased the row |
| `ready` | Good enough for Job board |
| `partial` | Weak/incomplete description |
| `failed` | Could not enrich |
| `expired` | ATS says posting gone |

Lease fields: `leaseUntil`, `claimedBy`, `priority`, `nextAttemptAt`.

### 6.6 Enrichment order (cheapest / best first)

```
1) ATS / company API     → free structured JSON (best)     method=ats
2) scrape.do             → paid HTML (tiers 1→2→3)         then parse or LLM
3) Gemini (optional)     → structured sections             method=llm
4) Deterministic parser  → JSON-LD / meta / cheerio        method=scrape.do
5) List-complete skip    → title+company+location+desc≥400 method=list (0 credits)
```

Also possible: `browser` method for special browser fallbacks (e.g. hard WAF cases).

**UI “AI-parsed” badge** ⇔ `enrichment.method === 'llm'`.

### 6.7 scrape.do tiers

| Tier | Behavior | Rough cost | When |
|------|----------|------------|------|
| 1 | Plain HTML | ~1 credit | Static pages |
| 2 | JS render | ~5 credits | SPAs |
| 3 | Harder anti-bot + render | ~25 credits | Blocked cheaper tiers |

**Thin / teaser detection (Apple-style):** Short og:description marketing lines are **junk**. Escalate to tier 2+. Host learning stored in **`maxun_scrape_profiles`** (`ScrapeProfile`).

### 6.8 ATS providers

**Detail (`detectAts` / `fetchAtsJob`) — `AtsProvider`:**

- greenhouse, lever, ashby, workable, smartrecruiters, recruitee  
- oraclecloud (direct FA hosts + vanity `careers.oracle.com`)  
- googlecareers, ibmcareers, workday  

**Board list (`detectAtsBoard` / `fetchAtsBoardJobs`) also includes e.g.:**

- findly, successfactors, bankofamerica (and related board list paths)

**Oracle rules (important):**

- Real detail often via HCM API `recruitingCEJobRequisitionDetails`  
- Optional env: `ORACLE_CAREERS_HCM_HOST` (default `eeho.fa.us2.oraclecloud.com`)  
- Direct `*.fa.oraclecloud.com`: API empty → mark **expired**  
- Vanity `careers.oracle.com`: API fail → **fall back to scrape.do** (do not kill live jobs)

### 6.9 Gemini structuring

- File: `geminiJobExtractor.ts`  
- Model typically `gemini-2.5-flash`, temperature 0, JSON schema  
- Writes only fields **present** on the page — never invent  
- Structured: `about`, `minimumQualifications[]`, `preferredQualifications[]`, `responsibilities[]`, `benefits[]`, `skills[]`  
- Budgets: `LLM_DAILY_CALL_BUDGET`, `LLM_DAILY_TOKEN_BUDGET`, `LLM_RATE_PER_MIN`  
- Usage: collection / model `LlmUsageBudget` (`maxun_llm_usage_budget`)  
- Cache via `enrichment.llmInputHash`  

### 6.10 Job board API visibility rules

`GET /api/jobs` (`api/jobs.ts`) typically shows rows where:

- `status ∈ {ready, partial}` (product rules may hide partial in some paths — check current filter)  
- `enrichment.method ∈ {ats, scrape.do, browser, list, llm}`  
- Description length ≥ ~60 chars  

UI: `src/components/jobs/JobBoardPage.tsx` — prefers stored structured sections; falls back to `extractCardHighlights(jobDescription)`.

### 6.11 Healthy enriched job (“done”)

- Full `jobDescription` (hundreds–thousands of chars, not one marketing line)  
- Often `location`, `salaryRange`, `jobCategory`  
- Usable `companyLogoUrl`  
- `enrichment.method` of `ats` | `scrape.do` | `llm` (or `list` if list-complete)  
- Optional structured section arrays  

---

## 7. JobBoardListing schema (fields Claude must know)

Collection: **`maxun_job_board`**

Identity / ownership:

- `jobUrlKey`, `jobUrl`, `applyUrl`  
- `ownerId`, `robotMetaIds[]`, `runIds[]`, `jobId`  

Content:

- `jobTitle`, `companyName`, `jobDescription`, `descriptionSnippet`  
- `jobCategory`, `location`, `salaryRange`, `employmentType`, `remoteType`  
- `jobExperience`, `sectorIndustry`, `f500`, `date`, `companyLogoUrl`  

Structured (Gemini / adapters):

- `about`, `minimumQualifications[]`, `preferredQualifications[]`  
- `responsibilities[]`, `benefits[]`, `skills[]`  

Pipeline:

- `status`, `priority`, `leaseUntil`, `claimedBy`, `contentHash`  
- `listSnapshot` (thin fields from list stage)  
- `enrichment`: `{ method, tier, attempts, creditsSpent, lastError, lastEnrichedAt, nextAttemptAt, llmModel, llmInputHash, llmTokens }`  
- `createdAt`, `updatedAt`, `lastSeenAt`  

---

## 8. Frontend routes (SPA)

Auth-gated (`UserRoute`):

| Path | Content |
|------|---------|
| `/` | → `/dashboard` |
| `/dashboard` | Dashboard |
| `/jobs` | **Job board** |
| `/robots/*`, `/robots/create` | Automations / robots |
| `/runs/*` | Runs |
| `/failures` | Failure dashboard |
| `/proxy` | Proxy settings |
| `/automation/:id/data` | Extracted data for robot |
| `/automation/:id/config` | Robot config (incl. list extraction, max pages) |
| `/run/:id` | Run details |
| `/recording` | Live recorder |
| `/admin` | Admin (password-gated ops) |
| `/login`, `/register` | Auth |

Live updates: Socket.IO (e.g. queued-run channels).

---

## 9. Auth and API access

- Session cookies + JWT patterns (`routes/auth.ts`)  
- API key header `x-api-key` accepted on many automation routes (`requireSignInOrApiKey`)  
- CORS allows `x-api-key`; credentials from `PUBLIC_URL` origin  
- Production requires strong `SESSION_SECRET`  
- Chrome extension can use API key + configurable backend base URL  

---

## 10. Environment variables (names only — never commit secrets)

### Core

- `NODE_ENV`, `JWT_SECRET`, `ENCRYPTION_KEY`, `SESSION_SECRET`  
- `MONGODB_URI`, `MONGODB_DATABASE` / `DB_NAME`  
- `BACKEND_PORT`, `FRONTEND_PORT`, `BACKEND_URL`, `PUBLIC_URL`  
- `VITE_BACKEND_URL`, `VITE_PUBLIC_URL`  
- `LOGS_PATH`, `ADMIN_PASSWORD`  

### Workers / scrape

- `RUN_EMBEDDED_WORKERS` — false in production with separate PM2 workers  
- `SCHEDULER_ENABLED` — false on scraper when dedicated scheduler process  
- `SCRAPER_WORKER_CONCURRENCY`, `SCRAPER_JOB_TIMEOUT_MS`  
- `LOW_MEMORY_MODE`, `BROWSER_POOL_MAX_PAGES`  
- `AGENDA_COLLECTION` (e.g. `agendaJobs_local` for local isolation)  
- `DEFAULT_BROWSER_TYPE` (`playwright` / camoufox)  
- Camoufox / browser WS host-port vars  
- Proxy: `DEFAULT_PROXY_URL`, `PROXY_POOL`, `SCRAPER_PROXY_ENABLED`, Camoufox proxy vars  

### Enrichment / job board

- `SCRAPE_DO_TOKEN`, `SCRAPE_DO_DAILY_CREDIT_BUDGET`, `SCRAPE_DO_GEO`  
- `SCRAPE_PROFILE_REPROBE_DAYS`  
- `JOB_ENRICHMENT_CONCURRENCY`, `JOB_ENRICHMENT_BATCH`, `JOB_ENRICHMENT_RATE_PER_MIN`, `JOB_ENRICHMENT_MAX_ATTEMPTS`  
- `JOB_BOARD_STALE_DAYS`, `JOB_BOARD_MIN_DESC_CHARS`  
- `MAX_PARSE_BYTES`, `UV_THREADPOOL_SIZE`  
- `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_ENABLED`  
- `LLM_DAILY_CALL_BUDGET`, `LLM_DAILY_TOKEN_BUDGET`, `LLM_RATE_PER_MIN`, `GEMINI_MAX_INPUT_CHARS`  
- `ORACLE_CAREERS_HCM_HOST` (optional)  

### Integrations / ops

- Google / Airtable OAuth client vars  
- Firebase storage vars  
- `ZEPTOMAIL_*`, `OPS_DIGEST_EMAIL_TO`, `OPS_DIGEST_ENABLED`  
- `DIGITALOCEAN_TOKEN`, `DIGITALOCEAN_DROPLET_IDS` (admin metrics)  
- `MAXUN_TELEMETRY`, `API_RATE_LIMIT_MAX`  

Template file: **`ENVEXAMPLE`**.

---

## 11. Debugging playbook (when jobs look wrong)

Check in this order:

1. **Max pages** on robot too low? (list cap, not “broken extractor”)  
2. Rows in `maxun_extracteddata` for the `runId`?  
3. Stubs in `maxun_job_board` with `status: queued`?  
4. Enrichment process running? (`worker:enrichment`)  
5. Known **ATS** URL that should use adapter instead of scrape.do?  
6. **Thin meta teaser** accepted? (needs JS render tier escalation)  
7. Host stuck wrong tier in `maxun_scrape_profiles`?  
8. Gemini budget paused? (`llm_budget_paused` / daily budgets) — JD may exist but sections empty  
9. API filter rejecting row? (method / status / desc length)  
10. Scraper concurrency / OOM / timeout on heavy SPA (Apple, Oracle, Meta)?

Case studies already fixed in-repo:

- **Apple:** max pages + teaser→render escalation  
- **Oracle:** vanity HCM API + logo + expire-only-on-direct-FA  

---

## 12. Invariants (do not break)

1. Job board UI reads **`JobBoardListing`**, not raw `ExtractedData`.  
2. Dedup by **`jobUrlKey`**.  
3. Enrichment is **async** and budget-gated (scrape.do **and** LLM).  
4. Do **not** assume full HTML is retained after parse.  
5. Structured sections are first-class when Gemini succeeds; client sectionizer is **fallback**.  
6. Never invent fields; never overwrite good data with empty LLM output.  
7. Prefer extending `ParsedJobFields` / Gemini schema / `mergeParsedFields` over one-off UI string hacks.  
8. Prefer **ATS APIs over scraping** when detectable.  
9. Thin/teaser HTML is **not** success — escalate.  
10. Production: Chromium only in scraper process; one enrichment process.  
11. Scheduler does not scrape; scraper does not own schedules when `SCHEDULER_ENABLED=false`.  

---

## 13. Key file cheat sheet

| Area | Path |
|------|------|
| List scrape | `server/src/services/listExtractor.ts` |
| Scraper worker | `server/src/workers/scraperWorker.ts` |
| Schedule | `server/src/services/automationScheduler.ts`, `schedule-worker.ts`, `utils/schedule.ts` |
| Enqueue board | `server/src/services/jobBoardEnrichment.ts` |
| Enrichment worker | `server/src/workers/jobEnrichmentWorker.ts`, `enrichmentWorker.ts` |
| ATS | `server/src/services/atsAdapters.ts` |
| HTML quality | `server/src/services/jobPageParser.ts` |
| scrape.do | `server/src/services/scrapeDoClient.ts` |
| Gemini | `server/src/services/geminiJobExtractor.ts` |
| Canonical fields | `server/src/services/canonicalJobRecord.ts` |
| Job board API | `server/src/api/jobs.ts` |
| Job board UI | `src/components/jobs/JobBoardPage.tsx` |
| Robot config UI | `src/pages/AutomationConfigPage.tsx` |
| Models | `server/src/models/JobBoardListing.ts`, `Robot.ts`, `Run.ts`, `ExtractedData.ts`, `ScrapeProfile.ts`, `LlmUsageBudget.ts` |
| PM2 | `ecosystem.config.cjs` |
| Pipeline docs | `SCOUTX_JOB_PIPELINE_GUIDE.md`, `docs/JOB-BOARD-POPULATION-CONTEXT.md`, `docs/SCHEDULER-AND-SCRAPER.md` |

---

## 14. Related documentation index (read when deepening)

| Doc | Topic |
|-----|--------|
| `SCOUTX_JOB_PIPELINE_GUIDE.md` | Full pipeline + Apple/Oracle + DO RAM/SSD |
| `docs/JOB-BOARD-POPULATION-CONTEXT.md` | Board population invariants |
| `docs/SCHEDULER-AND-SCRAPER.md` | Scheduler/scraper engines |
| `docs/SCOUT-X-HOSTING-PLAN.md` | Business hosting / First Step separation |
| `docs/DIGITALOCEAN-SCOUT-X-SETUP-FOR-BEGINNERS.md` | DO setup |
| `docs/HETZNER-SCOUT-X-SETUP-FOR-BEGINNERS.md` | Hetzner setup |
| `docs/production-deployment.md` | Prod process layout |
| `docs/RELIABILITY-HARDENING-EXPLAINED.md` | Reliability |
| `docs/superpowers/specs/*` | Design specs (drift, backoff, SuccessFactors, etc.) |
| `docs/QA_CHECKLIST.md` | Manual QA |
| `chrome-extension/README.md` | Extension setup |
| `GAPS_TRACKER.md` | Historical gap closure tracker |
| `SETUP.md` / `README.md` | Install basics |

---

## 15. Chrome extension & maxun-core

### Chrome extension

- Visual list picker; send automation to Scout-X backend  
- Side panel branding: Scout-X  
- Configure API base (`…/api`) + optional `x-api-key`  
- Dashboard can push backend URL to extension via web bridge  

### maxun-core

- Interprets **recorded** workflows (click/type/scrape steps) — classic Maxun engine  
- Scout-X job SaaS path often uses **listExtraction + ATS** more than full recordings, but recording path still exists  

### Optional browser service

- `browser/` package — remote Playwright WS for recording/scrape isolation  
- Camoufox Python helper: `server/src/services/camoufox-server.py`  

---

## 16. Coding conventions for Claude when editing this repo

1. **Match existing patterns** — TypeScript, Mongoose schemas, Express routers, Vitest colocated `*.test.ts`.  
2. **Minimal diffs** — no drive-by refactors; no unsolicited markdown docs unless asked.  
3. **Tests** — add/adjust unit tests next to services when changing parsers, ATS detection, enrichment merge, schedule packing.  
4. **Never commit secrets** — `.env`, tokens, passwords.  
5. **Enrichment changes** must preserve: budget gates, lease claiming, method enums, merge-not-blank rules.  
6. **Scraper changes** must respect child-process isolation, timeouts, and single-flight runs.  
7. **UI job cards** should prefer stored structured fields over client-side sectionizing.  
8. Prefer ATS adapter extension over brittle CSS for large career platforms.  
9. When both “fix” and “exploit/PoC” are asked for security topics: provide hardening/fix only.  
10. Package scripts and Playwright version pins matter (`playwright@1.58.0`).  

---

## 17. Common tasks quick reference

| I want to… | Look at / do… |
|------------|----------------|
| Add ATS company support | `atsAdapters.ts` (`detectAts` / `detectAtsBoard` + mappers) + tests |
| Fix thin descriptions | `jobPageParser.ts` junk/teaser rules + `scrapeDoClient.ts` escalation |
| Change board visibility | `api/jobs.ts` filters + `JobBoardPage.tsx` |
| Change schedule packing | `utils/schedule.ts`, `automationScheduler.ts` |
| Raise jobs per company | Robot **Max pages** in Automation Config UI / `listExtraction` |
| Run local full stack | `start:dev` + `worker:dev` + `worker:scheduler:dev` + `worker:enrichment:dev` |
| Deploy droplet | Build, `pm2 start ecosystem.config.cjs`, Mongo Atlas, `.env` |
| Backfill board from extracted | `npm run backfill:job-board` |
| Repair bad descriptions | `npm run repair:job-board` |

---

## 18. Mental model (explain to anyone in 6 lines)

1. **List scrape** = collect links from search results (or ATS board JSON).  
2. **Enrichment** = open each link properly and extract the real posting.  
3. **Prefer APIs over scraping** when the ATS is known.  
4. **scrape.do** = paid browser-as-a-service when there is no API.  
5. **Thin/teaser detection** = don’t trust fake success HTML; escalate.  
6. **Job board** = product surface where users browse cleaned results.  

---

## 19. Claude Project instructions (paste as custom instructions)

You are assisting on **Scout-X**, a Maxun-based job scraping and enrichment platform for First Step.

- Treat `SCOUTX_CLAUDE_PROJECT_CONTEXT.md` and `SCOUTX_JOB_PIPELINE_GUIDE.md` as authoritative.  
- Always distinguish **list scrape** vs **enrichment** vs **job board UI**.  
- Never invent job fields; empty means absent.  
- Prefer ATS adapters and quality escalation over ad-hoc scrapers.  
- Production topology is four PM2 processes; Chromium only in scraper.  
- Do not ask for or echo `.env` secrets.  
- When debugging incomplete jobs, follow the playbook order (max pages → extracted → queued → enrichment → ATS → thin parse → scrape profile → LLM budget → API filters).  
- Keep code changes minimal, tested, and consistent with existing TypeScript/Mongoose patterns.  

---

*Generated for Claude Project onboarding from the Scout-X / Maxun codebase (list scrape, enrichment, ATS adapters, thin-parse escalation, Oracle HCM vanity support, schedule packing, PM2 topology). Update this file when major pipeline or process topology changes.*
