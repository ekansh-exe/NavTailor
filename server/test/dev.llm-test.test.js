// Tests for POST /api/dev/llm-test. The LLM is a fake, so no real provider is ever called.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';

const TEST_SECRET = 'test-secret-that-is-only-used-in-this-test-file-0123456789';
const cookie = `session=${jwt.sign({ sub: 'user-1' }, TEST_SECRET, { algorithm: 'HS256', expiresIn: 3600 })}`;

let createDevRouter;
let LLMError;
let server;
let base;
let calls;
let nextLLM; // what the fake llm does on the next call

before(async () => {
  // config.js reads these at import time; set them first, then import.
  process.env.JWT_SECRET = TEST_SECRET;
  process.env.CLIENT_ORIGIN = 'http://localhost:5173';
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/unused';

  ({ createDevRouter } = await import('../src/routes/dev.js'));
  ({ LLMError } = await import('../src/llm/errors.js'));

  const fakeLLM = async (args) => {
    calls.push(args);
    return nextLLM(args);
  };

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/dev', createDevRouter({ llm: fakeLLM }));
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

const post = async (body, { withCookie = true } = {}) => {
  const res = await fetch(`${base}/api/dev/llm-test`, {
    method: 'POST',
    headers: {
      ...(withCookie ? { cookie } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

const GOOD = { provider: 'gemini_flash', ms: 12, data: { name: 'Jane Doe', role: 'Engineer', company: 'Acme', skills: ['React'] } };

describe('POST /api/dev/llm-test', () => {
  test('requires auth: no cookie gets 401 and the LLM is never called', async () => {
    calls = [];
    const res = await post({}, { withCookie: false });
    assert.equal(res.status, 401);
    assert.equal(calls.length, 0);
  });

  test('works with no body: uses the sample text and the parse task', async () => {
    calls = [];
    nextLLM = () => GOOD;
    const res = await post(undefined);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, GOOD);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].task, 'parse');
    assert.match(calls[0].user, /Jane Doe/);
    assert.match(calls[0].system, /JSON/); // Groq's JSON mode needs the word in the prompt
    // the schema passed to callLLM accepts the shape we ask for and rejects junk
    assert.ok(calls[0].schema.safeParse(GOOD.data).success);
    assert.ok(!calls[0].schema.safeParse({ name: 1 }).success);
  });

  test('passes a custom text and task through', async () => {
    calls = [];
    nextLLM = () => GOOD;
    const res = await post({ task: 'rewrite', text: 'Bob builds bridges at Beam Co.' });
    assert.equal(res.status, 200);
    assert.equal(calls[0].task, 'rewrite');
    assert.match(calls[0].user, /Bob builds bridges/);
  });

  test('rejects a bad body with 400 and never calls the LLM', async () => {
    calls = [];
    for (const body of [{ text: 123 }, { task: 'nope' }, { text: '' }, { text: 'x'.repeat(501) }]) {
      const res = await post(body);
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 40));
    }
    assert.equal(calls.length, 0);
  });

  test('all providers failing returns 502 with kind and causes only', async () => {
    const causes = [{ route: 'groq', kind: 'rate_limit', status: 429 }];
    nextLLM = () => {
      throw new LLMError('all_failed', { causes });
    };
    const res = await post({});
    assert.equal(res.status, 502);
    assert.equal(res.json.kind, 'all_failed');
    assert.deepEqual(res.json.causes, causes);
  });

  test('an unexpected crash returns a generic 500 without the error message', async () => {
    nextLLM = () => {
      throw new Error('internal detail that must not leak');
    };
    const res = await post({});
    assert.equal(res.status, 500);
    assert.ok(!JSON.stringify(res.json).includes('internal detail'));
  });
});

// Runs the REAL app (app.js) in a child process, because config.js reads NODE_ENV once at import.
// The body is deliberately invalid, so even when the route exists it answers 400 and no LLM call is made.
function statusFromRealApp(nodeEnv) {
  const appUrl = new URL('../src/app.js', import.meta.url).href;
  const code = `
    import { app } from ${JSON.stringify(appUrl)};
    const server = app.listen(0);
    const res = await fetch('http://127.0.0.1:' + server.address().port + '/api/dev/llm-test', {
      method: 'POST',
      headers: { cookie: process.env.TEST_COOKIE, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 123 }),
    });
    console.log(res.status);
    server.close();
    process.exit(0);
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, NODE_ENV: nodeEnv, TEST_COOKIE: cookie },
    encoding: 'utf8',
  });
  return Number(out.trim().split('\n').pop());
}

describe('dev route mounting in the real app', () => {
  test('outside production the route exists (auth passes, bad body gets 400)', () => {
    assert.equal(statusFromRealApp('development'), 400);
  });

  test('in production the route is not mounted: 404', () => {
    assert.equal(statusFromRealApp('production'), 404);
  });
});
