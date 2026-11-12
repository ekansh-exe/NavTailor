import { Link, NavLink, Outlet } from 'react-router';
import { FilePlus2, LayoutGrid, LogOut, UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import ApiStatusTag from './ApiStatusTag.jsx';

const NAV = [
  // `end` makes /app active only on exactly /app, not on /app/profile too.
  { to: '/app', label: 'Dashboard', icon: LayoutGrid, end: true },
  { to: '/app/profile', label: 'Profile', icon: UserRound },
  { to: '/app/new', label: 'New tailoring', icon: FilePlus2 },
];

// NavLink passes { isActive } so the current page gets the filled black style.
function navClass({ isActive }) {
  const base =
    'inline-flex items-center gap-2 border-2 border-ink px-3 py-2 font-mono text-xs font-bold uppercase';
  return isActive ? `${base} bg-ink text-cream shadow-hard` : `${base} bg-cream hover:bg-alert`;
}

// The frame shared by every /app/* page. <Outlet /> is where the matched child page renders.
export default function AppShell() {
  const { user, logout } = useAuth();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b-2 border-ink bg-cream">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <Link to="/app" className="font-heading text-2xl font-extrabold uppercase tracking-tight">
            NavTailor
          </Link>

          <div className="flex items-center gap-3">
            <span className="hidden font-mono text-xs sm:inline">{user.email}</span>
            {/* Logging out clears `user`; ProtectedRoute then redirects to the landing page. */}
            <button
              type="button"
              onClick={logout}
              className="inline-flex cursor-pointer items-center gap-2 border-2 border-ink bg-cream px-3 py-2 font-mono text-xs font-bold uppercase shadow-hard active:translate-x-1 active:translate-y-1 active:shadow-none"
            >
              <LogOut size={14} strokeWidth={2.5} aria-hidden="true" />
              Log out
            </button>
          </div>

          {/* Full-width row: sits under the logo on every screen size and wraps on phones. */}
          <nav aria-label="Main" className="w-full">
            <ul className="flex flex-wrap gap-3">
              {NAV.map(({ to, label, icon: Icon, end }) => (
                <li key={to}>
                  <NavLink to={to} end={end} className={navClass}>
                    <Icon size={14} strokeWidth={2.5} aria-hidden="true" />
                    {label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <Outlet />
      </main>

      <footer className="border-t-2 border-ink">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <span className="font-mono text-xs uppercase">NavTailor</span>
          <ApiStatusTag />
        </div>
      </footer>
    </div>
  );
}
