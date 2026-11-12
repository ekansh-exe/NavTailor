// Tests for /api/applications. The LLM is a fake; the profile loader is a fake; the applications
// themselves go to a REAL throwaway in-memory MongoDB, so the userId scoping is tested for real.
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
let MAX_APPLICATIONS_PER_USER;
let tailorResponseSchema;
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
  ({ tailorResponseSchema } = await import('../src/tailor/schemas.js'));
  await mongoose.connect(mongod.getUri());
  await Application.init(); // builds the indexes

  const appWith = (router) => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/applications', router);
    return app;
  };
  base = await serve(appWith(createApplicationsRouter({ llm: fakeLLM, loadProfile: fakeLoad, limit: 1000 })));
  limitedBase = await serve(appWith(createApplicationsRouter({ llm: fakeLLM, loadProfile: fakeLoad, limit: 2 })));
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
});

async function call(url, method, path, { cookie = cookieFor(userA), json } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (json !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${url}/api/applications${path}`, { method, headers, body: json === undefined ? undefined : JSON.stringify(json) });
  const text = await res.text();
  return { status: res.status, text, json: text ? JSON.parse(text) : null };
}
const BODY = { company: 'Initech', role: 'Backend Engineer', jobDescription: JOB_DESCRIPTION };
const create = (opts = {}, url = base) => call(url, 'POST', '', { json: BODY, ...opts });

// ---------- auth ----------

describe('auth', () => {
  test('every route answers 401 without a cookie, and no LLM call is made', async () => {
    const id = new mongoose.Types.ObjectId().toString();
    for (const [method, path, json] of [
      ['POST', '', BODY],
      ['GET', '', undefined],
      ['GET', `/${id}`, undefined],
      ['PATCH', `/${id}/decisions`, { decisions: {} }],
    ]) {
      assert.equal((await call(base, method, path, { cookie: null, json })).status, 401, `${method} ${path}`);
    }
    assert.equal(llmCalls.length, 0);
  });

  test('the real app mounts the router and protects it', async () => {
    assert.equal((await call(appBase, 'GET', '', { cookie: null })).status, 401);
  });
});

// ---------- create ----------

describe('POST /', () => {
  test('tailors, saves for the signed-in user and returns 201 { id }', async () => {
    const res = await create();
    assert.equal(res.status, 201);
    assert.match(res.json.id, /^[a-f0-9]{24}$/);
    assert.deepEqual(llmCalls, ['analyze', 'rewrite']);

    const doc = await Application.findById(res.json.id).lean();
    assert.equal(String(doc.userId), userA);
    assert.equal(doc.company, 'Initech');
    assert.equal(doc.status, 'tailored');
    assert.ok(tailorResponseSchema.safeParse(doc.result).success, 'the stored result matches the tailor schema');
    assert.ok(Object.keys(doc.result.scores).length > 0, 'bullet scores are stored for /render');
  });

  test('a userId in the body is refused (the owner comes only from the cookie)', async () => {
    const res = await create({ json: { ...BODY, userId: userB } });
    assert.equal(res.status, 400);
    assert.equal(await Application.countDocuments({}), 0);
  });

  for (const [label, json] of [
    ['missing company', { ...BODY, company: '' }],
    ['missing role', { ...BODY, role: '   ' }],
    ['short job description', { ...BODY, jobDescription: 'too short' }],
    ['huge job description', { ...BODY, jobDescription: 'x'.repeat(15_001) }],
  ]) {
    test(`bad input is refused before any LLM call: ${label}`, async () => {
      const res = await create({ json });
      assert.equal(res.status, 400);
      assert.equal(res.json.code, 'bad_application');
      assert.equal(llmCalls.length, 0);
    });
  }

  test('a tailoring failure is passed through and nothing is saved', async () => {
    const { createApplicationsRouter } = await import('../src/routes/applications.js');
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/applications', createApplicationsRouter({ llm: fakeLLM, loadProfile: async () => null, limit: 1000 }));
    const res = await create({}, await serve(app));
    assert.equal(res.status, 404);
    assert.equal(res.json.code, 'no_profile');
    assert.equal(await Application.countDocuments({}), 0);
  });

  test('at the per-user cap: 409 before any LLM call; another user is unaffected', async () => {
    const result = (await Application.create({ userId: userA, company: 'c', role: 'r', jobDescription: 'j', result: {} })).result;
    await Application.insertMany(
      Array.from({ length: MAX_APPLICATIONS_PER_USER - 1 }, () => ({ userId: userA, company: 'c', role: 'r', jobDescription: 'j', result })),
    );
    const res = await create();
    assert.equal(res.status, 409);
    assert.equal(res.json.code, 'too_many_applications');
    assert.equal(llmCalls.length, 0);
    assert.equal((await create({ cookie: cookieFor(userB) })).status, 201);
  });

  test('rate limit per user: the third create gets 429, another user is unaffected', async () => {
    assert.equal((await create({}, limitedBase)).status, 201);
    assert.equal((await create({}, limitedBase)).status, 201);
    assert.equal((await create({}, limitedBase)).status, 429);
    assert.equal((await create({ cookie: cookieFor(userB) }, limitedBase)).status, 201);
  });
});

// ---------- read ----------

describe('GET / and GET /:id', () => {
  test('the list holds only my applications, newest first, without the heavy result', async () => {
    const first = (await create()).json.id;
    const second = (await create({ json: { ...BODY, company: 'Globex' } })).json.id;
    await create({ cookie: cookieFor(userB), json: { ...BODY, company: 'B-ONLY' } });

    const res = await call(base, 'GET', '');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.applications.map((a) => a.id), [second, first]);
    const row = res.json.applications[0];
    assert.deepEqual(Object.keys(row).sort(), ['company', 'createdAt', 'id', 'matchScore', 'role', 'status']);
    assert.equal(typeof row.matchScore, 'number');
    assert.ok(!res.text.includes('B-ONLY'));
  });

  test('GET /:id returns my application with its result, and no userId', async () => {
    const id = (await create()).json.id;
    const res = await call(base, 'GET', `/${id}`);
    assert.equal(res.status, 200);
    assert.equal(res.json.application.id, id);
    assert.equal(res.json.application.jobDescription, JOB_DESCRIPTION.trim());
    assert.ok(Array.isArray(res.json.application.result.changes));
    assert.deepEqual(res.json.application.decisions, {});
    assert.ok(!('userId' in res.json.application));
  });

  test("IDOR: someone else's application is a 404, exactly like one that does not exist", async () => {
    const id = (await create()).json.id;
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

// ---------- decisions ----------

describe('PATCH /:id/decisions', () => {
  test('rejecting a passed rewrite is saved and the status becomes reviewed', async () => {
    const id = (await create()).json.id;
    const res = await call(base, 'PATCH', `/${id}/decisions`, { json: { decisions: { exp1_b1: false } } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { decisions: { exp1_b1: false }, status: 'reviewed' });
    assert.deepEqual((await call(base, 'GET', `/${id}`)).json.application.decisions, { exp1_b1: false });
  });

  test('a rewrite the guardrail rejected (invented number) can NOT be accepted', async () => {
    const id = (await create()).json.id;
    const app = (await call(base, 'GET', `/${id}`)).json.application;
    assert.equal(app.result.changes.find((c) => c.itemId === 'exp1_b2').reason, 'new_number');

    const res = await call(base, 'PATCH', `/${id}/decisions`, { json: { decisions: { exp1_b2: true } } });
    assert.equal(res.status, 400);
    assert.equal(res.json.code, 'not_toggleable');
    assert.deepEqual(res.json.itemIds, ['exp1_b2']);
    assert.equal((await Application.findById(id).lean()).status, 'tailored');
  });

  test("someone else's application: 404 and nothing changes", async () => {
    const id = (await create()).json.id;
    const res = await call(base, 'PATCH', `/${id}/decisions`, { cookie: cookieFor(userB), json: { decisions: { exp1_b1: false } } });
    assert.equal(res.status, 404);
    const doc = await Application.findById(id).lean();
    assert.equal(doc.status, 'tailored');
    assert.equal(Object.keys(doc.decisions ?? {}).length, 0);
  });

  test('bad bodies are refused', async () => {
    const id = (await create()).json.id;
    for (const json of [{}, { decisions: { exp1_b1: 'yes' } }, { decisions: { 'bad id!': true } }, { decisions: {}, status: 'final' }]) {
      assert.equal((await call(base, 'PATCH', `/${id}/decisions`, { json })).status, 400, JSON.stringify(json));
    }
  });
});
