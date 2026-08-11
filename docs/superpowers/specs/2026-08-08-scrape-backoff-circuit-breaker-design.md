# Scrape Backoff + Per-Host Circuit Breaker

**Date:** 2026-08-08  
**Status:** Implemented  
**Product:** Scout-X collection (Agenda scraper)

## Problem

Failed scrapes were re-queued immediately, burning attempt budgets and hammering down/blocking hosts.

## Solution

1. **Delayed requeue** via Agenda `job.schedule(when)` — bases ~30s / 2m / 10m with ±20% jitter.
2. **Per-host circuit breaker** (in-memory per worker) — 5 failures in 120s opens a 600s cooldown; jobs for that host park without burning attempts.

## Files

| File | Role |
|------|------|
| `server/src/services/scrapeBackpressure.ts` | Delay math + host breakers |
| `server/src/queue/scraperQueue.ts` | `delayMs` on enqueue/requeue |
| `server/src/workers/scraperWorker.ts` | Pre-check park; record success/fail; delayed retries |

## Env

- `SCRAPE_RETRY_DELAYS_MS=30000,120000,600000`
- `SCRAPE_RETRY_JITTER_RATIO=0.2`
- `SCRAPE_HOST_BREAKER_THRESHOLD=5`
- `SCRAPE_HOST_BREAKER_WINDOW_MS=120000`
- `SCRAPE_HOST_BREAKER_COOLDOWN_MS=600000`

## Non-goals

Shared Redis breaker across droplets; enrichment changes (already has backoff).
