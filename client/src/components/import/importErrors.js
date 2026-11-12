// Limits and error wording for the resume import. The server enforces all of these for real
// (file type by magic bytes, size, minimum text). The client copies are only there so the
// user hears about a problem before waiting on an upload.

export const MAX_FILE_BYTES = 2 * 1024 * 1024; // same 2 MB cap as the server
export const MIN_TEXT_CHARS = 100; // below this we treat the text as "almost nothing"
export const MAX_PASTE_CHARS = 30_000;

export const formatSize = (bytes) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// Quick pre-check of a chosen file. Returns an error message, or '' when it looks fine.
// The extension is only a hint for the user: the server looks at the real bytes.
export function checkFile(file) {
  if (!/\.(pdf|docx)$/i.test(file.name)) return 'Only PDF and DOCX files are supported.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_FILE_BYTES) return `That file is ${formatSize(file.size)}. The limit is 2 MB.`;
  return '';
}

const tooLittle = (chars, source) => ({
  code: 'too_little_text',
  // Only a scanned file can be the cause when the text came out of a file.
  message:
    source === 'file'
      ? `We found almost no text in this file (${chars} characters). This usually means a scanned or image-only PDF. Export a text-based PDF or DOCX, or paste the text instead.`
      : `That is too short to be a resume (${chars} characters). Paste the full text of your resume.`,
  offerPaste: source === 'file',
});

export function checkPasted(text) {
  const chars = text.trim().length;
  return chars < MIN_TEXT_CHARS ? tooLittle(chars, 'paste') : null;
}

// Turns a failed request into { code, message, offerPaste }. Never shows server internals.
export function describeImportError(err) {
  const status = err?.status;
  const code = err?.data?.code;

  if (status === 422 && code === 'too_little_text') return tooLittle(Number(err.data.chars) || 0, 'file');
  if (status === 422) return { code: 'no_text', message: 'We could not read any text from that file.', offerPaste: true };
  if (status === 401) return { code: 'auth', message: 'Your session expired. Sign in again, then retry.' };
  // The URL itself was not found: the running server is older than this page, or the proxy is
  // pointing at the wrong place. It is not a problem with the file.
  if (status === 404) return { code: 'no_route', message: 'The server does not have the import feature. Restart the API server (npm run dev in server/) and try again.' };
  if (status === 413) return { code: 'too_big', message: 'That file is over the 2 MB limit.' };
  if (status === 415) return { code: 'bad_type', message: 'That is not a real PDF or DOCX file. Check the file and try again.' };
  if (status === 429) return { code: 'rate', message: 'Too many imports. Wait a few minutes, then try again.' };
  if (status === 502) return { code: 'llm', message: 'The AI service could not parse the resume right now. Try again in a minute.' };
  if (status === 400) return { code: 'bad_request', message: 'The server rejected that input. Check the file or text and try again.' };
  if (status === undefined) return { code: 'network', message: 'Could not reach the server. Check your connection and try again.' };
  return { code: 'unknown', message: 'Import failed. Your profile was not changed.' };
}
