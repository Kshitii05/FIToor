import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PhotoPicker } from '../components/rentals/BookingParts.jsx';
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  Loading,
  SectionHeading,
  TextArea,
} from '../components/ui/index.js';
import { api } from '../lib/api.js';
import {
  agreeText,
  decisionText,
  DISPUTE_KIND,
  DISPUTE_STATUS,
  ISSUE_CATEGORY,
  subjectLink,
} from '../lib/disputes.js';
import { formatPaise } from '../lib/money.js';
import { when } from '../lib/orders.js';

const EVIDENCE_PHOTOS_MAX = 5;

function useDispute(id) {
  const [result, setResult] = useState({ id: null });
  useEffect(() => {
    let cancelled = false;
    api(`/disputes/${encodeURIComponent(id)}`)
      .then((data) => !cancelled && setResult({ id, dispute: data.dispute }))
      .catch((error) => !cancelled && setResult({ id, error }));
    return () => {
      cancelled = true;
    };
  }, [id]);
  const current = result.id === id ? result : {};
  return {
    loading: result.id !== id,
    dispute: current.dispute ?? null,
    error: current.error ?? null,
    setDispute: (dispute) => setResult({ id, dispute }),
  };
}

/** Who wrote an entry, from the reader's point of view. */
function authorLabel(entry, dispute) {
  if (entry.role === 'SYSTEM') return 'Automatic note';
  if (entry.role === 'ADMIN') return 'Our team';
  if (entry.role === dispute.myRole) return 'You';
  return (
    entry.author ??
    (entry.role === 'CLAIMANT' ? dispute.claimant.displayName : dispute.respondent.displayName)
  );
}

function Timeline({ dispute }) {
  return (
    <Card>
      <SectionHeading
        title="Record"
        description={
          dispute.evidencePurged
            ? 'Photos were deleted 180 days after this dispute ended; the written record stays.'
            : 'Everything both sides added, with the time.'
        }
      />
      <ol className="space-y-4">
        {dispute.evidence.map((entry) => (
          <li key={entry.id} className="border-l-2 border-line pl-4">
            <p className="text-sm">
              <span className="font-medium text-ink">{authorLabel(entry, dispute)}</span>
              <span className="ml-2 text-muted">{when(entry.createdAt)}</span>
            </p>
            {entry.text ? (
              <p className="mt-1 whitespace-pre-line break-words text-sm text-ink">{entry.text}</p>
            ) : null}
            {entry.photos.length ? (
              <ul className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6">
                {entry.photos.map((photo) => (
                  <li key={photo.url}>
                    <a href={photo.url} target="_blank" rel="noreferrer">
                      <img
                        src={photo.url}
                        alt="Evidence"
                        className="aspect-square w-full rounded-field border border-line object-cover"
                      />
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function EvidenceForm({ dispute, onDone }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const answering = dispute.myRole === 'RESPONDENT' && dispute.status === 'OPEN';

  async function send() {
    setSending(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('data', JSON.stringify({ text: text.trim() || undefined }));
      files.forEach((file) => body.append('photos', file));
      const { dispute: updated } = await api(`/disputes/${dispute.id}/evidence`, {
        method: 'POST',
        body,
      });
      setText('');
      setFiles([]);
      onDone(updated);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-3">
      <TextArea
        label={answering ? 'Your side of the story' : 'Add to the record'}
        rows={3}
        maxLength={2000}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <PhotoPicker
        files={files}
        onChange={setFiles}
        min={0}
        max={EVIDENCE_PHOTOS_MAX}
        hint={`Optional: up to ${EVIDENCE_PHOTOS_MAX} photos.`}
      />
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button loading={sending} disabled={!text.trim() && files.length === 0} onClick={send}>
        {answering ? 'Send my answer' : 'Add'}
      </Button>
      {answering ? (
        <p className="text-xs text-muted">Answering sends the dispute to our team to decide.</p>
      ) : null}
    </div>
  );
}

function Confirmed({ label, text, variant = 'secondary', busy, onConfirm }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button variant={variant} onClick={() => setOpen(true)}>
        {label}…
      </Button>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-ink">{text}</p>
      <div className="flex flex-wrap gap-3">
        <Button
          variant={variant === 'secondary' ? 'primary' : variant}
          loading={busy}
          onClick={onConfirm}
        >
          Yes, {label.toLowerCase()}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
          Back
        </Button>
      </div>
    </div>
  );
}

function AppealForm({ dispute, act }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open) {
    return (
      <div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Appeal…
        </Button>
        <p className="mt-1 text-xs text-muted">
          One appeal per dispute, until {when(dispute.appealDueAt)}. The appeal decision is final.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <TextArea
        label="Why should the decision change?"
        rows={3}
        maxLength={500}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <div className="flex flex-wrap gap-3">
        <Button
          loading={act.busy === 'appeal'}
          disabled={reason.trim().length < 5}
          onClick={() => act.run('appeal', { reason: reason.trim() })}
        >
          Send appeal
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Back
        </Button>
      </div>
    </div>
  );
}

function statusNote(dispute) {
  switch (dispute.status) {
    case 'OPEN':
      return dispute.myRole === 'RESPONDENT'
        ? `Please answer by ${when(dispute.respondDueAt)}: agree, or add your side. After that our team decides.`
        : `${dispute.respondent.displayName} has until ${when(dispute.respondDueAt)} to answer; then our team decides.`;
    case 'UNDER_REVIEW':
      return `Our team is reviewing it and aims to decide by ${when(dispute.reviewDueAt)}. You can still add evidence.`;
    case 'DECIDED':
      return `Decided. Either side can appeal once until ${when(dispute.appealDueAt)}; after that it takes effect.`;
    case 'APPEALED':
      return 'Appealed. Our team will look again; that decision is final and takes effect at once.';
    case 'RESOLVED':
      return 'Settled by agreement. It has taken effect.';
    case 'CLOSED':
      return 'The decision has taken effect. Any refund is on its way to the original payment method.';
    default:
      return 'Withdrawn by the person who opened it.';
  }
}

export default function DisputePage() {
  const { id } = useParams();
  const { loading, dispute, error, setDispute } = useDispute(id);
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);

  if (loading) return <Loading label="Loading dispute" />;
  if (error) {
    return (
      <div className="mx-auto max-w-md">
        <Alert tone={error.status === 404 ? 'notice' : 'error'}>
          {error.status === 404 ? 'This dispute does not exist, or is not yours.' : error.message}
        </Alert>
        <ButtonLink to="/disputes" variant="secondary" className="mt-5">
          Back
        </ButtonLink>
      </div>
    );
  }

  const act = {
    busy,
    async run(action, body) {
      setBusy(action);
      setActionError(null);
      try {
        setDispute(
          (await api(`/disputes/${dispute.id}/${action}`, { method: 'POST', body })).dispute,
        );
      } catch (failure) {
        setActionError(failure.message);
      } finally {
        setBusy(null);
      }
    },
  };
  const can = (action) => dispute.actions.includes(action);
  const status = DISPUTE_STATUS[dispute.status];
  const link = subjectLink(dispute);
  const decision = dispute.finalDecision ?? dispute.decision;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
            {DISPUTE_KIND[dispute.kind]}
          </h1>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted">
          {dispute.ref} ·{' '}
          {link ? (
            <Link to={link.path} className="text-ink underline-offset-4 hover:underline">
              {link.label}
            </Link>
          ) : null}
          {dispute.subject?.title ? ` (${dispute.subject.title})` : ''} · opened{' '}
          {when(dispute.createdAt)}
          {dispute.openedByClaimant ? '' : ' automatically'}
        </p>
      </div>

      <Alert tone={['RESOLVED', 'CLOSED'].includes(dispute.status) ? 'success' : 'info'}>
        {statusNote(dispute)}
      </Alert>
      {actionError ? <Alert tone="error">{actionError}</Alert> : null}

      <Card>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-muted">Raised by</dt>
            <dd className="text-ink">
              {dispute.myRole === 'CLAIMANT' ? 'You' : dispute.claimant.displayName}
              {dispute.category ? ` · ${ISSUE_CATEGORY[dispute.category]}` : ''}
              {dispute.lateFeeDisputed ? ' · late fee disputed' : ''}
            </dd>
          </div>
          <div>
            <dt className="text-muted">What happened</dt>
            <dd className="whitespace-pre-line break-words text-ink">{dispute.description}</dd>
          </div>
          {dispute.claimItems?.length ? (
            <div>
              <dt className="text-muted">Costs claimed</dt>
              <dd>
                <ul className="space-y-1">
                  {dispute.claimItems.map((item) => (
                    <li key={item.label} className="flex justify-between gap-3 text-ink">
                      <span>{item.label}</span>
                      <span>{formatPaise(item.amountPaise)}</span>
                    </li>
                  ))}
                  <li className="flex justify-between gap-3 font-semibold text-ink">
                    <span>Total</span>
                    <span>{formatPaise(dispute.claimedDamagePaise)}</span>
                  </li>
                </ul>
              </dd>
            </div>
          ) : null}
          {decision ? (
            <div>
              <dt className="text-muted">
                {dispute.finalDecision ? 'Final decision' : 'Decision'}
              </dt>
              <dd className="text-ink">
                <p className="font-medium">{decisionText(decision)}</p>
                <p className="text-muted">{dispute.finalReason ?? dispute.decisionReason}</p>
              </dd>
            </div>
          ) : null}
          {dispute.appealReason ? (
            <div>
              <dt className="text-muted">Appeal</dt>
              <dd className="text-ink">
                {dispute.appealedBy === dispute.myRole ? 'You' : 'The other side'}:{' '}
                {dispute.appealReason}
              </dd>
            </div>
          ) : null}
        </dl>
      </Card>

      {dispute.actions.length ? (
        <Card>
          <div className="space-y-6">
            {can('agree') ? (
              <Confirmed
                label="Agree"
                text={`${agreeText(dispute)} This takes effect at once and cannot be appealed.`}
                busy={busy === 'agree'}
                onConfirm={() => act.run('agree')}
              />
            ) : null}
            {can('evidence') ? <EvidenceForm dispute={dispute} onDone={setDispute} /> : null}
            {can('appeal') ? <AppealForm dispute={dispute} act={act} /> : null}
            {can('withdraw') ? (
              <Confirmed
                label="Withdraw"
                variant="ghost"
                text="Withdraw this dispute? The order or rental carries on as before."
                busy={busy === 'withdraw'}
                onConfirm={() => act.run('withdraw')}
              />
            ) : null}
          </div>
        </Card>
      ) : null}

      <Timeline dispute={dispute} />
    </div>
  );
}
