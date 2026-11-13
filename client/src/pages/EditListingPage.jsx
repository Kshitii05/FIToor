import { useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../auth/authContext.js';
import { StatusBadge } from '../components/listings/ListingCard.jsx';
import { ListingFields } from '../components/listings/ListingFields.jsx';
import { PhotoGrid } from '../components/listings/PhotoGrid.jsx';
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  Loading,
  SectionHeading,
} from '../components/ui/index.js';
import { api } from '../lib/api.js';
import {
  buildListingPayload,
  formFromListing,
  listingErrorsFrom,
  photoProblem,
} from '../lib/listingForm.js';
import { LIMITS } from '../lib/listings.js';
import { moveItem, useListing } from '../lib/useListing.js';

function Photos({ listing, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const base = `/listings/${listing.id}/images`;

  async function run(request) {
    setBusy(true);
    setError(null);
    try {
      onChange((await request()).listing);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  function addPhotos(files) {
    const problems = files.map(photoProblem).filter(Boolean);
    const usable = files.filter((file) => photoProblem(file) === null);
    if (listing.images.length + usable.length > LIMITS.imagesMax) {
      setError(`A listing can have at most ${LIMITS.imagesMax} photos`);
      return;
    }
    if (usable.length === 0) {
      setError(problems.join('. '));
      return;
    }
    const body = new FormData();
    usable.forEach((file) => body.append('images', file));
    run(() => api(base, { method: 'POST', body })).then(() => {
      if (problems.length > 0) setError(problems.join('. '));
    });
  }

  function movePhoto(imageId, direction) {
    const ids = listing.images.map((image) => image.id);
    const imageIds = moveItem(ids, ids.indexOf(imageId), direction);
    run(() => api(`${base}/order`, { method: 'PUT', body: { imageIds } }));
  }

  function removePhoto(imageId) {
    run(() => api(`${base}/${imageId}`, { method: 'DELETE' }));
  }

  return (
    <Card>
      <SectionHeading
        title="Photos"
        description="Changes to photos are saved straight away. The first one is the cover."
      />
      <PhotoGrid
        photos={listing.images.map((image) => ({ key: image.id, url: image.url }))}
        onAdd={addPhotos}
        onMove={movePhoto}
        onRemove={removePhoto}
        busy={busy}
        error={error}
      />
    </Card>
  );
}

function Details({ listing, onChange }) {
  const [form, setForm] = useState(() => formFromListing(listing));
  const [errors, setErrors] = useState({});
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);

  const setField = useCallback((field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setResult(null);
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setResult(null);

    const { payload, errors: problems } = buildListingPayload(form, listing.mode, {
      requireLocation: false,
    });
    setErrors(problems);
    if (Object.keys(problems).length > 0) {
      setResult({ tone: 'error', message: 'Some details need your attention.' });
      return;
    }

    setSaving(true);
    try {
      const { listing: updated } = await api(`/listings/${listing.id}`, {
        method: 'PATCH',
        body: payload,
      });
      onChange(updated);
      setResult({ tone: 'success', message: 'Changes saved.' });
    } catch (error) {
      const { fields, form: message } = listingErrorsFrom(error);
      setErrors(fields);
      setResult({ tone: 'error', message: message ?? 'Some details need your attention.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      <ListingFields mode={listing.mode} form={form} onChange={setField} errors={errors} />
      {result ? <Alert tone={result.tone}>{result.message}</Alert> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={saving}>
          Save changes
        </Button>
        <ButtonLink to={`/listings/${listing.id}`} variant="secondary">
          View listing
        </ButtonLink>
      </div>
    </form>
  );
}

export default function EditListingPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { loading, listing, error, setListing } = useListing(id);

  if (loading) return <Loading label="Loading listing" />;

  const problem = error
    ? error.status === 404 || error.status === 400
      ? 'This listing does not exist, or was deleted.'
      : error.message
    : listing.seller.id !== user.id
      ? 'You can only edit your own listings.'
      : null;

  if (problem) {
    return (
      <div className="mx-auto max-w-md">
        <Alert tone="notice">{problem}</Alert>
        <ButtonLink to="/my-listings" variant="secondary" className="mt-5">
          Back to my listings
        </ButtonLink>
      </div>
    );
  }

  const removed = listing.status === 'REMOVED';

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
          Edit listing
        </h1>
        <StatusBadge status={listing.status} />
      </div>
      <p className="mt-2 text-muted">
        {listing.mode === 'SALE' ? 'For sale' : 'For rent'} · {listing.title}
      </p>

      {removed ? (
        <Alert tone="error" title="This listing was removed" className="mt-5">
          It broke the marketplace rules and can no longer be changed.
        </Alert>
      ) : (
        <div className="mt-6 space-y-5">
          {listing.status === 'UNDER_REVIEW' ? (
            <Alert tone="notice" title="This listing is under review">
              It is hidden from others until the review is finished. You can still correct it.
            </Alert>
          ) : null}
          <Photos listing={listing} onChange={setListing} />
          {/* Remounted per listing so the form always starts from that listing's values. */}
          <Details key={listing.id} listing={listing} onChange={setListing} />
        </div>
      )}
    </div>
  );
}
