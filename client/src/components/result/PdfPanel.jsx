import { Download, FileCode2, Loader2, RefreshCw } from 'lucide-react';

const ACTION =
  'inline-flex cursor-pointer items-center gap-2 border-2 border-ink px-4 py-2 font-mono text-xs font-bold uppercase shadow-hard active:translate-x-1 active:translate-y-1 active:shadow-none disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none';

// The preview and the buttons around it. All state lives in ResultPage; this only draws it.
// pdf: null, or { url, pages, fit, droppedTexts[] } for the last successful render.
export default function PdfPanel({ pdf, stale, rendering, downloadingTex, error, onRender, onDownloadPdf, onDownloadTex }) {
  const icon = (Icon) => <Icon size={14} strokeWidth={2.5} aria-hidden="true" />;

  return (
    <section aria-labelledby="pdf-title">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h3 id="pdf-title" className="text-2xl">
          PDF
        </h3>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={onRender} disabled={rendering} className={`${ACTION} bg-ink text-cream`}>
            {rendering ? (
              <Loader2 size={14} strokeWidth={2.5} className="animate-spin" aria-hidden="true" />
            ) : (
              icon(RefreshCw)
            )}
            {rendering ? 'Building…' : pdf ? 'Re-render PDF' : 'Render PDF'}
          </button>
          {/* Downloads are exactly what the preview shows, so they need a render first. */}
          <button type="button" onClick={onDownloadPdf} disabled={!pdf || rendering} className={`${ACTION} bg-cream`}>
            {icon(Download)}
            Download PDF
          </button>
          <button
            type="button"
            onClick={onDownloadTex}
            disabled={!pdf || rendering || downloadingTex}
            className={`${ACTION} bg-cream`}
          >
            {icon(FileCode2)}
            Download .tex
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mb-4 border-2 border-ink bg-alert p-3 font-mono text-sm">
          {error}
        </p>
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
          <div className="flex h-64 items-center justify-center p-6 text-center font-mono text-sm">
            {rendering ? 'Compiling LaTeX… this takes a few seconds.' : 'Render the PDF to preview it here.'}
          </div>
        )}
      </div>
    </section>
  );
}
