import { normalizeProxyServer } from './proxyConfig';
import type { ProxyProfile } from './proxyManager';

export type RetryIdentityPlan = {
  browserType: 'playwright' | 'camoufox';
  headless: true;
  useStealth: true;
  identityStrategy: string;
  poolIsolationKey: string;
  proxy: ProxyProfile | null;
};

export type RetryIdentityInput = {
  attemptsMade: number;
  selectedProxy: ProxyProfile | null;
  envFallbackProxy: ProxyProfile | null;
  configBrowserType?: string;
  failedProxyServers?: string[];
  sidecarProxyServer?: string | null;
  sidecarProxyReachable?: boolean;
  lastFailureWasProxyTunnel?: boolean;
};

export const isProxyTunnelFailure = (message: string): boolean =>
  /ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED|ERR_PROXY_CONNECTION_REFUSED|ERR_SOCKS_CONNECTION_FAILED/i.test(
    message
  );

export const proxyServerKey = (server?: string | null): string | null =>
  normalizeProxyServer(server);

export const normalizeFailedProxyServers = (input: unknown): string[] => {
  if (!Array.isArray(input)) return [];
  const unique = new Set<string>();
  for (const entry of input) {
    const key = proxyServerKey(typeof entry === 'string' ? entry : '');
    if (key) unique.add(key);
  }
  return Array.from(unique);
};

export const rememberFailedProxy = (
  existing: unknown,
  proxyServer?: string | null
): string[] => {
  const next = normalizeFailedProxyServers(existing);
  const key = proxyServerKey(proxyServer);
  if (key && !next.includes(key)) next.push(key);
  return next;
};

const isFailedProxy = (server: string | null | undefined, failed: string[]): boolean => {
  const key = proxyServerKey(server);
  return !!key && failed.includes(key);
};

const usableProxy = (
  proxy: ProxyProfile | null,
  failed: string[]
): ProxyProfile | null => {
  if (!proxy?.server) return null;
  return isFailedProxy(proxy.server, failed) ? null : proxy;
};

const playwrightDirectAfterTunnel = (attemptsMade: number): RetryIdentityPlan => ({
  browserType: 'playwright',
  headless: true,
  useStealth: true,
  identityStrategy: 'retry-playwright-direct-after-tunnel',
  poolIsolationKey: `direct-after-tunnel-${attemptsMade}`,
  proxy: null,
});

const sidecarBlocksCamoufox = (opts: RetryIdentityInput, failed: string[]): boolean => {
  const sidecar = proxyServerKey(opts.sidecarProxyServer);
  if (!sidecar) return false;
  if (opts.sidecarProxyReachable === false) return true;
  if (isFailedProxy(sidecar, failed)) return true;
  return !!opts.lastFailureWasProxyTunnel;
};

export const captchaRetryIdentity = (opts: RetryIdentityInput): RetryIdentityPlan | null => {
  if (opts.attemptsMade < 1) return null;
  const failed = normalizeFailedProxyServers(opts.failedProxyServers);
  const proxy =
    usableProxy(opts.selectedProxy, failed) || usableProxy(opts.envFallbackProxy, failed);
  return {
    browserType: 'playwright',
    headless: true,
    useStealth: true,
    identityStrategy: 'retry-playwright-residential',
    poolIsolationKey: `captcha-retry-${opts.attemptsMade}`,
    proxy,
  };
};

export const blockRetryIdentity = (opts: RetryIdentityInput): RetryIdentityPlan | null => {
  if (opts.attemptsMade < 1) return null;
  const failed = normalizeFailedProxyServers(opts.failedProxyServers);
  const selected = usableProxy(opts.selectedProxy, failed);
  const envFallback = usableProxy(opts.envFallbackProxy, failed);

  if (sidecarBlocksCamoufox(opts, failed) || opts.lastFailureWasProxyTunnel) {
    if (!selected && !envFallback) {
      return playwrightDirectAfterTunnel(opts.attemptsMade);
    }
    // A surviving robot proxy is still usable in Playwright; Camoufox sidecar
    // would force traffic back through the dead tunnel.
    return {
      browserType: 'playwright',
      headless: true,
      useStealth: true,
      identityStrategy: 'retry-playwright-direct-after-tunnel',
      poolIsolationKey: `direct-after-tunnel-${opts.attemptsMade}`,
      proxy: selected,
    };
  }

  return {
    browserType: 'camoufox',
    headless: true,
    useStealth: true,
    identityStrategy:
      opts.attemptsMade === 1 ? 'retry-camoufox-after-block' : 'retry-camoufox-rotated',
    poolIsolationKey: `camoufox-escalate-${opts.attemptsMade}`,
    proxy: selected || envFallback,
  };
};
