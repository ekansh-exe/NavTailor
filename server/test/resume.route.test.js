// Tests for POST /api/resume/render and GET /api/resume/tex.
// Tectonic is a fake (injected `compile`), so no real PDF engine is needed. The GET tests also run
// against a throwaway in-memory MongoDB with two users, to prove one user never sees another's profile.
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const TEST_SECRET = 'test-secret-that-is-only-used-in-this-test-file-0123456789';
const userA = new mongoose.Types.ObjectId().toString();
const userB = new mongoose.Types.ObjectId().toString();
const userC = new mongoose.Types.ObjectId().toString(); // never saves a profile
const cookieFor = (id, secret = TEST_SECRET) => `session=${jwt.sign({ sub: id }, secret, { algorithm: 'HS256', expiresIn: 3600 })}`;

let mongod;
let Profile;
let CompileError;
let renderResume;
let createResumeRouter;
let scratch;

const servers = [];
async function serve(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}
function appWith(router) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/resume', router);
  return app;
}

// ---------- fakes ----------

let compileCalls;
let nextCompile;
let loadCalls;
let nextLoad;
let cleanupCalls;

const fakeCompile = async (source) => {
  compileCalls.push(source);
  return nextCompile(source);
};
const fakeLoad = async (userId) => {
  loadCalls.push(userId);
  return nextLoad(userId);
};

// The fake page counter: returns the next number in the queue (the last one repeats); an Error is thrown.
let pagesQueue;
const fakeCount = async () => {
  const next = pagesQueue.length > 1 ? pagesQueue.shift() : pagesQueue[0];
  if (next instanceof Error) throw next;
  return next;
};

const PDF_BODY = Buffer.concat([Buffer.from('%PDF-1.5\n'), Buffer.alloc(200_000, 0x78), Buffer.from('\n%%EOF\n')]); // > 1 stream chunk

// A "compiled" PDF in its own folder, with a cleanup that counts its calls.
async function okCompile() {
  const dir = fs.mkdtempSync(path.join(scratch, 'job-'));
  const pdfPath = path.join(dir, 'main.pdf');
  fs.writeFileSync(pdfPath, PDF_BODY);
  return {
    pdfPath,
    cleanup: async () => {
      cleanupCalls += 1;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

const waitFor = async (condition, ms = 2000) => {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) assert.fail('condition not met in time');
    await new Promise((r) => setTimeout(r, 10));
  }
};

// ---------- fixtures ----------

const resume = (overrides = {}) => ({
  basics: { name: 'Jane Doe', email: 'jane@example.com', phone: '', location: 'Pune', links: ['https://github.com/janedoe'] },
  summary: 'Engineer.',
  education: [{ id: 'edu1', school: 'State University', degree: 'B.Sc.', dates: '2017 - 2021', grade: '' }],
  experience: [
    {
      id: 'exp1',
      company: 'Acme Corp',
      role: 'Engineer',
      dates: '2021 - 2024',
      bullets: [{ id: 'exp1_b1', text: 'Built a React dashboard', skills: ['React'], alwaysInclude: false }],
    },
  ],
  projects: [],
  certifications: [],
  skills: { languages: ['JavaScript'], frameworks: [], tools: [] },
  ...overrides,
});

// ---------- http helper ----------

async function call(base, method, url, { cookie = cookieFor(userA), json, body, contentType } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  let payload;
  if (json !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(json);
  } else if (body !== undefined) {
    headers['content-type'] = contentType ?? 'text/plain';
    payload = body;
  }
  const res = await fetch(`${base}${url}`, { method, headers, body: payload });
  const buffer = Buffer.from(await res.arrayBuffer());
  let parsed = null;
  if ((res.headers.get('content-type') ?? '').includes('application/json')) parsed = JSON.parse(buffer.toString('utf8'));
  return { status: res.status, headers: res.headers, buffer, json: parsed, text: buffer.toString('utf8') };
}

const errorLines = (spy) => spy.mock.calls.map((c) => c.arguments.map(String).join(' ')).join('\n');

let base; // main app: fake compile, fake loader
let limitedBase; // rate limit of 2
let busyBase; // one compile at a time
let dbBase; // fake compile, REAL loader (MongoDB)
let appBase; // the real app.js, to prove the router is mounted
let fitBase; // fake compile AND fake page counter
let fitBusyBase; // same, one compile at a time

before(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.JWT_SECRET = TEST_SECRET;
  process.env.CLIENT_ORIGIN = 'http://localhost:5173';
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'navtailor-routetest-'));

  ({ createResumeRouter } = await import('../src/routes/resume.js'));
  ({ CompileError } = await import('../src/latex/compile.js'));
  ({ renderResume } = await import('../src/latex/template.js'));
  ({ Profile } = await import('../src/models/Profile.js'));
  await mongoose.connect(mongod.getUri());
  await Profile.init();

  base = await serve(appWith(createResumeRouter({ compile: fakeCompile, loadProfile: fakeLoad, limit: 1000 })));
  limitedBase = await serve(appWith(createResumeRouter({ compile: fakeCompile, loadProfile: fakeLoad, limit: 2 })));
  busyBase = await serve(appWith(createResumeRouter({ compile: fakeCompile, loadProfile: fakeLoad, limit: 1000, maxConcurrent: 1 })));
  dbBase = await serve(appWith(createResumeRouter({ compile: fakeCompile, limit: 1000 })));
  fitBase = await serve(appWith(createResumeRouter({ compile: fakeCompile, countPages: fakeCount, limit: 1000 })));
  fitBusyBase = await serve(appWith(createResumeRouter({ compile: fakeCompile, countPages: fakeCount, limit: 1000, maxConcurrent: 1 })));
  const { app } = await import('../src/app.js');
  appBase = await serve(app);
});

after(async () => {
  for (const s of servers) s.close();
  await mongoose.disconnect();
  await mongod?.stop();
  fs.rmSync(scratch, { recursive: true, force: true });
});

// The server removes a job's folder just AFTER the client has read the last byte. Waiting here means
// a late cleanup can never be counted in the next test, and any request that forgets to clean up
// makes this hook (and so the test) fail.
afterEach(async () => {
  await waitFor(() => fs.readdirSync(scratch).every((name) => !name.startsWith('job-')));
});

beforeEach(() => {
  compileCalls = [];
  loadCalls = [];
  cleanupCalls = 0;
  pagesQueue = [1];
  nextCompile = okCompile;
  nextLoad = async () => resume();
});

// ---------- auth ----------

describe('auth', () => {
  test('no cookie: 401 on both routes and nothing is compiled or loaded', async () => {
    const post = await call(base, 'POST', '/api/resume/render', { cookie: null, json: { resumeJson: resume() } });
    const get = await call(base, 'GET', '/api/resume/tex', { cookie: null });
    assert.equal(post.status, 401);
    assert.equal(get.status, 401);
    assert.equal(compileCalls.length, 0);
    assert.equal(loadCalls.length, 0);
  });

  test('a cookie signed with the wrong secret is refused', async () => {
    const forged = cookieFor(userA, 'some-other-secret-that-is-long-enough-0123456789');
    assert.equal((await call(base, 'POST', '/api/resume/render', { cookie: forged, json: { resumeJson: resume() } })).status, 401);
    assert.equal((await call(base, 'GET', '/api/resume/tex', { cookie: forged })).status, 401);
    assert.equal(compileCalls.length, 0);
  });

  test('the real app mounts the router and protects it', async () => {
    assert.equal((await call(appBase, 'GET', '/api/resume/tex', { cookie: null })).status, 401);
    assert.equal((await call(appBase, 'POST', '/api/resume/render', { cookie: null, json: {} })).status, 401);
  });
});

// ---------- POST /render ----------

describe('POST /render: success', () => {
  test('streams the PDF with the right headers and exactly the compiled bytes', async () => {
    const res = await call(base, 'POST', '/api/resume/render', { json: { resumeJson: resume() } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.equal(res.headers.get('content-disposition'), 'inline; filename="resume.pdf"');
    assert.equal(res.headers.get('content-length'), String(PDF_BODY.length));
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.ok(res.buffer.equals(PDF_BODY), 'body differs from the compiled file');
  });

  test('the temp files are cleaned up exactly once, after the response', async () => {
    await call(base, 'POST', '/api/resume/render', { json: { resumeJson: resume() } });
    await waitFor(() => cleanupCalls === 1);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(cleanupCalls, 1);
    assert.deepEqual(fs.readdirSync(scratch).filter((n) => n.startsWith('job-')), []);
  });

  test('the resume goes through the template: text is escaped before it reaches the compiler', async () => {
    const res = await call(base, 'POST', '/api/resume/render', {
      json: { resumeJson: resume({ summary: 'Cut costs by 40% & saved $2M' }) },
    });
    assert.equal(res.status, 200);
    assert.equal(compileCalls.length, 1);
    assert.ok(compileCalls[0].startsWith('\\documentclass'));
    assert.ok(compileCalls[0].includes('Cut costs by 40\\% \\& saved \\$2M'));
  });

  test('LaTeX commands inside the resume never reach the compiler as commands', async () => {
    const hostile = '\\input{/etc/passwd} \\write18{touch x}';
    const r = resume();
    r.basics.name = hostile;
    r.experience[0].bullets[0].text = hostile;
    await call(base, 'POST', '/api/resume/render', { json: { resumeJson: r } });
    assert.ok(!compileCalls[0].includes('\\input{'));
    assert.ok(!compileCalls[0].includes('\\write18'));
  });

  test('nothing from the resume ends up in a response header', async () => {
    const r = resume();
    r.basics.name = 'Evil\r\nSet-Cookie: x=1';
    const res = await call(base, 'POST', '/api/resume/render', { json: { resumeJson: r } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('set-cookie'), null);
    assert.equal(res.headers.get('content-disposition'), 'inline; filename="resume.pdf"');
  });
});

describe('POST /render: bad requests are refused before any compile', () => {
  const valid = resume();
  const cases = [
    ['no body at all', undefined],
    ['an empty object', {}],
    ['resumeJson is a string', { resumeJson: 'hello' }],
    ['resumeJson is JSON text instead of an object', { resumeJson: JSON.stringify(valid) }],
    ['resumeJson is an empty object', { resumeJson: {} }],
    ['an extra top-level key', { resumeJson: valid, userId: 'someone' }],
    ['an extra key inside the resume', { resumeJson: { ...valid, userId: 'someone' } }],
    ['a non-http link', { resumeJson: resume({ basics: { ...valid.basics, links: ['javascript:alert(1)'] } }) }],
    ['duplicate ids', { resumeJson: resume({ education: [{ ...valid.education[0], id: 'exp1' }] }) }],
    ['a bullet that is too long', { resumeJson: resume({ summary: 'x'.repeat(5000) }) }],
  ];
  for (const [label, json] of cases) {
    test(label, async () => {
      const res = await call(base, 'POST', '/api/resume/render', json === undefined ? {} : { json });
      assert.equal(res.status, 400);
      assert.equal(res.json.code, 'bad_resume');
      assert.equal(typeof res.json.error, 'string');
      assert.equal(compileCalls.length, 0);
    });
  }

  test('a body that is not JSON is refused', async () => {
    const res = await call(base, 'POST', '/api/resume/render', { body: 'resumeJson=hello', contentType: 'text/plain' });
    assert.equal(res.status, 400);
    assert.equal(compileCalls.length, 0);
  });

  test('the answer lists paths and messages only, never the resume or the console', async (t) => {
    const spy = t.mock.method(console, 'error', () => {});
    const r = resume({ basics: { ...valid.basics, name: 'SECRET-NAME-123', links: ['javascript:SECRET-LINK-456'] } });
    const res = await call(base, 'POST', '/api/resume/render', { json: { resumeJson: r } });
    assert.equal(res.status, 400);
    assert.ok(res.json.issues.length > 0);
    assert.ok(res.json.issues.every((i) => typeof i.path === 'string' && typeof i.message === 'string'));
    assert.ok(!res.text.includes('SECRET-NAME-123'));
    assert.ok(!res.text.includes('SECRET-LINK-456'));
    assert.ok(!errorLines(spy).includes('SECRET'));
  });
});

// ---------- POST /render: compile problems ----------

describe('POST /render: compile problems become friendly errors', () => {
  test('a failed compile: 422, a friendly sentence, parsed details and the trimmed log', async (t) => {
    const spy = t.mock.method(console, 'error', () => {});
    nextCompile = async () => {
      throw new CompileError('failed', { log: '! Undefined control sequence.\nl.7 \\foo SECRET-LOG-MARKER\n' });
    };
    const res = await call(base, 'POST', '/api/resume/render', { json: { resumeJson: resume() } });
    assert.equal(res.status, 422);
    assert.equal(res.json.code, 'compile_failed');
    assert.match(res.json.error, /^We could not build your PDF\. LaTeX ran into a command it does not know\. \(near line 7/);
    assert.equal(res.json.details[0].line, 7);
    assert.match(res.json.details[0].summary, /command it does not know/);
    assert.ok(res.json.log.includes('! Undefined control sequence.'));
    assert.ok(res.json.log.includes('SECRET-LOG-MARKER'), 'the user should get their own log');
    // The server console gets the kind only: the log can contain resume text.
    assert.ok(!errorLines(spy).includes('SECRET-LOG-MARKER'));
    assert.ok(!errorLines(spy).includes('Undefined control sequence'));
    assert.match(errorLines(spy), /compile failed: failed/);
  });

  test('a failed compile with an unreadable log still gets a friendly answer', async () => {
    nextCompile = async () => {
      throw new CompileError('failed', { log: '' });
    };
    const res = await call(base, 'POST', '/api/resume/render', { json: { resumeJson: resume() } });
    assert.equal(res.status, 422);
    assert.match(res.json.error, /could not build your PDF/i);
    assert.deepEqual(res.json.details, []);
  });

  test('a missing package is blamed on the server, not on the resume', async () => {
    nextCompile = async () => {
      throw new CompileError('failed', { log: "! LaTeX Error: File `titlesec.sty' not found.\nl.4 \\usepackage{titlesec}" });
    };
    const res = await call(base, 'POST', '/api/resume/render', { json: { resumeJson: resume() } });
    assert.equal(res.status, 422);
    assert.match(res.json.error, /problem on our side/);
  });

  test('a timeout: 504', async () => {
    nextCompile = async () => {
      throw new CompileError('timeout');
    };
    const res = await call(base, 'POST', '/api/resume/render', { json: { resumeJson: resume() } });
    assert.equal(res.status, 504);
    assert.equal(res.json.code, 'compile_timeout');
    assert.match(res.json.error, /took too long/);
  });

  test('Tectonic not installed: 503 with a calm message', async () => {
    nextCompile = async () => {
      throw new CompileError('unavailable');
    };
    const res = await call(base, 'POST', '/api/resume/render', { json: { resumeJson: resume() } });
    assert.equal(res.status, 503);
    assert.equal(res.json.code, 'compiler_unavailable');
    assert.match(res.json.error, /not available/);
  });

  test('an unexpected crash: 500, and neither the message nor resume text leaks', async (t) => {
    const spy = t.mock.method(console, 'error', () => {});
    nextCompile = async () => {
      throw new Error('boom SECRET-CRASH-DETAIL');
    };
    const res = await call(base, 'POST', '/api/resume/render', { json: { resumeJson: resume() } });
    assert.equal(res.status, 500);
    assert.equal(res.json.code, 'internal');
    assert.ok(!res.text.includes('SECRET-CRASH-DETAIL'));
    assert.ok(!errorLines(spy).includes('SECRET-CRASH-DETAIL'));
  });

  test('if the compiled file cannot be opened: 500 and the temp files are still removed', async () => {
    nextCompile = async () => ({
      pdfPath: path.join(scratch, 'does-not-exist.pdf'),
      cleanup: async () => {
        cleanupCalls += 1;
      },
    });
    const res = await call(base, 'POST', '/api/resume/render', { json: { resumeJson: resume() } });
    assert.equal(res.status, 500);
    assert.equal(res.json.code, 'internal');
    assert.equal(cleanupCalls, 1);
  });
});

// ---------- limits ----------

describe('limits', () => {
  test('at most maxConcurrent compiles run at once; the rest get 503 busy, and slots are released', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    nextCompile = async () => {
      await gate;
      return okCompile();
    };
    const first = call(busyBase, 'POST', '/api/resume/render', { json: { resumeJson: resume() } });
    await waitFor(() => compileCalls.length === 1);

    const second = await call(busyBase, 'POST', '/api/resume/render', { json: { resumeJson: resume() } });
    assert.equal(second.status, 503);
    assert.equal(second.json.code, 'busy');
    assert.equal(second.headers.get('retry-after'), '5');
    assert.equal(compileCalls.length, 1, 'a busy request must not start a compile');

    release();
    assert.equal((await first).status, 200);

    nextCompile = okCompile;
    assert.equal((await call(busyBase, 'POST', '/api/resume/render', { json: { resumeJson: resume() } })).status, 200);
  });

  test('a failed compile also frees its slot', async () => {
    nextCompile = async () => {
      throw new CompileError('failed', { log: '' });
    };
    assert.equal((await call(busyBase, 'POST', '/api/resume/render', { json: { resumeJson: resume() } })).status, 422);
    nextCompile = okCompile;
    assert.equal((await call(busyBase, 'POST', '/api/resume/render', { json: { resumeJson: resume() } })).status, 200);
  });

  test('rate limit is per user: the third build from one user gets 429, another user is unaffected', async () => {
    const send = (cookie) => call(limitedBase, 'POST', '/api/resume/render', { cookie, json: { resumeJson: resume() } });
    assert.equal((await send(cookieFor(userA))).status, 200);
    assert.equal((await send(cookieFor(userA))).status, 200);
    const limited = await send(cookieFor(userA));
    assert.equal(limited.status, 429);
    assert.equal(limited.json.code, 'rate_limited');
    assert.equal((await send(cookieFor(userB))).status, 200);
  });
});

// ---------- GET /tex ----------

describe('GET /tex (fake profile loader)', () => {
  test('returns the LaTeX source as a text download', async () => {
    const res = await call(base, 'GET', '/api/resume/tex');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(res.headers.get('content-disposition'), 'attachment; filename="resume.tex"');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.text, renderResume(resume()));
    assert.ok(res.text.startsWith('\\documentclass'));
  });

  test('the profile is looked up with the id from the cookie, whatever the URL or headers say', async () => {
    await call(base, 'GET', `/api/resume/tex?userId=${userB}&id=${userB}`, { cookie: cookieFor(userA) });
    await call(base, 'GET', '/api/resume/tex', { cookie: cookieFor(userC) });
    assert.deepEqual(loadCalls, [userA, userC]);
  });

  test('it only reads: nothing is compiled', async () => {
    await call(base, 'GET', '/api/resume/tex');
    assert.equal(compileCalls.length, 0);
  });

  test('no saved profile: 404', async () => {
    nextLoad = async () => null;
    const res = await call(base, 'GET', '/api/resume/tex');
    assert.equal(res.status, 404);
    assert.equal(res.json.code, 'no_profile');
  });

  test('an empty profile: 409', async () => {
    nextLoad = async () => ({
      basics: { name: '', email: '', phone: '', location: '', links: [] },
      summary: '',
      education: [],
      experience: [],
      projects: [],
      certifications: [],
      skills: { languages: [], frameworks: [], tools: [] },
    });
    const res = await call(base, 'GET', '/api/resume/tex');
    assert.equal(res.status, 409);
    assert.equal(res.json.code, 'empty_profile');
  });

  test('a stored profile that fails validation: 500, and its content is not logged', async (t) => {
    const spy = t.mock.method(console, 'error', () => {});
    nextLoad = async () => ({ basics: { name: 'SECRET-STORED-NAME' } });
    const res = await call(base, 'GET', '/api/resume/tex');
    assert.equal(res.status, 500);
    assert.equal(res.json.code, 'bad_profile');
    assert.ok(!res.text.includes('SECRET-STORED-NAME'));
    assert.ok(!errorLines(spy).includes('SECRET-STORED-NAME'));
  });

  test('a database error: 500 without the error message', async (t) => {
    const spy = t.mock.method(console, 'error', () => {});
    nextLoad = async () => {
      throw new Error('connection string mongodb://user:SECRET-PASSWORD@host');
    };
    const res = await call(base, 'GET', '/api/resume/tex');
    assert.equal(res.status, 500);
    assert.ok(!res.text.includes('SECRET-PASSWORD'));
    assert.ok(!errorLines(spy).includes('SECRET-PASSWORD'));
  });
});

describe('GET /tex (real database, two users)', () => {
  before(async () => {
    await Profile.deleteMany({});
    const make = (secret) => ({
      basics: { name: `Name ${secret}`, email: '', phone: '', location: '', links: [] },
      summary: `Summary ${secret}`,
      education: [],
      experience: [
        {
          id: 'exp1',
          company: `Company ${secret}`,
          role: 'Engineer',
          dates: '',
          bullets: [{ id: 'exp1_b1', text: `Bullet ${secret}`, skills: [], alwaysInclude: false }],
        },
      ],
      projects: [],
      certifications: [],
      skills: { languages: [], frameworks: [], tools: [] },
    });
    await Profile.create({ userId: userA, ...make('ALPHA') });
    await Profile.create({ userId: userB, ...make('BRAVO') });
    // userC has no profile document at all.
  });

  test('each user gets only their own profile', async () => {
    const a = await call(dbBase, 'GET', '/api/resume/tex', { cookie: cookieFor(userA) });
    const b = await call(dbBase, 'GET', '/api/resume/tex', { cookie: cookieFor(userB) });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.ok(a.text.includes('Name ALPHA') && !a.text.includes('BRAVO'));
    assert.ok(b.text.includes('Name BRAVO') && !b.text.includes('ALPHA'));
  });

  test('a URL parameter cannot be used to read someone else\'s profile', async () => {
    const res = await call(dbBase, 'GET', `/api/resume/tex?userId=${userB}`, { cookie: cookieFor(userA) });
    assert.ok(res.text.includes('ALPHA'));
    assert.ok(!res.text.includes('BRAVO'));
  });

  test('a user with no profile gets 404', async () => {
    const res = await call(dbBase, 'GET', '/api/resume/tex', { cookie: cookieFor(userC) });
    assert.equal(res.status, 404);
  });

  test('a freshly created, still-empty profile gets 409', async () => {
    const fresh = new mongoose.Types.ObjectId().toString();
    await Profile.create({ userId: fresh });
    const res = await call(dbBase, 'GET', '/api/resume/tex', { cookie: cookieFor(fresh) });
    assert.equal(res.status, 409);
    assert.equal(res.json.code, 'empty_profile');
  });

  test('the Mongo-only fields (_id, userId, __v) never reach the document', async () => {
    const res = await call(dbBase, 'GET', '/api/resume/tex', { cookie: cookieFor(userA) });
    assert.ok(!res.text.includes(userA));
    assert.ok(!/__v|_id/.test(res.text));
  });
});

// ---------- one-page fit ----------

describe('POST /render: fitting one page', () => {
  // A resume with four bullets in one job. Lowest scores go first: b2, b4, b3. b1 is the last one standing.
  const bulletsResume = (alwaysInclude = []) => {
    const r = resume();
    r.experience[0].bullets = [
      ['b1', 'Bullet alpha'], ['b2', 'Bullet bravo'], ['b3', 'Bullet charlie'], ['b4', 'Bullet delta'],
    ].map(([id, text]) => ({ id, text, skills: [], alwaysInclude: alwaysInclude.includes(id) }));
    return r;
  };
  const SCORES = { b1: 9, b2: 1, b3: 5, b4: 2 };
  const send = (body, base = fitBase) => call(base, 'POST', '/api/resume/render', { json: body });
  const report = (res) => ({
    pages: res.headers.get('x-resume-pages'),
    dropped: res.headers.get('x-resume-dropped'),
    fit: res.headers.get('x-resume-fit'),
  });

  test('a resume that fits: one build, nothing dropped, and the report says so', async () => {
    pagesQueue = [1];
    const res = await send({ resumeJson: bulletsResume(), scores: SCORES });
    assert.equal(res.status, 200);
    assert.deepEqual(report(res), { pages: '1', dropped: '', fit: 'fits' });
    assert.equal(compileCalls.length, 1);
    assert.ok(res.buffer.equals(PDF_BODY));
  });

  test('too long: the lowest-scored bullets are dropped one at a time and the report names them', async () => {
    pagesQueue = [2, 2, 1];
    const res = await send({ resumeJson: bulletsResume(), scores: SCORES });
    assert.equal(res.status, 200);
    assert.deepEqual(report(res), { pages: '1', dropped: 'b2,b4', fit: 'fits' });
    assert.equal(compileCalls.length, 3);
    // the last build is the smaller resume; the first build had everything
    assert.ok(compileCalls[0].includes('Bullet bravo') && compileCalls[0].includes('Bullet delta'));
    assert.ok(!compileCalls[2].includes('Bullet bravo') && !compileCalls[2].includes('Bullet delta'));
    assert.ok(compileCalls[2].includes('Bullet alpha') && compileCalls[2].includes('Bullet charlie'));
    assert.ok(res.buffer.equals(PDF_BODY));
  });

  test('never fits: three drops at most, then the last PDF is returned anyway, marked too_long', async () => {
    pagesQueue = [2];
    const res = await send({ resumeJson: bulletsResume(), scores: SCORES });
    assert.equal(res.status, 200);
    assert.deepEqual(report(res), { pages: '2', dropped: 'b2,b4,b3', fit: 'too_long' });
    assert.equal(compileCalls.length, 4);
    assert.ok(res.buffer.equals(PDF_BODY));
  });

  test('without scores it drops from the bottom of the resume upwards', async () => {
    pagesQueue = [2, 1];
    const res = await send({ resumeJson: bulletsResume() });
    assert.deepEqual(report(res), { pages: '1', dropped: 'b4', fit: 'fits' });
  });

  test('a bullet marked alwaysInclude is never dropped', async () => {
    pagesQueue = [2];
    const res = await send({ resumeJson: bulletsResume(['b2']), scores: SCORES });
    assert.ok(!res.headers.get('x-resume-dropped').split(',').includes('b2'));
    assert.ok(compileCalls.every((source) => source.includes('Bullet bravo')));
  });

  test('a page count that cannot be read: the PDF is still returned, fit "unknown", no page header', async () => {
    pagesQueue = [new Error('unreadable')];
    const res = await send({ resumeJson: bulletsResume(), scores: SCORES });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-resume-fit'), 'unknown');
    assert.equal(res.headers.get('x-resume-pages'), null);
    assert.equal(compileCalls.length, 1);
  });

  test('the default page counter is real: an unreadable PDF means "unknown", not an error', async () => {
    const res = await call(base, 'POST', '/api/resume/render', { json: { resumeJson: bulletsResume() } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-resume-fit'), 'unknown');
  });

  test('a compile that fails on a rebuild gives the friendly 422, and no temp files are left', async () => {
    pagesQueue = [2];
    let n = 0;
    nextCompile = async () => {
      n += 1;
      if (n === 2) throw new CompileError('failed', { log: '! Undefined control sequence.\nl.3 \\x' });
      return okCompile();
    };
    const res = await send({ resumeJson: bulletsResume(), scores: SCORES });
    assert.equal(res.status, 422);
    assert.equal(res.json.code, 'compile_failed');
    // the first PDF was cleaned up: the afterEach hook fails this test if any job folder remains
  });

  test('the report headers only ever contain ids, digits, commas and fixed words', async () => {
    pagesQueue = [2];
    const r = bulletsResume();
    r.experience[0].bullets[1].id = 'weird-id_2';
    r.experience[0].bullets[1].text = 'Evil\r\nSet-Cookie: x=1';
    const res = await send({ resumeJson: r, scores: { 'weird-id_2': 0, b1: 9, b3: 5, b4: 2 } });
    assert.match(res.headers.get('x-resume-dropped'), /^[A-Za-z0-9_,-]*$/);
    assert.match(res.headers.get('x-resume-fit'), /^(fits|too_long|unknown)$/);
    assert.equal(res.headers.get('set-cookie'), null);
    assert.ok(res.headers.get('x-resume-dropped').startsWith('weird-id_2'));
  });

  describe('scores are validated', () => {
    const many = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`s${i}`, 1]));
    for (const [label, scores] of [
      ['a negative score', { b1: -1 }],
      ['a score that is not a number', { b1: 'high' }],
      ['a score above 1000', { b1: 1001 }],
      ['an id with illegal characters', { 'bad id!': 1 }],
      ['scores as a list', [1, 2, 3]],
      ['scores as a string', 'b1'],
      ['more than 200 scores', many],
    ]) {
      test(`refused: ${label}`, async () => {
        const res = await send({ resumeJson: bulletsResume(), scores });
        assert.equal(res.status, 400);
        assert.equal(res.json.code, 'bad_resume');
        assert.equal(compileCalls.length, 0);
      });
    }
    test('scores for ids that are not in the resume are harmless', async () => {
      pagesQueue = [1];
      assert.equal((await send({ resumeJson: bulletsResume(), scores: { nobody: 5 } })).status, 200);
    });
  });

  test('the whole fit loop holds ONE concurrency slot: a second request is refused while it rebuilds', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    pagesQueue = [2, 1];
    let n = 0;
    nextCompile = async () => {
      n += 1;
      if (n === 2) await gate; // the rebuild is in progress
      return okCompile();
    };
    const first = send({ resumeJson: bulletsResume(), scores: SCORES }, fitBusyBase);
    await waitFor(() => compileCalls.length === 2);

    const second = await send({ resumeJson: bulletsResume() }, fitBusyBase);
    assert.equal(second.status, 503);
    assert.equal(second.json.code, 'busy');

    release();
    const done = await first;
    assert.equal(done.status, 200);
    assert.equal(done.headers.get('x-resume-fit'), 'fits');
  });

  test('CORS lets the browser read the report headers', async () => {
    const res = await fetch(`${appBase}/api/resume/tex`, { headers: { origin: 'http://localhost:5173' } });
    assert.equal(res.status, 401);
    const exposed = (res.headers.get('access-control-expose-headers') ?? '').toLowerCase();
    for (const name of ['x-resume-pages', 'x-resume-dropped', 'x-resume-fit']) assert.ok(exposed.includes(name), name);
  });
});
