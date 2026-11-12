import { Worker } from 'node:worker_threads';

// Pulls plain text out of a PDF or DOCX buffer, inside a worker thread with a hard timeout.
// Throws ExtractError with code: 'timeout' | 'unreadable' | 'zip_too_many_entries' | 'zip_too_big'.
// The message is only the code, so no file content can leak through an error or a log line.
export class ExtractError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ExtractError';
    this.code = code;
  }
}

const WORKER_URL = new URL('./extract.worker.js', import.meta.url);

export function extractText(kind, buffer, { timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    // Copy into a fresh ArrayBuffer: the worker gets its own data and cannot touch ours.
    const data = new Uint8Array(buffer).buffer;
    const worker = new Worker(WORKER_URL, { workerData: { kind, data } });
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate(); // no-op if it already exited; stops a runaway parser otherwise
      fn(value);
    };

    const timer = setTimeout(() => finish(reject, new ExtractError('timeout')), timeoutMs);

    worker.once('message', (msg) =>
      msg.ok ? finish(resolve, String(msg.text ?? '')) : finish(reject, new ExtractError(msg.code)),
    );
    worker.once('error', () => finish(reject, new ExtractError('unreadable')));
    worker.once('exit', () => finish(reject, new ExtractError('unreadable')));
  });
}
