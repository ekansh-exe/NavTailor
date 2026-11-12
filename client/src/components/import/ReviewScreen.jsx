import { useEffect, useState } from 'react';
import { apiPut } from '../../api/client.js';
import ProfileForm from '../profile/ProfileForm.jsx';
import { Button, Toggle } from '../profile/ui.jsx';
import { cleanForSave, formatIssuePath } from '../profile/model.js';

// Step 2 of the import: the parsed draft in the normal profile form. Nothing is saved until
// the user presses Save, and Save uses the same PUT /api/profile (same server validation).
export default function ReviewScreen({ initialDraft, warnings, replacesExisting, onDiscard, onSaved }) {
  const [draft, setDraft] = useState(initialDraft);
  const [confirmed, setConfirmed] = useState(!replacesExisting);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null); // { message, issues? }

  // The draft only exists in this browser tab until it is saved.
  useEffect(() => {
    const warn = (e) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const data = await apiPut('/api/profile', cleanForSave(draft));
      onSaved(data.profile);
    } catch (err) {
      if (err.status === 400 && Array.isArray(err.data?.issues)) {
        setError({ message: 'Fix these fields and save again:', issues: err.data.issues });
      } else if (err.status === 401) {
        setError({ message: 'Your session expired. Sign in again, then save.' });
      } else {
        setError({ message: 'Could not save. Your edits are still here, try again.' });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-3xl">Review import</h2>
        <span className="border-2 border-ink px-2 py-1 font-mono text-xs uppercase">Draft: not saved yet</span>
      </div>

      <p className="border-2 border-ink bg-cream p-4 font-mono text-sm shadow-hard">
        This is what we read from your resume. Check every section, fix anything that is wrong, then save.
        Nothing is stored until you press Save.
      </p>

      {warnings.length > 0 && (
        <section className="border-2 border-ink bg-alert p-4 shadow-hard" aria-label="Import warnings">
          <h3 className="mb-2 text-sm">Check these ({warnings.length})</h3>
          <ul className="list-disc space-y-1 pl-5 font-mono text-xs">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </section>
      )}

      <ProfileForm profile={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} />

      {error && (
        <div role="alert" className="border-2 border-ink bg-alert p-4 shadow-hard">
          <p className="font-mono text-sm font-bold">{error.message}</p>
          {error.issues && (
            <ul className="mt-2 list-disc space-y-1 pl-5 font-mono text-xs">
              {error.issues.map((issue, i) => (
                <li key={i}>
                  {formatIssuePath(issue.path)}: {issue.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="sticky bottom-4 z-10 space-y-3 border-2 border-ink bg-cream p-4 shadow-hard">
        {replacesExisting && (
          <Toggle
            label="I understand this replaces my current profile"
            checked={confirmed}
            onChange={setConfirmed}
          />
        )}
        <div className="flex items-center justify-between gap-4">
          <Button variant="danger" onClick={onDiscard} disabled={saving}>
            Discard import
          </Button>
          <Button variant="primary" onClick={save} disabled={saving || !confirmed}>
            {saving ? 'Saving...' : 'Save profile'}
          </Button>
        </div>
      </div>
    </div>
  );
}
