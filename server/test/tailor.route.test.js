// Tests for POST /api/tailor. The LLM is a fake (no provider is ever called); everything else is the
// real pipeline. A throwaway in-memory MongoDB proves isolation between users and that nothing is saved.
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { JOB_DESCRIPTION, analysis, profile } from './helpers/tailorFixtures.js';


const TEST_SECRET = 'test-secret-that-is-only-used-in-this-test-file-0123456789';
const userA = new mongoose.Types.ObjectId().toString();
const userB = new mongoose.Types.ObjectId().toString();
const userC = new mongoose.Types.ObjectId().toString(); // no profile
const cookieFor = (id, secret = TEST_SECRET) => `session=${jwt.sign({ sub: id }, secret, { algorithm: 'HS256', expiresIn: 3600 })}`;

let mongod;
let Profile;
let LLMError;
let createTailorRouter;
let tailorResponseSchema;
let profileSchema;
const servers = [];

async function serve(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}
const appWith = (router) => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/tailor', router);
  return app;
};

// ---------- fakes ----------

let llmCalls;
let nextAnalysis; // () => the analysis the "model" returns, or throws
let nextRewrites; // () => [{ id, text }] the "model" returns, or throws
let loadCalls;
let nextLoad;

// Behaves like callLLM: it validates the answer against the schema it was given, so a fake answer
// can never be something the real router would have refused.
const fakeLLM = async (args) => {
  llmCalls.push(args);
  const raw = args.task === 'analyze' ? nextAnalysis() : { rewrites: nextRewrites() };
  return { data: args.schema.parse(raw), provider: args.task === 'analyze' ? 'gemini_flash' : 'groq', ms: 1 };
};
const fakeLoad = async (userId) => {
  loadCalls.push(userId);
  return nextLoad(userId);
};

const GOOD_REWRITES = () => [
  { id: 'exp1_b1', text: 'Developed a React dashboard adopted by 40 teams' },
  { id: 'exp1_b2', text: 'Built Node.js microservices for the billing platform' },
];

let base;
let limitedBase;
let dbBase;
let appBase;

before(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.JWT_SECRET = TEST_SECRET;
  process.env.CLIENT_ORIGIN = 'http://localhost:5173';
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';

  ({ createTailorRouter } = await import('../src/routes/tailor.js'));
  ({ LLMError } = await import('../src/llm/errors.js'));
  ({ tailorResponseSchema } = await import('../src/tailor/schemas.js'));
  ({ profileSchema } = await import('../src/schemas/profile.js'));
  ({ Profile } = await import('../src/models/Profile.js'));
  await mongoose.connect(mongod.getUri());
  await Profile.init();

  base = await serve(appWith(createTailorRouter({ llm: fakeLLM, loadProfile: fakeLoad, limit: 1000 })));
  limitedBase = await serve(appWith(createTailorRouter({ llm: fakeLLM, loadProfile: fakeLoad, limit: 2 })));
  dbBase = await serve(appWith(createTailorRouter({ llm: fakeLLM, limit: 1000 })));
  const { app } = await import('../src/app.js');
  appBase = await serve(app);
});

after(async () => {
  for (const s of servers) s.close();
  await mongoose.disconnect();
  await mongod?.stop();
});

beforeEach(() => {
  llmCalls = [];
  loadCalls = [];
  nextAnalysis = analysis;
  nextRewrites = GOOD_REWRITES;
  nextLoad = async () => profile();
});

async function post(url, { cookie = cookieFor(userA), json } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${url}/api/tailor`, { method: 'POST', headers, body: json === undefined ? undefined : JSON.stringify(json) });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, json: text ? JSON.parse(text) : null };
}
const tailor = (opts = {}, url = base) => post(url, { json: { jobDescription: JOB_DESCRIPTION }, ...opts });
const errorLines = (spy) => spy.mock.calls.map((c) => c.arguments.map(String).join(' ')).join('\n');
const change = (res, id) => res.json.changes.find((c) => c.itemId === id);

// ---------- auth and input ----------

describe('auth and input', () => {
  test('no cookie: 401, and neither the database nor the LLM is touched', async () => {
    const res = await tailor({ cookie: null });
    assert.equal(res.status, 401);
    assert.equal(llmCalls.length, 0);
    assert.equal(loadCalls.length, 0);
  });
  test('a cookie signed with the wrong secret is refused', async () => {
    const res = await tailor({ cookie: cookieFor(userA, 'another-secret-that-is-long-enough-0123456789') });
    assert.equal(res.status, 401);
    assert.equal(llmCalls.length, 0);
  });
  test('the real app mounts the route and protects it', async () => {
    assert.equal((await tailor({ cookie: null }, appBase)).status, 401);
  });
  for (const [label, json] of [
    ['no body', undefined],
    ['an empty object', {}],
    ['a job description that is not a string', { jobDescription: 42 }],
    ['a job description under 50 characters', { jobDescription: 'Backend engineer wanted.' }],
    ['a job description of only spaces', { jobDescription: ' '.repeat(100) }],
    ['a job description over 15000 characters', { jobDescription: 'x'.repeat(15_001) }],
    ['an extra key', { jobDescription: JOB_DESCRIPTION, userId: 'someone' }],
  ]) {
    test(`bad input is refused before any work: ${label}`, async () => {
      const res = await post(base, { json });
      assert.equal(res.status, 400);
      assert.equal(res.json.code, 'bad_job_description');
      assert.equal(llmCalls.length, 0);
      assert.equal(loadCalls.length, 0);
    });
  }
  test('exactly 50 and exactly 15000 characters are accepted', async () => {
    assert.equal((await post(base, { json: { jobDescription: 'React Node.js '.padEnd(50, 'x') } })).status, 200);
    assert.equal((await post(base, { json: { jobDescription: `React ${'x'.repeat(14_994)}` } })).status, 200);
  });
});

// ---------- the happy path ----------

describe('a normal run', () => {
  test('returns jdAnalysis, selection, changes[], gapReport and questions, all matching the response schema', async () => {
    const res = await tailor();
    assert.equal(res.status, 200);
    for (const key of ['jdAnalysis', 'selection', 'changes', 'gapReport', 'questions', 'resume', 'warnings', 'meta']) assert.ok(key in res.json, key);
    const { saveToken, ...result } = res.json;
    assert.match(saveToken, /^\d+\.[a-f0-9]{64}$/, 'a save token comes with the result');
    assert.equal(tailorResponseSchema.safeParse(result).success, true);
    assert.equal(profileSchema.safeParse(res.json.resume).success, true, 'the resume must be accepted by /api/resume/render');
  });

  test('the job description is analysed and grounded', async () => {
    const res = await tailor();
    assert.deepEqual(res.json.jdAnalysis.requiredSkills, ['React', 'Node.js', 'TypeScript', 'Kubernetes']);
    assert.equal(res.json.jdAnalysis.company, 'Initech');
  });

  test('uses exactly two LLM calls: analyze, then rewrite', async () => {
    await tailor();
    assert.deepEqual(llmCalls.map((c) => c.task), ['analyze', 'rewrite']);
  });

  test('every change has { itemId, original, rewritten, accepted, reason }', async () => {
    const res = await tailor();
    for (const c of res.json.changes) {
      for (const key of ['itemId', 'original', 'rewritten', 'accepted', 'reason']) assert.ok(key in c, `${c.itemId} lacks ${key}`);
      assert.equal(typeof c.accepted, 'boolean');
    }
    assert.deepEqual(change(res, 'exp1_b1'), {
      itemId: 'exp1_b1',
      original: 'Built a React dashboard used by 40 teams',
      rewritten: 'Developed a React dashboard adopted by 40 teams',
      accepted: true,
      reason: 'ok',
    });
  });

  test('accepted rewrites are on the resume, and bullets the model left alone keep their text', async () => {
    const res = await tailor();
    const texts = res.json.resume.experience[0].bullets.map((b) => b.text);
    assert.ok(texts.includes('Developed a React dashboard adopted by 40 teams'));
    assert.ok(texts.includes('Cut API response time by 35% by adding caching'));
    assert.equal(change(res, 'exp1_b3').reason, 'no_rewrite');
  });

  test('the gap report lists what the user has and what is missing', async () => {
    const { gapReport } = (await tailor()).json;
    assert.equal(gapReport.matchScore, 0.5);
    assert.deepEqual(gapReport.missing.map((m) => m.term), ['TypeScript', 'Kubernetes', 'microservices', 'stakeholder management']);
  });

  test('the selection fits the page estimate and names the bullets chosen', async () => {
    const { selection } = (await tailor()).json;
    assert.ok(selection.budget.used <= selection.budget.capacity);
    assert.deepEqual(selection.experience[0].bulletIds, ['exp1_b1', 'exp1_b2', 'exp1_b3', 'exp1_b4']);
  });

  test('the model is never shown the full job description, and the prompt names only the selected bullets', async () => {
    await tailor();
    const rewriteCall = llmCalls.find((c) => c.task === 'rewrite');
    assert.ok(!rewriteCall.user.includes('Initech is hiring a Backend Engineer'));
    assert.ok(rewriteCall.user.includes('exp1_b1'));
    assert.ok(!rewriteCall.user.includes('proj2_b1'), 'an unselected bullet must not be sent');
  });
});

// ---------- the guardrail, end to end ----------

describe('a misbehaving model cannot change the resume', () => {
  test('an invented technology, an invented number and an unknown id are all rejected; a good rewrite still works', async () => {
    nextRewrites = () => [
      { id: 'exp1_b1', text: 'Built a React and Kubernetes dashboard used by 40 teams' }, // Kubernetes: not the user's
      { id: 'exp1_b3', text: 'Cut API response time by 53% by adding caching' }, // 35% became 53%
      { id: 'exp999', text: 'Led a team of 50 engineers' }, // no such id
      { id: 'exp1_b2', text: 'Built Node.js microservices for the billing platform' }, // fine
    ];
    const res = await tailor();
    assert.equal(res.status, 200);

    assert.deepEqual([change(res, 'exp1_b1').accepted, change(res, 'exp1_b1').reason], [false, 'new_term']);
    assert.deepEqual(change(res, 'exp1_b1').offending, ['Kubernetes']);
    assert.deepEqual([change(res, 'exp1_b3').accepted, change(res, 'exp1_b3').reason], [false, 'new_number']);
    assert.deepEqual(change(res, 'exp999'), { itemId: 'exp999', original: '', rewritten: 'Led a team of 50 engineers', accepted: false, reason: 'unknown_id' });
    assert.deepEqual([change(res, 'exp1_b2').accepted, change(res, 'exp1_b2').reason], [true, 'ok']);

    const texts = res.json.resume.experience[0].bullets.map((b) => b.text);
    assert.ok(texts.includes('Built a React dashboard used by 40 teams'), 'the original stays');
    assert.ok(texts.includes('Cut API response time by 35% by adding caching'), 'the original stays');
    assert.ok(texts.includes('Built Node.js microservices for the billing platform'));
    assert.ok(!JSON.stringify(res.json.resume).includes('Kubernetes'));
    assert.ok(!JSON.stringify(res.json.resume).includes('53%'));
    assert.ok(!JSON.stringify(res.json.resume).includes('50 engineers'));
  });

  test('a skill the user lacks goes into the gap report only, never onto the resume', async () => {
    nextRewrites = () => [{ id: 'exp1_b2', text: 'Wrote Node.js, TypeScript and Kubernetes services for the billing platform' }];
    const res = await tailor();
    assert.equal(change(res, 'exp1_b2').accepted, false);
    const resumeText = JSON.stringify(res.json.resume);
    for (const { term } of res.json.gapReport.missing) assert.ok(!resumeText.includes(term), `${term} reached the resume`);
    assert.ok(res.json.gapReport.missing.some((m) => m.term === 'Kubernetes'));
  });

  test('a requirement the model invents for the job is dropped before it can be scored or reported', async () => {
    nextAnalysis = () => ({ ...analysis(), requiredSkills: ['React', 'COBOL'] });
    const res = await tailor();
    assert.deepEqual(res.json.jdAnalysis.requiredSkills, ['React']);
    assert.ok(!JSON.stringify(res.json.gapReport).includes('COBOL'));
  });

  test('a model that returns nothing leaves every bullet as written', async () => {
    nextRewrites = () => [];
    const res = await tailor();
    assert.ok(res.json.changes.every((c) => !c.accepted && c.reason === 'no_rewrite'));
    assert.deepEqual(res.json.resume.experience[0].bullets.map((b) => b.text), profile().experience[0].bullets.map((b) => b.text));
  });
});

// ---------- thin profile: ask, never invent ----------

describe('a thin profile', () => {
  test('bullets without a metric produce questions for the user, best-scored first, at most three', async () => {
    const res = await tailor();
    assert.deepEqual(res.json.questions.map((q) => q.itemId), ['proj1_b2', 'proj1_b1', 'exp1_b2']);
    for (const q of res.json.questions) {
      assert.match(q.question, /\?$/);
      assert.ok(!/\d/.test(q.question), 'a question must not contain an invented number');
    }
  });

  test('a bullet that already has a number gets no question', async () => {
    const asked = (await tailor()).json.questions.map((q) => q.itemId);
    assert.ok(!asked.includes('exp1_b1')); // "40 teams"
    assert.ok(!asked.includes('exp1_b3')); // "35%"
    assert.ok(!asked.includes('exp1_b4')); // "two"
  });

  test('when the model tries to supply the missing metric itself, it is rejected and the question stays', async () => {
    nextRewrites = () => [{ id: 'exp1_b2', text: 'Wrote Node.js services for the billing platform, cutting costs by 20%' }];
    const res = await tailor();
    assert.deepEqual([change(res, 'exp1_b2').accepted, change(res, 'exp1_b2').reason], [false, 'new_number']);
    assert.ok(res.json.questions.some((q) => q.itemId === 'exp1_b2'));
    assert.ok(!JSON.stringify(res.json.resume).includes('20%'));
  });

  test('a profile whose bullets all have numbers needs no questions', async () => {
    nextLoad = async () => {
      const p = profile();
      for (const job of p.experience) for (const b of job.bullets) if (!/\d|two/.test(b.text)) b.text += ' for 12 clients';
      for (const pr of p.projects) for (const b of pr.bullets) if (!/\d/.test(b.text)) b.text += ' in 3 weeks';
      return p;
    };
    assert.deepEqual((await tailor()).json.questions, []);
  });
});

// ---------- failures ----------

describe('failures', () => {
  test('if the job analysis fails there is nothing to score: 502, and no rewrite call is made', async (t) => {
    const spy = t.mock.method(console, 'error', () => {});
    nextAnalysis = () => {
      throw new LLMError('all_failed', { causes: [{ route: 'groq', kind: 'timeout' }] });
    };
    const res = await tailor();
    assert.equal(res.status, 502);
    assert.equal(res.json.code, 'llm');
    assert.equal(res.json.kind, 'all_failed');
    assert.deepEqual(llmCalls.map((c) => c.task), ['analyze']);
    assert.match(errorLines(spy), /tailor llm failed: all_failed/);
  });

  test('if only the rewrite fails, the resume is still produced from the original bullets', async () => {
    nextRewrites = () => {
      throw new LLMError('all_failed');
    };
    const res = await tailor();
    assert.equal(res.status, 200);
    assert.ok(res.json.warnings.includes('rewrite_unavailable'));
    assert.equal(res.json.meta.providers.rewrite, null);
    assert.ok(res.json.changes.every((c) => c.reason === 'no_rewrite'));
    const { saveToken, ...result } = res.json;
    assert.ok(saveToken);
    assert.equal(tailorResponseSchema.safeParse(result).success, true);
  });

  test('an unexpected crash: 500 without the error message', async (t) => {
    const spy = t.mock.method(console, 'error', () => {});
    nextAnalysis = () => {
      throw new Error('boom SECRET-CRASH-DETAIL');
    };
    const res = await tailor();
    assert.equal(res.status, 500);
    assert.equal(res.json.code, 'internal');
    assert.ok(!res.text.includes('SECRET-CRASH-DETAIL'));
    assert.ok(!errorLines(spy).includes('SECRET-CRASH-DETAIL'));
  });

  test('no profile: 404. An empty profile: 409 before any LLM call, so no quota is spent', async () => {
    nextLoad = async () => null;
    assert.equal((await tailor()).status, 404);
    nextLoad = async () => ({
      basics: { name: '', email: '', phone: '', location: '', links: [] },
      summary: '', education: [], experience: [], projects: [], certifications: [],
      skills: { languages: [], frameworks: [], tools: [] },
    });
    const res = await tailor();
    assert.equal(res.status, 409);
    assert.equal(res.json.code, 'empty_profile');
    assert.equal(llmCalls.length, 0);
  });

  test('a stored profile that fails validation: 500 and its content is not logged', async (t) => {
    const spy = t.mock.method(console, 'error', () => {});
    nextLoad = async () => ({ basics: { name: 'SECRET-STORED-NAME' } });
    const res = await tailor();
    assert.equal(res.status, 500);
    assert.equal(res.json.code, 'bad_profile');
    assert.ok(!errorLines(spy).includes('SECRET-STORED-NAME'));
    assert.equal(llmCalls.length, 0);
  });

  test('nothing from the job description, the resume or a model answer is written to the console', async (t) => {
    const spy = t.mock.method(console, 'error', () => {});
    const log = t.mock.method(console, 'log', () => {});
    nextAnalysis = () => {
      throw new LLMError('schema');
    };
    await post(base, { json: { jobDescription: `SECRET-JD-MARKER ${JOB_DESCRIPTION}` } });
    nextAnalysis = analysis;
    nextRewrites = () => [{ id: 'exp1_b1', text: 'SECRET-REWRITE-MARKER Kubernetes 99%' }];
    await post(base, { json: { jobDescription: `SECRET-JD-MARKER ${JOB_DESCRIPTION}` } });
    const everything = `${errorLines(spy)}\n${log.mock.calls.map((c) => c.arguments.join(' ')).join('\n')}`;
    for (const marker of ['SECRET-JD-MARKER', 'SECRET-REWRITE-MARKER', 'Acme Corp', 'Built a React dashboard']) {
      assert.ok(!everything.includes(marker), `${marker} was logged`);
    }
  });
});

// ---------- limits ----------

describe('rate limit', () => {
  test('per user: the third run gets 429, another user is unaffected', async () => {
    assert.equal((await tailor({ cookie: cookieFor(userA) }, limitedBase)).status, 200);
    assert.equal((await tailor({ cookie: cookieFor(userA) }, limitedBase)).status, 200);
    const limited = await tailor({ cookie: cookieFor(userA) }, limitedBase);
    assert.equal(limited.status, 429);
    assert.equal(limited.json.code, 'rate_limited');
    assert.equal((await tailor({ cookie: cookieFor(userB) }, limitedBase)).status, 200);
  });
});

// ---------- scoping ----------

describe('the profile is the caller\'s own', () => {
  test('it is looked up with the id from the cookie, whatever the body says', async () => {
    await post(base, { cookie: cookieFor(userA), json: { jobDescription: JOB_DESCRIPTION } });
    await post(base, { cookie: cookieFor(userC), json: { jobDescription: JOB_DESCRIPTION, userId: userA } }); // refused (extra key)
    await post(base, { cookie: cookieFor(userC), json: { jobDescription: JOB_DESCRIPTION } });
    assert.deepEqual(loadCalls, [userA, userC]);
  });
});

describe('real database', () => {
  let before1;
  before(async () => {
    await Profile.deleteMany({});
    const make = (secret) => {
      const p = profile();
      p.basics.name = `Name ${secret}`;
      p.experience[0].bullets[3].text = `Mentored engineers on ${secret}`;
      return p;
    };
    await Profile.create({ userId: userA, ...make('ALPHA') });
    await Profile.create({ userId: userB, ...make('BRAVO') });
    before1 = JSON.stringify((await Profile.find({}).sort({ userId: 1 }).lean()).map(({ _id, ...rest }) => rest));
  });

  test('each user is tailored from their own profile and never sees another\'s', async () => {
    llmCalls = [];
    const a = await tailor({ cookie: cookieFor(userA) }, dbBase);
    const rewriteA = llmCalls.find((c) => c.task === 'rewrite');
    assert.equal(a.status, 200);
    assert.ok(a.json.resume.basics.name === 'Name ALPHA');
    assert.ok(rewriteA.user.includes('ALPHA'));
    assert.ok(!rewriteA.user.includes('BRAVO'));

    llmCalls = [];
    const b = await tailor({ cookie: cookieFor(userB) }, dbBase);
    const rewriteB = llmCalls.find((c) => c.task === 'rewrite');
    assert.equal(b.json.resume.basics.name, 'Name BRAVO');
    assert.ok(!rewriteB.user.includes('ALPHA'));
    assert.ok(!b.text.includes('ALPHA'));
  });

  test('a user with no profile gets 404, and no LLM call is made', async () => {
    llmCalls = [];
    const res = await tailor({ cookie: cookieFor(userC) }, dbBase);
    assert.equal(res.status, 404);
    assert.equal(llmCalls.length, 0);
  });

  test('a still-empty profile gets 409', async () => {
    const fresh = new mongoose.Types.ObjectId().toString();
    await Profile.create({ userId: fresh });
    llmCalls = [];
    const res = await tailor({ cookie: cookieFor(fresh) }, dbBase);
    assert.equal(res.status, 409);
    assert.equal(llmCalls.length, 0);
    await Profile.deleteOne({ userId: fresh });
  });

  test('nothing is saved: the stored profiles are exactly as they were', async () => {
    await tailor({ cookie: cookieFor(userA) }, dbBase);
    await tailor({ cookie: cookieFor(userB) }, dbBase);
    const after1 = JSON.stringify((await Profile.find({}).sort({ userId: 1 }).lean()).map(({ _id, ...rest }) => rest));
    assert.equal(after1, before1);
    assert.equal(await Profile.countDocuments(), 2);
  });
});
