// Step 2: score every bullet and certification against the job. Code only, no LLM.
//
// Each job term counts ONCE per item, at its best match:
//   full weight   the term is in the bullet's own skill tags, or written in its text
//   half weight   the term is only in the parent project's skill tags (project bullets)
// Weights: a required skill 3, a preferred skill 2, a keyword 1.
// Experience bullets marked alwaysInclude keep that flag; selection (step 3) honours it.

import { containsTerm, sameTerm } from './terms.js';
import { bulletLines, CERT_LINE } from './layout.js';

const WEIGHTS = { required: 3, preferred: 2, keyword: 1 };

export function jobTerms(analysis) {
  return [
    ...analysis.requiredSkills.map((term) => ({ term, group: 'required', weight: WEIGHTS.required })),
    ...analysis.preferredSkills.map((term) => ({ term, group: 'preferred', weight: WEIGHTS.preferred })),
    ...analysis.keywords.map((term) => ({ term, group: 'keyword', weight: WEIGHTS.keyword })),
  ];
}

// { score, matched[] } for one item.
export function scoreItem({ text, skills, parentSkills = [] }, terms) {
  let score = 0;
  const matched = [];
  for (const { term, weight } of terms) {
    const full = skills.some((s) => sameTerm(s, term)) || containsTerm(text, term);
    const half = !full && parentSkills.some((s) => sameTerm(s, term));
    if (full || half) {
      score += full ? weight : weight / 2;
      matched.push(term);
    }
  }
  return { score, matched };
}

// Returns scored items in profile order (experience, then projects, then certifications).
// That order is what ties are broken by later, so it must stay stable.
export function scoreProfile(profile, analysis) {
  const terms = jobTerms(analysis);
  const items = [];

  for (const job of profile.experience) {
    for (const b of job.bullets) {
      items.push({
        id: b.id,
        kind: 'experienceBullet',
        parentId: job.id,
        ...scoreItem({ text: b.text, skills: b.skills }, terms),
        alwaysInclude: b.alwaysInclude,
        lines: bulletLines(b.text),
      });
    }
  }
  for (const p of profile.projects) {
    for (const b of p.bullets) {
      items.push({
        id: b.id,
        kind: 'projectBullet',
        parentId: p.id,
        ...scoreItem({ text: b.text, skills: b.skills, parentSkills: p.skills }, terms),
        alwaysInclude: false,
        lines: bulletLines(b.text),
      });
    }
  }
  for (const c of profile.certifications) {
    items.push({
      id: c.id,
      kind: 'certification',
      parentId: null,
      ...scoreItem({ text: `${c.name} ${c.issuer}`, skills: c.skills }, terms),
      alwaysInclude: false,
      lines: CERT_LINE,
    });
  }
  return items;
}
