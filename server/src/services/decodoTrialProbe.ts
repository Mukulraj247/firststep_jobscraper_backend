import { normalizeProxyServer } from './proxyConfig';

export interface DecodoProbeConfig {
  server: string;
  username: string;
  password: string;
  url: string;
}

/** Decodo sticky sessions: append `-session-<id>` unless the username already has one. */
export function buildStickyProxyUsername(username: string, sessionId = 'scoutxtrial'): string {
  const trimmed = username.trim();
  if (!trimmed) return trimmed;
  if (/-session-/i.test(trimmed)) return trimmed;
  const safe = String(sessionId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 24) || 'scoutxtrial';
  return `${trimmed}-session-${safe}`;
}

export function parseDecodoProbeEnv(env: NodeJS.ProcessEnv): DecodoProbeConfig {
  const server = normalizeProxyServer(env.DECODO_PROXY_SERVER || env.DECODO_PROBE_SERVER);
  if (!server) {
    throw new Error('Set DECODO_PROXY_SERVER (e.g. gate.decodo.com:7000)');
  }
  const rawUser = String(env.DECODO_PROXY_USERNAME || env.DECODO_PROBE_USERNAME || '').trim();
  const password = String(env.DECODO_PROXY_PASSWORD || env.DECODO_PROBE_PASSWORD || '').trim();
  if (!rawUser || !password) {
    throw new Error('Set DECODO_PROXY_USERNAME and DECODO_PROXY_PASSWORD');
  }
  const url = String(env.DECODO_TEST_URL || env.DECODO_PROBE_URL || '').trim();
  if (!url) {
    throw new Error('Set DECODO_TEST_URL to the one recaptcha careers/list URL');
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('DECODO_TEST_URL must be a valid URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('DECODO_TEST_URL must be http(s)');
  }

  const stickyOff = /^(false|0|no|off)$/i.test(String(env.DECODO_STICKY || 'true').trim());
  const sessionId = String(env.DECODO_SESSION_ID || 'scoutxtrial').trim();
  return {
    server,
    username: stickyOff ? rawUser : buildStickyProxyUsername(rawUser, sessionId),
    password,
    url: parsed.toString(),
  };
}
