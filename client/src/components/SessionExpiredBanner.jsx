import { useEffect, useRef } from 'react';
import { LockKeyhole } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import GoogleSignInButton from './GoogleSignInButton.jsx';

// Shown when an API call got a 401 while you were using the app. The page underneath stays as it
// is (unsaved edits included). Sign in here, then repeat the action that failed.
export default function SessionExpiredBanner() {
  const { sessionExpired, logout } = useAuth();
  const headingRef = useRef(null);

  // Move keyboard focus to the banner when it appears, so the next Tab reaches the sign-in button.
  useEffect(() => {
    if (sessionExpired) headingRef.current?.focus();
  }, [sessionExpired]);

  if (!sessionExpired) return null;

  return (
    <section
      role="alert"
      aria-labelledby="session-expired-title"
      className="border-b-2 border-ink bg-alert"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4">
        <div>
          <h2
            id="session-expired-title"
            ref={headingRef}
            tabIndex={-1}
            className="flex items-center gap-2 text-lg"
          >
            <LockKeyhole size={18} strokeWidth={2.5} aria-hidden="true" />
            Session expired
          </h2>
          <p className="mt-1 font-mono text-xs">
            Sign in again to keep going. Nothing on this page has been lost.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <GoogleSignInButton />
          <button
            type="button"
            onClick={logout}
            className="cursor-pointer border-2 border-ink bg-cream px-3 py-2 font-mono text-xs font-bold uppercase"
          >
            Leave
          </button>
        </div>
      </div>
    </section>
  );
}
