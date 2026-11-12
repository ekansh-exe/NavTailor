// The guardrail: code that checks every rewrite before it is accepted.
//
// Everything in this file is a PURE function: data in, verdict out. No network, no database, no
// model. That is the point. A prompt only asks the model to behave; these functions are what
// actually stop a rewrite that adds a number or a tool the user never wrote.
//
// Checks, in order, for each rewrite:
//   1. the id must be one of the bullets selected for the page   (unknown ids are discarded)
//   2. every number in the new text is in the original            (new_number)
//   3. every company / tool / technology name in the new text is in the original, the item's own
//      skills or the profile's skills                              (new_term)
//   4. it is not much longer than the original                     (too_long)
// A failed check keeps the original bullet. Missing skills never reach the resume from here.

import { containsTerm, extractNumbers, canonKey } from './terms.js';
import { KNOWN_TECH } from './knownTech.js';

export const MAX_BULLET_CHARS = 500;

// ---------- 2. numbers ----------

// Numbers in `rewritten` that are not in `original`. [] means the check passed.
export function findNewNumbers(original, rewritten) {
  const allowed = new Set(extractNumbers(original));
  return [...new Set(extractNumbers(rewritten).filter((n) => !allowed.has(n)))];
}

// ---------- 3. names ----------

// Every name a rewrite could wrongly introduce:
//   - the job's required and preferred skills and the job's company (the temptation: the model
//     wants to sound like the job description)
//   - every skill tag and company in the profile (a name must not hop from one item to another)
//   - a built-in list of common technologies (the model inventing from its own memory)
// The job's loose "keywords" are NOT here on purpose: using them ("stakeholder management",
// "cross-functional") is exactly the terminology change a rewrite is for.
export function buildVocabulary({ profile, analysis }) {
  const names = [
    ...analysis.requiredSkills,
    ...analysis.preferredSkills,
    ...(analysis.company ? [analysis.company] : []),
    ...profile.skills.languages,
    ...profile.skills.frameworks,
    ...profile.skills.tools,
    ...profile.experience.flatMap((job) => [job.company, ...job.bullets.flatMap((b) => b.skills)]),
    ...profile.projects.flatMap((p) => [...p.skills, ...p.bullets.flatMap((b) => b.skills)]),
    ...profile.certifications.flatMap((c) => [c.issuer, ...c.skills]),
    ...KNOWN_TECH,
  ];
  const byKey = new Map();
  for (const name of names) {
    const trimmed = String(name).trim();
    if (trimmed && !byKey.has(canonKey(trimmed))) byKey.set(canonKey(trimmed), trimmed);
  }
  return [...byKey.values()];
}

// Short generic abbreviations that are not names of products or employers.
const GENERIC = new Set(['api', 'apis', 'ui', 'ux', 'ci', 'cd', 'qa', 'kpi', 'kpis', 'roi', 'saas', 'b2b', 'b2c', 'sdk', 'sdks', 'crm', 'mvp', 'it', 'hr', 'pr', 'seo', 'okr', 'okrs', 'sla', 'slas', 'etl', 'cto', 'ceo', 'cfo', 'vp', 'us', 'uk', 'eu']);
const NOT_NAMES = new Set(['i', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']);

// A word, keeping "Node.js", "C++", "C#" and "scikit-learn" in one piece.
const WORD = /[A-Za-z][A-Za-z0-9+#]*(?:[.-][A-Za-z0-9+#]+)*/g;

const parts = (lower) => lower.split(/[.-]/).filter(Boolean);

// Does this word, at this position, look like the name of something?
function looksLikeName(word, index, text) {
  const symbol = /[+#]/.test(word) || /^[A-Za-z0-9]+\.(js|net|io|ai|py|rs|ts|css|html)$/i.test(word);
  if (symbol) return true;
  if (/[a-z][A-Z]/.test(word)) return true; // camelCase: TypeScript, GitHub, iOS
  if (/^[A-Z][A-Z0-9]+$/.test(word)) return true; // ALL CAPS: AWS, SQL
  if (/^[A-Z][a-z]+$/.test(word)) {
    // A plain capitalised word is only suspicious mid-sentence ("Terraform"), not at the start of one.
    const before = text.slice(0, index).trimEnd();
    return before !== '' && !/[.!?:;(\["“•–—-]$/.test(before);
  }
  return false;
}

// Names in `rewritten` that are not allowed. [] means the check passed.
export function findNewTerms({ original, rewritten, itemSkills = [], profileSkills = [], vocabulary = [] }) {
  const allowedText = [original, ...itemSkills, ...profileSkills].join(' \n ');
  const offending = [];

  // Layer 1, the main defence: a known name in the new text must be allowed.
  // Detection is strict about everyday-word names (guard); permission is lenient about case.
  for (const name of vocabulary) {
    if (containsTerm(rewritten, name, { guard: true }) && !containsTerm(allowedText, name)) offending.push(name);
  }

  // Layer 2, a net for names we have never heard of: anything that is shaped like a name and is
  // not written anywhere in what the user gave us. Some false alarms are fine: the cost of one is
  // that a single bullet keeps its original wording.
  // Words are compared by canonKey, so "Postgres" and "PostgreSQL", or "API" and "APIs", are one word.
  const allowedKeys = new Set();
  for (const w of allowedText.match(WORD) ?? []) {
    const lower = w.toLowerCase();
    for (const piece of [lower, ...parts(lower)]) allowedKeys.add(canonKey(piece));
  }
  const known = (piece) => allowedKeys.has(canonKey(piece)) || GENERIC.has(piece) || GENERIC.has(piece.replace(/s$/, '')) || NOT_NAMES.has(piece);
  for (const match of rewritten.matchAll(WORD)) {
    const word = match[0];
    const lower = word.toLowerCase();
    // Known as a whole ("Node.js"), or every piece of it is known ("scikit-learn").
    const pieces = parts(lower);
    if (known(lower) || (pieces.length > 1 && pieces.every(known))) continue;
    if (looksLikeName(word, match.index, rewritten)) offending.push(word);
  }

  return [...new Set(offending)].slice(0, 10);
}

// ---------- 4. length ----------

// Selection sized the page from the original text, so a rewrite may not grow much.
export function isTooLong(original, rewritten) {
  const limit = Math.min(MAX_BULLET_CHARS, Math.max(Math.ceil(original.length * 1.25), original.length + 20));
  return rewritten.length > limit;
}

// ---------- one rewrite ----------

const squash = (s) => s.replace(/\s+/g, ' ').trim();

// Verdict for ONE rewrite of ONE known bullet:
//   { accepted: true,  reason: 'ok' | 'unchanged' }
//   { accepted: false, reason: 'empty' | 'new_number' | 'new_term' | 'too_long', offending: [...] }
export function checkRewrite({ original, rewritten, itemSkills = [], profileSkills = [], vocabulary = [] }) {
  const text = squash(String(rewritten ?? ''));
  if (!text) return { accepted: false, reason: 'empty', offending: [] };
  if (text === squash(original)) return { accepted: true, reason: 'unchanged' };

  const numbers = findNewNumbers(original, text);
  if (numbers.length) return { accepted: false, reason: 'new_number', offending: numbers };

  const names = findNewTerms({ original, rewritten: text, itemSkills, profileSkills, vocabulary });
  if (names.length) return { accepted: false, reason: 'new_term', offending: names };

  if (isTooLong(original, text)) return { accepted: false, reason: 'too_long', offending: [] };

  return { accepted: true, reason: 'ok' };
}

// ---------- all rewrites ----------

// bullets:     Map of EVERY bullet in the profile: id -> { text, skills }  (skills = the item's own)
// selectedIds: the bullet ids chosen for the page, in page order
// rewrites:    what the model returned: [{ id, text }]
// Returns changes[] in the shape the API promises:
//   { itemId, original, rewritten, accepted, reason, offending? }
// accepted: false always means "the original bullet is what appears on the resume".
export function applyRewrites({ bullets, selectedIds, rewrites, profileSkills = [], vocabulary = [] }) {
  const selected = new Set(selectedIds);
  const verdicts = new Map(); // id -> change, for selected bullets
  const extras = []; // rewrites that name an id we cannot apply
  const seen = new Set();

  for (const { id, text } of rewrites) {
    if (seen.has(id)) continue; // the first rewrite of an id wins
    seen.add(id);

    const bullet = bullets.get(id);
    if (!bullet) {
      extras.push({ itemId: id, original: '', rewritten: text, accepted: false, reason: 'unknown_id' });
      continue;
    }
    if (!selected.has(id)) {
      extras.push({ itemId: id, original: bullet.text, rewritten: text, accepted: false, reason: 'not_selected' });
      continue;
    }

    const verdict = checkRewrite({ original: bullet.text, rewritten: text, itemSkills: bullet.skills, profileSkills, vocabulary });
    const change = {
      itemId: id,
      original: bullet.text,
      // An accepted rewrite is stored whitespace-tidied, exactly as it will be used.
      rewritten: verdict.accepted ? (verdict.reason === 'unchanged' ? bullet.text : squash(text)) : text,
      accepted: verdict.accepted,
      reason: verdict.reason,
    };
    if (!verdict.accepted && verdict.offending.length) change.offending = verdict.offending;
    verdicts.set(id, change);
  }

  const changes = selectedIds.map(
    (id) =>
      verdicts.get(id) ?? {
        itemId: id,
        original: bullets.get(id).text,
        rewritten: bullets.get(id).text,
        accepted: false,
        reason: 'no_rewrite',
      },
  );
  return [...changes, ...extras];
}
