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
  // Contains the DB password. Never log this value.
  mongodbUri: required('MONGODB_URI'),
  // Public identifier of our Google app. The ID token must be issued for this audience.
  googleClientId: required('GOOGLE_CLIENT_ID'),
  // Signs our session JWTs. Anyone with it can forge logins. Never log this value.
  jwtSecret: required('JWT_SECRET'),
  // How many proxies sit in front of the server (Render, Railway, nginx...). With 1, Express reads the
  // real client IP from X-Forwarded-For, which the per-IP sign-in limit needs. Leave unset locally:
  // trusting a header no proxy wrote would let a client pick its own IP.
  trustProxy: Number(process.env.TRUST_PROXY) || 0,
  // Cookies get the Secure flag only in production (localhost dev runs over plain http).
  isProduction: process.env.NODE_ENV === 'production',
  llm: {
    // Per attempt, covers waiting for the headers AND reading the whole body.
    timeoutMs: 20_000,
    // Optional on purpose: without a key the route is skipped, profile editing still works.
    // Never log these values.
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    groqApiKey: process.env.GROQ_API_KEY || '',
  },
};

// Model ids for the LLM routes. Fill these in yourself (run `node scripts/listModels.js` to see
// which ids your keys can use). An empty id disables that route: callLLM skips it.
export const MODELS = {
     geminiPrimary: 'gemini-3.6-flash',
     geminiFallback: 'gemini-3.5-flash-lite',
     groq: 'openai/gpt-oss-120b',
   
};
