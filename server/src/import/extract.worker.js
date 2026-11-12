// Runs in a worker thread (see extractText.js). Parsing untrusted PDFs and ZIPs is the riskiest
// part of the import, so it happens here: if a file makes the parser spin forever, the main
// thread can terminate this worker and the API keeps serving other users.
import { parentPort, workerData } from 'node:worker_threads';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

const MAX_PDF_PAGES = 10; // a resume is 1 to 3 pages; ignore the rest
const MAX_ZIP_ENTRIES = 1000;
const MAX_UNZIPPED_BYTES = 30 * 1024 * 1024;

// A DOCX is a ZIP. Before inflating it, read the table of contents (cheap) and refuse absurd
// archives. Declared sizes can be forged in a crafted file, so this is one layer of defence,
// next to the worker timeout and the 2 MB upload cap.
async function assertSaneZip(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files);
  if (entries.length > MAX_ZIP_ENTRIES) throw new Error('zip_too_many_entries');
  const declared = entries.reduce((sum, e) => sum + (e._data?.uncompressedSize ?? 0), 0);
  if (declared > MAX_UNZIPPED_BYTES) throw new Error('zip_too_big');
}

async function extract({ kind, data }) {
  if (kind === 'pdf') {
    // isEvalSupported:false stops pdf.js from compiling font code with eval(), the route that
    // CVE-2024-4367 abused. We only read text: no rendering, no scripts.
    const parser = new PDFParse({ data: new Uint8Array(data), isEvalSupported: false });
    try {
      // pageJoiner replaces the default "-- 1 of 1 --" page markers, which would count as
      // "text" for a scanned PDF and be sent to the model as noise.
      const result = await parser.getText({ first: MAX_PDF_PAGES, pageJoiner: '\n' });
      return result.text;
    } finally {
      await parser.destroy().catch(() => {});
    }
  }
  if (kind === 'docx') {
    const buffer = Buffer.from(data);
    await assertSaneZip(buffer);
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  }
  throw new Error('unsupported_kind');
}

try {
  parentPort.postMessage({ ok: true, text: await extract(workerData) });
} catch (err) {
  // Only a short code leaves the worker, never the parser's message (it can quote file content).
  const known = ['zip_too_many_entries', 'zip_too_big'];
  parentPort.postMessage({ ok: false, code: known.includes(err?.message) ? err.message : 'unreadable' });
}
