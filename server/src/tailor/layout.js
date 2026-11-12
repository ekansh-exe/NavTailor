// How much page a piece of the resume takes. There is no renderer in the pipeline, so "fits one
// page" is an ESTIMATE in text lines, calibrated against real Tectonic 0.17 output of the A4,
// Fira Sans, 0.45in-margin template in latex/template.js:
//   - a bullet line holds 123 to 129 characters (measured with pdftotext), so 118 is slightly safe
//   - with these costs, differently shaped test profiles all fit one page at an estimate of
//     68 lines and the first one spilled onto a second page at 69 (long multi-line bullets
//     overestimate, so they spill later: at 87)
// PAGE_LINES leaves margin under that cliff. The page-fit loop in latex/fitToPage.js catches
// whatever the estimate still gets wrong. Re-measure if the template's spacing or font changes.

export const PAGE_LINES = 66;
export const CHARS_PER_LINE = 118;
const FULL_LINE_CHARS = 125; // an unindented paragraph (the summary)

export const SECTION_HEADING = 2; // heading plus its rule and spacing
export const JOB_HEADER = 3; // company/dates line, role/location line, a gap
export const PROJECT_HEADER = 3; // name/dates line, skills/link line, a gap
export const CERT_LINE = 1;

export const bulletLines = (text) => Math.max(1, Math.ceil(String(text).length / CHARS_PER_LINE));

// What the page always carries, whatever is selected: contact header, summary, education, skills,
// activities and achievements. (Experience, projects and certifications are paid for as they are
// selected.)
export function fixedLines(profile) {
  let lines = 2 + (profile.basics.links.length ? 1 : 0); // name, contact line, links line
  if (profile.summary) lines += SECTION_HEADING + Math.ceil(profile.summary.length / FULL_LINE_CHARS);
  if (profile.education.length) {
    lines += SECTION_HEADING + profile.education.reduce((sum, e) => sum + 1 + (e.degree || e.grade ? 1 : 0), 0);
  }
  const rows = ['languages', 'frameworks', 'tools'].filter((key) => profile.skills[key].length).length;
  if (rows) lines += SECTION_HEADING + rows;
  // ?? []: the optional sections may be missing on data that did not pass through profileSchema.
  const activities = (profile.activities ?? []).filter((a) => a.title).length;
  if (activities) lines += SECTION_HEADING + activities;
  const achievements = (profile.achievements ?? []).filter((a) => a.text);
  if (achievements.length) lines += SECTION_HEADING + achievements.reduce((sum, a) => sum + bulletLines(a.text), 0);
  return lines;
}
