// Tests for the resume template: the tex`` tag, join(), and renderResume().
// Pure logic (no network, no DB). The one compile test only runs when Tectonic is installed.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderResume, tex, join } from '../src/latex/template.js';

// ---------- fixtures ----------

const profile = (overrides = {}) => ({
  basics: {
    name: 'Jane Doe',
    email: 'jane_d@example.com',
    phone: '+1 (555) 010-2030',
    location: 'Pune, IN',
    links: ['https://github.com/janedoe', 'https://www.jane.dev/'],
  },
  summary: 'Engineer who cut costs by 40% & saved $2M.',
  education: [
    { id: 'edu1', school: 'State University', degree: 'B.Sc. Computer Science', dates: '2017 - 2021', grade: '8.7/10 CGPA' },
  ],
  experience: [
    {
      id: 'exp1',
      company: 'Acme Corp',
      role: 'Software Engineer',
      dates: '2021 - 2024',
      location: 'Remote',
      bullets: [
        { id: 'exp1_b1', text: '[Internal] Built a React dashboard used by 40 teams', skills: ['React'], alwaysInclude: false },
        { id: 'exp1_b2', text: 'Wrote Node.js services', skills: [], alwaysInclude: false },
      ],
    },
  ],
  projects: [
    {
      id: 'proj1',
      name: 'NavTailor',
      tagline: 'AI resume tailoring',
      dates: 'Nov 2026',
      link: 'https://github.com/janedoe/navtailor',
      skills: ['React', 'Node.js'],
      bullets: [{ id: 'proj1_b1', text: 'Tailors resumes', skills: [] }],
    },
  ],
  certifications: [{ id: 'cert1', name: 'AWS CCP', issuer: 'Amazon', year: '2023', skills: [] }],
  skills: { languages: ['JavaScript', 'C++'], frameworks: ['React'], tools: ['MongoDB'] },
  achievements: [{ id: 'ach1', text: 'Winner, Smart India Hackathon among 500+ teams' }],
  activitiesHeading: 'Leadership & Activities',
  activities: [{ id: 'act1', title: 'Lead, Coding Club', detail: '2022 - 2023' }],
  ...overrides,
});

const emptyProfile = () => ({
  basics: { name: '', email: '', phone: '', location: '', links: [] },
  summary: '',
  education: [],
  experience: [],
  projects: [],
  certifications: [],
  skills: { languages: [], frameworks: [], tools: [] },
});

// Every special character plus real attacks. LONG fits the 200 to 500 character fields,
// SHORT fits the small ones (year is capped at 20 characters).
const LONG = String.raw`\input{/etc/passwd} \write18{touch PWNED} \begin{verbatim} \end{document} % & $ # ^ _ { } ~ }}} {{{ \\`;
// A normal string, not String.raw: a raw template cannot end in a single backslash (it would escape the closing backtick).
const SHORT = '\\input{x}%&$#^_{}~\\';
const HOSTILE_URL = 'https://example.com/a%20b?x={1}&y=$_^|#f';

function hostileProfile() {
  return {
    basics: { name: LONG, email: 'a_b+c@example.com', phone: SHORT, location: LONG, links: [HOSTILE_URL] },
    summary: LONG,
    education: [{ id: 'edu1', school: LONG, degree: LONG, dates: SHORT, grade: SHORT }],
    experience: [
      {
        id: 'exp1',
        company: LONG,
        role: LONG,
        dates: SHORT,
        location: LONG,
        bullets: [
          { id: 'exp1_b1', text: LONG, skills: [SHORT], alwaysInclude: false },
          { id: 'exp1_b2', text: `[${LONG}]`, skills: [], alwaysInclude: false },
        ],
      },
    ],
    projects: [
      { id: 'proj1', name: LONG, tagline: LONG, dates: SHORT, link: HOSTILE_URL, skills: [SHORT, SHORT], bullets: [{ id: 'proj1_b1', text: LONG, skills: [] }] },
    ],
    certifications: [{ id: 'cert1', name: LONG, issuer: LONG, year: SHORT, skills: [SHORT] }],
    skills: { languages: [SHORT], frameworks: [SHORT], tools: [SHORT] },
    achievements: [{ id: 'ach1', text: LONG }, { id: 'ach2', text: `[${SHORT}]` }],
    activitiesHeading: SHORT,
    activities: [{ id: 'act1', title: LONG, detail: LONG }],
  };
}

// Every LaTeX command word the finished document is allowed to contain: the template's own commands
// plus what escapeLatex emits. Adding a command to the template means adding it here on purpose.
const ALLOWED_WORDS = new Set([
  // template
  '\\documentclass', '\\usepackage', '\\setmainfont', '\\pagestyle', '\\setlength', '\\parindent',
  '\\parskip', '\\hyphenpenalty', '\\exhyphenpenalty', '\\raggedright', '\\titleformat',
  '\\titlespacing', '\\MakeUppercase', '\\setlist', '\\circ', '\\textbullet', '\\begin', '\\end',
  '\\section', '\\LARGE', '\\large', '\\small', '\\bfseries', '\\itshape', '\\titlerule',
  '\\textbf', '\\textbar', '\\hfill', '\\hspace', '\\par', '\\item', '\\relax', '\\href', '\\vspace',
  // escapeLatex output
  '\\textbackslash', '\\textasciicircum', '\\textasciitilde', '\\textless', '\\textgreater',
]);
const ALLOWED_SYMBOLS = new Set(['\\{', '\\}', '\\$', '\\&', '\\#', '\\%', '\\_']);
const ALLOWED_ENVIRONMENTS = new Set(['document', 'center', 'itemize']);

const count = (haystack, needle) => haystack.split(needle).length - 1;

// ---------- tex`` and join() ----------

describe('tex tag', () => {
  test('the literal parts are kept exactly (backslashes are not read as escapes)', () => {
    assert.equal(tex`\textbf{x}\par`.toString(), '\\textbf{x}\\par');
  });
  test('an interpolated string is escaped', () => {
    assert.equal(tex`\textbf{${'50% & $5'}}`.toString(), '\\textbf{50\\% \\& \\$5}');
  });
  test('an interpolated string that looks like LaTeX stays text', () => {
    assert.equal(tex`${'\\input{x}'}`.toString(), '\\textbackslash{}input\\{x\\}');
  });
  test('a tex`` result inside another one is not escaped twice', () => {
    const inner = tex`\textbf{${'a_b'}}`;
    assert.equal(tex`x ${inner} y`.toString(), 'x \\textbf{a\\_b} y');
  });
  test('values that are not strings throw instead of printing "[object Object]"', () => {
    for (const bad of [42, null, undefined, {}, ['a'], true]) {
      assert.throws(() => tex`${bad}`, TypeError);
    }
  });
  test('an object that merely looks like a Raw cannot pass as safe LaTeX', () => {
    const fake = { value: '\\input{x}', toString: () => '\\input{x}' };
    assert.throws(() => tex`${fake}`, TypeError);
  });
});

describe('join', () => {
  test('joins tex`` results with the separator', () => {
    assert.equal(join([tex`a`, tex`b`], ', ').toString(), 'a, b');
  });
  test('refuses plain strings, so text cannot skip escaping through join', () => {
    assert.throws(() => join(['\\input{x}']), TypeError);
    assert.throws(() => join([tex`a`, 'b']), TypeError);
    assert.throws(() => join('ab'), TypeError);
  });
  test('an empty list gives an empty string', () => {
    assert.equal(join([]).toString(), '');
  });
});

// ---------- renderResume: structure ----------

describe('renderResume: document', () => {
  test('one documentclass, one begin and one end of the document', () => {
    const out = renderResume(profile());
    assert.equal(count(out, '\\documentclass'), 1);
    assert.equal(count(out, '\\begin{document}'), 1);
    assert.equal(count(out, '\\end{document}'), 1);
    assert.ok(out.trimEnd().endsWith('\\end{document}'));
  });

  test('standard section names, in the standard order', () => {
    const out = renderResume(profile());
    const order = ['Summary', 'Education', 'Work Experience', 'Projects', 'Leadership \\& Activities', 'Skills', 'Certifications', 'Achievements'];
    const positions = order.map((name) => out.indexOf(`\\section*{${name}}`));
    assert.ok(positions.every((p) => p >= 0), `missing a section: ${positions}`);
    assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  });

  test('a realistic profile is escaped and laid out as expected', () => {
    const out = renderResume(profile());
    assert.match(out, /Engineer who cut costs by 40\\% \\& saved \\\$2M\./);
    const sep = String.raw`\hspace{0.8em}\textbar{}\hspace{0.8em}`;
    assert.ok(out.includes(`jane\\_d@example.com${sep}+1 (555) 010-2030${sep}Pune, IN\\par`));
    // links get their own centered line
    assert.ok(out.includes(`\\href{https://github.com/janedoe}{github.com/janedoe}${sep}\\href{https://www.jane.dev/}{jane.dev}\\par`));
    assert.ok(out.includes('\\textbf{Acme Corp}\\hfill 2021 - 2024\\par'));
    assert.ok(out.includes('{\\itshape\\small Software Engineer}\\hfill{\\itshape\\small Remote}\\par'));
    assert.ok(out.includes('\\textbf{State University}\\hfill 2017 - 2021\\par'));
    assert.ok(out.includes('{\\itshape\\small B.Sc. Computer Science}\\hfill{\\itshape\\small 8.7/10 CGPA}\\par'));
    assert.ok(out.includes('\\textbf{NavTailor -- AI resume tailoring}\\hfill Nov 2026\\par'));
    assert.ok(out.includes('{\\itshape\\small React, Node.js}\\hfill{\\itshape\\small \\href{https://github.com/janedoe/navtailor}{github.com/janedoe/navtailor}}\\par'));
    assert.ok(out.includes('\\textbf{Programming Languages:} JavaScript, C++\\par'));
    assert.ok(out.includes('\\textbf{Frameworks \\& Libraries:} React\\par'));
    assert.ok(out.includes('\\textbf{AWS CCP}, Amazon\\hfill 2023\\par'));
    assert.ok(out.includes('\\section*{Leadership \\& Activities}\nLead, Coding Club\\hfill 2022 - 2023\\par'));
    assert.ok(out.includes('\\item\\relax Winner, Smart India Hackathon among 500+ teams'));
  });

  test('a bullet starting with "[" cannot be read as the optional argument of \\item', () => {
    const out = renderResume(profile());
    assert.ok(out.includes('\\item\\relax\\small [Internal] Built a React dashboard'));
    assert.ok(!/\\item\s*\[/.test(out));
  });

  test('a "%" in a field is escaped exactly once (no double escaping)', () => {
    const p = profile();
    p.education[0].grade = '85%';
    const out = renderResume(p);
    assert.ok(out.includes('85\\%'));
    assert.ok(!out.includes('\\textbackslash{}\\%'));
  });

  test('same input gives the same output and the input is not modified', () => {
    const p = profile();
    const before = structuredClone(p);
    assert.equal(renderResume(p), renderResume(p));
    assert.deepEqual(p, before);
  });
});

describe('renderResume: ATS-friendly rules', () => {
  for (const [label, make] of [
    ['a full profile', profile],
    ['a hostile profile', hostileProfile],
  ]) {
    test(`${label}: no images, tables, columns, drawings or icon fonts`, () => {
      const out = renderResume(make());
      for (const banned of ['includegraphics', 'tabular', 'multicol', 'tikz', 'fontawesome', 'faIcon', 'minipage', 'wrapfig', 'parbox', 'array}']) {
        assert.ok(!out.includes(banned), `found ${banned}`);
      }
    });
  }
  test('the only environments are document, center and itemize', () => {
    const out = renderResume(profile());
    const envs = [...out.matchAll(/\\begin\{([^}]*)\}/g)].map((m) => m[1]);
    assert.ok(envs.length > 0);
    for (const env of envs) assert.ok(ALLOWED_ENVIRONMENTS.has(env), env);
  });
  test('dates share a line with the entry (hfill), not a table cell', () => {
    assert.match(renderResume(profile()), /\\textbf\{State University\}\\hfill 2017 - 2021/);
  });
  test('section titles are real uppercase text, not small caps (small caps extract as "EDUCATiON")', () => {
    const out = renderResume(profile());
    assert.ok(out.includes('\\MakeUppercase'));
    assert.ok(!out.includes('scshape'));
  });
});

describe('renderResume: empty and partial data', () => {
  test('empty sections are left out entirely', () => {
    const p = emptyProfile();
    p.basics.name = 'Jane Doe';
    p.skills.tools = ['Git'];
    const out = renderResume(p);
    assert.ok(out.includes('\\section*{Skills}'));
    for (const name of ['Summary', 'Work Experience', 'Projects', 'Education', 'Certifications', 'Achievements', 'Activities']) {
      assert.ok(!out.includes(`\\section*{${name}}`), name);
    }
  });

  test('a completely empty profile still produces a document with a body', () => {
    const out = renderResume(emptyProfile());
    assert.ok(out.includes('\\begin{document}\n\\null\n\\end{document}'));
  });

  test('whitespace-only fields count as empty', () => {
    const p = emptyProfile();
    p.summary = '   ';
    p.basics.name = ' \n ';
    assert.ok(renderResume(p).includes('\\null'));
  });

  test('a contact line with one item has no dangling separator', () => {
    const p = emptyProfile();
    p.basics.email = 'jane@example.com';
    assert.equal(count(renderResume(p), '\\textbar{}'), 0);
  });

  test('missing phone and links leave no doubled separators', () => {
    const p = profile();
    p.basics.phone = '';
    p.basics.links = [];
    const out = renderResume(p);
    assert.ok(out.includes('jane\\_d@example.com\\hspace{0.8em}\\textbar{}\\hspace{0.8em}Pune, IN\\par'));
    assert.ok(!out.includes('\\href{https://github.com/janedoe}'), 'no links line');
  });

  test('a job without bullets gets no itemize (an empty list is a LaTeX error)', () => {
    const p = profile();
    p.experience[0].bullets = [];
    const out = renderResume(p);
    assert.ok(out.includes('Acme Corp'));
    // only the project and the achievements still have a list
    assert.equal(count(out, '\\begin{itemize}'), 2);
  });

  test('every itemize has at least one item', () => {
    const out = renderResume(profile());
    for (const block of out.split('\\begin{itemize}').slice(1)) {
      const body = block.split('\\end{itemize}')[0];
      assert.ok(body.includes('\\item'), 'empty itemize');
    }
    assert.equal(count(out, '\\begin{itemize}'), count(out, '\\end{itemize}'));
  });

  test('an entry with no content at all is skipped', () => {
    const p = emptyProfile();
    p.experience = [{ id: 'exp1', company: '', role: '', dates: '', bullets: [] }];
    p.certifications = [{ id: 'cert1', name: '', issuer: 'Amazon', year: '2023', skills: [] }];
    const out = renderResume(p);
    assert.ok(!out.includes('\\section*{Experience}'));
    assert.ok(!out.includes('\\section*{Certifications}'));
  });
});

describe('renderResume: optional fields', () => {
  test('a job without location and a project without dates, tagline or link leave no stray hfill', () => {
    const p = profile();
    p.experience[0].location = '';
    Object.assign(p.projects[0], { tagline: '', dates: '', link: '' });
    const out = renderResume(p);
    assert.ok(out.includes('{\\itshape\\small Software Engineer}\\par'));
    assert.ok(out.includes('\\textbf{NavTailor}\\par'));
    assert.ok(out.includes('{\\itshape\\small React, Node.js}\\par'));
  });
  test('profiles saved before the optional fields existed still render', () => {
    const p = profile();
    delete p.experience[0].location;
    delete p.projects[0].tagline;
    delete p.projects[0].dates;
    delete p.achievements;
    delete p.activities;
    delete p.activitiesHeading;
    const out = renderResume(p);
    assert.ok(out.includes('\\section*{Work Experience}'));
    assert.ok(!out.includes('\\section*{Achievements}'));
  });
  test('activities without a heading use "Activities"; an activity without a title is skipped', () => {
    const p = profile({ activitiesHeading: '  ', activities: [{ id: 'a1', title: 'Volunteer', detail: '' }, { id: 'a2', title: '', detail: '2020' }] });
    const out = renderResume(p);
    assert.ok(out.includes('\\section*{Activities}\nVolunteer\\par'));
    assert.ok(!out.includes('2020'));
  });
  test('achievement and activity ids join the profile-wide uniqueness rule', () => {
    assert.throws(() => renderResume(profile({ achievements: [{ id: 'exp1', text: 'x' }] })));
    assert.throws(() => renderResume(profile({ activities: [{ id: 'cert1', title: 'x', detail: '' }] })));
  });
});

describe('renderResume: input validation', () => {
  test('anything that is not a valid profile throws', () => {
    for (const bad of [null, undefined, 'text', 42, [], {}, { ...profile(), userId: 'someone' }]) {
      assert.throws(() => renderResume(bad));
    }
  });
  test('a link that is not http(s) is rejected before it reaches the document', () => {
    const p = profile();
    p.basics.links = ['javascript:alert(1)'];
    assert.throws(() => renderResume(p));
  });
  test('duplicate ids are rejected (same rule as the stored profile)', () => {
    const p = profile();
    p.experience[0].bullets[1].id = p.experience[0].bullets[0].id;
    assert.throws(() => renderResume(p));
  });
});

// ---------- renderResume: hostile input ----------

describe('renderResume: every field carries an attack', () => {
  const out = renderResume(hostileProfile());

  test('the attack text appears only in escaped form', () => {
    for (const live of ['\\input{', '\\write18', '\\begin{verbatim}', '\\openin', '\\def\\']) {
      assert.ok(!out.includes(live), `live: ${live}`);
    }
    assert.ok(out.includes('\\textbackslash{}input\\{/etc/passwd\\}'));
    assert.ok(out.includes('\\textbackslash{}write18\\{touch PWNED\\}'));
  });

  test('the injected \\end{document} did not end the document early', () => {
    assert.equal(count(out, '\\end{document}'), 1);
    assert.equal(count(out, '\\begin{document}'), 1);
    assert.ok(out.trimEnd().endsWith('\\end{document}'));
  });

  test('every command word in the output is on the allowlist', () => {
    const found = new Set(out.match(/\\[A-Za-z]+/g));
    for (const word of found) assert.ok(ALLOWED_WORDS.has(word), `unexpected command ${word}`);
  });

  test('every control symbol in the output is an escape we emit (no "\\\\", "\\ ", "\\[" ...)', () => {
    const found = new Set(out.match(/\\[^A-Za-z]/g));
    for (const symbol of found) assert.ok(ALLOWED_SYMBOLS.has(symbol), `unexpected control symbol ${JSON.stringify(symbol)}`);
  });

  test('no unescaped percent sign, so nothing can start a comment', () => {
    assert.ok(!/(?<!\\)%/.test(out));
  });

  test('braces are balanced once escaped braces are ignored', () => {
    const bare = out.replace(/\\[{}]/g, '');
    assert.equal(count(bare, '{'), count(bare, '}'));
  });

  test('the only environments are document, center and itemize', () => {
    for (const m of out.matchAll(/\\(?:begin|end)\{([^}]*)\}/g)) {
      assert.ok(ALLOWED_ENVIRONMENTS.has(m[1]), m[1]);
    }
  });

  test('hostile link targets keep every percent sign escaped and no raw braces', () => {
    const hrefs = [...out.matchAll(/\\href\{([^}]*(?:\\\}[^}]*)*)\}\{/g)].map((m) => m[1]);
    assert.ok(hrefs.length >= 2);
    for (const target of hrefs) {
      assert.ok(!/(?<!\\)%/.test(target), target);
      assert.ok(!/[\s^|$]/.test(target), target);
    }
  });

  test('no blank line appears inside a field (it would be \\par inside an argument)', () => {
    const p = profile();
    p.summary = 'line one\n\n\nline two';
    p.experience[0].bullets[0].text = 'a\n\nb';
    const result = renderResume(p);
    assert.ok(result.includes('line one line two'));
    assert.ok(result.includes('\\item\\relax\\small a b'));
  });
});

// ---------- optional: a real compile ----------

function tectonicSupportsUntrusted() {
  const help = spawnSync('tectonic', ['-X', 'compile', '--help'], { encoding: 'utf8' });
  return !help.error && help.status === 0 && /--untrusted/.test(help.stdout);
}
const canCompile = tectonicSupportsUntrusted();

describe('real compile (needs Tectonic)', () => {
  test(
    'the hostile profile compiles in untrusted mode and runs nothing',
    { skip: canCompile ? false : 'tectonic is not installed (or has no --untrusted flag)' },
    () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'navtailor-tex-'));
      try {
        fs.writeFileSync(path.join(dir, 'main.tex'), renderResume(hostileProfile()));
        const run = spawnSync('tectonic', ['-X', 'compile', '--untrusted', '--outdir', dir, path.join(dir, 'main.tex')], {
          cwd: dir,
          encoding: 'utf8',
          timeout: 120_000,
        });
        assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
        const pdf = fs.readFileSync(path.join(dir, 'main.pdf'));
        assert.equal(pdf.subarray(0, 4).toString('latin1'), '%PDF');
        assert.ok(!fs.existsSync(path.join(dir, 'PWNED')), '\\write18 payload ran');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
