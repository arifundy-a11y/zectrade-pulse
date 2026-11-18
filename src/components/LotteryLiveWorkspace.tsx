import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Dices,
  Eye,
  EyeOff,
  History,
  Layers,
  Lock,
  Shield,
  TrendingDown,
  TrendingUp,
  Trophy,
  Volume2,
  VolumeX,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import type {
  AccountMode,
  LotteryBetRecord,
  LotteryBetType,
  LotteryColor,
  LotteryLiveState,
  LotteryResultMode,
  ManagedMember,
  UserRole,
} from '../types';
import {
  DEFAULT_LOTTERY_FEE_PCT,
  calculateLotteryTradePreview,
  checkLotteryColorSideConflict,
  deriveLotteryDrawNumber,
  formatLotteryCountdown,
  formatLotteryFeeUsd,
  getActiveRoundColorSide,
  getColorFromLotteryDigit,
  isLotteryBettingLocked,
} from '../utils/lotteryEngine';
import { lotteryAudio } from '../utils/lotteryAudio';
import { DigitLotteryWorkspace } from './DigitLotteryWorkspace';
import { LotteryAdminConsole, type DigitDrawSchedulePayload } from './LotteryAdminConsole';
import { LotteryDrawReel } from './LotteryDrawReel';

interface LotteryLiveWorkspaceProps {
  userUid: string;
  userEmail: string;
  userRole: UserRole;
  hasAdminToken: boolean;
  accountMode: AccountMode;
  onSetAccountMode: (mode: AccountMode) => void;
  availableBalance: number;
  demoBalance?: number;
  realBalance?: number;
  lotteryState: LotteryLiveState | null;
  latestSettlementBanner: {
    roundCode: string;
    winningColor: LotteryColor;
    winningNumber?: number | null;
    userNetProfit: number | null;
    userOutcome: 'WIN' | 'LOSS' | 'NONE';
  } | null;
  members: ManagedMember[];
  onRefreshState: () => Promise<void>;
  onPlaceBet: (payload: {
    betType: LotteryBetType;
    color?: LotteryColor;
    pickedNumber?: number | null;
    stake: number;
  }) => Promise<boolean>;
  onPlaceDigitBet: (payload: {
    drawUid: string;
    pickedNumber: string;
    stake: number;
  }) => Promise<boolean>;
  onUnlockAdminWithPassword: (email: string, password: string) => Promise<boolean>;
  onUpdateAdminConfig: (payload: {
    resultMode?: LotteryResultMode;
    forcedResult?: LotteryColor | null;
    forcedNumber?: number | null;
    feePct?: number;
    payoutMultiplier?: number;
    numberMultiplier?: number;
    roundDurationSec?: number;
    isPaused?: boolean;
    settleNow?: boolean;
  }) => Promise<boolean>;
  onScheduleDigitDraw?: (payload: DigitDrawSchedulePayload) => Promise<boolean>;
  onAdjustWallet: (payload: {
    identifier: string;
    wallet: 'real' | 'demo';
    action: 'add' | 'deduct';
    amount: number;
  }) => Promise<boolean>;
}

const QUICK_STAKES = [10, 50, 100, 500];
const NUMBER_DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

export const LotteryLiveWorkspace: React.FC<LotteryLiveWorkspaceProps> = ({
  userUid,
  userEmail,
  userRole,
  hasAdminToken,
  accountMode,
  onSetAccountMode,
  availableBalance,
  demoBalance,
  realBalance,
  lotteryState,
  latestSettlementBanner,
  members,
  onRefreshState,
  onPlaceBet,
  onPlaceDigitBet,
  onUnlockAdminWithPassword,
  onUpdateAdminConfig,
  onScheduleDigitDraw,
  onAdjustWallet,
}) => {
  const [subPage, setSubPage] = useState<'live' | 'digits'>('live');
  const [betMode, setBetMode] = useState<LotteryBetType>('color');
  const [selectedColor, setSelectedColor] = useState<LotteryColor>('green');
  const [selectedNumber, setSelectedNumber] = useState<number>(7);
  const [stakeInput, setStakeInput] = useState<string>('100');
  const [placingBet, setPlacingBet] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<'ALL' | 'PENDING' | 'WIN' | 'LOSS'>('ALL');
  const [showAllResultsModal, setShowAllResultsModal] = useState(false);
  const [showAllBetsModal, setShowAllBetsModal] = useState(false);

  const [adminDrawerOpen, setAdminDrawerOpen] = useState(false);
  const [adminAuthOpen, setAdminAuthOpen] = useState(false);
  const [adminEmailInput, setAdminEmailInput] = useState('admin@zectrade.io');
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [showAdminPass, setShowAdminPass] = useState(false);
  const [adminAuthBusy, setAdminAuthBusy] = useState(false);

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [soundEnabled, setSoundEnabled] = useState(() => lotteryAudio.isEnabled());
  const [rollSequenceId, setRollSequenceId] = useState(0);

  const lastTickKeyRef = useRef<string | null>(null);
  const lastSeenSettledRef = useRef<string | null>(null);
  const rollAudioTimeoutRef = useRef<number | null>(null);

  // Strictly hide all Admin controls, buttons & panels for regular members
  const canAccessAdminPanel = userRole === 'admin';
  const isAdminReady = canAccessAdminPanel && hasAdminToken;

  useEffect(() => {
    if (!canAccessAdminPanel) {
      setAdminDrawerOpen(false);
      setAdminAuthOpen(false);
    }
  }, [canAccessAdminPanel]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 250);
    return () => {
      clearInterval(timer);
      lotteryAudio.clearRollTimers();
      if (rollAudioTimeoutRef.current !== null) {
        window.clearTimeout(rollAudioTimeoutRef.current);
      }
    };
  }, []);

  const config = lotteryState?.config ?? {
    roundDurationSec: 60,
    lockSeconds: 5,
    feePct: DEFAULT_LOTTERY_FEE_PCT,
    payoutMultiplier: 2,
    numberMultiplier: 9,
    resultMode: 'auto_balance' as const,
    forcedResult: null,
    forcedNumber: null,
    isPaused: false,
    accumulatedProfit: 0,
  };

  const currentRound = lotteryState?.currentRound;
  const serverDeltaMs = lotteryState ? lotteryState.serverTimeMs - nowMs : 0;

  const liveRemainingSec = useMemo(() => {
    if (!currentRound) return 60;
    if (config.isPaused) return currentRound.remainingSec;
    const adjustedNow = nowMs + serverDeltaMs;
    const leftMs = Math.max(0, currentRound.endsAtMs - adjustedNow);
    return Math.ceil(leftMs / 1000);
  }, [currentRound, config.isPaused, nowMs, serverDeltaMs]);

  const bettingLocked = isLotteryBettingLocked({
    remainingSec: liveRemainingSec,
    lockSeconds: config.lockSeconds,
    isPaused: config.isPaused,
  });

  const activeMultiplier =
    betMode === 'number' ? config.numberMultiplier : config.payoutMultiplier;

  const numericStake = parseFloat(stakeInput);
  const validStake = Number.isFinite(numericStake) && numericStake >= 1 ? numericStake : 0;

  const preview = useMemo(
    () =>
      calculateLotteryTradePreview({
        stake: validStake,
        feePct: config.feePct,
        multiplier: activeMultiplier,
      }),
    [validStake, config.feePct, activeMultiplier]
  );

  const progressPct = currentRound
    ? Math.max(0, Math.min(100, (liveRemainingSec / Math.max(1, currentRound.durationSec)) * 100))
    : 100;

  const activeRoundBets: LotteryBetRecord[] = useMemo(() => {
    if (!lotteryState || !currentRound) return [];
    return lotteryState.userBets.filter(
      (b) => b.roundCode === currentRound.roundCode && b.outcome === 'PENDING'
    );
  }, [lotteryState, currentRound]);

  const activeColorSide = useMemo(
    () => getActiveRoundColorSide(activeRoundBets),
    [activeRoundBets]
  );

  // Keep selectedColor synced to activeColorSide when a pending color bet exists
  useEffect(() => {
    if (activeColorSide && selectedColor !== activeColorSide) {
      setSelectedColor(activeColorSide);
    }
  }, [activeColorSide, selectedColor]);

  const colorSideConflict = useMemo(
    () => checkLotteryColorSideConflict(activeRoundBets, betMode, selectedColor),
    [activeRoundBets, betMode, selectedColor]
  );

  const filteredUserBets = useMemo(() => {
    const bets = lotteryState?.userBets ?? [];
    if (historyFilter === 'ALL') return bets;
    return bets.filter((b) => b.outcome === historyFilter);
  }, [lotteryState?.userBets, historyFilter]);

  const pastRounds = lotteryState?.historyStrip ?? [];
  const greenRecentCount = pastRounds.filter((r) => r.winningColor === 'green').length;
  const redRecentCount = pastRounds.filter((r) => r.winningColor === 'red').length;

  const latestHistoryRound =
    pastRounds.find(
      (r): r is typeof r & { winningColor: LotteryColor } => r.winningColor !== null
    ) ?? null;

  // Countdown tick audio during final 10s of active rounds
  useEffect(() => {
    if (!soundEnabled || !currentRound || config.isPaused) return;
    if (liveRemainingSec <= 0 || liveRemainingSec > 10) return;

    const tickKey = `${currentRound.roundCode}:${liveRemainingSec}`;
    if (lastTickKeyRef.current === tickKey) return;
    lastTickKeyRef.current = tickKey;

    const isUrgentLockWindow = liveRemainingSec <= config.lockSeconds;
    lotteryAudio.playCountdownTick(isUrgentLockWindow);
  }, [soundEnabled, currentRound, config.isPaused, config.lockSeconds, liveRemainingSec]);

  // Trigger physical draw roll & settlement audio when a new round settles after mount
  useEffect(() => {
    const settledRoundCode =
      latestSettlementBanner?.roundCode ?? latestHistoryRound?.roundCode ?? null;
    if (!settledRoundCode) return;

    if (lastSeenSettledRef.current === null) {
      lastSeenSettledRef.current = settledRoundCode;
      return;
    }

    if (lastSeenSettledRef.current === settledRoundCode) return;
    lastSeenSettledRef.current = settledRoundCode;

    setRollSequenceId((id) => id + 1);

    if (rollAudioTimeoutRef.current !== null) {
      window.clearTimeout(rollAudioTimeoutRef.current);
      rollAudioTimeoutRef.current = null;
    }

    if (soundEnabled) {
      lotteryAudio.playRollSequence(1350);
      const outcome =
        latestSettlementBanner?.roundCode === settledRoundCode
          ? latestSettlementBanner.userOutcome
          : 'NONE';

      rollAudioTimeoutRef.current = window.setTimeout(() => {
        if (outcome === 'WIN') {
          lotteryAudio.playWin();
        } else if (outcome === 'LOSS') {
          lotteryAudio.playLoss();
        } else {
          lotteryAudio.playRoundResult();
        }
      }, 1360);
    }
  }, [latestHistoryRound?.roundCode, latestSettlementBanner, soundEnabled]);

  const handleToggleSound = () => {
    const next = lotteryAudio.setEnabled(!soundEnabled);
    setSoundEnabled(next);
    if (next) {
      lotteryAudio.unlock();
      lotteryAudio.playCountdownTick(false);
    }
  };

  const resolvedDemoBalance =
    typeof demoBalance === 'number'
      ? demoBalance
      : accountMode === 'demo'
      ? availableBalance
      : 0;
  const resolvedRealBalance =
    typeof realBalance === 'number'
      ? realBalance
      : accountMode === 'real'
      ? availableBalance
      : 0;

  const handleConfirmTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    lotteryAudio.unlock();
    if (
      bettingLocked ||
      validStake < 1 ||
      validStake > availableBalance ||
      colorSideConflict !== null
    ) {
      return;
    }
    setPlacingBet(true);
    try {
      const ok = await onPlaceBet(
        betMode === 'number'
          ? {
              betType: 'number',
              pickedNumber: selectedNumber,
              color: getColorFromLotteryDigit(selectedNumber),
              stake: validStake,
            }
          : {
              betType: 'color',
              color: selectedColor,
              stake: validStake,
            }
      );
      if (ok) {
        lotteryAudio.playBetConfirm();
      }
    } finally {
      setPlacingBet(false);
    }
  };

  const handleOpenAdminToggle = () => {
    if (!canAccessAdminPanel) return;
    lotteryAudio.unlock();
    if (isAdminReady) {
      setAdminDrawerOpen((prev) => !prev);
      setAdminAuthOpen(false);
    } else {
      setAdminAuthOpen((prev) => !prev);
    }
  };

  const handleAdminUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAccessAdminPanel) return;
    if (!adminEmailInput.trim() || !adminPasswordInput) return;
    setAdminAuthBusy(true);
    try {
      const ok = await onUnlockAdminWithPassword(adminEmailInput.trim(), adminPasswordInput);
      if (ok) {
        setAdminAuthOpen(false);
        setAdminDrawerOpen(true);
        setAdminPasswordInput('');
      }
    } finally {
      setAdminAuthBusy(false);
    }
  };

  const bannerDigit = latestSettlementBanner
    ? typeof latestSettlementBanner.winningNumber === 'number'
      ? latestSettlementBanner.winningNumber
      : deriveLotteryDrawNumber(
          latestSettlementBanner.roundCode,
          latestSettlementBanner.winningColor
        )
    : null;

  return (
    <div className="space-y-1.5 sm:space-y-2.5" data-testid="lottery-live-workspace">
      {/* Compact Header (Demo & Real Balance Only), Sub-Page Switcher & Countdown */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-2 sm:p-3 space-y-1.5 sm:space-y-2">
        <div className="flex items-center justify-between gap-1.5 sm:gap-2">
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-1.5 sm:gap-2 flex-1 sm:flex-initial">
            <button
              type="button"
              data-testid="lottery-demo-balance-btn"
              aria-pressed={accountMode === 'demo'}
              onClick={() => onSetAccountMode('demo')}
              className={`bg-slate-950 rounded-lg px-2 py-1 sm:px-3 sm:py-1.5 border flex items-center gap-1.5 sm:gap-2 transition-colors text-left ${
                accountMode === 'demo'
                  ? 'border-amber-500/70 bg-amber-500/10'
                  : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              <Wallet
                className={`w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0 ${
                  accountMode === 'demo' ? 'text-amber-400' : 'text-slate-400'
                }`}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <span
                  className={`text-[9px] sm:text-[10px] font-semibold block leading-none mb-0.5 truncate ${
                    accountMode === 'demo' ? 'text-amber-300' : 'text-slate-400'
                  }`}
                >
                  Demo Balance
                </span>
                <span
                  data-testid={accountMode === 'demo' ? 'lottery-wallet-balance' : 'lottery-demo-balance'}
                  className="text-[11px] sm:text-xs font-mono font-bold text-white tabular-nums block truncate"
                >
                  ${resolvedDemoBalance.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
            </button>

            <button
              type="button"
              data-testid="lottery-real-balance-btn"
              aria-pressed={accountMode === 'real'}
              onClick={() => onSetAccountMode('real')}
              className={`bg-slate-950 rounded-lg px-2 py-1 sm:px-3 sm:py-1.5 border flex items-center gap-1.5 sm:gap-2 transition-colors text-left ${
                accountMode === 'real'
                  ? 'border-blue-500/70 bg-blue-500/10'
                  : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              <Wallet
                className={`w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0 ${
                  accountMode === 'real' ? 'text-blue-400' : 'text-slate-400'
                }`}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <span
                  className={`text-[9px] sm:text-[10px] font-semibold block leading-none mb-0.5 truncate ${
                    accountMode === 'real' ? 'text-blue-300' : 'text-slate-400'
                  }`}
                >
                  Real Balance
                </span>
                <span
                  data-testid={accountMode === 'real' ? 'lottery-wallet-balance' : 'lottery-real-balance'}
                  className="text-[11px] sm:text-xs font-mono font-bold text-white tabular-nums block truncate"
                >
                  ${resolvedRealBalance.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
            </button>
          </div>

          {canAccessAdminPanel && (
            <button
              type="button"
              data-testid="lottery-admin-panel-btn"
              onClick={handleOpenAdminToggle}
              className={`min-h-[30px] sm:min-h-[34px] px-2 sm:px-3 py-1 rounded-lg border text-[10px] sm:text-[11px] font-bold flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                adminDrawerOpen && isAdminReady
                  ? 'bg-amber-500 text-slate-950 border-amber-400'
                  : 'bg-slate-950 hover:bg-slate-800 border-slate-700 text-amber-300'
              }`}
            >
              <Shield className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{adminDrawerOpen && isAdminReady ? 'Hide Admin' : 'Admin'}</span>
            </button>
          )}
        </div>

        {/* Sub-Page Navigation Bar */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2 pt-1.5 border-t border-slate-800/80">
          <div className="flex bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[10px] sm:text-[11px] font-bold">
            <button
              type="button"
              data-testid="lottery-tab-live"
              onClick={() => setSubPage('live')}
              className={`px-2 sm:px-3 py-1 rounded-md flex items-center gap-1 transition-colors whitespace-nowrap ${
                subPage === 'live'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Dices className="w-3 h-3 sm:w-3.5 sm:h-3.5" aria-hidden="true" />
              <span>Lottery Live</span>
            </button>
            <button
              type="button"
              data-testid="lottery-tab-digits"
              onClick={() => setSubPage('digits')}
              className={`px-2 sm:px-3 py-1 rounded-md flex items-center gap-1 transition-colors whitespace-nowrap ${
                subPage === 'digits'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Layers className="w-3 h-3 sm:w-3.5 sm:h-3.5" aria-hidden="true" />
              <span>2D / 3D / 6D Draws</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            {subPage === 'live' && (
              <div className="flex items-center gap-1 sm:gap-2 text-[10px] sm:text-[11px] font-mono tabular-nums">
                {config.isPaused ? (
                  <Lock className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-400" aria-hidden="true" />
                ) : bettingLocked ? (
                  <Lock className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-red-400" aria-hidden="true" />
                ) : (
                  <Clock className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-emerald-400" aria-hidden="true" />
                )}
                <span
                  data-testid="lottery-status-label"
                  className={`font-bold hidden sm:inline ${
                    config.isPaused
                      ? 'text-amber-300'
                      : bettingLocked
                      ? 'text-red-400'
                      : 'text-emerald-400'
                  }`}
                >
                  {config.isPaused
                    ? 'PAUSED'
                    : bettingLocked
                    ? `LOCKED · FINAL ${config.lockSeconds}s`
                    : 'OPEN · PLACE BET'}
                </span>
                <span
                  data-testid="lottery-countdown-timer"
                  className={`text-xs sm:text-base font-mono font-extrabold tabular-nums px-1.5 sm:px-2 py-0.5 rounded-md border ${
                    config.isPaused
                      ? 'bg-amber-500/10 border-amber-500/40 text-amber-300'
                      : bettingLocked
                      ? 'bg-red-500/15 border-red-500/50 text-red-400'
                      : 'bg-slate-950 border-slate-700 text-white'
                  }`}
                >
                  {formatLotteryCountdown(liveRemainingSec)}
                </span>
              </div>
            )}

            <button
              type="button"
              data-testid="lottery-sound-toggle"
              aria-label={soundEnabled ? 'Mute lottery sound' : 'Unmute lottery sound'}
              aria-pressed={soundEnabled}
              onClick={handleToggleSound}
              title={soundEnabled ? 'Sound On' : 'Muted'}
              className={`min-h-[26px] sm:min-h-[30px] px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-md border text-[11px] font-bold flex items-center gap-1 transition-colors whitespace-nowrap ${
                soundEnabled
                  ? 'bg-slate-950 hover:bg-slate-800 border-emerald-500/40 text-emerald-300'
                  : 'bg-slate-950 hover:bg-slate-800 border-slate-800 text-slate-400'
              }`}
            >
              {soundEnabled ? (
                <Volume2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" aria-hidden="true" />
              ) : (
                <VolumeX className="w-3 h-3 sm:w-3.5 sm:h-3.5" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {subPage === 'live' && (
          <div className="h-1 w-full bg-slate-950 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-200 ${
                config.isPaused
                  ? 'bg-amber-500'
                  : bettingLocked
                  ? 'bg-red-500'
                  : 'bg-emerald-500'
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}
      </section>

      {/* Admin-Only Password Unlock Box (Never rendered for members) */}
      {canAccessAdminPanel && adminAuthOpen && !isAdminReady && (
        <section
          data-testid="lottery-admin-auth-box"
          className="bg-slate-900 border border-amber-500/40 rounded-xl p-3.5 space-y-2.5"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
              <h2 className="text-xs font-bold text-white">Admin Session Verification</h2>
            </div>
            <button
              type="button"
              onClick={() => setAdminAuthOpen(false)}
              className="text-[11px] text-slate-400 hover:text-white"
            >
              Cancel
            </button>
          </div>
          <form onSubmit={handleAdminUnlockSubmit} className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
            <div className="sm:col-span-5">
              <label htmlFor="lottery-admin-email" className="text-[10px] text-slate-300 block mb-1">
                Admin Email
              </label>
              <input
                id="lottery-admin-email"
                type="email"
                required
                value={adminEmailInput}
                onChange={(e) => setAdminEmailInput(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 min-h-[36px] text-xs text-white font-mono"
              />
            </div>
            <div className="sm:col-span-5">
              <label htmlFor="lottery-admin-password" className="text-[10px] text-slate-300 block mb-1">
                Admin Passcode
              </label>
              <div className="relative">
                <input
                  id="lottery-admin-password"
                  type={showAdminPass ? 'text' : 'password'}
                  required
                  value={adminPasswordInput}
                  onChange={(e) => setAdminPasswordInput(e.target.value)}
                  placeholder="Enter admin password"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-2.5 pr-8 py-1.5 min-h-[36px] text-xs text-white"
                />
                <button
                  type="button"
                  aria-label={showAdminPass ? 'Hide password' : 'Show password'}
                  onClick={() => setShowAdminPass((p) => !p)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1"
                >
                  {showAdminPass ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={adminAuthBusy}
                className="w-full min-h-[36px] px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-colors"
              >
                {adminAuthBusy ? 'Checking...' : 'Unlock'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Embedded Admin Control Console (Strictly Admin-Only) */}
      {canAccessAdminPanel && adminDrawerOpen && isAdminReady && (
        <LotteryAdminConsole
          lotteryState={lotteryState}
          remainingSec={liveRemainingSec}
          members={members}
          currentUserUid={userUid}
          currentUserEmail={userEmail}
          onUpdateConfig={onUpdateAdminConfig}
          onScheduleDigitDraw={onScheduleDigitDraw}
          onAdjustWallet={onAdjustWallet}
          onRefreshState={onRefreshState}
        />
      )}

      {subPage === 'digits' ? (
        <DigitLotteryWorkspace
          availableBalance={availableBalance}
          accountMode={accountMode}
          digitDraws={lotteryState?.digitDraws ?? []}
          digitHistory={lotteryState?.digitHistory ?? []}
          userDigitBets={lotteryState?.userDigitBets ?? []}
          soundEnabled={soundEnabled}
          onPlaceDigitBet={onPlaceDigitBet}
        />
      ) : (
        <>
          {/* Compact Latest Round Outcome Banner */}
          {latestSettlementBanner && bannerDigit !== null && (
            <section
              data-testid="lottery-outcome-banner"
              className={`rounded-xl border px-2.5 sm:px-3.5 py-1 sm:py-1.5 flex items-center justify-between gap-2 text-[11px] sm:text-xs ${
                latestSettlementBanner.userOutcome === 'WIN'
                  ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
                  : latestSettlementBanner.userOutcome === 'LOSS'
                  ? 'bg-red-950/60 border-red-500/40 text-red-200'
                  : 'bg-slate-900 border-slate-800 text-slate-200'
              }`}
            >
              <div className="flex items-center gap-2 font-semibold">
                {latestSettlementBanner.userOutcome === 'WIN' ? (
                  <Trophy className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                ) : latestSettlementBanner.userOutcome === 'LOSS' ? (
                  <XCircle className="w-3.5 h-3.5 text-red-400" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                )}
                <span>
                  Latest Result:{' '}
                  <strong
                    className={
                      latestSettlementBanner.winningColor === 'green'
                        ? 'text-emerald-400'
                        : 'text-red-400'
                    }
                  >
                    #{bannerDigit} · {latestSettlementBanner.winningColor.toUpperCase()}
                  </strong>
                </span>
              </div>
              {latestSettlementBanner.userOutcome !== 'NONE' &&
                latestSettlementBanner.userNetProfit !== null && (
                  <span className="font-mono font-bold tabular-nums">
                    {latestSettlementBanner.userOutcome === 'WIN' ? 'YOU WON' : 'LOSS'} ·{' '}
                    {latestSettlementBanner.userNetProfit >= 0 ? '+' : ''}$
                    {latestSettlementBanner.userNetProfit.toFixed(2)}
                  </span>
                )}
            </section>
          )}

          {/* Compact Physical Rolling Number Live Draw Show */}
          <LotteryDrawReel
            currentRoundCode={currentRound?.roundCode ?? '#--------'}
            remainingSec={liveRemainingSec}
            lockSeconds={config.lockSeconds}
            isPaused={config.isPaused}
            payoutMultiplier={config.payoutMultiplier}
            greenPoolTotal={currentRound?.greenTotal ?? 0}
            redPoolTotal={currentRound?.redTotal ?? 0}
            lastSettledRound={
              latestHistoryRound
                ? {
                    roundCode: latestHistoryRound.roundCode,
                    winningColor: latestHistoryRound.winningColor,
                    winningNumber: latestHistoryRound.winningNumber,
                  }
                : null
            }
            rollSequenceId={rollSequenceId}
          />

          {/* Compact Main 12-Column Trading Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 sm:gap-3 items-start">
            {/* Left: Compact Color & Exact Number Prediction Panel (5 cols) */}
            <section className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-2.5 sm:p-3.5 space-y-2 sm:space-y-2.5">
              <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-1.5">
                <h2 className="text-[11px] sm:text-xs font-bold text-white">Prediction Panel</h2>
                <div className="flex bg-slate-950 p-0.5 rounded-md border border-slate-800 text-[10px] font-bold">
                  <button
                    type="button"
                    data-testid="lottery-mode-color"
                    onClick={() => setBetMode('color')}
                    className={`px-2 py-0.5 sm:py-1 rounded transition-colors ${
                      betMode === 'color'
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Color ({config.payoutMultiplier.toFixed(1)}x)
                  </button>
                  <button
                    type="button"
                    data-testid="lottery-mode-number"
                    onClick={() => setBetMode('number')}
                    className={`px-2 py-0.5 sm:py-1 rounded transition-colors ${
                      betMode === 'number'
                        ? 'bg-amber-500 text-slate-950'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Number 0–9 ({config.numberMultiplier.toFixed(1)}x)
                  </button>
                </div>
              </div>

              <form onSubmit={handleConfirmTrade} className="space-y-2 sm:space-y-2.5">
                {betMode === 'color' ? (
                  <div className="space-y-1">
                    <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
                      {(() => {
                        const greenBlocked =
                          activeColorSide !== null && activeColorSide !== 'green';
                        const redBlocked =
                          activeColorSide !== null && activeColorSide !== 'red';
                        return (
                          <>
                            <button
                              type="button"
                              data-testid="lottery-pick-green"
                              disabled={greenBlocked}
                              onClick={() => setSelectedColor('green')}
                              aria-pressed={selectedColor === 'green'}
                              className={`min-h-[38px] sm:min-h-[46px] px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-lg border text-left flex flex-col justify-between transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                                selectedColor === 'green' && !greenBlocked
                                  ? 'bg-emerald-600 border-emerald-400 text-white'
                                  : 'bg-emerald-950/35 hover:bg-emerald-950/60 border-emerald-700/50 text-emerald-300'
                              }`}
                            >
                              <div className="flex items-center justify-between w-full">
                                <span className="text-[11px] sm:text-xs font-extrabold tracking-wide">GREEN</span>
                                <TrendingUp className="w-3 h-3 sm:w-3.5 sm:h-3.5" aria-hidden="true" />
                              </div>
                              <span className="text-[9px] sm:text-[10px] font-mono tabular-nums opacity-90">
                                {greenBlocked
                                  ? 'Locked · RED Active'
                                  : `Odd 1,3,5,7,9 · ${config.payoutMultiplier.toFixed(2)}x`}
                              </span>
                            </button>

                            <button
                              type="button"
                              data-testid="lottery-pick-red"
                              disabled={redBlocked}
                              onClick={() => setSelectedColor('red')}
                              aria-pressed={selectedColor === 'red'}
                              className={`min-h-[38px] sm:min-h-[46px] px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-lg border text-left flex flex-col justify-between transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                                selectedColor === 'red' && !redBlocked
                                  ? 'bg-red-600 border-red-400 text-white'
                                  : 'bg-red-950/35 hover:bg-red-950/60 border-red-700/50 text-red-300'
                              }`}
                            >
                              <div className="flex items-center justify-between w-full">
                                <span className="text-[11px] sm:text-xs font-extrabold tracking-wide">RED</span>
                                <TrendingDown className="w-3 h-3 sm:w-3.5 sm:h-3.5" aria-hidden="true" />
                              </div>
                              <span className="text-[9px] sm:text-[10px] font-mono tabular-nums opacity-90">
                                {redBlocked
                                  ? 'Locked · GREEN Active'
                                  : `Even 0,2,4,6,8 · ${config.payoutMultiplier.toFixed(2)}x`}
                              </span>
                            </button>
                          </>
                        );
                      })()}
                    </div>
                    {activeColorSide && (
                      <p
                        data-testid="lottery-single-side-notice"
                        className="text-[10px] text-amber-300 font-medium"
                      >
                        Single-side rule active: locked to {activeColorSide.toUpperCase()} for this round.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <span>Pick Exact Ball (0–9)</span>
                      <span className="font-mono text-amber-300">
                        Selected: #{selectedNumber} (
                        {getColorFromLotteryDigit(selectedNumber).toUpperCase()})
                      </span>
                    </div>
                    <div className="grid grid-cols-5 gap-1 sm:gap-1.5" data-testid="lottery-number-grid">
                      {NUMBER_DIGITS.map((digit) => {
                        const isOddGreen = getColorFromLotteryDigit(digit) === 'green';
                        const isSelected = selectedNumber === digit;
                        return (
                          <button
                            key={digit}
                            type="button"
                            data-testid={`lottery-pick-number-${digit}`}
                            aria-pressed={isSelected}
                            onClick={() => setSelectedNumber(digit)}
                            className={`min-h-[34px] sm:min-h-[40px] rounded-lg border font-mono tabular-nums flex flex-col items-center justify-center transition-colors ${
                              isSelected
                                ? isOddGreen
                                  ? 'bg-emerald-600 border-emerald-300 text-white'
                                  : 'bg-red-600 border-red-300 text-white'
                                : isOddGreen
                                ? 'bg-emerald-950/30 hover:bg-emerald-950/60 border-emerald-700/40 text-emerald-300'
                                : 'bg-red-950/30 hover:bg-red-950/60 border-red-700/40 text-red-300'
                            }`}
                          >
                            <span className="text-xs font-extrabold leading-none">{digit}</span>
                            <span className="text-[8px] sm:text-[9px] opacity-80 leading-none mt-0.5">
                              {isOddGreen ? 'ODD' : 'EVEN'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Compact Stake Amount & Quick-Selects */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] sm:text-[11px]">
                    <label htmlFor="lottery-stake-input" className="text-slate-300 font-semibold">
                      Trade Stake (USD)
                    </label>
                    <button
                      type="button"
                      onClick={() => setStakeInput('')}
                      className="text-slate-400 hover:text-white text-[10px]"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="grid grid-cols-12 sm:grid-cols-1 gap-1.5">
                    <input
                      id="lottery-stake-input"
                      data-testid="lottery-stake-input"
                      type="number"
                      min="1"
                      step="any"
                      required
                      value={stakeInput}
                      onChange={(e) => setStakeInput(e.target.value)}
                      placeholder="100"
                      className="col-span-4 sm:col-span-1 w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 sm:px-3 py-1 sm:py-1.5 min-h-[32px] sm:min-h-[36px] text-xs font-mono font-bold text-white tabular-nums focus:outline-none focus:border-blue-500"
                    />
                    <div className="col-span-8 sm:col-span-1 grid grid-cols-4 gap-1 sm:gap-1.5">
                      {QUICK_STAKES.map((amt) => {
                        const isActive = Number(stakeInput) === amt;
                        return (
                          <button
                            key={amt}
                            type="button"
                            onClick={() => setStakeInput(String(amt))}
                            className={`min-h-[32px] sm:min-h-[30px] rounded-md border text-[10px] sm:text-[11px] font-mono font-bold tabular-nums transition-colors ${
                              isActive
                                ? 'bg-blue-600 border-blue-400 text-white'
                                : 'bg-slate-950 hover:bg-slate-800 border-slate-800 text-slate-300'
                            }`}
                          >
                            {amt}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Compact Fee & Payout Preview */}
                <div
                  data-testid="lottery-fee-preview"
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 sm:p-2.5 space-y-0.5 sm:space-y-1 text-[10px] sm:text-[11px] font-mono tabular-nums"
                >
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Stake / Fee ({preview.feePct}%)</span>
                    <span>
                      <strong className="text-white">${preview.stake.toFixed(2)}</strong>
                      <span className="text-slate-600"> · </span>
                      <span data-testid="lottery-preview-fee" className="text-amber-400">
                        -${formatLotteryFeeUsd(preview.feeAmount)}
                      </span>
                      <span className="hidden sm:inline text-slate-500"> · Net ${preview.netStake.toFixed(2)}</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between font-bold border-t border-slate-800 pt-1">
                    <span className="text-slate-200">
                      Win Payout ({preview.multiplier.toFixed(2)}x)
                    </span>
                    <span data-testid="lottery-preview-payout" className="text-emerald-400 text-xs">
                      ${preview.grossPayoutOnWin.toFixed(2)}
                    </span>
                  </div>
                </div>

                {validStake > availableBalance && (
                  <p className="text-[10px] sm:text-[11px] text-red-400 font-medium">
                    Insufficient {accountMode} wallet balance.
                  </p>
                )}

                {colorSideConflict && (
                  <p className="text-[10px] sm:text-[11px] text-amber-300 font-medium">{colorSideConflict}</p>
                )}

                <button
                  type="submit"
                  data-testid="lottery-confirm-bet"
                  disabled={
                    placingBet ||
                    bettingLocked ||
                    validStake < 1 ||
                    validStake > availableBalance ||
                    colorSideConflict !== null
                  }
                  className={`w-full min-h-[36px] sm:min-h-[40px] rounded-lg font-bold text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    betMode === 'number'
                      ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                      : selectedColor === 'green'
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                      : 'bg-red-600 hover:bg-red-500 text-white'
                  }`}
                >
                  {placingBet
                    ? 'Confirming...'
                    : config.isPaused
                    ? 'Betting Temporarily Paused'
                    : bettingLocked
                    ? `Betting Locked (Final ${config.lockSeconds}s)`
                    : betMode === 'number'
                    ? `Bet Number #${selectedNumber} · $${preview.stake.toFixed(2)}`
                    : `Bet ${selectedColor.toUpperCase()} · $${preview.stake.toFixed(2)}`}
                </button>
              </form>

              {/* Current Round Active Bets */}
              {activeRoundBets.length > 0 && (
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 space-y-1.5">
                  <span className="text-[10px] font-bold text-slate-300 block">
                    Active Trades ({activeRoundBets.length})
                  </span>
                  <div className="space-y-1">
                    {activeRoundBets.map((bet) => {
                      const isNum = bet.betType === 'number' && bet.pickedNumber !== null;
                      return (
                        <div
                          key={bet.id}
                          className="flex items-center justify-between text-[11px] font-mono tabular-nums bg-slate-900 border border-slate-800 rounded px-2 py-1"
                        >
                          <span
                            className={`font-bold ${
                              isNum
                                ? 'text-amber-300'
                                : bet.color === 'green'
                                ? 'text-emerald-400'
                                : 'text-red-400'
                            }`}
                          >
                            {isNum
                              ? `#${bet.pickedNumber} (${bet.multiplier.toFixed(1)}x)`
                              : bet.color.toUpperCase()}{' '}
                            · ${bet.stake.toFixed(2)}
                          </span>
                          <span className="text-slate-300">Win: ${bet.potentialPayout.toFixed(2)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            {/* Right: Compact Past Results Strip & Personal Trade History Table (7 cols) */}
            <section className="lg:col-span-7 space-y-3">
              {/* Compact Past Results Strip (5 recent by default) */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 sm:p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2">
                  <h2 className="text-xs font-bold text-white whitespace-nowrap">Live Result History Strip</h2>
                  <div className="flex items-center gap-2 text-[11px] font-mono tabular-nums">
                    <span className="text-emerald-400">GREEN: {greenRecentCount}</span>
                    <span className="text-slate-600">·</span>
                    <span className="text-red-400">RED: {redRecentCount}</span>
                    {pastRounds.length > 0 && (
                      <button
                        type="button"
                        data-testid="lottery-history-strip-all-btn"
                        aria-label="View all live result history"
                        title="View all live result history"
                        onClick={() => setShowAllResultsModal(true)}
                        className="min-h-[26px] px-2 py-0.5 rounded-md bg-slate-950 hover:bg-slate-800 border border-slate-700 text-[10px] font-sans font-semibold text-slate-200 flex items-center gap-1 transition-colors whitespace-nowrap"
                      >
                        <History className="w-3 h-3 text-amber-400" aria-hidden="true" />
                        <span>All</span>
                      </button>
                    )}
                  </div>
                </div>

                {pastRounds.length === 0 ? (
                  <p className="text-xs text-slate-400 py-1.5">No settled rounds recorded yet.</p>
                ) : (
                  <div
                    data-testid="lottery-history-strip"
                    className="grid grid-cols-5 gap-1.5"
                  >
                    {pastRounds.slice(0, 5).map((r) => {
                      const resolvedColor: LotteryColor = r.winningColor ?? 'green';
                      const isGreen = resolvedColor === 'green';
                      const shortCode = r.roundCode.split('-')[1] || r.roundCode;
                      const drawnDigit =
                        typeof r.winningNumber === 'number'
                          ? r.winningNumber
                          : deriveLotteryDrawNumber(r.roundCode, resolvedColor);
                      return (
                        <div
                          key={r.roundCode}
                          className={`rounded-lg border py-1 px-1 text-center font-mono tabular-nums ${
                            isGreen
                              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                              : 'bg-red-950/40 border-red-500/40 text-red-300'
                          }`}
                        >
                          <span className="text-[9px] text-slate-400 block truncate">#{shortCode}</span>
                          <span className="text-xs font-black block leading-tight">{drawnDigit}</span>
                          <span className="text-[8px] sm:text-[9px] font-bold block">
                            {isGreen ? 'GREEN' : 'RED'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Compact Personal Trade History Table (5 recent by default) */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 sm:p-3.5 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
                  <h2 className="text-xs font-bold text-white whitespace-nowrap">Personal Trade History</h2>
                  <div className="flex items-center gap-1.5">
                    <div className="flex bg-slate-950 p-0.5 rounded-md border border-slate-800 text-[10px] font-semibold">
                      {(['ALL', 'PENDING', 'WIN', 'LOSS'] as const).map((statusOpt) => (
                        <button
                          key={statusOpt}
                          type="button"
                          onClick={() => setHistoryFilter(statusOpt)}
                          className={`px-2 py-0.5 rounded transition-colors ${
                            historyFilter === statusOpt
                              ? 'bg-blue-600 text-white'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {statusOpt}
                        </button>
                      ))}
                    </div>
                    {(lotteryState?.userBets?.length ?? 0) > 0 && (
                      <button
                        type="button"
                        data-testid="lottery-personal-history-all-btn"
                        aria-label="View all personal trade history"
                        title="View all personal trade history"
                        onClick={() => setShowAllBetsModal(true)}
                        className="min-h-[26px] px-2 py-0.5 rounded-md bg-slate-950 hover:bg-slate-800 border border-slate-700 text-[10px] font-semibold text-slate-200 flex items-center gap-1 transition-colors whitespace-nowrap"
                      >
                        <History className="w-3 h-3 text-amber-400" aria-hidden="true" />
                        <span>All</span>
                      </button>
                    )}
                  </div>
                </div>

                {filteredUserBets.length === 0 ? (
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 text-center space-y-1">
                    <p className="text-xs font-semibold text-slate-300">No trades in this filter yet.</p>
                    <p className="text-[11px] text-slate-400">
                      Pick Green, Red, or Exact Number (0–9) to track live payouts.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table
                      data-testid="lottery-personal-history-table"
                      className="w-full text-left border-collapse text-[11px] font-mono tabular-nums"
                    >
                      <thead>
                        <tr className="border-b border-slate-800 text-[10px] uppercase text-slate-400">
                          <th className="py-1.5 pr-2 font-semibold">Round</th>
                          <th className="py-1.5 px-2 font-semibold">Pick</th>
                          <th className="py-1.5 px-2 font-semibold text-right">Stake</th>
                          <th className="py-1.5 px-2 font-semibold text-right">Fee</th>
                          <th className="py-1.5 px-2 font-semibold">Outcome</th>
                          <th className="py-1.5 pl-2 font-semibold text-right">Net P/L</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70">
                        {filteredUserBets.slice(0, 5).map((bet) => {
                          const isNum = bet.betType === 'number' && bet.pickedNumber !== null;
                          const isGreen = bet.color === 'green';
                          return (
                            <tr key={bet.id} className="h-8 hover:bg-slate-800/30">
                              <td className="py-1 pr-2 text-slate-300 whitespace-nowrap">
                                {bet.roundCode}
                              </td>
                              <td className="py-1 px-2 font-bold whitespace-nowrap">
                                {isNum ? (
                                  <span className="text-amber-300">
                                    #{bet.pickedNumber} · {isGreen ? 'GREEN' : 'RED'}
                                  </span>
                                ) : (
                                  <span className={isGreen ? 'text-emerald-400' : 'text-red-400'}>
                                    {bet.color.toUpperCase()}
                                  </span>
                                )}
                              </td>
                              <td className="py-1 px-2 text-right text-white">
                                ${bet.stake.toFixed(2)}
                              </td>
                              <td className="py-1 px-2 text-right text-amber-400">
                                -${formatLotteryFeeUsd(bet.feeAmount)}
                              </td>
                              <td className="py-1 px-2 whitespace-nowrap">
                                <span
                                  className={`font-bold ${
                                    bet.outcome === 'WIN'
                                      ? 'text-emerald-400'
                                      : bet.outcome === 'LOSS'
                                      ? 'text-red-400'
                                      : 'text-amber-300'
                                  }`}
                                >
                                  {bet.outcome}
                                </span>
                              </td>
                              <td
                                className={`py-1 pl-2 text-right font-bold whitespace-nowrap ${
                                  bet.outcome === 'PENDING'
                                    ? 'text-slate-400'
                                    : bet.netProfit >= 0
                                    ? 'text-emerald-400'
                                    : 'text-red-400'
                                }`}
                              >
                                {bet.outcome === 'PENDING'
                                  ? `Est. +$${(bet.potentialPayout - bet.stake).toFixed(2)}`
                                  : `${bet.netProfit >= 0 ? '+' : ''}$${bet.netProfit.toFixed(2)}`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* All Live Result History Modal */}
          {showAllResultsModal && (
            <div
              data-testid="lottery-history-strip-modal"
              role="dialog"
              aria-modal="true"
              aria-label="All Live Result History"
              className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
            >
              <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[82vh] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <History className="w-4 h-4 text-amber-400" aria-hidden="true" />
                    <h3 className="text-sm font-bold text-white">All Live Result History</h3>
                    <span className="text-[11px] font-mono text-slate-400">
                      ({pastRounds.length})
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-label="Close all live result history"
                    onClick={() => setShowAllResultsModal(false)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="p-4 overflow-y-auto">
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                    {pastRounds.map((r) => {
                      const resolvedColor: LotteryColor = r.winningColor ?? 'green';
                      const isGreen = resolvedColor === 'green';
                      const shortCode = r.roundCode.split('-')[1] || r.roundCode;
                      const drawnDigit =
                        typeof r.winningNumber === 'number'
                          ? r.winningNumber
                          : deriveLotteryDrawNumber(r.roundCode, resolvedColor);
                      return (
                        <div
                          key={r.roundCode}
                          className={`rounded-lg border p-2 text-center font-mono tabular-nums ${
                            isGreen
                              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                              : 'bg-red-950/40 border-red-500/40 text-red-300'
                          }`}
                        >
                          <span className="text-[10px] text-slate-400 block">#{shortCode}</span>
                          <span className="text-sm font-black block leading-tight">{drawnDigit}</span>
                          <span className="text-[9px] font-bold block">
                            {isGreen ? 'GREEN' : 'RED'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* All Personal Trade History Modal */}
          {showAllBetsModal && (
            <div
              data-testid="lottery-personal-history-modal"
              role="dialog"
              aria-modal="true"
              aria-label="All Personal Trade History"
              className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
            >
              <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <History className="w-4 h-4 text-amber-400" aria-hidden="true" />
                    <h3 className="text-sm font-bold text-white">All Personal Trade History</h3>
                    <span className="text-[11px] font-mono text-slate-400">
                      ({filteredUserBets.length})
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex bg-slate-950 p-0.5 rounded-md border border-slate-800 text-[10px] font-semibold">
                      {(['ALL', 'PENDING', 'WIN', 'LOSS'] as const).map((statusOpt) => (
                        <button
                          key={statusOpt}
                          type="button"
                          onClick={() => setHistoryFilter(statusOpt)}
                          className={`px-2 py-0.5 rounded transition-colors ${
                            historyFilter === statusOpt
                              ? 'bg-blue-600 text-white'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {statusOpt}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      aria-label="Close all personal trade history"
                      onClick={() => setShowAllBetsModal(false)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="p-4 overflow-y-auto">
                  {filteredUserBets.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-6">
                      No trades in this filter yet.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-[11px] font-mono tabular-nums">
                        <thead>
                          <tr className="border-b border-slate-800 text-[10px] uppercase text-slate-400">
                            <th className="py-1.5 pr-2 font-semibold">Round</th>
                            <th className="py-1.5 px-2 font-semibold">Pick</th>
                            <th className="py-1.5 px-2 font-semibold text-right">Stake</th>
                            <th className="py-1.5 px-2 font-semibold text-right">Fee</th>
                            <th className="py-1.5 px-2 font-semibold">Outcome</th>
                            <th className="py-1.5 pl-2 font-semibold text-right">Net P/L</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/70">
                          {filteredUserBets.map((bet) => {
                            const isNum = bet.betType === 'number' && bet.pickedNumber !== null;
                            const isGreen = bet.color === 'green';
                            return (
                              <tr key={bet.id} className="h-9 hover:bg-slate-800/30">
                                <td className="py-1.5 pr-2 text-slate-300 whitespace-nowrap">
                                  {bet.roundCode}
                                </td>
                                <td className="py-1.5 px-2 font-bold whitespace-nowrap">
                                  {isNum ? (
                                    <span className="text-amber-300">
                                      #{bet.pickedNumber} · {isGreen ? 'GREEN' : 'RED'}
                                    </span>
                                  ) : (
                                    <span className={isGreen ? 'text-emerald-400' : 'text-red-400'}>
                                      {bet.color.toUpperCase()}
                                    </span>
                                  )}
                                </td>
                                <td className="py-1.5 px-2 text-right text-white">
                                  ${bet.stake.toFixed(2)}
                                </td>
                                <td className="py-1.5 px-2 text-right text-amber-400">
                                  -${formatLotteryFeeUsd(bet.feeAmount)}
                                </td>
                                <td className="py-1.5 px-2 whitespace-nowrap">
                                  <span
                                    className={`font-bold ${
                                      bet.outcome === 'WIN'
                                        ? 'text-emerald-400'
                                        : bet.outcome === 'LOSS'
                                        ? 'text-red-400'
                                        : 'text-amber-300'
                                    }`}
                                  >
                                    {bet.outcome}
                                  </span>
                                </td>
                                <td
                                  className={`py-1.5 pl-2 text-right font-bold whitespace-nowrap ${
                                    bet.outcome === 'PENDING'
                                      ? 'text-slate-400'
                                      : bet.netProfit >= 0
                                      ? 'text-emerald-400'
                                      : 'text-red-400'
                                  }`}
                                >
                                  {bet.outcome === 'PENDING'
                                    ? `Est. +$${(bet.potentialPayout - bet.stake).toFixed(2)}`
                                    : `${bet.netProfit >= 0 ? '+' : ''}$${bet.netProfit.toFixed(2)}`}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
