// Tests for /api/applications. A real tailoring result is made once with a fake LLM and a fake
// profile, then signed like POST /api/tailor does. The applications and versions go to a REAL
// throwaway in-memory MongoDB, so the userId scoping and the delete cascade are tested for real.
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
const cookieFor = (id, secret = TEST_SECRET) => `session=${jwt.sign({ sub: id }, secret, { algorithm: 'HS256', expiresIn: 3600 })}`;

let mongod;
let Application;
let ResumeVersion;
let MAX_APPLICATIONS_PER_USER;
let signResult;
let tailorForUser;
const servers = [];

async function serve(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

// ---------- fakes ----------

let llmCalls;
let nextRewrites;
const fakeLLM = async (args) => {
  llmCalls.push(args.task);
  const raw = args.task === 'analyze' ? analysis() : { rewrites: nextRewrites() };
  return { data: args.schema.parse(raw), provider: 'fake', ms: 1 };
};
const fakeLoad = async () => profile();

// exp1_b1 passes the guardrail; exp1_b2 invents a number, so the guardrail rejects it.
const REWRITES = () => [
  { id: 'exp1_b1', text: 'Developed a React dashboard adopted by 40 teams' },
  { id: 'exp1_b2', text: 'Wrote Node.js services for the billing platform serving 9000 users' },
];


const JD = JOB_DESCRIPTION.trim();
let base;
let limitedBase;
let appBase;

before(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.JWT_SECRET = TEST_SECRET;
  process.env.CLIENT_ORIGIN = 'http://localhost:5173';
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';

  const { createApplicationsRouter } = await import('../src/routes/applications.js');
  ({ Application, MAX_APPLICATIONS_PER_USER } = await import('../src/models/Application.js'));
  ({ ResumeVersion } = await import('../src/models/ResumeVersion.js'));
  ({ signResult } = await import('../src/tailor/saveToken.js'));
  ({ tailorForUser } = await import('../src/tailor/forUser.js'));
  await mongoose.connect(mongod.getUri());
  await Application.init(); // builds the indexes
  await ResumeVersion.init();

  const appWith = (router) => {
    const app = express();
    app.use(express.json({ limit: '400kb' }));
    app.use(cookieParser());
    app.use('/api/applications', router);
    return app;
  };
  base = await serve(appWith(createApplicationsRouter({ limit: 1000 })));
  limitedBase = await serve(appWith(createApplicationsRouter({ limit: 2 })));
  const { app } = await import('../src/app.js');
  appBase = await serve(app);
});

after(async () => {
  for (const s of servers) s.close();
  await mongoose.disconnect();
  await mongod?.stop();
});

beforeEach(async () => {
  llmCalls = [];
  nextRewrites = REWRITES;
  await Application.deleteMany({});
  await ResumeVersion.deleteMany({});
});

// What POST /api/tailor would have answered: a validated result plus its save token.
async function tailored(userId = userA) {
  const outcome = await tailorForUser({ userId, jobDescription: JD, llm: fakeLLM, loadProfile: fakeLoad });
  assert.ok(outcome.ok);
  return { result: outcome.data, saveToken: signResult({ userId, jdText: JD, result: outcome.data }) };
}

async function call(url, method, path, { cookie = cookieFor(userA), json } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (json !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${url}/api/applications${path}`, { method, headers, body: json === undefined ? undefined : JSON.stringify(json) });
  const text = await res.text();
  return { status: res.status, text, json: text ? JSON.parse(text) : null };
}

async function saveBody(overrides = {}, userId = userA) {
  return { company: 'Initech', role: 'Backend Engineer', jdText: JD, ...(await tailored(userId)), ...overrides };
}
async function create({ cookie, userId = userA, json, url = base } = {}) {
  return call(url, 'POST', '', { cookie: cookie ?? cookieFor(userId), json: json ?? (await saveBody({}, userId)) });
}

// ---------- auth ----------

describe('auth', () => {
  test('every route answers 401 without a cookie', async () => {
    const id = new mongoose.Types.ObjectId().toString();
    for (const [method, path, json] of [
      ['POST', '', {}],
      ['GET', '', undefined],
      ['GET', `/${id}`, undefined],
      ['PATCH', `/${id}`, { status: 'applied' }],
      ['PATCH', `/${id}/versions/${id}/decisions`, { decisions: {} }],
      ['DELETE', `/${id}`, undefined],
    ]) {
      assert.equal((await call(base, method, path, { cookie: null, json })).status, 401, `${method} ${path}`);
    }
  });

  test('the real app mounts the router and protects it', async () => {
    assert.equal((await call(appBase, 'GET', '', { cookie: null })).status, 401);
  });
});

// ---------- create ----------

describe('POST / (save from the result page)', () => {
  test('creates one application and one version, both owned by the signed-in user', async () => {
    llmCalls = [];
    const json = await saveBody({ decisions: { exp1_b1: false } });
    const callsBefore = llmCalls.length;
    const res = await create({ json });
    assert.equal(res.status, 201);
    assert.equal(llmCalls.length, callsBefore, 'saving makes no LLM call');

    const app = await Application.findById(res.json.id).lean();
    assert.equal(String(app.userId), userA);
    assert.equal(app.status, 'saved');
    assert.equal(app.jdText, JD);
    assert.equal(typeof app.gapReport.matchScore, 'number');

    const versions = await ResumeVersion.find({ applicationId: app._id }).lean();
    assert.equal(versions.length, 1);
    assert.equal(String(versions[0]._id), res.json.versionId);
    assert.equal(String(versions[0].userId), userA);
    // The server built the resume itself, with the decision applied (original text kept).
    const bullet = versions[0].resumeJson.experience[0].bullets.find((b) => b.id === 'exp1_b1');
    assert.equal(bullet.text, 'Built a React dashboard used by 40 teams');
    assert.match(versions[0].texSource, /\\begin\{document\}/);
  });

  test('a result changed after signing (an invented bullet) is refused and nothing is saved', async () => {
    const json = await saveBody();
    json.result.resume.experience[0].bullets[0].text = 'Led a team of 500 engineers at Google';
    const res = await create({ json });
    assert.equal(res.status, 400);
    assert.equal(res.json.code, 'bad_token');
    assert.equal(await Application.countDocuments({}), 0);
  });

  test('a changed job description, a missing token or a junk token is refused', async () => {
    for (const overrides of [{ jdText: `${JD} Also Rust.` }, { saveToken: '' }, { saveToken: '123.abc' }]) {
      const res = await create({ json: await saveBody(overrides) });
      assert.equal(res.status, 400, JSON.stringify(Object.keys(overrides)));
    }
    assert.equal(await Application.countDocuments({}), 0);
  });

  test("user B cannot save user A's signed result", async () => {
    const res = await create({ cookie: cookieFor(userB), json: await saveBody({}, userA) });
    assert.equal(res.status, 400);
    assert.equal(res.json.code, 'bad_token');
  });

  test('an expired token is refused with its own code', async () => {
    const { result } = await tailored();
    const saveToken = signResult({ userId: userA, jdText: JD, result, now: Date.now() - 3 * 60 * 60 * 1000 });
    const res = await create({ json: await saveBody({ result, saveToken }) });
    assert.equal(res.status, 400);
    assert.equal(res.json.code, 'token_expired');
  });

  test('accepting a rewrite the guardrail rejected (invented number) is refused', async () => {
    const res = await create({ json: await saveBody({ decisions: { exp1_b2: true } }) });
    assert.equal(res.status, 400);
    assert.equal(res.json.code, 'not_toggleable');
    assert.deepEqual(res.json.itemIds, ['exp1_b2']);
  });

  test('a userId in the body is refused (the owner comes only from the cookie)', async () => {
    const res = await create({ json: await saveBody({ userId: userB }) });
    assert.equal(res.status, 400);
    assert.equal(await Application.countDocuments({}), 0);
  });

  for (const [label, overrides] of [
    ['missing company', { company: '' }],
    ['missing role', { role: '   ' }],
    ['short job description', { jdText: 'too short' }],
  ]) {
    test(`bad input is refused: ${label}`, async () => {
      const res = await create({ json: await saveBody(overrides) });
      assert.equal(res.status, 400);
      assert.equal(res.json.code, 'bad_application');
    });
  }

  test('at the per-user cap: 409; another user is unaffected', async () => {
    const gapReport = { matchScore: 0.5 };
    await Application.insertMany(
      Array.from({ length: MAX_APPLICATIONS_PER_USER }, () => ({ userId: userA, company: 'c', role: 'r', jdText: 'j', gapReport })),
    );
    const res = await create();
    assert.equal(res.status, 409);
    assert.equal(res.json.code, 'too_many_applications');
    assert.equal((await create({ userId: userB })).status, 201);
  });

  test('rate limit per user: the third save gets 429, another user is unaffected', async () => {
    assert.equal((await create({ url: limitedBase })).status, 201);
    assert.equal((await create({ url: limitedBase })).status, 201);
    assert.equal((await create({ url: limitedBase })).status, 429);
    assert.equal((await create({ userId: userB, url: limitedBase })).status, 201);
  });
});

// ---------- read ----------

describe('GET / and GET /:id', () => {
  test('the list holds only my applications, newest first, without any resume', async () => {
    const first = (await create()).json.id;
    const second = (await create({ json: await saveBody({ company: 'Globex' }) })).json.id;
    await create({ userId: userB, json: await saveBody({ company: 'B-ONLY' }, userB) });

    const res = await call(base, 'GET', '');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.applications.map((a) => a.id), [second, first]);
    const row = res.json.applications[0];
    assert.deepEqual(Object.keys(row).sort(), ['company', 'createdAt', 'id', 'matchScore', 'role', 'status']);
    assert.equal(typeof row.matchScore, 'number');
    assert.ok(!res.text.includes('B-ONLY'));
  });

  test('the list query uses the compound index: no in-memory SORT stage', async () => {
    await create();
    const plan = await Application.find({ userId: userA }).sort({ createdAt: -1 }).explain('queryPlanner');
    const text = JSON.stringify(plan.queryPlanner.winningPlan);
    assert.match(text, /IXSCAN/);
    assert.match(text, /userId_1_createdAt_-1/);
    assert.doesNotMatch(text, /"stage":"SORT"/);
  });

  test('GET /:id returns my application and its newest version, and no userId', async () => {
    const { id, versionId } = (await create()).json;
    const res = await call(base, 'GET', `/${id}`);
    assert.equal(res.status, 200);
    assert.equal(res.json.application.id, id);
    assert.equal(res.json.application.jdText, JD);
    assert.equal(res.json.version.id, versionId);
    assert.ok(Array.isArray(res.json.version.result.changes));
    assert.deepEqual(res.json.version.decisions, {});
    assert.ok(!res.text.includes('userId'));
  });

  test("IDOR: someone else's application is a 404, exactly like one that does not exist", async () => {
    const { id } = (await create()).json;
    const theirs = await call(base, 'GET', `/${id}`, { cookie: cookieFor(userB) });
    const missing = await call(base, 'GET', `/${new mongoose.Types.ObjectId()}`, { cookie: cookieFor(userB) });
    assert.equal(theirs.status, 404);
    assert.deepEqual(theirs.json, missing.json);
    assert.ok(!theirs.text.includes('Initech'));
  });

  test('a malformed id is a 404, not a 500', async () => {
    for (const id of ['abc', 'zzzzzzzzzzzzzzzzzzzzzzzz', '{"$ne":null}']) {
      assert.equal((await call(base, 'GET', `/${encodeURIComponent(id)}`)).status, 404, id);
    }
  });
});

// ---------- status ----------

describe('PATCH /:id (status)', () => {
  test('changes the status of my application', async () => {
    const { id } = (await create()).json;
    const res = await call(base, 'PATCH', `/${id}`, { json: { status: 'interview' } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { status: 'interview' });
    assert.equal((await Application.findById(id).lean()).status, 'interview');
  });

  test('an unknown status or extra field is refused', async () => {
    const { id } = (await create()).json;
    for (const json of [{ status: 'hired' }, {}, { status: 'applied', company: 'Evil' }]) {
      assert.equal((await call(base, 'PATCH', `/${id}`, { json })).status, 400, JSON.stringify(json));
    }
    assert.equal((await Application.findById(id).lean()).status, 'saved');
  });

  test("someone else's application: 404 and nothing changes", async () => {
    const { id } = (await create()).json;
    const res = await call(base, 'PATCH', `/${id}`, { cookie: cookieFor(userB), json: { status: 'rejected' } });
    assert.equal(res.status, 404);
    assert.equal((await Application.findById(id).lean()).status, 'saved');
  });
});

// ---------- decisions ----------

describe('PATCH /:id/versions/:versionId/decisions', () => {
  test('rejecting a passed rewrite is saved and the stored resume is rebuilt', async () => {
    const { id, versionId } = (await create()).json;
    const before = await ResumeVersion.findById(versionId).lean();
    assert.equal(before.resumeJson.experience[0].bullets.find((b) => b.id === 'exp1_b1').text, 'Developed a React dashboard adopted by 40 teams');

    const res = await call(base, 'PATCH', `/${id}/versions/${versionId}/decisions`, { json: { decisions: { exp1_b1: false } } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { decisions: { exp1_b1: false } });

    const after = await ResumeVersion.findById(versionId).lean();
    assert.equal(after.resumeJson.experience[0].bullets.find((b) => b.id === 'exp1_b1').text, 'Built a React dashboard used by 40 teams');
    assert.notEqual(after.texSource, before.texSource);
  });

  test('a rewrite the guardrail rejected (invented number) can NOT be accepted', async () => {
    const { id, versionId } = (await create()).json;
    const res = await call(base, 'PATCH', `/${id}/versions/${versionId}/decisions`, { json: { decisions: { exp1_b2: true } } });
    assert.equal(res.status, 400);
    assert.equal(res.json.code, 'not_toggleable');
  });

  test("someone else's version, or a version under the wrong application: 404", async () => {
    const { id, versionId } = (await create()).json;
    const other = (await create({ json: await saveBody({ company: 'Globex' }) })).json.id;
    const json = { decisions: { exp1_b1: false } };
    assert.equal((await call(base, 'PATCH', `/${id}/versions/${versionId}/decisions`, { cookie: cookieFor(userB), json })).status, 404);
    assert.equal((await call(base, 'PATCH', `/${other}/versions/${versionId}/decisions`, { json })).status, 404);
    assert.equal(Object.keys((await ResumeVersion.findById(versionId).lean()).decisions ?? {}).length, 0);
  });

  test('bad bodies are refused', async () => {
    const { id, versionId } = (await create()).json;
    for (const json of [{}, { decisions: { exp1_b1: 'yes' } }, { decisions: { 'bad id!': true } }, { decisions: {}, status: 'final' }]) {
      assert.equal((await call(base, 'PATCH', `/${id}/versions/${versionId}/decisions`, { json })).status, 400, JSON.stringify(json));
    }
  });
});

// ---------- delete ----------

describe('DELETE /:id', () => {
  test('deletes my application AND its resume versions (no orphans)', async () => {
    const { id } = (await create()).json;
    const keep = (await create({ json: await saveBody({ company: 'Globex' }) })).json.id;
    // A second version under the first application, as a re-tailor would add.
    const extra = await ResumeVersion.findOne({ applicationId: id }).lean();
    await ResumeVersion.create({ ...extra, _id: undefined, createdAt: undefined, updatedAt: undefined });
    assert.equal(await ResumeVersion.countDocuments({ applicationId: id }), 2);

    const res = await call(base, 'DELETE', `/${id}`);
    assert.equal(res.status, 204);
    assert.equal(await Application.countDocuments({ _id: id }), 0);
    assert.equal(await ResumeVersion.countDocuments({ applicationId: id }), 0);
    // The other application and its version are untouched.
    assert.equal(await ResumeVersion.countDocuments({ applicationId: keep }), 1);
    assert.equal((await call(base, 'DELETE', `/${id}`)).status, 404, 'a second delete is a 404');
  });

  test("someone else's application: 404 and nothing is deleted", async () => {
    const { id } = (await create()).json;
    assert.equal((await call(base, 'DELETE', `/${id}`, { cookie: cookieFor(userB) })).status, 404);
    assert.equal(await Application.countDocuments({ _id: id }), 1);
    assert.equal(await ResumeVersion.countDocuments({ applicationId: id }), 1);
  });
});
