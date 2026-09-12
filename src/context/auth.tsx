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

/** Sync read so the first paint already has the session — avoids UserRoute/JobBoard remount. */
function readStoredAuthState(): InitialStateType {
  try {
    const raw = window.localStorage.getItem('user');
    if (!raw) return { user: null, lastActivityTime: Date.now() };
    const user = JSON.parse(raw);
    if (!user || !(user.id || user.email)) {
      return { user: null, lastActivityTime: Date.now() };
    }
    return { user, lastActivityTime: Date.now() };
  } catch {
    return { user: null, lastActivityTime: Date.now() };
  }
}

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
  const [state, dispatch] = useReducer(reducer, undefined, readStoredAuthState);
  const lastActivityRef = useRef<number>(Date.now());
  const userRef = useRef<any>(state.user);
  userRef.current = state.user;

  const handleLogout = useCallback(async () => {
    try {
      await axios.get(`${apiUrl}/auth/logout`);
    } catch (err) {
      console.error('Logout error:', err);
    }
    dispatch({ type: 'LOGOUT' });
    window.localStorage.removeItem('user');
    window.localStorage.removeItem('scouttext.portal.auth');
    // Prevent Auth0 auto-exchange from immediately bouncing back into /jobs.
    window.sessionStorage.setItem('scoutx.skipAuth0Exchange', '1');
    // Keep ops admins on /admin — that page has its own password gate and
    // must not bounce into the normal scout /login flow.
    if (!window.location.pathname.startsWith('/admin')) {
      window.location.assign('/login');
    }
  }, []);

  // Keep logout handler fresh for the interceptor without re-registering constantly.
  const handleLogoutRef = useRef(handleLogout);
  handleLogoutRef.current = handleLogout;

  // Session is hydrated synchronously in useReducer init — no post-mount LOGIN.

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
  // With Auth0: a hard logout on every 401 bounces /jobs → /login → Auth0 re-exchange
  // → /jobs forever (looks like continuous job-board refresh). Repair once, then
  // logout at most once per tab lifetime from this interceptor.
  useEffect(() => {
    axios.defaults.withCredentials = true;
    let repairInFlight: Promise<boolean> | null = null;
    let interceptorLogoutUsed = false;

    const trySilentSessionRepair = async (): Promise<boolean> => {
      try {
        const res = await axios.get(`${apiUrl}/auth/current-user`, {
          headers: { 'X-Skip-401-Logout': '1' },
          validateStatus: (s) => s < 500,
        });
        if (res.status === 200 && res.data) {
          const payload = res.data.user || res.data;
          if (payload && (payload.id || payload._id || payload.email)) {
            const next = {
              ...payload,
              id: payload.id || payload._id,
            };
            // Prefer keeping existing ScoutX Auth0 fields from localStorage.
            try {
              const raw = window.localStorage.getItem('user');
              if (raw) {
                const prev = JSON.parse(raw);
                Object.assign(next, {
                  scoutxRoles: prev.scoutxRoles || next.scoutxRoles,
                  authSource: prev.authSource || next.authSource,
                  auth0Sub: prev.auth0Sub || next.auth0Sub,
                  email: prev.email || next.email,
                  name: prev.name || next.name,
                  landing: prev.landing || next.landing,
                });
              }
            } catch {
              // ignore
            }
            dispatch({ type: 'LOGIN', payload: next });
            window.localStorage.setItem('user', JSON.stringify(next));
            return true;
          }
        }
      } catch {
        // fall through
      }
      return false;
    };

    const interceptorId = axios.interceptors.response.use(
      (response) => response,
      async (error) => {
        const res = error.response;
        const cfg = res?.config || error?.config;
        const requestUrl = String(cfg?.url || '');
        const skipLogout =
          cfg?.headers?.['X-Skip-401-Logout'] === '1' ||
          cfg?.headers?.['x-skip-401-logout'] === '1';

        // Admin gate uses its own cookie (`admin_token`). A 401 there must NOT
        // clear the normal scout user session or bounce the browser to /login.
        const isAdminApi =
          requestUrl.includes('/api/admin') || requestUrl.includes('/admin/');

        if (
          res?.status === 401 &&
          cfg &&
          !cfg.__isRetryRequest &&
          !isAdminApi &&
          !skipLogout
        ) {
          cfg.__isRetryRequest = true;

          if (!repairInFlight) {
            repairInFlight = trySilentSessionRepair().finally(() => {
              repairInFlight = null;
            });
          }
          const repaired = await repairInFlight;
          if (repaired) {
            return axios(cfg);
          }

          // Circuit breaker: never Auth0-bounce the tab more than once from axios.
          if (interceptorLogoutUsed) {
            return Promise.reject(error);
          }
          interceptorLogoutUsed = true;

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
