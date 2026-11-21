import React, { useEffect, useState } from 'react';
import { applyActionCode, confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  MailCheck,
  ShieldCheck,
} from 'lucide-react';
import { auth, isFirebaseConfigured } from '../services/firebaseClient';
import {
  mapFirebaseActionError,
  validateNewPasswordPair,
  type ParsedAuthActionRoute,
} from '../utils/authAction';

interface AuthActionPageProps {
  route: ParsedAuthActionRoute;
  brandLogoUrl?: string | null;
  isLoggedIn?: boolean;
  onBackToLogin: () => void;
  onContinueToAccount?: () => void;
  onEmailVerified?: () => Promise<void> | void;
  onShowToast?: (message: string, type?: 'success' | 'error') => void;
}

type ActionStatus = 'verifying' | 'ready' | 'submitting' | 'success' | 'error';

export const AuthActionPage: React.FC<AuthActionPageProps> = ({
  route,
  brandLogoUrl,
  isLoggedIn = false,
  onBackToLogin,
  onContinueToAccount,
  onEmailVerified,
  onShowToast,
}) => {
  const [status, setStatus] = useState<ActionStatus>('verifying');
  const [accountEmail, setAccountEmail] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [formError, setFormError] = useState<string>('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  useEffect(() => {
    let active = true;

    const processAction = async () => {
      if (!route.oobCode || route.mode === 'unknown') {
        if (!active) return;
        setStatus('error');
        setErrorMessage('Invalid or incomplete security link. Missing required verification parameters.');
        return;
      }

      if (!isFirebaseConfigured || !auth) {
        if (!active) return;
        setStatus('error');
        setErrorMessage('Authentication service is unavailable right now. Please try again later.');
        return;
      }

      setStatus('verifying');
      setErrorMessage('');
      setFormError('');

      try {
        if (route.mode === 'resetPassword') {
          const email = await verifyPasswordResetCode(auth, route.oobCode);
          if (!active) return;
          setAccountEmail(email);
          setStatus('ready');
          return;
        }

        if (route.mode === 'verifyEmail' || route.mode === 'recoverEmail') {
          await applyActionCode(auth, route.oobCode);
          if (!active) return;
          if (route.mode === 'verifyEmail' && onEmailVerified) {
            await onEmailVerified();
          }
          setStatus('success');
          if (onShowToast) {
            onShowToast(
              route.mode === 'verifyEmail'
                ? 'Email verified successfully!'
                : 'Account email action completed.'
            );
          }
          return;
        }
      } catch (err: unknown) {
        if (!active) return;
        setStatus('error');
        setErrorMessage(mapFirebaseActionError(err, route.mode));
      }
    };

    void processAction();

    return () => {
      active = false;
    };
  }, [route.mode, route.oobCode]);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const validation = validateNewPasswordPair(newPassword, confirmPassword);
    if (!validation.ok) {
      setFormError(validation.error);
      return;
    }

    if (!isFirebaseConfigured || !auth) {
      setFormError('Authentication service is unavailable right now.');
      return;
    }

    setStatus('submitting');
    try {
      await confirmPasswordReset(auth, route.oobCode, newPassword);
      setStatus('success');
      if (onShowToast) {
        onShowToast('Password updated! You can now sign in with your new password.');
      }
    } catch (err: unknown) {
      const msg = mapFirebaseActionError(err, 'resetPassword');
      setFormError(msg);
      setStatus('ready');
    }
  };

  const isResetMode = route.mode === 'resetPassword';

  return (
    <main className="flex-1 w-full flex items-center justify-center px-4 py-8 sm:py-14 bg-slate-950">
      <div
        data-testid="auth-action-card"
        className="w-full max-w-md rounded-2xl bg-slate-900/95 border border-amber-500/30 shadow-[0_24px_60px_rgba(0,0,0,0.65)] overflow-hidden"
      >
        {/* Top Zectrade Dark/Gold Header */}
        <div className="px-4 sm:px-6 py-4 sm:py-5 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border-b border-amber-500/20 flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="p-[1.5px] rounded-xl bg-gradient-to-br from-amber-400 via-amber-500/80 to-blue-500/70 shrink-0">
              <div className="w-9 h-9 rounded-[10px] bg-slate-950 flex items-center justify-center overflow-hidden">
                <img
                  src={brandLogoUrl?.trim() || '/favicon.svg'}
                  alt="Zectrade icon"
                  onError={(e) => {
                    const img = e.currentTarget;
                    if (!img.dataset.fallbackApplied) {
                      img.dataset.fallbackApplied = '1';
                      img.src = '/favicon.svg';
                    }
                  }}
                  className="w-6 h-6 object-contain"
                />
              </div>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-extrabold tracking-wide text-white uppercase">
                Zectrade Security
              </p>
              <p className="text-[11px] font-mono text-amber-400">
                {isResetMode ? 'Password Reset' : 'Email Verification'}
              </p>
            </div>
          </div>
          <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/35 text-amber-300 font-mono text-[10px] font-semibold uppercase tracking-wider shrink-0">
            Verified SSL
          </span>
        </div>

        <div className="p-6 space-y-5">
          {/* Verifying Spinner */}
          {status === 'verifying' && (
            <div
              data-testid="auth-action-verifying"
              className="py-8 flex flex-col items-center text-center space-y-3"
            >
              <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
                <Loader2 className="w-6 h-6 text-amber-400 animate-spin" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <h1 className="text-base font-bold text-white">Verifying Security Link</h1>
                <p className="text-xs text-slate-400">
                  {isResetMode
                    ? 'Validating your password reset code with Zectrade...'
                    : 'Confirming your email verification code...'}
                </p>
              </div>
            </div>
          )}

          {/* Error State */}
          {status === 'error' && (
            <div data-testid="auth-action-error" className="space-y-4">
              <div className="rounded-xl bg-red-950/50 border border-red-500/40 p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="space-y-1">
                  <h1 className="text-sm font-bold text-white">Link Could Not Be Verified</h1>
                  <p className="text-xs text-red-200/90 leading-relaxed">{errorMessage}</p>
                </div>
              </div>
              <button
                type="button"
                data-testid="auth-action-back-to-login"
                onClick={onBackToLogin}
                className="w-full py-2.5 min-h-[42px] rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs sm:text-sm transition-colors flex items-center justify-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                <span>Back to Login</span>
              </button>
            </div>
          )}

          {/* Reset Password Form */}
          {isResetMode && (status === 'ready' || status === 'submitting') && (
            <form
              onSubmit={handlePasswordSubmit}
              data-testid="auth-action-reset-form"
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold">
                  <KeyRound className="w-4 h-4" aria-hidden="true" />
                  <span>Create New Password</span>
                </div>
                <h1 className="text-lg font-bold text-white">Reset Your Password</h1>
                {accountEmail && (
                  <p className="text-xs text-slate-300">
                    Account:{' '}
                    <span
                      data-testid="auth-action-reset-email"
                      className="font-mono font-semibold text-amber-300"
                    >
                      {accountEmail}
                    </span>
                  </p>
                )}
              </div>

              {formError && (
                <div
                  role="alert"
                  data-testid="auth-action-form-error"
                  className="rounded-lg bg-red-950/60 border border-red-500/40 px-3 py-2.5 text-xs text-red-200"
                >
                  {formError}
                </div>
              )}

              <div>
                <label
                  htmlFor="action-new-password"
                  className="text-xs font-semibold text-slate-300 block mb-1.5"
                >
                  New Password
                </label>
                <div className="relative">
                  <input
                    id="action-new-password"
                    data-testid="auth-action-new-password"
                    type={showNewPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-lg pl-3 pr-10 py-2.5 min-h-[42px] text-xs sm:text-sm text-white focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="button"
                    aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
                    onClick={() => setShowNewPassword((prev) => !prev)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-white"
                  >
                    {showNewPassword ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="action-confirm-password"
                  className="text-xs font-semibold text-slate-300 block mb-1.5"
                >
                  Confirm New Password
                </label>
                <div className="relative">
                  <input
                    id="action-confirm-password"
                    data-testid="auth-action-confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-lg pl-3 pr-10 py-2.5 min-h-[42px] text-xs sm:text-sm text-white focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="button"
                    aria-label={
                      showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'
                    }
                    onClick={() => setShowConfirmPassword((prev) => !prev)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-white"
                  >
                    {showConfirmPassword ? (
                      <Eye className="w-4 h-4" />
                    ) : (
                      <EyeOff className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={status === 'submitting'}
                data-testid="auth-action-save-password"
                className="w-full py-2.5 min-h-[42px] rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 font-bold text-xs sm:text-sm transition-colors"
              >
                {status === 'submitting' ? 'Saving Password...' : 'Save New Password'}
              </button>

              <button
                type="button"
                data-testid="auth-action-back-to-login"
                onClick={onBackToLogin}
                className="w-full py-2 min-h-[38px] rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 font-semibold text-xs transition-colors flex items-center justify-center gap-1.5"
              >
                <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Back to Login</span>
              </button>
            </form>
          )}

          {/* Success State: Reset Password */}
          {isResetMode && status === 'success' && (
            <div data-testid="auth-action-reset-success" className="space-y-4 text-center py-2">
              <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-emerald-400" aria-hidden="true" />
              </div>
              <div className="space-y-1.5">
                <h1 className="text-lg font-bold text-white">Password Updated</h1>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {accountEmail ? (
                    <>
                      Your password for{' '}
                      <span className="font-mono text-amber-300">{accountEmail}</span> has been
                      updated securely.
                    </>
                  ) : (
                    'Your Zectrade password has been updated securely.'
                  )}
                </p>
              </div>
              <button
                type="button"
                data-testid="auth-action-back-to-login"
                onClick={onBackToLogin}
                className="w-full py-2.5 min-h-[42px] rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs sm:text-sm transition-colors flex items-center justify-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                <span>Back to Login</span>
              </button>
            </div>
          )}

          {/* Success State: Email Verified */}
          {!isResetMode && status === 'success' && (
            <div data-testid="auth-action-verify-success" className="space-y-4 text-center py-2">
              <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center">
                <MailCheck className="w-6 h-6 text-emerald-400" aria-hidden="true" />
              </div>
              <div className="space-y-1.5">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[11px] font-semibold">
                  <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Account Security Confirmed</span>
                </div>
                <h1 className="text-lg font-bold text-white">Email Verified</h1>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Your email address has been verified with Zectrade. You now have a Verified badge
                  on your Account security profile.
                </p>
              </div>
              <div className="space-y-2 pt-1">
                {isLoggedIn && onContinueToAccount && (
                  <button
                    type="button"
                    data-testid="auth-action-continue-account"
                    onClick={onContinueToAccount}
                    className="w-full py-2.5 min-h-[42px] rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs sm:text-sm transition-colors"
                  >
                    Continue to Account
                  </button>
                )}
                <button
                  type="button"
                  data-testid="auth-action-back-to-login"
                  onClick={onBackToLogin}
                  className={`w-full py-2.5 min-h-[42px] rounded-lg font-bold text-xs sm:text-sm transition-colors flex items-center justify-center gap-2 ${
                    isLoggedIn && onContinueToAccount
                      ? 'bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300'
                      : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                  }`}
                >
                  <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                  <span>Back to Login</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
};
