// The one place the client talks to the server. Components never call fetch directly.
// URLs are relative (/api/...), so in dev the Vite proxy forwards them to Express.

// credentials: 'include' tells the browser to send and accept cookies on the request.
// The server uses it to read our session cookie and to set it after Google login.
async function request(path, options = {}) {
  const res = await fetch(path, { credentials: 'include', ...options });
  if (!res.ok) {
    const err = new Error(`Request failed: ${res.status} ${res.statusText}`);
    err.status = res.status; // lets callers tell "401 not logged in" from real failures
    throw err;
  }
  return res.json();
}

export function apiGet(path) {
  return request(path);
}

export function apiPost(path, body) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
