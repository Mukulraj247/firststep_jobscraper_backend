import { describe, expect, it, vi } from 'vitest';
import {
  assertPinnedPeerAddress,
  assertPinnedPeerInAllowlist,
  createAllowlistLookup,
  createPinnedLookup,
  requestSafeOutboundUrl,
} from './safeOutboundHttp';
import { UnsafeOutboundUrlError } from '../utils/outboundUrlPolicy';

describe('pinned outbound HTTP transport', () => {
  it('uses only a policy-validated address during connection lookup', async () => {
    const lookup = createPinnedLookup('203.0.113.10', 4);
    const callback = vi.fn();

    lookup('hooks.example', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '203.0.113.10', 4);

    const twoArg = vi.fn();
    lookup('hooks.example', twoArg as any);
    expect(twoArg).toHaveBeenCalledWith(null, '203.0.113.10', 4);
  });

  it('returns every validated CDN address when lookup asks for all', () => {
    const lookup = createAllowlistLookup([
      { address: '203.0.113.10', family: 4 },
      { address: '203.0.113.11', family: 4 },
    ]);
    const callback = vi.fn();
    lookup('cdn.example', { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [
      { address: '203.0.113.10', family: 4 },
      { address: '203.0.113.11', family: 4 },
    ]);
  });

  it('refuses a changed peer address', () => {
    expect(() => assertPinnedPeerAddress('203.0.113.10', '10.0.0.8')).toThrow(
      UnsafeOutboundUrlError
    );
  });

  it('allows any DNS-validated CDN address for the same host', () => {
    expect(() =>
      assertPinnedPeerInAllowlist(['203.0.113.10', '203.0.113.11'], '203.0.113.11')
    ).not.toThrow();
    expect(() => assertPinnedPeerInAllowlist(['203.0.113.10'], '10.0.0.8')).toThrow(
      UnsafeOutboundUrlError
    );
  });

  it('rejects a redirect into private space and cancels its body first', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const transport = vi
      .fn()
      .mockResolvedValueOnce({
        status: 302,
        statusText: 'Found',
        headers: new Headers({ location: 'http://169.254.169.254/latest/meta-data' }),
        body: { cancel },
        text: async () => '',
      });

    await expect(
      requestSafeOutboundUrl('https://hooks.example/start', {
        transport,
        resolve: async () => [{ address: '93.184.216.34', family: 4 }],
      })
    ).rejects.toBeInstanceOf(UnsafeOutboundUrlError);
    expect(cancel).toHaveBeenCalledOnce();
  });
});
