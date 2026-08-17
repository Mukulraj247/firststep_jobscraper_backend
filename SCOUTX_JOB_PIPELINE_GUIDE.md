# Scout-X Job Pipeline — How Everything Works

**Who this is for:** anyone who needs to explain (or understand) what we built for scraping jobs, filling in full job details, and showing them on the Job board.

**Tone:** plain English first, then a short “tech notes” box for each part.

---

## 1. What we built (in one sentence)

We built a system that:

1. **Finds job listings** from company career sites (list scrape),
2. **Fills in the full details** for each job (enrichment),
3. **Shows them** on the FirstStep / Scout-X **Job board**.

It works for many companies without writing a custom scraper for each one — and when a company needs a smarter path (like Apple or Oracle), the system **detects** that and upgrades automatically.

---

## 2. The big picture

```
  Company careers site
           │
           ▼
  ┌─────────────────────┐
  │  1. LIST SCRAPE     │  Robot visits search/list page,
  │  (Playwright)       │  clicks Next, collects title + URL
  └─────────┬───────────┘
            │  stubs: title, company, job URL
            ▼
  ┌─────────────────────┐
  │  2. JOB BOARD QUEUE │  Save each URL as a row
  │  (MongoDB)          │  status = queued / ready / …
  └─────────┬───────────┘
            │
            ▼
  ┌─────────────────────┐
  │  3. ENRICHMENT      │  For each URL, get FULL description,
  │  (worker)           │  location, salary, logo, quals, etc.
  └─────────┬───────────┘
            │
            ▼
  ┌─────────────────────┐
  │  4. JOB BOARD UI    │  Cards + detail modal
  │  (React)            │  “AI-parsed” when Gemini structured it
  └─────────────────────┘
```

**Functional meaning:**  
Users see real roles with real text — not empty shells.

**Technical meaning:**  
List scrape is cheap and browser-based; enrichment is a separate worker that prefers free ATS APIs, then paid scrape.do, then optional Gemini.

---

## 3. Piece-by-piece

### 3.1 Scrapers / Robots (list extraction)

**What it does (functional)**  
You configure a “robot” once (example: Apple tech jobs). On a schedule (or manual run) it opens the career **search results** page, reads each job row, and follows pagination (“Next page”).

**What it stores**  
Usually only:

- Job title  
- Company name  
- Job URL (link to the detail page)  
- Sometimes a short teaser from the list

**Important setting: Max pages**  
If Max pages = 3 and the site shows 20 jobs per page, you only get **~60 jobs**, even if Apple has **600+**.  
That is not a broken extractor — it is a **cap**. Raise Max pages to get more.

**Tech notes**

- Code: `server/src/services/listExtractor.ts`
- Worker: `server/src/workers/scraperWorker.ts`
- Robot config lives in Mongo (`maxun_robots`), under `recording_meta.saasConfig.listExtraction`
- Pagination modes: `next-button`, `infinite-scroll`, `page-number-loop`
- Default page limit if unset: 10 (`DEFAULT_PAGE_LIMIT`)

---

### 3.2 Job board listings (the database row)

**What it does (functional)**  
Every job URL becomes one row on the Job board pipeline. That row starts “incomplete” and gets richer after enrichment.

**Statuses you may see**

| Status      | Meaning                                      |
|------------|-----------------------------------------------|
| `queued`   | Waiting for enrichment                        |
| `enriching`| Worker is processing it now                   |
| `ready`    | Good enough to show on the Job board          |
| `partial`  | Some fields, but weak/incomplete description  |
| `failed`   | Could not enrich                              |
| `expired`  | ATS says the posting is gone                  |

**Tech notes**

- Collection: `maxun_job_board`
- Model: `server/src/models/JobBoardListing.ts`
- Enqueue after scrape: `server/src/services/jobBoardEnrichment.ts`
- Dedupes by normalized `jobUrlKey`

---

### 3.3 Enrichment worker (the “fill in details” engine)

**What it does (functional)**  
For each queued job URL, the enrichment worker tries to load the **full job posting**: description, location, salary, category, experience, logo, and (when Gemini runs) structured sections like Responsibilities / Qualifications / Benefits.

**Order of attempts (cheapest / best first)**

```
1) ATS / company API   → free, structured JSON (best)
2) scrape.do           → paid HTML fetch (tiers 1→2→3)
3) Gemini (optional)   → turns long page text into clean sections
```

**Tech notes**

- Process: `npm run worker:enrichment:dev` → `server/src/enrichmentWorker.ts`
- Logic: `server/src/workers/jobEnrichmentWorker.ts`
- Marks `enrichment.method` as: `ats` | `scrape.do` | `llm` | `list` | `none`
- UI badge **“AI-parsed”** = `enrichment.method === 'llm'`

---

### 3.4 ATS adapters (direct company APIs)

**What it does (functional)**  
Many big companies don’t need scrape.do at all. Their career sites talk to a public or semi-public **API**. We call that API and map the JSON into our job fields.

**Supported examples**

| Provider        | Example hosts                          |
|----------------|----------------------------------------|
| Greenhouse     | `boards.greenhouse.io`                 |
| Lever          | `jobs.lever.co`                        |
| Ashby          | `jobs.ashbyhq.com`                     |
| Workable       | `apply.workable.com`                   |
| SmartRecruiters| `jobs.smartrecruiters.com`             |
| Recruitee      | `*.recruitee.com`                      |
| Oracle HCM     | `*.fa.oraclecloud.com`, `*.fa.ocs.oraclecloud.com`, `careers.oracle.com`, allowlisted path vanities (e.g. Dell), hash-router vanities (e.g. Hexaware) |
| Google Careers | Google careers job result URLs         |
| IBM Careers    | IBM JobDetail pages                    |
| Findly / SF    | Various board list APIs                |

**Oracle special case (what we fixed)**  

- Public page: `https://careers.oracle.com/.../job/342043`  
- That page is a **heavy JavaScript app**. scrape.do often only sees a short summary (~600 characters).  
- Real data lives in Oracle’s HCM API (`recruitingCEJobRequisitionDetails`).  
- We now **detect** `careers.oracle.com` vanity URLs and call that API directly → full description (~7k+ chars), location, salary, category, logo, years of experience.

**Safety rule**

- Direct `*.fa.oraclecloud.com` URLs: if the API says “nothing,” we mark **expired** (posting likely gone).  
- Vanity `careers.oracle.com`: if the API fails, we **fall back** to scrape.do instead of killing the listing.

**Tech notes**

- Code: `server/src/services/atsAdapters.ts`
- Key functions: `detectAts`, `fetchAtsJob`, `mapOracleCloud`, `detectAtsBoard`, `fetchAtsBoardJobs`
- Optional env: `ORACLE_CAREERS_HCM_HOST` (defaults to `eeho.fa.us2.oraclecloud.com`)

---

### 3.5 scrape.do (paid page fetch) + smart tier escalation

**What it does (functional)**  
When there is no ATS API, we ask **scrape.do** to download the job detail page HTML.

**Tiers (cost vs power)**

| Tier | What it does              | Rough cost | When used                         |
|------|---------------------------|------------|-----------------------------------|
| 1    | Plain HTML (no JS)        | ~1 credit  | Simple static pages               |
| 2    | Render JavaScript         | ~5 credits | SPAs that need the browser engine |
| 3    | Harder anti-bot + render  | ~25 credits| Sites that block cheaper tiers    |

**The problem we fixed (Apple-style meta teasers)**  

Some sites (Apple and others) return a **marketing one-liner** in HTML meta tags, like:

> “Apply for a Senior … job at Apple. Read about the role and find out if it’s right for you.”

Old behavior: we treated that as “good enough,” recorded tier 1 success, and never rendered the real page.  
Gemini then “AI-parsed” that thin text → Job board looked empty.

**New behavior (any company, not just Apple)**  

1. Detect short SPA / og:description **teasers** as junk.  
2. Mark the parse as **thin**.  
3. Automatically escalate to **tier 2+ (JS render)**.  
4. Remember the host’s successful tier in `maxun_scrape_profiles` so the next company with the same pattern upgrades itself.

**Tech notes**

- Client: `server/src/services/scrapeDoClient.ts` (`scrapeJobPage`, `isThinParse` / escalate)
- Quality rules: `server/src/services/jobPageParser.ts`  
  - `isJunkDescription`, `ROLE_TEASER_RE`, `STRONG_JD_SIGNAL_RE`, `descriptionQualityScore`
- Host learning: collection `maxun_scrape_profiles` (`tier`, `successes`, `avgCost`)

---

### 3.6 Job page parser

**What it does (functional)**  
Turns raw HTML (or JSON-LD / meta tags) into clean fields: title, company, description, location, salary, logo, etc.

**How it prefers sources**

1. JSON-LD `JobPosting` (best when present)  
2. Open Graph / meta tags  
3. HTML heuristics (main/article selectors)

It also:

- Rejects navigation chrome and marketing fluff  
- Normalizes salary ranges and locations  
- Keeps optional `_jobExperience` through merges so enrichment can save “3+ years”

**Tech notes**

- `parseJobPageHtml`, `mergeParsedFields`, `normalizeSalaryRange`, `htmlToPlainText`
- Tests: `jobPageParser.test.ts`

---

### 3.7 Gemini structuring (optional “AI-parsed”)

**What it does (functional)**  
After we have enough page text, Gemini can split it into:

- About  
- Minimum / preferred qualifications  
- Responsibilities  
- Benefits  
- Skills  

That’s what makes the Job board cards show labeled sections instead of one blob of text.

**Tech notes**

- `server/src/services/geminiJobExtractor.ts`
- Daily budgets: `LLM_DAILY_CALL_BUDGET`, `LLM_DAILY_TOKEN_BUDGET`
- Usage tracked in `maxun_llm_usage_budget`

---

### 3.8 Job board UI

**What it does (functional)**  
Users browse structured roles, filter by company/category, open a detail modal, and click Apply (opens the real company URL).

**What you see on a card / modal**

- Title, company, posted date  
- Location, salary, category (when enriched)  
- Description sections  
- Company logo (or initials fallback like **OR** if the logo URL is broken)  
- Pink **AI-parsed** chip when Gemini structured the row  

**Tech notes**

- UI: `src/components/jobs/JobBoardPage.tsx`
- API: `server/src/api/jobs.ts` (`GET /jobs`, `GET /jobs/:id`)
- Logo helper prefers stored `companyLogoUrl`, else brand favicon map / Google favicon guess

---

## 4. Two real case studies (what broke, how we fixed it)

### 4.1 Apple — “too few jobs” + thin descriptions

| Symptom | Cause | Fix |
|--------|--------|-----|
| Only ~60–68 Apple roles | Robot `maxPages: 3` × 20 jobs/page | Raise Max pages on the robot |
| Descriptions were one marketing sentence | scrape.do tier 1 + og:description accepted as success | Teaser detection → escalate to render (any host) |
| Host stuck on tier 1 | `maxun_scrape_profiles` learned wrong success | Reset profile; new logic won’t fake-succeed on teasers |

### 4.2 Oracle — “Apply page has everything, our modal doesn’t”

| Symptom | Cause | Fix |
|--------|--------|-----|
| ~650-char summary only | `careers.oracle.com` SPA; scrape.do never got full DOM | Detect vanity URL → call Oracle HCM detail API |
| No location / salary / quals | Same — only short summary stored | `mapOracleCloud` maps full API fields |
| Purple **OR** initials | Stored logo was a broken 16×16 HCM favicon | Prefer Oracle brand favicon URL |
| Risk of marking live jobs “expired” | ATS miss expired *all* Oracle detections | Expire only direct `*.fa.oraclecloud.com`; vanity falls back to scrape.do |

---

## 5. How to run the system locally

Typical processes:

| Command | Role |
|---------|------|
| `npm run start:dev` | API + frontend stack |
| `npm run worker:dev` | Scraper worker (list runs) |
| `npm run worker:enrichment:dev` | Detail enrichment worker |
| `npm run worker:scheduler:dev` | Schedules recurring robots |

Useful env vars (see `.env`):

- `SCRAPE_DO_TOKEN`, `SCRAPE_DO_DAILY_CREDIT_BUDGET`  
- `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_ENABLED`  
- `ORACLE_CAREERS_HCM_HOST` (optional override)  
- `JOB_ENRICHMENT_CONCURRENCY`, `JOB_ENRICHMENT_RATE_PER_MIN`

---

## 5.1 Scraper worker & Scheduler (how they work together)

Think of two different jobs:

| Role | Plain English | Process |
|------|----------------|---------|
| **Scheduler** | Alarm clock — “it’s time to run Apple again” | `npm run worker:scheduler:dev` |
| **Scraper** | Worker that actually opens the site and collects jobs | `npm run worker:dev` |

Both talk through a shared queue in MongoDB called **Agenda** (collections like `agendaJobs_local`).

### Scheduler — the alarm clock

1. Each robot can have a schedule: cron (`0 0 * * *` = daily) or interval (`every: 86400000` = every 24 hours).
2. On boot, the scheduler **rehydrates** all enabled robots into Agenda jobs named `schedule-triggers`.
3. When the alarm fires, it does **not** scrape. It only:
   - checks the robot still exists and schedule is still on,
   - skips if a run is already pending/running (single-flight),
   - creates a **Run** document (`source: scheduled`),
   - enqueues a **`scraper-jobs`** item for that `runId`,
   - updates `lastRunAt` / `nextRunAt` on the robot.
4. A **missed catch-up loop** periodically finds overdue robots and queues one catch-up run so a downtime gap doesn’t lose forever.

**Tech:** `server/src/schedule-worker.ts` → `server/src/services/automationScheduler.ts` → Agenda job `schedule-triggers`.

### Scraper — the actual collector

1. The scraper process registers for Agenda jobs named **`scraper-jobs`**.
2. When a job is claimed (manual run or scheduled), it typically:
   - forks a **child process** (so a hung browser can be killed),
   - tries **ATS board API** first when the start URL matches (Greenhouse, Oracle CE, etc.),
   - otherwise launches **Chromium/Playwright**, runs **list extraction** (pagination / Next button),
   - saves extracted rows and enqueues them for **job-board enrichment**.
3. On recoverable failures (CAPTCHA, nav errors), it can **requeue** the same `runId` with backoff.

**Tech:** `server/src/worker.ts` → `server/src/workers/scraperWorker.ts` → `listExtractor` / `fetchAtsBoardJobs`.

### How they connect (flow)

```
Robot schedule (cron / every)
        │
        ▼
 Scheduler fires  ──►  create Run  ──►  Agenda "scraper-jobs"
                                              │
                                              ▼
                                    Scraper worker picks it up
                                              │
                         ┌────────────────────┴────────────────────┐
                         ▼                                         ▼
                  ATS board API                          Browser list scrape
                  (no Chromium)                          (Playwright)
                         │                                         │
                         └────────────────────┬────────────────────┘
                                              ▼
                                   Job board enqueue (URLs)
                                              ▼
                                   Enrichment worker (details)
```

### Why they are often split into two processes

- Scheduler is light (no Chromium).
- Scraper is heavy (browsers, memory, timeouts).
- In production you often run:
  - scheduler with `SCHEDULER_ENABLED` on its process,
  - scraper with `SCHEDULER_ENABLED=false` so only one side owns alarms,
  - enrichment as a third process.

Manual “Run now” from the UI skips the alarm and goes straight to: create Run → enqueue `scraper-jobs` → scraper worker.

### How 4,000 daily companies get distributed (not all at once)

If you configure many robots (e.g. **4,000 companies, once per day**), the system is designed so they **do not all fire at midnight**.

**Why that matters**  
If 4,000 scrapers started together, Chromium / Agenda / Mongo / enrichment would stampede and most runs would fail or queue for hours.

**What we do instead**

1. **Daily presets are treated as intervals, not a shared clock**  
   Cron like `0 0 * * *` (“every day at 00:00”) is converted to **every 24 hours** from each robot’s own schedule time — not “everyone at midnight.”

2. **First start time is randomized inside the day**  
   On save/enable, each robot picks a random first fire somewhere in the next ~24h (at least ~1 minute from now).

3. **Then times are packed with a minimum gap**  
   The scheduler looks at other robots’ `nextRunAt` values and slides this robot’s start until it is at least **90 seconds** away from every other scheduled start (`MIN_AUTOMATION_GAP_MS = 90_000`).

   Rough capacity math for daily:

   - 24 hours = 86,400 seconds  
   - Gap = 90 seconds  
   - Theoretical slots ≈ 86,400 / 90 ≈ **960 starts per day** if only one fire at a time  
   - With scraper **concurrency > 1**, more can overlap in parallel, but starts are still staggered.

4. **After each run, the next run is “now + 24h” for that robot**  
   So Apple might always run around 03:12, Google around 11:40, etc. — spread across the day, repeating every day from their own anchors.

5. **Single-flight**  
   If a robot still has a pending/running run, the next schedule fire is skipped (no stacking duplicates).

6. **Catch-up after downtime**  
   If the scheduler was off, a sweep can enqueue overdue robots gradually (capped per sweep), not all at once.

**Practical note for ~4,000 robots**  
At a strict 90s gap, pure serial starts need more than one day of wall-clock to give every robot a unique slot. In practice:

- Scraper concurrency runs several jobs in parallel,
- enrichment is a separate worker,
- and some boards use ATS APIs (no browser).

Still, for thousands of companies, plan capacity: browser pool size, `SCRAPER_JOB_CONCURRENCY`, enrichment rate, and scrape.do credits. Packing spreads **start times**; it does not magically create infinite CPU.

**Tech:** `randomPreferredStartMs` + `findPackedNextRunAt` in `server/src/utils/schedule.ts`; packing called from `syncAutomationSchedule` in `automationScheduler.ts`.

### DigitalOcean memory — what uses RAM and why we recommend **4 GB**

Scout-X is not a tiny API-only app. On a DigitalOcean Droplet we typically run **several processes at once**, and the expensive one is **Chromium** (real Chrome used to scrape career sites).

#### What is running on the droplet (PM2)

From `ecosystem.config.cjs`:

| Process | Role | Approx Node heap / restart limit |
|---------|------|----------------------------------|
| `scout-x` | API + dashboard (no browser) | restart around **500 MB** |
| `scoutx-scheduler` | Alarms / Agenda schedules only | heap ~**256 MB**, restart ~**300 MB** |
| `scoutx-scraper` | Scrapes + **Chromium** | Node heap ~**512 MB**, restart ~**700 MB** — **plus browser RAM outside Node** |
| `scoutx-enrichment` | ATS / scrape.do / Gemini details | heap ~**512 MB**, restart ~**450 MB** |

Important: Chromium memory is **outside** Node’s `--max-old-space-size`. So even if Node is capped at 512 MB, one Chrome session can add **~300 MB–1 GB+** on its own.

#### Rough RAM budget (why 2 GB is tight and 4 GB is comfortable)

| Consumer | Typical use |
|----------|-------------|
| Ubuntu / system / SSH / logs | ~300–500 MB |
| API (`scout-x`) | ~150–400 MB |
| Scheduler | ~50–150 MB |
| Enrichment | ~100–400 MB |
| Scraper Node process | ~100–400 MB |
| **One Playwright Chromium** (concurrency 1) | **~400 MB–1 GB** (peaks higher on heavy SPAs: Apple, Oracle, Meta) |
| Headroom for spikes / GC / child-process fork | **~500 MB–1 GB** |

Add that up during an active scrape and you often sit around **2.5–3.5 GB used**. That is why:

- **512 MB / 1 GB droplets** → out-of-memory kills, Chromium crashes, PM2 restart loops  
- **2 GB** → workable only with `SCRAPER_WORKER_CONCURRENCY=1` and careful settings; little headroom  
- **4 GB (recommended)** → room for API + scheduler + enrichment + **one** Chromium scrape without constantly swapping or OOMing  

Official beginner guidance in-repo: prefer **Basic 4 GiB / 2 vCPU / ~80 GiB SSD** (~$24/mo); minimum **2 GiB** only if concurrency stays at 1.

#### Why we need ~4 GB (plain English)

1. **Chrome is heavy** — scraping is not “download HTML”; it runs a real browser.  
2. **We run 3–4 Node apps** on one machine (API, schedule, scrape, enrich).  
3. **Scrape child processes** can briefly double memory while forking.  
4. **Heavy career SPAs** (Apple, Oracle, etc.) hold more tabs/JS than a simple static page.  
5. **Headroom** — without it, Linux starts killing processes (`OOM killer`) and runs flip to failed / restart.

You do **not** buy 4 GB because of “4,000 companies” as a number. Companies are **scheduled over the day**. You buy 4 GB so that **whatever is running right now** (especially Chromium) does not crash the droplet.

#### How we save RAM on DO

- Chromium lives only in `scoutx-scraper` (not in the API).  
- Default ecosystem uses `SCRAPER_WORKER_CONCURRENCY=1` and `LOW_MEMORY_MODE=true` on the scraper (close browsers sooner, fewer pooled pages).  
- Enrichment uses scrape.do / ATS APIs — **no Chromium** there.  
- Scheduler has no browser at all.

#### When you might need more than 4 GB

- Raise scraper concurrency to **2+** (roughly +0.5–1 GB per concurrent Chromium).  
- Keep many idle browsers in a pool.  
- Run recording / live browser sessions plus scrapes on the same box.

**Rule of thumb:** start on **4 GB / concurrency 1**. Scale scrapes with schedule packing first; add RAM or a second scrape-only droplet only when concurrency needs to grow.

### DigitalOcean storage (SSD) — what disk you need

Storage is the Droplet’s **SSD disk** (not Mongo job data). Job listings live in **MongoDB Atlas** (cloud database). The Droplet disk mainly holds the app, browsers, and logs.

#### Recommended size

| Plan SSD | When |
|----------|------|
| **~50 GB** | Minimum (often bundled with 2 GB RAM Basic) — OK early on |
| **~80 GB** | **Recommended** with the 4 GB Basic plan — comfortable headroom |
| Extra Block Storage / huge disks | **Not needed** day one |

You do **not** need a Storage-Optimized Droplet. Scout-X is RAM-bound (Chromium), not disk-bound.

#### What uses disk on the Droplet

| Item | Rough size | Notes |
|------|------------|--------|
| Ubuntu OS + updates | ~3–6 GB | Base system |
| Node.js + system packages | ~0.5–1 GB | Runtime |
| Playwright **Chromium** browser binaries | ~0.4–1 GB | Installed via `npm run playwright:install` |
| Chromium OS libraries (`install-deps`) | ~0.2–0.5 GB | Shared libs for headless Chrome |
| App code + `node_modules` + build (`dist`) | ~1–3 GB | Repo under `/opt/scout-x` (typical) |
| PM2 / app **logs** (`LOGS_PATH`, e.g. `server/logs`) | grows over time | Biggest risk if never rotated |
| Browser **session state** files | small–medium | Cookies/login reuse per robot |
| Optional screenshots / crawl artifacts | can grow fast | Prefer offloading (see below) |
| Temp scrape files / OS cache | variable | Cleared over time |

**Typical steady use after install:** about **10–15 GB** used out of 50–80 GB. Plenty of free space remains.

#### What does *not* eat Droplet disk

- **Job board rows / company data** → MongoDB **Atlas** (separate product)  
- **Agenda queue jobs** → usually same Mongo  
- **Enrichment HTML** → fetched via scrape.do / ATS; not stored as full page dumps by default  

So adding 4,000 companies does **not** mean you need 4,000× more SSD on DigitalOcean. It means more Mongo usage in Atlas and more **RAM/CPU time** when scrapes run.

#### Optional: DigitalOcean Spaces

Use **Spaces** (S3-style object storage) later if you store many screenshots or large files. Keep the Droplet disk for the running app; put bulky media in Spaces so the SSD stays clean.

#### Why ~80 GB is enough (plain English)

1. The heavy thing is **Chrome in RAM**, not gigabytes of files.  
2. Scraped job text is saved in **Atlas**, not as huge files on the Droplet.  
3. 50–80 GB covers OS + Node + Chromium + app + months of normal logs.  
4. You pay DigitalOcean mainly for **RAM**, not for a giant disk.

#### Keep disk healthy

- Check usage: `df -h`  
- Watch log growth: PM2 logs + `LOGS_PATH`  
- Rotate / truncate old logs if disk climbs past ~70–80%  
- Don’t store unlimited full-page screenshots on the Droplet  
- Rebuild occasionally; remove unused Playwright browser versions if you upgrade often  

**Rule of thumb:** buy the **Basic 4 GB / ~80 GB SSD** plan for Scout-X. Increase disk only if logs/artifacts fill it — not because you added more company robots.

---

## 6. Key files (cheat sheet)

| Area | Path |
|------|------|
| List scrape | `server/src/services/listExtractor.ts` |
| Scraper worker | `server/src/workers/scraperWorker.ts` |
| Enqueue board rows | `server/src/services/jobBoardEnrichment.ts` |
| Enrichment worker | `server/src/workers/jobEnrichmentWorker.ts` |
| ATS / Oracle / boards | `server/src/services/atsAdapters.ts` |
| HTML quality / thin parse | `server/src/services/jobPageParser.ts` |
| scrape.do client | `server/src/services/scrapeDoClient.ts` |
| Gemini structuring | `server/src/services/geminiJobExtractor.ts` |
| Job board API | `server/src/api/jobs.ts` |
| Job board UI | `src/components/jobs/JobBoardPage.tsx` |
| Robot config UI | `src/pages/AutomationConfigPage.tsx` |

---

## 7. Mental model to explain to someone else

1. **List scrape** = “collect links from the search results.”  
2. **Enrichment** = “open each link properly and extract the real posting.”  
3. **Prefer APIs over scraping** when we know the ATS (cheaper, more complete).  
4. **scrape.do** = paid browser-as-a-service when there is no API.  
5. **Thin / teaser detection** = don’t trust fake “success” HTML; escalate automatically.  
6. **Job board** = the product surface where users browse the cleaned results.

If a new company looks “incomplete,” check in this order:

1. Did list scrape hit a **Max pages** cap?  
2. Is the detail URL a known **ATS** we should map?  
3. Did enrichment stop on a **meta teaser** (needs render)?  
4. Is the host profile stuck on a **wrong scrape.do tier**?  
5. Did Gemini budget pause structuring (description exists but sections empty)?

---

## 8. What “done” looks like for a good job row

A healthy enriched job usually has:

- Full `jobDescription` (hundreds to thousands of characters, not one marketing line)  
- `location`, and often `salaryRange` / `jobCategory`  
- Usable `companyLogoUrl`  
- `enrichment.method` of `ats`, `scrape.do`, or `llm`  
- Optionally structured arrays: responsibilities, qualifications, benefits  

Example (Oracle after the fix):

- Description length ~7,000+ characters  
- Location: Nashville, TN  
- Salary: `$92,500 – $209,500`  
- Method: `ats`  
- Real Oracle logo instead of initials  

---

*Document generated from the Scout-X / Maxun job pipeline work (list scrape, enrichment, thin-parse escalation, Oracle HCM vanity support). Update this file when we add new ATS providers or change enrichment rules.*
