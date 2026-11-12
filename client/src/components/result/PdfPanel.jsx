import { Download, FileCode2, RefreshCw } from 'lucide-react';
import { ErrorBox, Spinner } from '../ui/Status.jsx';

// disabled: not possible yet (no PDF to download). aria-disabled: busy right after a press, where
// the button must keep keyboard focus. Both look the same.
const ACTION =
  'inline-flex cursor-pointer items-center gap-2 border-2 border-ink px-4 py-2 font-mono text-xs font-bold uppercase shadow-hard active:translate-x-1 active:translate-y-1 active:shadow-none disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none aria-disabled:cursor-wait aria-disabled:opacity-60 aria-disabled:shadow-none';

// The preview and the buttons around it. All state lives in ResultPage; this only draws it.
// pdf: null, or { url, pages, fit, droppedTexts[] } for the last successful render.
export default function PdfPanel({ pdf, stale, rendering, downloadingTex, error, onRender, onDownloadPdf, onDownloadTex }) {
  const icon = (Icon) => <Icon size={14} strokeWidth={2.5} aria-hidden="true" />;

  return (
    <section aria-labelledby="pdf-title">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h2 id="pdf-title" className="text-2xl">
          PDF
        </h2>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => !rendering && onRender()}
            aria-disabled={rendering || undefined}
            className={`${ACTION} bg-ink text-cream`}
          >
            {rendering ? <Spinner size={14} /> : icon(RefreshCw)}
            {rendering ? 'Building…' : pdf ? 'Re-render PDF' : 'Render PDF'}
          </button>
          {/* Downloads are exactly what the preview shows, so they need a render first. */}
          <button type="button" onClick={onDownloadPdf} disabled={!pdf || rendering} className={`${ACTION} bg-cream`}>
            {icon(Download)}
            Download PDF
          </button>
          <button
            type="button"
            onClick={() => !downloadingTex && onDownloadTex()}
            disabled={!pdf || rendering}
            aria-disabled={downloadingTex || undefined}
            className={`${ACTION} bg-cream`}
          >
            {downloadingTex ? <Spinner size={14} /> : icon(FileCode2)}
            Download .tex
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4">
          <ErrorBox message={error} />
        </div>
      )}

      {pdf && stale && !rendering && (
        <p className="mb-4 border-2 border-ink bg-cream p-3 font-mono text-sm">
          You changed your choices since this PDF was built. Re-render to include them; the
          downloads match the preview below.
        </p>
      )}

      {pdf && (pdf.fit === 'too_long' || pdf.droppedTexts.length > 0) && (
        <div className="mb-4 border-2 border-ink bg-cream p-3 font-mono text-xs">
          {pdf.fit === 'too_long' && (
            <p className="font-bold">Still {pdf.pages} pages after trimming. Reject a few long rewrites and re-render.</p>
          )}
          {pdf.droppedTexts.length > 0 && (
            <>
              <p className="font-bold uppercase">Dropped to fit one page:</p>
              <ul className="mt-1 list-inside list-disc">
                {pdf.droppedTexts.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="border-2 border-ink bg-cream shadow-hard">
        {pdf ? (
          // A blob: URL points at the PDF bytes held in this tab's memory. The browser's own PDF
          // viewer draws it inside the iframe.
          <iframe title="Resume preview" src={pdf.url} className="block h-[80vh] min-h-[32rem] w-full" />
        ) : (
          // Empty state until the first render. role="status" announces the compile progress.
          <div role="status" className="flex h-64 items-center justify-center gap-3 p-6 text-center font-mono text-sm">
            {rendering && <Spinner />}
            {rendering ? 'Compiling LaTeX… this takes a few seconds.' : 'No preview yet. Press Render PDF to build it.'}
          </div>
        )}
      </div>
    </section>
  );
}
