import logger from '../logger';
import { getDecryptedProxyConfig, normalizeProxyServer } from './proxyConfig';

export interface ProxyProfile {
  server: string;
  username?: string;
  password?: string;
}

/** When false, scrapers ignore env/user/robot proxy config (credentials can stay in .env). */
export const isScraperProxyEnabled = (): boolean => {
  const raw = String(process.env.SCRAPER_PROXY_ENABLED ?? 'true').trim().toLowerCase();
  return !(raw === 'false' || raw === '0' || raw === 'no' || raw === 'off');
};

let loggedProxyDisabled = false;

export const resolveProxyPool = async (
  userId: string,
  runtimeConfig?: Record<string, any>
): Promise<ProxyProfile[]> => {
  if (!isScraperProxyEnabled()) {
    if (!loggedProxyDisabled) {
      loggedProxyDisabled = true;
      logger.log(
        'info',
        'SCRAPER_PROXY_ENABLED=false — scraper will not use proxies (env / user / robot pool ignored)'
      );
    }
    return [];
  }

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

  const unique = new Map<string, ProxyProfile>();
  pool.forEach((proxy) => unique.set(`${proxy.server}:${proxy.username || ''}`, proxy));
  return Array.from(unique.values());
};

export const selectRotatedProxy = (pool: ProxyProfile[], attempt: number): ProxyProfile | null => {
  if (pool.length === 0) return null;
  const selected = pool[attempt % pool.length];
  logger.log('info', `Selected rotated proxy ${selected.server} for attempt ${attempt + 1}`);
  return selected;
};
