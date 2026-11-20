import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  Mail,
  RefreshCw,
  Shield,
  ShieldCheck,
  ShieldOff,
} from 'lucide-react';
import type { UserProfile } from '../types';
import {
  EMAIL_VERIFICATION_COOLDOWN_MS,
  generateTwoFactorSetup,
  getEmailCooldownStatus,
  normalizeTotpCodeInput,
  verifyTotpCode,
  type TwoFactorSetupPayload,
} from '../utils/twoFactor';

interface AccountSecurityCardProps {
  user: UserProfile;
  onOpenPinModal: () => void;
  onSendVerificationEmail: () => Promise<{ ok: boolean; sentAtMs?: number }>;
  onRefreshEmailVerification: () => Promise<void>;
  onEnableTwoFactor: (secretBase32: string, verificationCode: string) => Promise<{ ok: boolean; error?: string }>;
  onDisableTwoFactor: (verificationCode: string) => Promise<{ ok: boolean; error?: string }>;
  onCopySetupKey?: (secret: string) => void;
}

export const AccountSecurityCard: React.FC<AccountSecurityCardProps> = ({
  user,
  onOpenPinModal,
  onSendVerificationEmail,
  onRefreshEmailVerification,
  onEnableTwoFactor,
  onDisableTwoFactor,
  onCopySetupKey,
}) => {
  const [lastEmailSentAt, setLastEmailSentAt] = useState<number | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(0);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [refreshingEmail, setRefreshingEmail] = useState(false);

  // 2FA Setup / Disable drawer state
  const [twoFactorPanelMode, setTwoFactorPanelMode] = useState<'idle' | 'enable' | 'disable'>('idle');
  const [setupPayload, setSetupPayload] = useState<TwoFactorSetupPayload | null>(null);
  const [generatingQr, setGeneratingQr] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [enableCode, setEnableCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null);
  const [submitting2fa, setSubmitting2fa] = useState(false);

  useEffect(() => {
    if (lastEmailSentAt === null) {
      setCooldownSeconds(0);
      return;
    }

    const syncRemaining = () => {
      const status = getEmailCooldownStatus(lastEmailSentAt, Date.now(), EMAIL_VERIFICATION_COOLDOWN_MS);
      setCooldownSeconds(status.remainingSeconds);
      if (status.canSend) {
        setLastEmailSentAt(null);
      }
    };

    syncRemaining();
    const timer = window.setInterval(syncRemaining, 1000);
    return () => window.clearInterval(timer);
  }, [lastEmailSentAt]);

  const handleSendVerification = async () => {
    if (sendingEmail || cooldownSeconds > 0) return;
    setSendingEmail(true);
    try {
      const res = await onSendVerificationEmail();
      if (res.ok) {
        setLastEmailSentAt(res.sentAtMs ?? Date.now());
      }
    } finally {
      setSendingEmail(false);
    }
  };

  const handleRefreshVerification = async () => {
    if (refreshingEmail) return;
    setRefreshingEmail(true);
    try {
      await onRefreshEmailVerification();
    } finally {
      setRefreshingEmail(false);
    }
  };

  const handleStartEnable2fa = async () => {
    setTwoFactorError(null);
    setEnableCode('');
    setGeneratingQr(true);
    setTwoFactorPanelMode('enable');
    try {
      const payload = await generateTwoFactorSetup({
        email: user.email || user.username || user.uid,
        issuer: 'Zectrade',
      });
      setSetupPayload(payload);
    } catch {
      setTwoFactorError('Unable to generate QR code. Please try again.');
      setTwoFactorPanelMode('idle');
    } finally {
      setGeneratingQr(false);
    }
  };

  const handleCopySecret = () => {
    if (!setupPayload) return;
    if (onCopySetupKey) {
      onCopySetupKey(setupPayload.secretBase32);
    } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(setupPayload.secretBase32);
    }
    setCopiedSecret(true);
    window.setTimeout(() => setCopiedSecret(false), 1800);
  };

  const handleConfirmEnable2fa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setupPayload || submitting2fa) return;
    setTwoFactorError(null);

    if (!/^\d{6}$/.test(enableCode.trim())) {
      setTwoFactorError('Enter the 6-digit code from Google Authenticator.');
      return;
    }

    if (!verifyTotpCode(setupPayload.secretBase32, enableCode.trim())) {
      setTwoFactorError('Invalid 6-digit code. Check your authenticator clock and try again.');
      return;
    }

    setSubmitting2fa(true);
    try {
      const res = await onEnableTwoFactor(setupPayload.secretBase32, enableCode.trim());
      if (res.ok) {
        setTwoFactorPanelMode('idle');
        setSetupPayload(null);
        setEnableCode('');
      } else {
        setTwoFactorError(res.error || 'Failed to enable Google Authenticator 2FA.');
      }
    } finally {
      setSubmitting2fa(false);
    }
  };

  const handleStartDisable2fa = () => {
    setTwoFactorError(null);
    setDisableCode('');
    setTwoFactorPanelMode('disable');
  };

  const handleConfirmDisable2fa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting2fa) return;
    setTwoFactorError(null);

    if (!/^\d{6}$/.test(disableCode.trim())) {
      setTwoFactorError('Enter your current 6-digit Authenticator code to turn off 2FA.');
      return;
    }

    setSubmitting2fa(true);
    try {
      const res = await onDisableTwoFactor(disableCode.trim());
      if (res.ok) {
        setTwoFactorPanelMode('idle');
        setDisableCode('');
      } else {
        setTwoFactorError(res.error || 'Invalid 6-digit Google Authenticator code.');
      }
    } finally {
      setSubmitting2fa(false);
    }
  };

  const isEmailVerified = Boolean(user.emailVerified);
  const isTwoFactorEnabled = Boolean(user.twoFactorEnabled);

  return (
    <section
      data-testid="wallet-security-card"
      aria-label="Account Security"
      className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
          <div>
            <h3 className="text-xs sm:text-sm font-bold text-white">Account Security</h3>
            <p className="text-[11px] text-slate-400">
              Optional verification and two-factor protection for your Zectrade account.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenPinModal}
          className="self-start sm:self-auto px-3 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-amber-400 text-[11px] font-semibold inline-flex items-center gap-1.5 transition-colors"
        >
          <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Update Security PIN</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 items-start">
        {/* 1. Optional Email Verification */}
        <div
          data-testid="email-verification-panel"
          className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 sm:p-4 flex flex-col gap-3"
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Mail className="w-4 h-4 text-blue-400 shrink-0" aria-hidden="true" />
                <span className="text-xs sm:text-sm font-bold text-white truncate">
                  Email Verification (Optional)
                </span>
              </div>
              <span
                data-testid="email-verification-badge"
                className={`px-2 py-0.5 rounded text-[10px] font-bold border shrink-0 ${
                  isEmailVerified
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                    : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                }`}
              >
                {isEmailVerified ? 'Verified' : 'Unverified'}
              </span>
            </div>
            <p className="text-[11px] font-mono text-slate-300 truncate">{user.email}</p>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              {isEmailVerified
                ? 'Your email address is verified. Withdrawals and P2P transfers remain unlocked.'
                : 'Optional security check. Withdrawals and Direct P2P Transfers stay enabled even while unverified.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {!isEmailVerified && (
              <button
                type="button"
                data-testid="send-verification-email-btn"
                disabled={sendingEmail || cooldownSeconds > 0}
                onClick={handleSendVerification}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-400 disabled:cursor-not-allowed text-white text-[11px] font-bold inline-flex items-center gap-1.5 transition-colors"
              >
                <Mail className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {sendingEmail
                    ? 'Sending...'
                    : cooldownSeconds > 0
                    ? `Resend in ${cooldownSeconds}s`
                    : 'Send Verification Email'}
                </span>
              </button>
            )}
            <button
              type="button"
              data-testid="refresh-email-verification-btn"
              disabled={refreshingEmail}
              onClick={handleRefreshVerification}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-[11px] font-semibold inline-flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${refreshingEmail ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>{refreshingEmail ? 'Checking...' : "I've Verified (Refresh)"}</span>
            </button>
          </div>
        </div>

        {/* 2. Optional Google Authenticator (2FA) */}
        <div
          data-testid="two-factor-panel"
          className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 sm:p-4 flex flex-col gap-3"
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {isTwoFactorEnabled ? (
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
                ) : (
                  <ShieldOff className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                )}
                <span className="text-xs sm:text-sm font-bold text-white truncate">
                  Google Authenticator (2FA)
                </span>
              </div>
              <span
                data-testid="two-factor-badge"
                className={`px-2 py-0.5 rounded text-[10px] font-bold border shrink-0 ${
                  isTwoFactorEnabled
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                    : 'bg-slate-800 text-slate-300 border-slate-700'
                }`}
              >
                {isTwoFactorEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              {isTwoFactorEnabled
                ? 'Active. Withdrawals and Direct P2P Transfers require a live 6-digit Authenticator code.'
                : 'Optional protection. Turn on 2FA with Google Authenticator to require a 6-digit code on withdrawals & P2P transfers.'}
            </p>
          </div>

          {twoFactorPanelMode === 'idle' && (
            <div className="flex items-center gap-2 pt-1">
              {isTwoFactorEnabled ? (
                <button
                  type="button"
                  data-testid="disable-2fa-btn"
                  onClick={handleStartDisable2fa}
                  className="px-3 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/30 border border-red-500/40 text-red-300 text-[11px] font-bold inline-flex items-center gap-1.5 transition-colors"
                >
                  <ShieldOff className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Disable 2FA</span>
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="enable-2fa-btn"
                  onClick={handleStartEnable2fa}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold inline-flex items-center gap-1.5 transition-colors"
                >
                  <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Enable 2FA</span>
                </button>
              )}
            </div>
          )}

          {/* Enable 2FA Setup Drawer */}
          {twoFactorPanelMode === 'enable' && (
            <form
              onSubmit={handleConfirmEnable2fa}
              data-testid="enable-2fa-setup-form"
              className="mt-1 pt-3 border-t border-slate-800 space-y-3"
            >
              {generatingQr ? (
                <p className="text-[11px] text-slate-400">Generating QR code...</p>
              ) : (
                setupPayload && (
                  <div className="flex flex-col sm:flex-row items-center sm:items-start gap-3">
                    <div className="bg-white p-2 rounded-xl shrink-0">
                      <img
                        src={setupPayload.qrDataUrl}
                        alt="Google Authenticator QR code"
                        data-testid="two-factor-qr-img"
                        className="w-28 h-28 sm:w-32 sm:h-32 block"
                      />
                    </div>
                    <div className="min-w-0 flex-1 space-y-2 w-full">
                      <p className="text-[11px] text-slate-300 font-medium">
                        1. Scan this QR code in Google Authenticator, or copy the setup key below:
                      </p>
                      <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5">
                        <code
                          data-testid="two-factor-secret-key"
                          className="text-[11px] font-mono text-amber-300 break-all select-all flex-1"
                        >
                          {setupPayload.secretBase32}
                        </code>
                        <button
                          type="button"
                          data-testid="copy-2fa-secret-btn"
                          onClick={handleCopySecret}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-semibold inline-flex items-center gap-1 shrink-0"
                        >
                          {copiedSecret ? (
                            <Check className="w-3 h-3 text-emerald-400" aria-hidden="true" />
                          ) : (
                            <Copy className="w-3 h-3" aria-hidden="true" />
                          )}
                          <span>{copiedSecret ? 'Copied' : 'Copy'}</span>
                        </button>
                      </div>
                      <div>
                        <label
                          htmlFor="enable-2fa-code"
                          className="text-[11px] font-semibold text-slate-300 block mb-1"
                        >
                          2. Enter 6-digit verification code
                        </label>
                        <input
                          id="enable-2fa-code"
                          data-testid="enable-2fa-code-input"
                          type="text"
                          maxLength={6}
                          inputMode="numeric"
                          required
                          value={enableCode}
                          onChange={(e) => {
                            setEnableCode(normalizeTotpCodeInput(e.target.value));
                            if (twoFactorError) setTwoFactorError(null);
                          }}
                          placeholder="000000"
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-center font-mono tracking-[0.35em] text-sm text-emerald-300"
                        />
                      </div>
                    </div>
                  </div>
                )
              )}

              {twoFactorError && (
                <p
                  role="alert"
                  data-testid="two-factor-error"
                  className="text-[11px] text-red-400 font-medium"
                >
                  {twoFactorError}
                </p>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={submitting2fa || generatingQr || !setupPayload}
                  data-testid="confirm-enable-2fa-btn"
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[11px] font-bold inline-flex items-center gap-1.5 transition-colors"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{submitting2fa ? 'Verifying...' : 'Verify & Enable'}</span>
                </button>
                <button
                  type="button"
                  disabled={submitting2fa}
                  onClick={() => {
                    setTwoFactorPanelMode('idle');
                    setSetupPayload(null);
                    setTwoFactorError(null);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* Disable 2FA Verification Drawer */}
          {twoFactorPanelMode === 'disable' && (
            <form
              onSubmit={handleConfirmDisable2fa}
              data-testid="disable-2fa-form"
              className="mt-1 pt-3 border-t border-slate-800 space-y-2.5"
            >
              <div>
                <label
                  htmlFor="disable-2fa-code"
                  className="text-[11px] font-semibold text-slate-300 block mb-1"
                >
                  Enter your current 6-digit Authenticator code to disable 2FA
                </label>
                <input
                  id="disable-2fa-code"
                  data-testid="disable-2fa-code-input"
                  type="text"
                  maxLength={6}
                  inputMode="numeric"
                  required
                  value={disableCode}
                  onChange={(e) => {
                    setDisableCode(normalizeTotpCodeInput(e.target.value));
                    if (twoFactorError) setTwoFactorError(null);
                  }}
                  placeholder="000000"
                  className="w-full bg-slate-900 border border-red-500/40 rounded-lg px-3 py-1.5 text-center font-mono tracking-[0.35em] text-sm text-white"
                />
              </div>

              {twoFactorError && (
                <p
                  role="alert"
                  data-testid="two-factor-error"
                  className="text-[11px] text-red-400 font-medium"
                >
                  {twoFactorError}
                </p>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={submitting2fa}
                  data-testid="confirm-disable-2fa-btn"
                  className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-[11px] font-bold transition-colors"
                >
                  {submitting2fa ? 'Verifying...' : 'Confirm Disable 2FA'}
                </button>
                <button
                  type="button"
                  disabled={submitting2fa}
                  onClick={() => {
                    setTwoFactorPanelMode('idle');
                    setDisableCode('');
                    setTwoFactorError(null);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
};
