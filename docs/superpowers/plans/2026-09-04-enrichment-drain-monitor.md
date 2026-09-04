# Enrichment Drain + Monitor Implementation Plan

> **For agentic workers:** Use executing-plans / implement inline. Checkboxes track status.

**Goal:** Unblock career enrichment (free ATS/HTML only), maximize free-path coverage for the queued pile, keep Scrape.do for Hiring Cafe only, and ship a dedicated Enrichment monitor tab.

**Architecture:** Fix `runEnrichmentPass` so daily Scrape.do budget never stops claiming. Expand free `detectAts` coverage (TalentBrew/Radancy `/en/job/` + host directory). Raise PM2 enrichment concurrency. Expose `GET /api/enrichment/metrics` and sidebar `/enrichment`.

**Spec:** `docs/superpowers/specs/2026-09-04-enrichment-drain-monitor-design.md`

**Status:** Implemented in-repo (2026-09-04). Deploy: rebuild server + frontend, restart `scoutx-enrichment` (+ API) so ecosystem concurrency 10/24 applies.

---

## Completed

- [x] Task 1: Budget no longer blocks career claims; idle sleep not 60s on budget alone; concurrency 10 / batch 24
- [x] Task 2: TalentBrew job-detail detect + hosts (`commonspirit.careers`, `santandercareers.com`, `jobs.intuit.com`, `careers.moodys.com`)
- [x] Task 3: `recoverFreePathSkipFailures` for `career_scrape_do_disabled` / `SCRAPE_DO_TOKEN_missing` / budget stalls
- [x] Task 4: `GET /api/enrichment/metrics`
- [x] Task 5: Enrichment sidebar tab `/enrichment`
- [x] Unit test: TalentBrew/Radancy job detail → `careerhtml`

## Deferred (P2)

Rippling, ADP PhenomPeople, Goldman Higher — use Enrichment tab top hosts after deploy.
