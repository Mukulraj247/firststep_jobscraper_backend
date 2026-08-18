import http from 'node:http';
import https from 'node:https';
import { IncomingMessage } from 'node:http';
import { URL } from 'node:url';
import {
  MAX_OUTBOUND_REDIRECTS,
  SafeOutboundTarget,
  UnsafeOutboundUrlError,
  resolveSafeOutboundUrl,
} from '../utils/outboundUrlPolicy';

type PinnedLookupCallback = (error: NodeJS.ErrnoException | null, address: string, family: number) => void;
type LookupAddress = { address: string; family: number };

export function createPinnedLookup(address: string, family: number) {
  return (_hostname: string, _options: unknown, callback: PinnedLookupCallback): void => {
    callback(null, address, family);
  };
}

const canonicalAddress = (address: string): string =>
  address.toLowerCase().replace(/^::ffff:/, '').replace(/^\[|\]$/g, '');

export function assertPinnedPeerAddress(expected: string, actual: string | undefined): void {
  if (!actual || canonicalAddress(expected) !== canonicalAddress(actual)) {
    throw new UnsafeOutboundUrlError('Outbound connection peer did not match the validated address');
  }
}

export interface SafeHttpResponse {
  status: number;
  statusText: string;
  headers: Headers;
  body: { cancel: () => Promise<void> };
  text: (maxBytes?: number) => Promise<string>;
}

export interface SafeOutboundHttpOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxRedirects?: number;
  /**
   * Tests may replace only the pinned request operation. Production always uses
   * the built-in transport below, which pins Agent DNS lookup to a validated IP.
   */
  transport?: (target: SafeOutboundTarget, input: SafeOutboundHttpOptions) => Promise<SafeHttpResponse>;
  resolve?: (hostname: string) => Promise<LookupAddress[]>;
}

async function readBounded(stream: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    const finish = () => resolve(Buffer.concat(chunks).toString('utf8'));
    stream.on('data', (chunk: Buffer) => {
      const remaining = maxBytes - size;
      if (remaining <= 0) {
        stream.destroy();
        return;
      }
      const bounded = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      chunks.push(bounded);
      size += bounded.length;
      if (chunk.length > bounded.length || size >= maxBytes) stream.destroy();
    });
    stream.once('end', finish);
    stream.once('close', finish);
    stream.once('error', reject);
  });
}

async function requestPinned(target: SafeOutboundTarget, options: SafeOutboundHttpOptions): Promise<SafeHttpResponse> {
  const address = target.addresses[0];
  if (!address) throw new UnsafeOutboundUrlError('Outbound URL hostname could not be resolved');
  const isHttps = target.url.protocol === 'https:';
  const Agent = isHttps ? https.Agent : http.Agent;
  const agent = new Agent({
    keepAlive: false,
    lookup: createPinnedLookup(address.address, address.family),
    ...(isHttps ? { servername: target.url.hostname } : {}),
  } as any);

  return new Promise((resolve, reject) => {
    let settled = false;
    const complete = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const request = (isHttps ? https : http).request(
      target.url,
      {
        method: options.method || 'GET',
        headers: options.headers,
        agent,
        servername: isHttps ? target.url.hostname : undefined,
      },
      (response) => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(response.headers)) {
          if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
        }
        complete(() =>
          resolve({
            status: response.statusCode || 0,
            statusText: response.statusMessage || '',
            headers,
            body: {
              cancel: async () => {
                response.destroy();
              },
            },
            text: (maxBytes = 4096) => readBounded(response, maxBytes),
          })
        );
      }
    );
    const validatePeer = () => {
      try {
        assertPinnedPeerAddress(address.address, request.socket?.remoteAddress);
      } catch (error) {
        request.destroy(error as Error);
      }
    };
    request.once(isHttps ? 'socket' : 'socket', (socket) => {
      socket.once(isHttps ? 'secureConnect' : 'connect', validatePeer);
    });
    request.setTimeout(options.timeoutMs || 30_000, () =>
      request.destroy(new Error('Outbound request timed out'))
    );
    request.once('error', (error) => complete(() => reject(error)));
    if (options.body) request.write(options.body);
    request.end();
  });
}

async function resolveTarget(
  rawUrl: string,
  resolve?: SafeOutboundHttpOptions['resolve']
): Promise<SafeOutboundTarget> {
  if (!resolve) return resolveSafeOutboundUrl(rawUrl);
  const target = await resolveSafeOutboundUrl(rawUrl, { resolveDns: false });
  if (target.addresses.length) return target;
  const addresses = await resolve(target.url.hostname);
  if (!addresses.length) throw new UnsafeOutboundUrlError('Outbound URL hostname could not be resolved');
  // Re-use policy validation against every supplied test/runtime answer.
  for (const answer of addresses) {
    await resolveSafeOutboundUrl(`${target.url.protocol}//${answer.address}`, { resolveDns: false });
  }
  return { ...target, addresses };
}

const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export async function requestSafeOutboundUrl(
  rawUrl: string,
  options: SafeOutboundHttpOptions = {}
): Promise<SafeHttpResponse> {
  let url = rawUrl;
  let method = options.method || 'GET';
  let body = options.body;
  const maxRedirects = options.maxRedirects ?? MAX_OUTBOUND_REDIRECTS;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const target = await resolveTarget(url, options.resolve);
    const response = options.transport
      ? await options.transport(target, { ...options, method, body })
      : await requestPinned(target, { ...options, method, body });
    if (!redirectStatuses.has(response.status) || !response.headers.get('location')) return response;

    // Always close the current response before accepting or recording redirect failure.
    await response.body.cancel().catch(() => undefined);
    if (hop === maxRedirects) throw new Error(`Outbound redirect limit of ${maxRedirects} exceeded`);
    const next = new URL(response.headers.get('location')!, target.url);
    url = next.toString();
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
      method = 'GET';
      body = undefined;
    }
  }
  throw new Error(`Outbound redirect limit of ${maxRedirects} exceeded`);
}
