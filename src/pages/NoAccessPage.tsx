import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import { Link } from 'react-router-dom';
import { useAuth0 } from '@auth0/auth0-react';
import { isScoutXAuth0Configured } from '../auth/ScoutXAuth0Provider';

/**
 * Shown when the signed-in Auth0 user has neither ScoutX_Admin nor ScoutX_User.
 */
export function NoAccessPage() {
  return isScoutXAuth0Configured() ? <NoAccessWithAuth0 /> : <NoAccessStatic />;
}

function NoAccessStatic() {
  return (
    <Box
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: 3,
        bgcolor: '#f8fafc',
      }}
    >
      <Box sx={{ maxWidth: 480, textAlign: 'center' }}>
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 1.5 }}>
          No ScoutX access
        </Typography>
        <Typography sx={{ color: 'text.secondary', mb: 3 }}>
          You need a ScoutX role (ScoutX_Admin or ScoutX_User) to use this app.
        </Typography>
        <Button component={Link} to="/login" variant="contained">
          Back to login
        </Button>
      </Box>
    </Box>
  );
}

function NoAccessWithAuth0() {
  const { logout, isAuthenticated, user } = useAuth0();

  return (
    <Box
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: 3,
        bgcolor: '#f8fafc',
      }}
    >
      <Box sx={{ maxWidth: 480, textAlign: 'center' }}>
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 1.5 }}>
          No ScoutX access
        </Typography>
        <Typography sx={{ color: 'text.secondary', mb: 3 }}>
          {user?.email
            ? `${user.email} is signed in with Auth0 but does not have ScoutX_Admin or ScoutX_User.`
            : 'You need a ScoutX role to use this app.'}{' '}
          Ask an admin to assign a role in Auth0 (do not change First Step user_metadata.role).
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button component={Link} to="/login" variant="contained">
            Back to login
          </Button>
          {isAuthenticated && (
            <Button
              variant="outlined"
              onClick={() =>
                logout({ logoutParams: { returnTo: `${window.location.origin}/login` } })
              }
            >
              Sign out of Auth0
            </Button>
          )}
        </Box>
      </Box>
    </Box>
  );
}

export default NoAccessPage;
