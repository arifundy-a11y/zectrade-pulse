import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createTotpInstance,
  generateTwoFactorSetup,
  getEmailCooldownStatus,
  normalizeTotpCodeInput,
  verifyTotpCode,
} from './twoFactor';

describe('Google Authenticator TOTP (browser-native otpauth + qrcode)', () => {
  it('generates a valid Base32 secret, Zectrade otpauth URI, and QR code data URL', async () => {
    const setup = await generateTwoFactorSetup({ email: 'trader@zectrading.com' });
    assert.ok(setup.secretBase32.length >= 16);
    assert.match(setup.secretBase32, /^[A-Z2-7]+$/);
    assert.ok(setup.otpauthUri.startsWith('otpauth://totp/'));
    assert.ok(setup.otpauthUri.includes('Zectrade'));
    assert.ok(setup.otpauthUri.includes(encodeURIComponent('trader@zectrading.com')));
    assert.ok(setup.qrDataUrl.startsWith('data:image/png;base64,'));
  });

  it('verifies valid 6-digit TOTP tokens and rejects invalid or expired codes', async () => {
    const setup = await generateTwoFactorSetup({ email: 'alice@zectrading.com' });
    const totp = createTotpInstance({
      email: 'alice@zectrading.com',
      secretBase32: setup.secretBase32,
    });

    const fixedTime = 1_700_000_000_000;
    const validToken = totp.generate({ timestamp: fixedTime });
    assert.match(validToken, /^\d{6}$/);

    assert.equal(
      verifyTotpCode(setup.secretBase32, validToken, { timestamp: fixedTime }),
      true
    );
    // Allows +/- 1 time step (30s) clock drift
    assert.equal(
      verifyTotpCode(setup.secretBase32, validToken, { timestamp: fixedTime + 25_000 }),
      true
    );
    // Rejects expired code outside window
    assert.equal(
      verifyTotpCode(setup.secretBase32, validToken, { timestamp: fixedTime + 120_000 }),
      false
    );
    // Rejects wrong or malformed tokens
    const wrongToken = validToken === '000000' ? '999999' : '000000';
    assert.equal(
      verifyTotpCode(setup.secretBase32, wrongToken, { timestamp: fixedTime }),
      false
    );
    assert.equal(verifyTotpCode(setup.secretBase32, '12345', { timestamp: fixedTime }), false);
    assert.equal(verifyTotpCode(null, validToken, { timestamp: fixedTime }), false);
  });

  it('normalizes user-typed authenticator input to 6 digits', () => {
    assert.equal(normalizeTotpCodeInput('12a 34b-5678'), '123456');
  });
});

describe('Email verification 60-second cooldown calculation', () => {
  it('enforces a 60-second cooldown cleanly', () => {
    assert.deepEqual(getEmailCooldownStatus(null, 100_000), {
      canSend: true,
      remainingSeconds: 0,
    });
    assert.deepEqual(getEmailCooldownStatus(100_000, 100_500), {
      canSend: false,
      remainingSeconds: 60,
    });
    assert.deepEqual(getEmailCooldownStatus(100_000, 145_200), {
      canSend: false,
      remainingSeconds: 15,
    });
    assert.deepEqual(getEmailCooldownStatus(100_000, 160_000), {
      canSend: true,
      remainingSeconds: 0,
    });
  });
});
