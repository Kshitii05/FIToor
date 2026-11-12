import { useState } from 'react';
import { useAuth } from '../auth/authContext.js';
import { FormPage, TextLink } from '../components/layout/AppLayout.jsx';
import { Alert, Button, Card, TextField } from '../components/ui/index.js';
import { APP_NAME } from '../config/app.js';
import { fieldErrors } from '../lib/api.js';

export default function RegisterPage() {
  const { register } = useAuth();
  const [form, setForm] = useState({ displayName: '', email: '', phone: '', password: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (field) => (event) => setForm({ ...form, [field]: event.target.value });

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});
    setFormError(null);
    try {
      // On success the guest-only route sends the new user on to verification.
      await register(form);
    } catch (error) {
      const fields = fieldErrors(error);
      if (error.code === 'EMAIL_TAKEN') fields.email = error.message;
      if (error.code === 'PHONE_TAKEN') fields.phone = error.message;
      setErrors(fields);
      if (Object.keys(fields).length === 0) setFormError(error.message);
      setSubmitting(false);
    }
  }

  return (
    <FormPage
      title="Create your account"
      intro={`One account for buying, selling and renting on ${APP_NAME}.`}
      footer={
        <>
          Already have an account? <TextLink to="/login">Sign in</TextLink>
        </>
      }
    >
      <Card>
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          {formError ? <Alert tone="error">{formError}</Alert> : null}

          <TextField
            label="Display name"
            hint="Shown on your public profile."
            autoComplete="nickname"
            required
            value={form.displayName}
            onChange={update('displayName')}
            error={errors.displayName}
          />
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={update('email')}
            error={errors.email}
          />
          <TextField
            label="Mobile number"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            prefix="+91"
            placeholder="98765 43210"
            hint="Never shown publicly."
            required
            value={form.phone}
            onChange={update('phone')}
            error={errors.phone}
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="new-password"
            hint="At least 8 characters."
            required
            value={form.password}
            onChange={update('password')}
            error={errors.password}
          />

          <Button type="submit" block loading={submitting}>
            Create account
          </Button>
        </form>
      </Card>
    </FormPage>
  );
}
