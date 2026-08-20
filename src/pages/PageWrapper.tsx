import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavBar } from "../components/dashboard/NavBar";
import {
  AppShellNavProvider,
  PageMain,
  SKIP_LINK_CLASS,
  SKIP_LINK_HREF,
  SKIP_LINK_LABEL,
  shouldShowSkipLink,
  useAppShellNav,
} from "../components/dashboard/AppShell";
import { SocketProvider } from "../context/socket";
import { BrowserDimensionsProvider } from "../context/browserDimensions";
import { AuthProvider } from '../context/auth';
import { RecordingPage } from "./RecordingPage";
import { MainPage } from "./MainPage";
import { useGlobalInfoStore } from "../context/globalInfo";
import { AlertSnackbar } from "../components/ui/AlertSnackbar";
import Login from './Login';
import Register from './Register';
import UserRoute from '../routes/userRoute';
import { Routes, Route, useNavigate, Navigate, useLocation } from 'react-router-dom';
import { NotFoundPage } from '../components/dashboard/NotFound';
import RobotCreate from '../components/robot/pages/RobotCreate';
import { Box } from '@mui/material';
import { hiddenScrollbarSx } from '../components/dashboard/ops/dashboardTokens';
import { AutomationDataPage } from './AutomationDataPage';
import { AutomationConfigPage } from './AutomationConfigPage';
import { RunDetailsPage } from './RunDetailsPage';
import { AdminPage } from './AdminPage';

function SkipToMain() {
  const location = useLocation();
  const { landmarkMounted } = useAppShellNav();
  if (!shouldShowSkipLink(location.pathname, landmarkMounted)) return null;
  return (
    <a className={SKIP_LINK_CLASS} href={SKIP_LINK_HREF}>
      {SKIP_LINK_LABEL}
    </a>
  );
}

export const PageWrapper = () => {
  const [open, setOpen] = useState(false);
  const [isRecordingMode, setIsRecordingMode] = useState(false);
  const { t } = useTranslation();

  const navigate = useNavigate();
  const location = useLocation();

  const { browserId, setBrowserId, notification, notify, recordingName, setRecordingName, recordingId, setRecordingId, setRecordingUrl } = useGlobalInfoStore();

  const handleEditRecording = (recordingId: string, fileName: string) => {
    setRecordingName(fileName);
    setRecordingId(recordingId);
    setBrowserId('new-recording');
    navigate('/recording');
  }

  const isNotification = (): boolean => {
    if (notification.isOpen && !open) {
      setOpen(true);
    }
    return notification.isOpen;
  }

  /**
   * Get the current tab's state from session storage
   */
  const getTabState = (key: string): string | null => {
    try {
      const value = window.sessionStorage.getItem(key);
      return value;
    } catch (error) {
      return null;
    }
  };

  useEffect(() => {
    const tabMode = getTabState('tabMode');
    const urlParams = new URLSearchParams(window.location.search);
    const sessionParam = urlParams.get('session');
    const storedSessionId = getTabState('recordingSessionId');
    const storedRecordingUrl = getTabState('recordingUrl');

    if (location.pathname === '/recording-setup' && sessionParam && sessionParam === storedSessionId) {
      setBrowserId('new-recording');
      setRecordingName('');
      setRecordingId('');

      if (storedRecordingUrl) {
        setRecordingUrl(storedRecordingUrl);
      }

      navigate('/recording');
    }
    else if (location.pathname === '/recording' ||
      (getTabState('nextTabIsRecording') === 'true' && sessionParam === storedSessionId)) {
      setIsRecordingMode(true);

      if (location.pathname !== '/recording') {
        navigate('/recording');
      }

      window.sessionStorage.removeItem('nextTabIsRecording');
    } else if (tabMode === 'main') {
      console.log('Tab is in main application mode');
    } else {
      const id = getTabState('browserId');
      if (id === 'new-recording' || location.pathname === '/recording') {
        setIsRecordingMode(true);
      }
    }
  }, [location.pathname, navigate, setBrowserId, setRecordingId, setRecordingName, setRecordingUrl]);

  useEffect(() => {
    const channel = new BroadcastChannel('maxun-recording');
    channel.onmessage = (event) => {
      if (event.data?.type === 'recording-timeout') {
        notify('warning', t('browser_recording.notifications.timeout_discarded'));
        const originPage = window.sessionStorage.getItem('recordingOriginPage');
        window.sessionStorage.removeItem('recordingOriginPage');
        navigate(originPage || '/scrapers');
      }
    };
    return () => {
      channel.close();
    };
  }, [notify, t, navigate]);

  const isAuthPage = location.pathname === '/login' || location.pathname === '/register';
  const isRecordingPage = location.pathname === '/recording';
  const isAdminPage = location.pathname === '/admin' || location.pathname.startsWith('/admin/');
  const usesAppShellViewport =
    !isAuthPage && !isAdminPage && !isRecordingPage && location.pathname !== '/recording-setup';

  useEffect(() => {
    if (!usesAppShellViewport) return undefined;
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
    };
  }, [usesAppShellViewport]);

  const viewportLocked = usesAppShellViewport;

  return (
    <div
      style={{
        height: viewportLocked ? '100dvh' : undefined,
        maxHeight: viewportLocked ? '100dvh' : undefined,
        minHeight: viewportLocked ? '100dvh' : '100vh',
        overflow: viewportLocked ? 'hidden' : undefined,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <AuthProvider>
        <SocketProvider>
          <AppShellNavProvider>
          <React.Fragment>
            {/* Skip link is first in the DOM, before NavBar, so it is the first tab stop. */}
            <SkipToMain />
            {/* Show NavBar only for main app pages, not for recording or admin pages */}
            {!isRecordingPage && !isAdminPage && (
              <Box sx={{
                flexShrink: 0,
                zIndex: 1100,
                backgroundColor: 'background.paper',
              }}>
                <NavBar recordingName={recordingName} isRecording={false} />
              </Box>
            )}
            <Box sx={{
              flex: viewportLocked ? 1 : undefined,
              display: 'flex',
              flexDirection: 'column',
              height: viewportLocked ? undefined : (isAuthPage || isAdminPage || isRecordingPage ? '100vh' : 'calc(100vh - 64px)'),
              maxHeight: viewportLocked ? undefined : (isAuthPage || isAdminPage || isRecordingPage ? '100vh' : 'calc(100vh - 64px)'),
              minHeight: viewportLocked ? 0 : undefined,
              minWidth: 0,
              width: '100%',
              maxWidth: '100%',
              overflow: 'auto',
              ...hiddenScrollbarSx,
            }}>
              <Routes>
                <Route element={<UserRoute />}>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<MainPage handleEditRecording={handleEditRecording} initialContent="dashboard" />} />
                  <Route path="/automations" element={<MainPage handleEditRecording={handleEditRecording} initialContent="automations" />} />
                  <Route path="/jobs" element={<MainPage handleEditRecording={handleEditRecording} initialContent="jobs" />} />
                  <Route path="/scrapers/create" element={<PageMain><RobotCreate /></PageMain>} />
                  <Route path="/scrapers/*" element={<MainPage handleEditRecording={handleEditRecording} initialContent="scrapers" />} />
                  <Route path="/robots" element={<Navigate to="/scrapers" replace />} />
                  <Route
                    path="/robots/*"
                    element={<Navigate to={`${location.pathname.replace(/^\/robots/, '/scrapers')}${location.search}`} replace />}
                  />
                  <Route path="/runs/*" element={<MainPage handleEditRecording={handleEditRecording} initialContent="runs" />} />
                  <Route path="/failures" element={<MainPage handleEditRecording={handleEditRecording} initialContent="failures" />} />
                  <Route path="/communication" element={<MainPage handleEditRecording={handleEditRecording} initialContent="communication" />} />
                  <Route path="/proxy" element={<MainPage handleEditRecording={handleEditRecording} initialContent="proxy" />} />
                  <Route path="/automation/:id/data" element={<PageMain><AutomationDataPage /></PageMain>} />
                  <Route path="/automation/:id/config" element={<PageMain><AutomationConfigPage /></PageMain>} />
                  <Route path="/run/:id" element={<PageMain><RunDetailsPage /></PageMain>} />
                </Route>
                <Route element={<UserRoute />}>
                  <Route path="/recording" element={
                    <BrowserDimensionsProvider>
                      <RecordingPage recordingName={recordingName} />
                    </BrowserDimensionsProvider>
                  } />
                </Route>
                <Route
                  path="/login"
                  element={<Login />}
                />
                <Route
                  path="/register"
                  element={<Register />}
                />
                <Route
                  path="/recording-setup"
                  element={null}
                />
                <Route path="/admin" element={<AdminPage />} />
                <Route path="*" element={<PageMain><NotFoundPage /></PageMain>} />
              </Routes>
            </Box>
          </React.Fragment>
          </AppShellNavProvider>
        </SocketProvider>
      </AuthProvider>
      {isNotification() ?
        <AlertSnackbar severity={notification.severity}
          message={notification.message}
          isOpen={notification.isOpen} />
        : null
      }
    </div>
  );
}
