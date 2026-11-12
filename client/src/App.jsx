import { useEffect, useState } from 'react';
import { API_BASE_URL, APP_NAME } from './config/app.js';

const STATUS_LABEL = {
  checking: 'Checking the API…',
  ok: 'API is up',
  degraded: 'API is up, database is down',
  unreachable: 'API is not reachable',
};

export default function App() {
  const [status, setStatus] = useState('checking');

  useEffect(() => {
    let cancelled = false;

    fetch(`${API_BASE_URL}/health`)
      .then((res) => res.json())
      .then((body) => {
        if (!cancelled) setStatus(body.status === 'ok' ? 'ok' : 'degraded');
      })
      .catch(() => {
        if (!cancelled) setStatus('unreachable');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-neutral-50 px-4 text-neutral-900">
      <h1 className="text-3xl font-semibold tracking-tight">{APP_NAME}</h1>
      <p className="text-sm text-neutral-600" role="status">
        {STATUS_LABEL[status]}
      </p>
    </main>
  );
}
