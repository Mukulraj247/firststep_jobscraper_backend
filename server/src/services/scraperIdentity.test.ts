import { describe, expect, it } from 'vitest';
import {
  blockRetryIdentity,
  captchaRetryIdentity,
  isProxyTunnelFailure,
  rememberFailedProxy,
} from './scraperIdentity';
import { isProxyAllowedForAttempt } from './proxyEscalation';

const residential = {
  server: 'http://gate.decodo.com:7000',
  username: 'user-x',
  password: 'secret',
};

const deadSidecar = { server: 'http://31.59.20.176:6754' };

describe('isProxyTunnelFailure', () => {
  it('detects CONNECT tunnel and proxy connection errors', () => {
    expect(
      isProxyTunnelFailure(
        'page.goto: net::ERR_TUNNEL_CONNECTION_FAILED at https://careers.toyota.com/'
      )
    ).toBe(true);
    expect(isProxyTunnelFailure('net::ERR_PROXY_CONNECTION_FAILED')).toBe(true);
    expect(isProxyTunnelFailure('net::ERR_SOCKS_CONNECTION_FAILED')).toBe(true);
  });

  it('does not treat a site navigation timeout as a proxy failure', () => {
    expect(
      isProxyTunnelFailure('page.goto: Timeout 20000ms exceeded.\nCall log:\n  - navigating')
    ).toBe(false);
  });
});

describe('rememberFailedProxy', () => {
  it('records the proxy that just failed CONNECT so later attempts can skip it', () => {
    expect(rememberFailedProxy([], 'http://31.59.20.176:6754/')).toEqual([
      'http://31.59.20.176:6754',
    ]);
    expect(
      rememberFailedProxy(['http://31.59.20.176:6754'], 'http://31.59.20.176:6754')
    ).toEqual(['http://31.59.20.176:6754']);
  });
});

describe('last-resort proxy attach gate', () => {
  it('does not attach proxy on attempt 0 even when UI/env proxies exist', () => {
    expect(
      isProxyAllowedForAttempt({
        attemptsMade: 0,
        needsProxy: false,
        retryReason: undefined,
      })
    ).toBe(false);
  });

  it('attaches proxy after captcha/block, or when needsProxy is remembered', () => {
    expect(
      isProxyAllowedForAttempt({ attemptsMade: 1, needsProxy: false, retryReason: 'block' })
    ).toBe(true);
    expect(
      isProxyAllowedForAttempt({ attemptsMade: 0, needsProxy: true, retryReason: undefined })
    ).toBe(true);
  });

  it('prefers robot residential over env on captcha retry when allowed', () => {
    expect(
      captchaRetryIdentity({
        attemptsMade: 1,
        selectedProxy: residential,
        envFallbackProxy: { server: 'http://31.59.20.176:6754' },
        configBrowserType: 'playwright',
      })?.proxy
    ).toEqual(residential);
  });
});

describe('captchaRetryIdentity', () => {
  it('does not change identity on the first attempt', () => {
    expect(
      captchaRetryIdentity({
        attemptsMade: 0,
        selectedProxy: residential,
        envFallbackProxy: null,
        configBrowserType: 'playwright',
      })
    ).toBeNull();
  });

  it('retries Playwright with the robot residential proxy so list extraction can continue after the challenge is gone', () => {
    expect(
      captchaRetryIdentity({
        attemptsMade: 1,
        selectedProxy: residential,
        envFallbackProxy: { server: 'http://31.59.20.176:6754' },
        configBrowserType: 'playwright',
      })
    ).toEqual({
      browserType: 'playwright',
      headless: true,
      useStealth: true,
      identityStrategy: 'retry-playwright-residential',
      poolIsolationKey: 'captcha-retry-1',
      proxy: residential,
    });
  });

  it('falls back to env proxy when the robot has none', () => {
    const plan = captchaRetryIdentity({
      attemptsMade: 2,
      selectedProxy: null,
      envFallbackProxy: { server: 'http://gate.decodo.com:7000' },
      configBrowserType: 'playwright',
    });
    expect(plan?.identityStrategy).toBe('retry-playwright-residential');
    expect(plan?.proxy).toEqual({ server: 'http://gate.decodo.com:7000' });
    expect(plan?.poolIsolationKey).toBe('captcha-retry-2');
  });

  it('does not attach env proxy after CONNECT probe marked it failed (Yahoo captcha retry)', () => {
    const plan = captchaRetryIdentity({
      attemptsMade: 1,
      selectedProxy: null,
      envFallbackProxy: deadSidecar,
      configBrowserType: 'playwright',
      failedProxyServers: ['http://31.59.20.176:6754'],
    });
    expect(plan?.identityStrategy).toBe('retry-playwright-residential');
    expect(plan?.proxy).toBeNull();
  });

  it('does not reuse an env proxy that already failed CONNECT', () => {
    const plan = captchaRetryIdentity({
      attemptsMade: 2,
      selectedProxy: null,
      envFallbackProxy: deadSidecar,
      configBrowserType: 'playwright',
      failedProxyServers: ['http://31.59.20.176:6754'],
    });
    expect(plan?.proxy).toBeNull();
    expect(plan?.browserType).toBe('playwright');
  });
});

describe('blockRetryIdentity', () => {
  it('does not change identity on the first attempt', () => {
    expect(
      blockRetryIdentity({
        attemptsMade: 0,
        selectedProxy: null,
        envFallbackProxy: deadSidecar,
        configBrowserType: 'playwright',
      })
    ).toBeNull();
  });

  it('after a tunnel failure, retries Playwright with no proxy instead of Camoufox through the same dead tunnel', () => {
    expect(
      blockRetryIdentity({
        attemptsMade: 2,
        selectedProxy: deadSidecar,
        envFallbackProxy: deadSidecar,
        configBrowserType: 'playwright',
        failedProxyServers: ['http://31.59.20.176:6754'],
        sidecarProxyServer: 'http://31.59.20.176:6754',
        lastFailureWasProxyTunnel: true,
      })
    ).toEqual({
      browserType: 'playwright',
      headless: true,
      useStealth: true,
      identityStrategy: 'retry-playwright-direct-after-tunnel',
      poolIsolationKey: 'direct-after-tunnel-2',
      proxy: null,
    });
  });

  it('skips Camoufox when the sidecar proxy is unreachable so a dead CAMOUFOX_PROXY cannot burn the retry', () => {
    const plan = blockRetryIdentity({
      attemptsMade: 1,
      selectedProxy: null,
      envFallbackProxy: deadSidecar,
      configBrowserType: 'playwright',
      sidecarProxyServer: 'http://31.59.20.176:6754',
      sidecarProxyReachable: false,
    });
    expect(plan).toEqual({
      browserType: 'playwright',
      headless: true,
      useStealth: true,
      identityStrategy: 'retry-playwright-direct-after-tunnel',
      poolIsolationKey: 'direct-after-tunnel-1',
      proxy: null,
    });
  });

  it('still escalates to Camoufox when the sidecar has no proxy', () => {
    expect(
      blockRetryIdentity({
        attemptsMade: 1,
        selectedProxy: null,
        envFallbackProxy: null,
        configBrowserType: 'playwright',
      })
    ).toEqual({
      browserType: 'camoufox',
      headless: true,
      useStealth: true,
      identityStrategy: 'retry-camoufox-after-block',
      poolIsolationKey: 'camoufox-escalate-1',
      proxy: null,
    });
  });

  it('still skips Camoufox after a tunnel failure even if the sidecar probe previously looked healthy', () => {
    const plan = blockRetryIdentity({
      attemptsMade: 2,
      selectedProxy: null,
      envFallbackProxy: deadSidecar,
      configBrowserType: 'playwright',
      failedProxyServers: ['http://31.59.20.176:6754'],
      sidecarProxyServer: 'http://31.59.20.176:6754',
      sidecarProxyReachable: true,
      lastFailureWasProxyTunnel: true,
    });
    expect(plan?.identityStrategy).toBe('retry-playwright-direct-after-tunnel');
    expect(plan?.browserType).toBe('playwright');
    expect(plan?.proxy).toBeNull();
  });
});
