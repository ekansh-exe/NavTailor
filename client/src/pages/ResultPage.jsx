import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Save } from 'lucide-react';
import { apiGet, apiPatch, apiPost, apiPostForFile } from '../api/client.js';
import PageHeader from '../components/PageHeader.jsx';
import { ErrorBox, Loading, Spinner } from '../components/ui/Status.jsx';
import GapReport from '../components/result/GapReport.jsx';
import ChangeList from '../components/result/ChangeList.jsx';
import PdfPanel from '../components/result/PdfPanel.jsx';
import { applyDecisions, removeBullets, saveBlob, slug } from '../lib/tailoring.js';
import { statusInfo } from '../lib/applicationStatus.js';
import { errorMessage } from '../lib/errors.js';

// Two modes:
//   draft  (/app/result/draft): a result straight from POST /api/tailor, carried in router state.
//          Nothing is saved yet. Decisions stay in memory; Save sends everything to the server.
//   saved  (/app/result/:id): loads the application and its newest resume version. Decisions are
//          saved on the version as they are made.
export default function ResultPage({ draft = false }) {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const draftState = draft ? location.state : null;

  // view: { company, role, status, createdAt, result, versionId } for both modes.
  const [view, setView] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0); // bump to retry a failed load
  const [decisions, setDecisions] = useState({});
  const [saving, setSaving] = useState(false);
  const [decisionError, setDecisionError] = useState('');
  const [savingApp, setSavingApp] = useState(false);
  const [saveError, setSaveError] = useState('');

  // pdf: { blob, url, pages, fit, droppedTexts, resume (what was compiled), sourceKey }
  const [pdf, setPdf] = useState(null);
  const [rendering, setRendering] = useState(false);
  const [downloadingTex, setDownloadingTex] = useState(false);
  const [pdfError, setPdfError] = useState('');

  // Draft: take the result from router state (it survives a refresh, it is stored in browser history).
  useEffect(() => {
    if (!draft) return;
    setPdf(null);
    if (!draftState?.result) {
      setLoadError('no_draft');
      return;
    }
    setView({ company: draftState.company, role: draftState.role, status: null, createdAt: null, result: draftState.result });
    setDecisions({});
  }, [draft, draftState]);

  // Saved: load the application. `cancelled` stops a slow answer for an OLD id from overwriting a new one.
  useEffect(() => {
    if (draft) return undefined;
    let cancelled = false;
    setView(null);
    setLoadError('');
    setPdf(null);
    apiGet(`/api/applications/${id}`)
      .then(({ application: app, version }) => {
        if (cancelled) return;
        if (!version) {
          setLoadError('This application has no saved resume.');
          return;
        }
        setView({ company: app.company, role: app.role, status: app.status, createdAt: app.createdAt, result: version.result, versionId: version.id });
        setDecisions(version.decisions);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err.status === 404 ? 'not_found' : errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [draft, id, reloadKey]);

  // An unsaved draft is lost if the tab closes: ask the browser to warn first.
  useEffect(() => {
    if (!draft || !view) return undefined;
    const warn = (e) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draft, view]);

  // A blob: URL keeps its PDF in memory until revoked. When pdf changes (re-render) or the page
  // unmounts, this cleanup frees the previous one.
  useEffect(() => {
    if (!pdf) return undefined;
    return () => URL.revokeObjectURL(pdf.url);
  }, [pdf]);

  const result = view?.result;
  const currentResume = useMemo(
    () => (result ? applyDecisions(result.resume, result.changes, decisions) : null),
    [result, decisions],
  );
  // Compares CONTENT, so rejecting then re-accepting a rewrite does not mark the PDF as out of date.
  const currentKey = useMemo(() => JSON.stringify(currentResume), [currentResume]);

  async function handleDecide(itemId, useRewrite) {
    const previous = decisions;
    const next = { ...previous, [itemId]: useRewrite };
    setDecisions(next);
    setDecisionError('');
    // A draft only remembers the choice; it is sent with Save.
    if (draft) return;

    // Optimistic: the button flips at once, and flips back if the server refuses.
    setSaving(true);
    try {
      await apiPatch(`/api/applications/${id}/versions/${view.versionId}/decisions`, { decisions: next });
    } catch (err) {
      setDecisions(previous);
      setDecisionError(`Your choice was not saved. ${errorMessage(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (savingApp) return;
    setSavingApp(true);
    setSaveError('');
    try {
      const { company, role, jdText, result: signed, saveToken } = draftState;
      // The server checks saveToken against this exact result, then builds the resume itself.
      const { id: newId } = await apiPost('/api/applications', { company, role, jdText, result: signed, saveToken, decisions });
      // replace: Back should not return to the unsaved draft.
      navigate(`/app/result/${newId}`, { replace: true });
    } catch (err) {
      setSaveError(
        errorMessage(err, {
          token_expired: 'This result is more than 2 hours old and can no longer be saved. Tailor it again.',
          bad_token: 'This result could not be verified. Tailor it again.',
          too_many_applications: err.data?.error,
        }),
      );
      setSavingApp(false);
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

  const fileBase = view ? slug(view.company, view.role) : 'resume';

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

  if (loadError === 'not_found' || loadError === 'no_draft') {
    return (
      <>
        <PageHeader tag="Result" title="Not found" />
        <p className="font-mono text-sm">
          {loadError === 'no_draft'
            ? 'There is no unsaved result to show. Results are kept only until you save them. '
            : 'This application does not exist, or it is not yours. '}
          <Link to={loadError === 'no_draft' ? '/app/new' : '/app'} className="font-bold underline">
            {loadError === 'no_draft' ? 'Tailor a resume' : 'Back to the dashboard'}
          </Link>
        </p>
      </>
    );
  }
  if (loadError) {
    return (
      <ErrorBox
        message={`Could not load this application. ${loadError}`}
        onRetry={() => setReloadKey((k) => k + 1)}
      />
    );
  }
  if (!view) return <Loading label="Loading your tailored resume" />;

  const status = view.status && statusInfo(view.status);

  return (
    <div className="space-y-12">
      <div>
        <Link to="/app" className="mb-4 inline-flex items-center gap-1 font-mono text-xs uppercase underline">
          <ArrowLeft size={12} strokeWidth={2.5} aria-hidden="true" />
          Dashboard
        </Link>
        <PageHeader tag={view.company} title={view.role}>
          {draft ? (
            <span className="border-2 border-ink bg-pending px-2 py-1 font-mono text-xs font-bold uppercase">Not saved</span>
          ) : (
            <span className={`border-2 border-ink px-2 py-1 font-mono text-xs uppercase ${status.cls}`}>
              {status.label} · {new Date(view.createdAt).toLocaleDateString()}
            </span>
          )}
        </PageHeader>

        {draft && (
          <section aria-label="Save this result" className="mb-6 flex flex-wrap items-center gap-4 border-2 border-ink bg-cream p-4 shadow-hard">
            <p className="min-w-0 flex-1 font-mono text-sm">
              Review the changes, then save. Saving adds this job to your dashboard with your choices.
            </p>
            {/* aria-disabled, not disabled: the button keeps keyboard focus while the request runs. */}
            <button
              type="button"
              onClick={handleSave}
              aria-disabled={savingApp || undefined}
              className="inline-flex cursor-pointer items-center gap-2 border-2 border-ink bg-ink px-5 py-2 font-mono text-sm font-bold uppercase text-cream shadow-hard active:translate-x-1 active:translate-y-1 active:shadow-none aria-disabled:cursor-wait aria-disabled:opacity-60 aria-disabled:shadow-none"
            >
              {savingApp ? <Spinner /> : <Save size={16} strokeWidth={2.5} aria-hidden="true" />}
              {savingApp ? 'Saving…' : 'Save application'}
            </button>
            {saveError && (
              <div className="basis-full">
                <ErrorBox message={saveError} focus />
              </div>
            )}
          </section>
        )}

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
