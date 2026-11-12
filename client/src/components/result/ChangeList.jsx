import { Check, Lock, X } from 'lucide-react';
import { BLOCK_REASON, bulletContext, usesRewrite } from '../../lib/tailoring.js';
import { ErrorBox } from '../ui/Status.jsx';

// aria-disabled (not disabled) while a choice is saving: the pressed button keeps keyboard focus,
// so a keyboard user can go straight on to the next card.
const TOGGLE =
  'inline-flex cursor-pointer items-center gap-1 border-2 border-ink px-3 py-2 font-mono text-xs font-bold uppercase aria-disabled:cursor-wait aria-disabled:opacity-60';

function Column({ label, text, active }) {
  return (
    <div className={`border-2 border-ink p-3 ${active ? 'bg-cream' : 'bg-cream text-ink/70'}`}>
      <span className="font-mono text-[10px] font-bold uppercase">
        {label}
        {active && ' · on resume'}
      </span>
      <p className="mt-1 text-sm">{text}</p>
    </div>
  );
}

// One rewrite that passed the checks: original | rewrite, with Accept / Reject.
function ReviewCard({ change, context, accepted, disabled, onDecide }) {
  return (
    <li className="border-2 border-ink bg-cream p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-xs uppercase">{context}</span>
        <div className="flex gap-2" role="group" aria-label={`Rewrite for ${context || 'this bullet'}`}>
          <button
            type="button"
            aria-pressed={accepted}
            aria-disabled={disabled || undefined}
            onClick={() => !disabled && onDecide(change.itemId, true)}
            className={`${TOGGLE} ${accepted ? 'bg-ink text-cream shadow-hard' : 'bg-cream hover:bg-ok focus-visible:bg-ok'}`}
          >
            <Check size={14} strokeWidth={3} aria-hidden="true" />
            Accept
          </button>
          <button
            type="button"
            aria-pressed={!accepted}
            aria-disabled={disabled || undefined}
            onClick={() => !disabled && onDecide(change.itemId, false)}
            className={`${TOGGLE} ${!accepted ? 'bg-ink text-cream shadow-hard' : 'bg-cream hover:bg-alert focus-visible:bg-alert'}`}
          >
            <X size={14} strokeWidth={3} aria-hidden="true" />
            Reject
          </button>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Column label="Original" text={change.original} active={!accepted} />
        <Column label="Rewrite" text={change.rewritten} active={accepted} />
      </div>
    </li>
  );
}

// A rewrite the guardrail refused. Shown so the user sees what was stopped, but it cannot be accepted.
function BlockedCard({ change, context }) {
  return (
    <li className="border-2 border-ink bg-cream p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-xs uppercase">{context}</span>
        <span className="inline-flex items-center gap-1 border-2 border-ink bg-alert px-2 py-1 font-mono text-xs font-bold uppercase">
          <Lock size={12} strokeWidth={3} aria-hidden="true" />
          Blocked
        </span>
      </div>
      <p className="mb-3 font-mono text-xs">
        {BLOCK_REASON[change.reason]}
        {change.offending?.length > 0 && (
          <>
            {': '}
            {change.offending.map((o) => (
              <mark key={o} className="mx-0.5 bg-alert px-1 text-ink">
                {o}
              </mark>
            ))}
          </>
        )}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <Column label="Original" text={change.original} active />
        <Column label="Refused rewrite" text={change.rewritten} active={false} />
      </div>
    </li>
  );
}

export default function ChangeList({ changes, resume, decisions, saving, error, onDecide }) {
  const reviewable = changes.filter((c) => c.reason === 'ok');
  const blocked = changes.filter((c) => c.reason in BLOCK_REASON);
  const untouched = changes.length - reviewable.length - blocked.length;
  const acceptedCount = reviewable.filter((c) => usesRewrite(c, decisions)).length;

  return (
    <section aria-labelledby="changes-title">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h2 id="changes-title" className="text-2xl">
          Changes
        </h2>
        <span className="font-mono text-xs uppercase" role="status">
          {saving ? 'Saving…' : `${acceptedCount} of ${reviewable.length} rewrites accepted`}
        </span>
      </div>

      {error && (
        <div className="mb-4">
          <ErrorBox message={error} />
        </div>
      )}

      {reviewable.length === 0 && blocked.length === 0 ? (
        <p className="border-2 border-ink bg-cream p-6 font-mono text-sm">
          No rewrites this time. Your resume uses your bullets exactly as written.
        </p>
      ) : (
        <ul className="space-y-4">
          {reviewable.map((c) => (
            <ReviewCard
              key={c.itemId}
              change={c}
              context={bulletContext(resume, c.itemId)}
              accepted={usesRewrite(c, decisions)}
              disabled={saving}
              onDecide={onDecide}
            />
          ))}
          {blocked.map((c) => (
            <BlockedCard key={c.itemId} change={c} context={bulletContext(resume, c.itemId)} />
          ))}
        </ul>
      )}

      {untouched > 0 && (
        <p className="mt-3 font-mono text-xs">
          {untouched} other bullet{untouched === 1 ? '' : 's'} kept exactly as written.
        </p>
      )}
    </section>
  );
}
