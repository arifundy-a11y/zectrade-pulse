import React, { useState } from 'react';
import { ChevronDown, Eye, EyeOff, ArrowUpRight, ArrowDownLeft, Trophy, ShieldCheck, Layers, Info, AlertTriangle } from 'lucide-react';
import type { FaqEntry, LiveFeedItem, MarketQuote, PlatformStats } from '../types';
import { normalizePlatformStats } from '../utils/platformStats';
import { AnimatedStatNumber } from './AnimatedStatNumber';

interface AuthLandingProps {
  quotes: MarketQuote[];
  platformStats: PlatformStats;
  platformDescription: string;
  faqEntries: FaqEntry[];
  liveFeedItems: LiveFeedItem[];
  csrTelegramLink: string;
  onAuthSubmit: (payload: {
    mode: 'register' | 'login' | 'forgot';
    email: string;
    password: string;
    username: string;
    referralCode: string;
  }) => Promise<void>;
  onGoogleSignIn: () => Promise<void>;
  onEnterDemoWorkspace: () => void;
}

export const AuthLanding: React.FC<AuthLandingProps> = ({
  quotes,
  platformStats,
  platformDescription,
  faqEntries,
  liveFeedItems,
  csrTelegramLink,
  onAuthSubmit,
  onGoogleSignIn,
  onEnterDemoWorkspace,
}) => {
  const [authMode, setAuthMode] = useState<'register' | 'login' | 'forgot'>('register');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [referralCode, setReferralCode] = useState(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('ref')?.trim() ?? '';
  });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [openFaqIdx, setOpenFaqIdx] = useState<number | null>(0);
  const resolvedStats = normalizePlatformStats(platformStats);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onAuthSubmit({
        mode: authMode,
        email: email.trim(),
        password,
        username: username.trim(),
        referralCode: referralCode.trim(),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="w-full max-w-6xl mx-auto px-3 sm:px-6 py-3 sm:py-5 space-y-6 sm:space-y-8">
      {/* Compact Live Market Ticker Strip (Scrollable on Mobile) */}
      <section aria-label="Live Market Feed" id="markets-overview" className="border-b border-slate-800/80 pb-2.5">
        <div className="flex items-center gap-3 overflow-x-auto no-scrollbar py-1">
          {quotes.map((q) => {
            const isPos = q.changePct >= 0;
            const decimals = q.price < 1 ? 4 : q.price < 10 ? 3 : 2;
            return (
              <div
                key={q.symbol}
                className="flex items-center gap-2 shrink-0 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] sm:text-xs font-mono tabular-nums"
              >
                <span className="font-semibold text-slate-200 flex items-center gap-1">
                  <span>{q.shortName}</span>
                  {q.isCustom && (
                    <span className="text-[8px] uppercase px-1 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 leading-none">
                      Official
                    </span>
                  )}
                </span>
                <span className="text-white font-bold">
                  ${q.price.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
                </span>
                <span className={isPos ? 'text-emerald-400' : 'text-red-400'}>
                  {isPos ? '+' : ''}
                  {q.changePct.toFixed(2)}%
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Hero Split: Value Proposition + Auth Form */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-8 items-start">
        {/* Left: Overview & Platform Statistics */}
        <div className="lg:col-span-7 space-y-5">
          <div className="space-y-2.5">
            <p className="text-[11px] sm:text-xs text-slate-400 font-medium">
              Multi-Asset Execution · Lottery Live Color Prediction
            </p>
            <h1 className="text-[15px] sm:text-lg lg:text-xl font-bold text-white tracking-normal text-balance leading-snug">
              Institutional market execution and real-time Red/Green Lottery Live rounds in one workspace.
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-2xl">
              {platformDescription}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onEnterDemoWorkspace}
              className="px-4 py-2.5 min-h-[42px] rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs sm:text-sm transition-colors whitespace-nowrap"
            >
              Launch $100,000 Demo Workspace
            </button>
            <a
              href={csrTelegramLink}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2.5 min-h-[42px] rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 font-semibold text-xs sm:text-sm transition-colors whitespace-nowrap"
            >
              Contact CSR Support
            </a>
          </div>

          {/* Core Capabilities */}
          <div id="lottery-preview" className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 sm:p-4 space-y-1">
              <div className="flex items-center gap-1.5 text-blue-400 font-semibold text-xs">
                <Layers className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Spot & Leverage</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Spot 1x and up to 100x isolated futures with limit pre-orders, SL/TP, and instant swap.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 sm:p-4 space-y-1">
              <div className="flex items-center gap-1.5 text-emerald-400 font-semibold text-xs">
                <Trophy className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Lottery Live</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Live Color, 0–9, and 2D/3D/6D prediction rounds with real-time draws and instant payouts.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 sm:p-4 space-y-1">
              <div className="flex items-center gap-1.5 text-amber-400 font-semibold text-xs">
                <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Mainnet Settlement</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                PIN-protected withdrawals and P2P transfers with KBZPay, WavePay, Bank, and TRC20.
              </p>
            </div>
          </div>
        </div>

        {/* Right: Auth Card */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="space-y-1">
            <h2 className="text-base sm:text-lg font-bold text-white">
              {authMode === 'register'
                ? 'Create Zectrade Account'
                : authMode === 'login'
                ? 'Sign In to Account'
                : 'Reset Account Password'}
            </h2>
            <p className="text-[11px] sm:text-xs text-slate-400">
              {authMode === 'register'
                ? 'First registration gets a $2.00 Real Account bonus + $100,000 Demo funds.'
                : authMode === 'login'
                ? 'Access your spot holdings, futures positions, and Lottery Live rounds.'
                : 'Enter your registered email to receive a reset link.'}
            </p>
          </div>

          <div className="grid grid-cols-2 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setAuthMode('register')}
              className={`py-2 rounded-md transition-colors ${
                authMode === 'register' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Register
            </button>
            <button
              type="button"
              onClick={() => setAuthMode('login')}
              className={`py-2 rounded-md transition-colors ${
                authMode === 'login' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Sign In
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            {authMode === 'register' && (
              <div>
                <label htmlFor="auth-username" className="text-[11px] font-semibold text-slate-300 block mb-1">
                  Username
                </label>
                <input
                  id="auth-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Trader_01"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 min-h-[40px] text-xs sm:text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            )}

            <div>
              <label htmlFor="auth-email" className="text-[11px] font-semibold text-slate-300 block mb-1">
                Email Address
              </label>
              <input
                id="auth-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="trader@example.com"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 min-h-[40px] text-xs sm:text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            {authMode !== 'forgot' && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="auth-password" className="text-[11px] font-semibold text-slate-300">
                    Password
                  </label>
                  {authMode === 'login' && (
                    <button
                      type="button"
                      onClick={() => setAuthMode('forgot')}
                      className="text-[11px] text-blue-400 hover:underline"
                    >
                      Forgot Password?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    id="auth-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-3 pr-10 py-2 min-h-[40px] text-xs sm:text-sm text-white focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-white"
                  >
                    {showPassword ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}

            {authMode === 'register' && (
              <div>
                <label htmlFor="auth-referral" className="text-[11px] font-semibold text-slate-300 block mb-1">
                  Invitation Code (Optional)
                </label>
                <input
                  id="auth-referral"
                  type="text"
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value)}
                  placeholder="Paste inviter code"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 min-h-[40px] text-xs sm:text-sm font-mono text-amber-400 focus:outline-none focus:border-amber-400"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-semibold py-2.5 min-h-[42px] rounded-lg text-xs sm:text-sm transition-colors"
            >
              {submitting
                ? 'Processing...'
                : authMode === 'register'
                ? 'Register Account'
                : authMode === 'login'
                ? 'Sign In'
                : 'Send Reset Link'}
            </button>
          </form>

          {(authMode === 'register' || authMode === 'login') && (
            <button
              type="button"
              onClick={onGoogleSignIn}
              className="w-full py-2 min-h-[40px] rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-200 font-semibold text-xs transition-colors"
            >
              Continue with Google
            </button>
          )}

          <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
            <span>
              {authMode === 'register'
                ? 'Already registered?'
                : authMode === 'login'
                ? 'Need an account?'
                : 'Remembered password?'}
            </span>
            <button
              type="button"
              onClick={() => setAuthMode(authMode === 'register' ? 'login' : 'register')}
              className="text-blue-400 hover:underline font-semibold"
            >
              {authMode === 'register' ? 'Sign In' : 'Create Account'}
            </button>
          </div>
        </div>
      </section>

      {/* Responsive Full-Width Animated Platform Statistics Strip */}
      <section
        aria-label="Live Platform Statistics"
        data-testid="landing-platform-stats"
        className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4"
      >
        <div className="stat-card-shimmer relative overflow-hidden rounded-2xl bg-slate-900/75 backdrop-blur-md border border-slate-800/90 p-4 sm:p-5 flex flex-col justify-between gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-400">Registered Members</span>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-emerald-400">
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.85)]" />
              </span>
              LIVE
            </span>
          </div>
          <AnimatedStatNumber
            value={resolvedStats.registeredMembers}
            durationMs={1800}
            testId="stat-registered-members"
            ariaLabel={`Registered Members: ${resolvedStats.registeredMembers.toLocaleString('en-US')}`}
            className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-white font-mono"
          />
          <p className="text-[11px] text-slate-500">Verified trading &amp; lottery accounts</p>
        </div>

        <div className="stat-card-shimmer relative overflow-hidden rounded-2xl bg-slate-900/75 backdrop-blur-md border border-slate-800/90 p-4 sm:p-5 flex flex-col justify-between gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-400">Total Deposits</span>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-emerald-400">
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.85)]" />
              </span>
              LIVE
            </span>
          </div>
          <AnimatedStatNumber
            value={resolvedStats.totalDeposits}
            prefix="$"
            durationMs={1800}
            testId="stat-total-deposits"
            ariaLabel={`Total Deposits: $${resolvedStats.totalDeposits.toLocaleString('en-US')}`}
            className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-emerald-400 font-mono"
          />
          <p className="text-[11px] text-slate-500">Cumulative mainnet wallet funding</p>
        </div>

        <div className="stat-card-shimmer relative overflow-hidden rounded-2xl bg-slate-900/75 backdrop-blur-md border border-slate-800/90 p-4 sm:p-5 flex flex-col justify-between gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-400">Total Withdrawals</span>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-emerald-400">
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.85)]" />
              </span>
              LIVE
            </span>
          </div>
          <AnimatedStatNumber
            value={resolvedStats.totalWithdrawals}
            prefix="$"
            durationMs={1800}
            testId="stat-total-withdrawals"
            ariaLabel={`Total Withdrawals: $${resolvedStats.totalWithdrawals.toLocaleString('en-US')}`}
            className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-amber-400 font-mono"
          />
          <p className="text-[11px] text-slate-500">Processed member payouts worldwide</p>
        </div>
      </section>

      {/* Live Deposits & Withdrawals Stream + FAQ Accordion */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Live Deposits & Withdrawals Feed */}
        <div id="live-activity" className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <h2 className="text-xs sm:text-sm font-bold text-white">Live Deposits & Withdrawals</h2>
            <span className="text-[10px] font-mono text-emerald-400">Live Stream</span>
          </div>
          <div className="divide-y divide-slate-800/70">
            {liveFeedItems.map((item) => {
              const isWithdraw = item.type === 'WITHDRAWAL';
              return (
                <div
                  key={item.id}
                  className="py-2.5 flex items-center justify-between gap-2 text-[11px] sm:text-xs font-mono tabular-nums"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${
                        isWithdraw ? 'bg-amber-500/15 text-amber-400' : 'bg-emerald-500/15 text-emerald-400'
                      }`}
                    >
                      {isWithdraw ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownLeft className="w-3.5 h-3.5" />}
                    </span>
                    <div className="min-w-0">
                      <p className="text-slate-200 font-semibold truncate">
                        {item.user} · {item.method}
                      </p>
                      <p className="text-[10px] text-slate-500 font-sans">{item.time}</p>
                    </div>
                  </div>
                  <span className={`font-bold shrink-0 ${isWithdraw ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {isWithdraw ? '-' : '+'}${item.amount.toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* FAQ Accordion */}
        <div id="faq-section" className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <h2 className="text-xs sm:text-sm font-bold text-white">Frequently Asked Questions</h2>
            <span className="text-[10px] text-slate-400">Select a question</span>
          </div>
          <div className="divide-y divide-slate-800/70">
            {faqEntries.map((item, idx) => {
              const isOpen = openFaqIdx === idx;
              return (
                <div key={idx} className="py-1">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenFaqIdx(isOpen ? null : idx)}
                    className="w-full py-2.5 text-left flex items-center justify-between gap-3 text-xs sm:text-sm font-semibold text-white hover:text-blue-300 transition-colors"
                  >
                    <span>{item.q}</span>
                    <ChevronDown
                      className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <p className="pb-3 text-[11px] sm:text-xs text-slate-400 leading-relaxed">{item.a}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* About Platform Purpose & Trading Risk Warning */}
      <section
        id="about-platform"
        data-testid="landing-purpose-risk"
        aria-label="About Zectrade Pulse and Trading Risk Warning"
        className="grid grid-cols-1 lg:grid-cols-2 gap-4 scroll-mt-20"
      >
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-2">
          <div className="flex items-center gap-2 text-blue-400">
            <Info className="w-4 h-4 shrink-0" aria-hidden="true" />
            <h2 className="text-xs sm:text-sm font-bold text-white">
              About Zectrade Pulse · Platform Purpose
            </h2>
          </div>
          <p className="text-[11px] sm:text-xs text-slate-300 leading-relaxed">
            Zectrade Pulse is designed as an all-in-one digital market and live prediction platform.
            Traders can study real-time price charts, execute Spot (1x) or Futures Leverage
            (5x–100x) orders across major cryptocurrencies, Gold (XAU), and Crude Oil, rehearse
            with a resettable $100,000 Demo balance, follow market news, join Lottery Live
            (Color, 0–9, and 2D/3D/6D) prediction rounds, and settle Real Account balances via
            PIN-secured deposits, withdrawals, coin swaps, and P2P transfers.
          </p>
        </div>

        <div className="bg-slate-900 border border-amber-500/30 rounded-2xl p-4 sm:p-5 space-y-2">
          <div className="flex items-center gap-2 text-amber-400">
            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <h2 className="text-xs sm:text-sm font-bold text-amber-300">
              Trading &amp; Prediction Risk Warning · No Profit Guarantee
            </h2>
          </div>
          <p className="text-[11px] sm:text-xs text-slate-300 leading-relaxed">
            Trading digital assets, leveraged futures, and participating in Lottery Live rounds
            carries substantial risk of capital loss and is not suitable for every investor.
            Market volatility and leverage can cause rapid losses exceeding expectations, and demo
            results do not predict live outcomes.{' '}
            <strong className="text-amber-200">
              Zectrade Pulse does not guarantee profits, investment returns, or protection against
              trading losses.
            </strong>{' '}
            All orders and predictions are made solely at your own risk—never commit funds you
            cannot afford to lose.
          </p>
        </div>
      </section>
    </main>
  );
};
