// The one place the client talks to the server. Components never call fetch directly.
// URLs are relative (/api/...), so in dev the Vite proxy forwards them to Express.

// Auth calls answer 401 as a normal "not signed in", so they never count as an expired session.
const AUTH_PATHS = /^\/api\/auth\//;

// AuthContext registers a function here. It runs when a normal API call gets a 401, meaning the
// session cookie expired or was cleared while the page was open.
let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

// credentials: 'include' tells the browser to send and accept cookies on the request.
// The server uses it to read our session cookie and to set it after Google login.
async function send(path, options = {}) {
  let res;
  try {
    res = await fetch(path, { credentials: 'include', ...options });
  } catch {
    // fetch only throws when there is no answer at all: offline, server down, DNS, CORS.
    const err = new Error('Network error');
    err.network = true;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Request failed: ${res.status} ${res.statusText}`);
    err.status = res.status; // lets callers tell "401 not logged in" from real failures
    // Seconds until a rate limit resets (sent with 429, sometimes with 503).
    err.retryAfter = Number(res.headers.get('Retry-After')) || null;
    // The server explains 400s in its JSON body (e.g. which profile fields are invalid).
    try {
      err.data = await res.json();
    } catch {
      // Body was not JSON (e.g. a proxy error page). status is still set.
    }
    if (res.status === 401 && !AUTH_PATHS.test(path)) onUnauthorized?.();
    throw err;
  }
  return res;
}

async function request(path, options) {
  return (await send(path, options)).json();
}

const jsonBody = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export function apiGet(path) {
  return request(path);
}

export function apiPut(path, body) {
  return request(path, jsonBody('PUT', body));
}

export function apiPatch(path, body) {
  return request(path, jsonBody('PATCH', body));
}

// For routes that answer with a FILE (a PDF, a .tex), not JSON. Returns the bytes as a Blob plus the
// response headers (the PDF route reports its page fit in headers). Errors still arrive as JSON and
// throw like every other call.
export async function apiPostForFile(path, body) {
  const res = await send(path, jsonBody('POST', body));
  return { blob: await res.blob(), headers: res.headers };
}

// Sends a file as multipart/form-data. We deliberately set NO Content-Type header:
// the browser must write it itself, because it includes the random "boundary" string that
// separates the parts. Setting it by hand would leave the server unable to find the file.
export function apiUpload(path, file, fieldName = 'file') {
  const form = new FormData();
  form.append(fieldName, file);
  return request(path, { method: 'POST', body: form });
}

export function apiPost(path, body) {
  return request(path, jsonBody('POST', body));
}

// DELETE answers 204 No Content: there is no body to parse, so this resolves to nothing.
export async function apiDelete(path) {
  await send(path, { method: 'DELETE' });
}
