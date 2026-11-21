import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePostTransferBalances, validateP2PTransferInput } from './transferEngine';

test('validateP2PTransferInput accepts valid recipient, amount, and matching PIN', () => {
  const res = validateP2PTransferInput({
    senderUid: 'USR-1001',
    senderEmail: 'sender@zectrade.io',
    recipientIdentifier: 'USR-9012',
    amount: 50,
    availableBalance: 250,
    pinInput: '1234',
    expectedPin: '1234',
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.recipientIdentifier, 'USR-9012');
    assert.equal(res.amount, 50);
    assert.equal(res.pin, '1234');
  }
});

test('validateP2PTransferInput rejects self-transfer by UID or email (case-insensitive)', () => {
  const byUid = validateP2PTransferInput({
    senderUid: 'USR-1001',
    senderEmail: 'sender@zectrade.io',
    recipientIdentifier: 'USR-1001',
    amount: 25,
    availableBalance: 100,
    pinInput: '1234',
    expectedPin: '1234',
  });
  assert.equal(byUid.ok, false);
  if (!byUid.ok) assert.match(byUid.error, /own account/i);

  const byEmail = validateP2PTransferInput({
    senderUid: 'USR-1001',
    senderEmail: 'Sender@Zectrade.io',
    recipientIdentifier: 'sender@zectrade.io',
    amount: 25,
    availableBalance: 100,
    pinInput: '1234',
    expectedPin: '1234',
  });
  assert.equal(byEmail.ok, false);
  if (!byEmail.ok) assert.match(byEmail.error, /own account/i);
});

test('validateP2PTransferInput rejects insufficient balance, sub-$1 amounts, and invalid PINs', () => {
  const lowAmt = validateP2PTransferInput({
    senderUid: 'USR-1001',
    senderEmail: 'sender@zectrade.io',
    recipientIdentifier: 'USR-9012',
    amount: 0.5,
    availableBalance: 100,
    pinInput: '1234',
    expectedPin: '1234',
  });
  assert.equal(lowAmt.ok, false);

  const overBal = validateP2PTransferInput({
    senderUid: 'USR-1001',
    senderEmail: 'sender@zectrade.io',
    recipientIdentifier: 'USR-9012',
    amount: 150,
    availableBalance: 100,
    pinInput: '1234',
    expectedPin: '1234',
  });
  assert.equal(overBal.ok, false);
  if (!overBal.ok) assert.match(overBal.error, /Insufficient/i);

  const badPin = validateP2PTransferInput({
    senderUid: 'USR-1001',
    senderEmail: 'sender@zectrade.io',
    recipientIdentifier: 'USR-9012',
    amount: 20,
    availableBalance: 100,
    pinInput: '9999',
    expectedPin: '1234',
  });
  assert.equal(badPin.ok, false);
  if (!badPin.ok) assert.match(badPin.error, /Incorrect/i);
});

test('calculatePostTransferBalances deducts sender and credits recipient cleanly', async () => {
  const result = calculatePostTransferBalances({
    senderBalance: 500.25,
    recipientBalance: 2,
    amount: 125.75,
  });
  assert.equal(result.senderRemaining, 374.5);
  assert.equal(result.recipientNewBalance, 127.75);

  // Recipient who received $3,000 via P2P transfer without making a first deposit is still locked from withdrawing
  const { evaluateWithdrawalEligibility } = await import('./tradingEngine');
  const postTransferNoDeposit = evaluateWithdrawalEligibility({
    isBlocked: false,
    isWithdrawBlocked: false,
    hasDepositedBefore: false,
    hasTradedAfterDeposit: false,
    withdrawLockClearedByAdmin: false,
  });
  assert.equal(postTransferNoDeposit.allowed, false);
  assert.equal(postTransferNoDeposit.lockType, 'no_deposit');
  assert.equal(postTransferNoDeposit.reason, 'Please make your first deposit to withdraw funds.');
});

test('validateP2PTransferInput requires 6-digit 2FA code only when twoFactorEnabled is true', () => {
  const without2fa = validateP2PTransferInput({
    senderUid: 'USR-1001',
    senderEmail: 'sender@zectrade.io',
    recipientIdentifier: 'USR-9012',
    amount: 25,
    availableBalance: 100,
    pinInput: '1234',
    expectedPin: '1234',
    twoFactorEnabled: false,
  });
  assert.equal(without2fa.ok, true);

  const missingCode = validateP2PTransferInput({
    senderUid: 'USR-1001',
    senderEmail: 'sender@zectrade.io',
    recipientIdentifier: 'USR-9012',
    amount: 25,
    availableBalance: 100,
    pinInput: '1234',
    expectedPin: '1234',
    twoFactorEnabled: true,
    totpCode: '12',
  });
  assert.equal(missingCode.ok, false);
  if (!missingCode.ok) assert.match(missingCode.error, /Google Authenticator/i);

  const withValidFormat = validateP2PTransferInput({
    senderUid: 'USR-1001',
    senderEmail: 'sender@zectrade.io',
    recipientIdentifier: 'USR-9012',
    amount: 25,
    availableBalance: 100,
    pinInput: '1234',
    expectedPin: '1234',
    twoFactorEnabled: true,
    totpCode: '123456',
  });
  assert.equal(withValidFormat.ok, true);
});

test('validateP2PTransferInput blocks transfers when hasFirstDeposit is explicitly false', () => {
  const blocked = validateP2PTransferInput({
    senderUid: 'USR-1001',
    senderEmail: 'sender@zectrade.io',
    recipientIdentifier: 'USR-9012',
    amount: 25,
    availableBalance: 100,
    pinInput: '1234',
    expectedPin: '1234',
    hasFirstDeposit: false,
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.match(blocked.error, /First Deposit Required/i);
  }
});


