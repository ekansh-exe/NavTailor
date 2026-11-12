// A thin profile: a selected bullet that has no number in it.
//
// The pipeline will not invent a metric (the guardrail rejects any rewrite that adds one). Instead
// it asks the user. Pure code, no LLM: the wording comes from a few fixed templates chosen by what
// the bullet talks about.

import { hasNumber } from './terms.js';

export const MAX_QUESTIONS = 3;

// First match wins. The last entry is the general question.
const TEMPLATES = [
  [/\b(latency|performance|speed|faster|slow|optimi[sz]\w*|load time|response time|throughput|scal\w+)\b/i, 'Roughly how much faster or lighter did this make things (for example, load time or response time before and after)?'],
  [/\b(cost|revenue|sales|saving|savings|budget|profit|pricing|billing)\b/i, 'Roughly how much money did this save or earn?'],
  [/\b(team|mentor\w*|led|lead|managed|coordinat\w+|onboard\w*|train\w*)\b/i, 'Roughly how many people were involved, or how many did you lead or help?'],
  [/\b(automat\w+|manual|workflow|script\w*|pipeline|deploy\w*|release\w*|process\w*)\b/i, 'Roughly how much time did this save, and how often?'],
  [/\b(users?|customers?|clients?|traffic|dashboard|platform|portal|app|application)\b/i, 'Roughly how many users or customers did this serve?'],
];
const GENERAL = 'Roughly how many users or how much time did this save?';

export const questionFor = (text) => TEMPLATES.find(([pattern]) => pattern.test(text))?.[1] ?? GENERAL;

// bullets: the SELECTED experience and project bullets, best-scored first: [{ id, text }]
// Returns at most MAX_QUESTIONS questions, one per bullet that has no number.
export function buildQuestions(bullets, max = MAX_QUESTIONS) {
  return bullets
    .filter((b) => !hasNumber(b.text))
    .slice(0, max)
    .map((b) => ({ itemId: b.id, question: questionFor(b.text) }));
}
