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
const sample = {
  basics: { name: 'Warm Up', email: 'warm@example.com', phone: '+1 555 010 2030', location: 'Anywhere', links: ['https://example.com/warm'] },
  summary: 'Warms the PDF cache.',
  education: [{ id: 'edu1', school: 'School', degree: 'Degree', dates: '2020', grade: '9/10' }],
  experience: [{ id: 'exp1', company: 'Company & Co', role: 'Role', dates: '2021 - 2024', bullets: [{ id: 'exp1_b1', text: 'Did 100% of the work', skills: [], alwaysInclude: false }] }],
  projects: [{ id: 'proj1', name: 'Project', link: 'https://example.com/p', skills: ['A'], bullets: [{ id: 'proj1_b1', text: 'Built it', skills: [] }] }],
  certifications: [{ id: 'cert1', name: 'Certificate', issuer: 'Issuer', year: '2023', skills: [] }],
  skills: { languages: ['A'], frameworks: ['B'], tools: ['C'] },
};

const started = Date.now();
console.log('Building a sample PDF (the first run downloads TeX files and can take a few minutes)...');
try {
  const { pdfPath, cleanup } = await compileTex(renderResume(sample), { timeoutMs: 10 * 60 * 1000 });
  const pages = await countPdfPages(pdfPath);
  await cleanup();
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s. Pages: ${pages}. The cache is warm.`);
} catch (err) {
  console.error(`Failed: ${err?.kind ?? err?.name ?? 'error'}.`);
  if (err?.kind === 'unavailable') console.error('Tectonic is not installed or not on PATH.');
  if (err?.kind === 'failed') console.error('The build failed. If this machine is offline, Tectonic cannot download its files.');
  process.exit(1);
}
