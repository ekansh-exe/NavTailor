// End to end with the REAL PDF engine: the real route, real Tectonic, the real page counter.
// Only the LLM is a fake. Skipped when Tectonic is not installed.
//
// The first compile on a machine downloads TeX support files (over a minute). Run
// `npm run warm:pdf` once, or just re-run the tests: later runs take about 1.5 seconds per compile.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { countPdfPages } from '../src/latex/pageCount.js';

const TEST_SECRET = 'test-secret-that-is-only-used-in-this-test-file-0123456789';
const cookie = `session=${jwt.sign({ sub: 'user-1' }, TEST_SECRET, { algorithm: 'HS256', expiresIn: 3600 })}`;

function realTectonic() {
  const help = spawnSync('tectonic', ['-X', 'compile', '--help'], { encoding: 'utf8' });
  return !help.error && help.status === 0 && /--untrusted/.test(help.stdout);
}
const skip = realTectonic() ? false : 'tectonic is not installed';

// ---------- a heavy profile: more than one page of material ----------

const WORDS = 'built shipped improved automated designed reviewed migrated measured reduced tested documented React service pipeline dashboard report workflow customer billing latency reliability platform integration'.split(' ');
function sentence(seed, length) {
  let out = '';
  let i = seed;
  while (out.length < length) out += (out ? ' ' : '') + WORDS[(i = (i * 31 + 7) % 997) % WORDS.length];
  return out.slice(0, length).replace(/\s+\S*$/, '').replace(/^./, (c) => c.toUpperCase());
}
const heavyProfile = () => ({
  basics: { name: 'Jane Doe', email: 'jane@example.com', phone: '+1 555 010 2030', location: 'Pune', links: ['https://github.com/janedoe'] },
  summary: 'Full-stack engineer with five years of experience building reporting and billing products.',
  education: [{ id: 'edu1', school: 'State University', degree: 'B.Sc. Computer Science', dates: '2017 - 2021', grade: '8.7/10' }],
  experience: Array.from({ length: 4 }, (_, j) => ({
    id: `exp${j}`, company: `Company ${j}`, role: 'Engineer', dates: '2020 - 2024',
    bullets: Array.from({ length: 7 }, (_, k) => ({ id: `exp${j}_b${k}`, text: sentence(j * 13 + k, 90 + ((j * 37 + k * 53) % 120)), skills: ['React'], alwaysInclude: false })),
  })),
  projects: Array.from({ length: 3 }, (_, j) => ({
    id: `proj${j}`, name: `Project ${j}`, link: 'https://github.com/janedoe/p', skills: ['React'],
    bullets: Array.from({ length: 4 }, (_, k) => ({ id: `proj${j}_b${k}`, text: sentence(j * 7 + k + 100, 100 + ((j * 11 + k * 29) % 80)), skills: ['React'] })),
  })),
  certifications: Array.from({ length: 4 }, (_, j) => ({ id: `cert${j}`, name: `React Certificate ${j}`, issuer: 'Issuer', year: '2023', skills: ['React'] })),
  skills: { languages: ['JavaScript', 'Python'], frameworks: ['React', 'Node.js'], tools: ['MongoDB', 'Git'] },
});

// ---------- the real router ----------

let server;
let base;
let scratch;

before(async () => {
  if (skip) return;
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/unused';
  process.env.JWT_SECRET = TEST_SECRET;
  process.env.CLIENT_ORIGIN = 'http://localhost:5173';
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'navtailor-real-'));
  const { createResumeRouter } = await import('../src/routes/resume.js');
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  // Real compile, real page counter: no injection.
  app.use('/api/resume', createResumeRouter({ limit: 1000 }));
  server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
});

async function render(body) {
  const res = await fetch(`${base}/api/resume/render`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const buffer = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, buffer, text: buffer.toString('utf8') };
}
async function pagesOf(buffer) {
  const file = path.join(scratch, `out-${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(file, buffer);
  return countPdfPages(file);
}

describe('the real PDF engine behind POST /api/resume/render', { skip, timeout: 280_000 }, () => {
  test('a short resume: a real one-page PDF, fits, nothing dropped', { timeout: 280_000 }, async () => {
    const p = heavyProfile();
    p.experience = [p.experience[0]];
    p.projects = [];
    p.certifications = [];
    const res = await render({ resumeJson: p });
    assert.equal(res.status, 200, res.text.slice(0, 300));
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.equal(res.buffer.subarray(0, 4).toString('latin1'), '%PDF');
    assert.deepEqual(
      [res.headers.get('x-resume-pages'), res.headers.get('x-resume-dropped'), res.headers.get('x-resume-fit')],
      ['1', '', 'fits'],
    );
    assert.equal(await pagesOf(res.buffer), 1);
  });

  test('a resume that is too long is trimmed by the loop until the REAL page count is 1', { timeout: 280_000 }, async () => {
    const p = heavyProfile();
    const scores = {};
    // Every bullet gets a score (an unscored bullet counts as 0). Within a job the later a bullet, the higher
    // its score, so the first bullet of a job (score 0) is the cheapest to lose. Projects score high.
    for (const job of p.experience) job.bullets.forEach((b, k) => (scores[b.id] = k));
    for (const project of p.projects) project.bullets.forEach((b, k) => (scores[b.id] = 100 + k));
    const res = await render({ resumeJson: p, scores });
    assert.equal(res.status, 200, res.text.slice(0, 300));
    const dropped = res.headers.get('x-resume-dropped').split(',').filter(Boolean);
    assert.ok(dropped.length >= 1 && dropped.length <= 3, `dropped ${dropped.length}`);
    // the lowest-scored (score 0, the first bullet of a job) go first
    assert.ok(dropped.every((id) => /_b0$/.test(id)), dropped.join());
    // what the header claims is what the PDF really is
    const real = await pagesOf(res.buffer);
    assert.equal(String(real), res.headers.get('x-resume-pages'));
    if (res.headers.get('x-resume-fit') === 'fits') assert.equal(real, 1);
  });

  test('an enormous resume cannot be fitted with three drops: the PDF still comes back, marked too_long', { timeout: 280_000 }, async () => {
    const p = heavyProfile();
    for (const job of p.experience) {
      job.bullets = Array.from({ length: 15 }, (_, k) => ({ id: `${job.id}_x${k}`, text: sentence(k + 3, 200), skills: [], alwaysInclude: false }));
    }
    const res = await render({ resumeJson: p });
    assert.equal(res.status, 200, res.text.slice(0, 300));
    assert.equal(res.headers.get('x-resume-fit'), 'too_long');
    assert.equal(res.headers.get('x-resume-dropped').split(',').length, 3);
    assert.ok(Number(res.headers.get('x-resume-pages')) >= 2);
    assert.ok((await pagesOf(res.buffer)) >= 2);
  });

  test('special characters and hostile text produce a real PDF and the dropped list stays header-safe', { timeout: 280_000 }, async () => {
    const p = heavyProfile();
    p.basics.name = 'Zoë Müller \\input{/etc/passwd} 100% & $5 #1 _x_ ^y^ ~z~ {a}';
    p.summary = '\\write18{touch /tmp/pwned} % comment & more';
    p.experience[0].bullets[0].text = '[Internal] Cut costs by 40% & saved $2M with C++ {braces}';
    const res = await render({ resumeJson: p });
    assert.equal(res.status, 200, res.text.slice(0, 300));
    assert.equal(res.buffer.subarray(0, 4).toString('latin1'), '%PDF');
    assert.match(res.headers.get('x-resume-dropped'), /^[A-Za-z0-9_,-]*$/);
    assert.equal(fs.existsSync('/tmp/pwned'), false);
  });

  test('a normal request never ends in compile_failed (the template cannot be made to fail through the data)', { timeout: 280_000 }, async () => {
    const res = await render({ resumeJson: heavyProfile() });
    assert.notEqual(res.status, 422, res.text.slice(0, 500));
  });
});

// ---------- tailoring -> rendering, nothing faked on the PDF side ----------

describe('tailor output rendered by the real engine', { skip, timeout: 280_000 }, () => {
  test('a heavy profile is tailored to the page estimate and the real PDF is one page without any drops', { timeout: 280_000 }, async () => {
    process.env.MONGODB_URI ??= 'mongodb://127.0.0.1:1/unused';
    const { runTailor } = await import('../src/tailor/pipeline.js');
    const { analysis: fixtureAnalysis } = await import('./helpers/tailorFixtures.js');
    const llm = async (args) => ({
      data: args.schema.parse(args.task === 'analyze' ? { ...fixtureAnalysis(), requiredSkills: ['React'], preferredSkills: [], keywords: [], company: '', roleTitle: '' } : { rewrites: [] }),
      provider: 'fake',
      ms: 1,
    });
    const result = await runTailor({ profile: heavyProfile(), jobDescription: 'We need strong React experience for this role, building dashboards and reports.', llm });
    assert.ok(result.selection.budget.used <= result.selection.budget.capacity);

    const res = await render({ resumeJson: result.resume });
    assert.equal(res.status, 200, res.text.slice(0, 300));
    assert.equal(res.headers.get('x-resume-fit'), 'fits');
    assert.equal(res.headers.get('x-resume-dropped'), '', 'the page estimate alone should already fit one page');
    assert.equal(await pagesOf(res.buffer), 1);
  });
});
