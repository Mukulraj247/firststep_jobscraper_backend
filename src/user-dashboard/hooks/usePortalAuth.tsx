import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth0 } from '@auth0/auth0-react';
import type { PortalUser } from '../types';
import { isPublicUserRoute } from '../routeHelpers';
import { isScoutXAuth0Configured, auth0RedirectUri } from '../../auth/ScoutXAuth0Provider';
import { exchangeAuth0Token, hasScoutXAdmin, hasScoutXUser } from '../../auth/scoutxAuth';
import {
  clearSkipAuth0AutoExchange,
  shouldSkipAuth0AutoExchange,
} from '../../auth/scoutxLogout';
import { AuthContext } from '../../context/auth';
import { setPortalAccessTokenGetter } from '../api/portalApi';

const PORTAL_AUTH_KEY = 'scouttext.portal.auth';
const AUTH0_ENABLED = isScoutXAuth0Configured();

type PortalAuthValue = {
  user: PortalUser | null;
  loading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  switchDemoPersona: () => Promise<void>;
  refresh: () => Promise<PortalUser | null>;
  authMode: 'auth0' | 'unavailable';
};

const PortalAuthContext = createContext<PortalAuthValue | null>(null);

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

function PortalAuthUnavailableProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const value = useMemo<PortalAuthValue>(
    () => ({
      user: null,
      loading: false,
      login: async () => {
        navigate('/login');
      },
      logout: async () => {
        navigate('/login');
      },
      switchDemoPersona: async () => undefined,
      refresh: async () => null,
      authMode: 'unavailable',
    }),
    [navigate]
  );
  return <PortalAuthContext.Provider value={value}>{children}</PortalAuthContext.Provider>;
}

function PortalAuth0ProviderInner({ children }: { children: React.ReactNode }) {
  const {
    isAuthenticated,
    isLoading: auth0Loading,
    logout: auth0Logout,
    getAccessTokenSilently,
    loginWithRedirect,
    user: auth0User,
  } = useAuth0();
  const { dispatch } = useContext(AuthContext);
  const [user, setUser] = useState<PortalUser | null>(() => readPortalUserFromStorage());
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const auth0Sub = auth0User?.sub || null;
  const auth0Email = auth0User?.email || null;
  const auth0Name = auth0User?.name || null;
  const syncGenRef = useRef(0);
  const syncedSubRef = useRef<string | null>(null);
  const consentRedirectTriedRef = useRef(false);
  const getTokenRef = useRef(getAccessTokenSilently);
  getTokenRef.current = getAccessTokenSilently;

  const refresh = useCallback(async () => {
    const stored = readPortalUserFromStorage();
    if (stored) {
      setUser(stored);
      return stored;
    }
    setUser(null);
    return null;
  }, []);

  // Register the Bearer token getter once for the whole portal tree.
  // Do not clear on child remounts — that caused /api/portal/* 401s.
  useEffect(() => {
    setPortalAccessTokenGetter(async () => {
      try {
        return await getTokenRef.current({
          authorizationParams: {
            audience: import.meta.env.VITE_AUTH0_AUDIENCE,
            scope: 'openid profile email offline_access',
          },
        });
      } catch {
        return null;
      }
    });
    return () => setPortalAccessTokenGetter(null);
  }, []);

  useEffect(() => {
    if (auth0Loading) return;

    if (!isAuthenticated) {
      syncedSubRef.current = null;
      setUser(null);
      writePortalUser(null);
      setLoading(false);
      return;
    }

    if (shouldSkipAuth0AutoExchange()) {
      setLoading(false);
      return;
    }

    // Already synced this Auth0 subject — show portal immediately.
    const stored = readPortalUserFromStorage();
    if (
      auth0Sub &&
      syncedSubRef.current === auth0Sub &&
      stored?.auth0Sub === auth0Sub
    ) {
      setUser(stored);
      setLoading(false);
      return;
    }
    if (auth0Sub && stored?.auth0Sub === auth0Sub) {
      setUser(stored);
      setLoading(false);
      // Still refresh exchange below, but UI is not blocked.
    }

    const gen = ++syncGenRef.current;
    let cancelled = false;

    const sync = async () => {
      try {
        const accessToken = await Promise.race([
          getTokenRef.current({
            authorizationParams: {
              audience: import.meta.env.VITE_AUTH0_AUDIENCE,
              scope: 'openid profile email offline_access',
            },
          }),
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('Auth0 token timed out')), 12000)
          ),
        ]);
        const data = await Promise.race([
          exchangeAuth0Token({
            accessToken,
            email: auth0Email,
            name: auth0Name,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('ScoutX exchange timed out')), 20000)
          ),
        ]);

        if (cancelled || gen !== syncGenRef.current) return;

        if (!hasScoutXUser(data.scoutxRoles)) {
          writePortalUser(null);
          setUser(null);
          setLoading(false);
          navigate('/no-access');
          return;
        }

        // ScoutX_Admin always lands on the shared ops console.
        if (hasScoutXAdmin(data.scoutxRoles)) {
          writePortalUser(null);
          window.localStorage.setItem('user', JSON.stringify(data));
          dispatch({ type: 'LOGIN', payload: data });
          setLoading(false);
          navigate('/dashboard', { replace: true });
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
        syncedSubRef.current = data.auth0Sub || auth0Sub;
        setUser(portalUser);
        setLoading(false);
      } catch (err: any) {
        if (cancelled || gen !== syncGenRef.current) return;
        const code = err?.response?.data?.code;
        if (code === 'auth0.no_scoutx_role') {
          writePortalUser(null);
          setUser(null);
          setLoading(false);
          navigate('/no-access');
          return;
        }

        const errBlob = `${err?.error || ''} ${err?.error_description || ''} ${err?.message || ''}`.toLowerCase();
        const needsConsent =
          errBlob.includes('consent_required') ||
          errBlob.includes('login_required') ||
          errBlob.includes('interaction_required');

        // First Step session may exist, but ScoutX API audience still needs a one-time consent.
        if (needsConsent && !consentRedirectTriedRef.current) {
          consentRedirectTriedRef.current = true;
          clearSkipAuth0AutoExchange();
          try {
            await loginWithRedirect({
              appState: { returnTo: '/login' },
              authorizationParams: {
                redirect_uri: auth0RedirectUri(),
                audience: import.meta.env.VITE_AUTH0_AUDIENCE,
                scope: 'openid profile email offline_access',
              },
            });
            return;
          } catch (redirectErr) {
            console.error('Portal Auth0 consent redirect failed:', redirectErr);
          }
        }

        console.error('Portal Auth0 sync failed:', err);
        // Keep a matching stored user so refresh does not blank the portal.
        const fallback = readPortalUserFromStorage();
        if (fallback && (!auth0Sub || fallback.auth0Sub === auth0Sub)) {
          setUser(fallback);
        } else {
          setUser(null);
        }
        setLoading(false);
      }
    };

    void sync();
    return () => {
      cancelled = true;
    };
  }, [
    auth0Loading,
    isAuthenticated,
    auth0Sub,
    auth0Email,
    auth0Name,
    navigate,
    dispatch,
    loginWithRedirect,
  ]);

  useEffect(() => {
    if (!auth0Loading) return undefined;
    const t = setTimeout(() => setLoading(false), 8000);
    return () => clearTimeout(t);
  }, [auth0Loading]);

  const login = useCallback(async () => {
    clearSkipAuth0AutoExchange();
    navigate('/login');
  }, [navigate]);

  const logout = useCallback(async () => {
    writePortalUser(null);
    window.localStorage.removeItem('user');
    syncedSubRef.current = null;
    setUser(null);
    await auth0Logout({ logoutParams: { returnTo: `${window.location.origin}/login` } });
  }, [auth0Logout]);

  const switchDemoPersona = useCallback(async () => {
    // Demo personas removed — Auth0 only.
  }, []);

  const value = useMemo<PortalAuthValue>(
    () => ({
      user,
      loading,
      login,
      logout,
      switchDemoPersona,
      refresh,
      authMode: 'auth0',
    }),
    [user, loading, login, logout, switchDemoPersona, refresh]
  );

  return <PortalAuthContext.Provider value={value}>{children}</PortalAuthContext.Provider>;
}

/** Single auth source for the portal tree — wrap once in UserDashboardShell. */
export function PortalAuthProvider({ children }: { children: React.ReactNode }) {
  if (!AUTH0_ENABLED) {
    return <PortalAuthUnavailableProvider>{children}</PortalAuthUnavailableProvider>;
  }
  return <PortalAuth0ProviderInner>{children}</PortalAuth0ProviderInner>;
}

export function usePortalAuth(): PortalAuthValue {
  const ctx = useContext(PortalAuthContext);
  if (!ctx) {
    throw new Error('usePortalAuth must be used within PortalAuthProvider');
  }
  return ctx;
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
