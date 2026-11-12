import { useEffect, useState } from 'react';
import { useAuth } from '../auth/authContext.js';
import { TextLink } from '../components/layout/AppLayout.jsx';
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  SectionHeading,
  TextField,
} from '../components/ui/index.js';
import { api } from '../lib/api.js';

const CODE_LENGTH = 6;

/** Counts down to zero, one second at a time. */
function useCountdown() {
  const [seconds, setSeconds] = useState(0);
  const running = seconds > 0;

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [running]);

  return [seconds, setSeconds];
}

function describeError(error) {
  const remaining = error.details?.attemptsRemaining;
  if (error.code === 'OTP_INVALID' && typeof remaining === 'number') {
    return remaining > 0
      ? `That code is not right. ${remaining} ${remaining === 1 ? 'attempt' : 'attempts'} left.`
      : 'That code is not right, and it has now been locked. Request a new code.';
  }
  return error.message;
}

function ChannelVerifier({ channel, title, destination, verified }) {
  const { setUser } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [sending, setSending] = useState(false);
  const [waitSeconds, setWaitSeconds] = useCountdown();

  if (verified) {
    return (
      <Card>
        <SectionHeading
          title={title}
          description={destination}
          action={<Badge tone="success">Verified</Badge>}
        />
        <p className="text-sm text-muted">Nothing more to do here.</p>
      </Card>
    );
  }

  async function handleVerify(event) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (code.length !== CODE_LENGTH) {
      setError(`Enter the ${CODE_LENGTH}-digit code.`);
      return;
    }
    setVerifying(true);
    try {
      const { user } = await api('/auth/otp/verify', { method: 'POST', body: { channel, code } });
      setUser(user);
    } catch (failure) {
      setError(describeError(failure));
      setCode('');
      setVerifying(false);
    }
  }

  async function handleResend() {
    setError(null);
    setNotice(null);
    setSending(true);
    try {
      await api('/auth/otp/send', { method: 'POST', body: { channel } });
      setNotice(`A new code is on its way to ${destination}. Earlier codes no longer work.`);
      setWaitSeconds(60);
    } catch (failure) {
      if (failure.code === 'OTP_RESEND_TOO_SOON') {
        setWaitSeconds(failure.details.retryAfterSeconds);
      }
      setError(failure.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <SectionHeading
        title={title}
        description={`We sent a ${CODE_LENGTH}-digit code to ${destination}.`}
        action={<Badge tone="notice">Not verified</Badge>}
      />

      <form onSubmit={handleVerify} noValidate className="space-y-4">
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        <TextField
          label="Verification code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={CODE_LENGTH}
          placeholder="000000"
          className="font-mono tracking-[0.4em]"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
          error={error}
          hint="Codes expire after 10 minutes."
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={verifying}>
            Verify
          </Button>
          <Button
            variant="ghost"
            loading={sending}
            disabled={waitSeconds > 0}
            onClick={handleResend}
          >
            {waitSeconds > 0 ? `Resend in ${waitSeconds}s` : 'Send a new code'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function VerifyPage() {
  const { user } = useAuth();
  const allVerified = user.emailVerified && user.phoneVerified;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
        Verify your account
      </h1>
      <p className="mt-2 text-muted">
        Confirm your email and phone number. Both are needed before you can list, buy or rent.
      </p>

      {import.meta.env.DEV ? (
        <Alert tone="info" className="mt-5">
          Development build: no email or SMS provider is connected, so codes are printed in the
          server console.
        </Alert>
      ) : null}

      {allVerified ? (
        <Alert tone="success" title="You are all set" className="mt-5">
          <p>Your email and phone number are both verified.</p>
          <ButtonLink to="/profile" size="sm" className="mt-3">
            Go to my profile
          </ButtonLink>
        </Alert>
      ) : null}

      <div className="mt-6 space-y-5">
        <ChannelVerifier
          channel="email"
          title="Email"
          destination={user.email}
          verified={user.emailVerified}
        />
        <ChannelVerifier
          channel="phone"
          title="Mobile number"
          destination={user.phone}
          verified={user.phoneVerified}
        />
      </div>

      {!allVerified ? (
        <p className="mt-6 text-sm text-muted">
          Want to do this later? <TextLink to="/profile">Continue to your profile</TextLink>
        </p>
      ) : null}
    </div>
  );
}
