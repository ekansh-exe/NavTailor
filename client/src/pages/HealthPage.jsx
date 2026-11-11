import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '../api/client.js';

const TAG = {
  loading: { label: 'Checking', cls: 'bg-cream' },
  ok: { label: 'Online', cls: 'bg-ok' },
  error: { label: 'Offline', cls: 'bg-alert' },
};

export default function HealthPage() {
  const [status, setStatus] = useState('loading');
  const [body, setBody] = useState(null); // parsed JSON on success, message string on failure

  const check = useCallback(async () => {
    setStatus('loading');
    try {
      setBody(await apiGet('/api/health'));
      setStatus('ok');
    } catch (err) {
      setBody(err.message);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  const tag = TAG[status];

  return (
    <section className="border-2 border-ink bg-cream p-6 shadow-hard">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl">API health</h2>
        <span className={`border-2 border-ink px-2 py-1 font-mono text-xs uppercase ${tag.cls}`}>
          {tag.label}
        </span>
      </div>

      <p className="mt-2 font-mono text-xs uppercase">GET /api/health</p>

      <pre className="mt-4 overflow-x-auto border-2 border-ink p-4 font-mono text-sm">
        {status === 'loading' ? '...' : JSON.stringify(body, null, 2)}
      </pre>

      <button
        onClick={check}
        className="mt-4 cursor-pointer border-2 border-ink bg-ink px-4 py-2 font-mono text-sm font-bold uppercase text-cream shadow-hard active:translate-x-1 active:translate-y-1 active:shadow-none"
      >
        Check again
      </button>
    </section>
  );
}
