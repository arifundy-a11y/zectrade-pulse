import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ZECTRADE_ACTION_CODE_SETTINGS,
  formatFriendlyAuthError,
  isAuthActionPathname,
  isAuthCancellationError,
  mapFirebaseActionError,
  parseAuthActionLocation,
  validateNewPasswordPair,
} from './authAction';

test('ZECTRADE_ACTION_CODE_SETTINGS configures handleCodeInApp: true for zectrading.com/auth/action', () => {
  assert.deepEqual(ZECTRADE_ACTION_CODE_SETTINGS, {
    url: 'https://zectrading.com/auth/action',
    handleCodeInApp: true,
  });
});

test('isAuthActionPathname recognizes /auth/action and /__/auth/action cleanly', () => {
  assert.equal(isAuthActionPathname('/auth/action'), true);
  assert.equal(isAuthActionPathname('/auth/action/'), true);
  assert.equal(isAuthActionPathname('/__/auth/action'), true);
  assert.equal(isAuthActionPathname('/__/auth/action/'), true);
  assert.equal(isAuthActionPathname('/'), false);
  assert.equal(isAuthActionPathname('/trade'), false);
});

test('parseAuthActionLocation detects route from path or query params', () => {
  const resetRoute = parseAuthActionLocation(
    '/auth/action',
    '?mode=resetPassword&oobCode=CODE_123&apiKey=test'
  );
  assert.equal(resetRoute.isAuthActionRoute, true);
  assert.equal(resetRoute.mode, 'resetPassword');
  assert.equal(resetRoute.oobCode, 'CODE_123');

  const proxyRoute = parseAuthActionLocation(
    '/__/auth/action',
    '?mode=verifyEmail&oobCode=VERIFY_456'
  );
  assert.equal(proxyRoute.isAuthActionRoute, true);
  assert.equal(proxyRoute.mode, 'verifyEmail');
  assert.equal(proxyRoute.oobCode, 'VERIFY_456');

  const queryOnlyRoute = parseAuthActionLocation(
    '/',
    '?mode=verifyEmail&oobCode=ROOT_789'
  );
  assert.equal(queryOnlyRoute.isAuthActionRoute, true);
  assert.equal(queryOnlyRoute.mode, 'verifyEmail');
  assert.equal(queryOnlyRoute.oobCode, 'ROOT_789');

  const normalLanding = parseAuthActionLocation('/', '?ref=abc123');
  assert.equal(normalLanding.isAuthActionRoute, false);
  assert.equal(normalLanding.mode, 'unknown');
  assert.equal(normalLanding.oobCode, '');
});

test('validateNewPasswordPair enforces minimum length and matching confirmation', () => {
  const tooShort = validateNewPasswordPair('12345', '12345');
  assert.equal(tooShort.ok, false);

  const mismatch = validateNewPasswordPair('secret123', 'secret456');
  assert.equal(mismatch.ok, false);

  const valid = validateNewPasswordPair('StrongPass99!', 'StrongPass99!');
  assert.equal(valid.ok, true);
});

test('mapFirebaseActionError returns readable guidance for Firebase auth codes', () => {
  assert.match(
    mapFirebaseActionError({ code: 'auth/expired-action-code' }, 'resetPassword'),
    /expired/i
  );
  assert.match(
    mapFirebaseActionError({ code: 'auth/invalid-action-code' }, 'verifyEmail'),
    /invalid or has already been used/i
  );
  assert.match(
    mapFirebaseActionError({ code: 'auth/weak-password' }, 'resetPassword'),
    /at least 6 characters/i
  );
});

test('isAuthCancellationError identifies cancelled Google popup/redirect errors across codes and messages', () => {
  assert.equal(isAuthCancellationError({ code: 'auth/popup-closed-by-user' }), true);
  assert.equal(isAuthCancellationError({ code: 'auth/cancelled-popup-request' }), true);
  assert.equal(isAuthCancellationError({ code: 'auth/user-cancelled' }), true);
  assert.equal(
    isAuthCancellationError({
      message: 'Firebase: Error (auth/user-cancelled).',
    }),
    true
  );
  assert.equal(
    isAuthCancellationError({
      message: 'Firebase: IdP denied access (auth/user-cancelled).',
    }),
    true
  );
  assert.equal(
    isAuthCancellationError({
      message: 'popup-closed-by-user happened',
    }),
    true
  );
  assert.equal(
    isAuthCancellationError({ code: 'auth/network-request-failed', message: 'Network error' }),
    false
  );
});

test('formatFriendlyAuthError strips raw Firebase prefixes and auth codes and maps known errors', () => {
  assert.equal(
    formatFriendlyAuthError({ code: 'auth/invalid-credential', message: 'Firebase: Error (auth/invalid-credential).' }),
    'Invalid email or password.'
  );
  assert.equal(
    formatFriendlyAuthError({ code: 'auth/email-already-in-use' }),
    'This email is already registered.'
  );
  assert.equal(
    formatFriendlyAuthError({ code: 'auth/network-request-failed' }),
    'Network error. Please try again.'
  );
  assert.equal(
    formatFriendlyAuthError({
      code: 'auth/internal-error',
      message: 'Firebase: Something unexpected happened while connecting (auth/internal-error).',
    }),
    'Something unexpected happened while connecting'
  );
  assert.equal(
    formatFriendlyAuthError({ message: 'Firebase: Error (auth/unknown).' }, 'Google Sign-In failed.'),
    'Google Sign-In failed.'
  );
});
