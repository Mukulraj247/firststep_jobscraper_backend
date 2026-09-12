import axios from 'axios';
import { useAuth0 } from '@auth0/auth0-react';
import { useCallback } from 'react';
import { apiUrl } from '../apiConfig';
import { isScoutXAuth0Configured } from './ScoutXAuth0Provider';

const PORTAL_AUTH_KEY = 'scouttext.portal.auth';
export const SCOUTX_SKIP_AUTO_EXCHANGE_KEY = 'scoutx.skipAuth0Exchange';

/**
 * Clear ScoutX cookie + local session. Call Auth0 logout when configured
 * so /login does not immediately re-exchange and bounce back into the app.
 */
export async function clearScoutXLocalSession(): Promise<void> {
  try {
    await axios.get(`${apiUrl}/auth/logout`, { withCredentials: true });
  } catch {
    // Cookie may already be gone — still clear client state.
  }
  window.localStorage.removeItem('user');
  window.localStorage.removeItem(PORTAL_AUTH_KEY);
  window.sessionStorage.setItem(SCOUTX_SKIP_AUTO_EXCHANGE_KEY, '1');
}

export function shouldSkipAuth0AutoExchange(): boolean {
  return window.sessionStorage.getItem(SCOUTX_SKIP_AUTO_EXCHANGE_KEY) === '1';
}

export function clearSkipAuth0AutoExchange(): void {
  window.sessionStorage.removeItem(SCOUTX_SKIP_AUTO_EXCHANGE_KEY);
}

/**
 * Ops NavBar / AuthProvider logout. Must run under Auth0Provider when Auth0 is on.
 *
 * Note: Auth0 env is fixed at build time, so the hook branch never flips mid-session.
 */
export function useScoutXLogout() {
  const auth0Configured = isScoutXAuth0Configured();
  if (auth0Configured) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useScoutXLogoutWithAuth0();
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useScoutXLogoutLocalOnly();
}

function useScoutXLogoutLocalOnly() {
  return useCallback(async () => {
    await clearScoutXLocalSession();
    window.location.assign('/login');
  }, []);
}

function useScoutXLogoutWithAuth0() {
  const { logout: auth0Logout, isAuthenticated } = useAuth0();

  return useCallback(async () => {
    await clearScoutXLocalSession();
    if (isAuthenticated) {
      await auth0Logout({
        logoutParams: {
          returnTo: `${window.location.origin}/login`,
        },
      });
      return;
    }
    window.location.assign('/login');
  }, [auth0Logout, isAuthenticated]);
}
