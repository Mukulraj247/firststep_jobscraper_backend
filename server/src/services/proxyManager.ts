import net from 'net';
import logger from '../logger';
import { getDecryptedProxyConfig, normalizeProxyServer } from './proxyConfig';

export interface ProxyProfile {
  server: string;
  username?: string;
  password?: string;
}

/** When false, account / env proxies are skipped. Per-automation proxy is still resolved
 * into the pool, but the scraper attaches it only on last-resort escalate / needsProxy. */
export const isScraperProxyEnabled = (): boolean => {
  const raw = String(process.env.SCRAPER_PROXY_ENABLED ?? 'true').trim().toLowerCase();
  return !(raw === 'false' || raw === '0' || raw === 'no' || raw === 'off');
};

let loggedProxyDisabled = false;

export const resolveProxyPool = async (
  userId: string,
  runtimeConfig?: Record<string, any>
): Promise<ProxyProfile[]> => {
  const scraperProxyEnabled = isScraperProxyEnabled();
  const browserLocation = runtimeConfig?.browserLocation || {};
  const configuredPool = Array.isArray(browserLocation.proxyPool) ? browserLocation.proxyPool : [];

  const pool: ProxyProfile[] = configuredPool
    .map((server: string) => normalizeProxyServer(server))
    .filter(Boolean)
    .map((server: string) => ({
      server,
      username: browserLocation.proxyUsername || undefined,
      password: browserLocation.proxyPassword || undefined,
    }));

  const explicitProxy = normalizeProxyServer(browserLocation.proxyServer);
  if (explicitProxy) {
    pool.unshift({
      server: explicitProxy,
      username: browserLocation.proxyUsername || undefined,
      password: browserLocation.proxyPassword || undefined,
    });
  }

  if (scraperProxyEnabled) {
    try {
      const userProxy = await getDecryptedProxyConfig(userId);
      const userProxyServer = normalizeProxyServer(userProxy.proxy_url);
      if (userProxyServer) {
        pool.push({
          server: userProxyServer,
          username: userProxy.proxy_username || undefined,
          password: userProxy.proxy_password || undefined,
        });
      }
    } catch (error: any) {
      logger.log('warn', `Unable to resolve stored proxy config for user ${userId}: ${error.message}`);
    }
  } else if (!loggedProxyDisabled) {
    loggedProxyDisabled = true;
    logger.log(
      'info',
      pool.length
        ? 'SCRAPER_PROXY_ENABLED=false — using per-automation proxy only (account / env proxies skipped)'
        : 'SCRAPER_PROXY_ENABLED=false — account / env proxies skipped; set a per-automation proxy to test one robot'
    );
  }

  const unique = new Map<string, ProxyProfile>();
  pool.forEach((proxy) => unique.set(`${proxy.server}:${proxy.username || ''}`, proxy));
  return Array.from(unique.values());
};

export const parseProxyEndpoint = (
  server?: string | null
): { host: string; port: number } | null => {
  const normalized = normalizeProxyServer(server);
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized);
    const port = parsed.port
      ? Number.parseInt(parsed.port, 10)
      : parsed.protocol === 'https:'
        ? 443
        : 80;
    if (!parsed.hostname || !Number.isFinite(port) || port <= 0) return null;
    return { host: parsed.hostname, port };
  } catch {
    return null;
  }
};

const failedProxyKeySet = (excludeServers: string[] = []): Set<string> => {
  const keys = new Set<string>();
  for (const server of excludeServers) {
    const key = normalizeProxyServer(server);
    if (key) keys.add(key);
  }
  return keys;
};

export const selectRotatedProxy = (
  pool: ProxyProfile[],
  attempt: number,
  excludeServers: string[] = []
): ProxyProfile | null => {
  const exclude = failedProxyKeySet(excludeServers);
  const usable =
    exclude.size === 0
      ? pool
      : pool.filter((proxy) => {
          const key = normalizeProxyServer(proxy.server);
          return !!key && !exclude.has(key);
        });
  if (usable.length === 0) return null;
  const selected = usable[attempt % usable.length];
  logger.log('info', `Selected rotated proxy ${selected.server} for attempt ${attempt + 1}`);
  return selected;
};

/** Cheap TCP check before sending a scrape through an HTTP/SOCKS proxy. */
export const probeProxyTcp = async (server: string, timeoutMs = 2500): Promise<boolean> => {
  const endpoint = parseProxyEndpoint(server);
  if (!endpoint) return false;
  const budget = Math.max(200, timeoutMs);

  return new Promise((resolve) => {
    const socket = net.connect({ host: endpoint.host, port: endpoint.port });
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), budget);
    socket.once('connect', () => {
      clearTimeout(timer);
      finish(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      finish(false);
    });
  });
};

/**
 * TCP-open is not enough: last-resort HTTP proxies often accept a socket then
 * fail CONNECT (net::ERR_TUNNEL_CONNECTION_FAILED). Probe the tunnel verb.
 */
const sanitizeConnectHost = (host?: string): string => {
  const trimmed = String(host || '')
    .trim()
    .toLowerCase()
    .replace(/^\.+/, '');
  if (/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(trimmed) && trimmed.includes('.')) {
    return trimmed;
  }
  return 'example.com';
};

export const probeProxyHttpConnect = async (
  server: string,
  timeoutMs = 2500,
  opts?: { connectHost?: string }
): Promise<boolean> => {
  const endpoint = parseProxyEndpoint(server);
  if (!endpoint) return false;
  const normalized = normalizeProxyServer(server) || '';
  if (/^socks/i.test(normalized)) {
    return probeProxyTcp(server, timeoutMs);
  }

  const connectHost = sanitizeConnectHost(opts?.connectHost);
  const budget = Math.max(400, timeoutMs);
  return new Promise((resolve) => {
    const socket = net.connect({ host: endpoint.host, port: endpoint.port });
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), budget);
    socket.once('error', () => finish(false));
    socket.once('connect', () => {
      socket.write(
        `CONNECT ${connectHost}:443 HTTP/1.1\r\nHost: ${connectHost}:443\r\nProxy-Connection: close\r\n\r\n`
      );
    });
    socket.once('data', (buf: Buffer) => {
      const firstLine = buf.toString('utf8').split(/\r?\n/, 1)[0] || '';
      // 200 = tunnel ok; 407/401 = proxy is real (creds may still fail later).
      finish(/HTTP\/\d(?:\.\d)?\s+(200|401|407)\b/i.test(firstLine));
    });
  });
};
