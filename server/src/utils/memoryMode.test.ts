import { describe, expect, it } from 'vitest';
import { shouldRetirePooledBrowser, shouldRetirePoolForRss } from '../utils/memoryMode';

describe('shouldRetirePooledBrowser', () => {
  const base = {
    jobsServed: 0,
    createdAt: 1_000_000,
    now: 1_000_000,
    maxJobs: 20,
    maxAgeMs: 15 * 60_000,
  };

  it('keeps a fresh unused browser', () => {
    expect(shouldRetirePooledBrowser(base)).toBe(false);
  });

  it('retires when jobsServed reaches maxJobs', () => {
    expect(
      shouldRetirePooledBrowser({
        ...base,
        jobsServed: 20,
      })
    ).toBe(true);
  });

  it('does not retire one under maxJobs', () => {
    expect(
      shouldRetirePooledBrowser({
        ...base,
        jobsServed: 19,
      })
    ).toBe(false);
  });

  it('retires when age exceeds maxAgeMs', () => {
    expect(
      shouldRetirePooledBrowser({
        ...base,
        now: base.createdAt + 15 * 60_000,
      })
    ).toBe(true);
  });

  it('does not age-retire before the ceiling', () => {
    expect(
      shouldRetirePooledBrowser({
        ...base,
        now: base.createdAt + 15 * 60_000 - 1,
      })
    ).toBe(false);
  });

  it('ignores age when maxAgeMs is 0', () => {
    expect(
      shouldRetirePooledBrowser({
        ...base,
        maxAgeMs: 0,
        now: base.createdAt + 99 * 60_000,
        jobsServed: 0,
      })
    ).toBe(false);
  });

  it('retires on jobs even when age is disabled', () => {
    expect(
      shouldRetirePooledBrowser({
        ...base,
        maxAgeMs: 0,
        jobsServed: 1,
        maxJobs: 1,
      })
    ).toBe(true);
  });
});

describe('shouldRetirePoolForRss', () => {
  const limit = 3_221_225_472;

  it('does not retire under the RSS limit', () => {
    expect(shouldRetirePoolForRss(limit - 1, limit)).toBe(false);
  });

  it('retires when RSS equals the limit', () => {
    expect(shouldRetirePoolForRss(limit, limit)).toBe(true);
  });

  it('retires when RSS exceeds the limit', () => {
    expect(shouldRetirePoolForRss(limit + 1, limit)).toBe(true);
  });

  it('never retires when limit is 0', () => {
    expect(shouldRetirePoolForRss(10_000_000_000, 0)).toBe(false);
  });
});
