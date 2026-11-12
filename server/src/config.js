import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { checkEnv, ConfigError } from './env.js';

// Load server/.env no matter which folder the process was started from. In a container there is no
// .env file (the host injects the variables), and that is fine. ENV_FILE overrides the path (tests use
// it to start with a known, empty file). quiet: no "injected env" banner in the logs.
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: process.env.ENV_FILE || path.resolve(here, '../.env'), quiet: true });

// Fail fast with a clear message instead of running half-configured. EVERY problem is listed at once,
// so a fresh deploy does not need one restart per missing variable. index.js prints the message
// without a stack trace.
const { problems, warnings } = checkEnv(process.env);
if (problems.length) throw new ConfigError(problems);
export const configWarnings = warnings;

// The built React app (client/dist). Served by Express when it exists, so production is ONE origin.
// In dev the folder usually does not exist and Vite serves the client instead.
const clientDist = path.resolve(here, '..', process.env.CLIENT_DIST || '../client/dist');

export const config = {
  port: Number(process.env.PORT) || 5000,
  // Browsers send Origin without a trailing slash, so strip one if present.
  clientOrigin: process.env.CLIENT_ORIGIN.replace(/\/+$/, ''),
  // Contains the DB password. Never log this value.
  mongodbUri: process.env.MONGODB_URI,
  // Public identifier of our Google app. The ID token must be issued for this audience.
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  // Signs our session JWTs. Anyone with it can forge logins. Never log this value.
  jwtSecret: process.env.JWT_SECRET,
  // How many proxies sit in front of the server (Render's load balancer, nginx...). With N, Express
  // reads the real client IP from X-Forwarded-For, which the per-IP sign-in limit needs. Leave unset
  // locally: trusting a header no proxy wrote would let a client pick its own IP.
  trustProxy: Number(process.env.TRUST_PROXY) || 0,
  // Temporary deploy aid: log how many X-Forwarded-For entries /api/health sees (the count only).
  logProxyHops: process.env.LOG_PROXY_HOPS === '1',
  // null when there is no built client to serve.
  clientDist: fs.existsSync(path.join(clientDist, 'index.html')) ? clientDist : null,
  // FAIL CLOSED: the relaxed dev behaviour (the /api/dev routes, a session cookie without Secure)
  // needs NODE_ENV to be exactly "development", which `npm run dev` sets. Anything else, including a
  // missing or misspelled NODE_ENV on a server, gets the safe production behaviour.
  isDevelopment: process.env.NODE_ENV === 'development',
  llm: {
    // Per attempt, covers waiting for the headers AND reading the whole body.
    timeoutMs: 20_000,
    // Optional on purpose: without a key the route is skipped, profile editing still works.
    // Never log these values.
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    groqApiKey: process.env.GROQ_API_KEY || '',
  },
};

// Model ids for the LLM routes. Fill these in yourself (see your provider's model list for
// which ids your keys can use). An empty id disables that route: callLLM skips it.
export const MODELS = {
     geminiPrimary: 'gemini-3.6-flash',
     geminiFallback: 'gemini-3.5-flash-lite',
     groq: 'openai/gpt-oss-120b',
   
};
