import { config } from '../config.js';
import { LLMError } from './errors.js';
import { parseModelJson } from './json.js';
import { PROVIDERS, ROUTES, ORDER } from './routes.js';

// Log route, task, outcome and latency only. Never prompts, responses, headers or keys.
function defaultLog(e) {
  const status = e.status ? ` status=${e.status}` : '';
  const kind = e.kind ? ` kind=${e.kind}` : '';
  console.log(`[llm] route=${e.route} task=${e.task} ${e.ok ? 'ok' : 'fail'}${kind}${status} ms=${e.ms}`);
}

// Whatever went wrong becomes an LLMError, so the loop can always fall back.
function toLLMError(err, route) {
  if (err instanceof LLMError) return new LLMError(err.kind, { route, status: err.status });
  if (err?.name === 'AbortError') return new LLMError('timeout', { route });
  if (err instanceof TypeError) return new LLMError('network', { route }); // fetch() failed
  return new LLMError('unexpected', { route });
}

// One request with a hard timeout. The timer covers the headers AND the body read, and the race
// guarantees we stop waiting even if an adapter ignores the abort signal.
async function attempt(provider, args, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new LLMError('timeout'));
    }, timeoutMs);
  });
  // If the timeout wins, the request promise may reject later (AbortError). Swallow that so
  // it can never surface as an unhandled rejection.
  const work = Promise.resolve().then(() => provider.generate({ ...args, signal: controller.signal }));
  work.catch(() => {});
  try {
    const text = await Promise.race([work, timeout]);
    if (typeof text !== 'string' || !text.trim()) throw new LLMError('empty');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// Paths and messages only (never the offending values), short enough to resend safely.
function describeIssues(error) {
  const lines = error.issues
    .slice(0, 10)
    .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`);
  return lines.join('\n').slice(0, 1000);
}

function parseJson(text) {
  try {
    return parseModelJson(text);
  } catch {
    throw new LLMError('invalid_json');
  }
}

// One route: ask, parse, validate. If the JSON parses but fails zod, ask once more on the same
// route and include the validation error. Unparseable JSON is not retried; it falls back.
async function runRoute(provider, model, { system, user, schema, maxTokens }, timeoutMs) {
  const base = { model, system, maxTokens };

  const text = await attempt(provider, { ...base, user }, timeoutMs);
  const first = schema.safeParse(parseJson(text));
  if (first.success) return first.data;

  const retryUser =
    `${user}\n\nYour previous reply was:\n${text.slice(0, 4000)}\n\n` +
    `It failed validation:\n${describeIssues(first.error)}\n\n` +
    'Reply again with corrected JSON only.';
  const retryText = await attempt(provider, { ...base, user: retryUser }, timeoutMs);
  const second = schema.safeParse(parseJson(retryText));
  if (second.success) return second.data;

  throw new LLMError('schema');
}

// The only door to an LLM. Walks the task's routes in order and returns the first valid result:
//   { data, provider, ms }   provider = route name (e.g. "groq"), ms = total time of this call
// Provider failures never escape as raw exceptions; each becomes a fallback. If every route
// fails it throws a typed LLMError ('all_failed' or 'no_provider') for the caller to handle.
// `deps` lets tests swap providers, routes, order, timeout and logger.
export async function callLLM({ task, system, user, schema, maxTokens }, deps = {}) {
  const providers = deps.providers ?? PROVIDERS;
  const routes = deps.routes ?? ROUTES;
  const order = deps.order ?? ORDER;
  const timeoutMs = deps.timeoutMs ?? config.llm.timeoutMs;
  const log = deps.log ?? defaultLog;

  const names = order[task];
  if (!names) throw new LLMError('unknown_task');

  const started = Date.now();
  const causes = [];

  for (const route of names) {
    const { provider: providerName, model } = routes[route] ?? {};
    const provider = providers[providerName];
    // No key or no model id in MODELS: skip quietly.
    if (!provider || !model || !provider.isConfigured()) continue;

    const t0 = Date.now();
    try {
      const data = await runRoute(provider, model, { system, user, schema, maxTokens }, timeoutMs);
      log({ route, task, ok: true, ms: Date.now() - t0 });
      return { data, provider: route, ms: Date.now() - started };
    } catch (err) {
      const e = toLLMError(err, route);
      causes.push({ route, kind: e.kind, status: e.status });
      log({ route, task, ok: false, kind: e.kind, status: e.status, ms: Date.now() - t0 });
    }
  }

  throw new LLMError(causes.length ? 'all_failed' : 'no_provider', { causes });
}
