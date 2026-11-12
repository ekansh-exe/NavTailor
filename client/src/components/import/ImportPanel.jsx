import { useRef, useState } from 'react';
import { apiPost, apiUpload } from '../../api/client.js';
import { Button, Section, TextArea } from '../profile/ui.jsx';
import ReviewScreen from './ReviewScreen.jsx';
import {
  MAX_PASTE_CHARS,
  checkFile,
  checkPasted,
  describeImportError,
  formatSize,
} from './importErrors.js';

// Import flow: 1) choose a file or paste text  2) review the parsed draft  3) save.
// `onSaved(profile)` is called after the user saved the reviewed draft.
export default function ImportPanel({ replacesExisting, onCancel, onSaved }) {
  const [mode, setMode] = useState('file'); // 'file' | 'paste'
  const [file, setFile] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null); // { message, offerPaste? }
  const [result, setResult] = useState(null); // { draft, warnings } once parsed
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  function pickFile(picked) {
    if (!picked) return;
    const problem = checkFile(picked);
    if (problem) {
      setFile(null);
      setError({ message: problem });
      return;
    }
    setFile(picked);
    setError(null);
  }

  async function submit() {
    setError(null);
    if (mode === 'paste') {
      const tooShort = checkPasted(text);
      if (tooShort) return setError(tooShort);
    }

    setBusy(true);
    try {
      const data =
        mode === 'file'
          ? await apiUpload('/api/profile/import', file)
          : await apiPost('/api/profile/import', { text: text.trim() });
      setResult({ draft: data.draft, warnings: data.warnings ?? [] });
    } catch (err) {
      setError(describeImportError(err));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <ReviewScreen
        initialDraft={result.draft}
        warnings={result.warnings}
        replacesExisting={replacesExisting}
        onDiscard={() => setResult(null)}
        onSaved={onSaved}
      />
    );
  }

  const canSubmit = !busy && (mode === 'file' ? file !== null : text.trim().length > 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-3xl">Import from resume</h2>
        <Button onClick={onCancel} disabled={busy}>
          Back to profile
        </Button>
      </div>

      <Section title="Your resume" tag="Step 1 of 2">
        <div className="flex gap-3" role="group" aria-label="Import method">
          <Button
            variant={mode === 'file' ? 'primary' : 'secondary'}
            aria-pressed={mode === 'file'}
            onClick={() => setMode('file')}
            disabled={busy}
          >
            Upload file
          </Button>
          <Button
            variant={mode === 'paste' ? 'primary' : 'secondary'}
            aria-pressed={mode === 'paste'}
            onClick={() => setMode('paste')}
            disabled={busy}
          >
            Paste text
          </Button>
        </div>

        {mode === 'file' ? (
          <div>
            {/* The real <input> is visually hidden; the label is the click and drop target. */}
            <input
              ref={inputRef}
              id="resume-file"
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                pickFile(e.target.files?.[0]);
                e.target.value = ''; // lets you pick the same file again after an error
              }}
            />
            <label
              htmlFor="resume-file"
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (!busy) pickFile(e.dataTransfer.files?.[0]);
              }}
              className={`block cursor-pointer border-2 border-ink p-8 text-center focus-within:shadow-hard has-[:focus-visible]:shadow-hard ${
                dragging ? 'bg-ink text-cream shadow-hard' : 'bg-cream'
              }`}
            >
              <span className="block font-heading text-lg uppercase">
                {file ? file.name : 'Drop your resume here'}
              </span>
              <span className="mt-2 block font-mono text-xs uppercase">
                {file ? formatSize(file.size) : 'or click to choose a file · PDF or DOCX · max 2 MB'}
              </span>
            </label>
            {file && (
              <Button className="mt-3" variant="danger" onClick={() => setFile(null)} disabled={busy}>
                Remove file
              </Button>
            )}
          </div>
        ) : (
          <TextArea
            label="Resume text"
            value={text}
            onChange={setText}
            maxLength={MAX_PASTE_CHARS}
            rows={14}
            placeholder="Paste the full text of your resume here"
          />
        )}

        {error && (
          <div role="alert" className="border-2 border-ink bg-alert p-4 shadow-hard">
            <p className="font-mono text-sm font-bold">{error.message}</p>
            {error.offerPaste && (
              <Button
                className="mt-3"
                onClick={() => {
                  setMode('paste');
                  setError(null);
                }}
              >
                Paste text instead
              </Button>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          <span className="font-mono text-xs uppercase" role="status">
            {busy ? 'Reading your resume. This can take up to a minute...' : 'Nothing is saved yet'}
          </span>
          <Button variant="primary" onClick={submit} disabled={!canSubmit}>
            {busy ? 'Parsing...' : 'Parse resume'}
          </Button>
        </div>
      </Section>
    </div>
  );
}
