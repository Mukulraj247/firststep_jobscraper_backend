import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createCsrfOriginGuard } from './csrfOriginGuard';

const invoke = async ({
  method = 'POST',
  origin,
  cookie = 'token=session-token',
  apiKey,
  isProduction = true,
  allowedExtensionOrigins,
  verifyApiKey = vi.fn().mockResolvedValue(false),
}: {
  method?: string;
  origin?: string;
  cookie?: string;
  apiKey?: string;
  isProduction?: boolean;
  allowedExtensionOrigins?: string;
  verifyApiKey?: (apiKey: string) => Promise<boolean>;
}) => {
  const req = {
    method,
    headers: {
      ...(origin ? { origin } : {}),
      ...(cookie ? { cookie } : {}),
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    },
    cookies: cookie ? { token: 'session-token' } : {},
  } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  const guard = createCsrfOriginGuard({
    publicUrl: 'https://app.example.com/dashboard',
    allowedExtensionOrigins,
    isProduction,
    verifyApiKey,
  });

  await guard(req, res, next);
  return { res, next, verifyApiKey };
};

describe('csrfOriginGuard', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    it(`rejects cookie-authenticated ${method} without an Origin`, async () => {
      const { res, next } = await invoke({ method });

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
  }

  it('rejects a cookie-authenticated mutation from a disallowed origin', async () => {
    const { res, next } = await invoke({ origin: 'https://evil.example' });

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an opaque Origin even when the public URL uses the local fallback', async () => {
    const req = {
      method: 'POST',
      headers: { origin: 'null', cookie: 'token=session-token' },
      cookies: { token: 'session-token' },
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
    const next = vi.fn();

    await createCsrfOriginGuard({ publicUrl: 'http://localhost:5173' })(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('permits the normalized public origin', async () => {
    const { res, next } = await invoke({ origin: 'https://app.example.com' });

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('permits a valid API key without Origin', async () => {
    const verifyApiKey = vi.fn().mockResolvedValue(true);
    const { res, next } = await invoke({ apiKey: 'valid-key', verifyApiKey });

    expect(verifyApiKey).toHaveBeenCalledWith('valid-key');
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('does not let an invalid API key bypass the cookie origin check', async () => {
    const verifyApiKey = vi.fn().mockResolvedValue(false);
    const { res, next } = await invoke({ apiKey: 'invalid-key', verifyApiKey });

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('permits server-to-server mutations without cookies', async () => {
    const { res, next } = await invoke({ cookie: '' });

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('permits safe cookie-authenticated methods without Origin', async () => {
    const { res, next } = await invoke({ method: 'GET' });

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  const extensionOrigin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

  it('permits a Chrome extension origin in local development', async () => {
    const { res, next } = await invoke({ origin: extensionOrigin, isProduction: false });

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects a Chrome extension origin in production without an allowlist', async () => {
    const { res, next } = await invoke({ origin: extensionOrigin, isProduction: true });

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('permits an allowlisted Chrome extension origin in production', async () => {
    const { res, next } = await invoke({
      origin: extensionOrigin,
      isProduction: true,
      allowedExtensionOrigins: `${extensionOrigin}/`,
    });

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects an invalid Chrome extension origin even in local development', async () => {
    const { res, next } = await invoke({
      origin: 'chrome-extension://not-an-extension-id',
      isProduction: false,
    });

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
