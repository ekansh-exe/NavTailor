// Rate limits that span more than one route, or need a key other than the user id.
//
// Every limiter counts in memory (express-rate-limit's default MemoryStore). That means:
//   - a server restart resets every count, including the daily AI budget
//   - two server instances would each keep their own counts
// Fine for one small instance; a shared store (e.g. MongoDB) would be needed beyond that.

import { rateLimit } from 'express-rate-limit';

const fail = (res, status, code, error) => res.status(status).json({ error, code });

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export const AUTH_LIMIT = 10;
export const AUTH_WINDOW_MS = 15 * MINUTE;
export const DAILY_AI_LIMIT = 10;
export const DAY_MS = 24 * HOUR;

// POST /api/auth/google. Nobody is signed in yet, so there is no user id: this one counts per IP
// address (the default key). Behind a hosting proxy, req.ip is only the real client IP when
// `trust proxy` is set (see TRUST_PROXY in config.js), otherwise every user shares the proxy's IP.
export function createAuthLimiter({ limit = AUTH_LIMIT, windowMs = AUTH_WINDOW_MS } = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => fail(res, 429, 'auth_rate_limited', 'Too many sign-in attempts. Wait a few minutes and try again.'),
  });
}

// "about 7 hours" / "about 25 minutes", for the daily limit message.
function untilReset(resetTime) {
  const ms = Math.max(0, (resetTime?.getTime?.() ?? Date.now()) - Date.now());
  if (ms >= HOUR) {
    const hours = Math.ceil(ms / HOUR);
    return `about ${hours} hour${hours === 1 ? '' : 's'}`;
  }
  const minutes = Math.max(1, Math.ceil(ms / MINUTE));
  return `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

// A per-user budget of AI runs per 24 hours. ONE instance is mounted on several routes (tailor and
// import), so they share one counter: the budget protects the LLM quota, which they both spend.
// Must run AFTER requireAuth, because it counts by req.user.id.
//
// skipFailedRequests: a run that ends in an error (bad input, LLM down, the 10-minute limit) is
// given back, so only runs that produced something use up the budget.
export function createDailyAiLimiter({ limit = DAILY_AI_LIMIT, windowMs = DAY_MS } = {}) {
  return rateLimit({
    windowMs,
    limit,
    keyGenerator: (req) => req.user.id,
    skipFailedRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) =>
      fail(
        res,
        429,
        'daily_limit',
        `You have used all ${limit} AI runs for today. Your limit resets in ${untilReset(req.rateLimit?.resetTime)}.`,
      ),
  });
}

// The shared instance the real app uses. Tests pass their own to stay independent.
export const dailyAiLimiter = createDailyAiLimiter();
