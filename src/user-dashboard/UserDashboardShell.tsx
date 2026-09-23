import React from 'react';
import { Box, CircularProgress } from '@mui/material';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { UserSideNav, useUserNavCollapsed } from './components/UserSideNav';
import { UserTopBar } from './components/UserTopBar';
import { GuidedTourProvider, WatchTourButton } from './guidedTour';
import { ScoutXWhatsAppButton } from './components/ScoutXWhatsAppButton';
import { PortalAuthProvider, usePortalAuth } from './hooks/usePortalAuth.tsx';
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
import {
  BODY_FONT,
  DISPLAY_FONT,
  EASE,
  PAGE_MAX_WIDTH,
  PORTAL_NAV_COLLAPSED,
  PORTAL_NAV_WIDTH,
  PORTAL_TOPBAR_HEIGHT,
  STITCH,
  hiddenScrollbarSx,
} from './tokens';

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
  const { collapsed, toggle } = useUserNavCollapsed();

  if (isPublicUserRoute(location.pathname)) {
    return <>{children}</>;
  }

  const navWidth = collapsed ? PORTAL_NAV_COLLAPSED : PORTAL_NAV_WIDTH;

  return (
    <Box
        sx={{
          minHeight: '100dvh',
          bgcolor: STITCH.background,
          fontFamily: BODY_FONT,
          color: STITCH.onSurface,
          position: 'relative',
          '& h1, & h2, & h3, & .MuiTypography-h1, & .MuiTypography-h2, & .MuiTypography-h3, & .MuiTypography-h4, & .MuiTypography-h5, & .MuiTypography-h6':
            { fontFamily: DISPLAY_FONT },
        }}
    >
      <UserSideNav collapsed={collapsed} onToggleCollapsed={toggle} />
      <UserTopBar />
      <Box
        component="a"
        href="#user-main"
        sx={{
          position: 'absolute',
          left: -9999,
          '&:focus': {
            left: 16,
            top: 16,
            zIndex: 2000,
            px: 2,
            py: 1,
            bgcolor: STITCH.primary,
            color: '#fff',
            borderRadius: 1,
          },
        }}
      >
        Skip to content
      </Box>
      <Box
        component="main"
        id="user-main"
        sx={{
          minWidth: 0,
          minHeight: '100dvh',
          ml: { xs: 0, md: `${navWidth}px` },
          px: { xs: 1.5, md: 3, lg: 3.5, xl: 4 },
          pt: { xs: `${PORTAL_TOPBAR_HEIGHT + 12}px`, md: 2 },
          pb: { xs: 3, md: 3.5 },
          transition: `margin-left 220ms ${EASE}`,
          ...hiddenScrollbarSx,
        }}
      >
        <Box sx={{ maxWidth: PAGE_MAX_WIDTH, mx: 0, width: '100%' }}>{children}</Box>
      </Box>
      <WatchTourButton />
      <ScoutXWhatsAppButton />
    </Box>
  );
}

export function UserDashboardShell() {
  return (
    <PortalAuthProvider>
      <PortalGate>
        <GuidedTourProvider>
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
        </GuidedTourProvider>
      </PortalGate>
    </PortalAuthProvider>
  );
}

export default UserDashboardShell;
