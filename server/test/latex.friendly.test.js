// Tests for explainCompileLog(): turning a TeX / Tectonic log into a friendly message.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { explainCompileLog } from '../src/latex/friendlyError.js';

const TEX_LOG = `This is XeTeX, Version 3.141592653
(./main.tex
(/<tmp>/article.cls)
! Undefined control sequence.
l.12 \\foo
            bar baz
?
! Misplaced alignment tab character &.
l.20 Cut costs by 40 &
                      saved
No pages of output.
`;

describe('TeX-style logs ("! message" then "l.<n>")', () => {
  const out = explainCompileLog(TEX_LOG);

  test('finds every error with its line number and the text near it', () => {
    assert.equal(out.details.length, 2);
    assert.equal(out.details[0].problem, 'Undefined control sequence.');
    assert.equal(out.details[0].line, 12);
    assert.equal(out.details[0].near, '\\foo');
    assert.equal(out.details[1].line, 20);
    assert.equal(out.details[1].near, 'Cut costs by 40 &');
  });

  test('each problem gets a plain-English sentence', () => {
    assert.match(out.details[0].summary, /command it does not know/);
    assert.match(out.details[1].summary, /"&"/);
  });

  test('the message is one friendly sentence naming the first problem and its line', () => {
    assert.match(out.message, /^We could not build your PDF\. LaTeX ran into a command it does not know\. \(near line 12/);
  });

  test('the log excerpt starts just before the first error, not at the top', () => {
    // A real log has a long package-loading preamble before the first error.
    const noise = Array.from({ length: 30 }, (_, i) => `(/<tmp>/package${i}.sty)`).join('\n');
    const long = explainCompileLog(`This is XeTeX\n${noise}\n! Undefined control sequence.\nl.12 \\foo\n`);
    assert.ok(long.log.includes('! Undefined control sequence.'));
    assert.ok(!long.log.includes('This is XeTeX'));
    assert.ok(!long.log.includes('package0.sty'));
    assert.ok(long.log.includes('package29.sty')); // the few lines of context just before the error
    assert.ok(out.log.includes('! Undefined control sequence.'));
  });
});

describe('Tectonic-style logs ("error: file:line: message")', () => {
  test('are understood, and the generic "halted" line is dropped when something specific exists', () => {
    const out = explainCompileLog(
      'note: running TeX ...\nerror: main.tex:7: Missing $ inserted\nerror: halted on potentially-recoverable error as specified\n',
    );
    assert.equal(out.details.length, 1);
    assert.equal(out.details[0].line, 7);
    assert.match(out.details[0].summary, /math symbol/);
  });

  test('the "halted" line alone is kept', () => {
    const out = explainCompileLog('error: halted on potentially-recoverable error as specified');
    assert.equal(out.details.length, 1);
    assert.match(out.details[0].summary, /earlier error/);
  });
});

describe('problems on the server side are not blamed on the resume', () => {
  test('a missing package says so', () => {
    const out = explainCompileLog("! LaTeX Error: File `titlesec.sty' not found.\nl.4 \\usepackage{titlesec}");
    assert.equal(out.details[0].affects, 'server');
    assert.match(out.message, /problem on our side, not with your resume/);
  });
  test('a failed download says so', () => {
    const out = explainCompileLog('error: failed to download: could not resolve host: relay.fullyjustified.net');
    assert.equal(out.details[0].affects, 'server');
    assert.match(out.message, /on our side/);
  });
  test('a document error mixed with a server error blames the document first', () => {
    const out = explainCompileLog("! Undefined control sequence.\nl.3 \\x\n! LaTeX Error: File `a.sty' not found.\nl.4 y");
    assert.equal(out.details[0].affects, 'document');
    assert.match(out.message, /command it does not know/);
  });
});

describe('the common TeX messages are all explained', () => {
  for (const [problem, expected] of [
    ['Undefined control sequence.', /command it does not know/],
    ['Misplaced alignment tab character &.', /"&"/],
    ['Missing $ inserted.', /math symbol/],
    ['Paragraph ended before \\textbf was complete.', /blank line/],
    ["Too many }'s.", /braces/],
    ['Extra }, or forgotten $.', /braces/],
    ['Runaway argument?', /braces/],
    ['File ended while scanning use of \\@argdef.', /braces/],
    ['Emergency stop.', /earlier error/],
    ['Something nobody has seen before.', /could not recover/],
  ]) {
    test(problem, () => {
      assert.match(explainCompileLog(`! ${problem}\nl.1 x`).details[0].summary, expected);
    });
  }
  test('"no pages of output" is explained as an empty resume', () => {
    assert.match(explainCompileLog('! Emergency stop.\nNo pages of output.').details[0].summary, /earlier error/);
    assert.match(explainCompileLog('! No pages of output.').details[0].summary, /no content/);
  });
});

describe('limits and odd input', () => {
  test('at most five problems are listed', () => {
    const log = Array.from({ length: 12 }, (_, i) => `! Undefined control sequence.\nl.${i + 1} \\x${i}`).join('\n');
    assert.equal(explainCompileLog(log).details.length, 5);
  });

  test('the same error on the same line is listed once', () => {
    const log = '! Undefined control sequence.\nl.4 \\x\n! Undefined control sequence.\nl.4 \\x';
    assert.equal(explainCompileLog(log).details.length, 1);
  });

  test('the text near an error is cut to 100 characters', () => {
    const out = explainCompileLog(`! Undefined control sequence.\nl.1 ${'a'.repeat(500)}`);
    assert.equal(out.details[0].near.length, 100);
  });

  test('the log excerpt is capped at 6000 characters', () => {
    const out = explainCompileLog(`! Undefined control sequence.\nl.1 x\n${'y'.repeat(50_000)}`);
    assert.ok(out.log.length <= 6000);
    const noError = explainCompileLog('z'.repeat(50_000));
    assert.ok(noError.log.length <= 6000);
  });

  test('a log without a recognisable error still gives a friendly message and the log tail', () => {
    const out = explainCompileLog('segmentation fault\nbye');
    assert.deepEqual(out.details, []);
    assert.match(out.message, /stopped without a readable error/);
    assert.ok(out.log.includes('segmentation fault'));
  });

  test('empty, missing and non-string logs never throw', () => {
    for (const bad of ['', '   ', null, undefined, 42, {}, [], Buffer.from('x')]) {
      const out = explainCompileLog(bad);
      assert.equal(typeof out.message, 'string');
      assert.ok(Array.isArray(out.details));
      assert.equal(typeof out.log, 'string');
    }
  });

  test('control characters and Windows line endings are cleaned', () => {
    const out = explainCompileLog('! Undefined control sequence.\r\nl.3 \u0000\u0007x\r\n');
    assert.equal(out.details[0].line, 3);
    assert.equal(out.details[0].near, 'x');
    assert.ok(!/[\u0000-\u0008]/.test(out.log));
  });

  test('a log made of hostile text is only ever returned as data', () => {
    const out = explainCompileLog('! <script>alert(1)</script>\nl.1 </pre><script>');
    assert.equal(typeof out.details[0].problem, 'string');
    assert.equal(out.details.length, 1);
  });
});

// A log captured from real Tectonic 0.17 compiling "\\nosuchcommand". The same error arrives three
// times (TeX style, Tectonic style, and generic engine lines) and must be reported once.
const REAL_TECTONIC_LOG = `LaTeX Font Info:    Checking defaults for U/cmr/m/n on input line 1.
LaTeX Font Info:    ... okay on input line 1.

! Undefined control sequence.
l.1 ...rticle}\\begin{document}Hello \\nosuchcommand
                                                   world & more\\end{document}
No pages of output.

--- engine output ---
note: "version 2" Tectonic command-line interface activated
note: Running TeX ...
error: main.tex:1: Undefined control sequence
note: Writing \`<tmp>/main.log\` (2.1494140625 KiB)
error: something bad happened inside XeTeX; its output follows:

===============================================================================

error: the XeTeX engine had an unrecoverable error
`;

describe('a real Tectonic log', () => {
  const out = explainCompileLog(REAL_TECTONIC_LOG);
  test('the one error is reported once, with its line and the text around it', () => {
    assert.equal(out.details.length, 1);
    assert.equal(out.details[0].problem, 'Undefined control sequence.');
    assert.equal(out.details[0].line, 1);
    assert.match(out.details[0].near, /\\nosuchcommand$/);
    assert.match(out.message, /command it does not know\. \(near line 1/);
  });
  test('the generic engine lines do not become extra problems', () => {
    assert.ok(!out.details.some((d) => /something bad happened|unrecoverable/i.test(d.problem)));
  });
  test('the same error in TeX style and Tectonic style is one entry, trailing full stop or not', () => {
    const log = '! Missing $ inserted.\nl.9 x_1\nerror: main.tex:9: Missing $ inserted';
    assert.equal(explainCompileLog(log).details.length, 1);
  });
  test('the generic engine lines alone are still reported (they are all we have)', () => {
    const only = explainCompileLog('error: something bad happened inside XeTeX; its output follows:');
    assert.equal(only.details.length, 1);
  });
});
