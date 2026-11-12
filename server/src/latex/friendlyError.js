// Turns a LaTeX compile log into something a person can read.
//
// A TeX log is long and technical, but the useful part has a fixed shape:
//     ! Undefined control sequence.        <- what went wrong
//     l.12 \foo bar                        <- the line it happened on, and the text around it
// Tectonic also summarises errors as "error: main.tex:12: Undefined control sequence".
// We read both. The input is already scrubbed of server paths (compile.js); this file only
// explains and trims. It never throws, whatever it is given.

const MAX_DETAILS = 5;
const MAX_LOG_CHARS = 6000;
const MAX_CONTEXT_CHARS = 100;

// [pattern, who is affected, plain-English sentence]
// 'document' = something in the resume content/layout. 'server' = the PDF engine itself
// (missing package, no network), which is not the user's fault.
const RULES = [
  [/Undefined control sequence/i, 'document', 'LaTeX ran into a command it does not know.'],
  [/Misplaced alignment tab/i, 'document', 'A "&" ended up somewhere LaTeX did not expect it.'],
  [/Missing \$ inserted/i, 'document', 'A math symbol ($, ^ or _) appeared in ordinary text.'],
  [/Paragraph ended before/i, 'document', 'A field contained a blank line where LaTeX needed a single line of text.'],
  [
    /Too many \}'s|Extra \}|Extra \{|Missing \} inserted|Missing \{ inserted|Runaway argument|File ended while scanning/i,
    'document',
    'Curly braces { } are unbalanced somewhere in the document.',
  ],
  [/No pages of output/i, 'document', 'The resume has no content to put on a page.'],
  [/Text line contains an invalid character|invalid UTF-?8/i, 'document', 'A character in the resume could not be read.'],
  [/File [`'"]?(.+?)['"]? not found|cannot find font|font .* not found|could not find/i, 'server', 'The PDF engine is missing a file it needs (a package or font).'],
  [/download|network|resolve host|connection|timed out|certificate/i, 'server', 'The PDF engine could not download something it needs.'],
  [/Emergency stop|Fatal error|halted on potentially-recoverable error/i, 'document', 'LaTeX stopped because of an earlier error.'],
];

const ENGINE_NOISE = /halted on potentially-recoverable error|something bad happened inside XeTeX|XeTeX engine had an unrecoverable error/i;

// Removes control characters (keeps newline and tab); safe to call on anything.
function clean(value) {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '') : '';
}

function explainOne(problem) {
  for (const [pattern, who, sentence] of RULES) {
    if (pattern.test(problem)) return { who, sentence };
  }
  return { who: 'document', sentence: 'LaTeX stopped with an error it could not recover from.' };
}

function findProblems(lines) {
  const found = [];
  const add = (problem, line, near) => {
    // TeX prints "Undefined control sequence." and Tectonic repeats it as "Undefined control sequence":
    // the same error, so the trailing punctuation and the case must not make two entries.
    const key = `${problem.toLowerCase().replace(/[.\s]+$/, '')}|${line}`;
    const existing = found.find((f) => f.key === key);
    if (existing) {
      if (!existing.near && near) existing.near = near; // keep the version that shows the text around it
      return;
    }
    found.push({ key, problem: problem.trim().slice(0, 200), line, near });
  };

  for (let i = 0; i < lines.length; i++) {
    const tex = /^! (.+)$/.exec(lines[i]);
    if (tex) {
      // The "l.<number>" line follows within a few lines.
      let line = null;
      let near = '';
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        const at = /^l\.(\d+) ?(.*)$/.exec(lines[j]);
        if (at) {
          line = Number(at[1]);
          near = at[2].trim().slice(0, MAX_CONTEXT_CHARS);
          break;
        }
      }
      add(tex[1], line, near);
      continue;
    }
    const engine = /^error: (?:[^\s:]+\.tex:(\d+): )?(.+)$/.exec(lines[i]);
    if (engine) add(engine[2], engine[1] ? Number(engine[1]) : null, '');
  }

  // Tectonic adds generic lines around a real error ("halted on potentially-recoverable error",
  // "something bad happened inside XeTeX", "the XeTeX engine had an unrecoverable error").
  // Keep them only if they are the sole thing we found.
  const specific = found.filter((f) => !ENGINE_NOISE.test(f.problem));
  return (specific.length ? specific : found).map(({ key, ...problem }) => problem);
}

// The part of the log worth showing: from just before the first error, capped. With no error
// found, the end of the log (that is where a crash is reported).
function excerpt(lines, hasProblems) {
  if (hasProblems) {
    const first = lines.findIndex((l) => /^! |^error: /.test(l));
    if (first >= 0) return lines.slice(Math.max(0, first - 3)).join('\n').slice(0, MAX_LOG_CHARS);
  }
  return lines.join('\n').slice(-MAX_LOG_CHARS);
}

// Returns { message, details, log }. `message` is the one sentence to show; `details` lists up to
// five problems; `log` is the trimmed technical log for people who want it.
export function explainCompileLog(rawLog) {
  const log = clean(rawLog).trim();
  const lines = log.split('\n');
  const problems = findProblems(lines);

  const details = problems.slice(0, MAX_DETAILS).map((p) => {
    const { who, sentence } = explainOne(p.problem);
    return { summary: sentence, problem: p.problem, line: p.line, near: p.near, affects: who };
  });

  let message;
  if (!details.length) {
    message = 'We could not build your PDF. The PDF engine stopped without a readable error; the technical log is included below.';
  } else if (details.every((d) => d.affects === 'server')) {
    message = `We could not build your PDF because of a problem on our side, not with your resume. ${details[0].summary}`;
  } else {
    const first = details.find((d) => d.affects === 'document') ?? details[0];
    const where = first.line ? ` (near line ${first.line} of the generated document)` : '';
    message = `We could not build your PDF. ${first.summary}${where}`;
  }

  return { message, details, log: excerpt(lines, details.length > 0) };
}
