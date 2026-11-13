import { useEffect, useState } from 'react';
import { useAuth } from '../auth/authContext.js';
import { TextLink } from '../components/layout/AppLayout.jsx';
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  Loading,
  SectionHeading,
  Switch,
  TextArea,
  TextField,
} from '../components/ui/index.js';
import { api, fieldErrors } from '../lib/api.js';
import { formatDateTime, formatMonthYear } from '../lib/format.js';

function ProfileDetails() {
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({
    displayName: user.profile.displayName,
    bio: user.profile.bio ?? '',
    locality: user.profile.locality ?? '',
  });
  const [errors, setErrors] = useState({});
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);

  const update = (field) => (event) => {
    setForm({ ...form, [field]: event.target.value });
    setResult(null);
  };

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    setResult(null);
    try {
      const { user: updated } = await api('/me/profile', { method: 'PATCH', body: form });
      setUser(updated);
      setResult({ tone: 'success', message: 'Profile saved.' });
    } catch (error) {
      const fields = fieldErrors(error);
      setErrors(fields);
      if (Object.keys(fields).length === 0) setResult({ tone: 'error', message: error.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <SectionHeading
        title="Public profile"
        description="This is what other people see."
        action={
          <ButtonLink to={`/users/${user.id}`} variant="ghost" size="sm">
            View public profile
          </ButtonLink>
        }
      />
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {result ? <Alert tone={result.tone}>{result.message}</Alert> : null}
        <TextField
          label="Display name"
          autoComplete="nickname"
          required
          value={form.displayName}
          onChange={update('displayName')}
          error={errors.displayName}
        />
        <TextArea
          label="About you"
          hint="Up to 500 characters."
          maxLength={500}
          value={form.bio}
          onChange={update('bio')}
          error={errors.bio}
        />
        <TextField
          label="Area"
          hint="A neighbourhood or city, for example Indiranagar. Never your address."
          maxLength={80}
          value={form.locality}
          onChange={update('locality')}
          error={errors.locality}
        />
        <Button type="submit" loading={saving}>
          Save profile
        </Button>
      </form>
    </Card>
  );
}

function ContactRow({ label, value, verified }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-3">
      <div>
        <p className="text-sm text-muted">{label}</p>
        <p className="font-medium text-ink">{value}</p>
      </div>
      <Badge tone={verified ? 'success' : 'notice'}>{verified ? 'Verified' : 'Not verified'}</Badge>
    </div>
  );
}

function AccountDetails() {
  const { user } = useAuth();
  const allVerified = user.emailVerified && user.phoneVerified;

  return (
    <Card>
      <SectionHeading
        title="Account"
        description={`Member since ${formatMonthYear(user.createdAt)}. Only you can see these details.`}
      />
      <div className="divide-y divide-line">
        <ContactRow label="Email" value={user.email} verified={user.emailVerified} />
        <ContactRow label="Mobile number" value={user.phone} verified={user.phoneVerified} />
      </div>
      {!allVerified ? (
        <ButtonLink to="/verify" variant="secondary" size="sm" className="mt-4">
          Verify now
        </ButtonLink>
      ) : null}
    </Card>
  );
}

function NotificationPreferences() {
  const [preferences, setPreferences] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api('/me/preferences')
      .then((data) => {
        if (!cancelled) setPreferences(data.preferences);
      })
      .catch((failure) => {
        if (!cancelled) setError(failure.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function change(field, value) {
    const previous = preferences;
    setPreferences({ ...preferences, [field]: value });
    setError(null);
    setSaving(true);
    try {
      const data = await api('/me/preferences', { method: 'PATCH', body: { [field]: value } });
      setPreferences(data.preferences);
    } catch (failure) {
      setPreferences(previous);
      setError(`Could not save that change. ${failure.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <SectionHeading title="Notifications" description="Choose how you hear from us." />
      {error ? <Alert tone="error">{error}</Alert> : null}
      {preferences ? (
        <div className="divide-y divide-line">
          <Switch
            label="Email"
            description="Updates about your orders, rentals and messages by email."
            checked={preferences.emailNotifications}
            disabled={saving}
            onChange={(value) => change('emailNotifications', value)}
          />
          <Switch
            label="In the app"
            description="Notifications shown while you are signed in."
            checked={preferences.inAppNotifications}
            disabled={saving}
            onChange={(value) => change('inAppNotifications', value)}
          />
        </div>
      ) : error ? null : (
        <Loading label="Loading preferences" />
      )}
    </Card>
  );
}

function SignOut() {
  const { logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    // Signing out sends the user to the sign-in page, so there is nothing to reset.
    await logout();
  }

  return (
    <Card>
      <SectionHeading title="Sign out" description="Ends your session on this device." />
      <Button variant="secondary" loading={signingOut} onClick={handleSignOut}>
        Sign out
      </Button>
    </Card>
  );
}

function DeleteAccount() {
  const { clearSession } = useAuth();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [formError, setFormError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setFormError(null);
    if (!password) {
      setError('Enter your password to confirm.');
      return;
    }
    setDeleting(true);
    try {
      const { recoverableUntil } = await api('/me/deletion', {
        method: 'POST',
        body: { password },
      });
      // Signing out sends the user to the sign-in page, which shows this notice.
      clearSession(
        `Your account is scheduled for deletion. Sign in before ${formatDateTime(recoverableUntil)} to recover it.`,
      );
    } catch (failure) {
      if (failure.code === 'INVALID_PASSWORD') {
        setError(failure.message);
      } else if (failure.code === 'DELETION_BLOCKED') {
        setFormError(`${failure.message}: ${(failure.details?.reasons ?? []).join('; ')}`);
      } else {
        setFormError(failure.message);
      }
      setDeleting(false);
    }
  }

  return (
    <Card className="border-danger/30">
      <SectionHeading
        title="Delete account"
        description="Your account is deactivated straight away and erased after 30 days. Until then you can recover it by signing in. Records we are required to keep, such as past transactions, are retained."
      />
      {open ? (
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {formError ? <Alert tone="error">{formError}</Alert> : null}
          <TextField
            label="Confirm with your password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={error}
          />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="danger" loading={deleting}>
              Delete my account
            </Button>
            <Button variant="secondary" disabled={deleting} onClick={() => setOpen(false)}>
              Keep my account
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Delete my account…
        </Button>
      )}
    </Card>
  );
}

export default function ProfilePage() {
  const { user } = useAuth();
  const allVerified = user.emailVerified && user.phoneVerified;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">Your profile</h1>

      {!allVerified ? (
        <Alert tone="notice" title="Your account is not fully verified" className="mt-5">
          Verify your email and phone number so you can list, buy and rent.{' '}
          <TextLink to="/verify">Verify now</TextLink>
        </Alert>
      ) : null}

      <div className="mt-6 space-y-5">
        <ProfileDetails />
        <AccountDetails />
        <NotificationPreferences />
        <SignOut />
        <DeleteAccount />
      </div>
    </div>
  );
}
