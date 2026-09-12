import React from 'react';
import { Box, CircularProgress } from '@mui/material';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { UserTopBar } from './components/UserTopBar';
import { usePortalAuth } from './hooks/usePortalAuth';
import { CheckoutPage } from './pages/CheckoutPage';
import { ClusterDetailPage } from './pages/ClusterDetailPage';
import { ClustersPage } from './pages/ClustersPage';
import { FeedPage } from './pages/FeedPage';
import { HomePage } from './pages/HomePage';
import { JobDetailPage } from './pages/JobDetailPage';
import { ProfilePage } from './pages/ProfilePage';
import { RequestNewPage } from './pages/RequestNewPage';
import { RequestsPage } from './pages/RequestsPage';
import { SavedPage } from './pages/SavedPage';
import { SubscriptionsPage } from './pages/SubscriptionsPage';
import { isPublicUserRoute } from './routeHelpers';
import { BODY_FONT, DISPLAY_FONT, PAGE_MAX_WIDTH, PORTAL_TOPBAR_HEIGHT, STITCH, hiddenScrollbarSx } from './tokens';

function PortalGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = usePortalAuth();
  const location = useLocation();

  if (loading) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100dvh',
          bgcolor: STITCH.background,
        }}
      >
        <CircularProgress sx={{ color: STITCH.primaryContainer }} />
      </Box>
    );
  }

  if (!user && !isPublicUserRoute(location.pathname)) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}

function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  if (isPublicUserRoute(location.pathname)) {
    return <>{children}</>;
  }

  return (
    <Box
      sx={{
        minHeight: '100dvh',
        bgcolor: '#ffffff',
        fontFamily: BODY_FONT,
        color: STITCH.onSurface,
        '& h1, & h2, & h3, & .MuiTypography-h1, & .MuiTypography-h2, & .MuiTypography-h3, & .MuiTypography-h4, & .MuiTypography-h5, & .MuiTypography-h6':
          { fontFamily: DISPLAY_FONT },
      }}
    >
      <UserTopBar />
      <Box
        component="main"
        sx={{
          minWidth: 0,
          pt: { xs: '80px', md: `${PORTAL_TOPBAR_HEIGHT + 16}px` },
          px: { xs: 2.5, md: 4 },
          pb: { xs: 4, md: 5 },
          ...hiddenScrollbarSx,
        }}
      >
        <Box sx={{ maxWidth: PAGE_MAX_WIDTH, mx: 'auto', width: '100%' }}>{children}</Box>
      </Box>
    </Box>
  );
}

export function UserDashboardShell() {
  return (
    <PortalGate>
      <AuthenticatedLayout>
        <Routes>
          {/* Unified Auth0 entry is /login — legacy portal URLs redirect there. */}
          <Route path="login" element={<Navigate to="/login" replace />} />
          <Route path="register" element={<Navigate to="/register" replace />} />
          <Route index element={<HomePage />} />
          <Route path="clusters" element={<ClustersPage />} />
          <Route path="clusters/:slug" element={<ClusterDetailPage />} />
          <Route path="clusters/:slug/checkout" element={<CheckoutPage />} />
          <Route path="feed" element={<FeedPage />} />
          <Route path="feed/:subscriptionId" element={<FeedPage />} />
          <Route path="jobs/:jobId" element={<JobDetailPage />} />
          <Route path="saved" element={<SavedPage />} />
          <Route path="requests" element={<RequestsPage />} />
          <Route path="requests/new" element={<RequestNewPage />} />
          <Route path="subscriptions" element={<SubscriptionsPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="*" element={<Navigate to="/user" replace />} />
        </Routes>
      </AuthenticatedLayout>
    </PortalGate>
  );
}

export default UserDashboardShell;
