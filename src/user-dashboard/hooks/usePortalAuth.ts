import { useCallback, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth0 } from '@auth0/auth0-react';
import type { PortalUser } from '../types';
import { isPublicUserRoute } from '../routeHelpers';
import { isScoutXAuth0Configured } from '../../auth/ScoutXAuth0Provider';
import { exchangeAuth0Token, hasScoutXAdmin, hasScoutXUser } from '../../auth/scoutxAuth';
import {
  clearSkipAuth0AutoExchange,
  shouldSkipAuth0AutoExchange,
} from '../../auth/scoutxLogout';
import { AuthContext } from '../../context/auth';

const PORTAL_AUTH_KEY = 'scouttext.portal.auth';
const AUTH0_ENABLED = isScoutXAuth0Configured();

function readPortalUserFromStorage(): PortalUser | null {
  try {
    const raw = window.localStorage.getItem(PORTAL_AUTH_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PortalUser;
  } catch {
    return null;
  }
}

function writePortalUser(user: PortalUser | null) {
  if (!user) {
    window.localStorage.removeItem(PORTAL_AUTH_KEY);
    return;
  }
  window.localStorage.setItem(PORTAL_AUTH_KEY, JSON.stringify(user));
}

export function usePortalAuth() {
  if (AUTH0_ENABLED) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return usePortalAuthAuth0();
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return usePortalAuthUnavailable();
}

function usePortalAuthUnavailable() {
  const navigate = useNavigate();
  return {
    user: null as PortalUser | null,
    loading: false,
    login: async () => {
      navigate('/login');
    },
    logout: async () => {
      navigate('/login');
    },
    switchDemoPersona: async () => undefined,
    refresh: async () => null,
    authMode: 'unavailable' as const,
  };
}

function usePortalAuthAuth0() {
  const {
    isAuthenticated,
    isLoading: auth0Loading,
    logout: auth0Logout,
    getAccessTokenSilently,
    user: auth0User,
  } = useAuth0();
  const { dispatch } = useContext(AuthContext);
  const [user, setUser] = useState<PortalUser | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    const stored = readPortalUserFromStorage();
    if (stored) {
      setUser(stored);
      return stored;
    }
    setUser(null);
    return null;
  }, []);

  useEffect(() => {
    let cancelled = false;

    const sync = async () => {
      if (auth0Loading) return;

      if (!isAuthenticated) {
        if (!cancelled) {
          setUser(null);
          writePortalUser(null);
          setLoading(false);
        }
        return;
      }

      if (shouldSkipAuth0AutoExchange()) {
        if (!cancelled) setLoading(false);
        return;
      }

      try {
        const accessToken = await Promise.race([
          getAccessTokenSilently({
            authorizationParams: {
              audience: import.meta.env.VITE_AUTH0_AUDIENCE,
              scope: 'openid profile email',
            },
          }),
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('Auth0 token timed out')), 12000)
          ),
        ]);
        const data = await exchangeAuth0Token({
          accessToken,
          email: auth0User?.email,
          name: auth0User?.name,
        });

        if (!hasScoutXUser(data.scoutxRoles)) {
          writePortalUser(null);
          if (!cancelled) {
            setUser(null);
            setLoading(false);
            navigate('/no-access');
          }
          return;
        }

        // ScoutX_Admin always lands on the shared ops console (same scrapers as ops owner).
        // Keep loading=true so PortalGate does not bounce to /login before navigate.
        if (hasScoutXAdmin(data.scoutxRoles)) {
          writePortalUser(null);
          window.localStorage.setItem('user', JSON.stringify(data));
          dispatch({ type: 'LOGIN', payload: data });
          if (!cancelled) {
            navigate('/dashboard', { replace: true });
          }
          return;
        }

        const portalUser: PortalUser = {
          id: String(data.id),
          name: data.name || data.email.split('@')[0],
          email: data.email,
          persona: 'guest',
          auth0Sub: data.auth0Sub || undefined,
          scoutxRoles: data.scoutxRoles,
          firstStepPlan: data.firstStepPlan || null,
          firstStepRole: data.firstStepRole || null,
        };
        writePortalUser(portalUser);
        if (!cancelled) {
          setUser(portalUser);
          setLoading(false);
        }
      } catch (err: any) {
        const code = err?.response?.data?.code;
        if (code === 'auth0.no_scoutx_role') {
          writePortalUser(null);
          if (!cancelled) {
            setUser(null);
            setLoading(false);
            navigate('/no-access');
          }
          return;
        }
        console.error('Portal Auth0 sync failed:', err);
        if (!cancelled) {
          setUser(null);
          setLoading(false);
        }
      }
    };

    void sync();
    return () => {
      cancelled = true;
    };
  }, [auth0Loading, isAuthenticated, getAccessTokenSilently, auth0User, navigate, dispatch]);

  useEffect(() => {
    if (!auth0Loading) return undefined;
    const t = setTimeout(() => setLoading(false), 8000);
    return () => clearTimeout(t);
  }, [auth0Loading]);

  const login = async () => {
    // Single Auth0 entry — role landing happens after exchange on /login.
    clearSkipAuth0AutoExchange();
    navigate('/login');
  };

  const logout = async () => {
    writePortalUser(null);
    window.localStorage.removeItem('user');
    setUser(null);
    await auth0Logout({ logoutParams: { returnTo: `${window.location.origin}/login` } });
  };

  const switchDemoPersona = async () => {
    // Demo personas removed — Auth0 only.
  };

  return { user, loading, login, logout, switchDemoPersona, refresh, authMode: 'auth0' as const };
}

export function useRequirePortalAuth() {
  const { user, loading } = usePortalAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    const path = window.location.pathname;
    if (!user && !isPublicUserRoute(path)) {
      navigate('/login', { replace: true });
    }
  }, [user, loading, navigate]);

  return { user, loading };
}
