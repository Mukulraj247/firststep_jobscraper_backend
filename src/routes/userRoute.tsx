import React, { useEffect, useState, useContext } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { AuthContext } from '../context/auth';
import { useGlobalInfoStore } from '../context/globalInfo';
import { hasScoutXAdmin } from '../auth/scoutxAuth';

/**
 * Ops console gate. Requires Auth0 exchange session with ScoutX_Admin.
 * Password sessions are no longer accepted for ops.
 */
const UserRoute = () => {
  const { state } = useContext(AuthContext);
  const location = useLocation();
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const { setRecordingUrl } = useGlobalInfoStore();

  useEffect(() => {
    if (location.pathname === '/recording') {
      const hasRecordingSession =
        window.sessionStorage.getItem('browserId') ||
        window.sessionStorage.getItem('recordingSessionId');

      const recordingUrl = window.sessionStorage.getItem('recordingUrl');
      if (recordingUrl) {
        setRecordingUrl(recordingUrl);
      }

      if (hasRecordingSession) {
        setIsCheckingAuth(false);
        return;
      }
    }

    const timer = setTimeout(() => {
      setIsCheckingAuth(false);
    }, 100);

    return () => clearTimeout(timer);
  }, [location.pathname, setRecordingUrl]);

  if (isCheckingAuth) {
    return null;
  }

  if (location.pathname === '/recording') {
    const hasRecordingSession =
      window.sessionStorage.getItem('browserId') ||
      window.sessionStorage.getItem('recordingSessionId');

    if (hasRecordingSession) {
      return <Outlet />;
    }
  }

  if (!state.user) {
    return <Navigate to="/login" replace />;
  }

  const roles = state.user.scoutxRoles as string[] | undefined;
  if (!hasScoutXAdmin(roles)) {
    return <Navigate to="/user" replace />;
  }

  return <Outlet />;
};

export default UserRoute;
