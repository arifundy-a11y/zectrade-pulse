import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Coins,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  Shield,
  Sliders,
  Timer,
  TrendingUp,
  UserCheck,
  Zap,
} from 'lucide-react';
import type {
  LotteryColor,
  LotteryDigitGameType,
  LotteryLiveState,
  LotteryResultMode,
  ManagedMember,
} from '../types';
import {
  calculateProjectedHouseProfit,
  formatLotteryCountdown,
  getDigitGameLength,
  normalizeDigitTicketNumber,
} from '../utils/lotteryEngine';

export interface DigitDrawSchedulePayload {
  drawUid?: string;
  gameType: LotteryDigitGameType;
  drawLabel?: string;
  scheduledReleaseAtMs?: number;
  lockBeforeSec?: number;
  payoutMultiplier?: number;
  feePct?: number;
  manualResult?: string | null;
  releaseNow?: boolean;
  createNew?: boolean;
}

interface LotteryAdminConsoleProps {
  lotteryState: LotteryLiveState | null;
  remainingSec: number;
  members: ManagedMember[];
  currentUserUid: string;
  currentUserEmail: string;
  onUpdateConfig: (payload: {
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
  onRefreshState: () => Promise<void>;
}

function toDatetimeLocalString(ms: number): string {
  const dt = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(
    dt.getHours()
  )}:${pad(dt.getMinutes())}`;
}

export const LotteryAdminConsole: React.FC<LotteryAdminConsoleProps> = ({
  lotteryState,
  remainingSec,
  members,
  currentUserUid,
  currentUserEmail,
  onUpdateConfig,
  onScheduleDigitDraw,
  onAdjustWallet,
  onRefreshState,
}) => {
  const cfg = lotteryState?.config;
  const round = lotteryState?.currentRound;
  const digitDraws = lotteryState?.digitDraws ?? [];

  const [adminTab, setAdminTab] = useState<'color' | 'digits'>('color');
  const [feeInput, setFeeInput] = useState<string>(String(cfg?.feePct ?? 0.12));
  const [multInput, setMultInput] = useState<string>(String(cfg?.payoutMultiplier ?? 2));
  const [numMultInput, setNumMultInput] = useState<string>(String(cfg?.numberMultiplier ?? 9));
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [walletTarget, setWalletTarget] = useState<string>(currentUserUid || currentUserEmail || '');
  const [walletType, setWalletType] = useState<'demo' | 'real'>('demo');
  const [walletAction, setWalletAction] = useState<'add' | 'deduct'>('add');
  const [walletAmount, setWalletAmount] = useState<string>('500');
  const [walletBusy, setWalletBusy] = useState(false);

  // 2D / 3D / 6D Admin Scheduler State
  const [digitGame, setDigitGame] = useState<LotteryDigitGameType>('2D');
  const activeDigitDraw = useMemo(
    () => digitDraws.find((d) => d.gameType === digitGame) ?? null,
    [digitDraws, digitGame]
  );

  const [drawLabelInput, setDrawLabelInput] = useState('');
  const [manualResultInput, setManualResultInput] = useState('');
  const [releaseTimeInput, setReleaseTimeInput] = useState('');
  const [digitMultInput, setDigitMultInput] = useState('80');
  const [digitFeeInput, setDigitFeeInput] = useState('0.12');

  useEffect(() => {
    if (cfg) {
      setFeeInput(String(cfg.feePct));
      setMultInput(String(cfg.payoutMultiplier));
      setNumMultInput(String(cfg.numberMultiplier ?? 9));
    }
  }, [cfg?.feePct, cfg?.payoutMultiplier, cfg?.numberMultiplier]);

  useEffect(() => {
    if (!walletTarget && (currentUserUid || currentUserEmail)) {
      setWalletTarget(currentUserUid || currentUserEmail);
    }
  }, [currentUserUid, currentUserEmail, walletTarget]);

  useEffect(() => {
    if (activeDigitDraw) {
      setDrawLabelInput(activeDigitDraw.drawLabel);
      setManualResultInput(activeDigitDraw.manualResult ?? '');
      setReleaseTimeInput(toDatetimeLocalString(activeDigitDraw.scheduledReleaseAtMs));
      setDigitMultInput(String(activeDigitDraw.payoutMultiplier));
      setDigitFeeInput(String(activeDigitDraw.feePct));
    } else {
      setDrawLabelInput(`${digitGame} Scheduled Official Draw`);
      setManualResultInput('');
      setReleaseTimeInput(toDatetimeLocalString(Date.now() + 15 * 60_000));
      setDigitMultInput(digitGame === '2D' ? '80' : digitGame === '3D' ? '500' : '10000');
      setDigitFeeInput('0.12');
    }
  }, [activeDigitDraw?.drawUid, digitGame]);

  if (!cfg || !round) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs text-slate-400">
        Loading Lottery Live engine controls...
      </div>
    );
  }

  const projection = calculateProjectedHouseProfit({
    greenTotal: round.greenTotal,
    redTotal: round.redTotal,
    feePct: cfg.feePct,
    multiplier: cfg.payoutMultiplier,
  });

  const totalPool = round.greenTotal + round.redTotal;
  const greenSharePct = totalPool > 0 ? Math.round((round.greenTotal / totalPool) * 100) : 50;
  const redSharePct = totalPool > 0 ? 100 - greenSharePct : 50;

  const runConfigUpdate = async (
    key: string,
    payload: Parameters<LotteryAdminConsoleProps['onUpdateConfig']>[0]
  ) => {
    setBusyAction(key);
    try {
      await onUpdateConfig(payload);
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveFeeAndMultiplier = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedFee = parseFloat(feeInput);
    const parsedMult = parseFloat(multInput);
    const parsedNumMult = parseFloat(numMultInput);
    if (!Number.isFinite(parsedFee) || !Number.isFinite(parsedMult)) return;
    await runConfigUpdate('fees', {
      feePct: parsedFee,
      payoutMultiplier: parsedMult,
      numberMultiplier: Number.isFinite(parsedNumMult) ? parsedNumMult : undefined,
    });
  };

  const handleAdjustBalanceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(walletAmount);
    if (!walletTarget.trim() || !Number.isFinite(amt) || amt <= 0) return;
    setWalletBusy(true);
    try {
      const ok = await onAdjustWallet({
        identifier: walletTarget.trim(),
        wallet: walletType,
        action: walletAction,
        amount: amt,
      });
      if (ok) {
        setWalletAmount('500');
      }
    } finally {
      setWalletBusy(false);
    }
  };

  const digitLen = getDigitGameLength(digitGame);

  const handleSaveDigitSchedule = async (opts: { releaseNow?: boolean; createNew?: boolean } = {}) => {
    if (!onScheduleDigitDraw) return;
    const parsedReleaseMs = releaseTimeInput ? new Date(releaseTimeInput).getTime() : undefined;
    const parsedMult = parseFloat(digitMultInput);
    const parsedFee = parseFloat(digitFeeInput);

    const trimmedManual = manualResultInput.trim();
    if (trimmedManual && !normalizeDigitTicketNumber(trimmedManual, digitGame)) {
      return;
    }

    setBusyAction(opts.releaseNow ? 'digit_release' : opts.createNew ? 'digit_new' : 'digit_save');
    try {
      await onScheduleDigitDraw({
        drawUid: opts.createNew ? undefined : activeDigitDraw?.drawUid,
        gameType: digitGame,
        drawLabel: drawLabelInput.trim() || `${digitGame} Scheduled Draw`,
        scheduledReleaseAtMs:
          parsedReleaseMs && Number.isFinite(parsedReleaseMs) ? parsedReleaseMs : undefined,
        payoutMultiplier: Number.isFinite(parsedMult) ? parsedMult : undefined,
        feePct: Number.isFinite(parsedFee) ? parsedFee : undefined,
        manualResult: trimmedManual || null,
        releaseNow: opts.releaseNow,
        createNew: opts.createNew,
      });
    } finally {
      setBusyAction(null);
    }
  };

  const memberOptions = [
    ...(currentUserUid
      ? [
          {
            uid: currentUserUid,
            label: `Active Session (${currentUserEmail || currentUserUid})`,
          },
        ]
      : []),
    ...members
      .filter((m) => m.uid !== currentUserUid)
      .map((m) => ({
        uid: m.uid,
        label: `${m.username} (${m.email}) · ${m.uid}`,
      })),
  ];

  return (
    <section
      aria-label="Lottery Live Admin Control Panel"
      data-testid="lottery-admin-console"
      className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 sm:p-4 space-y-3.5"
    >
      {/* Top Admin Header + Tab Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-800 pb-2.5">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-amber-400" aria-hidden="true" />
          <div>
            <h2 className="text-xs sm:text-sm font-bold text-white">
              Admin Control Console
            </h2>
            <p className="text-[10px] text-slate-400 font-mono tabular-nums">
              Round {round.roundCode} · {formatLotteryCountdown(remainingSec)} ·{' '}
              {cfg.isPaused ? 'PAUSED' : remainingSec <= cfg.lockSeconds ? 'LOCKED' : 'OPEN'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[11px] font-bold">
            <button
              type="button"
              data-testid="admin-tab-color"
              onClick={() => setAdminTab('color')}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                adminTab === 'color' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-white'
              }`}
            >
              Color &amp; 0-9 Live
            </button>
            <button
              type="button"
              data-testid="admin-tab-digits"
              onClick={() => setAdminTab('digits')}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                adminTab === 'digits' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-white'
              }`}
            >
              2D / 3D / 6D Scheduler
            </button>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-right">
            <span className="text-[9px] text-slate-400 block leading-none">Platform Profit</span>
            <span
              data-testid="lottery-admin-accumulated-profit"
              className={`text-xs font-mono font-bold tabular-nums ${
                cfg.accumulatedProfit >= 0 ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {cfg.accumulatedProfit >= 0 ? '+' : ''}${cfg.accumulatedProfit.toFixed(2)}
            </span>
          </div>

          <button
            type="button"
            onClick={() => onRefreshState()}
            className="p-2 min-h-[34px] rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300"
            aria-label="Refresh lottery admin state"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {adminTab === 'digits' ? (
        /* TAB B: 2D / 3D / 6D MANUAL RESULT & SCHEDULED TIME CONTROLLER */
        <div className="space-y-3" data-testid="admin-digit-scheduler">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 gap-1">
              {(['2D', '3D', '6D'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  data-testid={`admin-digit-game-${g}`}
                  onClick={() => setDigitGame(g)}
                  className={`px-3 py-1 rounded-md text-xs font-mono font-bold transition-colors ${
                    digitGame === g ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {g} Draw
                </button>
              ))}
            </div>

            {activeDigitDraw && (
              <span className="text-[11px] font-mono text-slate-400">
                Draw ID: <strong className="text-amber-300">{activeDigitDraw.drawUid}</strong> ·
                Pool ${activeDigitDraw.totalStake.toFixed(2)} ({activeDigitDraw.betCount} tickets)
              </span>
            )}
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">
                  Draw Session Label
                </label>
                <input
                  type="text"
                  value={drawLabelInput}
                  onChange={(e) => setDrawLabelInput(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white"
                />
              </div>

              <div>
                <label
                  htmlFor="admin-digit-manual-result"
                  className="text-[10px] text-amber-300 font-semibold block mb-1"
                >
                  Manual Result ({digitLen} digits)
                </label>
                <input
                  id="admin-digit-manual-result"
                  data-testid="admin-digit-manual-result"
                  type="text"
                  inputMode="numeric"
                  maxLength={digitLen}
                  value={manualResultInput}
                  onChange={(e) =>
                    setManualResultInput(e.target.value.replace(/\D/g, '').slice(0, digitLen))
                  }
                  placeholder={`e.g. ${'8'.repeat(digitLen)}`}
                  className="w-full bg-slate-900 border border-amber-500/40 rounded-lg px-2.5 py-2 text-xs font-mono font-bold text-amber-300 tracking-widest"
                />
              </div>

              <div>
                <label
                  htmlFor="admin-digit-release-time"
                  className="text-[10px] text-slate-300 font-semibold block mb-1"
                >
                  Scheduled Result Release Time
                </label>
                <input
                  id="admin-digit-release-time"
                  data-testid="admin-digit-release-time"
                  type="datetime-local"
                  value={releaseTimeInput}
                  onChange={(e) => setReleaseTimeInput(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-xs font-mono text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">Multiplier (x)</label>
                  <input
                    type="number"
                    min="2"
                    max="100000"
                    value={digitMultInput}
                    onChange={(e) => setDigitMultInput(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-2 text-xs font-mono text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">Fee %</label>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    step="0.01"
                    value={digitFeeInput}
                    onChange={(e) => setDigitFeeInput(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-2 text-xs font-mono text-white"
                  />
                </div>
              </div>
            </div>

            {/* Quick Schedule Presets */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                <span className="text-slate-400 flex items-center gap-1">
                  <CalendarClock className="w-3 h-3 text-amber-400" aria-hidden="true" />
                  Schedule In:
                </span>
                {[
                  { label: '+1m', ms: 60_000 },
                  { label: '+5m', ms: 5 * 60_000 },
                  { label: '+15m', ms: 15 * 60_000 },
                  { label: '+1h', ms: 60 * 60_000 },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() =>
                      setReleaseTimeInput(toDatetimeLocalString(Date.now() + preset.ms))
                    }
                    className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => handleSaveDigitSchedule({ createNew: true })}
                  className="min-h-[34px] px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-bold text-slate-200 flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  New Draw
                </button>
                <button
                  type="button"
                  disabled={
                    busyAction !== null ||
                    (Boolean(manualResultInput.trim()) &&
                      !normalizeDigitTicketNumber(manualResultInput.trim(), digitGame))
                  }
                  data-testid="admin-digit-save-btn"
                  onClick={() => handleSaveDigitSchedule({ releaseNow: false })}
                  className="min-h-[34px] px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white transition-colors disabled:opacity-50"
                >
                  {busyAction === 'digit_save' ? 'Saving...' : 'Save Schedule & Result'}
                </button>
                <button
                  type="button"
                  disabled={
                    busyAction !== null ||
                    (Boolean(manualResultInput.trim()) &&
                      !normalizeDigitTicketNumber(manualResultInput.trim(), digitGame))
                  }
                  data-testid="admin-digit-release-now-btn"
                  onClick={() => handleSaveDigitSchedule({ releaseNow: true })}
                  className="min-h-[34px] px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-xs font-bold text-slate-950 flex items-center gap-1 transition-colors disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" aria-hidden="true" />
                  {busyAction === 'digit_release' ? 'Releasing...' : 'Release Result Now'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* TAB A: COLOR & 0-9 NUMBER LIVE ADMIN CONTROLS */
        <>
          {/* 1. Live Round Monitor */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-blue-400" aria-hidden="true" />
                Live Round Volume &amp; Projected House Profit
              </span>
              <span className="text-[11px] font-mono tabular-nums text-slate-400">
                Total Pool: ${projection.totalPool.toFixed(2)}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="bg-slate-900 border border-emerald-500/30 rounded-lg p-2">
                <span className="text-[10px] text-emerald-400 font-semibold block">
                  GREEN POOL ({round.greenCount})
                </span>
                <span
                  data-testid="admin-monitor-green-total"
                  className="text-xs sm:text-sm font-mono font-bold text-white tabular-nums"
                >
                  ${round.greenTotal.toFixed(2)}
                </span>
              </div>
              <div className="bg-slate-900 border border-red-500/30 rounded-lg p-2">
                <span className="text-[10px] text-red-400 font-semibold block">
                  RED POOL ({round.redCount})
                </span>
                <span
                  data-testid="admin-monitor-red-total"
                  className="text-xs sm:text-sm font-mono font-bold text-white tabular-nums"
                >
                  ${round.redTotal.toFixed(2)}
                </span>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-2">
                <span className="text-[10px] text-slate-400 block">House P/L (GREEN)</span>
                <span
                  className={`text-xs sm:text-sm font-mono font-bold tabular-nums ${
                    projection.profitIfGreenWins >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {projection.profitIfGreenWins >= 0 ? '+' : ''}${projection.profitIfGreenWins.toFixed(2)}
                </span>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-2">
                <span className="text-[10px] text-slate-400 block">House P/L (RED)</span>
                <span
                  className={`text-xs sm:text-sm font-mono font-bold tabular-nums ${
                    projection.profitIfRedWins >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {projection.profitIfRedWins >= 0 ? '+' : ''}${projection.profitIfRedWins.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="h-1.5 w-full rounded-full overflow-hidden bg-slate-800 flex">
                <div className="bg-emerald-500 transition-all duration-200" style={{ width: `${greenSharePct}%` }} />
                <div className="bg-red-500 transition-all duration-200" style={{ width: `${redSharePct}%` }} />
              </div>
              <div className="flex justify-between text-[10px] font-mono tabular-nums text-slate-400">
                <span className="text-emerald-400">GREEN {greenSharePct}%</span>
                <span className="text-red-400">RED {redSharePct}%</span>
              </div>
            </div>
          </div>

          {/* 2. Result Engine & Fee/Multiplier Settings */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* Result Engine */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                  Result Resolution Engine
                </span>
                <span className="text-[10px] font-mono text-amber-300 uppercase">
                  {cfg.resultMode === 'auto_balance'
                    ? 'Auto-Balance'
                    : cfg.resultMode === 'manual'
                    ? `Manual${cfg.forcedNumber !== null ? ` (#${cfg.forcedNumber})` : cfg.forcedResult ? ` (${cfg.forcedResult.toUpperCase()})` : ''}`
                    : 'Random RNG'}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1.5 bg-slate-900 p-1 rounded-lg border border-slate-800">
                {(
                  [
                    { id: 'auto_balance', label: 'Auto-Balance' },
                    { id: 'manual', label: 'Manual Override' },
                    { id: 'random', label: 'Random RNG' },
                  ] as const
                ).map((modeOpt) => {
                  const active = cfg.resultMode === modeOpt.id;
                  return (
                    <button
                      key={modeOpt.id}
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() => runConfigUpdate('mode', { resultMode: modeOpt.id })}
                      className={`py-1.5 px-2 rounded-md text-[11px] font-semibold transition-colors ${
                        active
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-400 hover:text-white hover:bg-slate-800'
                      }`}
                    >
                      {modeOpt.label}
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  disabled={busyAction !== null}
                  data-testid="admin-force-green"
                  onClick={() =>
                    runConfigUpdate('force_green', {
                      resultMode: 'manual',
                      forcedResult: 'green',
                      forcedNumber: null,
                    })
                  }
                  className={`min-h-[36px] px-2.5 py-1.5 rounded-lg text-xs font-bold border flex items-center justify-center gap-1 transition-colors ${
                    cfg.resultMode === 'manual' && cfg.forcedResult === 'green' && cfg.forcedNumber === null
                      ? 'bg-emerald-600 border-emerald-400 text-white'
                      : 'bg-emerald-600/15 hover:bg-emerald-600/30 border-emerald-500/40 text-emerald-300'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                  Force Green
                </button>
                <button
                  type="button"
                  disabled={busyAction !== null}
                  data-testid="admin-force-red"
                  onClick={() =>
                    runConfigUpdate('force_red', {
                      resultMode: 'manual',
                      forcedResult: 'red',
                      forcedNumber: null,
                    })
                  }
                  className={`min-h-[36px] px-2.5 py-1.5 rounded-lg text-xs font-bold border flex items-center justify-center gap-1 transition-colors ${
                    cfg.resultMode === 'manual' && cfg.forcedResult === 'red' && cfg.forcedNumber === null
                      ? 'bg-red-600 border-red-400 text-white'
                      : 'bg-red-600/15 hover:bg-red-600/30 border-red-500/40 text-red-300'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                  Force Red
                </button>
                <button
                  type="button"
                  disabled={busyAction !== null}
                  data-testid="admin-settle-now"
                  onClick={() => runConfigUpdate('settle_now', { settleNow: true })}
                  className="min-h-[36px] px-2.5 py-1.5 rounded-lg text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 transition-colors"
                >
                  {busyAction === 'settle_now' ? 'Settling...' : 'Settle Now'}
                </button>
              </div>

              {/* Exact Digit Force (0-9) */}
              <div className="space-y-1 pt-0.5">
                <span className="text-[10px] text-slate-400 block">
                  Force Exact Digit (0–9) · Odd=Green / Even=Red
                </span>
                <div className="grid grid-cols-5 gap-1.5">
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => {
                    const active = cfg.resultMode === 'manual' && cfg.forcedNumber === d;
                    const odd = d % 2 === 1;
                    return (
                      <button
                        key={d}
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() =>
                          runConfigUpdate(`force_num_${d}`, {
                            resultMode: 'manual',
                            forcedNumber: d,
                          })
                        }
                        className={`py-1 rounded border text-[11px] font-mono font-bold transition-colors ${
                          active
                            ? odd
                              ? 'bg-emerald-600 border-emerald-400 text-white'
                              : 'bg-red-600 border-red-400 text-white'
                            : odd
                            ? 'bg-emerald-950/30 hover:bg-emerald-950/60 border-emerald-700/40 text-emerald-300'
                            : 'bg-red-950/30 hover:bg-red-950/60 border-red-700/40 text-red-300'
                        }`}
                      >
                        #{d}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Fee & Payout Settings */}
            <form
              onSubmit={handleSaveFeeAndMultiplier}
              className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                  Fee &amp; Payout Settings
                </span>
                <span className="text-[11px] font-mono tabular-nums text-slate-400">
                  {cfg.feePct}% · Color {cfg.payoutMultiplier}x · # {cfg.numberMultiplier ?? 9}x
                </span>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <label htmlFor="lottery-admin-fee-range" className="text-slate-300 font-medium">
                    Platform Fee (0% – 50%)
                  </label>
                  <span className="font-mono font-bold text-amber-400 tabular-nums">{feeInput}%</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="lottery-admin-fee-range"
                    type="range"
                    min="0"
                    max="50"
                    step="0.01"
                    value={feeInput}
                    onChange={(e) => setFeeInput(e.target.value)}
                    className="flex-1 accent-amber-500 cursor-pointer"
                  />
                  <input
                    type="number"
                    aria-label="Platform fee percentage"
                    min="0"
                    max="50"
                    step="0.01"
                    value={feeInput}
                    onChange={(e) => setFeeInput(e.target.value)}
                    className="w-16 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs font-mono text-white tabular-nums"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 items-end">
                <div>
                  <label htmlFor="lottery-admin-multiplier" className="text-[10px] text-slate-300 block mb-1">
                    Color (x)
                  </label>
                  <input
                    id="lottery-admin-multiplier"
                    type="number"
                    min="1.05"
                    max="10"
                    step="0.05"
                    value={multInput}
                    onChange={(e) => setMultInput(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs font-mono text-white tabular-nums"
                  />
                </div>
                <div>
                  <label htmlFor="lottery-admin-num-mult" className="text-[10px] text-slate-300 block mb-1">
                    Number 0-9 (x)
                  </label>
                  <input
                    id="lottery-admin-num-mult"
                    type="number"
                    min="1.5"
                    max="20"
                    step="0.5"
                    value={numMultInput}
                    onChange={(e) => setNumMultInput(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs font-mono text-white tabular-nums"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busyAction !== null}
                  className="min-h-[34px] px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-colors"
                >
                  {busyAction === 'fees' ? 'Saving...' : 'Apply'}
                </button>
              </div>
            </form>
          </div>

          {/* 3. Round Timing & Member Balance */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Timer className="w-3.5 h-3.5 text-sky-400" aria-hidden="true" />
                  Round Duration &amp; State
                </span>
                <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                  {cfg.roundDurationSec}s
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {[30, 60, 180].map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => runConfigUpdate(`dur_${sec}`, { roundDurationSec: sec })}
                    className={`min-h-[34px] rounded-lg text-xs font-mono font-bold border transition-colors ${
                      cfg.roundDurationSec === sec
                        ? 'bg-sky-600 border-sky-400 text-white'
                        : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-300'
                    }`}
                  >
                    {sec}s
                  </button>
                ))}
              </div>

              <button
                type="button"
                disabled={busyAction !== null}
                data-testid="admin-toggle-pause"
                onClick={() => runConfigUpdate('pause', { isPaused: !cfg.isPaused })}
                className={`w-full min-h-[36px] rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                  cfg.isPaused
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                }`}
              >
                {cfg.isPaused ? (
                  <>
                    <Play className="w-3.5 h-3.5" aria-hidden="true" />
                    Resume Rounds
                  </>
                ) : (
                  <>
                    <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                    Pause Rounds
                  </>
                )}
              </button>
            </div>

            <form
              onSubmit={handleAdjustBalanceSubmit}
              className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <UserCheck className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                  Add / Deduct Member Balance
                </span>
                <Coins className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
              </div>

              {memberOptions.length > 0 && (
                <select
                  aria-label="Quick-Select Member"
                  value={memberOptions.some((m) => m.uid === walletTarget) ? walletTarget : ''}
                  onChange={(e) => {
                    if (e.target.value) setWalletTarget(e.target.value);
                  }}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
                >
                  <option value="">Custom UID or Email...</option>
                  {memberOptions.map((m) => (
                    <option key={m.uid} value={m.uid}>
                      {m.label}
                    </option>
                  ))}
                </select>
              )}

              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  required
                  value={walletTarget}
                  onChange={(e) => setWalletTarget(e.target.value)}
                  placeholder="Member UID / Email"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white"
                />
                <input
                  type="number"
                  min="1"
                  step="any"
                  required
                  value={walletAmount}
                  onChange={(e) => setWalletAmount(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white tabular-nums"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <select
                  aria-label="Wallet mode"
                  value={walletType}
                  onChange={(e) => setWalletType(e.target.value === 'real' ? 'real' : 'demo')}
                  className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white"
                >
                  <option value="demo">Demo</option>
                  <option value="real">Real</option>
                </select>
                <select
                  aria-label="Balance action"
                  value={walletAction}
                  onChange={(e) => setWalletAction(e.target.value === 'deduct' ? 'deduct' : 'add')}
                  className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white"
                >
                  <option value="add">Add (+)</option>
                  <option value="deduct">Deduct (-)</option>
                </select>
                <button
                  type="submit"
                  disabled={walletBusy}
                  className={`min-h-[34px] rounded-lg text-xs font-bold text-white transition-colors ${
                    walletAction === 'add'
                      ? 'bg-emerald-600 hover:bg-emerald-500'
                      : 'bg-red-600 hover:bg-red-500'
                  }`}
                >
                  {walletBusy ? 'Saving...' : walletAction === 'add' ? 'Credit' : 'Deduct'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </section>
  );
};
