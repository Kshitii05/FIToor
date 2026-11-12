import { APP_NAME } from '../../config/app.js';
import {
  ACCOUNT_RECOVERY_DAYS,
  BUSINESS_TIME_ZONE,
  OTP_EXPIRY_MINUTES,
} from '../../config/policy.js';

const dateFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: BUSINESS_TIME_ZONE,
  dateStyle: 'long',
  timeStyle: 'short',
});

export function verificationEmail(code) {
  return {
    subject: `Your ${APP_NAME} verification code`,
    text: `Your ${APP_NAME} verification code is ${code}. It expires in ${OTP_EXPIRY_MINUTES} minutes. If you did not create an account, ignore this email.`,
  };
}

export function passwordResetEmail(code) {
  return {
    subject: `Reset your ${APP_NAME} password`,
    text: `Your ${APP_NAME} password reset code is ${code}. It expires in ${OTP_EXPIRY_MINUTES} minutes. If you did not ask to reset your password, ignore this email.`,
  };
}

export function deletionScheduledEmail(scheduledFor) {
  return {
    subject: `Your ${APP_NAME} account is scheduled for deletion`,
    text: `Your ${APP_NAME} account has been deactivated and will be erased on ${dateFormatter.format(scheduledFor)} (India time), ${ACCOUNT_RECOVERY_DAYS} days after your request. To keep the account, recover it with your email and password before then. Records we are required to keep for legal, financial, fraud-prevention or dispute reasons are retained.`,
  };
}

export function accountRecoveredEmail() {
  return {
    subject: `Your ${APP_NAME} account has been recovered`,
    text: `The deletion of your ${APP_NAME} account was cancelled and the account is active again. If this was not you, reset your password now.`,
  };
}
