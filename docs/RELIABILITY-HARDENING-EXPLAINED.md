# Scout-X Reliability Hardening — What Broke and How We Fixed It

This note explains, in plain language, the reliability problems we found in Scout-X’s career-page collection pipeline and what we changed to fix them.



1. **Mechanical reliability track** — silent failures → process isolation → hard cancel → backoff → browser recycle → missed schedules → graceful deploy → DNS.
2. **Phase 1 scale blockers** — schedule clustering → soft anomalies looking green → brittle selectors → filter URL survival → free-tier env trap.
3. **Phase 2 ATS collection** — public board JSON before Chromium for Greenhouse / Lever / Ashby / SmartRecruiters.
4. **Phase 3 mechanical gaps** — dead-letter status → orphan Chromium reaper on worker → RSS pool recycle → heartbeat leases → dedicated scheduler process.

---



## The big picture

Scout-X visits company career pages on a schedule, extracts job listings, and feeds them into enrichment. At a small scale (dozens of companies), you notice when something breaks. At thousands of companies per day, **silent failures** and **fragile process design** quietly lose data while the dashboard still looks “green.”

The work below is about one rule:

> **If something fails, we should notice it, recover from it, and not take the whole system down with it.**

---



## 1. Silent “success” when a page returns zero jobs



### The problem

Sometimes the scraper opened the career page fine but found **zero job rows** — often because the company redesigned the page and our CSS selectors no longer matched.

The run was still marked **completed / success**. Logs might say “selectors probably broke,” but alerts, webhooks, and the UI treated it like a good run. At scale, a company can go dark for weeks while everything looks healthy.

There was also no check like: “yesterday this robot found 200 jobs; today it found 20.”

### How we fixed it

We added **run drift detection**:

- **Zero rows** after a previously non-empty baseline → hard **failure** (not success). No pointless retries that would “succeed” with zero again.
- **Large drop** vs recent good runs (about 80% fewer rows) → soft **anomaly** flag; if it happens repeatedly, escalate to failure.
- Ops digest / UI / webhooks can surface these so humans notice.

**In short:** empty or suspiciously thin extracts are no longer celebrated as success.

*Spec:* `docs/superpowers/specs/2026-08-07-run-drift-detection-design.md`

---



## 2. One process doing everything (API + scrapes + Chromium)



### The problem

API, scheduler, and Chromium scrapes often lived in **one Node process**. When Chromium ate memory or a scrape crashed hard, it could take down the **whole app** — dashboard and schedules included.

### How we fixed it

We split production into separate PM2 apps:


| Process             | Job                                      |
| ------------------- | ---------------------------------------- |
| `scout-x`           | API / dashboard only (no Chromium)       |
| `scoutx-scraper`    | Schedules + scrape jobs                  |
| `scoutx-enrichment` | Downstream enrichment (already separate) |


**In short:** a bad scrape should hurt the scraper, not the website users hit.

*Spec:* `docs/superpowers/specs/2026-08-08-process-isolation-pm2-design.md`

---



## 3. Soft timeouts that never really kill Chromium



### The problem

A scrape could “time out” in software while Chromium kept running — burning CPU and RAM. Soft cancels don’t always stop a stuck browser.

### How we fixed it

By default each scrape runs in a **child process**. When the time budget expires, we **force-kill** that child (and its browser tree). The parent worker stays up.

**In short:** a hung page can’t hold the worker hostage forever.

*Spec:* `docs/superpowers/specs/2026-08-08-hard-cancel-child-process-design.md`

---



## 4. Instant retries hammering a broken or blocking site



### The problem

Failed scrapes often retried **immediately**. If a careers host was down or blocking us, we burned all attempts in seconds, made the block worse, and wasted fleet capacity.

### How we fixed it

- **Backoff with jitter** between retries (roughly 30s → 2m → 10m, slightly randomized so robots don’t all retry in sync).
- **Per-host circuit breaker:** after enough recent failures for one hostname, we **pause** that host for a cooldown instead of hammering it.

**In short:** give sick sites room to breathe; don’t spend the whole day punching a locked door.

*Spec:* `docs/superpowers/specs/2026-08-08-scrape-backoff-circuit-breaker-design.md`

---



## 5. Browsers that live too long and get “sick”



### The problem

Reusing a Chromium **process** across many jobs can slowly leak memory or leave a broken browser for the next job. Closing only a page isn’t enough if the whole browser is unhealthy.

### How we fixed it (lean approach)

- Retire a pooled browser after **N page leases** (default 20) or **max age** (default 15 minutes).
- On serious errors / timeouts → **evict the whole browser**, not just the tab.
- Low-memory mode stays aggressive (close after each job).

With child-per-scrape in production, browsers already die with the child; this still matters for in-process debug and reuse inside a job.

**In short:** don’t keep driving a car that started smoking — get a new one.

*Spec:* `docs/superpowers/specs/2026-08-08-browser-lifecycle-recycle-design.md`

---



## 6. Missed schedules during downtime



### The problem

If the scheduler was down at the exact minute a daily (or interval) scrape should fire — deploy, crash, reboot — Agenda often **skips that fire**. The company simply doesn’t get scraped until the *next* tick. Downtime became **lost data**, not delayed data.

### How we fixed it

A **catch-up sweep** on worker start and every couple of minutes:

- Find robots that are overdue (past due + a short grace window).
- If they don’t already have a run in progress, enqueue **one** catch-up scrape.
- Don’t enqueue every missed day as a stampede (one catch-up per robot per pass).

**In short:** after the lights come back on, we still pick up what we owed — once, not a flood.

*Spec:* `docs/superpowers/specs/2026-08-08-missed-schedule-catchup-design.md`

---



## 7. Hard kills on deploy (orphaned “running” jobs)



### The problem

Deploy / memory restart often sent SIGTERM and cut mid-scrape. Jobs could sit as **running** for a long time (Agenda locks up to ~10 minutes). Recovery was slow and messy. The API didn’t even handle SIGTERM the same as Ctrl+C in some paths.

### How we fixed it

- **Drain:** stop taking new jobs, wait up to ~90s for in-flight scrapes to finish, then unlock and exit.
- Kill leftover scrape **child processes** on the way out.
- Shorter Agenda **lock lifetime** for scraper jobs so hard crashes recover faster.
- Recover orphaned `running` runs when the **scraper worker** boots (not only the API).
- PM2 `kill_timeout` long enough for the drain window.

**In short:** deploys try to finish what’s cooking; if they can’t, the next cook picks up the ticket quickly.

*Spec:* `docs/superpowers/specs/2026-08-08-graceful-drain-design.md`

---



## 8. Hardcoded public DNS (Google / Cloudflare)



### The problem

At startup, Node was forced to resolve every hostname only via `8.8.8.8` and `1.1.1.1`. On some clouds that’s fine; on others (or if those resolvers are blocked/throttled) **everything** fails at once — database, scrapes, APIs — looking like a total outage.

### How we fixed it

- **Default:** use the operating system / droplet DNS (normal behavior).
- **Optional:** set `DNS_SERVERS=8.8.8.8,1.1.1.1` only if you need public resolvers (e.g. some local Windows Atlas SRV quirks).

**In short:** trust the network you’re actually on, unless you explicitly opt out.

*Spec:* `docs/superpowers/specs/2026-08-08-configurable-dns-design.md`

---



## 9. All “daily” robots firing at midnight together



### The problem

Short presets (“every 15 minutes”, “every hour”) were already turned into true intervals and **hash-staggered** per robot so they didn’t all land on the same clock tick.

But **Every day / Every week / Every month** stayed as wall-clock cron (`0 0 * `* *, etc.). At 4,000 companies, that means a stampede at midnight: you need far more concurrent Chromium slots for one minute than you need for the rest of the day.

### How we fixed it

Those calendar presets now take the **same interval path** as the short ones:

- Daily → `1 day`, weekly → `1 week`, plus 2-day / 3-day / ~30-day mappings.
- First fire (and rehydrate) spreads across the interval using a hash of the automation id — same pattern as 15-minute jobs.
- Free-form custom crons (e.g. “weekdays at 9:00”) stay wall-clock on purpose.

**In short:** daily scrapes are still roughly once a day — they just don’t all ring the doorbell at once.

*Code:* `server/src/utils/schedule.ts`, `src/constants/scheduleOptions.ts`, `server/src/queue/scraperQueue.ts`

---



## 10. Soft row drops still looked like success



### The problem

Drift already marked big drops as `anomaly: 'row_drop'` on the run, but the live socket still emitted `run-completed` with `status: 'success'`. Soft drops also skipped webhooks (`shouldWebhook: false`).

So the dashboard toast said “success,” and downstream listeners that only watch socket status never woke up — even though the run was thin compared to yesterday.

### How we fixed it

- Soft `row_drop` now emits socket `status: 'anomaly'` (failed stays `failed`; healthy stays `success`).
- Soft drops **do** fire webhooks so external alerts can see them.
- Main page / runs table show a **warning** notification for anomalies, not a green success toast.

**In short:** “fewer jobs than usual” is yellow, not green.

*Code:* `server/src/services/runDrift.ts`, `server/src/workers/scraperWorker.ts`, dashboard socket handlers

---



## 11. One brittle CSS selector per field (no fallback)



### The problem

Career portals often redeploy with **hashed class names**. The extension saved a single CSS selector per field; the backend used it as-is. When markup shifted, the robot returned zero or thin rows — which feeds issues 1 and 10.

There was a smart-extractor fallback only when the whole list returned empty or the robot was URL-only — not “try a safer alternate for this field.”

### How we fixed it

- Field (and item) selectors may be a **ranked list**: try primary, then fallbacks, until a meaningful value (or matching items) appears.
- On save, the extension attaches structural / CSS-module-stripped variants so the backend has something to try.
- If a non-primary selector wins for **≥50%** of non-empty extractions values, we **promote** it to primary in the robot’s saved config (light self-heal — no LLM rewrite).

**In short:** when Amazon swaps class hashes, we don’t only fail — we try the next selector and remember what worked.

*Code:* `server/src/services/listExtractor.ts`, extension `backendApi.ts` `buildFieldMap`

---



## 12. Filters that never made it into the scheduled URL



### The problem

Scheduled runs only navigate to `recording_meta.url` / `startUrl`. If someone filtered a careers board **in the browser** without the URL changing (client-side SPA filters), the headless run scraped the **unfiltered** page — wrong set, still looked like a “successful” scrape.

### How we fixed it (honest, not magic)

- At list preview (`LIST_SELECTED`), we snapshot `previewUrl` = the page URL at that moment.
- On Send to Scout-X, that snapshot becomes the scheduled `startUrl` (and is stored under `saasConfig.previewUrl`).
- The side panel shows the URL that will be used and warns: **filters that don’t change the URL may not apply on scheduled runs.**

We do **not** replay click-filters in headless yet — if the filter isn’t in the URL, humans need to know.

**In short:** we scrape the URL you validated — and we tell you when filters can’t travel with it.

*Code:* extension `content/index.ts`, `messageRouter.ts`, `ListExtractorTool.tsx`; `server/src/api/automations.ts`

---



## 13. Accidentally running free-tier scraper settings in production



### The problem

Render free-tier config uses things like `SCRAPER_MAX_ATTEMPTS=1`, concurrency 1, Node heap ~192MB, low-memory mode. DigitalOcean PM2 is much saner. If those free-tier values quietly ship to a production droplet, you get **one attempt**, tiny memory, and brittle behavior — while thinking you’re on the DO setup.

### How we fixed it

On scraper **worker boot**, we detect that fingerprint (`SCRAPER_MAX_ATTEMPTS=1` + `LOW_MEMORY_MODE` + `NODE_OPTIONS` max-old-space ≤ 256) and log a loud error asking you to confirm production uses the DigitalOcean PM2 env, not free-tier knobs.

**In short:** if you’re flying a toy plane settings on a real route, the logs yell at you.

*Code:* `server/src/utils/prodEnvGuard.ts`, `server/src/worker.ts`

---



## 14. Paying Chromium + proxy for ATS boards that already expose JSON



### The problem

A large share of F500 / growth companies post jobs on a handful of ATS platforms (Greenhouse, Lever, Ashby, SmartRecruiters, …). Those platforms already publish **public job-board JSON**. We still launched Chromium, burned residential proxy bandwidth, and risked CAPTCHAs — then, separately, used ATS APIs only at **detail enrichment** time.

### How we fixed it

**ATS-first collection** on the scrape path:

1. Before proxy / Chromium identity selection, detect whether `startUrl` is a known ATS **board** (or a job URL that embeds the board token).
2. Fetch the public list API and map rows to the same shape as list extraction (`jobUrl` / `title` / `company` / …).
3. Run the same drift → persist → webhook → socket finalize path, with `extractionMethod: 'ats_board'`.
4. If detection misses, the API is empty, or the fetch errors → **fall through** to the existing browser list extractor (no behavior change for custom career sites).
5. Opt out per robot with `saasConfig.preferAtsCollection: false` (default is on).

**In short:** when the board already hands us every posting as JSON, we don’t open a browser just to scrape HTML.

*Code:* `server/src/services/atsAdapters.ts` (`detectAtsBoard`, `fetchAtsBoardJobs`), `server/src/workers/scraperWorker.ts` (`tryAtsBoardCollection`)

---



## 15. Exhausted scrapes looked like ordinary failures



### The problem (plain English)

When a scrape burned through all retries (CAPTCHA, timeouts, crash recovery), the run stayed `failed`. Ops and the UI could not tell “retry later” failures from **dead letters** that will never run again without human action.

### How we fixed it

Terminal exhaustion now sets `run.status = 'dead'` with a clear `errorMessage`. Ops digest counts dead runs separately; the runs table shows a **Dead** chip.

*Code:* `scraperWorker.ts` (`markFailed(..., 'dead')`), `orphanRunRecovery.ts`, `opsDigest.ts`, `ColapsibleRow.tsx`

---



## 16. Orphan Chromium only reaped on the embedded API path



### The problem

The periodic killer for leftover `chrome-headless-shell` processes started from the API’s embedded-worker boot. On DigitalOcean PM2, Chromium lives in `scoutx-scraper` — so orphans there were never reaped on a timer.

### How we fixed it

`startOrphanChromiumReaper()` / `stopOrphanChromiumReaper()` now run from `worker.ts` boot and shutdown (alongside the existing embedded path).

*Code:* `server/src/worker.ts`, `server/src/services/browserProcess.ts`

---



## 17. Browser pool kept growing while process RSS climbed



### The problem

Idle TTL and max-jobs/age caps recycled individual browsers, but under memory pressure the **whole pool** could still sit around while Node RSS climbed past a safe ceiling.

### How we fixed it

Env `BROWSER_POOL_RSS_LIMIT_BYTES` (default ≈ 1.2 GiB). On the cleanup loop and before reuse, if `process.memoryUsage().rss` is at/over the limit, **all** pooled browsers are retired (one log per sweep).

*Code:* `memoryMode.ts` (`shouldRetirePoolForRss`), `browserReusePool.ts`

---



## 18. Stuck `running` runs waited on blunt crash recovery



### The problem

After a hard kill, orphan recovery treated every `running` row as reclaimable immediately (or waited on coarse heuristics). A live worker on another process could lose a lease, and jobs that died before any progress signal were ambiguous.

### How we fixed it

Lean **heartbeat lease**: while a scrape is live, stamp `run.heartbeatAt` every `SCRAPE_HEARTBEAT_MS` (default 30s) and touch Agenda `lockedAt` when a job handle exists. Orphan recovery reclaims `running` only when the heartbeat is older than `SCRAPE_HEARTBEAT_STALE_MS` (default 2m), or missing and `startedAt` is older than that window.

*Code:* `scrapeHeartbeat.ts`, `scraperWorker.ts`, `orphanRunRecovery.ts`, `Run.ts`

---



## 19. Schedules shared a process with Chromium



### The problem

Agenda schedule triggers, catch-up, and ops digest ran inside the same `npm run worker` process as scrapes. A Chromium OOM or scrape storm could delay or take down scheduling.

### How we fixed it

Dedicated `schedule-worker` runtime (DB → schedule worker → rehydrate → catch-up → ops digest; **no** scraper / Chromium). PM2 app `scoutx-scheduler` runs `npm run worker:scheduler`. Scraper app sets `SCHEDULER_ENABLED=false`. Unset / true keeps lone `npm run worker` backward-compatible (schedules still work in one process).

*Code:* `schedule-worker.ts`, `worker.ts` + `schedulerEnabled.ts`, `ecosystem.config.cjs`, `package.json` `worker:scheduler`

---



## What this means day-to-day


| Before                                        | After                                                |
| --------------------------------------------- | ---------------------------------------------------- |
| Zero jobs could look like success             | Zero / big drops are flagged or failed               |
| One crash could take down API + scrapes       | Scrapes isolated in their own process                |
| Timeouts left Chromium spinning               | Child process is hard-killed                         |
| Failures retry instantly and pile on          | Backoff + host circuit breaker                       |
| Browsers age badly                            | Lifetime caps + error eviction                       |
| Downtime skips a schedule forever             | Catch-up sweep enqueues overdue robots               |
| Deploy hard-cuts mid-job                      | Drain window + faster orphan reclaim                 |
| DNS forced through two public IPs             | System DNS by default                                |
| All daily robots hit midnight together        | Daily/weekly presets hash-spread across the day      |
| Soft row drops toasted as success             | Socket `anomaly` + warning UI + webhook              |
| One CSS selector, then silence                | Ranked fallbacks + promote what works                |
| SPA filters lost on schedule                  | Preview URL saved; warn if filters aren’t in the URL |
| Free-tier env could sneak into prod           | Worker boot warns on that fingerprint                |
| Chromium for every Greenhouse/Lever board     | Public ATS JSON first; browser only as fallback      |
| Exhausted retries looked like normal `failed` | `dead` status + ops digest + UI chip                 |
| Orphan Chromium reaper only on embedded API   | Reaper on dedicated scraper worker too               |
| Pool ignored process RSS pressure             | RSS ceiling retires all pooled browsers              |
| Crash reclaim stole live leases               | Heartbeat lease; reclaim only when stale             |
| Schedules shared RAM with Chromium            | `scoutx-scheduler` process; scraper schedule-off     |


---



## What we deliberately did *not* do (yet)

These are later phases on the master plan — not forgotten:

- Chrome extension slim-down (remove in-browser multi-page / table / text / datatable / live socket)
- Workday / iCIMS board APIs (Phase 2 covers Greenhouse, Lever, Ashby, SmartRecruiters first)

---



## Where to look in code / config

**Reliability track**

- Drift: `server/src/services/runDrift.ts`
- PM2: `ecosystem.config.cjs`
- Child scrape: `server/src/workers/scrapeJobSupervisor.ts`
- Backoff / breaker: `server/src/services/scrapeBackpressure.ts`
- Browser pool: `server/src/services/browserReusePool.ts`
- Schedule catch-up: `server/src/services/automationScheduler.ts`
- Drain: `drainAndCloseAgenda` in `server/src/queue/scraperQueue.ts`
- DNS: `server/src/utils/dnsConfig.ts` (`DNS_SERVERS`)

**Phase 1 scale blockers**

- Schedule stagger: `server/src/utils/schedule.ts` (`INTERVAL_CRON_TO_MS`)
- Soft anomaly socket: `server/src/workers/scraperWorker.ts` + `runDrift.ts`
- Ranked selectors: `server/src/services/listExtractor.ts`
- Preview URL: extension list save path + `automations.ts` `previewUrl`
- Prod env guard: `server/src/utils/prodEnvGuard.ts`

**Phase 2 ATS collection**

- Board detect/fetch: `server/src/services/atsAdapters.ts`
- Pre-browser hook: `tryAtsBoardCollection` in `scraperWorker.ts`

**Phase 3 mechanical gaps**

- Dead letter: `markFailed(..., 'dead')` in `scraperWorker.ts` / `orphanRunRecovery.ts`
- Chromium reaper on worker: `worker.ts` + `browserProcess.ts`
- RSS recycle: `memoryMode.ts` / `browserReusePool.ts` (`BROWSER_POOL_RSS_LIMIT_BYTES`)
- Heartbeat lease: `scrapeHeartbeat.ts`, `Run.heartbeatAt`
- Scheduler process: `schedule-worker.ts`, `SCHEDULER_ENABLED`, PM2 `scoutx-scheduler`

Useful env knobs are commented in `.env` / `ENVEXAMPLE` (drain, catch-up, browser pool, retry delays, DNS).

---

*Last updated: 2026-08-08 — reliability track (§1–8) + Phase 1 (§9–13) + Phase 2 ATS (§14) + Phase 3 mechanical (§15–19).*