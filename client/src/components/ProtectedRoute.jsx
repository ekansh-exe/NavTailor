import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../context/AuthContext.jsx';
import { Loading } from './ui/Status.jsx';

// Guards every /app/* page. AuthContext asks GET /api/auth/me on load:
// 200 -> user is set, 401 -> user stays null.
//
// This is a UX guard, not security. Anyone can bypass client JavaScript.
// The real lock is the server checking the JWT cookie on every /api route.
export default function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();

  // /me has not answered yet. Redirecting now would bounce signed-in users on every refresh.
  if (loading) return <Loading label="Checking your session" className="m-6" />;

  // 401: send them to the landing page. `replace` swaps this history entry, so Back does not
  // loop into the guard again. `from` remembers where they were going, for after sign-in.
  if (!user) return <Navigate to="/" replace state={{ from: location }} />;

  // Signed in: render whichever child route matched (Dashboard, Profile, ...).
  return <Outlet />;
}
