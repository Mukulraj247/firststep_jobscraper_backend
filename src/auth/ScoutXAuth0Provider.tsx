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
  'http://localhost:5173/login';

const AUTH0_SCOPE = 'openid profile email offline_access';

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

/** Callback must land on /login — `/` is a React Router Navigate that strips ?code=&state=. */
export function auth0RedirectUri(origin?: string): string {
  const base =
    origin ||
    (typeof window !== 'undefined' ? window.location.origin : '') ||
    redirectUriFallback.replace(/\/login\/?$/, '');
  return `${String(base).replace(/\/+$/, '')}/login`;
}

export function urlLooksLikeAuth0Callback(search?: string): boolean {
  if (typeof window === 'undefined' && search == null) return false;
  const q = search ?? window.location.search;
  return q.includes('code=') && q.includes('state=');
}

function resolvePostLoginPath(appState?: { returnTo?: string }): string {
  // Stay on /login so LoginAuth0Only can exchange the access token for a ScoutX cookie.
  const raw = appState?.returnTo || '/login';
  try {
    const u = new URL(raw, window.location.origin);
    let path = `${u.pathname}${u.search}${u.hash}` || '/login';
    if (path.includes('code=') || path.includes('state=')) {
      path = u.pathname || '/login';
    }
    if (path === '/' || path.startsWith('/?')) return '/login';
    return path.startsWith('/') ? path : '/login';
  } catch {
    return typeof raw === 'string' && raw.startsWith('/') ? raw.split('?')[0] : '/login';
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
 * redirect_uri is always `{origin}/login` so the Auth0 ?code=&state= callback is
 * not eaten by the `/` → `/dashboard` Navigate inside UserRoute.
 */
export function ScoutXAuth0Provider({ children }: { children: React.ReactNode }) {
  // Freeze at first paint — if the URL is cleaned mid-callback, do not flip this to true.
  const skipRedirectCallback = useMemo(
    () => !urlLooksLikeAuth0Callback(),
    []
  );

  const onRedirectCallback = useCallback((appState?: { returnTo?: string }) => {
    const path = resolvePostLoginPath(appState);
    window.history.replaceState({}, document.title, path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);

  const authorizationParams = useMemo(() => {
    return {
      redirect_uri: auth0RedirectUri(),
      audience: audience || undefined,
      scope: AUTH0_SCOPE,
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
      skipRedirectCallback={skipRedirectCallback}
      onRedirectCallback={onRedirectCallback}
    >
      {children}
    </Auth0Provider>
  );
}
