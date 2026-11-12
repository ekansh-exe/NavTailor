// Tests for compileTex(). A fake program (test/helpers/fakeTectonic.mjs) stands in for Tectonic,
// so everything except the real engine is covered here: arguments, environment, timeout, log
// scrubbing, output caps, cleanup. The real-Tectonic test at the bottom skips itself when it is missing.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileTex, tectonicArgs, CompileError } from '../src/latex/compile.js';

const FAKE = fileURLToPath(new URL('./helpers/fakeTectonic.mjs', import.meta.url));
// Run the fake with node, inside a private temp root so the tests can see exactly what is left behind.
let root;
before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'navtailor-test-root-'));
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

const fake = (extra = {}) => ({ command: process.execPath, argsPrefix: [FAKE], tmpRoot: root, timeoutMs: 10_000, ...extra });
const leftovers = () => fs.readdirSync(root).filter((name) => name.startsWith('navtailor-'));
const attempt = async (promise) => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  assert.fail('expected a rejection');
};

describe('compileTex: success', () => {
  test('returns an existing PDF and removes the folder on cleanup()', async () => {
    const { pdfPath, cleanup } = await compileTex('%MODE:ok', fake());
    assert.ok(fs.existsSync(pdfPath));
    assert.equal(fs.readFileSync(pdfPath, 'latin1').slice(0, 4), '%PDF');
    assert.equal(leftovers().length, 1);
    await cleanup();
    assert.equal(fs.existsSync(pdfPath), false);
    assert.equal(leftovers().length, 0);
  });

  test('cleanup() can be called twice without throwing', async () => {
    const { cleanup } = await compileTex('%MODE:ok', fake());
    await cleanup();
    await cleanup();
  });

  test('every compile gets its own folder', async () => {
    const a = await compileTex('%MODE:ok', fake());
    const b = await compileTex('%MODE:ok', fake());
    assert.notEqual(path.dirname(a.pdfPath), path.dirname(b.pdfPath));
    await Promise.all([a.cleanup(), b.cleanup()]);
  });
});

describe('compileTex: arguments and environment', () => {
  test('shell-escape is never enabled and --untrusted is always passed', async () => {
    const { pdfPath, cleanup } = await compileTex('%MODE:ok', fake());
    const args = JSON.parse(/%ARGS:(.*)/.exec(fs.readFileSync(pdfPath, 'utf8'))[1]);
    await cleanup();
    assert.ok(args.includes('--untrusted'));
    assert.ok(!args.some((a) => /shell-escape/i.test(a)), 'shell-escape flag found');
    assert.ok(!args.includes('-Z'));
    assert.deepEqual(args.slice(args.indexOf('-X'), args.indexOf('-X') + 2), ['-X', 'compile']);
    assert.equal(args.at(-1), 'main.tex');
  });

  test('tectonicArgs has no shell-escape flag for any folder name', () => {
    for (const dir of ['/tmp/a', '/tmp/shell-escape', '/tmp/a b']) {
      assert.ok(!tectonicArgs(dir).some((a) => a === '-Z' || a === '--shell-escape'));
    }
  });

  test('the resume text never appears in the arguments (only generated paths do)', async () => {
    const { pdfPath, cleanup } = await compileTex('%MODE:ok\n\\input{/etc/passwd} SECRET-RESUME-TEXT', fake());
    const content = fs.readFileSync(pdfPath, 'utf8');
    await cleanup();
    assert.ok(!/%ARGS:.*SECRET-RESUME-TEXT/.test(content));
    assert.ok(!/%ARGS:.*passwd/.test(content));
  });

  test('the child process does not see server secrets', async () => {
    const saved = { ...process.env };
    Object.assign(process.env, {
      JWT_SECRET: 'x', MONGODB_URI: 'y', GEMINI_API_KEY: 'z', GROQ_API_KEY: 'w', GOOGLE_CLIENT_ID: 'v',
    });
    try {
      const { pdfPath, cleanup } = await compileTex('%MODE:ok', fake());
      const names = JSON.parse(/%ENV:(.*)/.exec(fs.readFileSync(pdfPath, 'utf8'))[1]);
      await cleanup();
      for (const secret of ['JWT_SECRET', 'MONGODB_URI', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'GOOGLE_CLIENT_ID']) {
        assert.ok(!names.includes(secret), `${secret} leaked to the child`);
      }
      assert.ok(names.includes('PATH'));
    } finally {
      for (const key of ['JWT_SECRET', 'MONGODB_URI', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'GOOGLE_CLIENT_ID']) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  });

  test('the program runs inside its own temp folder', async () => {
    const { pdfPath, cleanup } = await compileTex('%MODE:ok', fake());
    const cwd = /%CWD:(.*)/.exec(fs.readFileSync(pdfPath, 'utf8'))[1];
    await cleanup();
    assert.ok(path.basename(cwd).startsWith('navtailor-'));
    assert.equal(path.dirname(cwd), fs.realpathSync(root));
  });
});

describe('compileTex: failures', () => {
  test('a failed compile throws CompileError("failed") with the TeX log, and leaves nothing behind', async () => {
    const err = await attempt(compileTex('%MODE:fail', fake()));
    assert.ok(err instanceof CompileError);
    assert.equal(err.kind, 'failed');
    assert.match(err.log, /! Undefined control sequence\./);
    assert.match(err.log, /l\.7 \\foo/);
    assert.equal(leftovers().length, 0);
  });

  test('the log never contains the temp folder path', async () => {
    const err = await attempt(compileTex('%MODE:fail', fake()));
    assert.ok(!err.log.includes(root), err.log);
    assert.ok(!err.log.includes(fs.realpathSync(root)), err.log);
    assert.match(err.log, /running in <tmp>/);
  });

  test('without a log file the engine output is used', async () => {
    const err = await attempt(compileTex('%MODE:stderronly', fake()));
    assert.equal(err.kind, 'failed');
    assert.match(err.log, /error: main\.tex:3: Undefined control sequence/);
  });

  test('exit code 0 without a PDF is still a failure', async () => {
    const err = await attempt(compileTex('%MODE:nopdf', fake()));
    assert.equal(err.kind, 'failed');
    assert.equal(leftovers().length, 0);
  });

  test('a program that floods its output cannot make the log huge', async () => {
    const err = await attempt(compileTex('%MODE:flood', fake()));
    assert.equal(err.kind, 'failed');
    assert.ok(err.log.length <= 70 * 1024, `log is ${err.log.length} characters`);
  });

  test('a program that is not installed gives kind "unavailable" and leaves nothing behind', async () => {
    const err = await attempt(compileTex('%MODE:ok', { command: 'definitely-not-installed-navtailor', tmpRoot: root }));
    assert.ok(err instanceof CompileError);
    assert.equal(err.kind, 'unavailable');
    assert.equal(leftovers().length, 0);
  });

  test('the error message is only the kind, and the log is a hidden property', async () => {
    const err = await attempt(compileTex('%MODE:fail', fake()));
    assert.equal(err.message, 'failed');
    assert.ok(!Object.keys(err).includes('log'));
    assert.ok(!JSON.stringify(err).includes('Undefined control sequence'));
  });

  test('empty or non-string source is refused before anything is started', async () => {
    for (const bad of ['', null, undefined, 42, {}]) {
      const err = await attempt(compileTex(bad, fake()));
      assert.ok(err instanceof TypeError);
    }
    assert.equal(leftovers().length, 0);
  });
});

describe('compileTex: timeout', () => {
  test('a hanging program is killed and reported as "timeout"', async () => {
    const started = Date.now();
    const err = await attempt(compileTex('%MODE:hang', fake({ timeoutMs: 400 })));
    assert.equal(err.kind, 'timeout');
    assert.ok(Date.now() - started < 5000, 'did not stop in time');
    assert.equal(leftovers().length, 0);

    // The fake printed its process id; that process must really be gone.
    const pid = Number(/PID:(\d+)/.exec(err.log)?.[1]);
    assert.ok(pid > 0, `no pid in log: ${err.log}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  });
});

// ---------- optional: the real engine ----------

function realTectonic() {
  const help = spawnSync('tectonic', ['-X', 'compile', '--help'], { encoding: 'utf8' });
  return !help.error && help.status === 0 && /--untrusted/.test(help.stdout) && /--keep-logs/.test(help.stdout);
}
const hasTectonic = realTectonic();
const skip = hasTectonic ? false : 'tectonic is not installed (or lacks --untrusted / --keep-logs)';

describe('real Tectonic', () => {
  test('a valid document compiles to a PDF', { skip }, async () => {
    const { pdfPath, cleanup } = await compileTex('\\documentclass{article}\\begin{document}Hello\\end{document}', { tmpRoot: root });
    assert.equal(fs.readFileSync(pdfPath).subarray(0, 4).toString('latin1'), '%PDF');
    await cleanup();
  });

  test('a broken document fails with a readable log', { skip }, async () => {
    const err = await attempt(compileTex('\\documentclass{article}\\begin{document}\\nosuchcommand\\end{document}', { tmpRoot: root }));
    assert.equal(err.kind, 'failed');
    assert.match(err.log, /Undefined control sequence|nosuchcommand/);
    assert.ok(!err.log.includes(root));
  });

  test('CONTROL: \\write18 DOES run when shell-escape is switched on, so the next test proves something', { skip }, () => {
    const dir = fs.mkdtempSync(path.join(root, 'control-'));
    fs.writeFileSync(path.join(dir, 'main.tex'), '\\documentclass{article}\\begin{document}\\immediate\\write18{touch PWNED}hi\\end{document}');
    // The flags compileTex must NEVER pass: -Z shell-escape-cwd turns \\write18 on.
    spawnSync('tectonic', ['-X', 'compile', '-Z', 'shell-escape-cwd=.', '--outdir', '.', 'main.tex'], { cwd: dir, timeout: 120_000 });
    assert.equal(fs.existsSync(path.join(dir, 'PWNED')), true, 'the exploit does not work even without --untrusted, so the test below would prove nothing');
  });

  test('\\write18 does not run a shell command through compileTex (--untrusted)', { skip, timeout: 120_000 }, async () => {
    // The work folder is a child of `root`, so "../PWNED" lands in `root` and survives the cleanup.
    const source = '\\documentclass{article}\\begin{document}\\immediate\\write18{touch ../PWNED}hi\\end{document}';
    await compileTex(source, { tmpRoot: root, timeoutMs: 120_000 }).then((r) => r.cleanup(), () => {});
    assert.equal(fs.existsSync(path.join(root, 'PWNED')), false, 'shell command ran');
  });
});
