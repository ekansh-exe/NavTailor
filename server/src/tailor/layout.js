// How much page a piece of the resume takes. There is no renderer in the pipeline, so "fits one
// page" is an ESTIMATE in text lines, calibrated against real Tectonic 0.17 output of the 10pt,
// 0.6in-margin template in latex/template.js:
//   - a bullet line holds 110 to 114 characters (measured with pdftotext), so 108 is slightly safe
//   - with these costs, three differently shaped test profiles all fit one page at an estimate of
//     60 lines and all spilled onto a second page at 62
// PAGE_LINES leaves two lines of margin under that cliff. The page-fit loop in latex/fitToPage.js
// catches whatever the estimate still gets wrong. Re-measure if the template's spacing changes.

export const PAGE_LINES = 58;
export const CHARS_PER_LINE = 108;
const FULL_LINE_CHARS = 110; // an unindented paragraph (the summary)

export const SECTION_HEADING = 2; // heading plus its rule and spacing
export const JOB_HEADER = 3; // company line, role line, a gap
export const PROJECT_HEADER = 2; // name line, a gap
export const CERT_LINE = 1;

export const bulletLines = (text) => Math.max(1, Math.ceil(String(text).length / CHARS_PER_LINE));

// What the page always carries, whatever is selected: contact header, summary, education, skills.
// (Experience, projects and certifications are paid for as they are selected.)
export function fixedLines(profile) {
  let lines = 3; // name, contact line, spacing
  if (profile.summary) lines += SECTION_HEADING + Math.ceil(profile.summary.length / FULL_LINE_CHARS);
  if (profile.education.length) {
    lines += SECTION_HEADING + profile.education.reduce((sum, e) => sum + 1 + (e.degree || e.grade ? 1 : 0), 0);
  }
  const rows = ['languages', 'frameworks', 'tools'].filter((key) => profile.skills[key].length).length;
  if (rows) lines += SECTION_HEADING + rows;
  return lines;
}
