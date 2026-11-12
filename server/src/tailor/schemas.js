// Every shape in the tailoring pipeline.
//
// Principle: reject only what code cannot repair. An LLM retry costs free-tier quota, so the
// LLM-facing schemas (jdAnalysisSchema, rewriteSchema) are lenient where code can fix things
// afterwards (list lengths, odd enum values, unknown ids). Everything code produces is strict.

import { z } from 'zod';
import { idSchema, profileSchema } from '../schemas/profile.js';

// ---------- step 1: what the LLM returns for a job description ----------

const term = z.string().trim().min(1).max(80); // trimmed to 60 in code
const terms = (max) => z.array(term).max(max).default([]);

export const jdAnalysisSchema = z.strictObject({
  roleTitle: z.string().trim().max(200).default(''),
  company: z.string().trim().max(200).default(''),
  // .catch: an unexpected value ("Staff", "II") becomes 'unspecified' instead of failing the call.
  seniority: z.enum(['intern', 'junior', 'mid', 'senior', 'lead', 'unspecified']).catch('unspecified'),
  requiredSkills: terms(60),
  preferredSkills: terms(60),
  keywords: terms(80),
});

// ---------- step 2: scoring (code) ----------

export const scoredItemSchema = z.strictObject({
  id: idSchema,
  kind: z.enum(['experienceBullet', 'projectBullet', 'certification']),
  parentId: idSchema.nullable(), // the job or project; null for certifications
  score: z.number().min(0),
  matched: z.array(z.string()), // which job terms this item hit
  alwaysInclude: z.boolean(),
  lines: z.int().min(1), // estimated rendered lines, used by selection
});

// ---------- step 3: selection (code) ----------

export const selectionSchema = z.strictObject({
  // A job with no bullets at all is kept with an empty list; otherwise every entry has at least one.
  experience: z.array(z.strictObject({ id: idSchema, bulletIds: z.array(idSchema) })),
  projects: z.array(z.strictObject({ id: idSchema, bulletIds: z.array(idSchema).min(1) })),
  certificationIds: z.array(idSchema),
  budget: z.strictObject({ capacity: z.int(), used: z.int() }),
  dropped: z.array(
    z.strictObject({ id: idSchema, reason: z.enum(['over_budget', 'below_score_floor', 'section_cap']) }),
  ),
});

// ---------- step 4: what the LLM returns for the rewrite ----------

export const rewriteSchema = z.strictObject({
  rewrites: z
    .array(
      // z.object (extra keys are dropped) on purpose: we only ever read id and text, so an extra key
      // from the model is harmless and must not cost a retry.
      z.object({
        // NOT idSchema and NOT z.enum(allowedIds): an unknown or odd id is discarded in code
        // (guardrail.js) and must not fail the whole response.
        id: z.string().trim().max(40),
        text: z.string().trim().min(1).max(500),
      }),
    )
    .max(60),
});

// ---------- step 5: the guardrail's verdicts ----------

export const CHANGE_REASONS = [
  'ok', // accepted: a rewrite that passed every check
  'unchanged', // accepted: the model returned the same text
  'no_rewrite', // kept original: the model skipped this bullet
  'unknown_id', // rejected: the id is not in the profile
  'not_selected', // rejected: a real id, but that bullet was not selected for the page
  'empty', // rejected: blank text
  'new_number', // rejected: a number that is not in the original
  'new_term', // rejected: a company, tool or technology that is not in the original, the item or the profile skills
  'too_long', // rejected: longer than the page budget allows
];

export const changeSchema = z.strictObject({
  itemId: z.string().max(40),
  original: z.string(),
  rewritten: z.string(), // what the model proposed (equals `original` when it proposed nothing)
  accepted: z.boolean(), // false means the original bullet is what appears on the resume
  reason: z.enum(CHANGE_REASONS),
  offending: z.array(z.string()).max(10).optional(), // the numbers or names that tripped a check
});

// ---------- questions for a thin profile ----------

export const questionSchema = z.strictObject({ itemId: idSchema, question: z.string().min(1).max(200) });

// ---------- step 6: gap report ----------

const group = z.enum(['required', 'preferred', 'keyword']);

export const gapReportSchema = z.strictObject({
  matchScore: z.number().min(0).max(1).nullable(), // null when the job listed no required skills
  requiredMatched: z.int().min(0),
  requiredTotal: z.int().min(0),
  matched: z.array(z.strictObject({ term: z.string(), group, onResume: z.boolean() })),
  missing: z.array(z.strictObject({ term: z.string(), group })), // never added to the resume
});

// ---------- the response of POST /api/tailor ----------

export const tailorResponseSchema = z.strictObject({
  jdAnalysis: jdAnalysisSchema,
  selection: selectionSchema,
  changes: z.array(changeSchema),
  gapReport: gapReportSchema,
  questions: z.array(questionSchema),
  resume: profileSchema, // the selected, rewritten content in stored-profile shape (what /render takes)
  warnings: z.array(z.string()), // codes only, never resume text
  meta: z.strictObject({
    providers: z.strictObject({ analyze: z.string(), rewrite: z.string().nullable() }),
    ms: z.int().min(0),
  }),
});
