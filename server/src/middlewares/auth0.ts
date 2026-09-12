import { NextFunction, Request, Response } from 'express';
import { auth } from 'express-oauth2-jwt-bearer';

export type Auth0Request = Request & {
  auth?: {
    payload?: Record<string, unknown>;
    header?: Record<string, unknown>;
    token?: string;
  };
};

let jwtCheck: ReturnType<typeof auth> | null = null;
let jwtCheckKey: string | null = null;

function getAuth0Domain(): string {
  return String(process.env.AUTH0_DOMAIN || '').trim();
}

function getSpaClientId(): string {
  return String(process.env.AUTH0_SPA_CLIENT_ID || process.env.AUTH0_CLIENT_ID || '').trim();
}

function getApiAudience(): string {
  return String(process.env.AUTH0_API_AUDIENCE || process.env.AUTH0_AUDIENCE || '').trim();
}

function getJwtCheck(): ReturnType<typeof auth> | null {
  const domain = getAuth0Domain();
  const clientId = getSpaClientId();
  const apiAudience = getApiAudience();

  // Prefer the custom ScoutX API audience (RBAC). SPA client id is a fallback for ID-token style aud.
  if (!domain || (!apiAudience && !clientId)) {
    return null;
  }

  const audiences = [...new Set([apiAudience, clientId].filter(Boolean))];
  const key = `${domain}|${audiences.join(',')}`;
  if (!jwtCheck || jwtCheckKey !== key) {
    jwtCheckKey = key;
    jwtCheck = auth({
      issuerBaseURL: `https://${domain}`,
      audience: audiences.length === 1 ? audiences[0] : audiences,
      tokenSigningAlg: 'RS256',
    });
  }

  return jwtCheck;
}

export function isAuth0Configured(): boolean {
  return !!(getAuth0Domain() && getSpaClientId());
}

/**
 * Validates Auth0 access token (Bearer). Does not set ScoutX Mongo `req.user`.
 * Use after this middleware in the exchange route.
 */
export const requireAuth0AccessToken = (req: Auth0Request, res: Response, next: NextFunction) => {
  const verifier = getJwtCheck();
  if (!verifier) {
    res.status(503).json({
      error:
        'Auth0 is not configured. Set AUTH0_DOMAIN and AUTH0_SPA_CLIENT_ID (and AUTH0_API_AUDIENCE) on the server.',
      code: 'auth0.not_configured',
    });
    return;
  }

  verifier(req, res, (err?: unknown) => {
    if (err) {
      console.error('Auth0 JWT verification failed:', err);
      return res.status(401).json({
        error: 'Invalid or expired Auth0 access token',
        code: 'auth0.invalid_token',
      });
    }
    return next();
  });
};
