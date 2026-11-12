// Warms Tectonic's cache by building one real resume PDF.
//
// Why: Tectonic downloads each TeX package and font the first time it needs it. On a fresh machine
// the first compile takes well over a minute, but the API gives a compile 30 seconds, so the first
// real user would get a "took too long" error. Run this once after installing Tectonic or deploying:
//     npm run warm:pdf
// Later compiles take about 1.5 seconds.
//
// It prints timings only, never any resume text.

import { renderResume } from '../src/latex/template.js';
import { compileTex } from '../src/latex/compile.js';
import { countPdfPages } from '../src/latex/pageCount.js';

// Touches every package the template loads: geometry, fontspec, enumitem, titlesec, hyperref,
// bold and italic fonts, links, bullets, and a "&" and "%" so escaping is exercised too.
//
// EVERY section, optional field and size combination the template can print is in here. TeX loads a
// font file only when some text needs it at that exact size. Example (a real production bug): the
// bullet marker is a math symbol, and each bullet switches to \small, so from the SECOND bullet of a
// list on, the marker is drawn at 9pt and needs the 9pt math fonts (cmmi9, cmsy9). A sample with one
// bullet per list never downloads them. Hence several bullets in every list, and several items.
const bullets = (prefix, n, extra = {}) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}_b${i + 1}`, text: `Did ${i + 1}00% of the work on item ${i + 1}`, skills: [], ...extra }));
const sample = {
  basics: { name: 'Warm Up', email: 'warm@example.com', phone: '+1 555 010 2030', location: 'Anywhere', links: ['https://example.com/warm', 'https://example.com/two'] },
  summary: 'Warms the PDF cache.',
  education: [
    { id: 'edu1', school: 'School', degree: 'Degree', dates: '2020', grade: '9/10' },
    { id: 'edu2', school: 'College', degree: 'Another Degree', dates: '2016', grade: '' },
  ],
  experience: [
    { id: 'exp1', company: 'Company & Co', role: 'Role', dates: '2021 - 2024', location: 'Remote', bullets: bullets('exp1', 3, { alwaysInclude: false }) },
    { id: 'exp2', company: 'Second Co', role: 'Intern', dates: '2020', location: '', bullets: bullets('exp2', 2, { alwaysInclude: false }) },
  ],
  projects: [
    { id: 'proj1', name: 'Project', tagline: 'A tagline', dates: 'Mar 2024', link: 'https://example.com/p', skills: ['A', 'B'], bullets: bullets('proj1', 3) },
    { id: 'proj2', name: 'Second Project', tagline: '', dates: '', link: '', skills: [], bullets: bullets('proj2', 2) },
  ],
  certifications: [
    { id: 'cert1', name: 'Certificate', issuer: 'Issuer', year: '2023', skills: [] },
    { id: 'cert2', name: 'Second Certificate', issuer: '', year: '', skills: [] },
  ],
  skills: { languages: ['A', 'C++'], frameworks: ['B'], tools: ['C', 'C#'] },
  achievements: [
    { id: 'ach1', text: 'Winner, Some Hackathon 2024 among 500+ teams' },
    { id: 'ach2', text: 'Rank 12 of 3,000 in a contest' },
  ],
  activitiesHeading: 'Positions of Responsibility',
  activities: [
    { id: 'act1', title: 'Club lead', detail: '2022 - 2023' },
    { id: 'act2', title: 'Volunteer', detail: '' },
  ],
};

const started = Date.now();
console.log('Building a sample PDF (the first run downloads TeX files and can take a few minutes)...');
try {
  const source = renderResume(sample);
  const first = await compileTex(source, { timeoutMs: 10 * 60 * 1000, onlyCached: false });
  const pages = await countPdfPages(first.pdfPath);
  await first.cleanup();

  // Prove the cache is now complete: the same document again, this time WITHOUT network access to
  // TeX files. If anything is still missing, fail here (and fail the Docker build) instead of on a
  // user's first PDF.
  const check = await compileTex(source, { timeoutMs: 2 * 60 * 1000, onlyCached: true });
  await check.cleanup();
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s. Pages: ${pages}. The cache is warm and complete.`);
} catch (err) {
  console.error(`Failed: ${err?.kind ?? err?.name ?? 'error'}.`);
  if (err?.kind === 'unavailable') console.error('Tectonic is not installed or not on PATH.');
  if (err?.kind === 'failed') console.error('The build failed. If this machine is offline, Tectonic cannot download its files.');
  process.exit(1);
}
