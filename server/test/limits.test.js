// Tests for the cross-route limits: the per-IP sign-in limit, the shared per-user daily AI budget,
// body size limits and helmet's headers. The real app is used where no database is needed.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

const servers = [];
let appBase;
let createDailyAiLimiter;
let AUTH_LIMIT;

async function serve(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

before(async () => {
  process.env.JWT_SECRET ||= 'test-secret-for-limits-0123456789';
  process.env.CLIENT_ORIGIN ||= 'http://localhost:5173';
  process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:1/unused'; // never connected: no route here needs it
  process.env.GOOGLE_CLIENT_ID ||= 'test-client-id';
  ({ createDailyAiLimiter, AUTH_LIMIT } = await import('../src/middleware/limits.js'));
  const { app } = await import('../src/app.js');
  appBase = await serve(app);
});

after(() => {
  for (const s of servers) s.close();
});

const postJson = (url, body, headers = {}) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

// ---------- sign-in ----------

describe('POST /api/auth/google (per IP)', () => {
  test(`after ${10} attempts from one IP the next one is a 429 with a JSON message`, async () => {
    for (let i = 0; i < AUTH_LIMIT; i += 1) {
      const res = await postJson(`${appBase}/api/auth/google`, '{}');
      assert.equal(res.status, 400, `attempt ${i + 1} reaches the route`);
    }
    const res = await postJson(`${appBase}/api/auth/google`, '{}');
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get('retry-after')) > 0);
    const body = await res.json();
    assert.equal(body.code, 'auth_rate_limited');
  });

  test('other routes are not affected by the sign-in limit', async () => {
    assert.equal((await fetch(`${appBase}/api/health`)).status, 200);
  });
});

// ---------- daily AI budget ----------

describe('daily AI budget (per user, shared by every route it is mounted on)', () => {
  // Two stand-ins for tailor and import, mounted with ONE limiter instance, exactly as the real routers
  // share the dailyAiLimiter singleton. `fakeAuth` plays requireAuth.
  let base;
  before(async () => {
    const daily = createDailyAiLimiter({ limit: 2 });
    const app = express();
    app.use(express.json());
    const fakeAuth = (req, res, next) => {
      req.user = { id: req.get('x-user') };
      next();
    };
    const run = (req, res) => (req.body?.bad ? res.status(400).json({ code: 'bad' }) : res.json({ ok: true }));
    app.post('/tailor', fakeAuth, daily, run);
    app.post('/import', fakeAuth, daily, run);
    base = await serve(app);
  });
  const hit = (path, user, body = {}) => postJson(`${base}${path}`, JSON.stringify(body), { 'x-user': user });

  test('tailor and import spend the same budget; the next run gets a friendly 429', async () => {
    assert.equal((await hit('/tailor', 'alice')).status, 200);
    assert.equal((await hit('/import', 'alice')).status, 200);

    const res = await hit('/tailor', 'alice');
    assert.equal(res.status, 429);
    const body = await res.json();
    assert.equal(body.code, 'daily_limit');
    assert.match(body.error, /^You have used all 2 AI runs for today\. Your limit resets in about \d+ hours?\.$/);
    assert.ok(Number(res.headers.get('retry-after')) > 60 * 60, 'Retry-After says hours, not minutes');
    assert.equal((await hit('/import', 'alice')).status, 429, 'the other route is blocked too');
  });

  test('another user has their own budget', async () => {
    assert.equal((await hit('/tailor', 'bob')).status, 200);
  });

  test('a failed run (e.g. bad input) does not use up the budget', async () => {
    for (let i = 0; i < 5; i += 1) assert.equal((await hit('/tailor', 'carol', { bad: true })).status, 400);
    assert.equal((await hit('/tailor', 'carol')).status, 200);
    assert.equal((await hit('/tailor', 'carol')).status, 200);
    assert.equal((await hit('/tailor', 'carol')).status, 429);
  });
});

// ---------- body size and bad JSON ----------

describe('request bodies', () => {
  test('a JSON body over 100 kB is a 413 with a JSON error, not an HTML page', async () => {
    const big = JSON.stringify({ text: 'x'.repeat(120 * 1024) });
    const res = await fetch(`${appBase}/api/profile`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: big });
    assert.equal(res.status, 413);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.equal((await res.json()).code, 'too_large');
  });

  test('/api/applications accepts more (a saved result is large) but still has a cap', async () => {
    const mid = JSON.stringify({ text: 'x'.repeat(200 * 1024) });
    // Parsed fine, then refused by auth: proves the body was not rejected for size.
    assert.equal((await postJson(`${appBase}/api/applications`, mid)).status, 401);
    const huge = JSON.stringify({ text: 'x'.repeat(500 * 1024) });
    assert.equal((await postJson(`${appBase}/api/applications`, huge)).status, 413);
  });

  test('malformed JSON is a 400 bad_json', async () => {
    const res = await postJson(`${appBase}/api/tailor`, '{"jobDescription": ');
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, 'bad_json');
  });
});

// ---------- helmet ----------

describe('security headers (helmet defaults)', () => {
  test('are set on every response', async () => {
    const res = await fetch(`${appBase}/api/health`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.ok(res.headers.get('content-security-policy'));
    assert.ok(res.headers.get('strict-transport-security'));
    assert.equal(res.headers.get('x-powered-by'), null);
  });
});
