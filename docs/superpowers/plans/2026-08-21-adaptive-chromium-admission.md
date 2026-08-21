# Adaptive Chromium Admission (RAM/CPU) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the fixed Mongo Chromium slot lease ships, add optional RAM/CPU gates so new browsers only start when the droplet has headroom — still under a hard `CHROMIUM_MAX_SLOTS` cap.

**Architecture:** Keep [`chromiumSlotLease.ts`](../../server/src/services/chromiumSlotLease.ts) as the cross-process mutex. Before a successful claim (or immediately after claim and before launch), call a new `canAdmitChromiumByResources()` that reads Linux `MemAvailable` and optional 1-minute load average. If resources are tight, delay/retry the same way slot-busy waits today. Never exceed `CHROMIUM_MAX_SLOTS`.

**Tech Stack:** Node.js, existing Mongo lease, `/proc/meminfo` + `os.loadavg()` on Linux (DigitalOcean), vitest.

**Depends on:** Implemented fixed lease ([spec](../specs/2026-08-21-chromium-slot-lease-design.md)).

---

## File map

| File | Responsibility |
|------|----------------|
| Create `server/src/utils/dropletResources.ts` | Read MemAvailable / load; pure helpers + env thresholds |
| Create `server/src/utils/dropletResources.test.ts` | Unit tests with fixture meminfo strings |
| Modify `server/src/services/chromiumSlotLease.ts` | Gate `tryClaimChromiumSlot` / wait loop with resource check |
| Modify `ecosystem.config.cjs` | Optional env knobs (defaults safe for 2 GB) |
| Update spec or short design note | Document adaptive layer as phase 2 |

---

### Task 1: Resource reader + pure thresholds

**Files:**
- Create: `server/src/utils/dropletResources.ts`
- Test: `server/src/utils/dropletResources.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  parseMemAvailableKb,
  shouldAdmitChromium,
} from './dropletResources';

describe('dropletResources', () => {
  it('parses MemAvailable from meminfo', () => {
    const sample = `MemTotal:        2048000 kB\nMemAvailable:     512000 kB\n`;
    expect(parseMemAvailableKb(sample)).toBe(512000);
  });

  it('denies admit when available MB below floor', () => {
    expect(
      shouldAdmitChromium({
        memAvailableMb: 200,
        minMemAvailableMb: 400,
        load1: 0.2,
        maxLoad1: 2,
        cpuCount: 1,
      })
    ).toBe(false);
  });

  it('denies admit when load1 too high', () => {
    expect(
      shouldAdmitChromium({
        memAvailableMb: 800,
        minMemAvailableMb: 400,
        load1: 3.5,
        maxLoad1: 2,
        cpuCount: 1,
      })
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run server/src/utils/dropletResources.test.ts
```

- [ ] **Step 3: Implement**

```ts
// dropletResources.ts — sketch
export function parseMemAvailableKb(meminfo: string): number | null { /* ... */ }
export function readMemAvailableMb(): number | null { /* read /proc/meminfo on linux; null on win */ }
export function shouldAdmitChromium(opts: {
  memAvailableMb: number | null;
  minMemAvailableMb: number;
  load1: number;
  maxLoad1: number;
  cpuCount: number;
}): boolean {
  if (opts.memAvailableMb != null && opts.memAvailableMb < opts.minMemAvailableMb) return false;
  if (opts.maxLoad1 > 0 && opts.load1 > opts.maxLoad1) return false;
  return true;
}
export function isResourceAdmissionEnabled(): boolean {
  // CHROMIUM_RESOURCE_ADMISSION=true
}
export function getResourceAdmissionThresholds() {
  // CHROMIUM_MIN_MEM_AVAILABLE_MB default 400 on 2GB
  // CHROMIUM_MAX_LOAD1 default = cpus * 1.5 or 2
}
```

- [ ] **Step 4: Run tests — expect PASS**

---

### Task 2: Wire into slot claim wait loop

**Files:**
- Modify: `server/src/services/chromiumSlotLease.ts`
- Test: extend `chromiumSlotLease.test.ts` with mocked `shouldAdmit` if exported hook, or test thresholds only in Task 1

- [ ] **Step 1:** In `claimChromiumSlot` loop, before `tryClaimChromiumSlot`, if resource admission enabled and `!shouldAdmitChromium(...)`, sleep/poll (same as slot busy) without claiming.

- [ ] **Step 2:** Optional: after claim, if RAM fell through floor before browser launch, release immediately and retry (avoid holding slot while starved). Prefer **check-before-claim** only for v1 of phase 2.

- [ ] **Step 3:** Log at info: `Chromium admission deferred: memAvailableMb=… load1=…`

- [ ] **Step 4:** Manual note in ecosystem header: adaptive gates optional via env.

---

### Task 3: Ecosystem defaults (2 GB)

**Files:**
- Modify: `ecosystem.config.cjs`

- [ ] Set on scraper + aggregators (commented or explicit):

```js
CHROMIUM_RESOURCE_ADMISSION: 'true',
CHROMIUM_MIN_MEM_AVAILABLE_MB: '400',
// CHROMIUM_MAX_LOAD1: '2',
```

Keep `CHROMIUM_MAX_SLOTS: '2'` as hard cap — adaptive never exceeds it.

---

### Task 4: Verify on droplet

- [ ] Deploy build + reload PM2.
- [ ] Run two career scrapes; confirm both claim when RAM free.
- [ ] While both run, queue Hiring Cafe — should wait (existing exclusive lease).
- [ ] Stress RAM (or lower `CHROMIUM_MIN_MEM_AVAILABLE_MB` temporarily) — third/new claim should defer with admission log.
- [ ] Confirm no OOM under dual career + idle aggregators.

---

## Out of scope (phase 2)

- Auto-scaling `SCRAPER_WORKER_CONCURRENCY` at runtime (Agenda concurrency is fixed at process define time).
- Multi-droplet lease ids.
- Windows production admission (return null / skip gate).

## Self-review

- Spec coverage: hard cap preserved; RAM then CPU soft gates; queue wait = existing poll loop.
- No placeholders in tasks.
- Builds on `claimChromiumSlot` / `tryClaimChromiumSlot` names from phase 1.
