import { useEffect } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth0 } from '@auth0/auth0-react';
import { useThemeMode } from '../context/theme-provider';
import ScoutXLogo from '../assets/scoutx-logo.png';
import { isScoutXAuth0Configured } from '../auth/ScoutXAuth0Provider';
import { clearSkipAuth0AutoExchange } from '../auth/scoutxLogout';

/**
 * Ops registration via email/password is disabled.
 * New users sign up through Auth0 (First Step tenant) and land on /user or ops by role.
 */
const Register = () => {
  const navigate = useNavigate();
  const { darkMode } = useThemeMode();
  const auth0On = isScoutXAuth0Configured();

  if (!auth0On) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8, px: 3 }}>
        <Typography>Auth0 is not configured. Cannot register.</Typography>
      </Box>
    );
  }

  return <RegisterWithAuth0 darkMode={darkMode} navigate={navigate} />;
};

function RegisterWithAuth0({
  darkMode,
  navigate,
}: {
  darkMode: boolean;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const { loginWithRedirect, isAuthenticated } = useAuth0();

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/login', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        mt: 6,
        padding: 4,
      }}
    >
      <Box
        sx={{
          textAlign: 'center',
          backgroundColor: darkMode ? '#121111ff' : '#ffffff',
          color: darkMode ? '#ffffff' : '#333333',
          padding: 6,
          borderRadius: 5,
          boxShadow: '0px 20px 40px rgba(0, 0, 0, 0.2)',
          maxWidth: 480,
          width: '100%',
        }}
      >
        <img
          src={ScoutXLogo}
          alt="Scout-X"
          height={48}
          style={{ marginBottom: 20, objectFit: 'contain' }}
        />
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
          Create an account with Auth0
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          ScoutX uses the First Step Auth0 tenant. Password registration is disabled. After Auth0
          signup, ScoutX_Admin opens ops and ScoutX_User opens the customer portal.
        </Typography>
        <Button
          fullWidth
          variant="contained"
          color="primary"
          sx={{ py: 1.2, mb: 2 }}
          onClick={() => {
            clearSkipAuth0AutoExchange();
            loginWithRedirect({
              appState: { returnTo: '/login' },
              authorizationParams: {
                audience: import.meta.env.VITE_AUTH0_AUDIENCE,
                scope: 'openid profile email',
                screen_hint: 'signup',
              },
            });
          }}
        >
          Continue with Auth0
        </Button>
        <Typography variant="body2">
          Already have an account?{' '}
          <Link to="/login" style={{ color: '#ff33cc', textDecoration: 'none' }}>
            Sign in
          </Link>
        </Typography>
      </Box>
    </Box>
  );
}

export default Register;
