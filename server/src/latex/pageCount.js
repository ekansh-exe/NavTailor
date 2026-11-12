import fsp from 'node:fs/promises';
import { PDFParse } from 'pdf-parse';

// How many pages a PDF has. xdvipdfmx stores page objects in compressed object streams, so counting
// "/Type /Page" in the raw bytes would be unreliable; a real PDF reader is asked instead.
// pdf-parse is already a dependency (the resume import uses it for text).
// The file is our own Tectonic output, but it is still parsed with eval disabled and a size cap.

const MAX_PDF_BYTES = 5 * 1024 * 1024;

export async function countPdfPages(pdfPath) {
  const { size } = await fsp.stat(pdfPath);
  if (size > MAX_PDF_BYTES) throw new Error('pdf_too_big');
  const parser = new PDFParse({ data: new Uint8Array(await fsp.readFile(pdfPath)), isEvalSupported: false });
  try {
    const { total } = await parser.getInfo();
    if (!Number.isInteger(total) || total < 1) throw new Error('pdf_no_pages');
    return total;
  } finally {
    await parser.destroy().catch(() => {});
  }
}
