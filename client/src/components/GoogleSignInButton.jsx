import { useEffect, useRef } from 'react';
import { apiPost } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

// Load Google's script once. Resolves when window.google.accounts.id is ready.
function loadGisScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();

    let script = document.querySelector(`script[src="${GIS_SRC}"]`);
    if (!script) {
      script = document.createElement('script');
      script.src = GIS_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error('Failed to load Google script')));
  });
}

export default function GoogleSignInButton() {
  const buttonRef = useRef(null);
  const { setUser } = useAuth();

  useEffect(() => {
    let cancelled = false;

    // Google calls this with { credential } (the ID token) after the user signs in.
    async function handleCredential(response) {
      try {
        // The server verifies the token, sets the session cookie and returns the public user.
        const data = await apiPost('/api/auth/google', { credential: response.credential });
        setUser(data.user);
      } catch (err) {
        // Log the message only. Never log the credential (it is a login token).
        console.error('Google sign-in failed:', err.message);
      }
    }

    loadGisScript()
      .then(() => {
        if (cancelled || !buttonRef.current) return;
        window.google.accounts.id.initialize({
          client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
          callback: handleCredential,
        });
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
        });
      })
      .catch((err) => console.error(err.message));

    return () => {
      cancelled = true;
    };
  }, [setUser]); // setUser is stable, so this still runs once

  return <div ref={buttonRef} />;
}
