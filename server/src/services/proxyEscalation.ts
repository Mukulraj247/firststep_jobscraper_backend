import { isProxyTunnelFailure } from './scraperIdentity';

/** Why the next attempt may (or may not) attach a residential / UI / env proxy. */
export type ScraperRetryReason = 'captcha' | 'block' | 'proxy-tunnel' | 'network';

export type ProxyEscalationKind = 'blockLike' | 'networkOrOom' | 'proxyTunnel';

const OOM_RE =
  /out of memory|oom\b|ENOMEM|Cannot allocate memory|JavaScript heap out of memory|killed \(oom\)|low[_ ]?memory/i;

const NETWORK_RE =
  /net::ERR_FAILED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_CONNECTION_REFUSED|ERR_CONNECTION_TIMED_OUT|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_ADDRESS_UNREACHABLE|ERR_TIMED_OUT|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/i;

const BLOCK_RE =
  /captcha|cloudflare|challenge|access denied|blocked|forbidden|anti-?bot|verification required|attention required|just a moment|Target page, context or browser has been closed|browser has been closed|empty\/blocked|empty extraction|soft.?block/i;

/**
 * Classify a scrape failure so we only spend proxy on block-like signals.
 * Order: tunnel → OOM → other network → block-like → default network (save spend).
 */
export const classifyProxyEscalation = (
  message: string,
  opts?: { isCaptcha?: boolean }
): ProxyEscalationKind => {
  if (opts?.isCaptcha) return 'blockLike';
  const text = String(message || '');
  if (isProxyTunnelFailure(text)) return 'proxyTunnel';
  if (OOM_RE.test(text)) return 'networkOrOom';
  if (NETWORK_RE.test(text)) return 'networkOrOom';
  if (BLOCK_RE.test(text)) return 'blockLike';
  // Navigation timeouts without challenge markers: do not burn proxy.
  if (/timeout|timed out/i.test(text)) return 'networkOrOom';
  return 'networkOrOom';
};

export const retryReasonFromEscalation = (kind: ProxyEscalationKind): ScraperRetryReason => {
  switch (kind) {
    case 'blockLike':
      return 'block';
    case 'proxyTunnel':
      return 'proxy-tunnel';
    default:
      return 'network';
  }
};

/** Attach UI/env proxy only after block/captcha escalate, or when the robot remembers needsProxy. */
export const isProxyAllowedForAttempt = (opts: {
  attemptsMade: number;
  needsProxy?: boolean;
  retryReason?: ScraperRetryReason | string | null;
}): boolean => {
  if (opts.needsProxy) return true;
  if (opts.attemptsMade < 1) return false;
  const reason = opts.retryReason;
  return reason === 'captcha' || reason === 'block';
};

/**
 * True when at least one last-resort proxy candidate exists (UI/robot pool or env).
 * If none, callers should keep the normal direct scrape path.
 */
export const hasConfiguredLastResortProxy = (opts: {
  robotProxyAvailable?: boolean;
  envProxyAvailable?: boolean;
}): boolean => !!(opts.robotProxyAvailable || opts.envProxyAvailable);
