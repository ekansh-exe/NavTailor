import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // true until /me answers, so a logged-in user never sees a "logged out" flash on refresh.
  const [loading, setLoading] = useState(true);

  // On page load, ask the server who we are. The httpOnly cookie is invisible to
  // JavaScript, so asking /me is the only way to know. The browser attaches the cookie.
  useEffect(() => {
    let cancelled = false;

    apiGet('/api/auth/me')
      .then((data) => {
        if (!cancelled) setUser(data.user);
      })
      .catch((err) => {
        // 401 just means "not logged in", which is normal. Anything else is worth a log.
        if (err.status !== 401) console.error('Could not check session:', err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiPost('/api/auth/logout', {});
      setUser(null);
    } catch (err) {
      // Keep the user shown as logged in: the server cookie was not cleared.
      console.error('Logout failed:', err.message);
    }
  }, []);

  const value = useMemo(() => ({ user, loading, setUser, logout }), [user, loading, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
