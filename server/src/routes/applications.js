import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { callLLM } from '../llm/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { loadSavedProfile } from '../profile/access.js';
import { Application, MAX_APPLICATIONS_PER_USER } from '../models/Application.js';
import { idSchema } from '../schemas/profile.js';
import { tailorForUser } from '../tailor/forUser.js';
import { jobDescriptionSchema, MIN_JD_CHARS, MAX_JD_CHARS } from './tailor.js';

// POST  /api/applications                  { company, role, jobDescription } -> 201 { id }
//         tailors the saved profile to the job and SAVES the result
// GET   /api/applications                  -> { applications: [{ id, company, role, status, matchScore, createdAt }] }
// GET   /api/applications/:id              -> { application: { id, company, role, jobDescription, status,
//                                                               decisions, result, createdAt, updatedAt } }
// PATCH /api/applications/:id/decisions    { decisions: { itemId: boolean } } -> { decisions, status }
//
// THE RULE OF THIS FILE: every query has userId: req.user.id in its filter. An id in the URL alone
// is never enough, or anyone who guesses an id could read someone else's resume (IDOR).
// Someone else's application answers 404, exactly like one that does not exist, so a stranger
// cannot even learn that an id is real.

const LIST_LIMIT = 100;

const createSchema = z.strictObject({
  company: z.string().trim().min(1).max(200),
  role: z.string().trim().min(1).max(200),
  jobDescription: jobDescriptionSchema,
});

const decisionsSchema = z.strictObject({
  decisions: z
    .record(idSchema, z.boolean())
    .refine((d) => Object.keys(d).length <= 60, 'At most 60 decisions'),
});

// A MongoDB ObjectId is 24 hex characters. Anything else is a 404 before it reaches the database
// (Mongoose would otherwise throw a CastError, which would look like a 500).
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const fail = (res, status, code, error, extra = {}) => res.status(status).json({ error, code, ...extra });
const notFound = (res) => fail(res, 404, 'not_found', 'Application not found');

// What a lean() document looks like on the way out. No userId, no __v.
const toPublic = (doc) => ({
  id: String(doc._id),
  company: doc.company,
  role: doc.role,
  jobDescription: doc.jobDescription,
  status: doc.status,
  decisions: doc.decisions ?? {},
  result: doc.result,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

// `llm` and `loadProfile` are injectable so tests never call a provider.
// `limit` is injectable so a test can hit the rate limit in a few requests.
export function createApplicationsRouter({ llm = callLLM, loadProfile = loadSavedProfile, limit = 10 } = {}) {
  const router = Router();

  // Applied to the whole router, so a route added later cannot forget the auth check.
  router.use(requireAuth);

  // Creating one costs two LLM calls. Counted per user, not per IP.
  const limiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit,
    keyGenerator: (req) => req.user.id,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => fail(res, 429, 'rate_limited', 'Too many tailoring requests, try again in a few minutes'),
  });

  router.post('/', limiter, async (req, res) => {
    const body = createSchema.safeParse(req.body);
    if (!body.success) {
      return fail(res, 400, 'bad_application', `Send { company, role, jobDescription } with a job description of ${MIN_JD_CHARS} to ${MAX_JD_CHARS} characters`);
    }
    const userId = req.user.id;

    try {
      // Checked before the LLM runs, so a full account spends no quota.
      if ((await Application.countDocuments({ userId })) >= MAX_APPLICATIONS_PER_USER) {
        return fail(res, 409, 'too_many_applications', `You can keep at most ${MAX_APPLICATIONS_PER_USER} applications`);
      }

      const outcome = await tailorForUser({ userId, jobDescription: body.data.jobDescription, llm, loadProfile });
      if (!outcome.ok) return fail(res, outcome.status, outcome.code, outcome.error, outcome.extra);

      // userId comes from the verified session, never from the body (strictObject refuses it anyway).
      const doc = await Application.create({ ...body.data, userId, result: outcome.data });
      return res.status(201).json({ id: String(doc._id) });
    } catch (err) {
      console.error('create application failed:', err?.name ?? 'Error');
      return fail(res, 500, 'internal', 'Could not save the application');
    }
  });

  router.get('/', async (req, res) => {
    try {
      // Only the fields the dashboard shows. 'result.gapReport.matchScore' reaches inside the Mixed
      // field, so the big resume and change list never leave the database for a list view.
      const docs = await Application.find({ userId: req.user.id })
        .sort({ createdAt: -1 })
        .limit(LIST_LIMIT)
        .select('company role status createdAt result.gapReport.matchScore')
        .lean();

      const applications = docs.map((d) => ({
        id: String(d._id),
        company: d.company,
        role: d.role,
        status: d.status,
        matchScore: d.result?.gapReport?.matchScore ?? null,
        createdAt: d.createdAt,
      }));
      return res.json({ applications });
    } catch (err) {
      console.error('list applications failed:', err?.name ?? 'Error');
      return fail(res, 500, 'internal', 'Could not load your applications');
    }
  });

  router.get('/:id', async (req, res) => {
    if (!OBJECT_ID.test(req.params.id)) return notFound(res);
    try {
      const doc = await Application.findOne({ _id: req.params.id, userId: req.user.id }).lean();
      if (!doc) return notFound(res);
      return res.json({ application: toPublic(doc) });
    } catch (err) {
      console.error('load application failed:', err?.name ?? 'Error');
      return fail(res, 500, 'internal', 'Could not load the application');
    }
  });

  router.patch('/:id/decisions', async (req, res) => {
    if (!OBJECT_ID.test(req.params.id)) return notFound(res);
    const body = decisionsSchema.safeParse(req.body);
    if (!body.success) return fail(res, 400, 'bad_decisions', 'Send { "decisions": { "<itemId>": true | false } }');

    const filter = { _id: req.params.id, userId: req.user.id };
    try {
      const doc = await Application.findOne(filter).select('result.changes').lean();
      if (!doc) return notFound(res);

      // Only rewrites that PASSED the guardrail can be switched on. A rewrite rejected for an invented
      // number or tool stays rejected, whatever the client sends. That is what keeps "never fabricate"
      // true even for a hand-crafted request.
      const toggleable = new Set((doc.result?.changes ?? []).filter((c) => c.reason === 'ok').map((c) => c.itemId));
      const refused = Object.keys(body.data.decisions).filter((id) => !toggleable.has(id));
      if (refused.length) {
        return fail(res, 400, 'not_toggleable', 'Only rewrites that passed the checks can be accepted or rejected', { itemIds: refused });
      }

      const updated = await Application.findOneAndUpdate(
        filter,
        { $set: { decisions: body.data.decisions, status: 'reviewed' } },
        { returnDocument: 'after', runValidators: true },
      ).lean();
      if (!updated) return notFound(res); // deleted between the two queries
      return res.json({ decisions: updated.decisions ?? {}, status: updated.status });
    } catch (err) {
      console.error('save decisions failed:', err?.name ?? 'Error');
      return fail(res, 500, 'internal', 'Could not save your decisions');
    }
  });

  return router;
}
