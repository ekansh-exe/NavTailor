import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Load server/.env no matter which folder the process was started from.
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../.env') });

// Fail fast with a clear message instead of running half-configured.
// Only the variable NAME is printed, never its value.
function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT) || 5000,
  // Browsers send Origin without a trailing slash, so strip one if present.
  clientOrigin: required('CLIENT_ORIGIN').replace(/\/+$/, ''),
};
