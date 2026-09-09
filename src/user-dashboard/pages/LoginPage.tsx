import React, { useEffect } from 'react';
import { Box, Button, Divider, Stack, Typography } from '@mui/material';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';
import { usePortalAuth } from '../hooks/usePortalAuth';
import { DISPLAY_FONT, STITCH, accentButtonSx, ghostButtonSx } from '../tokens';

export function LoginPage() {
  const { login, user } = usePortalAuth();
  const navigate = useNavigate();

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
        Sign in to see the roles your clusters surfaced since your last refresh.
      </Typography>

      <Button
        fullWidth
        variant="contained"
        disableElevation
        onClick={() => login('priya')}
        sx={{ ...accentButtonSx, py: 1.2 }}
      >
        Continue with Auth0
      </Button>
      <Typography sx={{ display: 'block', textAlign: 'center', color: STITCH.muted, mt: 1.25, fontSize: '0.75rem' }}>
        Demo mode — Auth0 connects in production
      </Typography>

      <Divider sx={{ my: 2.5 }}>
        <Typography sx={{ color: STITCH.muted, fontSize: '0.75rem' }}>or explore a demo persona</Typography>
      </Divider>

      <Stack spacing={1}>
        <Button fullWidth variant="outlined" onClick={() => login('priya')} sx={ghostButtonSx}>
          Priya — student, FAANG software
        </Button>
        <Button fullWidth variant="outlined" onClick={() => login('marcus')} sx={ghostButtonSx}>
          Marcus — professional, H-1B focus
        </Button>
      </Stack>

      <Typography sx={{ mt: 3, textAlign: 'center', color: STITCH.muted, fontSize: '0.875rem' }}>
        No account?{' '}
        <Box
          component={Link}
          to="/user/register"
          sx={{ color: STITCH.secondaryDark, fontWeight: 700, textDecoration: 'none', '&:hover': { color: STITCH.primary } }}
        >
          Create one
        </Box>
      </Typography>
    </AuthLayout>
  );
}
