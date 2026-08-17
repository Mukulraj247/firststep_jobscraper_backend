import https from 'https';

/**
 * Hosts where Chromium consistently fails with net::ERR_HTTP2_PROTOCOL_ERROR
 * while plain HTTP/1.1 (Node https) succeeds. Keep this list tiny and evidence-backed.
 */
const HTTP2_UNRELIABLE_HOSTS = new Set(['careers.persistent.com']);

export function isHttp2ProtocolNavigationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /\bERR_HTTP2_PROTOCOL_ERROR\b/i.test(message);
}

function hostnameForLog(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname || 'invalid-url';
  } catch {
    return 'invalid-url';
  }
}

function parseEnvTriState(raw: unknown): boolean | null {
  if (raw == null) return null;
  const value = String(raw).trim().toLowerCase();
  if (!value) return null;
  if (value === '1' || value === 'true' || value === 'yes' || value === 'on') return true;
  if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false;
  return null;
}

/**
 * Decide whether Chromium should launch with `--disable-http2`.
 * Env override wins: CHROMIUM_DISABLE_HTTP2=true|false.
 * Otherwise only known-broken hosts are opted in.
 */
export function shouldDisableChromiumHttp2(
  rawUrl: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const forced = parseEnvTriState(env.CHROMIUM_DISABLE_HTTP2);
  if (forced != null) return forced;
  if (!rawUrl) return false;
  try {
    const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
    return HTTP2_UNRELIABLE_HOSTS.has(host);
  } catch {
    return false;
  }
}

/** Build a run-log-safe HTTP/1.1 probe summary without paths or query values. */
export function summarizeHttp11Probe(rawUrl: string, statusCode: number): string {
  return `host=${hostnameForLog(rawUrl)} status=${statusCode}`;
}

/**
 * Probe the same target through Node's HTTPS client, which uses HTTP/1.1.
 * This is diagnostic only: failures are summarized rather than propagated so
 * the scraper's existing retry policy remains authoritative.
 */
export async function probeHttp11(rawUrl: string, timeoutMs = 10_000): Promise<string> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'host=invalid-url result=invalid-url';
  }

  if (url.protocol !== 'https:') {
    return `host=${hostnameForLog(rawUrl)} result=unsupported-protocol`;
  }

  return new Promise((resolve) => {
    const request = https.get(
      url,
      {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': 'Mozilla/5.0 (compatible; ScoutX navigation diagnostic)',
        },
      },
      (response) => {
        response.resume();
        resolve(summarizeHttp11Probe(rawUrl, response.statusCode || 0));
      }
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy();
      resolve(`host=${hostnameForLog(rawUrl)} result=timeout`);
    });
    request.once('error', (error: NodeJS.ErrnoException) => {
      resolve(`host=${hostnameForLog(rawUrl)} result=error:${error.code || 'unknown'}`);
    });
  });
}
