import { afterEach, describe, expect, it } from 'vitest';
import {
  canClaimChromiumSlot,
  filterActiveHolders,
  getChromiumMaxSlots,
  isChromiumSlotLeaseEnabled,
} from './chromiumSlotLease';
import type { ChromiumSlotHolder } from '../models/ChromiumSlotLease';

describe('chromiumSlotLease rules', () => {
  afterEach(() => {
    delete process.env.CHROMIUM_MAX_SLOTS;
    delete process.env.CHROMIUM_SLOT_LEASE_ENABLED;
  });

  it('filters expired holders', () => {
    const now = new Date('2026-08-21T12:00:00.000Z');
    const holders: ChromiumSlotHolder[] = [
      {
        holderId: 'alive',
        kind: 'scraper',
        leaseUntil: new Date('2026-08-21T12:05:00.000Z'),
      },
      {
        holderId: 'dead',
        kind: 'scraper',
        leaseUntil: new Date('2026-08-21T11:59:00.000Z'),
      },
    ];
    expect(filterActiveHolders(holders, now).map((h) => h.holderId)).toEqual(['alive']);
  });

  it('allows two scrapers when maxSlots=2', () => {
    process.env.CHROMIUM_MAX_SLOTS = '2';
    const one: ChromiumSlotHolder[] = [
      { holderId: 'a', kind: 'scraper', leaseUntil: new Date(Date.now() + 60_000) },
    ];
    expect(canClaimChromiumSlot('scraper', one, 2)).toBe(true);
    const two: ChromiumSlotHolder[] = [
      ...one,
      { holderId: 'b', kind: 'scraper', leaseUntil: new Date(Date.now() + 60_000) },
    ];
    expect(canClaimChromiumSlot('scraper', two, 2)).toBe(false);
  });

  it('blocks aggregator while any scraper holds a slot', () => {
    const holders: ChromiumSlotHolder[] = [
      { holderId: 'a', kind: 'scraper', leaseUntil: new Date(Date.now() + 60_000) },
    ];
    expect(canClaimChromiumSlot('aggregator', holders, 2)).toBe(false);
    expect(canClaimChromiumSlot('aggregator', [], 2)).toBe(true);
  });

  it('blocks scraper while aggregator holds exclusive', () => {
    const holders: ChromiumSlotHolder[] = [
      { holderId: 'agg', kind: 'aggregator', leaseUntil: new Date(Date.now() + 60_000) },
    ];
    expect(canClaimChromiumSlot('scraper', holders, 2)).toBe(false);
  });

  it('reads CHROMIUM_MAX_SLOTS and enable flag', () => {
    process.env.CHROMIUM_MAX_SLOTS = '3';
    expect(getChromiumMaxSlots()).toBe(3);
    process.env.CHROMIUM_SLOT_LEASE_ENABLED = 'false';
    expect(isChromiumSlotLeaseEnabled()).toBe(false);
  });
});
