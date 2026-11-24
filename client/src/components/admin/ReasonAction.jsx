import { useRef, useState } from 'react';
import { fieldErrors } from '../../lib/api.js';
import { Alert, Button, TextArea } from '../ui/index.js';

/**
 * A button that asks for confirmation and a written reason before an admin action
 * (SPEC Module 10: confirmation for destructive and financial actions; every
 * action has a reason). `fields` renders extra inputs and receives `[values, set]`.
 * `onConfirm(values)` performs the action; its errors are shown in the dialog.
 */
export function ReasonAction({
  label,
  title,
  description,
  confirmLabel,
  variant = 'secondary',
  size = 'sm',
  tone = 'primary',
  initial = {},
  fields,
  needsReason = true,
  reasonLabel = 'Reason (kept in the audit log)',
  onConfirm,
}) {
  const dialog = useRef(null);
  const [values, setValues] = useState({ reason: '', ...initial });
  const [error, setError] = useState(null);
  const [problems, setProblems] = useState({});
  const [busy, setBusy] = useState(false);

  function open() {
    setValues({ reason: '', ...initial });
    setError(null);
    setProblems({});
    dialog.current?.showModal();
  }

  async function confirm(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setProblems({});
    try {
      const body = { ...values };
      if (!needsReason) delete body.reason;
      await onConfirm(body);
      dialog.current?.close();
    } catch (problem) {
      const fieldsWithErrors = fieldErrors(problem);
      setProblems(fieldsWithErrors);
      setError(Object.keys(fieldsWithErrors).length ? null : problem.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant={variant} size={size} onClick={open}>
        {label}
      </Button>
      <dialog
        ref={dialog}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-card border border-line bg-surface p-0 text-ink shadow-card backdrop:bg-ink/40"
      >
        <form onSubmit={confirm} className="space-y-4 p-5 sm:p-6">
          <h2 className="font-display text-xl font-semibold">{title ?? label}</h2>
          {description ? <p className="text-sm text-muted">{description}</p> : null}
          {fields ? fields([values, setValues], problems) : null}
          {needsReason ? (
            <TextArea
              label={reasonLabel}
              value={values.reason}
              onChange={(e) => setValues((v) => ({ ...v, reason: e.target.value }))}
              error={problems.reason}
              rows={3}
              required
            />
          ) : null}
          {error ? <Alert tone="error">{error}</Alert> : null}
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="secondary" onClick={() => dialog.current?.close()} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant={tone} loading={busy}>
              {confirmLabel ?? label}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
