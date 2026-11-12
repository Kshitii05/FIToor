import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Alert, ButtonLink, Card, Loading } from '../components/ui/index.js';
import { api } from '../lib/api.js';
import { formatMonthYear } from '../lib/format.js';

function initials(name) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

export default function PublicProfilePage() {
  const { id } = useParams();
  // Keyed by id, so a result for a previous profile is never shown for the current one.
  const [result, setResult] = useState({ id: null });

  useEffect(() => {
    let cancelled = false;
    api(`/users/${encodeURIComponent(id)}`, { auth: false })
      .then((data) => {
        if (!cancelled) setResult({ id, user: data.user });
      })
      .catch((error) => {
        if (!cancelled) setResult({ id, error });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (result.id !== id) return <Loading label="Loading profile" />;

  if (result.error) {
    const missing = result.error.status === 404 || result.error.status === 400;
    return (
      <div className="mx-auto max-w-md">
        <Alert
          tone={missing ? 'notice' : 'error'}
          title={missing ? 'Profile not found' : undefined}
        >
          {missing ? 'This person is not on the marketplace, or has left.' : result.error.message}
        </Alert>
        <ButtonLink to="/" variant="secondary" className="mt-5">
          Back to home
        </ButtonLink>
      </div>
    );
  }

  const { user } = result;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Card>
        <div className="flex items-center gap-4">
          {user.photoUrl ? (
            <img src={user.photoUrl} alt="" className="size-16 rounded-full object-cover" />
          ) : (
            <span
              aria-hidden="true"
              className="flex size-16 shrink-0 items-center justify-center rounded-full bg-accent-soft font-display text-xl font-semibold text-accent-strong"
            >
              {initials(user.displayName)}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="break-words font-display text-2xl font-semibold tracking-tight text-ink">
              {user.displayName}
            </h1>
            <p className="mt-0.5 text-sm text-muted">
              {user.locality ? `${user.locality} · ` : ''}Member since{' '}
              {formatMonthYear(user.memberSince)}
            </p>
          </div>
        </div>
        {user.bio ? (
          <p className="mt-5 whitespace-pre-line break-words text-ink">{user.bio}</p>
        ) : null}
      </Card>
    </div>
  );
}
