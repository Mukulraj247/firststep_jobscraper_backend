# Process Isolation (PM2 Option 1)

**Date:** 2026-08-08  
**Status:** Implemented  
**Product:** Scout-X collection path on DigitalOcean

## Problem

API, scheduler, and Chromium scrapers previously shared one Node process (`RUN_EMBEDDED_WORKERS=true` inside `scout-x`). A Chromium OOM or uncaught scrape failure could take down the dashboard and stop schedule firing, not just the one job.

## Goal

Isolate Chromium from the API on a single droplet using existing code paths — no queue rewrite.

## Topology

| PM2 app | Process | Chromium? |
|---------|---------|-----------|
| `scout-x` | `npm run server` with `RUN_EMBEDDED_WORKERS=false` | No |
| `scoutx-scraper` | `npm run worker` ([`server/src/worker.ts`](../../server/src/worker.ts)) | Yes |
| `scoutx-enrichment` | `npm run worker:enrichment` | No |

All coordinate through MongoDB (Agenda). Agenda job locks prevent double-processing if two scrapers are ever misconfigured.

```
Extension / Dashboard → scout-x (API)
                              ↓
                         MongoDB / Agenda
                              ↑
                    scoutx-scraper (Chromium)
                    scoutx-enrichment (scrape.do / ATS)
```

## Failure modes

| Failure | Effect |
|---------|--------|
| Scraper Chromium OOM | PM2 restarts `scoutx-scraper` only; API stays up; Agenda re-delivers in-flight jobs after lock expiry |
| API crash | Dashboard down until restart; scrapes/schedules continue on scraper process |
| Forgot to start `scoutx-scraper` | Runs stay `pending` forever — check `pm2 status` |
| Both API embedded=true AND scraper running | Wastes RAM; Agenda locks still serialize jobs |

## Operator checklist

1. After deploy: `pm2 status` shows three **online** apps.
2. `pm2 logs scout-x` contains `Embedded workers disabled for this API process`.
3. `pm2 logs scoutx-scraper` contains `Worker runtime started`.
4. Manual run completes; Chromium RSS lives under the scraper PID, not the API.
5. Optional: stop `scoutx-scraper` briefly — API still serves HTTP; restart scraper → pending work resumes.

## Local development

- `npm run start:dev` may keep `RUN_EMBEDDED_WORKERS=true` (single process).
- To mirror production locally: set `RUN_EMBEDDED_WORKERS=false` and run `npm run worker:dev` in a second terminal.

## Scale later

Add another droplet (or PM2 instance) running only `scoutx-scraper` against the same `MONGODB_URI`. Cap each process with `MONGODB_MAX_POOL_SIZE` (default 10) so N workers do not exhaust Atlas connections.

## Non-goals (this pass)

- Dedicated scheduler-only process (option 2)
- Hard cancellation, backoff, circuit breaker
- BullMQ / Redis
