import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { Application, APPLICATION_STATUSES, MAX_APPLICATIONS_PER_USER } from '../models/Application.js';
import { ResumeVersion } from '../models/ResumeVersion.js';
import { idSchema } from '../schemas/profile.js';
import { renderResume } from '../latex/template.js';
import { tailorResponseSchema } from '../tailor/schemas.js';
import { applyDecisions, refusedDecisions } from '../tailor/applyDecisions.js';
import { verifyResult } from '../tailor/saveToken.js';
import { jobDescriptionSchema, MIN_JD_CHARS, MAX_JD_CHARS } from './tailor.js';

// POST   /api/applications                 { company, role, jdText, result, saveToken, decisions? }
//          -> 201 { id, versionId }   saves a result from POST /api/tailor: one application + version 1
// GET    /api/applications                 -> { applications: [{ id, company, role, status, matchScore, createdAt }] }
// GET    /api/applications/:id             -> { application: {...}, version: { id, result, decisions, createdAt } | null }
// PATCH  /api/applications/:id             { status } -> { status }
// PATCH  /api/applications/:id/versions/:versionId/decisions   { decisions } -> { decisions }
// DELETE /api/applications/:id             -> 204, and deletes its resume versions too
//
// THE RULE OF THIS FILE: every query has userId: req.user.id in its filter. An id in the URL alone
// is never enough, or anyone who guesses an id could read someone else's resume (IDOR).
// Someone else's application answers 404, exactly like one that does not exist, so a stranger
// cannot even learn that an id is real.

const LIST_LIMIT = 100;

const decisionsMap = z
  .record(idSchema, z.boolean())
  .refine((d) => Object.keys(d).length <= 60, 'At most 60 decisions');

const createSchema = z.strictObject({
  company: z.string().trim().min(1).max(200),
  role: z.string().trim().min(1).max(200),
  jdText: jobDescriptionSchema,
  // Re-parsed with the same schema POST /api/tailor used, so the JSON hashed for the token check is
  // built the same way on both sides.
  result: tailorResponseSchema,
  saveToken: z.string().max(100),
  decisions: decisionsMap.default({}),
});

const statusSchema = z.strictObject({ status: z.enum(APPLICATION_STATUSES) });
const decisionsSchema = z.strictObject({ decisions: decisionsMap });

// A MongoDB ObjectId is 24 hex characters. Anything else is a 404 before it reaches the database
// (Mongoose would otherwise throw a CastError, which would look like a 500).
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const fail = (res, status, code, error, extra = {}) => res.status(status).json({ error, code, ...extra });
const notFound = (res) => fail(res, 404, 'not_found', 'Application not found');

// What lean() documents look like on the way out. No userId, no __v.
const toPublic = (doc) => ({
  id: String(doc._id),
  company: doc.company,
  role: doc.role,
  jdText: doc.jdText,
  status: doc.status,
  gapReport: doc.gapReport,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});
const versionToPublic = (doc) => ({
  id: String(doc._id),
  result: doc.result,
  decisions: doc.decisions ?? {},
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

// The resume and its LaTeX, built by the server from the trusted result. Never taken from the client.
function buildResume(result, decisions) {
  const resumeJson = applyDecisions(result.resume, result.changes, decisions);
  return { resumeJson, texSource: renderResume(resumeJson) };
}

// `limit` is injectable so a test can hit the rate limit in a few requests.
export function createApplicationsRouter({ limit = 30 } = {}) {
  const router = Router();

  // Applied to the whole router, so a route added later cannot forget the auth check.
  router.use(requireAuth);

  // Saving makes no LLM call, so the limit is looser than tailoring. Counted per user, not per IP.
  const saveLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit,
    keyGenerator: (req) => req.user.id,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => fail(res, 429, 'rate_limited', 'Too many saves, try again in a few minutes'),
  });

  router.post('/', saveLimiter, async (req, res) => {
    const body = createSchema.safeParse(req.body);
    if (!body.success) {
      return fail(res, 400, 'bad_application', `Send { company, role, jdText, result, saveToken } with a job description of ${MIN_JD_CHARS} to ${MAX_JD_CHARS} characters`);
    }
    const { company, role, jdText, result, saveToken, decisions } = body.data;
    const userId = req.user.id;

    // Proof that this exact result came from POST /api/tailor, for this user and this job description.
    const check = verifyResult({ token: saveToken, userId, jdText, result });
    if (check === 'expired') return fail(res, 400, 'token_expired', 'This result is too old to save. Tailor it again.');
    if (check !== 'ok') return fail(res, 400, 'bad_token', 'This result could not be verified. Tailor it again.');

    // Only rewrites that PASSED the guardrail can be switched on.
    const refused = refusedDecisions(result.changes, decisions);
    if (refused.length) {
      return fail(res, 400, 'not_toggleable', 'Only rewrites that passed the checks can be accepted or rejected', { itemIds: refused });
    }

    let application;
    try {
      if ((await Application.countDocuments({ userId })) >= MAX_APPLICATIONS_PER_USER) {
        return fail(res, 409, 'too_many_applications', `You can keep at most ${MAX_APPLICATIONS_PER_USER} applications`);
      }
      const built = buildResume(result, decisions);

      // userId comes from the verified session, never from the body (strictObject refuses it anyway).
      application = await Application.create({ userId, company, role, jdText, gapReport: result.gapReport });
      const version = await ResumeVersion.create({ applicationId: application._id, userId, result, decisions, ...built });
      return res.status(201).json({ id: String(application._id), versionId: String(version._id) });
    } catch (err) {
      // Two inserts are not atomic. If the version failed, remove the application again so the user
      // never sees one without a resume. (A transaction would do this for us; this is the simple way.)
      if (application) await Application.deleteOne({ _id: application._id, userId }).catch(() => {});
      console.error('create application failed:', err?.name ?? 'Error');
      return fail(res, 500, 'internal', 'Could not save the application');
    }
  });

  router.get('/', async (req, res) => {
    try {
      // Uses the { userId: 1, createdAt: -1 } index: no in-memory sort. Only the fields the list
      // shows; 'gapReport.matchScore' reaches inside the Mixed field.
      const docs = await Application.find({ userId: req.user.id })
        .sort({ createdAt: -1 })
        .limit(LIST_LIMIT)
        .select('company role status createdAt gapReport.matchScore')
        .lean();

      const applications = docs.map((d) => ({
        id: String(d._id),
        company: d.company,
        role: d.role,
        status: d.status,
        matchScore: d.gapReport?.matchScore ?? null,
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
    const userId = req.user.id;
    try {
      const doc = await Application.findOne({ _id: req.params.id, userId }).lean();
      if (!doc) return notFound(res);
      // The newest version. Two queries instead of $lookup: simpler, and both hit an index.
      const version = await ResumeVersion.findOne({ applicationId: doc._id, userId })
        .sort({ createdAt: -1 })
        .select('result decisions createdAt updatedAt')
        .lean();
      return res.json({ application: toPublic(doc), version: version ? versionToPublic(version) : null });
    } catch (err) {
      console.error('load application failed:', err?.name ?? 'Error');
      return fail(res, 500, 'internal', 'Could not load the application');
    }
  });

  router.patch('/:id', async (req, res) => {
    if (!OBJECT_ID.test(req.params.id)) return notFound(res);
    const body = statusSchema.safeParse(req.body);
    if (!body.success) return fail(res, 400, 'bad_status', `Send { "status": "${APPLICATION_STATUSES.join('" | "')}" }`);
    try {
      const updated = await Application.findOneAndUpdate(
        { _id: req.params.id, userId: req.user.id },
        { $set: { status: body.data.status } },
        { returnDocument: 'after', runValidators: true },
      )
        .select('status')
        .lean();
      if (!updated) return notFound(res);
      return res.json({ status: updated.status });
    } catch (err) {
      console.error('update status failed:', err?.name ?? 'Error');
      return fail(res, 500, 'internal', 'Could not change the status');
    }
  });

  router.patch('/:id/versions/:versionId/decisions', async (req, res) => {
    const { id, versionId } = req.params;
    if (!OBJECT_ID.test(id) || !OBJECT_ID.test(versionId)) return notFound(res);
    const body = decisionsSchema.safeParse(req.body);
    if (!body.success) return fail(res, 400, 'bad_decisions', 'Send { "decisions": { "<itemId>": true | false } }');

    // All three ids in the filter: the version must belong to this application AND to this user.
    const filter = { _id: versionId, applicationId: id, userId: req.user.id };
    try {
      const doc = await ResumeVersion.findOne(filter).select('result.resume result.changes').lean();
      if (!doc) return notFound(res);

      // A rewrite rejected for an invented number or tool stays rejected, whatever the client sends.
      const refused = refusedDecisions(doc.result.changes, body.data.decisions);
      if (refused.length) {
        return fail(res, 400, 'not_toggleable', 'Only rewrites that passed the checks can be accepted or rejected', { itemIds: refused });
      }

      const updated = await ResumeVersion.findOneAndUpdate(
        filter,
        { $set: { decisions: body.data.decisions, ...buildResume(doc.result, body.data.decisions) } },
        { returnDocument: 'after', runValidators: true },
      )
        .select('decisions')
        .lean();
      if (!updated) return notFound(res); // deleted between the two queries
      return res.json({ decisions: updated.decisions ?? {} });
    } catch (err) {
      console.error('save decisions failed:', err?.name ?? 'Error');
      return fail(res, 500, 'internal', 'Could not save your decisions');
    }
  });

  router.delete('/:id', async (req, res) => {
    if (!OBJECT_ID.test(req.params.id)) return notFound(res);
    const userId = req.user.id;
    try {
      // MongoDB has no cascading delete: removing the application does NOT remove its versions.
      // 1. Delete the parent first. If it is not ours (or gone), stop with 404.
      const deleted = await Application.findOneAndDelete({ _id: req.params.id, userId }).select('_id').lean();
      if (!deleted) return notFound(res);
      // 2. Then its children. If this step failed, the leftovers would be unreachable orphans, and
      //    running the same deleteMany again is safe. The reverse order could leave an application
      //    with no resume.
      await ResumeVersion.deleteMany({ applicationId: deleted._id, userId });
      return res.status(204).end();
    } catch (err) {
      console.error('delete application failed:', err?.name ?? 'Error');
      return fail(res, 500, 'internal', 'Could not delete the application');
    }
  });

  return router;
}
