import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { RATING_FIELDS } from '../../lib/disputes.js';
import { when } from '../../lib/orders.js';
import { PhotoPicker } from '../rentals/BookingParts.jsx';
import { Alert, Button, Card, SectionHeading, TextArea } from '../ui/index.js';
import { StarInput } from './Stars.jsx';

/**
 * On a completed order or rental: a review form while this person can still review
 * it (30 days, once). `about` is { orderId } or { bookingId }.
 */
export function ReviewPrompt({ about }) {
  const [pending, setPending] = useState(null);
  const [ratings, setRatings] = useState({});
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const id = about.orderId ?? about.bookingId;

  useEffect(() => {
    let cancelled = false;
    api('/me/reviews/pending')
      .then((data) => {
        if (cancelled) return;
        setPending(data.items.find((item) => (item.orderId ?? item.bookingId) === id) ?? false);
      })
      .catch(() => !cancelled && setPending(false));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (done) {
    return (
      <Alert tone="success" title="Thank you for your review">
        It is now on their profile.
      </Alert>
    );
  }
  if (!pending) return null;

  // A seller reviewing a buyer is not asked about the item's condition.
  const fields = RATING_FIELDS.filter((f) => f.key !== 'condition' || pending.role !== 'SELLER');
  const complete = fields.every((f) => ratings[f.key]);

  async function send() {
    setSending(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('data', JSON.stringify({ ...about, ...ratings, text: text.trim() || undefined }));
      files.forEach((file) => body.append('photos', file));
      await api('/reviews', { method: 'POST', body });
      setDone(true);
    } catch (failure) {
      setError(failure.message);
      setSending(false);
    }
  }

  return (
    <Card>
      <SectionHeading
        title={`Review ${pending.subject.displayName}`}
        description={`How did it go? You can review until ${when(pending.reviewBy)}. Reviews are public and cannot be edited.`}
      />
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((field) => (
            <StarInput
              key={field.key}
              label={field.label}
              value={ratings[field.key] ?? 0}
              onChange={(value) => setRatings((current) => ({ ...current, [field.key]: value }))}
            />
          ))}
        </div>
        <TextArea
          label="Your review (optional)"
          rows={3}
          maxLength={1000}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <PhotoPicker
          files={files}
          onChange={setFiles}
          min={0}
          max={4}
          hint="Optional: up to 4 photos."
        />
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button loading={sending} disabled={!complete} onClick={send}>
          Publish review
        </Button>
      </div>
    </Card>
  );
}
