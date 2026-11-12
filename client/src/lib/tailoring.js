// Pure helpers for the Result page: data in, data out. No fetch, no React.

// Only rewrites that passed the server's guardrail can be switched. The server enforces the same
// rule on PATCH /decisions, so this is for the UI, not for safety.
export const isToggleable = (change) => change.reason === 'ok';

// What the user currently wants for one change: their saved choice, or the pipeline's default.
export const usesRewrite = (change, decisions) =>
  isToggleable(change) && (decisions[change.itemId] ?? change.accepted);

// The tailored resume with the user's Accept/Reject choices applied. Every toggleable bullet gets
// either the rewritten or the original text. Returns a new object; the input is not changed.
export function applyDecisions(resume, changes, decisions) {
  const textFor = new Map(
    changes
      .filter(isToggleable)
      .map((c) => [c.itemId, usesRewrite(c, decisions) ? c.rewritten : c.original]),
  );
  const withText = (item) => ({
    ...item,
    bullets: item.bullets.map((b) => (textFor.has(b.id) ? { ...b, text: textFor.get(b.id) } : b)),
  });
  return {
    ...resume,
    experience: resume.experience.map(withText),
    projects: resume.projects.map(withText),
  };
}

// The resume without the bullets the PDF fit loop dropped, so the .tex download matches the PDF.
export function removeBullets(resume, ids) {
  if (!ids.length) return resume;
  const drop = new Set(ids);
  const without = (item) => ({ ...item, bullets: item.bullets.filter((b) => !drop.has(b.id)) });
  return {
    ...resume,
    experience: resume.experience.map(without),
    projects: resume.projects.map(without),
  };
}

// "Acme Corp · Software Engineer" or the project name, for a bullet id. Used as a card label.
export function bulletContext(resume, id) {
  for (const job of resume.experience) {
    if (job.bullets.some((b) => b.id === id)) return [job.company, job.role].filter(Boolean).join(' · ');
  }
  for (const project of resume.projects) {
    if (project.bullets.some((b) => b.id === id)) return project.name || 'Project';
  }
  return '';
}

// Plain-words versions of the guardrail's reason codes.
export const BLOCK_REASON = {
  new_number: 'Added a number that is not in your original',
  new_term: 'Added a tool, technology or company that is not in your profile',
  too_long: 'Too long for the page',
  empty: 'The rewrite was empty',
};

// Turns an API error into one sentence for the user. `byCode` overrides per page.
export function errorMessage(err, byCode = {}) {
  const code = err?.data?.code;
  if (code && byCode[code]) return byCode[code];
  if (err?.status === 401) return 'Your session expired. Sign in again.';
  if (err?.status === 429) return err.data?.error ?? 'Too many requests. Wait a few minutes and try again.';
  return err?.data?.error ?? 'Something went wrong. Try again.';
}

// Saves a Blob as a file. The temporary blob: URL is revoked once the download has had time to start
// (revoking in the same tick can cancel it in some browsers).
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// "Initech Backend Engineer" -> "initech-backend-engineer", for download file names.
export const slug = (...parts) =>
  parts
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'resume';
