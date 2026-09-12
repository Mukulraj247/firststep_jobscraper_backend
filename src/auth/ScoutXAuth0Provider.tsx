import { Auth0Provider } from '@auth0/auth0-react';
import { useNavigate } from 'react-router-dom';
import React from 'react';

const domain = import.meta.env.VITE_AUTH0_DOMAIN as string | undefined;
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID as string | undefined;
const audience = import.meta.env.VITE_AUTH0_AUDIENCE as string | undefined;
const redirectUri =
  (import.meta.env.VITE_AUTH0_CALLBACK_URL as string | undefined) ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173');

export function isScoutXAuth0Configured(): boolean {
  return !!(domain && clientId);
}

/**
 * Mirrors First Step Auth0Provider. Only mounts when Auth0 env is present
 * so password-only local runs still work.
 */
export function ScoutXAuth0Provider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();

  if (!isScoutXAuth0Configured()) {
    return <>{children}</>;
  }

  const onRedirectCallback = (appState?: { returnTo?: string }) => {
    navigate(appState?.returnTo || window.location.pathname);
  };

  return (
    <Auth0Provider
      domain={domain!}
      clientId={clientId!}
      authorizationParams={{
        redirect_uri: redirectUri,
        audience: audience || undefined,
        scope: 'openid profile email',
      }}
      useRefreshTokens
      cacheLocation="localstorage"
      onRedirectCallback={onRedirectCallback}
    >
      {children}
    </Auth0Provider>
  );
}
