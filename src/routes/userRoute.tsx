import React, { useContext, useRef } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { AuthContext } from '../context/auth';
import { hasScoutXAdmin } from '../auth/scoutxAuth';

/**
 * Ops console gate. Requires Auth0 exchange session with ScoutX_Admin.
 *
 * Important: never return `null` after the first paint in a way that unmounts
 * `<Outlet />` — that remounts JobBoard/MainPage and looks like a continuous refresh.
 * Prefer reading localStorage synchronously so we don't flash logged-out on boot.
 */
function readStoredUser(): any | null {
  try {
    const raw = window.localStorage.getItem('user');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const UserRoute = () => {
  const { state } = useContext(AuthContext);
  const location = useLocation();
  const storedUserRef = useRef<any | null>(readStoredUser());

  const user = state.user || storedUserRef.current;

  // Recording session bypass — keep outlet mounted; don't gate with a timer.
  if (location.pathname === '/recording') {
    const hasRecordingSession =
      window.sessionStorage.getItem('browserId') ||
      window.sessionStorage.getItem('recordingSessionId');
    if (hasRecordingSession) {
      return <Outlet />;
    }
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  const roles = user.scoutxRoles as string[] | undefined;
  if (!hasScoutXAdmin(roles)) {
    return <Navigate to="/user" replace />;
  }

  // Keep store in sync if context catches up after localStorage hydration.
  if (state.user) {
    storedUserRef.current = state.user;
  }

  return <Outlet />;
};

export default UserRoute;
