import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FormPage, TextLink } from '../components/layout/AppLayout.jsx';
import { Alert, Button, Card, TextField } from '../components/ui/index.js';
import { api, fieldErrors } from '../lib/api.js';

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});
    setFormError(null);
    try {
      await api('/auth/password/forgot', { method: 'POST', body: { email }, auth: false });
      // The email travels in router state, not the URL, so it stays out of browser history.
      navigate('/reset-password', { state: { email: email.trim() } });
    } catch (error) {
      const fields = fieldErrors(error);
      setErrors(fields);
      if (Object.keys(fields).length === 0) setFormError(error.message);
      setSubmitting(false);
    }
  }

  return (
    <FormPage
      title="Reset your password"
      intro="Enter the email you signed up with and we will send you a code."
      footer={
        <>
          Remembered it? <TextLink to="/login">Back to sign in</TextLink>
        </>
      }
    >
      <Card>
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          {formError ? <Alert tone="error">{formError}</Alert> : null}
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={errors.email}
          />
          <Button type="submit" block loading={submitting}>
            Send reset code
          </Button>
        </form>
      </Card>
    </FormPage>
  );
}
