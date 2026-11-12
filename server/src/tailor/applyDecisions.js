// The server's own copy of client/src/lib/tailoring.js applyDecisions. The saved resume must be
// built HERE from the signed result, never taken from the client, or a crafted request could store
// text the guardrail never saw.

// Only rewrites that passed every guardrail check can be switched by the user.
export const isToggleable = (change) => change.reason === 'ok';

const usesRewrite = (change, decisions) => isToggleable(change) && (decisions[change.itemId] ?? change.accepted);

// The tailored resume with the user's Accept/Reject choices applied. Returns a new object.
export function applyDecisions(resume, changes, decisions = {}) {
  const textFor = new Map(
    changes.filter(isToggleable).map((c) => [c.itemId, usesRewrite(c, decisions) ? c.rewritten : c.original]),
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

// Item ids in `decisions` that the user is NOT allowed to switch (rejected by the guardrail, or unknown).
export function refusedDecisions(changes, decisions) {
  const toggleable = new Set(changes.filter(isToggleable).map((c) => c.itemId));
  return Object.keys(decisions).filter((id) => !toggleable.has(id));
}
