import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/authContext.js';
import { ListingRow } from '../components/listings/ListingCard.jsx';
import { Alert, ButtonLink, Card, Loading } from '../components/ui/index.js';
import { APP_NAME } from '../config/app.js';
import { api } from '../lib/api.js';

const HIGHLIGHTS = [
  {
    title: 'Buy and sell',
    body: 'Give good clothes a second life, and find pieces with a story.',
  },
  {
    title: 'Rent for the occasion',
    body: 'Borrow an outfit for a few days instead of buying it for one evening.',
  },
  {
    title: 'Close to home',
    body: 'Discover what people around you are offering.',
  },
];

// Where each section's "See all" leads. "For You" is personal and has no full list.
const SEE_ALL = {
  trending: '/search?sort=popular',
  recent: '/search?sort=newest',
  budget: '/search?maxPrice=1000&sort=popular',
  rent: '/search?mode=RENT&sort=popular',
};

function Sections({ signedIn }) {
  // Keyed by sign-in state: "For You" appears only for signed-in people.
  const [result, setResult] = useState({ key: null });
  const key = signedIn ? 'signedIn' : 'visitor';

  useEffect(() => {
    let cancelled = false;
    api('/home')
      .then((data) => {
        if (!cancelled) setResult({ key, data });
      })
      .catch((error) => {
        if (!cancelled) setResult({ key, error });
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (result.key !== key) return <Loading label="Loading listings" />;
  if (result.error) return <Alert tone="error">{result.error.message}</Alert>;

  const sections = result.data.sections.filter((section) => section.items.length > 0);
  if (sections.length === 0) {
    return (
      <Alert tone="info" title="Nothing listed yet">
        Be the first: list something you no longer wear.
      </Alert>
    );
  }

  return sections.map((section) => (
    <section key={section.key} aria-labelledby={`section-${section.key}`}>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2
          id={`section-${section.key}`}
          className="font-display text-2xl font-semibold tracking-tight text-ink"
        >
          {section.title}
        </h2>
        {SEE_ALL[section.key] ? (
          <Link
            to={SEE_ALL[section.key]}
            className="shrink-0 text-sm font-medium text-accent underline-offset-4 hover:underline"
          >
            See all
          </Link>
        ) : null}
      </div>
      <ListingRow listings={section.items} />
    </section>
  ));
}

export default function HomePage() {
  const { status, user } = useAuth();
  const signedIn = status === 'signedIn';
  const needsVerification = signedIn && !(user.emailVerified && user.phoneVerified);

  return (
    <div className="space-y-12">
      <section className="max-w-2xl">
        <p className="text-sm font-medium uppercase tracking-widest text-accent">
          Pre-loved fashion, nearby
        </p>
        <h1 className="mt-3 font-display text-4xl font-semibold leading-tight tracking-tight text-ink sm:text-5xl">
          {signedIn
            ? `Welcome back, ${user.profile.displayName}.`
            : 'Buy, sell and rent fashion from people around you.'}
        </h1>
        {signedIn ? null : (
          <p className="mt-4 text-lg text-muted">
            {APP_NAME} is a neighbourhood marketplace for clothes that deserve another outing.
          </p>
        )}

        {needsVerification ? (
          <Alert tone="notice" title="Finish setting up your account" className="mt-6">
            Verify your email and phone number so you can list, buy and rent.
          </Alert>
        ) : null}

        <div className="mt-7 flex flex-wrap gap-3">
          {signedIn ? (
            <>
              {needsVerification ? <ButtonLink to="/verify">Verify my account</ButtonLink> : null}
              {needsVerification ? null : <ButtonLink to="/listings/new">List an item</ButtonLink>}
              <ButtonLink to="/search" variant="secondary">
                Browse everything
              </ButtonLink>
            </>
          ) : (
            <>
              <ButtonLink to="/register">Create an account</ButtonLink>
              <ButtonLink to="/search" variant="secondary">
                Browse everything
              </ButtonLink>
            </>
          )}
        </div>
      </section>

      {status === 'loading' ? (
        <Loading label="Loading listings" />
      ) : (
        <Sections signedIn={signedIn} />
      )}

      {signedIn ? null : (
        <section aria-label="What you can do" className="grid gap-4 sm:grid-cols-3">
          {HIGHLIGHTS.map(({ title, body }) => (
            <Card key={title}>
              <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
              <p className="mt-2 text-sm text-muted">{body}</p>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}
