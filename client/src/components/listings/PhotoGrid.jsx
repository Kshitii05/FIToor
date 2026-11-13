import { useId, useRef } from 'react';
import { Button } from '../ui/index.js';
import { LIMITS } from '../../lib/listings.js';

/**
 * Shows a listing's photos in order with controls to reorder and remove them,
 * and a button to add more. The first photo is the cover.
 *
 * `photos` is a list of `{ key, url }`. `onAdd(files)` receives the chosen files;
 * `onMove(key, -1 | 1)` and `onRemove(key)` act on one photo.
 */
export function PhotoGrid({ photos, onAdd, onMove, onRemove, busy = false, error }) {
  const inputId = useId();
  const inputRef = useRef(null);
  const remaining = LIMITS.imagesMax - photos.length;

  function handleFiles(event) {
    const files = Array.from(event.target.files ?? []);
    // Reset so choosing the same file again still fires a change event.
    event.target.value = '';
    if (files.length > 0) onAdd(files);
  }

  return (
    <div>
      {photos.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {photos.map((photo, index) => (
            <li key={photo.key} className="overflow-hidden rounded-field border border-line">
              <div className="relative aspect-square bg-paper">
                <img
                  src={photo.url}
                  alt={`Photo ${index + 1}`}
                  className="size-full object-cover"
                />
                {index === 0 ? (
                  <span className="absolute left-2 top-2 rounded-full bg-ink/80 px-2 py-0.5 text-xs font-medium text-white">
                    Cover
                  </span>
                ) : null}
              </div>
              <div className="flex items-center justify-between gap-1 p-1.5">
                <div className="flex gap-1">
                  <IconButton
                    label={`Move photo ${index + 1} earlier`}
                    disabled={busy || index === 0}
                    onClick={() => onMove(photo.key, -1)}
                  >
                    ←
                  </IconButton>
                  <IconButton
                    label={`Move photo ${index + 1} later`}
                    disabled={busy || index === photos.length - 1}
                    onClick={() => onMove(photo.key, 1)}
                  >
                    →
                  </IconButton>
                </div>
                <IconButton
                  label={`Remove photo ${index + 1}`}
                  disabled={busy}
                  onClick={() => onRemove(photo.key)}
                >
                  ✕
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <div className={photos.length > 0 ? 'mt-4' : ''}>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={LIMITS.imageTypes.join(',')}
          multiple
          className="sr-only"
          tabIndex={-1}
          onChange={handleFiles}
        />
        <Button
          variant="secondary"
          disabled={busy || remaining <= 0}
          loading={busy}
          onClick={() => inputRef.current?.click()}
        >
          {photos.length === 0 ? 'Choose photos' : 'Add photos'}
        </Button>
        <p className="mt-2 text-sm text-muted">
          {photos.length} of {LIMITS.imagesMax} photos. JPEG, PNG or WebP, up to 5 MB each.
        </p>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function IconButton({ label, children, ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="inline-flex size-9 items-center justify-center rounded-field text-ink transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40"
      {...props}
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}
