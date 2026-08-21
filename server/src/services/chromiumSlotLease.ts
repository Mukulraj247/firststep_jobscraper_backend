/**
 * Droplet-wide Chromium slot lease (Mongo).
 *
 * Career scrapers claim 1 of N shared slots.
 * Aggregators claim exclusive (only when zero active holders).
 * See docs/superpowers/specs/2026-08-21-chromium-slot-lease-design.md
 */
import { randomUUID } from 'crypto';
import ChromiumSlotLease, {
  ChromiumSlotHolder,
  ChromiumSlotKind,
} from '../models/ChromiumSlotLease';
import logger from '../logger';

export type { ChromiumSlotKind };

const LEASE_DOC_ID = 'droplet';

export interface ChromiumSlotHandle {
  holderId: string;
  kind: ChromiumSlotKind;
  /** No-op handle when leasing is disabled. */
  disabled?: boolean;
}

export interface ClaimChromiumSlotOptions {
  kind: ChromiumSlotKind;
  holderId?: string;
  runId?: string;
  leaseMs?: number;
  /** Max time to wait for a free slot (default: longest job timeout + grace). */
  waitMs?: number;
  pollMs?: number;
}

let processKind: ChromiumSlotKind = 'scraper';
const renewTimers = new Map<string, NodeJS.Timeout>();

export function setChromiumSlotProcessKind(kind: ChromiumSlotKind): void {
  processKind = kind;
}

export function getChromiumSlotProcessKind(): ChromiumSlotKind {
  return processKind;
}

export function isChromiumSlotLeaseEnabled(): boolean {
  const raw = String(process.env.CHROMIUM_SLOT_LEASE_ENABLED ?? 'true').trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'off';
}

export function getChromiumMaxSlots(): number {
  const n = parseInt(process.env.CHROMIUM_MAX_SLOTS || '2', 10);
  if (Number.isNaN(n) || n < 1) return 2;
  return Math.min(n, 8);
}

export function getChromiumSlotLeaseMs(): number {
  const fromEnv = parseInt(process.env.CHROMIUM_SLOT_LEASE_MS || '', 10);
  if (!Number.isNaN(fromEnv) && fromEnv > 0) return fromEnv;
  const scraperTimeout = parseInt(process.env.SCRAPER_JOB_TIMEOUT_MS || '120000', 10);
  const aggTimeout = parseInt(process.env.AGGREGATOR_JOB_TIMEOUT_MS || '600000', 10);
  const base = Math.max(
    Number.isNaN(scraperTimeout) ? 120000 : scraperTimeout,
    Number.isNaN(aggTimeout) ? 600000 : aggTimeout
  );
  return base + 120_000;
}

function getDefaultWaitMs(): number {
  const fromEnv = parseInt(process.env.CHROMIUM_SLOT_WAIT_MS || '', 10);
  if (!Number.isNaN(fromEnv) && fromEnv > 0) return fromEnv;
  return getChromiumSlotLeaseMs();
}

/** Pure: drop expired holders. Exported for unit tests. */
export function filterActiveHolders(
  holders: ChromiumSlotHolder[] | undefined | null,
  now: Date = new Date()
): ChromiumSlotHolder[] {
  if (!holders?.length) return [];
  return holders.filter((h) => h.leaseUntil && new Date(h.leaseUntil).getTime() > now.getTime());
}

/** Pure: can this kind claim given active holders? Exported for unit tests. */
export function canClaimChromiumSlot(
  kind: ChromiumSlotKind,
  activeHolders: ChromiumSlotHolder[],
  maxSlots: number = getChromiumMaxSlots()
): boolean {
  if (kind === 'aggregator') {
    return activeHolders.length === 0;
  }
  const hasAggregator = activeHolders.some((h) => h.kind === 'aggregator');
  if (hasAggregator) return false;
  return activeHolders.length < maxSlots;
}

async function ensureLeaseDoc(): Promise<void> {
  await ChromiumSlotLease.updateOne(
    { _id: LEASE_DOC_ID },
    {
      $setOnInsert: {
        _id: LEASE_DOC_ID,
        mode: 'shared',
        holders: [],
      },
    },
    { upsert: true }
  );
}

/**
 * Single attempt to claim via atomic aggregation pipeline.
 * Returns null if slots are busy.
 */
export async function tryClaimChromiumSlot(
  opts: ClaimChromiumSlotOptions
): Promise<ChromiumSlotHandle | null> {
  if (!isChromiumSlotLeaseEnabled()) {
    return {
      holderId: opts.holderId || `disabled-${randomUUID()}`,
      kind: opts.kind,
      disabled: true,
    };
  }

  const now = new Date();
  const leaseMs = opts.leaseMs && opts.leaseMs > 0 ? opts.leaseMs : getChromiumSlotLeaseMs();
  const leaseUntil = new Date(now.getTime() + leaseMs);
  const holderId = opts.holderId || `${opts.kind}-${process.pid}-${randomUUID()}`;
  const maxSlots = getChromiumMaxSlots();
  const newHolder: ChromiumSlotHolder = {
    holderId,
    kind: opts.kind,
    leaseUntil,
    ...(opts.runId ? { runId: opts.runId } : {}),
  };

  await ensureLeaseDoc();

  // Mongoose 9 rejects array updates unless updatePipeline is set (aggregation pipeline claim).
  const doc = await ChromiumSlotLease.findOneAndUpdate(
    { _id: LEASE_DOC_ID },
    [
      {
        $set: {
          _active: {
            $filter: {
              input: { $ifNull: ['$holders', []] },
              as: 'h',
              cond: { $gt: ['$$h.leaseUntil', now] },
            },
          },
        },
      },
      {
        $set: {
          _ok: {
            $cond: [
              { $eq: [opts.kind, 'aggregator'] },
              { $eq: [{ $size: '$_active' }, 0] },
              {
                $and: [
                  {
                    $eq: [
                      {
                        $size: {
                          $filter: {
                            input: '$_active',
                            as: 'h',
                            cond: { $eq: ['$$h.kind', 'aggregator'] },
                          },
                        },
                      },
                      0,
                    ],
                  },
                  { $lt: [{ $size: '$_active' }, maxSlots] },
                ],
              },
            ],
          },
        },
      },
      {
        $set: {
          holders: {
            $cond: ['$_ok', { $concatArrays: ['$_active', [newHolder]] }, '$_active'],
          },
          mode: {
            $cond: [
              '$_ok',
              opts.kind === 'aggregator' ? 'exclusive' : 'shared',
              {
                $cond: [
                  { $eq: [{ $size: '$_active' }, 0] },
                  'shared',
                  { $ifNull: ['$mode', 'shared'] },
                ],
              },
            ],
          },
          updatedAt: now,
        },
      },
      { $unset: ['_active', '_ok'] },
    ] as any,
    { returnDocument: 'after', updatePipeline: true }
  );

  const claimed = Boolean(
    doc &&
      Array.isArray((doc as any).holders) &&
      (doc as any).holders.some(
        (h: ChromiumSlotHolder) =>
          h.holderId === holderId && new Date(h.leaseUntil).getTime() > Date.now() - 1000
      )
  );
  if (!claimed) return null;
  return { holderId, kind: opts.kind };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function claimChromiumSlot(opts: ClaimChromiumSlotOptions): Promise<ChromiumSlotHandle> {
  const waitMs = opts.waitMs && opts.waitMs > 0 ? opts.waitMs : getDefaultWaitMs();
  const pollMs = opts.pollMs && opts.pollMs > 0 ? opts.pollMs : 1500;
  const deadline = Date.now() + waitMs;
  let attempt = 0;

  while (Date.now() <= deadline) {
    const handle = await tryClaimChromiumSlot(opts);
    if (handle) {
      if (!handle.disabled) {
        startRenewTimer(handle);
        logger.log(
          'info',
          `Chromium slot claimed kind=${handle.kind} holder=${handle.holderId} maxSlots=${getChromiumMaxSlots()}`
        );
      }
      return handle;
    }
    attempt += 1;
    if (attempt === 1 || attempt % 10 === 0) {
      logger.log(
        'info',
        `Chromium slot busy kind=${opts.kind}; waiting (attempt ${attempt}, maxSlots=${getChromiumMaxSlots()})`
      );
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(pollMs, remaining));
  }

  throw new Error(
    `Chromium slot lease timeout after ${waitMs}ms (kind=${opts.kind}, maxSlots=${getChromiumMaxSlots()})`
  );
}

export async function renewChromiumSlot(handle: ChromiumSlotHandle): Promise<void> {
  if (!handle || handle.disabled || !isChromiumSlotLeaseEnabled()) return;
  const leaseUntil = new Date(Date.now() + getChromiumSlotLeaseMs());
  await ChromiumSlotLease.updateOne(
    { _id: LEASE_DOC_ID, 'holders.holderId': handle.holderId },
    { $set: { 'holders.$.leaseUntil': leaseUntil, updatedAt: new Date() } }
  );
}

export async function releaseChromiumSlot(
  handle: ChromiumSlotHandle | null | undefined
): Promise<void> {
  if (!handle) return;
  stopRenewTimer(handle.holderId);
  if (handle.disabled || !isChromiumSlotLeaseEnabled()) return;

  await ChromiumSlotLease.updateOne(
    { _id: LEASE_DOC_ID },
    { $pull: { holders: { holderId: handle.holderId } }, $set: { updatedAt: new Date() } }
  );

  const doc = await ChromiumSlotLease.findById(LEASE_DOC_ID).lean();
  const active = filterActiveHolders(doc?.holders as ChromiumSlotHolder[] | undefined);
  if (active.length === 0) {
    await ChromiumSlotLease.updateOne(
      { _id: LEASE_DOC_ID },
      { $set: { mode: 'shared', holders: [], updatedAt: new Date() } }
    );
  }

  logger.log('info', `Chromium slot released kind=${handle.kind} holder=${handle.holderId}`);
}

function startRenewTimer(handle: ChromiumSlotHandle): void {
  stopRenewTimer(handle.holderId);
  const every = Math.max(15_000, Math.floor(getChromiumSlotLeaseMs() / 4));
  const timer = setInterval(() => {
    void renewChromiumSlot(handle).catch((err) => {
      logger.log('warn', `Chromium slot renew failed: ${(err as Error)?.message || err}`);
    });
  }, every);
  if (typeof timer.unref === 'function') timer.unref();
  renewTimers.set(handle.holderId, timer);
}

function stopRenewTimer(holderId: string): void {
  const t = renewTimers.get(holderId);
  if (t) {
    clearInterval(t);
    renewTimers.delete(holderId);
  }
}

export async function releaseAllChromiumSlotsForProcess(): Promise<void> {
  for (const holderId of [...renewTimers.keys()]) {
    stopRenewTimer(holderId);
  }
}
