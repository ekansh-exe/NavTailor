// Make the resume fit ONE page: build the PDF, count its pages, and while it is too long drop the
// lowest-scored bullet and build again (at most MAX_DROPS times).
//
//   dropLowestBullet()  pure: decides what to remove. No files, no processes.
//   fitToOnePage()      the loop around it. The compiler and the page counter are parameters, so
//                       tests drive it with fakes.
//
// Rules for what may be dropped:
//   - never a bullet marked alwaysInclude
//   - never the last bullet of a job or project (no empty entries)
//   - lowest score first; on a tie the bottom-most bullet goes, because that is where the overflow is
//   - a bullet without a score counts as 0

import { renderResume } from './template.js';

export const MAX_DROPS = 3;
export const FIT_DEADLINE_MS = 60_000;

// Returns { resume, dropped } with ONE bullet removed from a copy, or null when nothing may be dropped.
// dropped = { id, section, parentId, score }
export function dropLowestBullet(resume, scores = {}) {
  const scoreOf = (id) => (Object.hasOwn(scores, id) && Number.isFinite(scores[id]) ? scores[id] : 0);
  let position = 0; // document order: experience first, then projects
  let best = null;

  const consider = (section, items) => {
    items.forEach((item, itemIndex) => {
      item.bullets.forEach((bullet, bulletIndex) => {
        position += 1;
        if (item.bullets.length < 2) return; // the last bullet of an entry stays
        if (section === 'experience' && bullet.alwaysInclude) return;
        const candidate = { section, itemIndex, bulletIndex, id: bullet.id, parentId: item.id, score: scoreOf(bullet.id), position };
        // lowest score wins; on a tie, the later position wins
        if (!best || candidate.score < best.score || (candidate.score === best.score && candidate.position > best.position)) best = candidate;
      });
    });
  };
  consider('experience', resume.experience);
  consider('projects', resume.projects);
  if (!best) return null;

  const smaller = structuredClone(resume);
  smaller[best.section][best.itemIndex].bullets.splice(best.bulletIndex, 1);
  return { resume: smaller, dropped: { id: best.id, section: best.section, parentId: best.parentId, score: best.score } };
}

// compile(texSource)  -> { pdfPath, cleanup }       (throws CompileError, which is NOT caught here)
// countPages(pdfPath) -> number                     (if it throws, the PDF is still returned, fit "unknown")
// Returns { pdfPath, cleanup, pages, fit, dropped }:
//   fit "fits"     one page
//   fit "too_long" still more than one page (out of drops, out of droppable bullets, or out of time)
//   fit "unknown"  the page count could not be read
// The caller owns the returned PDF and must call cleanup(). Every PDF that is NOT returned is cleaned up here.
export async function fitToOnePage({
  resume,
  scores = {},
  compile,
  countPages,
  render = renderResume,
  maxDrops = MAX_DROPS,
  deadlineMs = FIT_DEADLINE_MS,
  now = Date.now,
}) {
  const started = now();
  const dropped = [];
  let current = resume;

  for (;;) {
    const compiled = await compile(render(current));

    let pages = null;
    try {
      pages = await countPages(compiled.pdfPath);
    } catch {
      return { ...compiled, pages: null, fit: 'unknown', dropped };
    }
    if (pages <= 1) return { ...compiled, pages, fit: 'fits', dropped };

    const outOfDrops = dropped.length >= maxDrops;
    const outOfTime = now() - started >= deadlineMs;
    const next = outOfDrops || outOfTime ? null : dropLowestBullet(current, scores);
    if (!next) return { ...compiled, pages, fit: 'too_long', dropped };

    await Promise.resolve(compiled.cleanup()).catch(() => {}); // this PDF is too long: discard it
    current = next.resume;
    dropped.push(next.dropped);
  }
}
