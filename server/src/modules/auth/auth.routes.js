import { Router } from 'express';
import { requireTrustedOrigin } from '../../lib/auth.js';
import { AppError } from '../../lib/errors.js';
import { recoverAccount } from '../users/deletion.service.js';
import {
  login,
  register,
  requestPasswordReset,
  resetPassword,
  sendVerificationOtp,
  verifyContact,
} from './auth.service.js';
import {
  credentialsSchema,
  forgotPasswordSchema,
  otpSendSchema,
  otpVerifySchema,
  registerSchema,
  resetPasswordSchema,
} from './auth.validation.js';
import {
  clearRefreshCookie,
  readRefreshCookie,
  revokeSessionByRefreshToken,
  rotateSession,
  setRefreshCookie,
} from './session.service.js';

function clientInfo(req) {
  return { userAgent: req.get('user-agent'), ipAddress: req.ip };
}

/** Sets the refresh cookie and returns the body for a newly signed-in user. */
function signedIn(res, { user, session }) {
  setRefreshCookie(res, session);
  return { user, accessToken: session.accessToken };
}

export function createAuthRouter(deps) {
  const { db, clock, limiters, requireAuth } = deps;
  const router = Router();

  router.post('/register', limiters.register, async (req, res) => {
    const input = registerSchema.parse(req.body);
    const result = await register(deps, input, clientInfo(req));
    res.status(201).json(signedIn(res, result));
  });

  router.post('/login', limiters.login, async (req, res) => {
    const credentials = credentialsSchema.parse(req.body);
    const result = await login(deps, credentials, clientInfo(req));
    res.json(signedIn(res, result));
  });

  router.post('/refresh', requireTrustedOrigin, async (req, res) => {
    const refreshToken = readRefreshCookie(req);
    if (!refreshToken) throw AppError.unauthorized('Session expired or invalid');

    try {
      const session = await rotateSession(db, clock, refreshToken);
      setRefreshCookie(res, session);
      res.json({ accessToken: session.accessToken });
    } catch (error) {
      clearRefreshCookie(res);
      throw error;
    }
  });

  router.post('/logout', requireTrustedOrigin, async (req, res) => {
    const refreshToken = readRefreshCookie(req);
    if (refreshToken) await revokeSessionByRefreshToken(db, clock, refreshToken);
    clearRefreshCookie(res);
    res.status(204).end();
  });

  router.post('/otp/send', limiters.otp, requireAuth, async (req, res) => {
    const { channel } = otpSendSchema.parse(req.body);
    await sendVerificationOtp(deps, { userId: req.auth.userId, channel });
    res.status(202).json({ sent: true });
  });

  router.post('/otp/verify', limiters.otp, requireAuth, async (req, res) => {
    const { channel, code } = otpVerifySchema.parse(req.body);
    const user = await verifyContact(deps, { userId: req.auth.userId, channel, code });
    res.json({ user });
  });

  router.post('/password/forgot', limiters.passwordReset, async (req, res) => {
    const input = forgotPasswordSchema.parse(req.body);
    await requestPasswordReset(deps, input);
    // Same answer whether or not the email belongs to an account.
    res.status(202).json({ sent: true });
  });

  router.post('/password/reset', limiters.passwordReset, async (req, res) => {
    const input = resetPasswordSchema.parse(req.body);
    await resetPassword(deps, input);
    clearRefreshCookie(res);
    res.status(204).end();
  });

  router.post('/recover', limiters.login, async (req, res) => {
    const credentials = credentialsSchema.parse(req.body);
    const result = await recoverAccount(deps, credentials, clientInfo(req));
    res.json(signedIn(res, result));
  });

  return router;
}
