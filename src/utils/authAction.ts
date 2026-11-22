import type { ActionCodeSettings } from 'firebase/auth';

export const ZECTRADE_ACTION_CODE_SETTINGS: ActionCodeSettings = {
  url: 'https://zectrading.com/auth/action',
  handleCodeInApp: true,
};

export type AuthActionMode = 'resetPassword' | 'verifyEmail' | 'recoverEmail' | 'unknown';

export interface ParsedAuthActionRoute {
  isAuthActionRoute: boolean;
  mode: AuthActionMode;
  oobCode: string;
  continueUrl: string | null;
}

const CANCELLED_AUTH_CODES = new Set([
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
  'auth/user-cancelled',
]);

export function isAuthCancellationError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const fbErr = err as { code?: unknown; message?: unknown };
  const code = typeof fbErr.code === 'string' ? fbErr.code.trim() : '';
  if (CANCELLED_AUTH_CODES.has(code)) {
    return true;
  }
  const msg = typeof fbErr.message === 'string' ? fbErr.message : '';
  if (!msg) return false;
  const lower = msg.toLowerCase();
  return (
    lower.includes('auth/user-cancelled') ||
    lower.includes('popup-closed-by-user') ||
    lower.includes('cancelled-popup-request') ||
    lower.includes('idp denied access')
  );
}

export function formatFriendlyAuthError(
  err: unknown,
  fallback = 'Authentication failed. Please try again.'
): string {
  const fbErr = (err && typeof err === 'object' ? err : {}) as {
    code?: unknown;
    message?: unknown;
  };
  const code = typeof fbErr.code === 'string' ? fbErr.code.trim() : '';

  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Invalid email or password.';
    case 'auth/email-already-in-use':
      return 'This email is already registered.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    case 'auth/network-request-failed':
      return 'Network error. Please try again.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    case 'auth/popup-blocked':
      return 'Sign-in popup was blocked by your browser. Please allow popups and try again.';
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email using another sign-in method.';
    default:
      break;
  }

  const rawMessage =
    typeof fbErr.message === 'string'
      ? fbErr.message
      : err instanceof Error
      ? err.message
      : '';

  if (!rawMessage.trim()) return fallback;

  const cleaned = rawMessage
    .replace(/^Firebase:\s*/i, '')
    .replace(/\s*\(auth\/[^)]+\)\.?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!cleaned || /^error\.?$/i.test(cleaned)) {
    return fallback;
  }
  return cleaned;
}

function normalizeActionMode(rawMode: string | null): AuthActionMode {
  const clean = (rawMode || '').trim();
  if (clean === 'resetPassword') return 'resetPassword';
  if (clean === 'verifyEmail') return 'verifyEmail';
  if (clean === 'recoverEmail') return 'recoverEmail';
  return 'unknown';
}

export function isAuthActionPathname(pathname: string): boolean {
  const normalized = pathname.trim().toLowerCase().replace(/\/+$/, '') || '/';
  return normalized === '/auth/action' || normalized === '/__/auth/action';
}

export function parseAuthActionLocation(
  pathname: string,
  search: string
): ParsedAuthActionRoute {
  const params = new URLSearchParams(search || '');
  let rawMode = params.get('mode');
  let rawCode = params.get('oobCode');
  const continueUrl = params.get('continueUrl')?.trim() || null;

  // Also inspect nested continueUrl query parameters if Firebase wrapped them
  if ((!rawMode || !rawCode) && continueUrl) {
    try {
      const nested = new URL(continueUrl, 'https://zectrading.com');
      rawMode = rawMode || nested.searchParams.get('mode');
      rawCode = rawCode || nested.searchParams.get('oobCode');
    } catch {
      // Ignore malformed continueUrl
    }
  }

  const oobCode = (rawCode || '').trim();
  const mode = normalizeActionMode(rawMode);
  const hasModeAndCode = Boolean((rawMode || '').trim() && oobCode);
  const isAuthActionRoute = isAuthActionPathname(pathname) || hasModeAndCode;

  return {
    isAuthActionRoute,
    mode,
    oobCode,
    continueUrl,
  };
}

export function validateNewPasswordPair(
  password: string,
  confirmPassword: string
): { ok: true } | { ok: false; error: string } {
  if (!password || password.length < 6) {
    return {
      ok: false,
      error: 'New password must be at least 6 characters long.',
    };
  }
  if (password !== confirmPassword) {
    return {
      ok: false,
      error: 'Passwords do not match. Please enter the same password twice.',
    };
  }
  return { ok: true };
}

export function mapFirebaseActionError(
  err: unknown,
  mode: AuthActionMode
): string {
  const code = (err as { code?: string } | null)?.code || '';
  if (code === 'auth/expired-action-code') {
    return mode === 'resetPassword'
      ? 'This password reset link has expired. Please request a new reset email.'
      : 'This verification link has expired. Please request a new verification email.';
  }
  if (code === 'auth/invalid-action-code') {
    return 'This security link is invalid or has already been used.';
  }
  if (code === 'auth/user-disabled') {
    return 'This account has been disabled. Contact support if you need assistance.';
  }
  if (code === 'auth/user-not-found') {
    return 'No matching Zectrade account was found for this link.';
  }
  if (code === 'auth/weak-password') {
    return 'Password is too weak. Please choose at least 6 characters.';
  }
  const message = (err as { message?: string } | null)?.message;
  if (typeof message === 'string' && message.trim() && !message.includes('Firebase:')) {
    return message;
  }
  return mode === 'resetPassword'
    ? 'Unable to verify or complete password reset. Please request a fresh link.'
    : 'Unable to verify email with this link. Please request a fresh verification email.';
}
