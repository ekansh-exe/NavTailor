// Step 6: which job terms does the user have, and which not. Code only.
//
//   matched   the profile has it. onResume says whether it is actually written on the one-page
//             resume (false = "you have it, but it did not fit")
//   missing   the profile does not have it. It goes here and NOWHERE else: the pipeline never
//             adds a missing skill to the resume.
//   score     matched required skills / all required skills, from the PROFILE, so it does not
//             move with how the page happened to be filled

import { containsTerm, sameTerm } from './terms.js';
import { jobTerms } from './score.js';

// The skill tags and the text of a profile-shaped object.
// renderedOnly: true counts only what the template prints. Skill tags on a bullet or certification
// are not printed, so they do not make a term "on the resume".
function sources(p, { renderedOnly }) {
  const tags = [...p.skills.languages, ...p.skills.frameworks, ...p.skills.tools, ...p.projects.flatMap((x) => x.skills)];
  const texts = [p.summary, ...p.projects.map((x) => x.name)];
  for (const job of p.experience) for (const b of job.bullets) { texts.push(b.text); if (!renderedOnly) tags.push(...b.skills); }
  for (const proj of p.projects) for (const b of proj.bullets) { texts.push(b.text); if (!renderedOnly) tags.push(...b.skills); }
  for (const c of p.certifications) { texts.push(`${c.name} ${c.issuer}`); if (!renderedOnly) tags.push(...c.skills); }
  // Printed as they are on every resume (never selected or rewritten).
  // (?? because these optional fields are missing on profiles saved before they existed.)
  texts.push(...p.projects.map((x) => x.tagline ?? ''), ...(p.achievements ?? []).map((a) => a.text), ...(p.activities ?? []).map((a) => a.title));
  return { tags, texts };
}

const has = ({ tags, texts }, term) => tags.some((t) => sameTerm(t, term)) || texts.some((t) => containsTerm(t, term));

// profile: the full master profile. resume: the tailored, one-page content (profile shape).
export function buildGapReport({ profile, analysis, resume }) {
  const inProfile = sources(profile, { renderedOnly: false });
  const onResume = sources(resume, { renderedOnly: true });

  const matched = [];
  const missing = [];
  for (const { term, group } of jobTerms(analysis)) {
    if (has(inProfile, term)) matched.push({ term, group, onResume: has(onResume, term) });
    else missing.push({ term, group });
  }

  const requiredTotal = analysis.requiredSkills.length;
  const requiredMatched = matched.filter((m) => m.group === 'required').length;
  return {
    matchScore: requiredTotal ? requiredMatched / requiredTotal : null,
    requiredMatched,
    requiredTotal,
    matched,
    missing,
  };
}
