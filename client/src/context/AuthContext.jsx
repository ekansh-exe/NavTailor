import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost, setUnauthorizedHandler } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // true until /me answers, so a logged-in user never sees a "logged out" flash on refresh.
  const [loading, setLoading] = useState(true);
  // The cookie expired while the app was open. We KEEP `user` set, so ProtectedRoute does not
  // redirect and the page (with any unsaved edits) stays mounted. A banner asks to sign in again.
  const [sessionExpired, setSessionExpired] = useState(false);

  // The 401 handler is registered once, so it reads the current user through a ref.
  const userRef = useRef(null);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

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

  // Any non-auth API call that gets a 401 lands here (see api/client.js).
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (userRef.current) setSessionExpired(true);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // Called by the Google button after POST /api/auth/google succeeds.
  const signIn = useCallback((nextUser) => {
    const previous = userRef.current;
    if (previous && previous.id !== nextUser.id) {
      // A DIFFERENT account signed in on the expired-session banner. The page in memory holds the
      // previous account's data, so a full reload is the only safe way to drop it.
      window.location.assign('/app');
      return;
    }
    setUser(nextUser);
    setSessionExpired(false);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiPost('/api/auth/logout', {});
      setUser(null);
      setSessionExpired(false);
    } catch (err) {
      // Keep the user shown as logged in: the server cookie was not cleared.
      console.error('Logout failed:', err.message);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, sessionExpired, signIn, logout }),
    [user, loading, sessionExpired, signIn, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
