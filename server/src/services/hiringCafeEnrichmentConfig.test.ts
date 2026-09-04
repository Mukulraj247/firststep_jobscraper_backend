import { afterEach, describe, expect, it } from 'vitest';
import {
  isCareerBoardScrapeDoEnabled,
  resolveHiringCafeScrapeDoFromConfig,
  resolveHiringCafeScrapeDoFromEnv,
} from './hiringCafeEnrichmentConfig';

describe('hiringCafeEnrichmentConfig', () => {
  afterEach(() => {
    delete process.env.SCRAPE_DO_TOKEN;
    delete process.env.HIRING_CAFE_SCRAPE_DO_ENABLED;
    delete process.env.HIRING_CAFE_SCRAPE_DO_MAX_TIER;
    delete process.env.JOB_ENRICHMENT_SCRAPE_DO_ENABLED;
  });

  it('returns null when Scrape.do is disabled on the robot', () => {
    expect(
      resolveHiringCafeScrapeDoFromConfig({
        hiringCafeEnrichment: { scrapeDoEnabled: false, scrapeDoToken: 'abc' },
      })
    ).toBeNull();
  });

  it('resolves per-robot token when enabled and clamps maxTier 3→2', () => {
    const opts = resolveHiringCafeScrapeDoFromConfig({
      hiringCafeEnrichment: { scrapeDoEnabled: true, scrapeDoToken: 'robot-token', scrapeDoMaxTier: 3 },
    });
    expect(opts).toEqual({ enabled: true, token: 'robot-token', maxTier: 2 });
  });

  it('accepts maxTier 1 for cheap HTML tests', () => {
    const opts = resolveHiringCafeScrapeDoFromConfig({
      hiringCafeEnrichment: { scrapeDoEnabled: true, scrapeDoToken: 't', scrapeDoMaxTier: 1 },
    });
    expect(opts?.maxTier).toBe(1);
  });

  it('falls back to env token when robot enabled but token blank', () => {
    process.env.SCRAPE_DO_TOKEN = 'env-token';
    const opts = resolveHiringCafeScrapeDoFromConfig({
      hiringCafeEnrichment: { scrapeDoEnabled: true },
    });
    expect(opts?.token).toBe('env-token');
  });

  it('resolves env-only when HIRING_CAFE_SCRAPE_DO_ENABLED=true', () => {
    process.env.SCRAPE_DO_TOKEN = 'env-token';
    process.env.HIRING_CAFE_SCRAPE_DO_ENABLED = 'true';
    expect(resolveHiringCafeScrapeDoFromEnv()).toEqual({
      enabled: true,
      token: 'env-token',
      maxTier: 2,
    });
  });

  it('keeps career board scrape.do off by default', () => {
    expect(isCareerBoardScrapeDoEnabled()).toBe(false);
  });

  it('enables career board scrape.do only when explicitly opted in', () => {
    process.env.JOB_ENRICHMENT_SCRAPE_DO_ENABLED = 'true';
    expect(isCareerBoardScrapeDoEnabled()).toBe(true);
  });
});
