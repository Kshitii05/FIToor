import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FormPage, TextLink } from '../components/layout/AppLayout.jsx';
import { Alert, Button, Card, TextField } from '../components/ui/index.js';
import { api, fieldErrors } from '../lib/api.js';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const sentTo = location.state?.email;
  const [form, setForm] = useState({ email: sentTo ?? '', code: '', password: '' });
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
      await api('/auth/password/reset', { method: 'POST', body: form, auth: false });
      navigate('/login', {
        replace: true,
        state: { notice: 'Password updated. Sign in with your new password.' },
      });
    } catch (error) {
      const fields = fieldErrors(error);
      if (error.code.startsWith('OTP_')) fields.code = error.message;
      setErrors(fields);
      if (Object.keys(fields).length === 0) setFormError(error.message);
      setSubmitting(false);
    }
  }

  return (
    <FormPage
      title="Choose a new password"
      footer={
        <>
          No code yet? <TextLink to="/forgot-password">Request a new one</TextLink>
        </>
      }
    >
      <Card>
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          {sentTo ? (
            <Alert tone="info">
              If an account exists for {sentTo}, a 6-digit code has been sent to it. The code
              expires after 10 minutes.
            </Alert>
          ) : null}
          {formError ? <Alert tone="error">{formError}</Alert> : null}

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
            label="Reset code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            className="font-mono tracking-[0.4em]"
            required
            value={form.code}
            onChange={(event) => setForm({ ...form, code: event.target.value.replace(/\D/g, '') })}
            error={errors.code}
          />
          <TextField
            label="New password"
            type="password"
            autoComplete="new-password"
            hint="At least 8 characters. You will be signed out on every device."
            required
            value={form.password}
            onChange={update('password')}
            error={errors.password}
          />

          <Button type="submit" block loading={submitting}>
            Update password
          </Button>
        </form>
      </Card>
    </FormPage>
  );
}
