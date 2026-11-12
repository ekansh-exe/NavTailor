import { useEffect, useState } from 'react';
import { apiGet } from '../api/client.js';

const TAG = {
  loading: { label: 'API: checking', cls: 'bg-cream' },
  ok: { label: 'API: online', cls: 'bg-ok' },
  error: { label: 'API: offline', cls: 'bg-alert' },
};

// Small footer tag that pings GET /api/health once when the shell mounts.
export default function ApiStatusTag() {
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let cancelled = false;
    apiGet('/api/health')
      .then(() => !cancelled && setStatus('ok'))
      .catch(() => !cancelled && setStatus('error'));
    return () => {
      cancelled = true;
    };
  }, []);

  const tag = TAG[status];
  return (
    <span className={`border-2 border-ink px-2 py-1 font-mono text-xs uppercase ${tag.cls}`}>
      {tag.label}
    </span>
  );
}
