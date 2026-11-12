import { Router } from 'express';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { callLLM } from '../llm/index.js';
import { LLMError } from '../llm/errors.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { profileSchema } from '../schemas/profile.js';
import { detectType } from '../import/detectType.js';
import { extractText, ExtractError } from '../import/extractText.js';
import { cleanText, hasTooLittleText, MAX_TEXT_CHARS } from '../import/cleanText.js';
import { importSchema } from '../import/importSchema.js';
import { IMPORT_SYSTEM, buildImportUserPrompt } from '../import/prompt.js';
import { buildDraft } from '../import/buildDraft.js';

// POST /api/profile/import
// Turns a resume (PDF, DOCX or pasted text) into a DRAFT profile. It never touches the
// database: the client reviews the draft and saves it with the normal PUT /api/profile.

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PASTE_CHARS = 30_000;

const pasteSchema = z.object({ text: z.string().trim().min(1).max(MAX_PASTE_CHARS) });

// memoryStorage: the upload lives only in a Buffer in RAM. Nothing is written to disk, so there
// is no file path to attack and nothing to clean up. The client's filename and MIME type are
// never read. fields: 0 refuses any extra text fields.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 0, parts: 2 },
}).single('file');

// Runs multer only for multipart requests, and turns its errors into plain JSON answers.
function receiveUpload(req, res, next) {
  if (!req.is('multipart/form-data')) return next();
  upload(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File is too large (2 MB maximum)', code: 'too_big' });
    }
    // Wrong field name, extra files or fields, or a malformed multipart body.
    return res.status(400).json({ error: 'Send exactly one file in the "file" field', code: 'bad_upload' });
  });
}

const fail = (res, status, code, error, extra = {}) => res.status(status).json({ error, code, ...extra });

// `llm` and `extract` are injectable so tests never call a real provider.
// `limit` is injectable so a test can hit the rate limit in a few requests.
export function createImportRouter({ llm = callLLM, extract = extractText, limit = 5 } = {}) {
  const router = Router();

  // Auth runs BEFORE multer, so an anonymous request never gets its upload parsed.
  router.use(requireAuth);

  // Each import costs CPU and free-tier LLM quota. Counted per user, not per IP.
  const limiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit,
    keyGenerator: (req) => req.user.id,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => fail(res, 429, 'rate_limited', 'Too many imports, try again later'),
  });

  router.post('/', limiter, receiveUpload, async (req, res) => {
    // 1. Get raw text from a file or from the pasted body.
    let raw;
    if (req.file) {
      const kind = await detectType(req.file.buffer);
      if (!kind) return fail(res, 415, 'bad_type', 'Only PDF and DOCX files are supported');
      try {
        raw = await extract(kind, req.file.buffer);
      } catch (err) {
        const code = err instanceof ExtractError ? err.code : 'unexpected';
        console.error(`import extract failed: ${code}`);
        return fail(res, 422, 'unreadable', 'Could not read that file (damaged, locked or too complex)');
      }
    } else if (req.is('multipart/form-data')) {
      return fail(res, 400, 'no_file', 'No file was sent');
    } else if (req.is('application/json')) {
      const parsed = pasteSchema.safeParse(req.body);
      if (!parsed.success) return fail(res, 400, 'bad_text', 'Send { "text": "..." } with 1 to 30000 characters');
      raw = parsed.data.text;
    } else {
      return fail(res, 415, 'bad_type', 'Send a PDF, a DOCX or JSON with pasted text');
    }

    // 2. Clean it, and stop early when there is almost nothing (a scanned PDF has no text layer).
    const { text, truncated } = cleanText(raw);
    if (hasTooLittleText(text)) {
      return fail(res, 422, 'too_little_text', 'Almost no text was found in that file', { chars: text.length });
    }

    // 3. Ask the LLM, then rebuild ids and drop anything not in the source.
    try {
      const { data, provider, ms } = await llm({
        task: 'parse',
        system: IMPORT_SYSTEM,
        user: buildImportUserPrompt(text),
        schema: importSchema,
        maxTokens: 4096,
      });

      const { draft, warnings } = buildDraft(data, text);
      if (truncated) {
        warnings.unshift(`Your resume is long, so only the first ${MAX_TEXT_CHARS} characters were read`);
      }

      // Last guard: the draft must be a valid profile, exactly what PUT /api/profile accepts.
      const final = profileSchema.safeParse(draft);
      if (!final.success) {
        console.error('import draft failed final validation');
        return fail(res, 502, 'llm', 'Could not build a valid profile from that resume', { kind: 'schema' });
      }
      return res.json({ draft: final.data, warnings, meta: { provider, ms, truncated } });
    } catch (err) {
      if (err instanceof LLMError) {
        // kind and causes hold no prompts, text or keys.
        console.error(`import llm failed: ${err.kind}`);
        return fail(res, 502, 'llm', 'LLM call failed', { kind: err.kind, causes: err.causes ?? [] });
      }
      console.error('import crashed:', err.message);
      return fail(res, 500, 'internal', 'Import failed');
    }
  });

  return router;
}
