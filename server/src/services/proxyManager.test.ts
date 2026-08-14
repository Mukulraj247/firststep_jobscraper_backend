import { afterEach, describe, expect, it, vi } from 'vitest';
import { isScraperProxyEnabled, resolveProxyPool } from './proxyManager';

describe('isScraperProxyEnabled', () => {
  afterEach(() => {
    delete process.env.SCRAPER_PROXY_ENABLED;
  });

  it('defaults to enabled when unset', () => {
    delete process.env.SCRAPER_PROXY_ENABLED;
    expect(isScraperProxyEnabled()).toBe(true);
  });

  it('is disabled when SCRAPER_PROXY_ENABLED=false', () => {
    process.env.SCRAPER_PROXY_ENABLED = 'false';
    expect(isScraperProxyEnabled()).toBe(false);
  });

  it('treats 0/no/off as disabled', () => {
    for (const value of ['0', 'no', 'off', 'FALSE']) {
      process.env.SCRAPER_PROXY_ENABLED = value;
      expect(isScraperProxyEnabled()).toBe(false);
    }
  });
});

describe('resolveProxyPool', () => {
  afterEach(() => {
    delete process.env.SCRAPER_PROXY_ENABLED;
    vi.restoreAllMocks();
  });

  it('returns an empty pool when SCRAPER_PROXY_ENABLED=false even if robot config has proxies', async () => {
    process.env.SCRAPER_PROXY_ENABLED = 'false';
    const pool = await resolveProxyPool('user-1', {
      browserLocation: {
        proxyServer: 'http://31.59.20.176:6754',
        proxyUsername: 'nlmjdqpe',
        proxyPassword: 'secret',
        proxyPool: ['http://other.proxy:8080'],
      },
    });
    expect(pool).toEqual([]);
  });
});
