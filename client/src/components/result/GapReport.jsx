import { CircleHelp } from 'lucide-react';
import { bulletContext } from '../../lib/tailoring.js';

const GROUP_LABEL = { required: 'Req', preferred: 'Pref', keyword: 'Kw' };
const GROUP_ORDER = { required: 0, preferred: 1, keyword: 2 };
const byGroup = (a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group];

function Chip({ term, group, tone, note }) {
  const tones = {
    matched: 'bg-cream',
    offPage: 'bg-cream text-ink/70',
    missing: 'bg-alert',
  };
  return (
    <li className={`inline-flex items-center gap-2 border-2 border-ink px-2 py-1 text-sm ${tones[tone]}`}>
      <span className="font-bold">{term}</span>
      <span className="font-mono text-[10px] uppercase">{GROUP_LABEL[group]}</span>
      {note && <span className="font-mono text-[10px] uppercase">· {note}</span>}
    </li>
  );
}

// The score, matched keywords (with "in your profile but not on the page") and missing keywords.
// Missing terms are only REPORTED: the pipeline never adds them to the resume.
export default function GapReport({ gapReport, questions, resume }) {
  const { matchScore, requiredMatched, requiredTotal, matched, missing } = gapReport;
  const percent = matchScore === null ? null : Math.round(matchScore * 100);

  return (
    <section className="border-2 border-ink bg-cream shadow-hard" aria-labelledby="gap-title">
      <div className="grid sm:grid-cols-[14rem_1fr]">
        <div className="border-b-2 border-ink bg-ink p-6 text-cream sm:border-b-0 sm:border-r-2">
          <span className="font-mono text-xs uppercase">Match score</span>
          <p className="mt-2 font-heading text-6xl font-extrabold">
            {percent === null ? 'N/A' : `${percent}%`}
          </p>
          <p className="mt-2 font-mono text-xs">
            {requiredTotal
              ? `${requiredMatched} of ${requiredTotal} required skills in your profile`
              : 'The job lists no required skills'}
          </p>
        </div>

        <div className="space-y-6 p-6">
          <h2 id="gap-title" className="text-xl">
            Gap report
          </h2>

          <div>
            <h3 className="mb-2 font-mono text-xs font-bold uppercase">
              Matched ({matched.length})
            </h3>
            {matched.length ? (
              <ul className="flex flex-wrap gap-2">
                {[...matched].sort(byGroup).map((m) => (
                  <Chip
                    key={`${m.group}-${m.term}`}
                    term={m.term}
                    group={m.group}
                    tone={m.onResume ? 'matched' : 'offPage'}
                    note={m.onResume ? null : 'not on page'}
                  />
                ))}
              </ul>
            ) : (
              <p className="font-mono text-sm">None of the job's terms are in your profile yet.</p>
            )}
          </div>

          <div>
            <h3 className="mb-2 font-mono text-xs font-bold uppercase">
              Missing ({missing.length})
            </h3>
            {missing.length ? (
              <>
                <ul className="flex flex-wrap gap-2">
                  {[...missing].sort(byGroup).map((m) => (
                    <Chip key={`${m.group}-${m.term}`} term={m.term} group={m.group} tone="missing" />
                  ))}
                </ul>
                <p className="mt-3 font-mono text-xs">
                  These are not added to your resume. If you really have one, add it to your profile
                  and tailor again.
                </p>
              </>
            ) : (
              <p className="font-mono text-sm">Nothing missing. Your profile covers every term.</p>
            )}
          </div>
        </div>
      </div>

      <div className="border-t-2 border-ink p-6">
        <h3 className="mb-3 flex items-center gap-2 font-mono text-xs font-bold uppercase">
          <CircleHelp size={14} strokeWidth={2.5} aria-hidden="true" />
          Add a number to make these stronger
        </h3>
        {questions.length === 0 ? (
          <p className="font-mono text-sm">Every bullet on this resume already has a number. Nothing to add.</p>
        ) : (
          <>
          <ul className="space-y-3">
            {questions.map((q) => (
              <li key={q.itemId} className="border-2 border-ink p-3 text-sm">
                <span className="font-mono text-[10px] uppercase">{bulletContext(resume, q.itemId)}</span>
                <p className="mt-1">{q.question}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 font-mono text-xs">
            Answers go in your profile, never straight onto this resume.
          </p>
          </>
        )}
      </div>
    </section>
  );
}
