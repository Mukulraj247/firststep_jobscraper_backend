import { afterEach, describe, expect, it } from 'vitest';
import { isRunningLeaseStale } from './scrapeHeartbeat';
import { isSchedulerEnabled } from './schedulerEnabled';

describe('isRunningLeaseStale', () => {
  const now = Date.parse('2026-08-08T12:00:00.000Z');
  const staleMs = 120_000;

  it('is fresh when heartbeat is within stale window', () => {
    expect(
      isRunningLeaseStale({
        heartbeatAt: '2026-08-08T11:59:00.000Z',
        startedAt: '2026-08-08T11:00:00.000Z',
        now,
        staleMs,
      })
    ).toBe(false);
  });

  it('is stale when heartbeat is older than staleMs', () => {
    expect(
      isRunningLeaseStale({
        heartbeatAt: '2026-08-08T11:57:00.000Z',
        startedAt: '2026-08-08T11:00:00.000Z',
        now,
        staleMs,
      })
    ).toBe(true);
  });

  it('falls back to startedAt when heartbeat is missing', () => {
    expect(
      isRunningLeaseStale({
        heartbeatAt: null,
        startedAt: '2026-08-08T11:57:00.000Z',
        now,
        staleMs,
      })
    ).toBe(true);
    expect(
      isRunningLeaseStale({
        heartbeatAt: null,
        startedAt: '2026-08-08T11:59:00.000Z',
        now,
        staleMs,
      })
    ).toBe(false);
  });

  it('treats missing timestamps as stale', () => {
    expect(isRunningLeaseStale({ now, staleMs })).toBe(true);
  });
});

describe('isSchedulerEnabled', () => {
  const prev = process.env.SCHEDULER_ENABLED;

  afterEach(() => {
    if (prev === undefined) delete process.env.SCHEDULER_ENABLED;
    else process.env.SCHEDULER_ENABLED = prev;
  });

  it('defaults to true when unset', () => {
    delete process.env.SCHEDULER_ENABLED;
    expect(isSchedulerEnabled()).toBe(true);
  });

  it('is false for false/0/no', () => {
    process.env.SCHEDULER_ENABLED = 'false';
    expect(isSchedulerEnabled()).toBe(false);
    process.env.SCHEDULER_ENABLED = '0';
    expect(isSchedulerEnabled()).toBe(false);
    process.env.SCHEDULER_ENABLED = 'no';
    expect(isSchedulerEnabled()).toBe(false);
  });

  it('is true for true/1', () => {
    process.env.SCHEDULER_ENABLED = 'true';
    expect(isSchedulerEnabled()).toBe(true);
    process.env.SCHEDULER_ENABLED = '1';
    expect(isSchedulerEnabled()).toBe(true);
  });
});
