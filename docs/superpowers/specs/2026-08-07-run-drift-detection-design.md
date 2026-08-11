# Run Drift Detection Design

**Date:** 2026-08-07  
**Status:** Approved; implementation landed 2026-08-07  
**Product:** Scout-X scheduled URL collector (Engine 2 list extraction)

## Problem

A run that navigates successfully but extracts zero rows is recorded as `status: 'completed'` and emits `run-completed` with `status: 'success'`. At scale, career portals redeploy markup and robots silently return 0 forever while the pipeline reports green.

## Goals

1. Zero-row list extractions runs hard-fail (not green), with webhook + digest visibility.
2. Large volume drops soft-flag without alert floods; escalate after consecutive soft drops.
3. Pure, typed policy separate from worker I/O; always persist `rowsExtracted` / anomaly before any throw.
4. No scrape retries on drift hard-fails (dead selectors do not heal via retry).

## Non-goals

- Fallback / self-healing selectors
- Process isolation, backoff, circuit breakers
- Extension slimming, ATS-first collection, filter URL persistence
- Drift gating on live interpreter /record paths

## Rules

| Case | Run status | `anomaly` | Severity | Retry | Webhook |
|------|------------|-----------|----------|-------|---------|
| Kill switch off | completed | null | — | N/A | existing |
| `current === 0` | failed | `zero_rows` | hard | No | Yes |
| Soft drop (`current < floor(baseline * dropRatio)`, baseline ≥ min) | completed | `row_drop` | soft | N/A | No |
| Consecutive soft drops (streak) | failed | `row_drop` | escalated | No | Yes |
| Healthy | completed | null | — | N/A | existing |

Anomaly taxonomy stays small (`zero_rows` | `row_drop`). Escalation is `anomalyMeta.escalated: true`, not a separate anomaly string.

**Baseline:** last finished run with `status` in `{completed, success}`, `anomaly == null`, `rowsExtracted > 0`; else `previewRows.length`; else none (only absolute zero hard-fails).

**Env:** `DRIFT_DROP_RATIO` (0.2), `DRIFT_MIN_BASELINE` (5), `DRIFT_ESCALATION_STREAK` (2), `DRIFT_DETECTION_ENABLED` (true).

## Architecture

```
list extraction rows
  → loadDriftConfig / getBaselineForRobot / fetchRecentFinishedRuns
  → evaluateRunDrift (pure)
  → save Run (rowsExtracted, anomaly, anomalyMeta)
  → persist ExtractedData
  → webhook (hard outcomes + normal success)
  → socket emit
  → throw RunDriftError if skipRetry (outer catch: no requeue)
```

## API surface

- `RunDriftOutcome`: Healthy | SoftDrop | ZeroRows | Escalated | Disabled
- Flat webhook fields: `rowsExtracted`, `baselineRows`, `anomaly`, `ratio`, `escalated` (+ optional `anomalyMeta`)
- Ops digest “Selector Drift” section with `baseline → current` lines
- Dashboard/admin chips for soft vs hard/escalated
