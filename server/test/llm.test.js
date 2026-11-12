import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { callLLM } from '../src/llm/index.js';
import { LLMError, httpError } from '../src/llm/errors.js';
import { parseModelJson } from '../src/llm/json.js';
import { ORDER } from '../src/llm/routes.js';

// A fake provider: `script` is a list of steps, one per generate() call.
// A step is a string (returned), an Error (thrown) or a function (called with the args).
function fake(script, { configured = true } = {}) {
  const calls = [];
  return {
    calls,
    isConfigured: () => configured,
    async generate(args) {
      calls.push(args);
      const step = script[Math.min(calls.length - 1, script.length - 1)];
      if (typeof step === 'function') return step(args);
      if (step instanceof Error) throw step;
      return step;
    },
  };
}

const schema = z.object({ n: z.number() });
const GOOD = '{"n":1}';
const silent = () => {};

// Two routes on two fake providers; order for task "t" is a then b.
function setup(a, b, extra = {}) {
  return {
    providers: { pa: a, pb: b },
    routes: { a: { provider: 'pa', model: 'ma' }, b: { provider: 'pb', model: 'mb' } },
    order: { t: ['a', 'b'] },
    timeoutMs: 50,
    log: silent,
    ...extra,
  };
}
const input = { task: 't', system: 'sys', user: 'usr', schema };

test('first route succeeds: returns data, provider and ms', async () => {
  const a = fake([GOOD]);
  const b = fake([GOOD]);
  const out = await callLLM(input, setup(a, b));
  assert.deepEqual(out.data, { n: 1 });
  assert.equal(out.provider, 'a');
  assert.equal(typeof out.ms, 'number');
  assert.equal(b.calls.length, 0);
  assert.equal(a.calls[0].model, 'ma');
});

test('fenced JSON is accepted', async () => {
  const out = await callLLM(input, setup(fake(['```json\n{"n":1}\n```']), fake([GOOD])));
  assert.equal(out.provider, 'a');
});

test('timeout falls back (provider honors the abort signal)', async () => {
  const hang = fake([
    ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')))),
  ]);
  const out = await callLLM(input, setup(hang, fake([GOOD])));
  assert.equal(out.provider, 'b');
});

test('timeout falls back even if the provider ignores the signal', async () => {
  const stuck = fake([() => new Promise(() => {})]);
  const out = await callLLM(input, setup(stuck, fake([GOOD])));
  assert.equal(out.provider, 'b');
});

for (const status of [429, 500, 503, 401, 400]) {
  test(`HTTP ${status} falls back`, async () => {
    const out = await callLLM(input, setup(fake([httpError(status)]), fake([GOOD])));
    assert.equal(out.provider, 'b');
  });
}

test('raw network error and unexpected bug both fall back, never throw', async () => {
  let out = await callLLM(input, setup(fake([new TypeError('fetch failed')]), fake([GOOD])));
  assert.equal(out.provider, 'b');
  out = await callLLM(input, setup(fake([new RangeError('bug in adapter')]), fake([GOOD])));
  assert.equal(out.provider, 'b');
});

test('empty output falls back', async () => {
  const out = await callLLM(input, setup(fake(['   ']), fake([GOOD])));
  assert.equal(out.provider, 'b');
});

test('invalid JSON falls back without a retry', async () => {
  const a = fake(['not json at all']);
  const out = await callLLM(input, setup(a, fake([GOOD])));
  assert.equal(out.provider, 'b');
  assert.equal(a.calls.length, 1);
});

test('zod failure retries once on the same route and includes the validation error', async () => {
  const a = fake(['{"n":"oops"}', GOOD]);
  const b = fake([GOOD]);
  const out = await callLLM(input, setup(a, b));
  assert.equal(out.provider, 'a');
  assert.equal(a.calls.length, 2);
  assert.equal(b.calls.length, 0);
  assert.match(a.calls[1].user, /failed validation/);
  assert.match(a.calls[1].user, /- n:/); // the path of the bad field
  assert.ok(a.calls[1].user.startsWith('usr')); // original prompt is kept
});

test('zod failure twice falls back to the next route', async () => {
  const a = fake(['{"n":"x"}']);
  const out = await callLLM(input, setup(a, fake([GOOD])));
  assert.equal(out.provider, 'b');
  assert.equal(a.calls.length, 2);
});

test('all routes failing throws a typed all_failed with causes', async () => {
  await assert.rejects(
    callLLM(input, setup(fake([httpError(429)]), fake([httpError(500)]))),
    (err) => {
      assert.ok(err instanceof LLMError);
      assert.equal(err.kind, 'all_failed');
      assert.deepEqual(err.causes, [
        { route: 'a', kind: 'rate_limit', status: 429 },
        { route: 'b', kind: 'server', status: 500 },
      ]);
      return true;
    },
  );
});

test('routes without a key or without a model id are skipped', async () => {
  const a = fake([GOOD], { configured: false });
  const b = fake([GOOD]);
  const deps = setup(a, b);
  assert.equal((await callLLM(input, deps)).provider, 'b');
  assert.equal(a.calls.length, 0);

  deps.routes.b.model = ''; // empty MODELS entry
  await assert.rejects(callLLM(input, deps), (err) => err.kind === 'no_provider');
});

test('unknown task throws', async () => {
  await assert.rejects(callLLM({ ...input, task: 'nope' }, setup(fake([GOOD]), fake([GOOD]))), (err) => err.kind === 'unknown_task');
});

test('logs contain route, outcome and latency but never prompts or replies', async () => {
  const lines = [];
  const SECRET = 'SECRET-RESUME-TEXT';
  await callLLM(
    { ...input, user: SECRET },
    setup(fake([`{"n":"${SECRET}"}`]), fake([GOOD]), { log: (e) => lines.push(JSON.stringify(e)) }),
  );
  const all = lines.join('\n');
  assert.match(all, /"route":"a"/);
  assert.match(all, /"ms":/);
  assert.ok(!all.includes(SECRET));
});

test('LLMError messages are only the kind', () => {
  assert.equal(httpError(429).message, 'rate_limit');
  assert.equal(httpError(503).kind, 'server');
  assert.equal(httpError(403).kind, 'auth');
  assert.equal(httpError(400).kind, 'bad_request');
});

test('route order per task kind is exactly as specified', () => {
  assert.deepEqual(ORDER.parse, ['gemini_flash', 'groq', 'gemini_flash_lite']);
  assert.deepEqual(ORDER.rewrite, ['groq', 'gemini_flash', 'gemini_flash_lite']);
});

test('parseModelJson strips fences and rejects non-JSON', () => {
  assert.deepEqual(parseModelJson(' ```json\n{"a":1}\n``` '), { a: 1 });
  assert.throws(() => parseModelJson('hello'), SyntaxError);
});
