# SuccessFactors Board Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect SAP SuccessFactors RMK search boards via HTTP HTML pagination (no Chromium), with confirmation gates and correct `startrow` reset, falling back to browser when confidence is low.

**Architecture:** Extend `atsAdapters.ts` with `successfactors` provider (detect → confirm HTML → cheerio parse → paginate `startrow`). Fix `normalizeListStartUrl` offset vs page params. Reuse `tryAtsBoardCollection` unchanged aside from comment. Vitest covers detect/parse/paginate/normalizer.

**Tech Stack:** TypeScript, axios (`atsHttpClient`), cheerio, Vitest

**Spec:** `docs/superpowers/specs/2026-08-10-successfactors-board-adapter-design.md`

---

### File map

| File | Role |
|------|------|
| `server/src/services/listExtractor.ts` | Offset params reset to `0` |
| `server/src/services/listExtractor.ranked.test.ts` | Normalizer tests for `startrow` |
| `server/src/services/atsAdapters.ts` | SF detect, confirm, parse, fetch, wire into `fetchAtsBoardJobs` |
| `server/src/services/atsAdapters.test.ts` | SF unit tests + fixtures inline |
| `server/src/workers/scraperWorker.ts` | Comment only (already calls `fetchAtsBoardJobs`) |

---

### Task 1: Fix `normalizeListStartUrl` for offset params

**Files:**
- Modify: `server/src/services/listExtractor.ts` (`normalizeListStartUrl`)
- Modify: `server/src/services/listExtractor.ranked.test.ts`

- [x] **Step 1: Add failing tests**
- [x] **Step 2: Implement**
- [x] **Step 3: Run** — PASS
- [x] **Step 4: Commit** (skipped — user did not request commits)

---

### Task 2: SF helpers + detect (TDD)

**Files:**
- Modify: `server/src/services/atsAdapters.ts`
- Modify: `server/src/services/atsAdapters.test.ts`

- [x] **Step 1: Failing tests for detect / helpers**
- [x] **Step 2: Implement exports**
- [x] **Step 3: Run** — PASS

---

### Task 3: `fetchSuccessFactorsBoardJobs` + `fetchAtsBoardJobs` wiring

**Files:**
- Modify: `server/src/services/atsAdapters.ts`
- Modify: `server/src/services/atsAdapters.test.ts`
- Modify: `server/src/workers/scraperWorker.ts` (comment)

- [x] **Step 1: Failing fetch test with mocked pages**
- [x] **Step 2: Implement fetch**
- [x] **Step 3: Run** — PASS (38 tests)
- [x] **Step 4: Live smoke** — EY US board returned **508** unique rows via `successfactors`

---

### Task 4: Spec self-check + plan checkboxes

- [x] Confirm detect, confirm gate, pagination, caps, offset fix, browser fallback, tests all mapped
- [x] Mark plan tasks complete in this file when done

### Verify (final)

```bash
npx vitest run server/src/services/atsAdapters.test.ts server/src/services/listExtractor.ranked.test.ts
```

**Result (2026-08-10):** 38 passed. Live EY fetch: 508 jobs.
