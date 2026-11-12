// Runs Tectonic on a .tex string and hands back the PDF file.
//
// Running Tectonic means starting another program (a child process), so every way that can go
// wrong has a guard:
//   hangs             -> hard timeout, then SIGKILL
//   text as a command -> spawn() with an argument array and shell:false. The only arguments are
//                        paths we create; nothing from the resume is ever an argument
//   shell-escape      -> --untrusted switches off every feature that can run commands, and we never
//                        pass -Z shell-escape. (escape.js already neutralises \write18 in the text;
//                        this is the second layer)
//   leaked secrets    -> the child gets a short allowlist of environment variables, not ours
//   leftover files    -> one fresh temp folder per compile, removed on every failure path and by cleanup()
//   huge output       -> captured output is capped
//
// The compile log can echo resume text, so it travels ONLY inside CompileError.log (a hidden
// property) and is never written to the console.

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const COMPILE_TIMEOUT_MS = 30_000;
const MAX_CAPTURE_BYTES = 64 * 1024;

// kinds: unavailable (Tectonic cannot be started) | timeout | failed (the compile itself failed)
// The message is just the kind. `log` is non-enumerable, so even console.error(err) cannot print it.
export class CompileError extends Error {
  constructor(kind, { log = '' } = {}) {
    super(kind);
    this.name = 'CompileError';
    this.kind = kind;
    Object.defineProperty(this, 'log', { value: log, enumerable: false });
  }
}

// What the child process may see. Deliberately NOT process.env: that holds JWT_SECRET,
// MONGODB_URI and the LLM keys. HOME and the cache variables are where Tectonic keeps its downloads.
const ENV_ALLOWLIST = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'TECTONIC_CACHE_DIR', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME'];
function childEnv() {
  const env = {};
  for (const key of ENV_ALLOWLIST) if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}

// The exact arguments, in one place so they are easy to review. No shell-escape flag, ever.
export function tectonicArgs(outdir) {
  return ['-X', 'compile', '--untrusted', '--keep-logs', '--outdir', outdir, 'main.tex'];
}

// Remove our temp folder and the home folder from a log, drop control characters.
async function scrubber(dir) {
  const secrets = new Set([dir, await fs.realpath(dir).catch(() => dir)]);
  const home = os.homedir();
  return (text) => {
    let out = String(text);
    for (const dirPath of secrets) out = out.split(dirPath).join('<tmp>');
    if (home && home.length > 1) out = out.split(home).join('~');
    return out.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');
  };
}

// Starts the process and waits for it. Resolves with how it ended; rejects only if it cannot start.
function runChild(command, args, { cwd, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: childEnv(), shell: false, stdio: ['ignore', 'pipe', 'pipe'] });

    const chunks = [];
    let captured = 0;
    // Keep draining the pipes after the cap so the child never blocks on a full pipe.
    const collect = (buf) => {
      if (captured >= MAX_CAPTURE_BYTES) return;
      const part = buf.subarray(0, MAX_CAPTURE_BYTES - captured);
      chunks.push(part);
      captured += part.length;
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    // "close" (not "exit") fires after every output byte has been read.
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut, output: Buffer.concat(chunks).toString('utf8') });
    });
  });
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

// The tail of the TeX log (that is where the errors are), capped.
async function readLogTail(file) {
  try {
    const buf = await fs.readFile(file);
    return buf.subarray(-MAX_CAPTURE_BYTES).toString('utf8');
  } catch {
    return '';
  }
}

// Returns { pdfPath, cleanup }. The caller MUST call cleanup() when it has finished with the PDF.
// On any failure the temp folder is already gone and a CompileError is thrown.
// Options exist so tests can use a fake program and a known temp root.
export async function compileTex(source, { timeoutMs = COMPILE_TIMEOUT_MS, command = 'tectonic', argsPrefix = [], tmpRoot = os.tmpdir() } = {}) {
  if (typeof source !== 'string' || !source) throw new TypeError('compileTex expects a non-empty string');

  const dir = await fs.mkdtemp(path.join(tmpRoot, 'navtailor-'));
  const cleanup = () => fs.rm(dir, { recursive: true, force: true }).catch(() => {});

  try {
    const scrub = await scrubber(dir);
    await fs.writeFile(path.join(dir, 'main.tex'), source, 'utf8');

    let run;
    try {
      run = await runChild(command, [...argsPrefix, ...tectonicArgs(dir)], { cwd: dir, timeoutMs });
    } catch (err) {
      // ENOENT: not installed. EACCES: not executable. Either way we cannot compile here.
      if (err?.code === 'ENOENT' || err?.code === 'EACCES') throw new CompileError('unavailable');
      throw new CompileError('failed');
    }

    if (run.timedOut) throw new CompileError('timeout', { log: scrub(run.output) });

    const pdfPath = path.join(dir, 'main.pdf');
    if (run.code === 0 && (await exists(pdfPath))) return { pdfPath, cleanup };

    // Failed (or "succeeded" without a PDF). Collect the TeX log plus whatever the engine printed.
    const texLog = await readLogTail(path.join(dir, 'main.log'));
    const log = [texLog, run.output].filter(Boolean).join('\n--- engine output ---\n');
    throw new CompileError('failed', { log: scrub(log) });
  } catch (err) {
    await cleanup();
    throw err;
  }
}
