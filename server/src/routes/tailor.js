import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { callLLM } from '../llm/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { loadSavedProfile } from '../profile/access.js';
import { tailorForUser } from '../tailor/forUser.js';
import { signResult } from '../tailor/saveToken.js';

// POST /api/tailor  { jobDescription }
//   -> { jdAnalysis, selection, changes[], gapReport, questions[], resume, scores, warnings, meta, saveToken }
// Reads the signed-in user's saved profile, tailors it to the job description and returns the
// result. It SAVES NOTHING: the client shows it and decides what to do with it.
// saveToken is not part of the result: the client strips it off and sends it back with the result to
// POST /api/applications, which uses it to prove the result came from here unchanged.
// Nothing from a job description, a resume or an LLM answer is ever written to the console.

export const MIN_JD_CHARS = 50;
export const MAX_JD_CHARS = 15_000;
// Shared with POST /api/applications (as jdText), so both routes accept exactly the same job descriptions.
export const jobDescriptionSchema = z.string().trim().min(MIN_JD_CHARS).max(MAX_JD_CHARS);
const bodySchema = z.strictObject({ jobDescription: jobDescriptionSchema });

const fail = (res, status, code, error, extra = {}) => res.status(status).json({ error, code, ...extra });

// `llm` and `loadProfile` are injectable so tests never call a provider or need a database.
// `limit` is injectable so a test can hit the rate limit in a few requests.
export function createTailorRouter({ llm = callLLM, loadProfile = loadSavedProfile, limit = 10 } = {}) {
  const router = Router();

  // Applied to the whole router, so a route added later cannot forget the auth check.
  router.use(requireAuth);

  // One run is two LLM calls on a free tier. Counted per user, not per IP.
  const limiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit,
    keyGenerator: (req) => req.user.id,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => fail(res, 429, 'rate_limited', 'Too many tailoring requests, try again in a few minutes'),
  });

  router.post('/', limiter, async (req, res) => {
    const body = bodySchema.safeParse(req.body);
    if (!body.success) {
      return fail(res, 400, 'bad_job_description', `Send { "jobDescription": "..." } with ${MIN_JD_CHARS} to ${MAX_JD_CHARS} characters`);
    }

    const outcome = await tailorForUser({ userId: req.user.id, jobDescription: body.data.jobDescription, llm, loadProfile });
    if (!outcome.ok) return fail(res, outcome.status, outcome.code, outcome.error, outcome.extra);
    const saveToken = signResult({ userId: req.user.id, jdText: body.data.jobDescription, result: outcome.data });
    return res.json({ ...outcome.data, saveToken });
  });

  return router;
}
