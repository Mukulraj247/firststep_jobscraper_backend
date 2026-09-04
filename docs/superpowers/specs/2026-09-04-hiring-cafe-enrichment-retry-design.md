# Hiring Cafe Enrichment Retry & Board Visibility

**Date:** 2026-09-04  
**Status:** Approved

## Problem

Hiring Cafe list scrape enqueues thin board rows. Detail enrichment sometimes fails (Cloudflare, Scrape.do, junk JD). Incomplete rows were still promoted to `ready` and shown on the Job Board (e.g. comma-separated skills as description, no real apply URL).

## Goals

1. Job Board shows only successfully enriched Hiring Cafe jobs (`status: ready` + quality gate).
2. Incomplete URLs stay in Mongo as `queued` / `partial` and retry in the background.
3. Soft path only: reuse `scoutx-enrichment` (HTTP → Scrape.do). No new PM2 worker. No Chromium.
4. Max **10 attempts total** per listing (not 10/day). Backoff spaces attempts, then stop.
5. Exhausted rows appear on Failure Dashboard with manual requeue.

## Non-goals

- New worker / Agenda queue for enrichment
- Chromium in enrichment (`HIRING_CAFE_ENRICH_BROWSER_ENABLED` stays false)
- Scraping employer JD pages beyond HC detail / apply URL extraction
- Changing aggregator list scrape topology

## Data flow

```
Aggregator (list) → maxun_job_board status=queued (hidden)
                 → scoutx-enrichment HTTP/Scrape.do
                 → ready (visible) | queued+backoff | partial exhausted (Failure Dashboard)
```

## Retry policy

- `JOB_ENRICHMENT_MAX_ATTEMPTS` = 10 for Hiring Cafe (or global if simpler).
- Backoff after attempt *n* fails: 15m, 1h, 3h, 6h, 12h, then ~24h for remaining until 10.
- Hard stop at attempt 10 → `status: partial`, `lastError: hiring_cafe_enrichment_exhausted`.
- Manual Failure Dashboard requeue → `status: queued`, attempts reset to 0, lease cleared.

## Quality gate (Hiring Cafe → ready)

All required:

1. Non-generic title
2. Company name
3. Real JD (reject junk / skills-comma dumps)
4. Real employer apply URL (not only `hiring.cafe/job/...`)

Failing the gate after a scrape counts as a soft fail (retry), not board-visible `ready`.

## Visibility

- Job Board API continues to list only `status: ready` (already the case).
- Tighten promote-to-ready and backfill demote false `ready` HC rows that fail the new gate.

## Failure Dashboard

- Surface `source=hiring_cafe` rows with exhausted enrichment (`partial`/`failed`, attempts ≥ 10).
- Fields: title/slug, URL, attempts, lastError, last tried.
- Action: Requeue.

## Backfill

On deploy / one-shot script: demote HC `ready` rows that fail the new gate → `queued`, `attempts: 0`.

## CPU / cost constraints

- No new processes
- Existing rate limit + Scrape.do credit budget
- Timed backoff prevents tight retry loops
