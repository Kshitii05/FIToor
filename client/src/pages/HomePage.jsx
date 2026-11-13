import { useAuth } from '../auth/authContext.js';
import { Alert, ButtonLink, Card } from '../components/ui/index.js';
import { APP_NAME } from '../config/app.js';

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
        <p className="mt-4 text-lg text-muted">
          {APP_NAME} is a neighbourhood marketplace for clothes that deserve another outing.
        </p>

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
              <ButtonLink to="/my-listings" variant="secondary">
                My listings
              </ButtonLink>
            </>
          ) : (
            <>
              <ButtonLink to="/register">Create an account</ButtonLink>
              <ButtonLink to="/login" variant="secondary">
                Sign in
              </ButtonLink>
            </>
          )}
        </div>
      </section>

      <section aria-label="What you can do" className="grid gap-4 sm:grid-cols-3">
        {HIGHLIGHTS.map(({ title, body }) => (
          <Card key={title}>
            <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
            <p className="mt-2 text-sm text-muted">{body}</p>
          </Card>
        ))}
      </section>
    </div>
  );
}
