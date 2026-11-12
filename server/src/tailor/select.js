// Step 3: choose what goes on ONE page. Code only. Deterministic: the same input always gives the
// same page, with ties broken by profile order.
//
//   1. Must keep: every alwaysInclude bullet, plus the best bullet of each job (no empty jobs).
//   2. Then fill the remaining space with the best-scored bullets and certifications that fit.
//      Projects and certifications that match nothing in the job stay off the page.
//   3. Caps per job, project and certifications keep the page balanced.
// "Fits" is an estimate in text lines (layout.js), not a real render.

import { PAGE_LINES, SECTION_HEADING, JOB_HEADER, PROJECT_HEADER, fixedLines } from './layout.js';

export const MIN_SCORE = 1; // a project bullet or certification below this is not relevant enough
export const CAPS = { perJob: 5, perProject: 3, certifications: 4 };

export function selectForPage(profile, scored, { capacity = PAGE_LINES } = {}) {
  const warnings = [];
  const items = scored.map((item, index) => ({ ...item, index })); // index = profile order
  const picked = new Set();
  const dropped = [];
  const perParent = new Map(); // job or project id -> bullets picked so far
  const headerPaid = new Set(); // jobs and projects whose heading line is already counted
  const sectionPaid = new Set(); // 'experience' | 'projects' | 'certifications'
  let used = fixedLines(profile);

  // What picking this item would add to the page.
  function costOf(item) {
    let cost = item.lines;
    const section = { experienceBullet: 'experience', projectBullet: 'projects', certification: 'certifications' }[item.kind];
    if (!sectionPaid.has(section)) cost += SECTION_HEADING;
    if (item.kind === 'experienceBullet' && !headerPaid.has(item.parentId)) cost += JOB_HEADER;
    if (item.kind === 'projectBullet' && !headerPaid.has(item.parentId)) cost += PROJECT_HEADER;
    return cost;
  }
  function take(item) {
    used += costOf(item);
    const section = { experienceBullet: 'experience', projectBullet: 'projects', certification: 'certifications' }[item.kind];
    sectionPaid.add(section);
    if (item.parentId) {
      headerPaid.add(item.parentId);
      perParent.set(item.parentId, (perParent.get(item.parentId) ?? 0) + 1);
    }
    if (item.kind === 'certification') perParent.set('certs', (perParent.get('certs') ?? 0) + 1);
    picked.add(item.id);
  }

  // ---- 1. must keep ----
  for (const job of profile.experience) {
    const bullets = items.filter((i) => i.kind === 'experienceBullet' && i.parentId === job.id);
    if (!bullets.length) {
      // A job with no bullets is still listed (its heading costs space).
      used += JOB_HEADER + (sectionPaid.has('experience') ? 0 : SECTION_HEADING);
      sectionPaid.add('experience');
      continue;
    }
    // best = highest score; on a tie the earliest bullet
    const best = bullets.reduce((a, b) => (b.score > a.score ? b : a));
    for (const item of bullets) if (item.alwaysInclude || item === best) take(item);
  }
  if (used > capacity) warnings.push('mandatory_over_budget');

  // ---- 2. fill ----
  const pool = items.filter((i) => !picked.has(i.id)).sort((a, b) => b.score - a.score || a.index - b.index);
  for (const item of pool) {
    if (item.kind !== 'experienceBullet' && item.score < MIN_SCORE) {
      dropped.push({ id: item.id, reason: 'below_score_floor' });
      continue;
    }
    const count = item.kind === 'certification' ? (perParent.get('certs') ?? 0) : (perParent.get(item.parentId) ?? 0);
    const cap = { experienceBullet: CAPS.perJob, projectBullet: CAPS.perProject, certification: CAPS.certifications }[item.kind];
    if (count >= cap) {
      dropped.push({ id: item.id, reason: 'section_cap' });
      continue;
    }
    // Does not fit? Keep going: a shorter item further down may.
    if (used + costOf(item) > capacity) {
      dropped.push({ id: item.id, reason: 'over_budget' });
      continue;
    }
    take(item);
  }

  // ---- 3. emit in profile order ----
  const experience = profile.experience
    .map((job) => ({ id: job.id, bulletIds: job.bullets.filter((b) => picked.has(b.id)).map((b) => b.id) }))
    .filter((job, i) => job.bulletIds.length > 0 || profile.experience[i].bullets.length === 0);
  const projects = profile.projects
    .map((p) => ({ id: p.id, bulletIds: p.bullets.filter((b) => picked.has(b.id)).map((b) => b.id) }))
    .filter((p) => p.bulletIds.length > 0);
  const certificationIds = profile.certifications.filter((c) => picked.has(c.id)).map((c) => c.id);

  return { selection: { experience, projects, certificationIds, budget: { capacity, used }, dropped }, warnings };
}
