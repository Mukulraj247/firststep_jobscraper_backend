import { describe, expect, it } from 'vitest';
import { computeScraperLockLifetimeMs } from '../queue/scraperQueue';

describe('computeScraperLockLifetimeMs', () => {
  it('adds 60s grace to the job timeout', () => {
    expect(computeScraperLockLifetimeMs(120_000)).toBe(180_000);
    expect(computeScraperLockLifetimeMs(300_000)).toBe(360_000);
  });

  it('falls back when timeout is invalid', () => {
    expect(computeScraperLockLifetimeMs(0)).toBe(180_000);
    expect(computeScraperLockLifetimeMs(-1)).toBe(180_000);
  });
});
