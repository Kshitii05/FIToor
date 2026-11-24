import { useState } from 'react';
import { api, fieldErrors } from '../../lib/api.js';
import { BANK_STATUS } from '../../lib/dashboard.js';
import { useFetch } from '../../lib/useFetch.js';
import { Alert, Badge, Button, Card, Loading, SectionHeading, TextField } from '../ui/index.js';

const EMPTY = { holderName: '', accountNumber: '', ifsc: '' };

/**
 * Where payouts go. The account number is never shown back in full; changing any
 * detail sends it for a new check before the next payout uses it.
 */
export function BankDetails() {
  const { data, error, loading, setData } = useFetch('/me/bank-account');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [problems, setProblems] = useState({});
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const account = data?.bankAccount ?? null;
  const set = (field) => (event) => setForm((f) => ({ ...f, [field]: event.target.value }));

  function startEditing() {
    setForm({ ...EMPTY, holderName: account?.holderName ?? '', ifsc: account?.ifsc ?? '' });
    setProblems({});
    setSaveError(null);
    setSaved(false);
    setEditing(true);
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setProblems({});
    setSaveError(null);
    try {
      const result = await api('/me/bank-account', { method: 'PUT', body: form });
      setData(result);
      setEditing(false);
      setSaved(true);
    } catch (problem) {
      const fields = fieldErrors(problem);
      setProblems(fields);
      if (Object.keys(fields).length === 0) setSaveError(problem.message);
    } finally {
      setSaving(false);
    }
  }

  const status = account ? BANK_STATUS[account.status] : null;
  return (
    <Card>
      <SectionHeading
        title="Bank details"
        description="Where your earnings are sent. We check every new or changed account before paying into it."
        action={
          !editing && !loading ? (
            <Button variant="secondary" size="sm" onClick={startEditing}>
              {account ? 'Change' : 'Add bank details'}
            </Button>
          ) : null
        }
      />
      {loading ? (
        <Loading label="Loading bank details" />
      ) : error ? (
        <Alert tone="error">{error.message}</Alert>
      ) : editing ? (
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
          <div className="sm:col-span-2">
            <TextField
              label="Account holder name"
              hint="As the bank has it."
              value={form.holderName}
              onChange={set('holderName')}
              error={problems.holderName}
              autoComplete="name"
              required
            />
          </div>
          <TextField
            label="Account number"
            inputMode="numeric"
            value={form.accountNumber}
            onChange={set('accountNumber')}
            error={problems.accountNumber}
            autoComplete="off"
            required
          />
          <TextField
            label="IFSC"
            hint="11 characters, like HDFC0001234."
            value={form.ifsc}
            onChange={(e) => setForm((f) => ({ ...f, ifsc: e.target.value.toUpperCase() }))}
            error={problems.ifsc}
            autoComplete="off"
            maxLength={11}
            required
          />
          {saveError ? (
            <div className="sm:col-span-2">
              <Alert tone="error">{saveError}</Alert>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-3 sm:col-span-2">
            <Button type="submit" loading={saving}>
              Save for checking
            </Button>
            <Button variant="secondary" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </form>
      ) : account ? (
        <div className="space-y-3">
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted">Account holder</dt>
              <dd className="font-medium text-ink">{account.holderName}</dd>
            </div>
            <div>
              <dt className="text-muted">Account number</dt>
              <dd className="font-medium text-ink">{account.accountNumber}</dd>
            </div>
            <div>
              <dt className="text-muted">IFSC</dt>
              <dd className="font-medium text-ink">{account.ifsc}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            {account.note ? <span className="text-sm text-muted">{account.note}</span> : null}
          </div>
          {saved ? (
            <Alert tone="success">
              Saved. We will check these details before your next payout.
            </Alert>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted">
          You have not added bank details yet. Add them so we can pay you for completed sales and
          rentals.
        </p>
      )}
    </Card>
  );
}
