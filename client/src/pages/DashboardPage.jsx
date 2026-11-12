import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, FolderOpen, Plus, Trash2 } from 'lucide-react';
import { apiDelete, apiGet, apiPatch } from '../api/client.js';
import PageHeader from '../components/PageHeader.jsx';
import { ErrorBox, Loading } from '../components/ui/Status.jsx';
import { errorMessage } from '../lib/errors.js';
import { STATUSES, statusInfo } from '../lib/applicationStatus.js';

const PRIMARY_LINK =
  'inline-flex items-center gap-2 border-2 border-ink bg-ink px-4 py-2 font-mono text-xs font-bold uppercase text-cream shadow-hard active:translate-x-1 active:translate-y-1 active:shadow-none';

function EmptyState() {
  return (
    <section className="border-2 border-ink bg-cream p-8 shadow-hard">
      <div className="inline-flex border-2 border-ink bg-alert p-2">
        <FolderOpen size={22} strokeWidth={2.5} aria-hidden="true" />
      </div>
      <h2 className="mt-4 text-xl">No applications yet</h2>
      <p className="mt-2 max-w-xl text-sm">
        Each resume you tailor and save will appear here with its company, role and status.
      </p>

      <ol className="mt-6 grid gap-4 sm:grid-cols-2">
        <li className="border-2 border-ink p-4">
          <span className="font-mono text-xs uppercase">Step 1</span>
          <p className="mt-1 font-bold">Fill in your master profile</p>
          <Link to="/app/profile" className="mt-2 inline-block font-mono text-xs uppercase underline">
            Open profile
          </Link>
        </li>
        <li className="border-2 border-ink p-4">
          <span className="font-mono text-xs uppercase">Step 2</span>
          <p className="mt-1 font-bold">Paste a job description</p>
          <Link to="/app/new" className="mt-2 inline-block font-mono text-xs uppercase underline">
            Start tailoring
          </Link>
        </li>
      </ol>
    </section>
  );
}

// The row is not one big link any more: a <select> and a button cannot sit inside an <a>. The company
// and role are the link; the status and delete are separate controls next to it.
function ApplicationRow({ app, busy, onStatus, onDelete }) {
  const status = statusInfo(app.status);
  const score = app.matchScore === null ? '–' : `${Math.round(app.matchScore * 100)}%`;
  const selectId = `status-${app.id}`;
  return (
    <li
      aria-busy={busy || undefined}
      className="grid grid-cols-[1fr_auto] items-center gap-4 border-2 border-ink bg-cream p-4 hover:shadow-hard sm:grid-cols-[1fr_5rem_9rem_auto]"
    >
      <Link to={`/app/result/${app.id}`} className="group min-w-0 focus-visible:shadow-hard">
        <p className="flex items-center gap-2 font-heading text-lg font-extrabold uppercase">
          <span className="truncate">{app.company}</span>
          <ArrowRight size={18} strokeWidth={2.5} className="shrink-0 group-hover:translate-x-1 group-focus-visible:translate-x-1" aria-hidden="true" />
        </p>
        <p className="truncate text-sm">{app.role}</p>
        <p className="mt-1 font-mono text-xs">{new Date(app.createdAt).toLocaleDateString()}</p>
      </Link>

      <div className="hidden text-right sm:block">
        <span className="block font-mono text-[10px] uppercase">Match</span>
        <span className="font-heading text-2xl font-extrabold">{score}</span>
      </div>

      <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
        <label htmlFor={selectId} className="sr-only">
          Status for {app.company}, {app.role}
        </label>
        <select
          id={selectId}
          value={app.status}
          onChange={(e) => onStatus(app, e.target.value)}
          disabled={busy}
          className={`w-full cursor-pointer border-2 border-ink px-2 py-1 font-mono text-xs font-bold uppercase focus:shadow-hard focus:outline-none disabled:cursor-wait disabled:opacity-60 ${status.cls}`}
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value} className="bg-cream text-ink">
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        onClick={() => onDelete(app)}
        aria-disabled={busy || undefined}
        aria-label={`Delete ${app.company}, ${app.role}`}
        className="row-start-1 col-start-2 cursor-pointer justify-self-end border-2 border-ink bg-cream p-2 shadow-hard hover:bg-alert active:translate-x-1 active:translate-y-1 active:shadow-none aria-disabled:cursor-wait aria-disabled:opacity-60 sm:col-start-auto sm:row-start-auto"
      >
        <Trash2 size={16} strokeWidth={2.5} aria-hidden="true" />
      </button>
    </li>
  );
}

export default function DashboardPage() {
  const [applications, setApplications] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null); // the row whose status change or delete is running
  const [actionError, setActionError] = useState('');

  // `isCurrent` lets the effect ignore an answer that arrives after the page was left.
  const load = useCallback((isCurrent = () => true) => {
    setError('');
    setApplications(null);
    apiGet('/api/applications')
      .then((data) => isCurrent() && setApplications(data.applications))
      .catch((err) => isCurrent() && setError(errorMessage(err)));
  }, []);

  const replaceRow = (id, change) => setApplications((list) => list.map((a) => (a.id === id ? { ...a, ...change } : a)));

  // Optimistic: the dropdown shows the new status at once and goes back if the server refuses.
  async function handleStatus(app, status) {
    if (busyId) return;
    setBusyId(app.id);
    setActionError('');
    replaceRow(app.id, { status });
    try {
      const saved = await apiPatch(`/api/applications/${app.id}`, { status });
      replaceRow(app.id, { status: saved.status });
    } catch (err) {
      replaceRow(app.id, { status: app.status });
      setActionError(`The status of ${app.company} was not changed. ${errorMessage(err)}`);
    } finally {
      setBusyId(null);
    }
  }

  // Not optimistic: deleting cannot be undone, so the row only disappears once the server confirms.
  async function handleDelete(app) {
    if (busyId) return;
    if (!window.confirm(`Delete ${app.company} · ${app.role} and its tailored resume? This cannot be undone.`)) return;
    setBusyId(app.id);
    setActionError('');
    try {
      await apiDelete(`/api/applications/${app.id}`);
      setApplications((list) => list.filter((a) => a.id !== app.id));
    } catch (err) {
      // 404: already gone (deleted in another tab), so remove it here too.
      if (err.status === 404) setApplications((list) => list.filter((a) => a.id !== app.id));
      else setActionError(`${app.company} was not deleted. ${errorMessage(err)}`);
    } finally {
      setBusyId(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    load(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  return (
    <>
      <PageHeader tag="Dashboard" title="Your applications">
        <Link to="/app/new" className={PRIMARY_LINK}>
          <Plus size={14} strokeWidth={2.5} aria-hidden="true" />
          New tailoring
        </Link>
      </PageHeader>

      {error && <ErrorBox message={`Could not load your applications. ${error}`} onRetry={() => load()} />}
      {!error && applications === null && <Loading label="Loading your applications" />}
      {applications?.length === 0 && <EmptyState />}
      {actionError && (
        <div className="mb-4">
          <ErrorBox message={actionError} focus />
        </div>
      )}
      {applications?.length > 0 && (
        <ul className="space-y-3" aria-label="Applications, newest first">
          {applications.map((app) => (
            <ApplicationRow key={app.id} app={app} busy={busyId === app.id} onStatus={handleStatus} onDelete={handleDelete} />
          ))}
        </ul>
      )}
    </>
  );
}
