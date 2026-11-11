// The one place the client talks to the server. Components never call fetch directly.
// URLs are relative (/api/...), so in dev the Vite proxy forwards them to Express.
export async function apiGet(path) {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}
