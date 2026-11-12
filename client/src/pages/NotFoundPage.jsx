import { ButtonLink } from '../components/ui/index.js';

export default function NotFoundPage() {
  return (
    <div className="mx-auto max-w-md text-center">
      <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
        Page not found
      </h1>
      <p className="mt-2 text-muted">That link does not lead anywhere.</p>
      <ButtonLink to="/" className="mt-6">
        Back to home
      </ButtonLink>
    </div>
  );
}
