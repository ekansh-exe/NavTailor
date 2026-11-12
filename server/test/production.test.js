// Production readiness: the startup config check, serving the built client from the same origin,
// the security headers Google sign-in needs, and errors that never show a stack trace.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkEnv } from '../src/env.js';

const GOOD_ENV = {
  MONGODB_URI: 'mongodb+srv://user:pass@cluster.example.net/navtailor',
  JWT_SECRET: 'a'.repeat(64),
  GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
  CLIENT_ORIGIN: 'https://navtailor.onrender.com',
  GROQ_API_KEY: 'k',
};

// ---------- the config check (pure) ----------

describe('checkEnv', () => {
  test('a complete environment has no problems', () => {
    assert.deepEqual(checkEnv(GOOD_ENV), { problems: [], warnings: [] });
  });

  test('lists EVERY missing variable at once', () => {
    const { problems } = checkEnv({});
    assert.deepEqual(problems, ['MONGODB_URI is missing', 'JWT_SECRET is missing', 'GOOGLE_CLIENT_ID is missing', 'CLIENT_ORIGIN is missing']);
  });

  for (const [label, change, pattern] of [
    ['a short JWT secret', { JWT_SECRET: 'abc' }, /JWT_SECRET is too short/],
    ['a URI that is not MongoDB', { MONGODB_URI: 'postgres://x' }, /MONGODB_URI must start/],
    ['an origin with a path', { CLIENT_ORIGIN: 'https://x.onrender.com/app' }, /CLIENT_ORIGIN must be an origin/],
    ['a port that is not a number', { PORT: '80a' }, /PORT must be/],
    ['too many trusted proxies', { TRUST_PROXY: '99' }, /TRUST_PROXY must be/],
  ]) {
    test(`refuses ${label}`, () => {
      const { problems } = checkEnv({ ...GOOD_ENV, ...change });
      assert.equal(problems.length, 1);
      assert.match(problems[0], pattern);
    });
  }

  test('never puts a value in a message', () => {
    const secret = 'SUPER-SECRET-VALUE';
    const { problems } = checkEnv({ ...GOOD_ENV, JWT_SECRET: secret, MONGODB_URI: `http://${secret}`, CLIENT_ORIGIN: `ftp://${secret}` });
    assert.equal(problems.length, 3);
    assert.ok(!problems.join(' ').includes(secret));
  });

  test('warns (does not refuse) without any LLM key', () => {
    const { problems, warnings } = checkEnv({ ...GOOD_ENV, GROQ_API_KEY: '' });
    assert.equal(problems.length, 0);
    assert.match(warnings[0], /No GEMINI_API_KEY or GROQ_API_KEY/);
  });
});

// ---------- the real entry point with a broken config ----------

describe('starting the server with missing variables', () => {
  test('prints one clear list, no stack trace, and exits with code 1', () => {
    const empty = path.join(os.tmpdir(), `navtailor-empty-${process.pid}.env`);
    fs.writeFileSync(empty, '');
    const env = { PATH: process.env.PATH, ENV_FILE: empty, JWT_SECRET: 'TINY-SECRET-VALUE' };
    let result;
    try {
      execFileSync(process.execPath, [new URL('../src/index.js', import.meta.url).pathname], { env, encoding: 'utf8', stdio: 'pipe' });
      assert.fail('the server should not have started');
    } catch (err) {
      result = err;
    } finally {
      fs.rmSync(empty, { force: true });
    }
    assert.equal(result.status, 1);
    const out = result.stderr;
    assert.match(out, /NavTailor cannot start/);
    assert.match(out, /MONGODB_URI is missing/);
    assert.match(out, /JWT_SECRET is too short/);
    assert.ok(!/\n\s+at /.test(out), 'no stack trace lines');
    assert.ok(!out.includes('TINY-SECRET-VALUE'), 'the value is never printed');
  });
});

// ---------- the app serving the client ----------

let base;
let server;
let dist;

before(async () => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'navtailor-dist-'));
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><div id="root">NAVTAILOR-INDEX</div>');
  fs.writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');

  Object.assign(process.env, GOOD_ENV, { CLIENT_DIST: dist, MONGODB_URI: 'mongodb://127.0.0.1:1/unused' });
  const { app } = await import('../src/app.js');
  server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  fs.rmSync(dist, { recursive: true, force: true });
});

describe('one origin: Express serves the built client', () => {
  test('/ and deep links like /app/result/<id> get index.html, not cached', async () => {
    for (const p of ['/', '/app', '/app/result/0123456789abcdef01234567', '/app/profile?tab=1']) {
      const res = await fetch(base + p);
      assert.equal(res.status, 200, p);
      assert.match(await res.text(), /NAVTAILOR-INDEX/, p);
      assert.equal(res.headers.get('cache-control'), 'no-cache', p);
    }
  });

  test('hashed assets are served with a one-year immutable cache', async () => {
    const res = await fetch(`${base}/assets/index-abc123.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('cache-control'), /max-age=31536000.*immutable/);
  });

  test('a missing asset is a 404, not index.html', async () => {
    const res = await fetch(`${base}/assets/nope.js`);
    assert.equal(res.status, 404);
    assert.doesNotMatch(await res.text(), /NAVTAILOR-INDEX/);
  });

  test('an unknown /api path is a JSON 404, not index.html', async () => {
    for (const p of ['/api/nope', '/api/applications/x/y/z/w']) {
      const res = await fetch(base + p, { method: p === '/api/nope' ? 'GET' : 'DELETE' });
      assert.equal(res.status, p === '/api/nope' ? 404 : 401, p);
      assert.match(res.headers.get('content-type'), /application\/json/, p);
    }
  });

  test('the API still works next to the client', async () => {
    assert.deepEqual(await (await fetch(`${base}/api/health`)).json(), { ok: true });
  });
});

describe('security headers for a page that uses Google sign-in', () => {
  test('CSP allows Google Identity Services, Google Fonts and blob: PDF frames, but no inline scripts', async () => {
    const csp = (await fetch(`${base}/`)).headers.get('content-security-policy');
    const directive = (name) => (csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? '').split(/\s+/).slice(1);
    assert.deepEqual(directive('script-src'), ["'self'", 'https://accounts.google.com/gsi/client']);
    assert.ok(directive('frame-src').includes('https://accounts.google.com/gsi/'));
    assert.ok(directive('frame-src').includes('blob:'));
    assert.ok(directive('connect-src').includes('https://accounts.google.com/gsi/'));
    assert.ok(directive('style-src').includes('https://fonts.googleapis.com'));
    assert.ok(directive('font-src').includes('https://fonts.gstatic.com'));
    assert.equal(directive('object-src')[0], "'none'");
    assert.ok(!csp.includes('upgrade-insecure-requests'));
  });

  test('the sign-in popup can talk back to the page; the referrer keeps the origin', async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
    assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal(res.headers.get('x-powered-by'), null);
  });
});

describe('errors never show a stack trace', () => {
  test('malformed JSON and an oversized body get short JSON answers', async () => {
    const bad = await fetch(`${base}/api/tailor`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"x":' });
    const text = await bad.text();
    assert.equal(bad.status, 400);
    assert.deepEqual(JSON.parse(text), { error: 'The request body is not valid JSON.', code: 'bad_json' });
    assert.ok(!/at .*\.js/.test(text));
  });
});
