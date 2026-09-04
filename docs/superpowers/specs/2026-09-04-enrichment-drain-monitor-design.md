# Enrichment drain + Enrichment monitor tab

**Date:** 2026-09-04  
**Status:** Approved + expanded free-path coverage (pending implement)  
**Goal:** Drain the job-board enrichment backlog so career jobs become board-ready via **as many free paths as possible** (ATS / Phenom / TalentBrew / HTML / JSON-LD / …), keep Scrape.do for Hiring Cafe only, and add a dedicated Enrichment sidebar tab to verify the drain is working.

---

## Problem

1. **Dashboard “Jobs added” ≫ Job board “Last 6h”** partly because many new listings stay `status: queued` until enrichment finishes.
2. Live Mongo (2026-09-04): ~3.7k queued, ~3.7k with `attempts: 0`, only ~2 enriching. Vast majority are career (`source: ""`), not HC.
3. Scrape.do daily budget was nearly exhausted (~14.4k / 15k). The enrichment worker **early-returns the entire pass** when the budget is hit, which incorrectly stops **free** career ATS/HTML/Phenom work.
4. Career enrichment must never depend on Scrape.do. Credits are an HC concern only.

---

## Goals

| Goal | Success signal |
|------|----------------|
| Career uses free paths only | No career row spends Scrape.do credits; method ∈ `{ats, list, none, browser?}` never `scrape.do` for empty/`career` sources |
| HC may use Scrape.do | Unchanged HC pipeline; budget gates **only** scrape.do calls |
| Budget exhaustion does not block career | When credits ≥ budget, career queue still drains; HC scrape.do skipped / deferred |
| Drain is visibly faster | Queued due-now declines; enriching > 0 under load; ready last 1h/6h rises |
| Free-path hit rate | Majority of career queue resolves via `ats` / `list` / `careerhtml` (not `failed` / scrape.do) |
| Monitor tab | New sidebar **Enrichment** (not under Failure Dashboard) shows live queue health |

## Non-goals

- Fixing dashboard `jobsAddedToBoard` inflation (separate issue).
- Enabling HC browser enrichment on the droplet.
- Enabling career Scrape.do (`JOB_ENRICHMENT_SCRAPE_DO_ENABLED` stays false).
- Multiple enrichment PM2 instances.
- Putting this UI under Failure Dashboard.
- Paying proxies / Scrape.do for career detail pages.

---

## Enrichment policy

| Source class | Allowed paths | Scrape.do |
|--------------|---------------|-----------|
| Career / company scrapers (`source` empty or non-aggregator) | **Maximize free paths** (see below): TalentBrew detail, Phenom PCSX/widgets, Workday/Oracle/Eightfold/Greenhouse/…, career HTML, JSON-LD fallback, list-complete | **Never** |
| Hiring Cafe | HTTP → proxy → Scrape.do (existing tiers); browser stays off in prod | **Yes** |
| Other aggregators (Accel, Chopping Block, etc.) | Existing HTML / ATS paths | Unchanged (not expanded in this work) |

When career free paths miss: persist `failed` or `list` with a clear error — **do not** wait on credits or Scrape.do.

---

## Free-path expansion (career) — prioritized by live queue

Mongo sample of career `queued` hosts (2026-09-04) shows the pile is **not** random — it is dominated by Radancy/TalentBrew-style `/en/job/...` URLs that currently lack a **job-detail** free adapter (board listing exists; detail enrich falls through to disabled scrape.do).

| Priority | Host / pattern | ~Queued | Free path to add / harden |
|----------|----------------|---------|---------------------------|
| **P0** | `capitalonecareers.com` `/en/job/...` | ~1224 | **TalentBrew / Radancy job-detail** HTML or JSON (same family as Moody’s board) |
| **P0** | `commonspirit.careers` `/en/job/...` | ~832 | Same TalentBrew detail path |
| **P0** | `schwabjobs.com` `/en/job/...` | ~335 | Same (host already in Phenom board dir — verify detail uses TalentBrew, not wrong Phenom guess) |
| **P0** | `santandercareers.com`, `careers.moodys.com`, `jobs.intuit.com` `/en/job/...` | ~250 | Same TalentBrew detail path |
| **P1** | Phenom PCSX hosts (`jobs.nvidia.com`, `careers.cognizant.com`, Amex, …) | dozens | Harden `fetchAtsJob` Phenom detail; expand `DIRECTORY_PHENOM_BOARD_HOSTS` / detection; widen `recoverPhenomAtsSkipFailures` |
| **P1** | Workday / Oracle Cloud / Eightfold / Greenhouse / Apple / IBM / Google | hundreds | Already have adapters — ensure `detectAts` hits applyUrl+jobUrl; fix misses that fall to scrape.do |
| **P2** | `recruiting.adp.com` (`rb=PhenomPeople`) | ~20 | Free ADP/PhenomPeople detail or redirect-follow → Phenom JSON |
| **P2** | `ats.rippling.com` | ~6 | New free **Rippling** job JSON/HTML adapter |
| **P2** | `higher.gs.com` | ~14 | New free **Goldman Higher** role JSON/HTML adapter |
| **P2** | Unknown career hosts | rest | Generic **JSON-LD JobPosting** + lightweight HTML description extract before fail |

### Career enrich order (target)

For each career listing in `processOne` / `fetchAtsJob`:

1. Detect known ATS (Greenhouse, Lever, Ashby, Workday, Oracle, Eightfold, Phenom, Apple, IBM, Google, …).
2. **NEW:** Detect TalentBrew/Radancy job detail (`/en/job/{loc}/{slug}/{org}/{id}`) → free HTML/JSON fetch → `method: ats` (or `careerhtml`).
3. Phenom PCSX / widgets apply APIs (existing + host directory expansion).
4. Directory `careerhtml` hosts.
5. **NEW:** Generic JSON-LD `JobPosting` on the apply/job URL (no paid proxy).
6. If list snapshot already board-quality → `method: list`.
7. Else → `failed` with explicit error (never scrape.do).

### Implementation notes for TalentBrew detail (highest leverage)

- ~**2.6k+** of current career queue share `/en/job/.../{orgId}/{jobId}` URLs.
- Reuse patterns from `parseTalentBrewResultsHtml` / Moody’s results endpoints where possible; prefer per-job page fetch + JSON-LD / embedded state.
- Wire into `detectAts` + `fetchAtsJob` so enrichment worker picks it up automatically.
- Unit tests with fixtures from Capital One / Schwab / CommonSpirit job pages (sanitized HTML).

### Phenom maximize

- Ensure detail URLs with `/careers/job/{id}` or `pid=` always detect as Phenom.
- Grow host allowlists from top queue hosts that are truly Phenom (not TalentBrew).
- Expand recovery pass beyond the small Phenom-only regex batch so failed `career_scrape_do_disabled` / `SCRAPE_DO_TOKEN_missing` rows for free-detectable hosts are requeued.

---

## Worker changes

### 1. Remove global budget early-return (P0)

**File:** `server/src/workers/jobEnrichmentWorker.ts` — `runEnrichmentPass`

**Today:** if `getCreditsSpentToday() >= SCRAPE_DO_DAILY_CREDIT_BUDGET`, return immediately → claims nothing (including free career).

**Target:** always claim and process. Budget checks apply only when about to call Scrape.do (HC path and any residual career scrape.do gate — career gate already disabled).

Mid-job HC behavior when budget exhausted:
- Skip Scrape.do (already partially present).
- Prefer deferral: requeue with `nextAttemptAt` toward next UTC day (or short backoff) and error `daily_credit_budget_exhausted`, **without** burning the global pass.
- Do **not** set a 60s idle sleep that starves career; only HC scrape.do work is deferred.

### 2. Raise free-path throughput (P0)

**Config (PM2 `scoutx-enrichment` + `.env`):**
- `JOB_ENRICHMENT_CONCURRENCY`: raise to **8–12** (prod currently 4).
- `JOB_ENRICHMENT_BATCH`: raise to **20–30** (prod currently 8).
- Keep `instances: 1`.
- Keep `HIRING_CAFE_ENRICH_BROWSER_ENABLED=false`.
- Keep `JOB_ENRICHMENT_SCRAPE_DO_ENABLED=false`.

No Chromium in enrichment → safe to run parallel with scrapers/aggregators on the droplet.

### 3. Career path clarity + free adapters (P0/P1)

Ensure `processOne` for non-HC career rows follows the **Career enrich order** above.

Also:
- Requeue historical failures with `career_scrape_do_disabled` / `SCRAPE_DO_TOKEN_missing` when the URL now matches a free detector (TalentBrew detail, Phenom, Workday, …).
- Extend `recoverPhenomAtsSkipFailures` (or generalize to `recoverFreePathSkipFailures`) so backlog actually re-enters the queue after adapter adds.

### 4. Safety

| Risk | Mitigation |
|------|------------|
| Credit burn | Career never calls scrape.do; HC still budget-gated |
| Proxy / 429 | Existing circuit breaker; single enrichment instance |
| Chromium OOM | Browser enrichment stays off |
| Lease stuck | Existing 15m lease recovery |

---

## Enrichment monitor tab (UI)

### Navigation

- New sidebar value: `enrichment`
- Route: `/enrichment`
- Label: **Enrichment**
- **Not** nested under Failure Dashboard

### API

`GET /api/enrichment/metrics` (auth same as other dashboard routes)

Response (illustrative):

```json
{
  "asOf": "ISO-8601",
  "queue": {
    "queued": 3712,
    "dueNow": 3708,
    "enriching": 2,
    "futureBackoff": 4,
    "leaseStuck": 0
  },
  "windows": {
    "ready1h": 0,
    "ready6h": 0,
    "created6h": 0,
    "queuedCreated6h": 0
  },
  "bySourceClass": {
    "career": { "queued": 3671, "enriching": 0, "ready6h": 0 },
    "hiring_cafe": { "queued": 41, "enriching": 2, "ready6h": 0 },
    "other": { "queued": 0, "enriching": 0, "ready6h": 0 }
  },
  "byMethod6h": { "ats": 0, "list": 0, "scrape.do": 0, "none": 0, "partial": 0 },
  "credits": {
    "spentToday": 14398,
    "budget": 15000,
    "pausedForScrapeDo": true
  },
  "topErrors": [{ "error": "…", "n": 0 }],
  "worker": {
    "note": "derived from recent board activity / optional last-pass fields if exposed"
  }
}
```

Implementation notes:
- Query `maxun_job_board` aggregations (status, source class, method, errors, windows).
- Source class: `hiring_cafe` → HC; empty/missing → career; else → other.
- Credits from `maxun_enrichment_credit_budget` for UTC day + `SCRAPE_DO_DAILY_CREDIT_BUDGET`.
- Cache ~15–30s like other dashboard metrics.

### UI page

- KPI cards: Queued, Due now, Enriching, Ready 6h, Credits (spent/budget)
- Split: Career vs Hiring Cafe queued/ready
- Method mix (last 6h) — expect `ats` + `list` to dominate career
- Top queued hosts (so we can spot missing free adapters)
- Top errors table
- Auto-refresh ~15–30s so operators can confirm drain after deploy

Reuse existing dashboard tokens / card patterns (`FIRSTSTEP`, `cardSx`).

---

## Files to touch (expected)

| Area | Files |
|------|--------|
| Worker | `server/src/workers/jobEnrichmentWorker.ts` |
| Free ATS | `server/src/services/atsAdapters.ts` (+ fixtures/tests); Phenom/TalentBrew host directories as needed |
| Config | `ecosystem.config.cjs`, optionally `.env` / `.env.example` |
| API | `server/src/api/` new route or extend jobs/automations router |
| UI nav | `src/components/dashboard/sidebarNav.ts`, router, sidebar labels |
| UI page | `src/pages/EnrichmentPage.tsx` (+ small feature helpers if needed) |
| Client API | `src/api/` metrics client |
| Tests | Budget-does-not-block-career; TalentBrew detail detect/fetch; Phenom recovery; metrics smoke |

---

## Rollout

1. Ship TalentBrew job-detail free path + budget early-return fix + concurrency bump (biggest queue impact).
2. Requeue free-detectable historical failures.
3. Deploy API + Enrichment tab; confirm career queued ↓ and `ats` method ↑.
4. Follow with Phenom hardening + Rippling / ADP / Goldman adapters (P2) guided by Enrichment tab “top hosts”.

---

## Out of scope follow-ups

- Align dashboard “Jobs added” with board-ready counts.
- Soft-gate orphan double-count in `jobsAddedToBoard`.
- Separate career-only vs HC-only worker processes.

---

## Spec self-review

- [x] No unresolved placeholders
- [x] Career free vs HC scrape.do policy consistent throughout
- [x] Monitor is a **new tab**, not under Failure Dashboard
- [x] Global budget pause called out as the root career-block bug
- [x] Free-path expansion prioritized by real queue hosts (TalentBrew detail = largest win)
- [x] Non-goals keep paid career scrape.do out of scope
