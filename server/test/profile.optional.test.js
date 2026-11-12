// The optional resume fields (job location, project tagline and date, achievements, activities),
// end to end through the real app and a throwaway in-memory MongoDB. Same idea as
// profile.grade.test.js, including a profile stored BEFORE these fields existed.
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

const profile = (overrides = {}) => ({
  basics: { name: 'Jane', email: '', phone: '', location: '', links: [] },
  summary: '',
  education: [],
  experience: [{ id: 'exp1', company: 'Acme', role: 'Eng', dates: '2024', location: ' Remote ', bullets: [] }],
  projects: [{ id: 'p1', name: 'NavTailor', tagline: 'AI resume tailoring', dates: 'Mar 2024', link: '', skills: [], bullets: [] }],
  certifications: [],
  skills: { languages: [], frameworks: [], tools: [] },
  achievements: [{ id: 'ach1', text: 'Winner, Smart India Hackathon' }],
  activitiesHeading: 'Leadership',
  activities: [{ id: 'act1', title: 'Lead, Coding Club', detail: '2023' }],
  ...overrides,
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

describe('optional resume fields', () => {
  test('they are saved, trimmed and returned by the next GET', async () => {
    const user = new mongoose.Types.ObjectId().toString();
    const put = await api('PUT', user, profile());
    assert.equal(put.status, 200);
    const { json } = await api('GET', user);
    assert.equal(json.profile.experience[0].location, 'Remote');
    assert.deepEqual([json.profile.projects[0].tagline, json.profile.projects[0].dates], ['AI resume tailoring', 'Mar 2024']);
    assert.deepEqual(json.profile.achievements, [{ id: 'ach1', text: 'Winner, Smart India Hackathon' }]);
    assert.equal(json.profile.activitiesHeading, 'Leadership');
    assert.deepEqual(json.profile.activities, [{ id: 'act1', title: 'Lead, Coding Club', detail: '2023' }]);
  });

  test('caps are enforced: too many achievements, an overlong heading', async () => {
    const user = new mongoose.Types.ObjectId().toString();
    const many = Array.from({ length: 16 }, (_, i) => ({ id: `ach${i}`, text: 'x' }));
    assert.equal((await api('PUT', user, profile({ achievements: many }))).status, 400);
    const res = await api('PUT', user, profile({ activitiesHeading: 'x'.repeat(61) }));
    assert.equal(res.status, 400);
    assert.equal(res.json.issues[0].path, 'activitiesHeading');
  });

  test('a profile saved BEFORE these fields existed reads back with "" and [] and no migration', async () => {
    const user = new mongoose.Types.ObjectId();
    // Written straight to the collection, bypassing Mongoose, exactly like an old document in Atlas.
    await Profile.collection.insertOne({
      userId: user,
      basics: { name: 'Old Timer', email: '', phone: '', location: '', links: [] },
      summary: '',
      education: [],
      experience: [{ id: 'exp1', company: 'Acme', role: 'Eng', dates: '2010', bullets: [] }],
      projects: [{ id: 'p1', name: 'Old', link: '', skills: [], bullets: [] }],
      certifications: [],
      skills: { languages: [], frameworks: [], tools: [] },
    });
    const get = await api('GET', user.toString());
    assert.equal(get.status, 200);
    const p = get.json.profile;
    assert.equal(p.experience[0].location, '');
    assert.deepEqual([p.projects[0].tagline, p.projects[0].dates], ['', '']);
    assert.deepEqual([p.achievements, p.activities, p.activitiesHeading], [[], [], '']);
    // ...and that profile, sent straight back, is accepted by PUT.
    assert.equal((await api('PUT', user.toString(), p)).status, 200);
  });
});
