import { Auth0Provider } from '@auth0/auth0-react';
import React, { useCallback, useMemo } from 'react';

const domain = import.meta.env.VITE_AUTH0_DOMAIN as string | undefined;
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID as string | undefined;
const audience = import.meta.env.VITE_AUTH0_AUDIENCE as string | undefined;
const redirectUri =
  (import.meta.env.VITE_AUTH0_CALLBACK_URL as string | undefined) ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173');

export function isScoutXAuth0Configured(): boolean {
  return !!(domain && clientId);
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
 */
export function ScoutXAuth0Provider({ children }: { children: React.ReactNode }) {
  const onRedirectCallback = useCallback((appState?: { returnTo?: string }) => {
    const path = resolvePostLoginPath(appState);
    window.history.replaceState({}, document.title, path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);

  const authorizationParams = useMemo(
    () => ({
      redirect_uri: redirectUri,
      audience: audience || undefined,
      scope: 'openid profile email',
    }),
    []
  );

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
