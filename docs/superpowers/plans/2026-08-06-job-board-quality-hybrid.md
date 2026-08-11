# Job Board Quality Hybrid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop junk/marketing-shell cards on the job board and fix Ford/Carrier/Toyota quality via shared gates, slug titles, URL allowlists, and a cleanup/requeue script.

**Architecture:** Centralize title/description/URL/company quality helpers in `jobPageParser.ts`; enforce them at extract (`automation.ts`), enrichment persist (`jobEnrichmentWorker.ts`), and API list (`jobs.ts`); clean existing Mongo rows with a one-shot script.

**Tech Stack:** TypeScript, Vitest, Mongoose/`maxun_job_board`, existing scrape.do enrichment worker.

**Spec:** `docs/superpowers/specs/2026-08-06-job-board-quality-hybrid-design.md`

---

### File map

| File | Role |
|------|------|
| `server/src/services/jobPageParser.ts` | `isGenericJobTitle`, junk/overview detection, canonicalize aliases, Phenom URL/title helpers |
| `server/src/services/jobPageParser.test.ts` | Unit tests for gates |
| `server/src/workers/jobEnrichmentWorker.ts` | Quality-gated `ready`; slug title; derive remote only when score &gt; 0 |
| `server/src/services/automation.ts` | Drop non-job extract rows |
| `server/src/api/jobs.ts` | Hide junk from list; slug title; safe derive |
| `server/src/scripts/cleanupJobBoardQuality.ts` | Delete/expire junk, canonicalize, requeue Ford/Toyota/Carrier |

---

### Task 1: Parser quality helpers + tests

**Files:**
- Modify: `server/src/services/jobPageParser.ts`
- Modify: `server/src/services/jobPageParser.test.ts`

- [ ] Export `isGenericJobTitle(title)` covering marketing shells
- [ ] Expand `NAV_CHROME_RE` / `isJunkDescription` for search widgets + Toyota Overview-only
- [ ] Expand `canonicalizeCompanyName` for Carrier/Meta/Ford/Toyota/Sia
- [ ] Add `isPhenomJobDetailUrl(url)` and `titleFromPhenomJobUrl(url)`
- [ ] Reuse `isGenericJobTitle` inside `mergeParsedFields`
- [ ] Add Vitest cases; run `npx vitest run server/src/services/jobPageParser.test.ts`

### Task 2: Enrichment worker gates

**Files:**
- Modify: `server/src/workers/jobEnrichmentWorker.ts`

- [ ] Use shared `isGenericJobTitle` + Phenom slug title fallback
- [ ] `scrape.do` ready only if `descriptionQualityScore > 0`
- [ ] Call `deriveFieldsFromDescription` only when score &gt; 0

### Task 3: Extract filter

**Files:**
- Modify: `server/src/services/automation.ts`
- Modify: `server/src/services/automation.overrides.test.ts` (if present)

- [ ] Drop generic non-job titles
- [ ] For Phenom hosts, require job-detail URL shape (or drop known hub paths)

### Task 4: API safety net

**Files:**
- Modify: `server/src/api/jobs.ts`

- [ ] Skip mapping/listing rows with generic title + junk desc (or filter in aggregation)
- [ ] Phenom/Google slug title fallback in `mapListingToJob`
- [ ] Derive remote only when `descriptionQualityScore(description) > 0`

### Task 5: Cleanup script + run

**Files:**
- Create: `server/src/scripts/cleanupJobBoardQuality.ts`

- [ ] Canonicalize company names
- [ ] Delete non-Phenom-detail Carrier (and similar) junk URLs
- [ ] Clear Ford marketing titles → slug or requeue; clear junk descs; unset false Remote
- [ ] Requeue Ford/Toyota/remaining Carrier for enrichment
- [ ] Run script against Mongo; confirm counts

### Task 6: Verify

- [ ] Vitest for parser (+ automation overrides if updated)
- [ ] Spot-check board companies via small Mongo script / API

**Commits:** Only if user requests.

---

### Spec coverage

| Spec pillar | Task |
|-------------|------|
| Quality gates | 1–4 |
| Ford slug + Remote | 1, 2, 5 |
| Carrier purge + canonicalize | 1, 3, 5 |
| Toyota Overview | 1, 2, 5 |
| Cleanup | 5 |
| API hide | 4 |
