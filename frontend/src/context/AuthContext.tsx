import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/client';

const TOKEN_KEY = 'wt_token';
const EMAIL_KEY = 'wt_email';

interface AuthContextType {
  token: string | null;
  email: string | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [email, setEmail] = useState<string | null>(() => localStorage.getItem(EMAIL_KEY));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const requestId = api.interceptors.request.use((config) => {
      if (token) {
        config.headers = config.headers ?? {};
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    const responseId = api.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error?.response?.status === 401) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(EMAIL_KEY);
          setToken(null);
          setEmail(null);
        }
        return Promise.reject(error);
      }
    );

    return () => {
      api.interceptors.request.eject(requestId);
      api.interceptors.response.eject(responseId);
    };
  }, [token]);

  useEffect(() => {
    let cancelled = false;

    async function validateSession() {
      if (!token) {
        if (!cancelled) setReady(true);
        return;
      }

      try {
        const { data } = await api.get<{ userId: string; email: string }>('/auth/me');
        if (!cancelled && data.email && data.email !== email) {
          localStorage.setItem(EMAIL_KEY, data.email);
          setEmail(data.email);
        }
      } catch {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(EMAIL_KEY);
        if (!cancelled) {
          setToken(null);
          setEmail(null);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    void validateSession();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = async (nextEmail: string, password: string) => {
    const { data } = await api.post<{ token: string; email: string }>('/auth/login', {
      email: nextEmail,
      password
    });

    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(EMAIL_KEY, data.email);
    setToken(data.token);
    setEmail(data.email);
    setReady(true);
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EMAIL_KEY);
    setToken(null);
    setEmail(null);
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    await api.post('/auth/change-password', { currentPassword, newPassword });
  };

  const value = useMemo<AuthContextType>(() => ({
    token,
    email,
    ready,
    login,
    logout,
    changePassword
  }), [token, email, ready]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
