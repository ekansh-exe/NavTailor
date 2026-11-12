// Pure-logic tests for LaTeX escaping. No network, no DB, no Tectonic.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeLatex, escapeUrl } from '../src/latex/escape.js';

// Every character LaTeX treats specially (the first ten), plus three that print wrongly in some fonts.
const SPECIALS = [
  ['backslash', '\\', '\\textbackslash{}'],
  ['left brace', '{', '\\{'],
  ['right brace', '}', '\\}'],
  ['dollar', '$', '\\$'],
  ['ampersand', '&', '\\&'],
  ['hash', '#', '\\#'],
  ['percent', '%', '\\%'],
  ['underscore', '_', '\\_'],
  ['caret', '^', '\\textasciicircum{}'],
  ['tilde', '~', '\\textasciitilde{}'],
  ['less-than', '<', '\\textless{}'],
  ['greater-than', '>', '\\textgreater{}'],
  ['pipe', '|', '\\textbar{}'],
];

// Everything escapeLatex is allowed to emit. Removing these from an output must leave NO special
// character behind; anything left would be live LaTeX.
const EMITTED = [
  '\\textbackslash{}',
  '\\textasciicircum{}',
  '\\textasciitilde{}',
  '\\textless{}',
  '\\textgreater{}',
  '\\textbar{}',
  '\\{',
  '\\}',
  '\\$',
  '\\&',
  '\\#',
  '\\%',
  '\\_',
];
const stripEmitted = (s) => EMITTED.reduce((acc, e) => acc.split(e).join(''), s);
const LIVE_SPECIAL = /[\\{}$&#^_%~<>|]/;

describe('escapeLatex: every special character', () => {
  for (const [name, input, expected] of SPECIALS) {
    test(`${name} (${input}) becomes ${expected}`, () => {
      assert.equal(escapeLatex(input), expected);
    });
    test(`${name} inside a sentence is escaped and the words around it are untouched`, () => {
      assert.equal(escapeLatex(`a${input}b`), `a${expected}b`);
    });
    test(`${name} repeated is escaped every time`, () => {
      assert.equal(escapeLatex(input.repeat(3)), expected.repeat(3));
    });
  }

  test('plain text, digits, punctuation and quotes are unchanged', () => {
    const plain = `Built a React dashboard, used by 40 teams (2021-2024); "fast", it's 3.5x. Cost: 5 + 5 = 10! Really? [yes] @home *bold* /path`;
    assert.equal(escapeLatex(plain), plain);
  });

  test('a realistic bullet: percent, ampersand and dollar are all escaped', () => {
    assert.equal(
      escapeLatex('Cut costs by 40% & saved $2M in R&D'),
      'Cut costs by 40\\% \\& saved \\$2M in R\\&D',
    );
  });
});

describe('escapeLatex: one pass, no double escaping', () => {
  test('a backslash followed by a brace gives two separate escapes', () => {
    assert.equal(escapeLatex('\\{'), '\\textbackslash{}\\{');
  });
  test('the braces inside \\textbackslash{} are not escaped again', () => {
    assert.equal(escapeLatex('a\\b'), 'a\\textbackslash{}b');
  });
  test('all specials in one string give one exact result', () => {
    assert.equal(
      escapeLatex('\\{}$&#^_%~<>|'),
      '\\textbackslash{}\\{\\}\\$\\&\\#\\textasciicircum{}\\_\\%\\textasciitilde{}\\textless{}\\textgreater{}\\textbar{}',
    );
  });
  test('escaping is applied once: escaping the output again changes it (callers must escape exactly once)', () => {
    const once = escapeLatex('50%');
    assert.equal(once, '50\\%');
    assert.notEqual(escapeLatex(once), once);
  });
});

describe('escapeLatex: injection strings never leave live LaTeX', () => {
  const ATTACKS = [
    '\\input{/etc/passwd}',
    '\\write18{touch /tmp/pwned}',
    '\\immediate\\write18{id}',
    '\\openin1=/etc/passwd',
    'x %\n\\end{document}',
    '}\\textbf{injected',
    '\\def\\x{\\input{y}}',
    '^^5cinput{y}',
    '\\catcode`\\%=12',
    '$\\mathrm{x}$',
    '& \\\\ \\hline',
    '\\href{javascript:alert(1)}{x}',
  ];
  for (const attack of ATTACKS) {
    test(`neutralises ${JSON.stringify(attack)}`, () => {
      const out = escapeLatex(attack);
      assert.ok(!LIVE_SPECIAL.test(stripEmitted(out)), `live special left in: ${out}`);
      assert.ok(!out.includes('\\input{'));
      assert.ok(!out.includes('\\write18'));
      assert.ok(!out.includes('\n'));
    });
  }

  test('the words of an attack survive as harmless plain text', () => {
    assert.equal(escapeLatex('\\input{x}'), '\\textbackslash{}input\\{x\\}');
  });
});

describe('escapeLatex: whitespace and invisible characters', () => {
  test('newlines, blank lines and tabs collapse to single spaces', () => {
    assert.equal(escapeLatex('a\nb\r\n\r\n\r\nc\t\td'), 'a b c d');
  });
  test('a blank line can never survive (it would be \\par)', () => {
    assert.ok(!/\n\s*\n/.test(escapeLatex('one\n\ntwo\n \nthree')));
  });
  test('leading and trailing whitespace is trimmed; NBSP and line separators count as whitespace', () => {
    assert.equal(escapeLatex('  \u00a0 hi\u2028there \u0085 '), 'hi there');
  });
  test('NUL, bell and escape characters are removed', () => {
    assert.equal(escapeLatex('a\u0000b\u0007c\u001bd\u007fe'), 'abcde');
  });
  test('bidi overrides, zero-width space and BOM are removed', () => {
    assert.equal(escapeLatex('a\u202eb\u202ac\u2066d\u2069e\u200bf\u200eg\u2060h\ufeffi'), 'abcdefghi');
  });
  test('control characters are removed BEFORE escaping, so they cannot hide a special character', () => {
    assert.equal(escapeLatex('\\\u0000input'), '\\textbackslash{}input');
  });
  test('empty and whitespace-only strings give an empty string', () => {
    assert.equal(escapeLatex(''), '');
    assert.equal(escapeLatex(' \n\t '), '');
  });
  test('accents, CJK and decomposed accents are kept (NFC-normalised)', () => {
    assert.equal(escapeLatex('Zoë Müller 日本語'), 'Zoë Müller 日本語');
    assert.equal(escapeLatex('e\u0301'), '\u00e9');
  });
  test('ZWJ and ZWNJ are kept because some scripts need them', () => {
    assert.equal(escapeLatex('a\u200db\u200cc'), 'a\u200db\u200cc');
  });
});

describe('escapeLatex: input type', () => {
  for (const [label, value] of [
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['an object', {}],
    ['an array', ['a']],
    ['a boolean', true],
  ]) {
    test(`throws TypeError for ${label}`, () => {
      assert.throws(() => escapeLatex(value), TypeError);
    });
  }
});

describe('escapeUrl', () => {
  test('a normal https link passes through', () => {
    assert.equal(escapeUrl('https://github.com/janedoe'), 'https://github.com/janedoe');
  });
  test('http is accepted too, surrounding whitespace is ignored', () => {
    assert.equal(escapeUrl('  http://example.com/a  '), 'http://example.com/a');
  });
  test('a percent sign is written \\% (a bare % would start a comment)', () => {
    assert.equal(escapeUrl('https://example.com/a%20b'), 'https://example.com/a\\%20b');
  });
  test('a space is encoded by the URL parser, then its % is escaped', () => {
    assert.equal(escapeUrl('https://example.com/a b'), 'https://example.com/a\\%20b');
  });
  test('braces are encoded as %7B and %7D, each with the \\% prefix', () => {
    assert.equal(escapeUrl('https://example.com/?x={1}'), 'https://example.com/?x=\\%7B1\\%7D');
  });
  test('caret, pipe and dollar are encoded', () => {
    assert.equal(escapeUrl('https://example.com/?a=^|$'), 'https://example.com/?a=\\%5E\\%7C\\%24');
  });
  test('a backslash in the path is turned into a slash by the URL parser', () => {
    assert.equal(escapeUrl('https://example.com/a\\b'), 'https://example.com/a/b');
  });
  test('a backslash in the query is encoded', () => {
    assert.equal(escapeUrl('https://example.com/?a=\\b'), 'https://example.com/?a=\\%5Cb');
  });
  test('query separators and fragments are kept as written', () => {
    assert.equal(escapeUrl('https://example.com/p?a=1&b=2#top'), 'https://example.com/p?a=1&b=2#top');
  });
  test('the output never contains a bare %, a backslash that is not part of \\%, whitespace or a brace', () => {
    const out = escapeUrl('https://example.com/a b%20c?q={x}\\y^z|w$#f"g');
    assert.ok(!/(?<!\\)%/.test(out), out);
    assert.ok(!/\\(?!%)/.test(out), out);
    assert.ok(!/[\s{}^|$]/.test(out), out);
  });
  for (const bad of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'file:///etc/passwd',
    'data:text/html,<script>alert(1)</script>',
    'ftp://example.com/x',
    'mailto:a@example.com',
    'not a url',
    '',
    '//example.com/x',
  ]) {
    test(`throws for ${JSON.stringify(bad)}`, () => {
      assert.throws(() => escapeUrl(bad));
    });
  }
  test('throws TypeError for non-strings', () => {
    for (const v of [null, undefined, 42, {}, ['https://a.com']]) {
      assert.throws(() => escapeUrl(v), TypeError);
    }
  });
});
