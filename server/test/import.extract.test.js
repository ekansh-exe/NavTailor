// Type detection and text extraction on real (tiny, generated) PDF and DOCX files.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { detectType } from '../src/import/detectType.js';
import { extractText, ExtractError } from '../src/import/extractText.js';
import { makePdf, makeDocx, makePlainZip, makeManyEntriesDocx } from './helpers/makeFiles.js';

const LINES = ['Jane Doe', 'Software Engineer at Acme Corp', 'Built a React dashboard'];

describe('detectType (magic bytes, not names)', () => {
  test('recognises a real PDF and a real DOCX', async () => {
    assert.equal(await detectType(makePdf(LINES)), 'pdf');
    assert.equal(await detectType(await makeDocx(LINES)), 'docx');
  });

  test('rejects a plain ZIP, HTML, a Windows executable and junk', async () => {
    assert.equal(await detectType(await makePlainZip()), null);
    assert.equal(await detectType(Buffer.from('<html><script>alert(1)</script></html>')), null);
    assert.equal(await detectType(Buffer.from('MZ\x90\x00\x03\x00\x00\x00 fake exe')), null);
    assert.equal(await detectType(Buffer.from('')), null);
    assert.equal(await detectType(Buffer.from('just some text')), null);
  });
});

describe('extractText (in a worker thread)', () => {
  test('reads text from a PDF', async () => {
    const text = await extractText('pdf', makePdf(LINES));
    assert.match(text, /Jane Doe/);
    assert.match(text, /Acme Corp/);
  });

  test('reads text from a DOCX', async () => {
    const text = await extractText('docx', await makeDocx(LINES));
    assert.match(text, /Jane Doe/);
    assert.match(text, /React dashboard/);
  });

  test('a PDF with no text layer extracts to (almost) nothing instead of failing', async () => {
    const text = await extractText('pdf', makePdf([]));
    assert.ok(text.trim().length < 5);
  });

  test('a corrupt PDF is "unreadable", and the error carries no file content', async () => {
    const corrupt = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('SECRET-RESUME-CONTENT garbage')]);
    await assert.rejects(extractText('pdf', corrupt), (err) => {
      assert.ok(err instanceof ExtractError);
      assert.equal(err.code, 'unreadable');
      assert.ok(!err.message.includes('SECRET'));
      return true;
    });
  });

  test('a ZIP with an absurd number of entries is refused before any unzipping', async () => {
    await assert.rejects(extractText('docx', await makeManyEntriesDocx()), { code: 'zip_too_many_entries' });
  });

  test('the timeout stops a worker that takes too long', async () => {
    await assert.rejects(extractText('pdf', makePdf(LINES), { timeoutMs: 1 }), { code: 'timeout' });
  });
});
