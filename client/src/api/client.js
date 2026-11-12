// The one place the client talks to the server. Components never call fetch directly.
// URLs are relative (/api/...), so in dev the Vite proxy forwards them to Express.

// credentials: 'include' tells the browser to send and accept cookies on the request.
// The server uses it to read our session cookie and to set it after Google login.
async function request(path, options = {}) {
  const res = await fetch(path, { credentials: 'include', ...options });
  if (!res.ok) {
    const err = new Error(`Request failed: ${res.status} ${res.statusText}`);
    err.status = res.status; // lets callers tell "401 not logged in" from real failures
    // The server explains 400s in its JSON body (e.g. which profile fields are invalid).
    try {
      err.data = await res.json();
    } catch {
      // Body was not JSON (e.g. a proxy error page). status is still set.
    }
    throw err;
  }
  return res.json();
}

export function apiGet(path) {
  return request(path);
}

export function apiPut(path, body) {
  return request(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function apiPost(path, body) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
