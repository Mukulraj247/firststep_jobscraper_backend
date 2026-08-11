# Hard Cancellation via Child Process per Scrape

**Date:** 2026-08-08  
**Status:** Implemented  
**Product:** Scout-X Agenda scraper worker

## Problem

`Promise.race([work, timeout])` does not cancel the scrape. Chromium can keep scrolling after the timeout fires, starving the worker under load.

## Solution

Each Agenda `scraper-jobs` handler forks a disposable Node child (`scrapeJobChild`). The parent waits for IPC `result` or exit. On `SCRAPER_JOB_TIMEOUT_MS`, the parent **SIGKILLs the child process tree** (Linux process group / Windows `taskkill /T`) and marks the run failed.

```
Agenda (parent scoutx-scraper)
  → fork scrapeJobChild
       → connectDB + runScraperJobPayload (Chromium lives here)
  ← IPC socket events (parent forwards to Socket.IO)
  ← IPC result / exit
  timeout → kill tree → run status=failed
```

## Kill switch

- `SCRAPE_JOB_CHILD_PROCESS=false` — run in-process with legacy Promise.race + forceCleanup
- Default: isolation **on**
- Inside child: `SCRAPE_JOB_CHILD=1` (set by supervisor)

## Files

| File | Role |
|------|------|
| `scrapeJobSupervisor.ts` | fork, timeout, kill tree, socket forward |
| `scrapeJobChild.ts` | child entry |
| `scrapeSocket.ts` | IPC vs direct Socket.IO emit |
| `scraperWorker.ts` | `runScraperJobPayload` + Agenda wiring |

## Trade-off

Browser reuse pool is per-child (per job), not across jobs. Acceptable for killability.

## Operator notes

Concurrency × ~1 GB must fit droplet RAM. If scrapes die immediately, check child logs and that `server/dist/.../scrapeJobChild.js` exists after `npm run build:server`.
