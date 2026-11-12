// The one place the client talks to the server. Components never call fetch directly.
// URLs are relative (/api/...), so in dev the Vite proxy forwards them to Express.

// credentials: 'include' tells the browser to send and accept cookies on the request.
// The server uses it to read our session cookie and to set it after Google login.
async function send(path, options = {}) {
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
