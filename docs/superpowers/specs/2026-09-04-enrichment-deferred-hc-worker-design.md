# Deferred career parking + dedicated HC enrichment worker

**Date:** 2026-09-04  
**Status:** Approved (option A) + implemented  
**Problem:** ~5k career free-path misses stayed `queued`/`failed` with scrape.do errors, starved Hiring Cafe enrichment (`enriching: 0`).

## Design

1. **`status: deferred`** on the same `maxun_job_board` collection for career ATS/HTML misses.
   - `enrichment.needsPaidPath: true`
   - `enrichment.lastError: career_free_path_miss` (or host-skip variant)
   - Active claim filters remain `status: queued` only → deferred leaves the live drain.

2. **Split PM2 workers** (same `enrichmentWorker.js`, env gate):
   - `scoutx-enrichment` → `JOB_ENRICHMENT_SOURCE_MODE=career`
   - `scoutx-enrichment-hc` → `JOB_ENRICHMENT_SOURCE_MODE=hiring_cafe`

3. **Migration:** `parkCareerFreePathMissesToDeferred.js` parks existing thrash rows.

4. **Monitor:** Enrichment tab shows Deferred KPI + per-class deferred counts.

## Non-goals

- New Mongo collection
- Paid career scrape.do worker (deferred is the holding bay)
- Chromium in enrichment
