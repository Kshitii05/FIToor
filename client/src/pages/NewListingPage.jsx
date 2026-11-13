import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/authContext.js';
import { ListingFields } from '../components/listings/ListingFields.jsx';
import { PhotoGrid } from '../components/listings/PhotoGrid.jsx';
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  ChoiceCards,
  SectionHeading,
} from '../components/ui/index.js';
import { api } from '../lib/api.js';
import {
  buildListingPayload,
  emptyListingForm,
  listingErrorsFrom,
  photoProblem,
} from '../lib/listingForm.js';
import { LIMITS } from '../lib/listings.js';
import { moveItem } from '../lib/useListing.js';

const MODES = [
  { value: 'SALE', label: 'Sell it', description: 'Set a price. The buyer keeps the item.' },
  {
    value: 'RENT',
    label: 'Rent it out',
    description: 'Set rental packages and a refundable deposit. You get the item back.',
  },
];

let photoCounter = 0;

export default function NewListingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('SALE');
  const [form, setForm] = useState(emptyListingForm);
  const [photos, setPhotos] = useState([]);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Preview URLs hold the chosen files in memory until they are released.
  const previewUrls = useRef(new Set());
  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  if (!(user.emailVerified && user.phoneVerified)) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
          List an item
        </h1>
        <Alert tone="notice" title="Verify your account first" className="mt-5">
          <p>You need a verified email and phone number before you can list an item.</p>
          <ButtonLink to="/verify" size="sm" className="mt-3">
            Verify my account
          </ButtonLink>
        </Alert>
      </div>
    );
  }

  const setField = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  function addPhotos(files) {
    const room = LIMITS.imagesMax - photos.length;
    const problems = files.map(photoProblem).filter(Boolean);
    const usable = files.filter((file) => photoProblem(file) === null);
    if (usable.length > room) {
      problems.push(
        `Only ${LIMITS.imagesMax} photos fit on a listing; the extra ones were left out`,
      );
    }
    const added = usable.slice(0, room).map((file) => {
      const url = URL.createObjectURL(file);
      previewUrls.current.add(url);
      photoCounter += 1;
      return { key: `photo-${photoCounter}`, url, file };
    });
    setPhotos((current) => [...current, ...added]);
    setErrors((current) => ({ ...current, images: problems.join('. ') || undefined }));
  }

  function removePhoto(key) {
    const photo = photos.find((candidate) => candidate.key === key);
    if (photo) {
      URL.revokeObjectURL(photo.url);
      previewUrls.current.delete(photo.url);
    }
    setPhotos((current) => current.filter((candidate) => candidate.key !== key));
  }

  function movePhoto(key, direction) {
    setPhotos((current) =>
      moveItem(
        current,
        current.findIndex((photo) => photo.key === key),
        direction,
      ),
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError(null);

    const { payload, errors: problems } = buildListingPayload(form, mode);
    if (photos.length < LIMITS.imagesMin) problems.images = 'Add at least one photo';
    setErrors(problems);
    if (Object.keys(problems).length > 0) {
      setFormError('Some details need your attention. They are marked below.');
      return;
    }

    const body = new FormData();
    body.append('data', JSON.stringify({ mode, ...payload }));
    photos.forEach((photo) => body.append('images', photo.file));

    setSubmitting(true);
    try {
      const { listing } = await api('/listings', { method: 'POST', body });
      navigate(`/listings/${listing.id}`, { state: { notice: 'Your listing is live.' } });
    } catch (error) {
      const { fields, form: message } = listingErrorsFrom(error);
      setErrors(fields);
      setFormError(message ?? 'Some details need your attention. They are marked below.');
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">List an item</h1>
      <p className="mt-2 text-muted">
        Fashion only. Counterfeit, stolen or unsafe items are not allowed and will be removed.
      </p>

      <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-5">
        {formError ? <Alert tone="error">{formError}</Alert> : null}

        <Card>
          <ChoiceCards
            legend="What would you like to do?"
            options={MODES}
            value={mode}
            onChange={setMode}
          />
          <p className="mt-3 text-sm text-muted">
            A listing is either for sale or for rent. To offer both, create two listings. This
            cannot be changed later.
          </p>
        </Card>

        <Card>
          <SectionHeading
            title="Photos"
            description="Clear, well-lit photos of the actual item. The first one is the cover."
          />
          <PhotoGrid
            photos={photos}
            onAdd={addPhotos}
            onMove={movePhoto}
            onRemove={removePhoto}
            error={errors.images}
          />
        </Card>

        <ListingFields mode={mode} form={form} onChange={setField} errors={errors} />

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={submitting}>
            Publish listing
          </Button>
          <ButtonLink to="/my-listings" variant="secondary">
            Cancel
          </ButtonLink>
        </div>
      </form>
    </div>
  );
}
