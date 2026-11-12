import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPut } from '../api/client.js';
import ProfileForm from '../components/profile/ProfileForm.jsx';
import ImportPanel from '../components/import/ImportPanel.jsx';
import { Button } from '../components/profile/ui.jsx';
import { cleanForSave, formatIssuePath, isProfileEmpty } from '../components/profile/model.js';

// The master profile editor. The whole profile lives in ONE state object. Each section
// receives its slice plus an onChange that swaps that slice for a new copy.
export default function ProfilePage() {
  const [profile, setProfile] = useState(null);
  // JSON of the last version the server confirmed, to know if there are unsaved edits.
  const [savedJson, setSavedJson] = useState('');
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null); // { ok: true } | { ok: false, message, issues }
  const [importing, setImporting] = useState(false); // true while the import flow replaces the editor

  const load = useCallback(async () => {
    setLoadError('');
    try {
      // The server creates an empty profile on first GET, so this always returns one.
      const data = await apiGet('/api/profile');
      setProfile(data.profile);
      setSavedJson(JSON.stringify(data.profile));
    } catch (err) {
      setLoadError(
        err.status === 401 ? 'Your session expired. Sign in again.' : 'Could not load your profile.',
      );
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = profile !== null && JSON.stringify(profile) !== savedJson;

  // Browser's "Leave site? Changes may not be saved" prompt while there are unsaved edits.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const update = (patch) => {
    setProfile((p) => ({ ...p, ...patch }));
    setSaveResult(null);
  };

  async function save() {
    const sent = profile;
    setSaving(true);
    setSaveResult(null);
    try {
      const data = await apiPut('/api/profile', cleanForSave(sent));
      setSavedJson(JSON.stringify(data.profile));
      // Show the server's cleaned version (trimmed text etc.), unless you kept typing
      // while the request was in flight. In that case your newer edits stay put.
      setProfile((current) => (current === sent ? data.profile : current));
      setSaveResult({ ok: true });
    } catch (err) {
      if (err.status === 400 && Array.isArray(err.data?.issues)) {
        setSaveResult({ ok: false, message: 'Fix these fields and save again:', issues: err.data.issues });
      } else if (err.status === 401) {
        setSaveResult({ ok: false, message: 'Your session expired. Sign in again, then save.' });
      } else {
        setSaveResult({ ok: false, message: 'Could not save. Your edits are still here, try again.' });
      }
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <section className="border-2 border-ink bg-alert p-6 shadow-hard">
        <p className="font-mono text-sm font-bold">{loadError}</p>
        <Button className="mt-4" onClick={load}>
          Try again
        </Button>
      </section>
    );
  }

  if (!profile) {
    return <p className="font-mono text-sm uppercase">Loading profile...</p>;
  }

  if (importing) {
    return (
      <ImportPanel
        replacesExisting={!isProfileEmpty(profile)}
        onCancel={() => setImporting(false)}
        onSaved={(saved) => {
          // The server confirmed the imported profile: it becomes the saved baseline.
          setProfile(saved);
          setSavedJson(JSON.stringify(saved));
          setSaveResult({ ok: true });
          setImporting(false);
        }}
      />
    );
  }

  let status = 'All changes saved';
  if (dirty) status = 'Unsaved changes';
  else if (saveResult?.ok) status = 'Saved';

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-3xl">Master profile</h2>
        <Button onClick={() => setImporting(true)}>Import from resume</Button>
      </div>

      <ProfileForm profile={profile} onChange={update} />

      {saveResult && !saveResult.ok && (
        <div role="alert" className="border-2 border-ink bg-alert p-4 shadow-hard">
          <p className="font-mono text-sm font-bold">{saveResult.message}</p>
          {saveResult.issues && (
            <ul className="mt-2 list-disc space-y-1 pl-5 font-mono text-xs">
              {saveResult.issues.map((issue, i) => (
                <li key={i}>
                  {formatIssuePath(issue.path)}: {issue.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="sticky bottom-4 z-10 flex items-center justify-between gap-4 border-2 border-ink bg-cream p-4 shadow-hard">
        <span
          className={`border-2 border-ink px-2 py-1 font-mono text-xs uppercase ${
            saveResult?.ok && !dirty ? 'bg-ok' : 'bg-cream'
          }`}
        >
          {status}
        </span>
        <Button variant="primary" onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving...' : 'Save profile'}
        </Button>
      </div>
    </div>
  );
}
