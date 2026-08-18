import type { NextFunction, Request, RequestHandler, Response } from 'express';
import User from '../models/User';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const normalizePublicOrigin = (publicUrl?: string): string => {
  const fallback = 'http://localhost:5173';
  if (!publicUrl) return fallback;
  try {
    return new URL(publicUrl).origin;
  } catch {
    return fallback;
  }
};

const normalizeRequestOrigin = (value: string): string | undefined => {
  try {
    const origin = new URL(value).origin;
    return origin === 'null' ? undefined : origin;
  } catch {
    return undefined;
  }
};

type CsrfOriginGuardOptions = {
  publicUrl?: string;
  allowedOrigins?: string[];
  verifyApiKey?: (apiKey: string) => Promise<boolean>;
};

const hasAuthenticationCookie = (req: Request): boolean => {
  if (req.cookies?.token) return true;
  const cookieHeader = req.headers.cookie || '';
  return /(?:^|;\s*)(?:token|connect\.sid)=/.test(cookieHeader);
};

const defaultVerifyApiKey = async (apiKey: string): Promise<boolean> =>
  Boolean(await User.exists({ api_key: apiKey }));

export const createCsrfOriginGuard = ({
  publicUrl,
  allowedOrigins = [],
  verifyApiKey = defaultVerifyApiKey,
}: CsrfOriginGuardOptions = {}): RequestHandler => {
  const origins = new Set(
    [
      normalizePublicOrigin(publicUrl ?? process.env.PUBLIC_URL),
      ...allowedOrigins.map(normalizeRequestOrigin).filter((value): value is string => Boolean(value)),
    ]
  );

  return async (req: Request, res: Response, next: NextFunction) => {
    if (!UNSAFE_METHODS.has(req.method.toUpperCase()) || !hasAuthenticationCookie(req)) {
      return next();
    }

    const rawApiKey = req.headers['x-api-key'];
    const apiKey = (Array.isArray(rawApiKey) ? rawApiKey[0] : rawApiKey)?.trim();
    if (apiKey) {
      try {
        if (await verifyApiKey(apiKey)) return next();
      } catch {
        return res.status(503).json({ error: 'Authentication service temporarily unavailable' });
      }
    }

    const origin = req.headers.origin;
    const normalizedOrigin = origin ? normalizeRequestOrigin(origin) : undefined;
    if (!normalizedOrigin || !origins.has(normalizedOrigin)) {
      return res.status(403).json({ error: 'Origin is not allowed for cookie-authenticated mutations' });
    }

    return next();
  };
};
