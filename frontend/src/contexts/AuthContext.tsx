import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { api, ApiRequestError, clearCsrfToken, fetchCsrfToken } from '@/lib/api';
import type { AuthUser, Role } from '@/types';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasRole: (role: Role) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Attempt to restore session on mount
  useEffect(() => {
    api.get<{ user: AuthUser }>('/auth/me')
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(identifier: string, password: string) {
    // Always fetch a fresh CSRF token before login
    await fetchCsrfToken();
    const result = await api.post<{ user: AuthUser }>('/auth/login', { identifier, password });
    setUser(result.user);
  }

  async function logout() {
    try {
      await api.post('/auth/logout');
    } catch {
      // best-effort
    } finally {
      setUser(null);
      clearCsrfToken();
    }
  }

  function hasRole(role: Role) {
    return user?.roles.includes(role) ?? false;
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
