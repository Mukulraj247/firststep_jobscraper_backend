import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lookupMock = vi.hoisted(() => vi.fn());

vi.mock('node:dns/promises', () => ({
  lookup: lookupMock,
}));

import {
  MAX_OUTBOUND_REDIRECTS,
  UnsafeOutboundUrlError,
  assertSafeOutboundUrl,
  createUnsafeOutboundUrlResponse,
  safeOutboundUrlLogLabel,
} from './outboundUrlPolicy';
import { postJsonWithRetry } from '../services/destinations';
import { normalizeAutomationUrl } from './automationUrl';
import {
  installOutboundBrowserContextGuard,
  installOutboundNavigationGuard,
  runListExtraction,
} from '../services/listExtractor';

const publicAddress = '93.184.216.34';

const mockPublicDns = () => {
  lookupMock.mockImplementation(async (hostname: string) => {
    if (hostname === 'private.example') {
      return [{ address: '10.0.0.8', family: 4 }];
    }
    if (hostname === 'mixed.example') {
      return [
        { address: publicAddress, family: 4 },
        { address: '169.254.169.254', family: 4 },
      ];
    }
    return [{ address: publicAddress, family: 4 }];
  });
};

describe('assertSafeOutboundUrl', () => {
  beforeEach(() => {
    lookupMock.mockReset();
    mockPublicDns();
  });

  it('allows a public HTTPS URL', async () => {
    await expect(assertSafeOutboundUrl('https://careers.example.com/jobs')).resolves.toMatchObject({
      protocol: 'https:',
      hostname: 'careers.example.com',
    });
  });

  it.each([
    ['localhost', 'http://localhost/admin'],
    ['localhost subdomain', 'http://service.localhost/admin'],
    ['IPv4 unspecified', 'http://0.0.0.0/'],
    ['IPv4 loopback', 'http://127.0.0.1:3000/'],
    ['RFC1918 10/8', 'http://10.0.0.8/'],
    ['RFC1918 172.16/12', 'http://172.31.255.255/'],
    ['RFC1918 192.168/16', 'http://192.168.1.1/'],
    ['CGNAT/shared', 'http://100.100.100.200/'],
    ['link-local metadata', 'http://169.254.169.254/latest/meta-data'],
    ['benchmark/test', 'http://198.18.0.1/'],
    ['IETF reserved IPv4', 'http://192.0.0.9/'],
    ['TEST-NET-1', 'http://192.0.2.1/'],
    ['TEST-NET-2', 'http://198.51.100.1/'],
    ['TEST-NET-3', 'http://203.0.113.1/'],
    ['multicast', 'http://224.0.0.1/'],
    ['reserved IPv4', 'http://240.0.0.1/'],
    ['IPv6 unspecified', 'http://[::]/'],
    ['IPv6 loopback', 'http://[::1]/'],
    ['IPv6 unique-local', 'http://[fc00::1]/'],
    ['IPv6 link-local', 'http://[fe80::1]/'],
    ['IPv6 multicast', 'http://[ff02::1]/'],
    ['IPv6 documentation', 'http://[2001:db8::1]/'],
    ['IPv6 protocol-assignment reserved', 'http://[2001:100::1]/'],
    ['IPv4-mapped loopback', 'http://[::ffff:127.0.0.1]/'],
    ['IPv4-mapped RFC1918', 'http://[::ffff:10.0.0.1]/'],
    ['IPv4-mapped metadata', 'http://[::ffff:169.254.169.254]/'],
    ['metadata hostname', 'http://metadata.google.internal/computeMetadata/v1/'],
  ])('blocks %s', async (_label, url) => {
    await expect(assertSafeOutboundUrl(url, { resolveDns: false })).rejects.toBeInstanceOf(
      UnsafeOutboundUrlError
    );
  });

  it.each(['ftp://example.com/file', 'file:///etc/passwd', 'data:text/plain,hello'])(
    'rejects non-HTTP protocol %s',
    async (url) => {
      await expect(assertSafeOutboundUrl(url, { resolveDns: false })).rejects.toBeInstanceOf(
        UnsafeOutboundUrlError
      );
    }
  );

  it('rejects embedded URL credentials without echoing the secret URL', async () => {
    const raw = 'https://user:super-secret@example.com/';
    const error = await assertSafeOutboundUrl(raw, { resolveDns: false }).catch((value) => value);

    expect(error).toBeInstanceOf(UnsafeOutboundUrlError);
    expect(error.message).not.toContain(raw);
    expect(error.message).not.toContain('super-secret');
  });

  it('blocks a hostname resolving only to private space', async () => {
    await expect(assertSafeOutboundUrl('https://private.example/path')).rejects.toBeInstanceOf(
      UnsafeOutboundUrlError
    );
  });

  it('blocks a hostname when any DNS answer is unsafe', async () => {
    await expect(assertSafeOutboundUrl('https://mixed.example/path')).rejects.toBeInstanceOf(
      UnsafeOutboundUrlError
    );
  });

  it('returns the required safe configuration error DTO', () => {
    const response = createUnsafeOutboundUrlResponse(
      'targetUrl',
      new UnsafeOutboundUrlError('Outbound URL points to a blocked network address')
    );

    expect(response).toEqual({
      status: 400,
      body: {
        code: 'UNSAFE_OUTBOUND_URL',
        field: 'targetUrl',
        error: 'Outbound URL points to a blocked network address',
      },
    });
  });

  it('creates a log label without URL credentials, path, query, or fragment', () => {
    expect(
      safeOutboundUrlLogLabel('https://user:secret@example.com:8443/private?api_key=secret#token')
    ).toBe('https://example.com:8443');
  });
});

describe('SSRF-safe webhook delivery', () => {
  beforeEach(() => {
    lookupMock.mockReset();
    mockPublicDns();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('allows a safe redirect after validating each hop', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(
        {
          status: 302, statusText: 'Found', headers: new Headers({ location: 'https://hooks.example/final' }),
          body: { cancel: vi.fn().mockResolvedValue(undefined) }, text: async () => '',
        }
      )
      .mockResolvedValueOnce({
          status: 200, statusText: 'OK', headers: new Headers(),
          body: { cancel: vi.fn().mockResolvedValue(undefined) }, text: async () => 'accepted',
        });

    const result = await postJsonWithRetry('https://redirector.example/start', { ok: true }, {
      attempts: 1,
      transport,
      resolve: async () => [{ address: publicAddress, family: 4 }],
    });

    expect(result.bodyText).toBe('accepted');
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('blocks a redirect to private space before sending the redirected request', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const transport = vi.fn().mockResolvedValueOnce({
      status: 302, statusText: 'Found', headers: new Headers({ location: 'http://169.254.169.254/latest/meta-data' }),
      body: { cancel }, text: async () => '',
    });

    await expect(
      postJsonWithRetry('https://redirector.example/start', { ok: true }, {
        attempts: 1, transport, resolve: async () => [{ address: publicAddress, family: 4 }],
      })
    ).rejects.toBeInstanceOf(UnsafeOutboundUrlError);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('enforces the redirect cap', async () => {
    const transport = vi.fn(async (target: any) => {
      const current = target.url;
      const hop = Number(current.searchParams.get('hop') || '0');
      return {
        status: 302, statusText: 'Found', headers: new Headers({ location: `https://redirector.example/path?hop=${hop + 1}` }),
        body: { cancel: vi.fn().mockResolvedValue(undefined) }, text: async () => '',
      };
    });

    await expect(
      postJsonWithRetry('https://redirector.example/path?hop=0', {}, {
        attempts: 1, transport, resolve: async () => [{ address: publicAddress, family: 4 }],
      })
    ).rejects.toThrow(/redirect/i);
    expect(transport).toHaveBeenCalledTimes(MAX_OUTBOUND_REDIRECTS + 1);
  });

  it('bounds retained webhook response text', async () => {
    const transport = vi.fn().mockResolvedValue({
      status: 200, statusText: 'OK', headers: new Headers(),
      body: { cancel: vi.fn().mockResolvedValue(undefined) }, text: async (max: number) => 'x'.repeat(max),
    });

    const result = await postJsonWithRetry('https://hooks.example/final', {}, {
      attempts: 1, transport, resolve: async () => [{ address: publicAddress, family: 4 }],
    });

    expect(result.bodyText.length).toBeLessThanOrEqual(4096);
  });

  it('does not expose webhook response secrets in thrown errors', async () => {
    const transport = vi.fn().mockResolvedValue({
      status: 401, statusText: 'Unauthorized', headers: new Headers(),
      body: { cancel: vi.fn().mockResolvedValue(undefined) }, text: async () => 'api_key=do-not-log-me',
    });

    const error = await postJsonWithRetry('https://hooks.example/final', {}, {
      attempts: 1, transport, resolve: async () => [{ address: publicAddress, family: 4 }],
    }).catch(
      (value) => value
    );

    expect(error.message).toContain('HTTP 401');
    expect(error.message).not.toContain('do-not-log-me');
    expect(error.message).not.toContain('api_key');
  });

  it('keeps the timeout active while reading a webhook response body', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const transport = vi.fn().mockResolvedValue({
      status: 200, statusText: 'OK', headers: new Headers(), body: { cancel },
      text: async () => new Promise<string>(() => {}),
    });

    await expect(
      postJsonWithRetry('https://hooks.example/final', {}, {
        attempts: 1, timeoutMs: 5, transport, resolve: async () => [{ address: publicAddress, family: 4 }],
      })
    ).rejects.toThrow(/timed out/i);
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe('automation URL compatibility', () => {
  it('keeps existing automation URL normalization behavior untouched', () => {
    expect(normalizeAutomationUrl('https://https://example.com/a')).toBe('https://example.com/a');
    expect(normalizeAutomationUrl('example.com/jobs')).toBe('https://example.com/jobs');
  });
});

describe('Playwright navigation enforcement', () => {
  beforeEach(() => {
    lookupMock.mockReset();
    mockPublicDns();
  });

  it('aborts a redirected navigation request to a blocked address', async () => {
    let handler: ((route: any) => Promise<void>) | undefined;
    const page = {
      route: vi.fn(async (_pattern: string, callback: (route: any) => Promise<void>) => {
        handler = callback;
      }),
      unroute: vi.fn(),
    };
    const dispose = await installOutboundNavigationGuard(page as any);
    const route = {
      request: () => ({
        isNavigationRequest: () => true,
        url: () => 'http://169.254.169.254/latest/meta-data',
      }),
      abort: vi.fn(),
      continue: vi.fn(),
    };

    await handler?.(route);

    expect(route.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(route.continue).not.toHaveBeenCalled();
    await dispose();
    expect(page.unroute).toHaveBeenCalled();
  });

  it('continues a navigation request to a public address', async () => {
    let handler: ((route: any) => Promise<void>) | undefined;
    const page = {
      route: vi.fn(async (_pattern: string, callback: (route: any) => Promise<void>) => {
        handler = callback;
      }),
      unroute: vi.fn(),
    };
    const dispose = await installOutboundNavigationGuard(page as any);
    const route = {
      request: () => ({
        isNavigationRequest: () => true,
        url: () => 'https://careers.example.com/jobs',
      }),
      abort: vi.fn(),
      continue: vi.fn(),
    };

    await handler?.(route);

    expect(route.continue).toHaveBeenCalledOnce();
    expect(route.abort).not.toHaveBeenCalled();
    await dispose();
  });

  it('aborts a private HTTP subresource request', async () => {
    let handler: ((route: any) => Promise<void>) | undefined;
    const page = {
      route: vi.fn(async (_pattern: string, callback: (route: any) => Promise<void>) => {
        handler = callback;
      }),
      unroute: vi.fn(),
    };
    const dispose = await installOutboundNavigationGuard(page as any);
    const route = {
      request: () => ({
        isNavigationRequest: () => false,
        url: () => 'http://127.0.0.1/internal.js',
      }),
      abort: vi.fn(),
      continue: vi.fn(),
    };

    await handler?.(route);

    expect(route.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(route.continue).not.toHaveBeenCalled();
    await dispose();
  });

  it('guards interpreter replacement pages through the browser context before requests continue', async () => {
    let handler: ((route: any) => Promise<void>) | undefined;
    const context = {
      route: vi.fn(async (_pattern: string, callback: (route: any) => Promise<void>) => {
        handler = callback;
      }),
      unroute: vi.fn(),
    };
    const dispose = await installOutboundBrowserContextGuard(context as any);
    const route = {
      request: () => ({ url: () => 'http://10.0.0.8/replaced-page.js' }),
      abort: vi.fn(),
      continue: vi.fn(),
    };

    await handler?.(route);

    expect(route.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(route.continue).not.toHaveBeenCalled();
    await dispose();
    expect(context.unroute).toHaveBeenCalled();
  });

  it('aborts private HTTP(S) requests from a popup/sibling page in the same browser context', async () => {
    let handler: ((route: any) => Promise<void>) | undefined;
    const context = {
      route: vi.fn(async (_pattern: string, callback: (route: any) => Promise<void>) => {
        handler = callback;
      }),
      unroute: vi.fn(),
    };
    const mainPage = { context: () => context, route: vi.fn(), unroute: vi.fn() };
    const popupSibling = { context: () => context, route: vi.fn(), unroute: vi.fn() };

    const dispose = await installOutboundBrowserContextGuard(mainPage.context() as any);

    for (const url of ['http://127.0.0.1/secret.js', 'https://169.254.169.254/latest/meta-data']) {
      const route = {
        request: () => ({ url: () => url }),
        abort: vi.fn(),
        continue: vi.fn(),
      };
      await handler?.(route);
      expect(route.abort).toHaveBeenCalledWith('blockedbyclient');
      expect(route.continue).not.toHaveBeenCalled();
    }

    expect(context.route).toHaveBeenCalledWith('**/*', expect.any(Function));
    expect(mainPage.route).not.toHaveBeenCalled();
    expect(popupSibling.route).not.toHaveBeenCalled();
    await dispose();
    expect(context.unroute).toHaveBeenCalled();
  });

  it('runListExtraction installs the outbound guard on page.context() and disposes it', async () => {
    const context = {
      route: vi.fn(async () => {}),
      unroute: vi.fn(async () => {}),
    };
    const page = {
      on: vi.fn(),
      off: vi.fn(),
      route: vi.fn(async () => {}),
      unroute: vi.fn(async () => {}),
      context: () => context,
      goto: vi.fn(async () => {
        throw new Error('stop-after-guard-install');
      }),
    };

    await expect(
      runListExtraction(page as any, 'https://careers.example.com/jobs', {
        itemSelector: '.job',
        fields: { title: 'h1' },
      })
    ).rejects.toThrow('stop-after-guard-install');

    expect(context.route).toHaveBeenCalledWith('**/*', expect.any(Function));
    expect(page.route).not.toHaveBeenCalled();
    expect(context.unroute).toHaveBeenCalled();
  });
});
