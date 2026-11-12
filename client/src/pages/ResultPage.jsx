import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { apiGet, apiPatch, apiPostForFile } from '../api/client.js';
import PageHeader from '../components/PageHeader.jsx';
import GapReport from '../components/result/GapReport.jsx';
import ChangeList from '../components/result/ChangeList.jsx';
import PdfPanel from '../components/result/PdfPanel.jsx';
import { applyDecisions, errorMessage, removeBullets, saveBlob, slug } from '../lib/tailoring.js';

const STATUS_LABEL = { tailored: 'New', reviewed: 'Reviewed' };

export default function ResultPage() {
  const { id } = useParams();

  const [application, setApplication] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [decisions, setDecisions] = useState({});
  const [saving, setSaving] = useState(false);
  const [decisionError, setDecisionError] = useState('');

  // pdf: { blob, url, pages, fit, droppedTexts, resume (what was compiled), sourceKey }
  const [pdf, setPdf] = useState(null);
  const [rendering, setRendering] = useState(false);
  const [downloadingTex, setDownloadingTex] = useState(false);
  const [pdfError, setPdfError] = useState('');

  // Load the application. `cancelled` stops a slow answer for an OLD id from overwriting a new one.
  useEffect(() => {
    let cancelled = false;
    setApplication(null);
    setLoadError('');
    setPdf(null);
    apiGet(`/api/applications/${id}`)
      .then(({ application: app }) => {
        if (cancelled) return;
        setApplication(app);
        setDecisions(app.decisions);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err.status === 404 ? 'not_found' : errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // A blob: URL keeps its PDF in memory until revoked. When pdf changes (re-render) or the page
  // unmounts, this cleanup frees the previous one.
  useEffect(() => {
    if (!pdf) return undefined;
    return () => URL.revokeObjectURL(pdf.url);
  }, [pdf]);

  const result = application?.result;
  const currentResume = useMemo(
    () => (result ? applyDecisions(result.resume, result.changes, decisions) : null),
    [result, decisions],
  );
  // Compares CONTENT, so rejecting then re-accepting a rewrite does not mark the PDF as out of date.
  const currentKey = useMemo(() => JSON.stringify(currentResume), [currentResume]);

  // Optimistic: the button flips at once, and flips back if the server refuses.
  async function handleDecide(itemId, useRewrite) {
    const previous = decisions;
    const next = { ...previous, [itemId]: useRewrite };
    setDecisions(next);
    setDecisionError('');
    setSaving(true);
    try {
      const saved = await apiPatch(`/api/applications/${id}/decisions`, { decisions: next });
      setApplication((app) => ({ ...app, status: saved.status }));
    } catch (err) {
      setDecisions(previous);
      setDecisionError(`Your choice was not saved. ${errorMessage(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleRender() {
    setRendering(true);
    setPdfError('');
    try {
      const { blob, headers } = await apiPostForFile('/api/resume/render', {
        resumeJson: currentResume,
        scores: result.scores,
      });
      // The fit report comes back in headers, because the body is the PDF itself.
      const dropped = (headers.get('X-Resume-Dropped') ?? '').split(',').filter(Boolean);
      const textOf = new Map(
        [...currentResume.experience, ...currentResume.projects].flatMap((item) => item.bullets.map((b) => [b.id, b.text])),
      );
      setPdf({
        blob,
        url: URL.createObjectURL(blob),
        pages: Number(headers.get('X-Resume-Pages')) || null,
        fit: headers.get('X-Resume-Fit') ?? 'unknown',
        droppedTexts: dropped.map((d) => textOf.get(d)).filter(Boolean),
        // What was really compiled: the .tex download uses this, so it matches the PDF exactly.
        resume: removeBullets(currentResume, dropped),
        sourceKey: currentKey,
      });
    } catch (err) {
      setPdfError(
        errorMessage(err, {
          busy: 'The PDF builder is busy. Try again in a few seconds.',
        }),
      );
    } finally {
      setRendering(false);
    }
  }

  const fileBase = application ? slug(application.company, application.role) : 'resume';

  async function handleDownloadTex() {
    setDownloadingTex(true);
    setPdfError('');
    try {
      const { blob } = await apiPostForFile('/api/resume/tex', { resumeJson: pdf.resume });
      saveBlob(blob, `${fileBase}.tex`);
    } catch (err) {
      setPdfError(errorMessage(err));
    } finally {
      setDownloadingTex(false);
    }
  }

  if (loadError === 'not_found') {
    return (
      <>
        <PageHeader tag="Result" title="Not found" />
        <p className="font-mono text-sm">
          This application does not exist, or it is not yours.{' '}
          <Link to="/app" className="font-bold underline">
            Back to the dashboard
          </Link>
        </p>
      </>
    );
  }
  if (loadError) {
    return (
      <p role="alert" className="border-2 border-ink bg-alert p-4 font-mono text-sm">
        {loadError}
      </p>
    );
  }
  if (!application) return <p className="font-mono text-sm">Loading…</p>;

  return (
    <div className="space-y-12">
      <div>
        <Link to="/app" className="mb-4 inline-flex items-center gap-1 font-mono text-xs uppercase underline">
          <ArrowLeft size={12} strokeWidth={2.5} aria-hidden="true" />
          Dashboard
        </Link>
        <PageHeader tag={application.company} title={application.role}>
          <span className="border-2 border-ink px-2 py-1 font-mono text-xs uppercase">
            {STATUS_LABEL[application.status] ?? application.status} ·{' '}
            {new Date(application.createdAt).toLocaleDateString()}
          </span>
        </PageHeader>
        {result.warnings.includes('rewrite_unavailable') && (
          <p className="border-2 border-ink bg-cream p-3 font-mono text-sm">
            The rewrite step was unavailable, so your resume uses your bullets exactly as written.
          </p>
        )}
      </div>

      <GapReport gapReport={result.gapReport} questions={result.questions} resume={result.resume} />

      <ChangeList
        changes={result.changes}
        resume={result.resume}
        decisions={decisions}
        saving={saving}
        error={decisionError}
        onDecide={handleDecide}
      />

      <PdfPanel
        pdf={pdf}
        stale={pdf !== null && pdf.sourceKey !== currentKey}
        rendering={rendering}
        downloadingTex={downloadingTex}
        error={pdfError}
        onRender={handleRender}
        onDownloadPdf={() => saveBlob(pdf.blob, `${fileBase}.pdf`)}
        onDownloadTex={handleDownloadTex}
      />
    </div>
  );
}
