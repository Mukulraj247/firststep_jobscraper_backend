import React, { useEffect } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';
import { usePortalAuth } from '../hooks/usePortalAuth';
import { FIRSTSTEP, primaryButtonSx } from '../tokens';
import { isScoutXAuth0Configured } from '../../auth/ScoutXAuth0Provider';

const STEPS = [
  'Pick a cluster that matches your search',
  'Choose a refresh window: 1h, 2h or daily',
  'Read your feed and apply straight from it',
];

export function RegisterPage() {
  const { login, user } = usePortalAuth();
  const navigate = useNavigate();
  const auth0On = isScoutXAuth0Configured();

  useEffect(() => {
    if (user) navigate('/user', { replace: true });
  }, [user, navigate]);

  return (
    <AuthLayout>
      <Typography sx={{ fontWeight: 700, fontSize: '1.5rem', letterSpacing: '-0.03em', color: FIRSTSTEP.navyDeep }}>
        Create your account
      </Typography>
      <Typography variant="body2" sx={{ color: FIRSTSTEP.textMuted, mt: 0.75, mb: 2.5 }}>
        Sign up with Auth0 (First Step tenant). Password registration is disabled.
      </Typography>

      <Stack spacing={1.25} sx={{ mb: 3 }}>
        {STEPS.map((step) => (
          <Stack key={step} direction="row" spacing={1.25} alignItems="flex-start">
            <CheckCircleOutline sx={{ fontSize: 17, color: FIRSTSTEP.tealDark, mt: 0.25, flexShrink: 0 }} />
            <Typography variant="body2" sx={{ color: FIRSTSTEP.navy }}>
              {step}
            </Typography>
          </Stack>
        ))}
      </Stack>

      <Button
        fullWidth
        variant="contained"
        disableElevation
        disabled={!auth0On}
        onClick={() => login()}
        sx={{ ...primaryButtonSx, py: 1.2 }}
      >
        Continue with Auth0
      </Button>
      <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', color: FIRSTSTEP.textMuted, mt: 1.25 }}>
        {auth0On
          ? 'You will land on the ScoutX customer portal after Auth0.'
          : 'Set VITE_AUTH0_* to enable signup'}
      </Typography>

      <Typography variant="body2" sx={{ mt: 3, textAlign: 'center', color: FIRSTSTEP.textMuted }}>
        Already have an account?{' '}
        <Box
          component={Link}
          to="/user/login"
          sx={{ color: FIRSTSTEP.tealDark, fontWeight: 700, textDecoration: 'none', '&:hover': { color: FIRSTSTEP.navy } }}
        >
          Sign in
        </Box>
      </Typography>
    </AuthLayout>
  );
}
