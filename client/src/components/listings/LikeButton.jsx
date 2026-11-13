import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/authContext.js';
import { api } from '../../lib/api.js';

function Heart({ filled }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
      <path
        d="M12 20.5s-7.5-4.6-9.4-9.2C1.2 7.9 3.4 4.5 6.9 4.5c2 0 3.6 1.1 5.1 3 1.5-1.9 3.1-3 5.1-3 3.5 0 5.7 3.4 4.3 6.8-1.9 4.6-9.4 9.2-9.4 9.2Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Likes or unlikes a listing. Visitors are sent to sign in first; sellers see no
 * button on their own listings. `compact` is the round icon used on cards.
 * Remount it (key by listing id) when the listing changes.
 */
export function LikeButton({ listing, compact = false }) {
  const { status, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState({ liked: listing.liked, likeCount: listing.likeCount });
  const [busy, setBusy] = useState(false);

  if (status === 'loading' || user?.id === listing.seller.id) return null;

  async function toggle(event) {
    // On a card the button sits over a link: do not follow it.
    event.preventDefault();
    event.stopPropagation();
    if (status !== 'signedIn') {
      navigate('/login', { state: { from: location.pathname + location.search } });
      return;
    }
    const previous = state;
    const liked = !previous.liked;
    // Show the change at once; put it back if the server refuses.
    setState({ liked, likeCount: previous.likeCount + (liked ? 1 : -1) });
    setBusy(true);
    try {
      setState(await api(`/listings/${listing.id}/like`, { method: liked ? 'PUT' : 'DELETE' }));
    } catch {
      setState(previous);
    } finally {
      setBusy(false);
    }
  }

  const label = state.liked ? 'Remove from liked' : 'Add to liked';

  if (compact) {
    return (
      <button
        type="button"
        aria-label={label}
        aria-pressed={state.liked}
        title={label}
        disabled={busy}
        onClick={toggle}
        className={`inline-flex size-9 items-center justify-center rounded-full bg-surface/95 shadow transition-colors hover:bg-surface ${
          state.liked ? 'text-danger' : 'text-ink'
        }`}
      >
        <Heart filled={state.liked} />
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={state.liked}
      disabled={busy}
      onClick={toggle}
      className={`inline-flex min-h-11 items-center gap-2 rounded-field border px-4 text-sm font-medium transition-colors ${
        state.liked
          ? 'border-danger/30 bg-danger-soft text-danger-strong'
          : 'border-line-strong bg-surface text-ink hover:bg-paper'
      }`}
    >
      <Heart filled={state.liked} />
      {state.liked ? 'Liked' : 'Like'}
      <span className="text-muted">· {state.likeCount}</span>
    </button>
  );
}
