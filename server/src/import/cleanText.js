// Makes extracted text safe and small enough to put in a prompt.
// Pure function: no I/O, nothing logged.

export const MAX_TEXT_CHARS = 40_000;

// Below this many characters we treat extraction as failed ("almost no text"). A real resume
// has well over 500; a scanned PDF usually yields 0 to a few dozen stray characters.
// The route answers 422 { code: 'too_little_text', chars } and the client shows a scanned-PDF
// message. Keep in sync with MIN_TEXT_CHARS in client/src/components/import/importErrors.js.
export const MIN_TEXT_CHARS = 100;

export const hasTooLittleText = (text) => text.length < MIN_TEXT_CHARS;

export function cleanText(raw, max = MAX_TEXT_CHARS) {
  let text = String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    // NULs and other control characters (keep \n and \t). Parsers sometimes emit them.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const truncated = text.length > max;
  if (truncated) text = text.slice(0, max);
  return { text, truncated };
}
