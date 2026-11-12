import fsp from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { loadSavedProfile, isEmptyProfile } from '../profile/access.js';
import { idSchema, profileSchema } from '../schemas/profile.js';
import { renderResume } from '../latex/template.js';
import { compileTex, CompileError } from '../latex/compile.js';
import { explainCompileLog } from '../latex/friendlyError.js';
import { countPdfPages } from '../latex/pageCount.js';
import { fitToOnePage, MAX_DROPS, FIT_DEADLINE_MS } from '../latex/fitToPage.js';

// POST /api/resume/render  { resumeJson, scores? }  -> the PDF, streamed, fitted to ONE page
//   If the PDF has more than one page, the lowest-scored bullet is dropped and the PDF is rebuilt, up
//   to 3 times. What happened is reported in headers (a PDF response cannot carry a JSON body):
//     X-Resume-Pages    the page count of the PDF returned (missing if it could not be read)
//     X-Resume-Dropped  ids of the bullets that were dropped, comma separated, in order (may be empty)
//     X-Resume-Fit      fits | too_long | unknown
// GET  /api/resume/tex                     -> the LaTeX source of your saved profile
// POST /api/resume/tex  { resumeJson }      -> the LaTeX source of the resume you send (e.g. a tailored one)
// Nothing here is saved. Nothing from a resume or a compile log is ever written to the console.

// The client sends the resume as a JSON object in profile shape (what the tailoring step returns).
// profileSchema is strict, so unknown keys and bad links are refused before any LaTeX is made.
// `scores` (optional) is the score of each bullet, as the tailoring step computes it. It only decides
// which bullet is dropped from THIS user's own resume. A bullet without a score counts as 0.
const scoresSchema = z
  .record(idSchema, z.number().min(0).max(1000))
  .refine((scores) => Object.keys(scores).length <= 200, 'At most 200 scores');
const renderBodySchema = z.strictObject({ resumeJson: profileSchema, scores: scoresSchema.optional() });
const texBodySchema = z.strictObject({ resumeJson: profileSchema });

const fail = (res, status, code, error, extra = {}) => res.status(status).json({ error, code, ...extra });

// `compile` and `loadProfile` are injectable so tests never start Tectonic or need a database.
// `limit` is injectable so a test can hit the rate limit in a few requests.
export function createResumeRouter({
  compile = compileTex,
  countPages = countPdfPages,
  loadProfile = loadSavedProfile,
  limit = 20,
  maxConcurrent = 2,
  maxDrops = MAX_DROPS,
  fitDeadlineMs = FIT_DEADLINE_MS,
} = {}) {
  const router = Router();

  // Applied to the whole router, so a route added later cannot forget the auth check.
  router.use(requireAuth);

  // A compile costs CPU for a few seconds. Counted per user, not per IP.
  const limiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit,
    keyGenerator: (req) => req.user.id,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => fail(res, 429, 'rate_limited', 'Too many PDF builds, try again in a few minutes'),
  });

  // Making .tex is only string work (no compile), so it gets a looser limit of its own.
  const texLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: limit * 3,
    keyGenerator: (req) => req.user.id,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => fail(res, 429, 'rate_limited', 'Too many downloads, try again in a few minutes'),
  });

  // Compiles running right now. A small cap keeps the server responsive.
  let running = 0;

  function compileFailed(res, err) {
    if (!(err instanceof CompileError)) {
      console.error(`resume render crashed: ${err?.name ?? 'Error'}`);
      return fail(res, 500, 'internal', 'Could not build the PDF');
    }
    // The kind only. The log can contain resume text, so it never goes to the console.
    console.error(`resume compile failed: ${err.kind}`);
    if (err.kind === 'unavailable') {
      return fail(res, 503, 'compiler_unavailable', 'PDF building is not available on this server right now. Your resume is fine; try again later.');
    }
    if (err.kind === 'timeout') {
      return fail(res, 504, 'compile_timeout', 'Building the PDF took too long and was stopped. Try again, or shorten the resume.');
    }
    const { message, details, log } = explainCompileLog(err.log);
    return fail(res, 422, 'compile_failed', message, { details, log });
  }

  router.post('/render', limiter, async (req, res) => {
    const parsed = renderBodySchema.safeParse(req.body);
    if (!parsed.success) {
      // Paths and messages only. The resume is never echoed back or logged.
      const issues = parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message }));
      return fail(res, 400, 'bad_resume', 'Send { "resumeJson": { ...a resume in profile shape... } }', { issues });
    }

    // Turned into LaTeX once up front, so an unusable link is a clean 400 before any compile starts.
    try {
      renderResume(parsed.data.resumeJson);
    } catch {
      return fail(res, 400, 'bad_resume', 'That resume could not be turned into a document (check its links)');
    }

    if (running >= maxConcurrent) {
      res.set('Retry-After', '5');
      return fail(res, 503, 'busy', 'The PDF builder is busy. Try again in a few seconds.');
    }

    // One concurrency slot for the whole fit loop (up to 4 compiles).
    let result;
    running += 1;
    try {
      result = await fitToOnePage({
        resume: parsed.data.resumeJson,
        scores: parsed.data.scores ?? {},
        compile,
        countPages,
        maxDrops,
        deadlineMs: fitDeadlineMs,
      });
    } catch (err) {
      return compileFailed(res, err);
    } finally {
      running -= 1;
    }

    const { pdfPath, cleanup } = result;
    const done = () => Promise.resolve(cleanup()).catch(() => {});

    // Open and measure the file BEFORE sending any header, so a problem here is still a clean JSON error.
    let handle;
    let size;
    try {
      handle = await fsp.open(pdfPath, 'r');
      size = (await handle.stat()).size;
    } catch {
      await handle?.close().catch(() => {});
      await done();
      console.error('resume render: could not open the compiled PDF');
      return fail(res, 500, 'internal', 'Could not build the PDF');
    }

    // Fixed filename, and the report headers hold only numbers, ids (letters, digits, _ and -) and a
    // fixed word: nothing free-form from the resume ever reaches a header.
    res.status(200).set({
      'Content-Type': 'application/pdf',
      'Content-Length': String(size),
      'Content-Disposition': 'inline; filename="resume.pdf"',
      'Cache-Control': 'no-store',
      'X-Resume-Dropped': result.dropped.map((d) => d.id).join(','),
      'X-Resume-Fit': result.fit,
      ...(result.pages ? { 'X-Resume-Pages': String(result.pages) } : {}),
    });
    try {
      // pipeline() copies the file to the response in chunks and stops cleanly if the client leaves.
      await pipeline(handle.createReadStream(), res);
    } catch {
      // Client disconnected mid-download. Nothing to report.
    } finally {
      await done();
    }
  });

  router.get('/tex', async (req, res) => {
    try {
      // The user id comes only from the verified session cookie, never from the URL or a body.
      const stored = await loadProfile(req.user.id);
      if (!stored) return fail(res, 404, 'no_profile', 'You do not have a saved profile yet');

      const parsed = profileSchema.safeParse(stored);
      if (!parsed.success) {
        console.error('resume tex: the saved profile failed validation');
        return fail(res, 500, 'bad_profile', 'Your saved profile could not be read');
      }
      if (isEmptyProfile(parsed.data)) return fail(res, 409, 'empty_profile', 'Your profile is empty, add some details first');

      res.status(200).set({
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'attachment; filename="resume.tex"',
        'Cache-Control': 'no-store',
      });
      return res.send(renderResume(parsed.data));
    } catch (err) {
      console.error('resume tex failed:', err?.name ?? 'Error');
      return fail(res, 500, 'internal', 'Could not build the LaTeX source');
    }
  });

  router.post('/tex', texLimiter, (req, res) => {
    const parsed = texBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const issues = parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message }));
      return fail(res, 400, 'bad_resume', 'Send { "resumeJson": { ...a resume in profile shape... } }', { issues });
    }

    let tex;
    try {
      // Same template and escaping as the PDF, so the download is exactly what /render compiles.
      tex = renderResume(parsed.data.resumeJson);
    } catch {
      return fail(res, 400, 'bad_resume', 'That resume could not be turned into a document (check its links)');
    }

    res.status(200).set({
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'attachment; filename="resume.tex"',
      'Cache-Control': 'no-store',
    });
    return res.send(tex);
  });

  return router;
}
