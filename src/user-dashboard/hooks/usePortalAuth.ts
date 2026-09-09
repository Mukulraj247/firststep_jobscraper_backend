import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PortalUser } from '../types';
import { getCurrentUser, loginMock, logoutMock, switchPersona } from '../mock/mockApi';
import type { PersonaKey } from '../mock/mockPersonas';
import { isPublicUserRoute } from '../routeHelpers';

export function usePortalAuth() {
  const [user, setUser] = useState<PortalUser | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    const u = await getCurrentUser();
    setUser(u);
    return u;
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const login = async (persona: PersonaKey = 'priya') => {
    const u = await loginMock(persona);
    setUser(u);
    navigate('/user');
  };

  const logout = async () => {
    await logoutMock();
    setUser(null);
    navigate('/user/login');
  };

  const switchDemoPersona = async (persona: PersonaKey) => {
    const u = await switchPersona(persona);
    setUser(u);
  };

  return { user, loading, login, logout, switchDemoPersona, refresh };
}

export function useRequirePortalAuth() {
  const { user, loading } = usePortalAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    const path = window.location.pathname;
    if (!user && !isPublicUserRoute(path)) {
      navigate('/user/login', { replace: true });
    }
  }, [user, loading, navigate]);

  return { user, loading };
}
