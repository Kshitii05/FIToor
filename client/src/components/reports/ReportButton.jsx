import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/authContext.js';
import { api } from '../../lib/api.js';
import { REPORT_REASONS } from '../../lib/disputes.js';
import { Button, SelectField, TextArea } from '../ui/index.js';

/**
 * Report a person, listing, message or review. Nothing is removed by reporting; our
 * team looks at it. `compact` shows a small text link (for chat messages and reviews).
 */
export function ReportButton({ targetType, targetId, label = 'Report', compact = false }) {
  const { status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  function start() {
    if (status !== 'signedIn') {
      navigate('/login', { state: { from: location.pathname } });
      return;
    }
    setOpen(true);
  }

  async function send() {
    setSending(true);
    setError(null);
    try {
      await api('/reports', {
        method: 'POST',
        body: { targetType, targetId, reason, details: details.trim() || undefined },
      });
      setSent(true);
      setOpen(false);
    } catch (failure) {
      if (failure.code === 'ALREADY_REPORTED') {
        setSent(true);
        setOpen(false);
      } else {
        setError(failure.message);
      }
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return <p className="text-xs text-muted">Reported. Thank you; our team will look at it.</p>;
  }
  if (!open) {
    return compact ? (
      <button
        type="button"
        onClick={start}
        className="text-xs text-muted underline-offset-2 hover:text-danger hover:underline"
      >
        {label}
      </button>
    ) : (
      <Button variant="ghost" size="sm" onClick={start}>
        {label}…
      </Button>
    );
  }
  return (
    <div className="w-full max-w-sm space-y-3 rounded-card border border-line bg-surface p-3 text-left">
      <SelectField
        label="What is wrong?"
        options={[{ value: '', label: 'Choose a reason' }, ...REPORT_REASONS]}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <TextArea
        label="Anything we should know? (optional)"
        rows={2}
        maxLength={1000}
        value={details}
        onChange={(event) => setDetails(event.target.value)}
      />
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="danger" loading={sending} disabled={!reason} onClick={send}>
          Send report
        </Button>
        <Button size="sm" variant="ghost" disabled={sending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
