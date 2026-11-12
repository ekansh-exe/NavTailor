// A stand-in for `tectonic`, used only by tests. compileTex() runs it as:
//   node fakeTectonic.mjs -X compile --untrusted --keep-logs --outdir <dir> main.tex
// What it does depends on a marker in main.tex, e.g. "%MODE:fail".
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const outdir = args[args.indexOf('--outdir') + 1];
const source = fs.readFileSync('main.tex', 'utf8');
const mode = /%MODE:(\w+)/.exec(source)?.[1] ?? 'ok';

switch (mode) {
  case 'ok':
    // The "PDF" records what it was started with, so tests can inspect arguments and environment.
    fs.writeFileSync(
      path.join(outdir, 'main.pdf'),
      `%PDF-1.5\n%ARGS:${JSON.stringify(args)}\n%ENV:${JSON.stringify(Object.keys(process.env))}\n%CWD:${process.cwd()}\n%EOF\n`,
    );
    break;
  case 'fail':
    // Mentions the working folder, like the real engine does, so tests can check it is scrubbed.
    fs.writeFileSync(
      path.join(outdir, 'main.log'),
      `This is a fake TeX log\nrunning in ${process.cwd()}\n! Undefined control sequence.\nl.7 \\foo\n                  bar\n`,
    );
    process.exit(1);
    break;
  case 'stderronly':
    console.error('error: main.tex:3: Undefined control sequence');
    console.error('error: halted on potentially-recoverable error as specified');
    process.exit(1);
    break;
  case 'nopdf':
    process.exit(0);
    break;
  case 'flood':
    for (let i = 0; i < 80; i++) process.stdout.write('x'.repeat(64 * 1024));
    process.exit(1);
    break;
  case 'hang':
    console.error(`PID:${process.pid}`);
    setInterval(() => {}, 1000);
    break;
  default:
    process.exit(2);
}
