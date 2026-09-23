import { useState, useContext, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth0 } from '@auth0/auth0-react';
import { AuthContext } from '../context/auth';
import { Box, Typography, Button, CircularProgress, Alert } from '@mui/material';
import { useGlobalInfoStore } from '../context/globalInfo';
import { useTranslation } from 'react-i18next';
import { useThemeMode } from '../context/theme-provider';
import ScoutXLogo from '../assets/scoutx-logo.png';
import {
  auth0RedirectUri,
  getScoutXAuth0BlockReason,
  hasScoutXAuth0Env,
  isScoutXAuth0Configured,
  urlLooksLikeAuth0Callback,
} from '../auth/ScoutXAuth0Provider';
import { exchangeAuth0Token, landingPathForRoles } from '../auth/scoutxAuth';
import {
  clearSkipAuth0AutoExchange,
  shouldSkipAuth0AutoExchange,
} from '../auth/scoutxLogout';

const AUTH0_SCOPE = 'openid profile email offline_access';

/** Auth0 silent (`prompt=none`) callbacks land as ?error=… — never treat as success code. */
function auth0UrlError(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return new URLSearchParams(window.location.search).get('error');
  } catch {
    return null;
  }
}

function clearAuth0UrlErrorParams(): void {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('error') && !url.searchParams.has('error_description')) return;
    url.searchParams.delete('error');
    url.searchParams.delete('error_description');
    url.searchParams.delete('state');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* ignore */
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function LoginAuth0Only() {
  const { loginWithRedirect, isAuthenticated, isLoading, getAccessTokenSilently, user, logout } =
    useAuth0();
  const { t } = useTranslation();
  const [exchanging, setExchanging] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authReadyOverride, setAuthReadyOverride] = useState(false);
  const exchangeOnceRef = useRef(false);
  const silentPromptTriedRef = useRef(false);
  const consentInteractiveTriedRef = useRef(false);
  const { notify } = useGlobalInfoStore();
  const { state, dispatch } = useContext(AuthContext);
  const { user: sessionUser } = state;
  const { darkMode } = useThemeMode();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading) return undefined;
    const tmr = setTimeout(() => setAuthReadyOverride(true), 8000);
    return () => clearTimeout(tmr);
  }, [isLoading]);

  // Returning from Auth0 with ?code=&state= — never skip the ScoutX exchange.
  useEffect(() => {
    if (urlLooksLikeAuth0Callback()) {
      clearSkipAuth0AutoExchange();
    }
  }, []);

  // prompt=none cannot show consent UI → Auth0 redirects with ?error=consent_required.
  // Retry once WITHOUT prompt:none so the user can Accept (required on localhost).
  useEffect(() => {
    if (isLoading || sessionUser || isAuthenticated) return;
    const err = auth0UrlError();
    if (!err) return;
    const needsInteractive =
      err === 'consent_required' ||
      err === 'login_required' ||
      err === 'interaction_required';
    if (!needsInteractive) {
      setAuthError(`Auth0: ${err}`);
      return;
    }
    if (consentInteractiveTriedRef.current) {
      setAuthError(
        'Auth0 needs a one-time consent for ScoutX API. Click Continue with Auth0 and Accept.'
      );
      return;
    }
    consentInteractiveTriedRef.current = true;
    silentPromptTriedRef.current = true;
    clearAuth0UrlErrorParams();
    clearSkipAuth0AutoExchange();
    void loginWithRedirect({
      appState: { returnTo: '/login' },
      authorizationParams: {
        redirect_uri: auth0RedirectUri(),
        audience: import.meta.env.VITE_AUTH0_AUDIENCE,
        scope: AUTH0_SCOPE,
        // No prompt: 'none' — must show consent / login UI
      },
    }).catch(() => {
      setAuthError(
        'Auth0 needs a one-time consent for ScoutX API. Click Continue with Auth0 and Accept.'
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, sessionUser, isAuthenticated]);

  // Hydrate ScoutX session from localStorage before Auth0 auto-exchange.
  // Skip while an Auth0 callback is in flight — a stale local user would skip
  // exchange and bounce /dashboard → 401 → /login.
  useEffect(() => {
    if (sessionUser) return;
    if (urlLooksLikeAuth0Callback()) return;
    try {
      const raw = window.localStorage.getItem('user');
      if (!raw) return;
      const stored = JSON.parse(raw);
      if (stored && (stored.id || stored.email)) {
        dispatch({ type: 'LOGIN', payload: stored });
      }
    } catch {
      window.localStorage.removeItem('user');
    }
  }, [sessionUser, dispatch]);

  useEffect(() => {
    if (!sessionUser) return;
    // Wait until Auth0 finishes the redirect callback before leaving /login.
    if (urlLooksLikeAuth0Callback() || isLoading) return;
    if (Array.isArray(sessionUser.scoutxRoles)) {
      navigate(landingPathForRoles(sessionUser.scoutxRoles));
      return;
    }
    navigate('/dashboard');
  }, [sessionUser, navigate, isLoading]);

  const runExchange = async (opts?: { force?: boolean }) => {
    if (sessionUser) return;
    if (exchanging) return;
    if (!opts?.force && exchangeOnceRef.current) return;
    exchangeOnceRef.current = true;
    setExchanging(true);
    setAuthError(null);
    clearSkipAuth0AutoExchange();
    try {
      const accessToken = await withTimeout(
        getAccessTokenSilently({
          authorizationParams: {
            audience: import.meta.env.VITE_AUTH0_AUDIENCE,
            scope: AUTH0_SCOPE,
          },
        }),
        12000,
        'Auth0 getAccessTokenSilently'
      );
      const data = await withTimeout(
        exchangeAuth0Token({
          accessToken,
          email: user?.email,
          name: user?.name,
        }),
        20000,
        'ScoutX Auth0 exchange'
      );
      dispatch({ type: 'LOGIN', payload: data });
      window.localStorage.setItem('user', JSON.stringify(data));
      navigate(data.landing || landingPathForRoles(data.scoutxRoles));
    } catch (err: any) {
      const code = err?.response?.data?.code;
      if (code === 'auth0.no_scoutx_role') {
        navigate('/no-access');
        return;
      }
      // First visit from First Step: Auth0 session exists on Auth0 domain but this
      // origin has empty localStorage — try silent redirect once, then show button.
      const errMsg = String(err?.error || err?.message || '').toLowerCase();
      const errDesc = String(err?.error_description || '').toLowerCase();
      const isConsent =
        errMsg.includes('consent_required') || errDesc.includes('consent_required');
      if (isConsent) {
        exchangeOnceRef.current = false;
        setExchanging(false);
        try {
          await loginWithRedirect({
            appState: { returnTo: '/login' },
            authorizationParams: {
              redirect_uri: auth0RedirectUri(),
              audience: import.meta.env.VITE_AUTH0_AUDIENCE,
              scope: AUTH0_SCOPE,
            },
          });
          return;
        } catch {
          /* fall through */
        }
      }
      const needsSilent =
        !opts?.force &&
        !silentPromptTriedRef.current &&
        !isConsent &&
        (errMsg.includes('login_required') ||
          errMsg.includes('missing refresh') ||
          errMsg.includes('timeout') ||
          errMsg.includes('not authenticated'));
      if (needsSilent) {
        silentPromptTriedRef.current = true;
        exchangeOnceRef.current = false;
        setExchanging(false);
        try {
          await loginWithRedirect({
            appState: { returnTo: '/login' },
            authorizationParams: {
              redirect_uri: auth0RedirectUri(),
              audience: import.meta.env.VITE_AUTH0_AUDIENCE,
              scope: AUTH0_SCOPE,
              prompt: 'none',
            },
          });
          return;
        } catch {
          /* fall through to visible error */
        }
      }
      const msg =
        err?.response?.data?.error ||
        err?.message ||
        'Auth0 session exchange failed. Click Continue with Auth0 again.';
      setAuthError(msg);
      notify('error', msg);
      exchangeOnceRef.current = false;
    } finally {
      setExchanging(false);
    }
  };

  // When Auth0 is already authenticated (shared session from First Step), exchange.
  // When not yet authenticated, attempt silent SSO once so new-tab users skip a click.
  useEffect(() => {
    if (isLoading || sessionUser) return;
    if (shouldSkipAuth0AutoExchange()) return;
    // Do not silent-retry when Auth0 already returned an authorize error.
    if (auth0UrlError()) return;
    if (isAuthenticated) {
      void runExchange();
      return;
    }
    if (silentPromptTriedRef.current || urlLooksLikeAuth0Callback()) return;
    silentPromptTriedRef.current = true;
    void loginWithRedirect({
      appState: { returnTo: '/login' },
      authorizationParams: {
        redirect_uri: auth0RedirectUri(),
        audience: import.meta.env.VITE_AUTH0_AUDIENCE,
        scope: AUTH0_SCOPE,
        prompt: 'none',
      },
    }).catch(() => {
      /* user will see Continue with Auth0 */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, isAuthenticated, sessionUser]);

  if (isLoading && !authReadyOverride) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '60vh',
          gap: 2,
        }}
      >
        <CircularProgress />
        <Typography variant="body2" color="text.secondary">
          Loading Auth0…
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        maxHeight: '100vh',
        mt: 6,
        padding: 4,
        backgroundColor: 'inherit',
      }}
    >
      <Box
        sx={{
          textAlign: 'center',
          backgroundColor: darkMode ? '#121111ff' : '#ffffff',
          color: darkMode ? '#ffffff' : '#333333',
          padding: 6,
          borderRadius: 5,
          boxShadow: '0px 20px 40px rgba(0, 0, 0, 0.2), 0px -5px 10px rgba(0, 0, 0, 0.15)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          maxWidth: 500,
          width: '100%',
        }}
      >
        <img
          src={ScoutXLogo}
          alt="Scout-X"
          height={48}
          style={{
            marginBottom: 20,
            width: 'auto',
            maxHeight: 48,
            objectFit: 'contain',
            display: 'block',
          }}
        />
        <Typography variant="h4" gutterBottom>
          {t('login.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          One Auth0 sign-in for ScoutX. <strong>ScoutX_Admin</strong> opens ops;
          <strong> ScoutX_User</strong> opens the customer portal.
        </Typography>

        {authError && (
          <Alert severity="warning" sx={{ mb: 2, width: '100%', textAlign: 'left' }}>
            {authError}
          </Alert>
        )}

        {exchanging && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">
              Finishing ScoutX sign-in…
            </Typography>
          </Box>
        )}

        <Button
          fullWidth
          variant="contained"
          color="primary"
          sx={{ mt: 1, mb: 1, py: 1.2 }}
          disabled={exchanging}
          onClick={() => {
            clearSkipAuth0AutoExchange();
            loginWithRedirect({
              appState: { returnTo: '/login' },
              authorizationParams: {
                redirect_uri: auth0RedirectUri(),
                audience: import.meta.env.VITE_AUTH0_AUDIENCE,
                scope: AUTH0_SCOPE,
                prompt: authError ? 'login' : undefined,
              },
            });
          }}
        >
          Continue with Auth0
        </Button>

        {isAuthenticated && !sessionUser && (
          <Button
            fullWidth
            variant="outlined"
            sx={{ mb: 1 }}
            disabled={exchanging}
            onClick={() => {
              clearSkipAuth0AutoExchange();
              void runExchange({ force: true });
            }}
          >
            Continue as {user?.email || 'Auth0 user'}
          </Button>
        )}

        {isAuthenticated && (
          <Button
            fullWidth
            variant="text"
            sx={{ mb: 1 }}
            onClick={() =>
              logout({
                logoutParams: { returnTo: `${window.location.origin}/login` },
              })
            }
          >
            Sign out of Auth0 ({user?.email})
          </Button>
        )}
      </Box>
    </Box>
  );
}

function LoginAuth0Missing() {
  const { darkMode } = useThemeMode();
  const insecure = hasScoutXAuth0Env();
  const reason = getScoutXAuth0BlockReason();
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh', px: 3 }}>
      <Box
        sx={{
          maxWidth: 520,
          textAlign: 'center',
          p: 4,
          borderRadius: 3,
          bgcolor: darkMode ? '#121111' : '#fff',
          boxShadow: 3,
        }}
      >
        <Typography variant="h5" sx={{ mb: 1, fontWeight: 700 }}>
          {insecure ? 'Open ScoutX on a secure origin' : 'Auth0 is not configured'}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {reason ||
            'Set VITE_AUTH0_DOMAIN and VITE_AUTH0_CLIENT_ID in ScoutX .env (same values as First Step development). Password login is disabled.'}
        </Typography>
        {insecure ? (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'left' }}>
            Auth0 allows HTTPS hostnames and <code>http://localhost</code> only — not{' '}
            <code>http://IP:8080</code>. Prefer{' '}
            <code>https://scoutx-dev.firststepjob.com</code> or local{' '}
            <code>http://localhost:5173</code>.
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}

const Login = () => (isScoutXAuth0Configured() ? <LoginAuth0Only /> : <LoginAuth0Missing />);

export default Login;
