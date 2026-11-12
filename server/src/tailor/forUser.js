// "Tailor this user's saved profile to this job description", shared by POST /api/tailor (returns
// the result, saves nothing) and POST /api/applications (saves it). One place, so the checks
// (profile exists, is valid, is not empty, result matches its schema) cannot drift apart.
//
// Returns { ok: true, data } or { ok: false, status, code, error, extra }. Never throws for an
// expected failure. Nothing from a job description, a resume or an LLM answer reaches the console.

import { callLLM } from '../llm/index.js';
import { LLMError } from '../llm/errors.js';
import { loadSavedProfile, isEmptyProfile } from '../profile/access.js';
import { profileSchema } from '../schemas/profile.js';
import { runTailor } from './pipeline.js';
import { tailorResponseSchema } from './schemas.js';

const failure = (status, code, error, extra = {}) => ({ ok: false, status, code, error, extra });

export async function tailorForUser({ userId, jobDescription, llm = callLLM, loadProfile = loadSavedProfile }) {
  try {
    // The user id comes only from the verified session cookie.
    const stored = await loadProfile(userId);
    if (!stored) return failure(404, 'no_profile', 'You do not have a saved profile yet');

    const parsed = profileSchema.safeParse(stored);
    if (!parsed.success) {
      console.error('tailor: the saved profile failed validation');
      return failure(500, 'bad_profile', 'Your saved profile could not be read');
    }
    // Checked before any LLM call, so an empty account burns no quota.
    if (isEmptyProfile(parsed.data)) return failure(409, 'empty_profile', 'Your profile is empty, add some details first');

    const result = await runTailor({ profile: parsed.data, jobDescription, llm });

    // Last guard: the result must match its schema before anyone sees or stores it.
    const final = tailorResponseSchema.safeParse(result);
    if (!final.success) {
      console.error('tailor: the result failed final validation');
      return failure(500, 'internal', 'Could not tailor the resume');
    }
    return { ok: true, data: final.data };
  } catch (err) {
    if (err instanceof LLMError) {
      // kind and causes hold no prompts, text or keys.
      console.error(`tailor llm failed: ${err.kind}`);
      return failure(502, 'llm', 'LLM call failed', { kind: err.kind, causes: err.causes ?? [] });
    }
    console.error('tailor crashed:', err?.name ?? 'Error');
    return failure(500, 'internal', 'Could not tailor the resume');
  }
}
