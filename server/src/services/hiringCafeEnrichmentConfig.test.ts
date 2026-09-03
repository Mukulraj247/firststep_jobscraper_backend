import { afterEach, describe, expect, it } from 'vitest';
import {
  resolveHiringCafeScrapeDoFromConfig,
  resolveHiringCafeScrapeDoFromEnv,
} from './hiringCafeEnrichmentConfig';

describe('hiringCafeEnrichmentConfig', () => {
  afterEach(() => {
    delete process.env.SCRAPE_DO_TOKEN;
    delete process.env.HIRING_CAFE_SCRAPE_DO_ENABLED;
    delete process.env.HIRING_CAFE_SCRAPE_DO_MAX_TIER;
  });

  it('returns null when Scrape.do is disabled on the robot', () => {
    expect(
      resolveHiringCafeScrapeDoFromConfig({
        hiringCafeEnrichment: { scrapeDoEnabled: false, scrapeDoToken: 'abc' },
      })
    ).toBeNull();
  });

  it('resolves per-robot token when enabled', () => {
    const opts = resolveHiringCafeScrapeDoFromConfig({
      hiringCafeEnrichment: { scrapeDoEnabled: true, scrapeDoToken: 'robot-token', scrapeDoMaxTier: 3 },
    });
    expect(opts).toEqual({ enabled: true, token: 'robot-token', maxTier: 3 });
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
});
