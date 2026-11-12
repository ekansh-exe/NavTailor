import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Loader2, Wand2 } from 'lucide-react';
import { apiPost } from '../api/client.js';
import PageHeader from '../components/PageHeader.jsx';
import { errorMessage } from '../lib/tailoring.js';

// Same limits as the server (routes/tailor.js). The server checks again; this only gives early feedback.
const MIN_JD = 50;
const MAX_JD = 15_000;
const MAX_SHORT = 200;

const INPUT =
  'w-full border-2 border-ink bg-cream px-3 py-2 font-mono text-sm placeholder:text-ink/50 focus:shadow-hard focus:outline-none disabled:opacity-50';
const LABEL = 'mb-1 block font-mono text-xs font-bold uppercase';

// Server codes that need a different next step than "try again".
const PROFILE_CODES = new Set(['no_profile', 'empty_profile']);

export default function NewTailoringPage() {
  const navigate = useNavigate();
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null); // { message, code }

  const jdLength = jobDescription.trim().length;
  const jdOk = jdLength >= MIN_JD && jdLength <= MAX_JD;
  const canSubmit = company.trim() && role.trim() && jdOk && !submitting;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      // The server tailors AND saves, then answers with the new application's id.
      const { id } = await apiPost('/api/applications', { company, role, jobDescription });
      navigate(`/app/result/${id}`);
    } catch (err) {
      setError({
        code: err.data?.code,
        message: errorMessage(err, {
          no_profile: 'You have no saved profile yet. Fill it in first.',
          empty_profile: 'Your profile is empty. Add your experience first.',
          llm: 'The AI services did not answer. Wait a minute and try again.',
          bad_application: `Fill in the company and role, and paste a job description of ${MIN_JD} to ${MAX_JD.toLocaleString()} characters.`,
        }),
      });
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader tag="New tailoring" title="Tailor a resume" />

      <form onSubmit={handleSubmit} className="space-y-5 border-2 border-ink bg-cream p-6 shadow-hard sm:p-8">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="company" className={LABEL}>
              Company
            </label>
            <input
              id="company"
              className={INPUT}
              value={company}
              maxLength={MAX_SHORT}
              onChange={(e) => setCompany(e.target.value)}
              disabled={submitting}
              autoComplete="off"
              required
            />
          </div>
          <div>
            <label htmlFor="role" className={LABEL}>
              Role
            </label>
            <input
              id="role"
              className={INPUT}
              value={role}
              maxLength={MAX_SHORT}
              onChange={(e) => setRole(e.target.value)}
              disabled={submitting}
              autoComplete="off"
              required
            />
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-baseline justify-between gap-4">
            <label htmlFor="jd" className={LABEL}>
              Job description
            </label>
            <span
              className={`font-mono text-xs ${jdLength > MAX_JD ? 'bg-alert px-1' : ''}`}
              aria-live="polite"
            >
              {jdLength.toLocaleString()} / {MAX_JD.toLocaleString()}
              {jdLength > 0 && jdLength < MIN_JD && ` · at least ${MIN_JD}`}
            </span>
          </div>
          <textarea
            id="jd"
            className={`${INPUT} min-h-72 resize-y`}
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            disabled={submitting}
            placeholder="Paste the full job post: responsibilities, requirements, nice-to-haves."
            required
          />
        </div>

        {error && (
          <div role="alert" className="border-2 border-ink bg-alert p-4 font-mono text-sm">
            {error.message}
            {PROFILE_CODES.has(error.code) && (
              <Link to="/app/profile" className="ml-2 font-bold underline">
                Open profile
              </Link>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex cursor-pointer items-center gap-2 border-2 border-ink bg-ink px-6 py-3 font-mono text-sm font-bold uppercase text-cream shadow-hard active:translate-x-1 active:translate-y-1 active:shadow-none disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
          >
            {submitting ? (
              <Loader2 size={16} strokeWidth={2.5} className="animate-spin" aria-hidden="true" />
            ) : (
              <Wand2 size={16} strokeWidth={2.5} aria-hidden="true" />
            )}
            {submitting ? 'Tailoring…' : 'Tailor my resume'}
          </button>
          {submitting && (
            <p className="font-mono text-xs" aria-live="polite">
              Reading the job post, ranking your bullets and rewriting. This can take up to a minute.
            </p>
          )}
        </div>
      </form>
    </>
  );
}
