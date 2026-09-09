import React from 'react';
import { Box, CircularProgress } from '@mui/material';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { UserBottomNav } from './components/UserBottomNav';
import { UserSidebar } from './components/UserSidebar';
import { UserTopBar } from './components/UserTopBar';
import { usePortalAuth } from './hooks/usePortalAuth';
import { CheckoutPage } from './pages/CheckoutPage';
import { ClusterDetailPage } from './pages/ClusterDetailPage';
import { ClustersPage } from './pages/ClustersPage';
import { FeedPage } from './pages/FeedPage';
import { HomePage } from './pages/HomePage';
import { JobDetailPage } from './pages/JobDetailPage';
import { LoginPage } from './pages/LoginPage';
import { ProfilePage } from './pages/ProfilePage';
import { RegisterPage } from './pages/RegisterPage';
import { RequestNewPage } from './pages/RequestNewPage';
import { RequestsPage } from './pages/RequestsPage';
import { SavedPage } from './pages/SavedPage';
import { SubscriptionsPage } from './pages/SubscriptionsPage';
import { isPublicUserRoute } from './routeHelpers';
import { BODY_FONT, DISPLAY_FONT, PAGE_MAX_WIDTH, PORTAL_NAV_WIDTH, PORTAL_TOPBAR_HEIGHT, STITCH, hiddenScrollbarSx } from './tokens';

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
        <CircularProgress sx={{ color: STITCH.secondaryBright }} />
      </Box>
    );
  }

  if (!user && !isPublicUserRoute(location.pathname)) {
    return <Navigate to="/user/login" replace state={{ from: location.pathname }} />;
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
        bgcolor: STITCH.background,
        fontFamily: BODY_FONT,
        color: STITCH.onSurface,
        // Offset fixed sidebar on desktop so content never sits underneath it.
        pl: { xs: 0, md: `${PORTAL_NAV_WIDTH}px` },
        '& h1, & h2, & h3, & .MuiTypography-h1, & .MuiTypography-h2, & .MuiTypography-h3, & .MuiTypography-h4, & .MuiTypography-h5, & .MuiTypography-h6':
          { fontFamily: DISPLAY_FONT },
      }}
    >
      <UserSidebar />
      <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
        <UserTopBar />
        <Box
          component="main"
          sx={{
            flex: 1,
            minWidth: 0,
            // Room for fixed desktop top bar + content gutter
            pt: { xs: 2, md: `${PORTAL_TOPBAR_HEIGHT + 24}px` },
            px: { xs: 2, md: 3 },
            pb: { xs: 11, md: 3 },
            ...hiddenScrollbarSx,
          }}
        >
          <Box sx={{ maxWidth: PAGE_MAX_WIDTH, mx: 'auto', width: '100%' }}>{children}</Box>
        </Box>
      </Box>
      <UserBottomNav />
    </Box>
  );
}

export function UserDashboardShell() {
  return (
    <PortalGate>
      <AuthenticatedLayout>
        <Routes>
          <Route path="login" element={<LoginPage />} />
          <Route path="register" element={<RegisterPage />} />
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
