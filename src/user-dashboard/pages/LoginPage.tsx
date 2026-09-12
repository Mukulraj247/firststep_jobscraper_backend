import React, { useEffect } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';
import { usePortalAuth } from '../hooks/usePortalAuth';
import { DISPLAY_FONT, STITCH, accentButtonSx } from '../tokens';
import { isScoutXAuth0Configured } from '../../auth/ScoutXAuth0Provider';

export function LoginPage() {
  const { login, user, authMode } = usePortalAuth();
  const navigate = useNavigate();
  const auth0On = isScoutXAuth0Configured();

  useEffect(() => {
    if (user) navigate('/user', { replace: true });
  }, [user, navigate]);

  return (
    <AuthLayout>
      <Typography
        sx={{
          fontFamily: DISPLAY_FONT,
          fontWeight: 600,
          fontSize: '1.5rem',
          letterSpacing: '-0.03em',
          color: STITCH.onSurface,
        }}
      >
        Welcome back
      </Typography>
      <Typography sx={{ color: STITCH.muted, mt: 0.75, mb: 3, fontSize: '0.875rem' }}>
        Sign in with Auth0 to see roles your clusters surfaced since your last refresh.
      </Typography>

      <Button
        fullWidth
        variant="contained"
        disableElevation
        onClick={() => login()}
        disabled={!auth0On}
        sx={{ ...accentButtonSx, py: 1.2 }}
      >
        Continue with Auth0
      </Button>
      <Typography sx={{ display: 'block', textAlign: 'center', color: STITCH.muted, mt: 1.25, fontSize: '0.75rem' }}>
        {auth0On
          ? 'Same Auth0 tenant as First Step. Any signed-in user gets the portal; ScoutX_Admin opens ops.'
          : 'Auth0 env is missing — set VITE_AUTH0_* in ScoutX .env'}
      </Typography>

      {authMode === 'unavailable' && (
        <Typography sx={{ mt: 2, textAlign: 'center', color: STITCH.muted, fontSize: '0.75rem' }}>
          Demo personas are removed. Configure Auth0 to continue.
        </Typography>
      )}

      <Typography sx={{ mt: 3, textAlign: 'center', color: STITCH.muted, fontSize: '0.875rem' }}>
        No account?{' '}
        <Box
          component={Link}
          to="/user/register"
          sx={{
            color: STITCH.secondaryDark,
            fontWeight: 700,
            textDecoration: 'none',
            '&:hover': { color: STITCH.primary },
          }}
        >
          Create one
        </Box>
      </Typography>
    </AuthLayout>
  );
}
