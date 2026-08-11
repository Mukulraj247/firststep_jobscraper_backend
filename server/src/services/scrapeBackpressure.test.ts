import { describe, expect, it, beforeEach } from 'vitest';
import {
  applyJitter,
  computeScrapeRetryDelayMs,
  getHostBreaker,
  hostnameFromUrl,
  HostCircuitBreaker,
  loadScrapeBackpressureConfig,
  recordHostFailure,
  recordHostSuccess,
  resetHostBreakersForTests,
} from './scrapeBackpressure';

describe('hostnameFromUrl', () => {
  it('parses hostnames', () => {
    expect(hostnameFromUrl('https://Careers.Example.com/jobs?x=1')).toBe('careers.example.com');
  });
  it('returns null for garbage', () => {
    expect(hostnameFromUrl('not-a-url')).toBeNull();
    expect(hostnameFromUrl('')).toBeNull();
    expect(hostnameFromUrl(null)).toBeNull();
  });
});

describe('computeScrapeRetryDelayMs', () => {
  const cfg = loadScrapeBackpressureConfig({
    SCRAPE_RETRY_DELAYS_MS: '30000,120000,600000',
    SCRAPE_RETRY_JITTER_RATIO: '0.2',
  });

  it('uses ~30s band for first retry', () => {
    const d = computeScrapeRetryDelayMs(0, cfg, () => 0.5);
    expect(d).toBeGreaterThanOrEqual(24_000);
    expect(d).toBeLessThanOrEqual(36_000);
  });

  it('uses ~120s band for second retry', () => {
    const d = computeScrapeRetryDelayMs(1, cfg, () => 0.5);
    expect(d).toBeGreaterThanOrEqual(96_000);
    expect(d).toBeLessThanOrEqual(144_000);
  });

  it('clamps to last band for high attempts', () => {
    const d = computeScrapeRetryDelayMs(99, cfg, () => 0.5);
    expect(d).toBeGreaterThanOrEqual(480_000);
    expect(d).toBeLessThanOrEqual(720_000);
  });

  it('respects jitter bounds', () => {
    const low = applyJitter(1000, 0.2, () => 0);
    const high = applyJitter(1000, 0.2, () => 1);
    expect(low).toBe(800);
    expect(high).toBe(1200);
  });
});

describe('HostCircuitBreaker', () => {
  it('opens after threshold failures in window', () => {
    const b = new HostCircuitBreaker(5, 120_000, 600_000);
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i += 1) b.recordFailure(t0 + i);
    expect(b.isOpen(t0 + 10)).toBe(false);
    b.recordFailure(t0 + 5);
    expect(b.isOpen(t0 + 6)).toBe(true);
    expect(b.remainingMs(t0 + 6)).toBeGreaterThan(500_000);
  });

  it('success reduces failure pressure', () => {
    const b = new HostCircuitBreaker(5, 120_000, 600_000);
    b.recordFailure();
    b.recordFailure();
    b.recordSuccess();
    expect(b.getFailureCount()).toBe(1);
  });
});

describe('getHostBreaker registry', () => {
  beforeEach(() => resetHostBreakersForTests());

  it('isolates hosts', () => {
    const cfg = loadScrapeBackpressureConfig({
      SCRAPE_HOST_BREAKER_THRESHOLD: '2',
      SCRAPE_HOST_BREAKER_WINDOW_MS: '60000',
      SCRAPE_HOST_BREAKER_COOLDOWN_MS: '60000',
    });
    const a = getHostBreaker('a.example.com', cfg);
    a.recordFailure();
    a.recordFailure();
    expect(a.isOpen()).toBe(true);
    expect(getHostBreaker('b.example.com', cfg).isOpen()).toBe(false);
  });
});
