import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { callLLM } from '../src/llm/index.js';
import { LLMError, httpError } from '../src/llm/errors.js';
import { ORDER } from '../src/llm/routes.js';

// Small example schema: the shape we ask the "model" to return.
const schema = z.object({ answer: z.number() });
const GOOD = '{"answer":5}';
const input = { task: 'parse', system: 'reply with JSON', user: 'what is 2 + 3?', schema };

// A mocked provider. `byModel` maps a model id to what generate() does for that model:
// a string (returned), an Error (thrown) or a function (called with the args).
// One mocked "gemini" serves two routes, just like the real adapter does.
function mockProvider(byModel) {
  const calls = [];
  return {
    calls,
    isConfigured: () => true,
    async generate(args) {
      calls.push(args.model);
      const step = byModel[args.model];
      if (typeof step === 'function') return step(args);
      if (step instanceof Error) throw step;
      return step;
    },
  };
}

// Hangs until the router aborts it, like a stalled network request.
const hangUntilAborted = ({ signal }) =>
  new Promise((_, reject) =>
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
  );

// Real production order (ORDER), fake model ids, fast timeout, captured logs.
function setup({ gemini, groq }) {
  const logs = [];
  return {
    logs,
    deps: {
      providers: { gemini, groq },
      routes: {
        gemini_flash: { provider: 'gemini', model: 'flash' },
        gemini_flash_lite: { provider: 'gemini', model: 'flash-lite' },
        groq: { provider: 'groq', model: 'groq-model' },
      },
      order: ORDER,
      timeoutMs: 40,
      log: (e) => logs.push(e),
    },
  };
}

test('parse: first provider times out, falls back to groq', async () => {
  const gemini = mockProvider({ flash: hangUntilAborted, 'flash-lite': GOOD });
  const groq = mockProvider({ 'groq-model': GOOD });
  const { deps, logs } = setup({ gemini, groq });

  const out = await callLLM(input, deps);

  assert.deepEqual(out.data, { answer: 5 });
  assert.equal(out.provider, 'groq');
  assert.deepEqual(gemini.calls, ['flash']); // tried once, flash-lite never needed
  assert.deepEqual(groq.calls, ['groq-model']);
  assert.equal(logs[0].route, 'gemini_flash');
  assert.equal(logs[0].kind, 'timeout');
});

test('parse: first provider returns 429, falls back to groq', async () => {
  const gemini = mockProvider({ flash: httpError(429), 'flash-lite': GOOD });
  const groq = mockProvider({ 'groq-model': GOOD });
  const { deps, logs } = setup({ gemini, groq });

  const out = await callLLM(input, deps);

  assert.equal(out.provider, 'groq');
  assert.deepEqual(gemini.calls, ['flash']);
  assert.equal(logs[0].kind, 'rate_limit');
  assert.equal(logs[0].status, 429);
});

test('parse: first provider returns invalid JSON, falls back without retrying it', async () => {
  const gemini = mockProvider({ flash: 'Sure! Here is your answer: five', 'flash-lite': GOOD });
  const groq = mockProvider({ 'groq-model': GOOD });
  const { deps, logs } = setup({ gemini, groq });

  const out = await callLLM(input, deps);

  assert.equal(out.provider, 'groq');
  assert.deepEqual(gemini.calls, ['flash']); // exactly one call: invalid JSON is not retried
  assert.equal(logs[0].kind, 'invalid_json');
});

test('rewrite: groq 429 (token cap) falls back to gemini flash first', async () => {
  const gemini = mockProvider({ flash: GOOD, 'flash-lite': GOOD });
  const groq = mockProvider({ 'groq-model': httpError(429) });
  const { deps } = setup({ gemini, groq });

  const out = await callLLM({ ...input, task: 'rewrite' }, deps);

  assert.equal(out.provider, 'gemini_flash');
  assert.deepEqual(groq.calls, ['groq-model']);
  assert.deepEqual(gemini.calls, ['flash']);
});

test('all providers fail: tries every route in order, then throws a typed all_failed', async () => {
  const gemini = mockProvider({ flash: httpError(429), 'flash-lite': httpError(500) });
  const groq = mockProvider({ 'groq-model': hangUntilAborted });
  const { deps, logs } = setup({ gemini, groq });

  await assert.rejects(callLLM(input, deps), (err) => {
    assert.ok(err instanceof LLMError);
    assert.equal(err.kind, 'all_failed');
    assert.deepEqual(err.causes, [
      { route: 'gemini_flash', kind: 'rate_limit', status: 429 },
      { route: 'groq', kind: 'timeout', status: undefined },
      { route: 'gemini_flash_lite', kind: 'server', status: 500 },
    ]);
    return true;
  });

  assert.equal(logs.length, 3);
  assert.ok(logs.every((l) => l.ok === false));
});
