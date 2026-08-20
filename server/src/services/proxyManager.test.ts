import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isScraperProxyEnabled,
  parseProxyEndpoint,
  probeProxyTcp,
  resolveProxyPool,
  selectRotatedProxy,
} from './proxyManager';

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

  it('still uses a per-automation proxy when SCRAPER_PROXY_ENABLED=false', async () => {
    process.env.SCRAPER_PROXY_ENABLED = 'false';
    const pool = await resolveProxyPool('user-1', {
      browserLocation: {
        proxyServer: 'http://gate.decodo.com:7000',
        proxyUsername: 'user-trial',
        proxyPassword: 'secret',
      },
    });
    expect(pool).toEqual([
      {
        server: 'http://gate.decodo.com:7000',
        username: 'user-trial',
        password: 'secret',
      },
    ]);
  });

  it('skips account-wide proxy when SCRAPER_PROXY_ENABLED=false and the robot has none', async () => {
    process.env.SCRAPER_PROXY_ENABLED = 'false';
    const pool = await resolveProxyPool('user-1', { browserLocation: {} });
    expect(pool).toEqual([]);
  });
});

describe('selectRotatedProxy', () => {
  const pool = [
    { server: 'http://31.59.20.176:6754' },
    { server: 'http://gate.decodo.com:7000' },
  ];

  it('skips proxies that already failed CONNECT and uses the next one', () => {
    const selected = selectRotatedProxy(pool, 0, ['http://31.59.20.176:6754']);
    expect(selected?.server).toBe('http://gate.decodo.com:7000');
  });

  it('returns null when every proxy in the pool already failed', () => {
    expect(
      selectRotatedProxy(pool, 1, ['http://31.59.20.176:6754', 'http://gate.decodo.com:7000'])
    ).toBeNull();
  });
});

describe('parseProxyEndpoint', () => {
  it('reads host and port from an HTTP proxy URL', () => {
    expect(parseProxyEndpoint('http://31.59.20.176:6754')).toEqual({
      host: '31.59.20.176',
      port: 6754,
    });
  });
});

describe('probeProxyTcp', () => {
  it('returns false when nothing accepts CONNECT on that host:port', async () => {
    await expect(probeProxyTcp('http://127.0.0.1:1', 400)).resolves.toBe(false);
  });
});
