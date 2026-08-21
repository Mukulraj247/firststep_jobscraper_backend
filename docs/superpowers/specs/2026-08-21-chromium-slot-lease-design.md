# Droplet Chromium Slot Lease (Career vs Aggregators)

**Date:** 2026-08-21  
**Status:** Implemented  
**Product:** Scout-X collection path on DigitalOcean (2 GB Basic droplet)

## Problem

`scoutx-scraper` (`scraper-jobs`) and `scoutx-aggregators` (`aggregator-jobs`) are separate PM2 processes. Agenda concurrency is **per job name per process**, so both can open Chromium at once. On a **2 GB** droplet that overlaps with API + scheduler + enrichment and risks OOM.

Operators want:

1. Up to **2** concurrent **career** Chromium scrapes (`SCRAPER_WORKER_CONCURRENCY=2`).
2. Hiring Cafe / aggregators **must not** open Chromium while any career scrape holds a browser slot (and career scrapes wait while an aggregator holds Chromium).

## Goal

Serialize Chromium **across** the two PM2 apps with a shared Mongo lease, while still allowing **two career scrapes** to run browsers in parallel when aggregators are idle.

## Non-goals

- Droplet-wide hard cgroup memory partitions.
- Merging `scraper-jobs` and `aggregator-jobs` into one Agenda queue.
- Changing enrichment (scrape.do) — it does not use Chromium on the droplet path that matters here.
- Raising aggregator concurrency above `1`.

## Decision

| Choice | Value |
|--------|--------|
| Coordination | MongoDB lease document (same family as enrichment `leaseUntil` claims) |
| Max career browser slots | `CHROMIUM_MAX_SLOTS` (default **2**) |
| Aggregator mode | **Exclusive** — may claim only when **zero** slots are held |
| Hook point | Around `acquirePooledPage` / `releasePooledPage` in [`browserReusePool.ts`](../../server/src/services/browserReusePool.ts) |
| PM2 | `SCRAPER_WORKER_CONCURRENCY=2`, `AGGREGATOR_WORKER_CONCURRENCY=1`, keep `LOW_MEMORY_MODE=true` |

## Topology

```
Agenda scraper-jobs  ──► scoutx-scraper  ──► claim slot (1 of N) ──► Chromium
Agenda aggregator-jobs ─► scoutx-aggregators ─► claim exclusive   ──► Chromium
                              ▲
                              │
                     Mongo chromium_slot_lease
```

## Lease model

Singleton (or fixed `_id`) document in Mongo, e.g. collection `chromiumSlotLeases`, `_id: 'droplet'`:

```ts
{
  _id: 'droplet',
  maxSlots: 2,                 // mirrored from CHROMIUM_MAX_SLOTS at claim time
  mode: 'shared' | 'exclusive', // exclusive = aggregator holding
  holders: [
    {
      holderId: string,        // process+pid+uuid
      kind: 'scraper' | 'aggregator',
      leaseUntil: Date,
      runId?: string,
    }
  ],
  updatedAt: Date,
}
```

### Claim rules

| Caller | Rule |
|--------|------|
| Career scraper (`kind: 'scraper'`) | Succeed if `mode !== 'exclusive'` and `holders.length < maxSlots`. Append one holder. Set `mode: 'shared'`. |
| Aggregator (`kind: 'aggregator'`) | Succeed only if `holders.length === 0` (or all expired). Set single holder, `mode: 'exclusive'`. |

Expired holders (`leaseUntil < now`) are stripped atomically inside the same `findOneAndUpdate` / transaction-style update before applying the rule.

### Renew

While a page lease is held, renew `leaseUntil` on a timer (reuse job heartbeat interval or ~30–60s), similar to Agenda `lockedAt` refresh in `runScraperJobPayload`.

### Release

On `releasePooledPage` (and process shutdown / scrape `finally`), remove this `holderId` from `holders`. If empty, clear `mode`.

### Crash recovery

No separate sweeper required for correctness if every claim strips expired holders. Optional periodic log of recovered slots for ops visibility.

## API (new module)

Suggested: [`server/src/services/chromiumSlotLease.ts`](../../server/src/services/chromiumSlotLease.ts)

- `claimChromiumSlot({ kind, holderId, runId?, leaseMs? }): Promise<ChromiumSlotHandle>`
- `renewChromiumSlot(handle): Promise<void>`
- `releaseChromiumSlot(handle): Promise<void>`
- Env: `CHROMIUM_SLOT_LEASE_ENABLED` (default `true` in production workers), `CHROMIUM_MAX_SLOTS` (default `2`), `CHROMIUM_SLOT_LEASE_MS` (default ≥ longest job timeout + grace, e.g. align with aggregator/scraper timeouts).

Caller identity:

- Scraper worker / child: `kind: 'scraper'`
- Aggregator worker: `kind: 'aggregator'`

Pass `kind` into `acquirePooledPage` options (or set process-global once at worker boot) so the pool does not need to import Agenda.

## Integration

1. **`acquirePooledPage`**: before launching/attaching a page, `await claimChromiumSlot(...)`. On failure to claim within a wait budget, poll/retry with backoff until claim succeeds or job timeout aborts.
2. **`releasePooledPage`**: always `releaseChromiumSlot` in `finally` after page/browser cleanup.
3. **Child scrape process** (`SCRAPE_JOB_CHILD_PROCESS`): child must also claim/release (or parent holds slot for child lifetime — prefer **child claims** so parent restart does not strand a slot without Chromium). Document chosen behavior in implementation plan; default **claim in the process that calls `acquirePooledPage`**.

## Ecosystem / env

Update [`ecosystem.config.cjs`](../../ecosystem.config.cjs):

- `SCRAPER_WORKER_CONCURRENCY: '2'`
- `AGGREGATOR_WORKER_CONCURRENCY: '1'` (unchanged)
- Comment: dual career Chromium allowed; aggregators wait on Mongo slot lease
- Keep memory caps from 2 GB rebalance; revisit if dual career scrapes still OOM under load

## Failure modes

| Failure | Effect |
|---------|--------|
| Scraper holds 2 slots | Aggregator Agenda jobs stay locked/retry until slots free or their lockLifetime expires and requeue |
| Aggregator exclusive | Career jobs wait at `acquirePooledPage` (or requeue) until exclusive released |
| Holder crash | Slot frees when `leaseUntil` expires; next claim strips it |
| Lease disabled (`CHROMIUM_SLOT_LEASE_ENABLED=false`) | Prior overlap behavior (local/dev escape hatch) |
| Two droplets same `MONGODB_URI` | They share the lease — intended only for **one** Chromium droplet; multi-droplet scale-out needs per-droplet lease id later |

## Testing

- Unit tests for claim rules: 2 scrapers OK; 3rd scraper blocked; aggregator blocked while any scraper holds; scraper blocked while exclusive; expired holder reclaim.
- Optional integration: mock Mongo, assert `acquirePooledPage` waits/releases.

## Success criteria

- With concurrency 2, two career Chromiums can run together when aggregators are idle.
- Aggregator never opens Chromium while a career slot is held (and vice versa for exclusive).
- After kill -9 of a worker mid-scrape, slots become available within `CHROMIUM_SLOT_LEASE_MS`.

## Spec self-review

- No TBDs for core behavior; child-vs-parent claim default stated (claim where `acquirePooledPage` runs).
- Does not contradict process isolation (still separate PM2 apps).
- Scope limited to Chromium slot coordination + ecosystem concurrency bump.
