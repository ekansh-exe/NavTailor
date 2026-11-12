import { fileTypeFromBuffer } from 'file-type';

// Decides what a file REALLY is by reading its first bytes ("magic bytes"), never by its name
// or the Content-Type header, both of which the sender controls.
// Returns 'pdf', 'docx', or null (anything else, including a plain .zip or a renamed .exe).
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export async function detectType(buffer) {
  let found;
  try {
    found = await fileTypeFromBuffer(buffer);
  } catch {
    return null; // truncated or malformed: treat as unsupported, not as a server error
  }
  if (found?.mime === 'application/pdf') return 'pdf';
  if (found?.mime === DOCX_MIME) return 'docx';
  return null;
}
