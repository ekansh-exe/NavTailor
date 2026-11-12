// Proves user A can never read or overwrite user B's profile (and vice versa).
//
// Integration test: the REAL Express app and REAL Mongo queries, talking to a throwaway
// in-memory MongoDB, so your Atlas data is never touched. Two users are simulated with
// valid session cookies; attackers use forged ones.
//
// Run: npm test

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const TEST_SECRET = 'test-secret-that-is-only-used-in-this-test-file-0123456789';

let mongod;
let server;
let base;
let Profile;

const userA = new mongoose.Types.ObjectId().toString();
const userB = new mongoose.Types.ObjectId().toString();

const cookieFor = (userId, secret = TEST_SECRET, options = {}) =>
  `session=${jwt.sign({ sub: userId }, secret, { algorithm: 'HS256', expiresIn: 3600, ...options })}`;

// Builds a token with "alg": "none" (no signature) by hand. jsonwebtoken refuses to make one.
function unsignedCookieFor(userId) {
  const part = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `session=${part({ alg: 'none', typ: 'JWT' })}.${part({ sub: userId })}.`;
}

function profileWith(secret) {
  return {
    basics: { name: secret, email: '', phone: '', location: '', links: [] },
    summary: `summary ${secret}`,
    education: [{ id: 'edu1', school: `school ${secret}`, degree: '', dates: '' }],
    experience: [
      {
        id: 'exp1',
        company: `company ${secret}`,
        role: '',
        dates: '',
        bullets: [{ id: 'b1', text: `bullet ${secret}`, skills: ['Go'], alwaysInclude: true }],
      },
    ],
    projects: [],
    certifications: [],
    skills: { languages: [secret], frameworks: [], tools: [] },
  };
}

async function api(method, path, { cookie, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, text: await res.text() };
}

// The stored document, straight from MongoDB (not through the API).
const storedProfileOf = (userId) => Profile.findOne({ userId }).lean();

before(async () => {
  mongod = await MongoMemoryServer.create();

  // config.js reads these at import time. dotenv never overrides variables that are
  // already set, so these win over server/.env: the test cannot reach Atlas.
  process.env.MONGODB_URI = mongod.getUri();
  process.env.JWT_SECRET = TEST_SECRET;
  process.env.CLIENT_ORIGIN = 'http://localhost:5173';
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';

  // Imported only after the env is set (static imports would run first).
  const { app } = await import('../src/app.js');
  ({ Profile } = await import('../src/models/Profile.js'));

  await mongoose.connect(mongod.getUri());
  await Profile.init(); // wait until the unique userId index exists

  server = app.listen(0); // port 0 = any free port
  base = `http://127.0.0.1:${server.address().port}`;

  // Both users have a profile with a secret only they should ever see.
  for (const [user, secret] of [
    [userA, 'SECRET-OF-A'],
    [userB, 'SECRET-OF-B'],
  ]) {
    const res = await api('PUT', '/api/profile', { cookie: cookieFor(user), body: profileWith(secret) });
    assert.equal(res.status, 200, `setup PUT for ${secret} failed: ${res.text}`);
  }
});

after(async () => {
  server?.close();
  await mongoose.disconnect();
  await mongod?.stop();
});

describe('reading: A only ever sees A', () => {
  test('each user GETs their own profile and never the other one', async () => {
    const a = await api('GET', '/api/profile', { cookie: cookieFor(userA) });
    const b = await api('GET', '/api/profile', { cookie: cookieFor(userB) });

    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.match(a.text, /SECRET-OF-A/);
    assert.doesNotMatch(a.text, /SECRET-OF-B/);
    assert.match(b.text, /SECRET-OF-B/);
    assert.doesNotMatch(b.text, /SECRET-OF-A/);
  });

  test("the response never exposes anyone's userId or _id", async () => {
    const b = await api('GET', '/api/profile', { cookie: cookieFor(userB) });
    assert.doesNotMatch(b.text, new RegExp(userA));
    assert.doesNotMatch(b.text, new RegExp(userB));
    assert.doesNotMatch(b.text, /"_id"|"userId"/);
  });

  test("B pointing at A's id in the query string still gets B's own profile", async () => {
    const res = await api('GET', `/api/profile?userId=${userA}`, { cookie: cookieFor(userB) });
    assert.equal(res.status, 200);
    assert.match(res.text, /SECRET-OF-B/);
    assert.doesNotMatch(res.text, /SECRET-OF-A/);
  });

  test("B pointing at A's id in the path gets nothing", async () => {
    const res = await api('GET', `/api/profile/${userA}`, { cookie: cookieFor(userB) });
    assert.equal(res.status, 404);
    assert.doesNotMatch(res.text, /SECRET-OF-A/);
  });

  test('a brand-new user C gets an empty profile, not anyone else’s', async () => {
    const userC = new mongoose.Types.ObjectId().toString();
    const res = await api('GET', '/api/profile', { cookie: cookieFor(userC) });
    assert.equal(res.status, 200);
    assert.doesNotMatch(res.text, /SECRET-OF-/);
    assert.equal(JSON.parse(res.text).profile.basics.name, '');
  });
});

describe('writing: B can never change A', () => {
  test("B saving their profile leaves A's document byte-for-byte unchanged", async () => {
    const before = await storedProfileOf(userA);
    const res = await api('PUT', '/api/profile', { cookie: cookieFor(userB), body: profileWith('B-EDIT') });
    assert.equal(res.status, 200);
    assert.deepEqual(await storedProfileOf(userA), before);
    // ...and B's own write did land.
    assert.equal((await storedProfileOf(userB)).basics.name, 'B-EDIT');
  });

  test("B putting A's userId (or _id) in the body is rejected, and A is unchanged", async () => {
    const before = await storedProfileOf(userA);
    for (const extra of [{ userId: userA }, { _id: before._id.toString() }]) {
      const res = await api('PUT', '/api/profile', {
        cookie: cookieFor(userB),
        body: { ...profileWith('HIJACK'), ...extra },
      });
      assert.equal(res.status, 400, `expected 400 for ${Object.keys(extra)[0]}`);
    }
    assert.deepEqual(await storedProfileOf(userA), before);
  });

  test('Mongo operators in the body are rejected, and A is unchanged', async () => {
    const before = await storedProfileOf(userA);
    const attempts = [
      { $set: { 'basics.name': 'HIJACK' } },
      { ...profileWith('HIJACK'), summary: { $ne: '' } },
    ];
    for (const body of attempts) {
      const res = await api('PUT', '/api/profile', { cookie: cookieFor(userB), body });
      assert.equal(res.status, 400);
    }
    assert.deepEqual(await storedProfileOf(userA), before);
  });
});

describe('forged sessions claiming to be A are refused', () => {
  const forgeries = {
    'no cookie at all': undefined,
    'signed with the wrong secret': cookieFor(userA, 'guessed-secret'),
    'alg "none" (no signature)': unsignedCookieFor(userA),
    'expired token': cookieFor(userA, TEST_SECRET, { expiresIn: -10 }),
    'garbage token': 'session=not.a.jwt',
  };

  for (const [name, cookie] of Object.entries(forgeries)) {
    test(`${name}: GET and PUT get 401 and A is unchanged`, async () => {
      const before = await storedProfileOf(userA);

      const read = await api('GET', '/api/profile', { cookie });
      assert.equal(read.status, 401);
      assert.doesNotMatch(read.text, /SECRET-OF-A/);

      const write = await api('PUT', '/api/profile', { cookie, body: profileWith('FORGED') });
      assert.equal(write.status, 401);

      assert.deepEqual(await storedProfileOf(userA), before);
    });
  }
});

describe('database invariants', () => {
  test('every profile belongs to exactly one user, and A and B each own exactly one', async () => {
    assert.equal(await Profile.countDocuments({ userId: userA }), 1);
    assert.equal(await Profile.countDocuments({ userId: userB }), 1);
  });

  test('the userId index is unique, so a second profile for A cannot exist', async () => {
    const indexes = await Profile.collection.indexes();
    const userIdIndex = indexes.find((ix) => ix.key.userId === 1);
    assert.ok(userIdIndex, 'userId index missing');
    assert.equal(userIdIndex.unique, true);

    await assert.rejects(
      Profile.collection.insertOne({ userId: new mongoose.Types.ObjectId(userA) }),
      (err) => err.code === 11000,
    );
  });
});
