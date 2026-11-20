import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';

export const TOTP_ISSUER = 'Zectrade';
export const EMAIL_VERIFICATION_COOLDOWN_MS = 60_000;

export interface TwoFactorSetupPayload {
  secretBase32: string;
  otpauthUri: string;
  qrDataUrl: string;
}

export function normalizeTotpCodeInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 6);
}

export function normalizeBase32Secret(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, '').toUpperCase();
}

export function createTotpInstance(params: {
  email: string;
  secretBase32: string;
  issuer?: string;
}): OTPAuth.TOTP {
  const issuer = params.issuer?.trim() || TOTP_ISSUER;
  const label = params.email.trim() || 'Trader';
  const secret = OTPAuth.Secret.fromBase32(normalizeBase32Secret(params.secretBase32));
  return new OTPAuth.TOTP({
    issuer,
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });
}

export async function generateTwoFactorSetup(params: {
  email: string;
  issuer?: string;
}): Promise<TwoFactorSetupPayload> {
  const secret = new OTPAuth.Secret({ size: 20 });
  const secretBase32 = secret.base32;
  const totp = createTotpInstance({
    email: params.email,
    secretBase32,
    issuer: params.issuer,
  });
  const otpauthUri = totp.toString();
  const qrDataUrl = await QRCode.toDataURL(otpauthUri, {
    width: 220,
    margin: 2,
    color: {
      dark: '#0f172a',
      light: '#ffffff',
    },
  });

  return {
    secretBase32,
    otpauthUri,
    qrDataUrl,
  };
}

export function verifyTotpCode(
  secretBase32: string | null | undefined,
  codeInput: string,
  options?: { timestamp?: number; window?: number; email?: string }
): boolean {
  const cleanSecret = normalizeBase32Secret(secretBase32);
  const cleanCode = codeInput.trim();
  if (!cleanSecret || !/^\d{6}$/.test(cleanCode)) {
    return false;
  }

  try {
    const totp = createTotpInstance({
      email: options?.email || 'Trader',
      secretBase32: cleanSecret,
    });
    const delta = totp.validate({
      token: cleanCode,
      window: options?.window ?? 1,
      timestamp: options?.timestamp,
    });
    return delta !== null;
  } catch {
    return false;
  }
}

export function getEmailCooldownStatus(
  lastSentAtMs: number | null,
  nowMs: number = Date.now(),
  cooldownMs: number = EMAIL_VERIFICATION_COOLDOWN_MS
): { canSend: boolean; remainingSeconds: number } {
  if (lastSentAtMs === null || !Number.isFinite(lastSentAtMs)) {
    return { canSend: true, remainingSeconds: 0 };
  }
  const elapsed = nowMs - lastSentAtMs;
  if (elapsed >= cooldownMs) {
    return { canSend: true, remainingSeconds: 0 };
  }
  return {
    canSend: false,
    remainingSeconds: Math.max(1, Math.ceil((cooldownMs - elapsed) / 1000)),
  };
}
