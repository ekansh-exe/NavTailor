import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { callLLM } from '../llm/index.js';
import { LLMError } from '../llm/errors.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { loadSavedProfile, isEmptyProfile } from '../profile/access.js';
import { profileSchema } from '../schemas/profile.js';
import { runTailor } from '../tailor/pipeline.js';
import { tailorResponseSchema } from '../tailor/schemas.js';

// POST /api/tailor  { jobDescription }
//   -> { jdAnalysis, selection, changes[], gapReport, questions[], resume, warnings, meta }
// Reads the signed-in user's saved profile, tailors it to the job description and returns the
// result. It SAVES NOTHING: the client shows it and decides what to do with it.
// Nothing from a job description, a resume or an LLM answer is ever written to the console.

export const MIN_JD_CHARS = 50;
export const MAX_JD_CHARS = 15_000;
const bodySchema = z.strictObject({ jobDescription: z.string().trim().min(MIN_JD_CHARS).max(MAX_JD_CHARS) });

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

    try {
      // The user id comes only from the verified session cookie.
      const stored = await loadProfile(req.user.id);
      if (!stored) return fail(res, 404, 'no_profile', 'You do not have a saved profile yet');

      const parsed = profileSchema.safeParse(stored);
      if (!parsed.success) {
        console.error('tailor: the saved profile failed validation');
        return fail(res, 500, 'bad_profile', 'Your saved profile could not be read');
      }
      // Checked before any LLM call, so an empty account burns no quota.
      if (isEmptyProfile(parsed.data)) return fail(res, 409, 'empty_profile', 'Your profile is empty, add some details first');

      const result = await runTailor({ profile: parsed.data, jobDescription: body.data.jobDescription, llm });

      // Last guard: the response must match its schema, exactly like the import route.
      const final = tailorResponseSchema.safeParse(result);
      if (!final.success) {
        console.error('tailor: the result failed final validation');
        return fail(res, 500, 'internal', 'Could not tailor the resume');
      }
      return res.json(final.data);
    } catch (err) {
      if (err instanceof LLMError) {
        // kind and causes hold no prompts, text or keys.
        console.error(`tailor llm failed: ${err.kind}`);
        return fail(res, 502, 'llm', 'LLM call failed', { kind: err.kind, causes: err.causes ?? [] });
      }
      console.error('tailor crashed:', err?.name ?? 'Error');
      return fail(res, 500, 'internal', 'Could not tailor the resume');
    }
  });

  return router;
}
