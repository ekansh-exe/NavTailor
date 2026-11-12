// Tests for the one-page fit: the page counter, the pure "which bullet to drop" decision, and the
// loop around it. The loop is driven with a fake compiler and a fake page counter, so no Tectonic
// is needed. The page counter itself is tested on real PDFs.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { countPdfPages } from '../src/latex/pageCount.js';
import { dropLowestBullet, fitToOnePage, MAX_DROPS } from '../src/latex/fitToPage.js';
import { profileSchema } from '../src/schemas/profile.js';
import { makePdf, makePdfPages } from './helpers/makeFiles.js';
import { deepFreeze } from './helpers/tailorFixtures.js';

// ---------- fixtures ----------

// No underscore in the text: the template escapes "_" as "\_", which would hide the text from a plain search.
const textOf = (id) => `Text ${id.replace(/_/g, 'x')}`;
const bullet = (id, extra = {}) => ({ id, text: textOf(id), skills: [], alwaysInclude: false, ...extra });

// Document order: j1_a j1_b j1_c | j2_a j2_b | proj1_a proj1_b | proj2_a (single)
const resume = () => ({
  basics: { name: 'Jane Doe', email: '', phone: '', location: '', links: [] },
  summary: '',
  education: [],
  experience: [
    { id: 'j1', company: 'Acme', role: 'Engineer', dates: '', bullets: [bullet('j1_a'), bullet('j1_b'), bullet('j1_c')] },
    { id: 'j2', company: 'Globex', role: 'Intern', dates: '', bullets: [bullet('j2_a'), bullet('j2_b')] },
  ],
  projects: [
    { id: 'p1', name: 'One', link: '', skills: [], bullets: [{ id: 'p1_a', text: textOf('p1_a'), skills: [] }, { id: 'p1_b', text: textOf('p1_b'), skills: [] }] },
    { id: 'p2', name: 'Two', link: '', skills: [], bullets: [{ id: 'p2_a', text: textOf('p2_a'), skills: [] }] },
  ],
  certifications: [],
  skills: { languages: [], frameworks: [], tools: [] },
});
const ids = (r) => [...r.experience.flatMap((j) => j.bullets.map((b) => b.id)), ...r.projects.flatMap((p) => p.bullets.map((b) => b.id))];

// ---------- the page counter, on real PDFs ----------

describe('countPdfPages', () => {
  let dir;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'navtailor-pages-'));
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, data) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, data);
    return file;
  };

  test('counts one page', async () => {
    assert.equal(await countPdfPages(write('one.pdf', makePdf(['hello']))), 1);
    assert.equal(await countPdfPages(write('blank1.pdf', makePdfPages(1))), 1);
  });
  test('counts two and several pages', async () => {
    assert.equal(await countPdfPages(write('two.pdf', makePdfPages(2))), 2);
    assert.equal(await countPdfPages(write('five.pdf', makePdfPages(5))), 5);
  });
  test('a file that is not a PDF throws', async () => {
    await assert.rejects(countPdfPages(write('bad.pdf', 'this is not a pdf')));
    await assert.rejects(countPdfPages(write('empty.pdf', '')));
  });
  test('a missing file throws', async () => {
    await assert.rejects(countPdfPages(path.join(dir, 'nope.pdf')));
  });
  test('a file over the size cap is refused without being parsed', async () => {
    const big = write('big.pdf', Buffer.concat([makePdf(['x']), Buffer.alloc(5 * 1024 * 1024 + 1)]));
    await assert.rejects(countPdfPages(big), /pdf_too_big/);
  });
});

// ---------- which bullet goes ----------

describe('dropLowestBullet', () => {
  test('drops the lowest-scored bullet', () => {
    const scores = { j1_a: 5, j1_b: 1, j1_c: 4, j2_a: 3, j2_b: 3, p1_a: 2, p1_b: 6 };
    const out = dropLowestBullet(resume(), scores);
    assert.deepEqual(out.dropped, { id: 'j1_b', section: 'experience', parentId: 'j1', score: 1 });
    assert.ok(!ids(out.resume).includes('j1_b'));
    assert.equal(ids(out.resume).length, ids(resume()).length - 1);
  });
  test('on a tie the bottom-most bullet goes (that is where the overflow is)', () => {
    const scores = { j1_a: 1, j1_b: 1, j1_c: 1, j2_a: 1, j2_b: 1, p1_a: 1, p1_b: 1 };
    assert.equal(dropLowestBullet(resume(), scores).dropped.id, 'p1_b');
  });
  test('with no scores at all it drops from the bottom up', () => {
    let current = resume();
    const order = [];
    for (let i = 0; i < 3; i++) {
      const out = dropLowestBullet(current, {});
      order.push(out.dropped.id);
      current = out.resume;
    }
    assert.deepEqual(order, ['p1_b', 'j2_b', 'j1_c']);
  });
  test('a bullet without a score counts as 0, so it goes before a scored one', () => {
    const scores = { j1_a: 1, j1_b: 1, j1_c: 1, j2_a: 1, p1_a: 1, p1_b: 1 }; // j2_b has none
    assert.equal(dropLowestBullet(resume(), scores).dropped.id, 'j2_b');
  });
  test('the lowest score wins across experience and projects', () => {
    const scores = { j1_a: 9, j1_b: 9, j1_c: 9, j2_a: 9, j2_b: 9, p1_a: 0.5, p1_b: 9 };
    assert.deepEqual(dropLowestBullet(resume(), scores).dropped, { id: 'p1_a', section: 'projects', parentId: 'p1', score: 0.5 });
  });
  test('an alwaysInclude bullet is never dropped, however low its score', () => {
    const r = resume();
    for (const b of r.experience[0].bullets) b.alwaysInclude = true;
    r.experience[1].bullets[0].alwaysInclude = true;
    const out = dropLowestBullet(r, { j1_a: 0, j1_b: 0, j1_c: 0, j2_a: 0, j2_b: 100, p1_a: 100, p1_b: 100 });
    assert.ok(['j2_b', 'p1_a', 'p1_b'].includes(out.dropped.id));
    assert.notEqual(out.dropped.id, 'j1_a');
  });
  test('the last bullet of a job or project is never dropped', () => {
    let current = resume();
    for (let i = 0; i < 20; i++) {
      const out = dropLowestBullet(current, {});
      if (!out) break;
      current = out.resume;
    }
    for (const job of current.experience) assert.ok(job.bullets.length >= 1, job.id);
    for (const project of current.projects) assert.ok(project.bullets.length >= 1, project.id);
    assert.equal(ids(current).length, 4); // one per job and project
  });
  test('it returns null when nothing may be dropped', () => {
    const r = resume();
    r.experience = r.experience.map((j) => ({ ...j, bullets: [j.bullets[0]] }));
    r.projects = r.projects.map((p) => ({ ...p, bullets: [p.bullets[0]] }));
    assert.equal(dropLowestBullet(r, {}), null);
    assert.equal(dropLowestBullet({ ...r, experience: [], projects: [] }, {}), null);
  });
  test('it returns null when every droppable bullet is alwaysInclude', () => {
    const r = resume();
    r.experience[0].bullets.forEach((b) => (b.alwaysInclude = true));
    r.experience[1].bullets.forEach((b) => (b.alwaysInclude = true));
    r.projects = [];
    assert.equal(dropLowestBullet(r, {}), null);
  });
  test('the smaller resume is still a valid profile', () => {
    assert.equal(profileSchema.safeParse(dropLowestBullet(resume(), {}).resume).success, true);
  });
  test('it never changes its input', () => {
    const frozen = deepFreeze(resume());
    assert.doesNotThrow(() => dropLowestBullet(frozen, deepFreeze({ j1_a: 1 })));
  });
  test('scores that are not usable numbers count as 0, and prototype names are not scores', () => {
    const r = resume();
    r.experience[0].bullets[2].id = 'constructor'; // a legal id that is also a property of every object
    const scores = { j1_a: 5, j1_b: 5, j2_a: 5, j2_b: 5, p1_a: 5, p1_b: 5, j1_c: Number.NaN };
    assert.equal(dropLowestBullet(r, scores).dropped.id, 'constructor');
    assert.equal(dropLowestBullet(r, {}).dropped.score, 0);
  });
});

// ---------- the loop ----------

// A fake compiler: records the LaTeX it was given, hands out numbered "PDFs" and counts cleanups.
function fakes(pagesPerAttempt) {
  const state = { sources: [], cleaned: [], pdfs: [], counted: [] };
  const compile = async (source) => {
    const n = state.sources.length;
    state.sources.push(source);
    const pdfPath = `/fake/${n}.pdf`;
    state.pdfs.push(pdfPath);
    return { pdfPath, cleanup: async () => state.cleaned.push(pdfPath) };
  };
  const countPages = async (pdfPath) => {
    state.counted.push(pdfPath);
    const n = Number(/(\d+)\.pdf/.exec(pdfPath)[1]);
    const pages = typeof pagesPerAttempt === 'function' ? pagesPerAttempt(n) : (pagesPerAttempt[n] ?? pagesPerAttempt.at(-1));
    if (pages instanceof Error) throw pages;
    return pages;
  };
  return { state, compile, countPages };
}
const SCORES = { j1_a: 9, j1_b: 1, j1_c: 8, j2_a: 7, j2_b: 2, p1_a: 6, p1_b: 3 }; // drop order: j1_b, j2_b, p1_b, p1_a...

describe('fitToOnePage', () => {
  test('a resume that already fits is compiled once, nothing is dropped', async () => {
    const { state, compile, countPages } = fakes([1]);
    const out = await fitToOnePage({ resume: resume(), scores: SCORES, compile, countPages });
    assert.equal(state.sources.length, 1);
    assert.deepEqual({ pages: out.pages, fit: out.fit, dropped: out.dropped }, { pages: 1, fit: 'fits', dropped: [] });
    assert.equal(out.pdfPath, '/fake/0.pdf');
    assert.deepEqual(state.cleaned, [], 'the returned PDF belongs to the caller');
  });

  test('two pages, then one after dropping the lowest-scored bullet', async () => {
    const { state, compile, countPages } = fakes([2, 1]);
    const out = await fitToOnePage({ resume: resume(), scores: SCORES, compile, countPages });
    assert.equal(state.sources.length, 2);
    assert.equal(out.fit, 'fits');
    assert.equal(out.pages, 1);
    assert.deepEqual(out.dropped.map((d) => d.id), ['j1_b']);
    assert.equal(out.pdfPath, '/fake/1.pdf');
    assert.deepEqual(state.cleaned, ['/fake/0.pdf'], 'the too-long PDF is discarded, the final one is kept');
  });

  test('the second build really is the smaller resume', async () => {
    const { state, compile, countPages } = fakes([2, 1]);
    await fitToOnePage({ resume: resume(), scores: SCORES, compile, countPages });
    assert.ok(state.sources[0].includes('Text j1xb'));
    assert.ok(!state.sources[1].includes('Text j1xb'));
    assert.ok(state.sources[1].includes('Text j1xa'));
  });

  test('up to three drops, in score order, then a fourth build', async () => {
    const { state, compile, countPages } = fakes([2, 2, 2, 1]);
    const out = await fitToOnePage({ resume: resume(), scores: SCORES, compile, countPages });
    assert.equal(state.sources.length, 4);
    assert.deepEqual(out.dropped.map((d) => d.id), ['j1_b', 'j2_b', 'p1_b']);
    assert.equal(out.fit, 'fits');
    assert.deepEqual(state.cleaned, ['/fake/0.pdf', '/fake/1.pdf', '/fake/2.pdf']);
  });

  test('still too long after three drops: it stops, returns the last PDF and says so', async () => {
    const { state, compile, countPages } = fakes([2]);
    const out = await fitToOnePage({ resume: resume(), scores: SCORES, compile, countPages });
    assert.equal(state.sources.length, MAX_DROPS + 1);
    assert.equal(out.dropped.length, 3);
    assert.deepEqual({ pages: out.pages, fit: out.fit }, { pages: 2, fit: 'too_long' });
    assert.equal(out.pdfPath, '/fake/3.pdf');
    assert.equal(state.cleaned.length, 3);
  });

  test('every PDF except the returned one is cleaned up exactly once', async () => {
    const { state, compile, countPages } = fakes([3, 2, 2, 2]);
    const out = await fitToOnePage({ resume: resume(), scores: SCORES, compile, countPages });
    assert.deepEqual([...state.cleaned].sort(), state.pdfs.filter((p) => p !== out.pdfPath).sort());
  });

  test('maxDrops is respected (0 means never drop)', async () => {
    const zero = fakes([2]);
    const a = await fitToOnePage({ resume: resume(), scores: SCORES, compile: zero.compile, countPages: zero.countPages, maxDrops: 0 });
    assert.equal(zero.state.sources.length, 1);
    assert.deepEqual({ fit: a.fit, dropped: a.dropped }, { fit: 'too_long', dropped: [] });

    const one = fakes([2]);
    const b = await fitToOnePage({ resume: resume(), scores: SCORES, compile: one.compile, countPages: one.countPages, maxDrops: 1 });
    assert.equal(one.state.sources.length, 2);
    assert.equal(b.dropped.length, 1);
  });

  test('nothing droppable: one build, "too_long", no loop', async () => {
    const r = resume();
    r.experience = r.experience.map((j) => ({ ...j, bullets: [j.bullets[0]] }));
    r.projects = r.projects.map((p) => ({ ...p, bullets: [p.bullets[0]] }));
    const { state, compile, countPages } = fakes([2]);
    const out = await fitToOnePage({ resume: r, scores: {}, compile, countPages });
    assert.equal(state.sources.length, 1);
    assert.deepEqual({ fit: out.fit, dropped: out.dropped }, { fit: 'too_long', dropped: [] });
  });

  test('alwaysInclude bullets survive every drop', async () => {
    const r = resume();
    r.experience[0].bullets[1].alwaysInclude = true; // j1_b: the lowest score
    const { state, compile, countPages } = fakes([2]);
    const out = await fitToOnePage({ resume: r, scores: SCORES, compile, countPages });
    assert.ok(!out.dropped.some((d) => d.id === 'j1_b'));
    assert.ok(state.sources.every((s) => s.includes('Text j1xb')));
  });

  test('out of time: it stops dropping and returns what it has', async () => {
    const { state, compile, countPages } = fakes([2]);
    let clock = 0;
    const out = await fitToOnePage({
      resume: resume(), scores: SCORES, compile, countPages, deadlineMs: 1000,
      now: () => (clock += 600), // each look at the clock is 600 ms later
    });
    assert.ok(state.sources.length < MAX_DROPS + 1);
    assert.equal(out.fit, 'too_long');
  });

  test('a page count that cannot be read: the PDF is returned as it is, fit "unknown"', async () => {
    const { state, compile, countPages } = fakes([new Error('unreadable')]);
    const out = await fitToOnePage({ resume: resume(), scores: SCORES, compile, countPages });
    assert.equal(state.sources.length, 1);
    assert.deepEqual({ pages: out.pages, fit: out.fit, dropped: out.dropped }, { pages: null, fit: 'unknown', dropped: [] });
    assert.deepEqual(state.cleaned, []);
  });

  test('a compile that fails on a later build throws, and the earlier PDF is already cleaned up', async () => {
    const state = { cleaned: [] };
    let n = 0;
    const compile = async () => {
      n += 1;
      if (n === 2) throw new Error('compile failed');
      return { pdfPath: `/fake/${n}.pdf`, cleanup: async () => state.cleaned.push(`/fake/${n}.pdf`) };
    };
    await assert.rejects(fitToOnePage({ resume: resume(), scores: SCORES, compile, countPages: async () => 2 }), /compile failed/);
    assert.equal(state.cleaned.length, 1);
  });

  test('a cleanup that throws does not break the fit', async () => {
    let n = 0;
    const compile = async () => ({ pdfPath: `/fake/${n++}.pdf`, cleanup: async () => { throw new Error('rm failed'); } });
    const out = await fitToOnePage({ resume: resume(), scores: SCORES, compile, countPages: async (p) => (p.includes('/0.') ? 2 : 1) });
    assert.equal(out.fit, 'fits');
  });

  test('the resume passed in is never changed', async () => {
    const frozen = deepFreeze(resume());
    const { compile, countPages } = fakes([2, 2, 2, 2]);
    await assert.doesNotReject(fitToOnePage({ resume: frozen, scores: deepFreeze({ ...SCORES }), compile, countPages }));
  });

  test('the dropped report names the id, section, parent and score', async () => {
    const { compile, countPages } = fakes([2, 2, 1]);
    const out = await fitToOnePage({ resume: resume(), scores: SCORES, compile, countPages });
    assert.deepEqual(out.dropped, [
      { id: 'j1_b', section: 'experience', parentId: 'j1', score: 1 },
      { id: 'j2_b', section: 'experience', parentId: 'j2', score: 2 },
    ]);
  });
});
