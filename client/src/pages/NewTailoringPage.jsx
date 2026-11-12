import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Wand2 } from 'lucide-react';
import { apiPost } from '../api/client.js';
import PageHeader from '../components/PageHeader.jsx';
import { ErrorBox, Spinner } from '../components/ui/Status.jsx';
import { errorMessage } from '../lib/errors.js';

// Same limits as the server (routes/tailor.js). The server checks again; this only gives early feedback.
const MIN_JD = 50;
const MAX_JD = 15_000;
const MAX_SHORT = 200;

const INPUT =
  'w-full border-2 border-ink bg-cream px-3 py-2 font-mono text-sm placeholder:text-ink/70 focus:shadow-hard focus:outline-none disabled:opacity-50 aria-invalid:bg-alert/30';
const LABEL = 'mb-1 block font-mono text-xs font-bold uppercase';

// Server codes that need a different next step than "try again".
const PROFILE_CODES = new Set(['no_profile', 'empty_profile']);

// What is still missing, in words. '' when the form can be sent.
function problems({ company, role, jdLength }) {
  const list = [];
  if (!company.trim()) list.push('the company');
  if (!role.trim()) list.push('the role');
  if (jdLength < MIN_JD) list.push(`a job description of at least ${MIN_JD} characters`);
  if (jdLength > MAX_JD) return `The job description is over ${MAX_JD.toLocaleString()} characters. Trim it and try again.`;
  return list.length ? `Add ${list.join(', ')}.` : '';
}

export default function NewTailoringPage() {
  const navigate = useNavigate();
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null); // { message, code }
  const [triedSubmit, setTriedSubmit] = useState(false);

  const jdLength = jobDescription.trim().length;

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setTriedSubmit(true);

    // The button is never disabled: pressing it with gaps explains what is missing (and moves
    // focus to that message) instead of doing nothing silently.
    const missing = problems({ company, role, jdLength });
    if (missing) {
      setError({ message: missing });
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      // The server tailors but SAVES NOTHING. The result (and the token that lets the server trust it
      // again later) travels to the result page in router state; Save there creates the application.
      const { saveToken, ...result } = await apiPost('/api/tailor', { jobDescription });
      navigate('/app/result/draft', {
        state: { company: company.trim(), role: role.trim(), jdText: jobDescription.trim(), result, saveToken },
      });
    } catch (err) {
      setError({
        code: err.data?.code,
        message: errorMessage(err, {
          no_profile: 'You have no saved profile yet. Fill it in first.',
          empty_profile: 'Your profile is empty. Add your experience first.',
          bad_job_description: `Paste a job description of ${MIN_JD} to ${MAX_JD.toLocaleString()} characters.`,
        }),
      });
      setSubmitting(false);
    }
  }

  // Fields are marked invalid only after a submit attempt, not while the user is still typing.
  const invalid = (bad) => (triedSubmit && bad) || undefined;

  return (
    <>
      <PageHeader tag="New tailoring" title="Tailor a resume" />

      <form
        onSubmit={handleSubmit}
        noValidate
        aria-busy={submitting || undefined}
        className="space-y-5 border-2 border-ink bg-cream p-6 shadow-hard sm:p-8"
      >
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
              readOnly={submitting}
              aria-invalid={invalid(!company.trim())}
              autoComplete="organization"
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
              readOnly={submitting}
              aria-invalid={invalid(!role.trim())}
              autoComplete="organization-title"
              required
            />
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-baseline justify-between gap-4">
            <label htmlFor="jd" className={LABEL}>
              Job description
            </label>
            <span id="jd-count" className={`font-mono text-xs ${jdLength > MAX_JD ? 'bg-alert px-1' : ''}`}>
              {jdLength.toLocaleString()} / {MAX_JD.toLocaleString()}
              {jdLength > 0 && jdLength < MIN_JD && ` · at least ${MIN_JD}`}
            </span>
          </div>
          <textarea
            id="jd"
            className={`${INPUT} min-h-72 resize-y`}
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            readOnly={submitting}
            aria-describedby="jd-count"
            aria-invalid={invalid(jdLength < MIN_JD || jdLength > MAX_JD)}
            placeholder="Paste the full job post: responsibilities, requirements, nice-to-haves."
            required
          />
        </div>

        {error && (
          <ErrorBox message={error.message} focus>
            {PROFILE_CODES.has(error.code) && (
              <Link to="/app/profile" className="mt-2 inline-block font-mono text-sm font-bold underline">
                Open profile
              </Link>
            )}
          </ErrorBox>
        )}

        <div className="flex flex-wrap items-center gap-4">
          {/* aria-disabled, not disabled: the button keeps keyboard focus while the request runs. */}
          <button
            type="submit"
            aria-disabled={submitting || undefined}
            className="inline-flex cursor-pointer items-center gap-2 border-2 border-ink bg-ink px-6 py-3 font-mono text-sm font-bold uppercase text-cream shadow-hard active:translate-x-1 active:translate-y-1 active:shadow-none aria-disabled:cursor-wait aria-disabled:opacity-60 aria-disabled:shadow-none"
          >
            {submitting ? <Spinner /> : <Wand2 size={16} strokeWidth={2.5} aria-hidden="true" />}
            {submitting ? 'Tailoring…' : 'Tailor my resume'}
          </button>
          {/* role="status": read out once when it appears, without stealing focus. */}
          <p role="status" className="font-mono text-xs">
            {submitting && 'Reading the job post, ranking your bullets and rewriting. This can take up to a minute.'}
          </p>
        </div>
      </form>
    </>
  );
}
