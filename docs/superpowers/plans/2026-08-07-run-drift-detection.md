# Run Drift Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop silent success on zero-row / severe volume-drop list extractions runs.

**Architecture:** Pure `evaluateRunDrift` + I/O helpers in `runDrift.ts`; worker persists then throws `RunDriftError` on hard fails (no retry).

**Tech Stack:** TypeScript, Vitest, Mongoose Run model, destinations webhook, ops digest, dashboard/admin UI.

**Spec:** `docs/superpowers/specs/2026-08-07-run-drift-detection-design.md`

---

### File map

| File | Role |
|------|------|
| `server/src/services/runDrift.ts` | Pure policy + baseline/history I/O + `RunDriftError` |
| `server/src/services/runDrift.test.ts` | Vitest matrix |
| `server/src/models/Run.ts` | `rowsExtracted`, `anomaly`, `anomalyMeta` |
| `server/src/workers/scraperWorker.ts` | Evaluate → persist → webhook → throw |
| `server/src/services/destinations.ts` | Flat webhook drift fields |
| `server/src/services/opsDigest.ts` | Selector Drift section |
| `server/src/services/automation.ts` | Enrichers pass anomaly |
| `server/src/api/admin.ts` | Admin run enrichment |
| `src/components/run/ColapsibleRow.tsx` | Run list chips |
| `src/pages/RunDetailsPage.tsx` | Detail anomaly chip |
| `src/pages/AdminPage.tsx` | Admin anomaly chip |

---

### Tasks

- [x] Design spec
- [x] `runDrift.ts` + tests
- [x] Run model fields
- [x] Wire `processConfiguredListExtraction` + no-retry on `RunDriftError`
- [x] Webhook + ops digest
- [x] Dashboard / admin UI
- [x] This checkbox plan

### Verify

```bash
npx vitest run server/src/services/runDrift.test.ts
```
