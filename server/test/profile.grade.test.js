// The education "grade" field, end to end through the real app and a throwaway in-memory MongoDB.
// Includes the important case: a profile stored BEFORE the field existed (no migration was run).
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

const cookieFor = (userId) =>
  `session=${jwt.sign({ sub: userId }, TEST_SECRET, { algorithm: 'HS256', expiresIn: 3600 })}`;

const profileWith = (education) => ({
  basics: { name: 'Jane', email: '', phone: '', location: '', links: [] },
  summary: '',
  education,
  experience: [],
  projects: [],
  certifications: [],
  skills: { languages: [], frameworks: [], tools: [] },
});

async function api(method, userId, body) {
  const res = await fetch(`${base}/api/profile`, {
    method,
    headers: {
      cookie: cookieFor(userId),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

before(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.JWT_SECRET = TEST_SECRET;
  process.env.CLIENT_ORIGIN = 'http://localhost:5173';
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';

  const { app } = await import('../src/app.js');
  ({ Profile } = await import('../src/models/Profile.js'));
  await mongoose.connect(mongod.getUri());
  await Profile.init();
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.close();
  await mongoose.disconnect();
  await mongod?.stop();
});

describe('education grade', () => {
  test('a saved grade is returned by the next GET', async () => {
    const user = new mongoose.Types.ObjectId().toString();
    const put = await api('PUT', user, profileWith([{ id: 'edu1', school: 'MIT', degree: 'BSc', dates: '', grade: '8.7 / 10 CGPA' }]));
    assert.equal(put.status, 200);
    assert.equal(put.json.profile.education[0].grade, '8.7 / 10 CGPA');
    const get = await api('GET', user);
    assert.equal(get.json.profile.education[0].grade, '8.7 / 10 CGPA');
  });

  test('the grade is trimmed and capped at 60 characters', async () => {
    const user = new mongoose.Types.ObjectId().toString();
    const ok = await api('PUT', user, profileWith([{ id: 'edu1', school: 'MIT', degree: '', dates: '', grade: '  First Class  ' }]));
    assert.equal(ok.json.profile.education[0].grade, 'First Class');

    const tooLong = await api('PUT', user, profileWith([{ id: 'edu1', school: 'MIT', degree: '', dates: '', grade: 'x'.repeat(61) }]));
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.json.issues[0].path, 'education.0.grade');
  });

  test('a request that leaves grade out still works and stores an empty grade', async () => {
    const user = new mongoose.Types.ObjectId().toString();
    const put = await api('PUT', user, profileWith([{ id: 'edu1', school: 'MIT', degree: 'BSc', dates: '' }]));
    assert.equal(put.status, 200);
    assert.equal(put.json.profile.education[0].grade, '');
    const stored = await Profile.findOne({ userId: user }).lean();
    assert.equal(stored.education[0].grade, '');
  });

  test('a profile saved BEFORE grade existed reads back with grade "" and no migration', async () => {
    const user = new mongoose.Types.ObjectId();
    // Written straight to the collection, bypassing Mongoose, exactly like an old document in Atlas.
    await Profile.collection.insertOne({
      userId: user,
      basics: { name: 'Old Timer', email: '', phone: '', location: '', links: [] },
      summary: '',
      education: [{ id: 'edu1', school: 'Old School', degree: 'BA', dates: '1999' }],
      experience: [],
      projects: [],
      certifications: [],
      skills: { languages: [], frameworks: [], tools: [] },
    });
    const raw = await Profile.collection.findOne({ userId: user });
    assert.ok(!('grade' in raw.education[0]), 'precondition: the stored item has no grade field');

    const get = await api('GET', user.toString());
    assert.equal(get.status, 200);
    assert.equal(get.json.profile.education[0].school, 'Old School');
    assert.equal(get.json.profile.education[0].grade, ''); // not undefined: React inputs stay controlled
  });
});
