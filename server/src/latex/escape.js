// Turns untrusted text into text that LaTeX prints literally.
//
// LaTeX reads ten characters as commands, not text:  \ { } $ & # ^ _ % ~
// If a resume bullet could contain them, it could comment out the rest of a line (%),
// break a table (&), or run \input{...} / \write18{...}. So every piece of text that ends
// up in the .tex file goes through escapeLatex() first. No exceptions (template.js enforces it).

// Characters LaTeX gives a special meaning, plus < > | which print as wrong glyphs in some fonts.
// Everything is mapped in ONE pass (see escapeLatex): replacing "\" with "\textbackslash{}" in a
// first pass and then escaping "{" in a second pass would damage the braces we just wrote.
const MAP = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  $: '\\$',
  '&': '\\&',
  '#': '\\#',
  '%': '\\%',
  _: '\\_',
  '^': '\\textasciicircum{}',
  '~': '\\textasciitilde{}',
  '<': '\\textless{}',
  '>': '\\textgreater{}',
  '|': '\\textbar{}',
};
const SPECIAL = /[\\{}$&#^_%~<>|]/g;

// Characters that print nothing or change text direction. Dropped, never escaped:
//   C0/C1 controls (NUL, bell, escape...) except tab/newline/VT/FF/CR (handled as whitespace below),
//   zero-width space, LRM/RLM, bidi embeddings and overrides (U+202A-202E, U+2066-2069),
//   word joiner and the BOM.
// ZWJ/ZWNJ (U+200D/U+200C) are kept on purpose: some scripts need them.
const INVISIBLE = /[\u0000-\u0008\u000E-\u001F\u007F-\u0084\u0086-\u009F​‎‏‪-‮⁠⁦-⁩﻿]/g;

// \s covers space, tab, newlines, NBSP, U+2028/2029. U+0085 (NEL) is added by hand.
// A newline is harmless but a BLANK line is \par, which breaks command arguments, so every run
// of whitespace becomes one space.
const WHITESPACE = /[\s\u0085]+/g;

// Text -> LaTeX-safe text. Only strings are accepted: String(obj) would quietly print
// "[object Object]" into a resume, and a thrown error is easier to notice.
export function escapeLatex(value) {
  if (typeof value !== 'string') {
    throw new TypeError(`escapeLatex expects a string, got ${value === null ? 'null' : typeof value}`);
  }
  return value
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(WHITESPACE, ' ')
    .trim()
    .replace(SPECIAL, (ch) => MAP[ch]);
}

// Characters that are not allowed to stay raw inside \href{...}. They become percent-codes.
// "%" itself has to be written \% there, because a bare % starts a comment even inside \href.
// Note the "\%" prefix on the codes: the % in "%7B" is also a % in the .tex file.
// Single pass again, for the same reason as above.
const URL_MAP = {
  '%': '\\%',
  '\\': '\\%5C',
  '{': '\\%7B',
  '}': '\\%7D',
  '^': '\\%5E',
  '|': '\\%7C',
  $: '\\%24',
};
const URL_SPECIAL = /[%\\{}^|$]/g;

// For the FIRST argument of \href{url}{text}. Only http(s) links are accepted, so "javascript:",
// "file:" and "data:" can never become a clickable link. new URL() already encodes spaces, quotes
// and angle brackets for us. The visible link text is separate: use escapeLatex() on it.
// "#", "~", "_" and "&" are left as they are (hyperref reads them literally inside \href);
// confirm this with a real Tectonic compile before relying on it.
export function escapeUrl(value) {
  if (typeof value !== 'string') {
    throw new TypeError(`escapeUrl expects a string, got ${value === null ? 'null' : typeof value}`);
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('escapeUrl: not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('escapeUrl: only http and https links are allowed');
  }
  return url.href.replace(URL_SPECIAL, (ch) => URL_MAP[ch]);
}
