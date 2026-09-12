import { useState, useContext, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth0 } from '@auth0/auth0-react';
import { AuthContext } from '../context/auth';
import { Box, Typography, Button, CircularProgress, Alert } from '@mui/material';
import { useGlobalInfoStore } from '../context/globalInfo';
import { useTranslation } from 'react-i18next';
import { useThemeMode } from '../context/theme-provider';
import ScoutXLogo from '../assets/scoutx-logo.png';
import { isScoutXAuth0Configured } from '../auth/ScoutXAuth0Provider';
import { exchangeAuth0Token, landingPathForRoles } from '../auth/scoutxAuth';
import {
  clearSkipAuth0AutoExchange,
  shouldSkipAuth0AutoExchange,
} from '../auth/scoutxLogout';

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

  useEffect(() => {
    if (!sessionUser) return;
    if (Array.isArray(sessionUser.scoutxRoles)) {
      navigate(landingPathForRoles(sessionUser.scoutxRoles));
      return;
    }
    navigate('/dashboard');
  }, [sessionUser, navigate]);

  const runExchange = async (opts?: { force?: boolean }) => {
    if (sessionUser) return;
    if (exchanging) return;
    if (!opts?.force && exchangeOnceRef.current) return;
    exchangeOnceRef.current = true;
    setExchanging(true);
    setAuthError(null);
    try {
      const accessToken = await withTimeout(
        getAccessTokenSilently({
          authorizationParams: {
            audience: import.meta.env.VITE_AUTH0_AUDIENCE,
            scope: 'openid profile email',
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

  useEffect(() => {
    if (isLoading || !isAuthenticated || sessionUser) return;
    if (shouldSkipAuth0AutoExchange()) return;
    void runExchange();
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
                audience: import.meta.env.VITE_AUTH0_AUDIENCE,
                scope: 'openid profile email',
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
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh', px: 3 }}>
      <Box
        sx={{
          maxWidth: 480,
          textAlign: 'center',
          p: 4,
          borderRadius: 3,
          bgcolor: darkMode ? '#121111' : '#fff',
          boxShadow: 3,
        }}
      >
        <Typography variant="h5" sx={{ mb: 1, fontWeight: 700 }}>
          Auth0 is not configured
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          Set <code>VITE_AUTH0_DOMAIN</code> and <code>VITE_AUTH0_CLIENT_ID</code> in ScoutX{' '}
          <code>.env</code> (same values as First Step development). Password login is disabled.
        </Typography>
      </Box>
    </Box>
  );
}

const Login = () => (isScoutXAuth0Configured() ? <LoginAuth0Only /> : <LoginAuth0Missing />);

export default Login;
