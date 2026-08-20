import { describe, expect, it } from 'vitest';
import { mapOpsDigestSendResult, opsDigestStatusBody } from './opsDigestHttp';

describe('mapOpsDigestSendResult', () => {
  it('returns 400 when the digest is skipped', () => {
    expect(
      mapOpsDigestSendResult({
        ok: false,
        skipped: true,
        reason: 'ZeptoMail is not configured.',
      }),
    ).toEqual({
      httpStatus: 400,
      body: {
        success: false,
        skipped: true,
        reason: 'ZeptoMail is not configured.',
      },
    });
  });

  it('returns 502 when send fails', () => {
    expect(mapOpsDigestSendResult({ ok: false, error: 'timeout' })).toEqual({
      httpStatus: 502,
      body: { success: false, error: 'timeout' },
    });
  });

  it('returns the last-6h summary on success', () => {
    const mapped = mapOpsDigestSendResult({
      ok: true,
      requestId: 'req-1',
      payload: {
        generatedAt: '2026-08-19T12:00:00.000Z',
        windows: {
          last6h: { total: 10, passed: 8, failed: 2 },
        },
      } as any,
    });
    expect(mapped.httpStatus).toBe(200);
    expect(mapped.body).toEqual({
      success: true,
      requestId: 'req-1',
      summary: {
        generatedAt: '2026-08-19T12:00:00.000Z',
        last6h: { total: 10, passed: 8, failed: 2 },
      },
    });
  });
});

describe('opsDigestStatusBody', () => {
  it('always includes the scheduled interval label', () => {
    const body = opsDigestStatusBody({
      enabled: true,
      zeptoConfigured: true,
      recipients: ['a@b.com'],
      canSend: true,
    });
    expect(body.interval).toBe('6 hours');
    expect(body.recipients).toEqual(['a@b.com']);
  });
});
