# Hiring Cafe Enrichment Retry Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Hide incomplete Hiring Cafe jobs from the Job Board, retry soft enrichment up to 10 times with backoff, surface exhausted rows on Failure Dashboard.

**Architecture:** Reuse `scoutx-enrichment` + `maxun_job_board.status`. Add `hiringCafeEnrichmentPolicy.ts` for gate/backoff. Tighten quality + HC worker path. API + Failure Dashboard for exhausted requeue. One-shot backfill demotes false `ready` rows.

**Tech Stack:** TypeScript, Mongo/Mongoose, Express, React/MUI, existing enrichment worker.

---

### Task 1: Policy module (gate + backoff)
### Task 2: Wire HC enrichment worker
### Task 3: API list/requeue exhausted
### Task 4: Failure Dashboard UI section
### Task 5: Backfill script + default max attempts
