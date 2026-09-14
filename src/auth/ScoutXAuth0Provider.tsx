import { Auth0Provider } from '@auth0/auth0-react';
import React, { useCallback, useMemo } from 'react';
import {
  auth0InsecureOriginHint,
  isAuth0SecureOrigin,
} from './auth0SecureOrigin';

const domain = import.meta.env.VITE_AUTH0_DOMAIN as string | undefined;
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID as string | undefined;
const audience = import.meta.env.VITE_AUTH0_AUDIENCE as string | undefined;
/** Fallback only when `window` is unavailable (tests / SSR). Runtime uses page origin. */
const redirectUriFallback =
  (import.meta.env.VITE_AUTH0_CALLBACK_URL as string | undefined) ||
  'http://localhost:5173';

/** Env vars present (domain + client id). */
export function hasScoutXAuth0Env(): boolean {
  return !!(domain && clientId);
}

/**
 * True only when Auth0Provider is safe to mount.
 * Auth0 SPA SDK crashes on non-secure origins (e.g. http://DROPLET_IP:8080).
 */
export function isScoutXAuth0Configured(): boolean {
  return hasScoutXAuth0Env() && isAuth0SecureOrigin();
}

export function getScoutXAuth0BlockReason(): string | null {
  if (!hasScoutXAuth0Env()) {
    return 'Set VITE_AUTH0_DOMAIN and VITE_AUTH0_CLIENT_ID in ScoutX .env.';
  }
  if (!isAuth0SecureOrigin()) {
    return auth0InsecureOriginHint();
  }
  return null;
}

function urlLooksLikeAuth0Callback(): boolean {
  if (typeof window === 'undefined') return false;
  const q = window.location.search;
  return q.includes('code=') && q.includes('state=');
}

function resolvePostLoginPath(appState?: { returnTo?: string }): string {
  const raw = appState?.returnTo || '/dashboard';
  try {
    const u = new URL(raw, window.location.origin);
    let path = `${u.pathname}${u.search}${u.hash}` || '/dashboard';
    if (path.includes('code=') || path.includes('state=')) {
      path = u.pathname || '/dashboard';
    }
    return path.startsWith('/') ? path : '/dashboard';
  } catch {
    return typeof raw === 'string' && raw.startsWith('/') ? raw.split('?')[0] : '/dashboard';
  }
}

/**
 * Auth0 wrapper. Intentionally does NOT call useNavigate() — subscribing the
 * provider to the router re-rendered the entire app on every route change and
 * amplified job-board / Auth0 startup jank.
 *
 * Post-login navigation uses history.replaceState + popstate so React Router
 * picks up the clean URL without this provider re-rendering on location.
 *
 * redirect_uri always follows the current page origin so localhost and the
 * deployed hostname both work (each must be listed in Auth0 Allowed Callbacks).
 *
 * Never mounts Auth0Provider on insecure origins (bare http://IP) — that throws
 * "auth0-spa-js must run on a secure origin" and white-screens the SPA.
 */
export function ScoutXAuth0Provider({ children }: { children: React.ReactNode }) {
  const onRedirectCallback = useCallback((appState?: { returnTo?: string }) => {
    const path = resolvePostLoginPath(appState);
    window.history.replaceState({}, document.title, path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);

  const authorizationParams = useMemo(() => {
    const origin =
      typeof window !== 'undefined'
        ? window.location.origin
        : redirectUriFallback;
    return {
      redirect_uri: origin,
      audience: audience || undefined,
      scope: 'openid profile email',
    };
  }, []);

  if (!isScoutXAuth0Configured()) {
    return <>{children}</>;
  }

  return (
    <Auth0Provider
      domain={domain!}
      clientId={clientId!}
      authorizationParams={authorizationParams}
      useRefreshTokens
      useRefreshTokensFallback
      cacheLocation="localstorage"
      // Only handle Auth0 code/state when present; ignore unrelated query params.
      skipRedirectCallback={!urlLooksLikeAuth0Callback()}
      onRedirectCallback={onRedirectCallback}
    >
      {children}
    </Auth0Provider>
  );
}
