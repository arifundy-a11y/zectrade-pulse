export const FIRST_DEPOSIT_REQUIRED_MESSAGE =
  'First Deposit Required: You must complete your first deposit before making transfers or withdrawals.';

export interface P2PTransferValidationInput {
  senderUid: string;
  senderEmail: string;
  recipientIdentifier: string;
  amount: number;
  availableBalance: number;
  pinInput: string;
  expectedPin?: string;
  hasFirstDeposit?: boolean;
  twoFactorEnabled?: boolean;
  totpCode?: string;
}

export type P2PTransferValidationResult =
  | {
      ok: true;
      recipientIdentifier: string;
      amount: number;
      pin: string;
      totpCode?: string;
    }
  | {
      ok: false;
      error: string;
    };

export function roundUsd2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function validateP2PTransferInput(
  input: P2PTransferValidationInput
): P2PTransferValidationResult {
  if (input.hasFirstDeposit === false) {
    return { ok: false, error: FIRST_DEPOSIT_REQUIRED_MESSAGE };
  }

  const recipientIdentifier = input.recipientIdentifier.trim();
  if (!recipientIdentifier) {
    return { ok: false, error: 'Enter recipient UID or email.' };
  }

  const normalizedRecipientLower = recipientIdentifier.toLowerCase();
  if (
    recipientIdentifier === input.senderUid.trim() ||
    (input.senderEmail.trim() && normalizedRecipientLower === input.senderEmail.trim().toLowerCase())
  ) {
    return { ok: false, error: 'Cannot transfer to your own account.' };
  }

  const amount = roundUsd2(input.amount);
  if (!Number.isFinite(input.amount) || amount < 1) {
    return { ok: false, error: 'Minimum transfer amount is $1.00.' };
  }

  const available = roundUsd2(input.availableBalance);
  if (amount > available) {
    return { ok: false, error: 'Insufficient available balance.' };
  }

  const pin = input.pinInput.trim();
  if (!/^\d{4}$/.test(pin)) {
    return { ok: false, error: 'Enter your 4-digit Security PIN.' };
  }

  if (input.expectedPin !== undefined && pin !== input.expectedPin) {
    return { ok: false, error: 'Incorrect 4-digit Security PIN.' };
  }

  const totpCode = (input.totpCode || '').trim();
  if (input.twoFactorEnabled && !/^\d{6}$/.test(totpCode)) {
    return { ok: false, error: 'Enter your 6-digit Google Authenticator code.' };
  }

  return {
    ok: true,
    recipientIdentifier,
    amount,
    pin,
    totpCode: totpCode || undefined,
  };
}

export function calculatePostTransferBalances(params: {
  senderBalance: number;
  recipientBalance: number;
  amount: number;
}): {
  senderRemaining: number;
  recipientNewBalance: number;
} {
  const safeAmt = Math.max(0, roundUsd2(params.amount));
  const senderRemaining = Math.max(0, roundUsd2(params.senderBalance - safeAmt));
  const recipientNewBalance = roundUsd2(params.recipientBalance + safeAmt);
  return {
    senderRemaining,
    recipientNewBalance,
  };
}
