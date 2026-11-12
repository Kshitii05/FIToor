import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../auth/authContext.js';
import { FormPage, TextLink } from '../components/layout/AppLayout.jsx';
import { Alert, Button, Card, TextField } from '../components/ui/index.js';
import { fieldErrors } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';

export default function LoginPage() {
  const { login, recover, notice: sessionNotice } = useAuth();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [recoverableUntil, setRecoverableUntil] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const notice = sessionNotice ?? location.state?.notice;

  const update = (field) => (event) => {
    setForm({ ...form, [field]: event.target.value });
    setRecoverableUntil(null);
  };

  // On success the guest-only route moves the user on, so there is nothing to do here.
  async function submit(action) {
    setSubmitting(true);
    setErrors({});
    setFormError(null);
    try {
      await action(form);
    } catch (error) {
      if (error.code === 'ACCOUNT_PENDING_DELETION') {
        setRecoverableUntil(error.details.recoverableUntil);
      } else {
        const fields = fieldErrors(error);
        setErrors(fields);
        if (Object.keys(fields).length === 0) setFormError(error.message);
      }
      setSubmitting(false);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    submit(login);
  }

  return (
    <FormPage
      title="Sign in"
      footer={
        <>
          New here? <TextLink to="/register">Create an account</TextLink>
        </>
      }
    >
      <Card>
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          {notice ? <Alert tone="info">{notice}</Alert> : null}
          {formError ? <Alert tone="error">{formError}</Alert> : null}

          {recoverableUntil ? (
            <Alert tone="notice" title="This account is scheduled for deletion">
              <p>
                It will be erased on {formatDateTime(recoverableUntil)}. Recover it to cancel the
                deletion and sign in.
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                loading={submitting}
                onClick={() => submit(recover)}
              >
                Recover my account
              </Button>
            </Alert>
          ) : null}

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
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={form.password}
            onChange={update('password')}
            error={errors.password}
          />

          <Button type="submit" block loading={submitting && !recoverableUntil}>
            Sign in
          </Button>

          <p className="text-center text-sm">
            <TextLink to="/forgot-password">Forgot your password?</TextLink>
          </p>
        </form>
      </Card>
    </FormPage>
  );
}
