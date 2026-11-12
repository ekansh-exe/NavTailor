import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, FolderOpen, Plus } from 'lucide-react';
import { apiGet } from '../api/client.js';
import PageHeader from '../components/PageHeader.jsx';
import { ErrorBox, Loading } from '../components/ui/Status.jsx';
import { errorMessage } from '../lib/errors.js';

const PRIMARY_LINK =
  'inline-flex items-center gap-2 border-2 border-ink bg-ink px-4 py-2 font-mono text-xs font-bold uppercase text-cream shadow-hard active:translate-x-1 active:translate-y-1 active:shadow-none';

const STATUS = {
  tailored: { label: 'New', cls: 'bg-cream' },
  reviewed: { label: 'Reviewed', cls: 'bg-ok' },
};

function EmptyState() {
  return (
    <section className="border-2 border-ink bg-cream p-8 shadow-hard">
      <div className="inline-flex border-2 border-ink bg-alert p-2">
        <FolderOpen size={22} strokeWidth={2.5} aria-hidden="true" />
      </div>
      <h2 className="mt-4 text-xl">No applications yet</h2>
      <p className="mt-2 max-w-xl text-sm">
        Each resume you tailor will appear here with its company, role and status.
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

function ApplicationRow({ app }) {
  const status = STATUS[app.status] ?? { label: app.status, cls: 'bg-cream' };
  const score = app.matchScore === null ? '–' : `${Math.round(app.matchScore * 100)}%`;
  return (
    <li>
      <Link
        to={`/app/result/${app.id}`}
        className="group grid grid-cols-[1fr_auto] items-center gap-4 border-2 border-ink bg-cream p-4 hover:shadow-hard focus-visible:shadow-hard sm:grid-cols-[1fr_5rem_7rem_auto]"
      >
        <div className="min-w-0">
          <p className="truncate font-heading text-lg font-extrabold uppercase">{app.company}</p>
          <p className="truncate text-sm">{app.role}</p>
          <p className="mt-1 font-mono text-xs">{new Date(app.createdAt).toLocaleDateString()}</p>
        </div>
        <div className="hidden text-right sm:block">
          <span className="block font-mono text-[10px] uppercase">Match</span>
          <span className="font-heading text-2xl font-extrabold">{score}</span>
        </div>
        <span className={`hidden justify-self-start border-2 border-ink px-2 py-1 font-mono text-xs font-bold uppercase sm:inline ${status.cls}`}>
          {status.label}
        </span>
        <ArrowRight size={20} strokeWidth={2.5} className="group-hover:translate-x-1 group-focus-visible:translate-x-1" aria-hidden="true" />
      </Link>
    </li>
  );
}

export default function DashboardPage() {
  const [applications, setApplications] = useState(null);
  const [error, setError] = useState('');

  // `isCurrent` lets the effect ignore an answer that arrives after the page was left.
  const load = useCallback((isCurrent = () => true) => {
    setError('');
    setApplications(null);
    apiGet('/api/applications')
      .then((data) => isCurrent() && setApplications(data.applications))
      .catch((err) => isCurrent() && setError(errorMessage(err)));
  }, []);

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
      {applications?.length > 0 && (
        <ul className="space-y-3" aria-label="Applications, newest first">
          {applications.map((app) => (
            <ApplicationRow key={app.id} app={app} />
          ))}
        </ul>
      )}
    </>
  );
}
