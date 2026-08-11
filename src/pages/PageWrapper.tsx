import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavBar } from "../components/dashboard/NavBar";
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
import { AutomationDataPage } from './AutomationDataPage';
import { AutomationConfigPage } from './AutomationConfigPage';
import { RunDetailsPage } from './RunDetailsPage';
import { AdminPage } from './AdminPage';

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
        navigate(originPage || '/robots');
      }
    };
    return () => {
      channel.close();
    };
  }, [notify, t, navigate]);

  const isAuthPage = location.pathname === '/login' || location.pathname === '/register';
  const isRecordingPage = location.pathname === '/recording';
  const isAdminPage = location.pathname === '/admin' || location.pathname.startsWith('/admin/');

  return (
    <div>
      <AuthProvider>
        <SocketProvider>
          <React.Fragment>
            {/* Show NavBar only for main app pages, not for recording or admin pages */}
            {!isRecordingPage && !isAdminPage && (
              <Box sx={{
                position: 'sticky',
                top: 0,
                zIndex: 1100,
                backgroundColor: 'background.paper'
              }}>
                <NavBar recordingName={recordingName} isRecording={false} />
              </Box>
            )}
            <Box sx={{
              display: 'block',
              minHeight: isAuthPage || isAdminPage ? '100vh' : 'calc(100vh - 64px)'
            }}>
              <Routes>
                <Route element={<UserRoute />}>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<MainPage handleEditRecording={handleEditRecording} initialContent="dashboard" />} />
                  <Route path="/jobs" element={<MainPage handleEditRecording={handleEditRecording} initialContent="jobs" />} />
                  <Route path="/robots/create" element={<RobotCreate />} />
                  <Route path="/robots/*" element={<MainPage handleEditRecording={handleEditRecording} initialContent="robots" />} />
                  <Route path="/runs/*" element={<MainPage handleEditRecording={handleEditRecording} initialContent="runs" />} />
                  <Route path="/failures" element={<MainPage handleEditRecording={handleEditRecording} initialContent="failures" />} />
                  <Route path="/proxy" element={<MainPage handleEditRecording={handleEditRecording} initialContent="proxy" />} />
                  <Route path="/automation/:id/data" element={<AutomationDataPage />} />
                  <Route path="/automation/:id/config" element={<AutomationConfigPage />} />
                  <Route path="/run/:id" element={<RunDetailsPage />} />
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
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </Box>
          </React.Fragment>
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
