import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../context/AuthContext.jsx';
import { Loading } from './ui/Status.jsx';

// The mirror of ProtectedRoute, for the landing page: signed-in users skip it.
// This also handles sign-in: when Google login sets `user`, this re-renders and redirects.
export default function GuestOnlyRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Loading label="Checking your session" className="m-6" />;

  if (user) {
    // Back to the page ProtectedRoute bounced them from, or the dashboard by default.
    const target = location.state?.from?.pathname ?? '/app';
    return <Navigate to={target} replace />;
  }

  return <Outlet />;
}
