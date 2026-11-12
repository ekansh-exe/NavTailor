// The tailoring pipeline: job description + profile -> a one-page resume, what changed, what is
// missing, and what we still need to ask. Saves nothing.
//
//   1 analyze (LLM)   2 score (code)   3 select (code)   4 rewrite (LLM)
//   5 guardrail (code)   6 gap report (code)   + questions for bullets without a metric (code)
//
// Failure rules: if step 1 fails there is nothing to score, so the error is thrown (the route turns
// it into a 502). If step 4 fails the resume is still produced from the ORIGINAL bullets.

import { callLLM } from '../llm/index.js';
import { LLMError } from '../llm/errors.js';
import { analyzeJob } from './analyze.js';
import { scoreProfile } from './score.js';
import { selectForPage } from './select.js';
import { runRewrite } from './rewrite.js';
import { applyRewrites, buildVocabulary } from './guardrail.js';
import { buildGapReport } from './gapReport.js';
import { buildQuestions } from './questions.js';

// id -> { text, skills, parentId, kind } for every bullet in the profile.
// `skills` are the item's own: a project bullet also counts its project's skills.
export function indexBullets(profile) {
  const bullets = new Map();
  for (const job of profile.experience) {
    for (const b of job.bullets) bullets.set(b.id, { id: b.id, text: b.text, skills: b.skills, parentId: job.id, kind: 'experienceBullet' });
  }
  for (const p of profile.projects) {
    for (const b of p.bullets) bullets.set(b.id, { id: b.id, text: b.text, skills: [...b.skills, ...p.skills], parentId: p.id, kind: 'projectBullet' });
  }
  return bullets;
}

// The one-page resume: the selected items, with accepted rewrites applied. Same shape as a stored
// profile, so POST /api/resume/render accepts it as it is.
export function buildResume(profile, selection, changes) {
  const newText = new Map(changes.filter((c) => c.accepted && c.reason === 'ok').map((c) => [c.itemId, c.rewritten]));
  const bulletsOf = (item, ids) =>
    item.bullets.filter((b) => ids.includes(b.id)).map((b) => ({ ...b, text: newText.get(b.id) ?? b.text }));

  const experience = selection.experience.map((sel) => {
    const job = profile.experience.find((j) => j.id === sel.id);
    return { ...job, bullets: bulletsOf(job, sel.bulletIds) };
  });
  const projects = selection.projects.map((sel) => {
    const project = profile.projects.find((p) => p.id === sel.id);
    return { ...project, bullets: bulletsOf(project, sel.bulletIds) };
  });
  const certifications = profile.certifications.filter((c) => selection.certificationIds.includes(c.id));
  return structuredClone({ ...profile, experience, projects, certifications });
}

// `llm` is injectable so tests never call a real provider.
export async function runTailor({ profile, jobDescription, llm = callLLM }) {
  const started = Date.now();
  const warnings = [];

  // 1. analyze (an LLMError here is fatal and propagates)
  const analyzed = await analyzeJob({ jobDescription, llm });
  const { analysis } = analyzed;
  warnings.push(...analyzed.warnings);

  // 2 + 3. score and select
  const scored = scoreProfile(profile, analysis);
  const { selection, warnings: selectWarnings } = selectForPage(profile, scored);
  warnings.push(...selectWarnings);

  const bullets = indexBullets(profile);
  const selectedIds = [...selection.experience.flatMap((j) => j.bulletIds), ...selection.projects.flatMap((p) => p.bulletIds)];
  const profileSkills = [...profile.skills.languages, ...profile.skills.frameworks, ...profile.skills.tools];

  // 4. rewrite (an LLMError here only means "no rewrites")
  let rewrites = [];
  let rewriteProvider = null;
  if (selectedIds.length) {
    try {
      const result = await runRewrite({
        bullets: selectedIds.map((id) => bullets.get(id)),
        analysis,
        allowedTechnologies: profileSkills,
        llm,
      });
      rewrites = result.rewrites;
      rewriteProvider = result.provider;
    } catch (err) {
      if (!(err instanceof LLMError)) throw err;
      warnings.push('rewrite_unavailable');
    }
  }

  // 5. guardrail
  const vocabulary = buildVocabulary({ profile, analysis });
  const changes = applyRewrites({ bullets, selectedIds, rewrites, profileSkills, vocabulary });

  // the resume, the gap report and the questions
  const resume = buildResume(profile, selection, changes);
  const gapReport = buildGapReport({ profile, analysis, resume });

  const score = new Map(scored.map((s) => [s.id, s.score]));
  const bestFirst = [...selectedIds].sort((a, b) => score.get(b) - score.get(a) || selectedIds.indexOf(a) - selectedIds.indexOf(b));
  const questions = buildQuestions(bestFirst.map((id) => ({ id, text: bullets.get(id).text })));

  return {
    jdAnalysis: analysis,
    selection,
    changes,
    gapReport,
    questions,
    resume,
    warnings: [...new Set(warnings)],
    meta: { providers: { analyze: analyzed.provider, rewrite: rewriteProvider }, ms: Date.now() - started },
  };
}
