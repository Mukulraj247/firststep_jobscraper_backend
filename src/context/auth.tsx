import {
  useReducer,
  createContext,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import axios from 'axios';
import { apiUrl } from '../apiConfig';

interface AuthProviderProps {
  children: React.ReactNode;
}

interface ActionType {
  type: 'LOGIN' | 'LOGOUT';
  payload?: any;
}

type InitialStateType = {
  user: any;
  lastActivityTime?: number;
};

const initialState: InitialStateType = {
  user: null,
  lastActivityTime: Date.now(),
};

const AUTO_LOGOUT_TIME = 4 * 60 * 60 * 1000; // 4 hours

const AuthContext = createContext<{
  state: InitialStateType;
  dispatch: React.Dispatch<ActionType>;
}>({
  state: initialState,
  dispatch: () => null,
});

const reducer = (state: InitialStateType, action: ActionType): InitialStateType => {
  switch (action.type) {
    case 'LOGIN':
      return {
        ...state,
        user: action.payload,
        lastActivityTime: Date.now(),
      };
    case 'LOGOUT':
      return {
        ...state,
        user: null,
        lastActivityTime: undefined,
      };
    default:
      return state;
  }
};

const AuthProvider = ({ children }: AuthProviderProps) => {
  const [state, dispatch] = useReducer(reducer, initialState);
  const lastActivityRef = useRef<number>(Date.now());
  const userRef = useRef<any>(state.user);
  userRef.current = state.user;

  const handleLogout = useCallback(async () => {
    try {
      await axios.get(`${apiUrl}/auth/logout`);
      dispatch({ type: 'LOGOUT' });
      window.localStorage.removeItem('user');
      window.localStorage.removeItem('scouttext.portal.auth');
      window.sessionStorage.setItem('scoutx.skipAuth0Exchange', '1');
      // Keep ops admins on /admin — that page has its own password gate and
      // must not bounce into the normal scout /login flow.
      if (!window.location.pathname.startsWith('/admin')) {
        // Full navigation so Auth0 + React state both reset cleanly when Auth0 is on.
        window.location.assign('/login');
      }
    } catch (err) {
      console.error('Logout error:', err);
    }
  }, []);

  // Keep logout handler fresh for the interceptor without re-registering constantly.
  const handleLogoutRef = useRef(handleLogout);
  handleLogoutRef.current = handleLogout;

  // Initialize user from localStorage
  useEffect(() => {
    const storedUser = window.localStorage.getItem('user');
    if (storedUser) {
      try {
        const user = JSON.parse(storedUser);
        lastActivityRef.current = Date.now();
        dispatch({ type: 'LOGIN', payload: user });
      } catch {
        window.localStorage.removeItem('user');
      }
    }
  }, []);

  // Sync ref when a real LOGIN/LOGOUT happens (not activity pings).
  useEffect(() => {
    if (state.user) {
      lastActivityRef.current = state.lastActivityTime || Date.now();
    }
  }, [state.user, state.lastActivityTime]);

  // Activity listeners: update a ref only — do NOT dispatch (avoids app-wide re-renders on scroll).
  useEffect(() => {
    if (!state.user) return;

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'] as const;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const handleActivity = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        lastActivityRef.current = Date.now();
      }, 1000);
    };

    events.forEach((event) => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    const checkInterval = setInterval(() => {
      if (!userRef.current) return;
      if (Date.now() - lastActivityRef.current >= AUTO_LOGOUT_TIME) {
        void handleLogoutRef.current();
      }
    }, 60_000);

    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });
      clearInterval(checkInterval);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [state.user]);

  // Register the 401 interceptor once (eject on unmount). Never register in render body.
  useEffect(() => {
    axios.defaults.withCredentials = true;
    const interceptorId = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        const res = error.response;
        const requestUrl = String(res?.config?.url || error?.config?.url || '');
        // Admin gate uses its own cookie (`admin_token`). A 401 there must NOT
        // clear the normal scout user session or bounce the browser to /login.
        const isAdminApi =
          requestUrl.includes('/api/admin') || requestUrl.includes('/admin/');

        if (
          res?.status === 401 &&
          res.config &&
          !res.config.__isRetryRequest &&
          !isAdminApi
        ) {
          return new Promise((_, reject) => {
            handleLogoutRef
              .current()
              .then(() => {
                console.log('/401 error > logout');
                reject(error);
              })
              .catch((err) => {
                console.error('AXIOS INTERCEPTORS ERROR:', err);
                reject(error);
              });
          });
        }
        return Promise.reject(error);
      }
    );

    return () => {
      axios.interceptors.response.eject(interceptorId);
    };
  }, []);

  const value = useMemo(() => ({ state, dispatch }), [state]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export { AuthContext, AuthProvider };
