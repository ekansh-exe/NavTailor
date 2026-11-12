import { useAuth } from '../context/AuthContext.jsx';
import GoogleSignInButton from './GoogleSignInButton.jsx';

// Shows the Google button when logged out, and who you are + Log out when logged in.
export default function AuthStatus() {
  const { user, loading, logout } = useAuth();

  // Wait for /me so a refresh does not flash the sign-in button at a logged-in user.
  if (loading) return null;

  if (!user) return <GoogleSignInButton />;

  return (
    <section className="flex items-center justify-between gap-4 border-2 border-ink bg-cream p-4 shadow-hard">
      <div>
        <p className="font-mono text-xs uppercase">Signed in as</p>
        <p className="font-mono text-sm font-bold">{user.email}</p>
      </div>
      <button
        onClick={logout}
        className="cursor-pointer border-2 border-ink bg-ink px-4 py-2 font-mono text-sm font-bold uppercase text-cream shadow-hard active:translate-x-1 active:translate-y-1 active:shadow-none"
      >
        Log out
      </button>
    </section>
  );
}
