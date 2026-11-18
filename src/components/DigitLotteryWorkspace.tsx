import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, Dices, History, Lock, Ticket, X } from 'lucide-react';
import type {
  AccountMode,
  DigitLotteryBetRecord,
  DigitLotteryDrawSummary,
  LotteryDigitGameType,
} from '../types';
import {
  DEFAULT_LOTTERY_FEE_PCT,
  calculateLotteryTradePreview,
  formatLotteryCountdown,
  formatLotteryFeeUsd,
  generateRandomDigitTicket,
  getDigitGameLength,
  normalizeDigitTicketNumber,
} from '../utils/lotteryEngine';
import { lotteryAudio } from '../utils/lotteryAudio';

interface DigitLotteryWorkspaceProps {
  availableBalance: number;
  accountMode: AccountMode;
  digitDraws: DigitLotteryDrawSummary[];
  digitHistory: DigitLotteryDrawSummary[];
  userDigitBets: DigitLotteryBetRecord[];
  soundEnabled: boolean;
  onPlaceDigitBet: (payload: {
    drawUid: string;
    pickedNumber: string;
    stake: number;
  }) => Promise<boolean>;
}

const DIGIT_STRIP = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
];

const DRUM_CELL_PX = 52;
const ROLL_MS = 1350;
const QUICK_STAKES = [10, 50, 100, 500];
const QUICK_2D_NUMS = ['00', '07', '18', '24', '36', '48', '55', '68', '77', '88', '96', '99'];

export const DigitLotteryWorkspace: React.FC<DigitLotteryWorkspaceProps> = ({
  availableBalance,
  accountMode,
  digitDraws,
  digitHistory,
  userDigitBets,
  soundEnabled,
  onPlaceDigitBet,
}) => {
  const [selectedGame, setSelectedGame] = useState<LotteryDigitGameType>('2D');
  const [ticketInput, setTicketInput] = useState<string>('48');
  const [stakeInput, setStakeInput] = useState<string>('50');
  const [placing, setPlacing] = useState(false);
  const [betFilter, setBetFilter] = useState<'ALL' | 'PENDING' | 'WIN' | 'LOSS'>('ALL');
  const [showAllDrawsModal, setShowAllDrawsModal] = useState(false);
  const [showAllTicketsModal, setShowAllTicketsModal] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [rollSeq, setRollSeq] = useState(0);
  const [isRolling, setIsRolling] = useState(false);
  const [enableTransition, setEnableTransition] = useState(false);
  const [reelOffsets, setReelOffsets] = useState<number[]>([34, 38]);

  const prevReleaseUidRef = useRef<string | null>(null);
  const prevRollSeqRef = useRef(0);
  const rollTimerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 500);
    return () => {
      clearInterval(timer);
      if (rollTimerRef.current !== null) window.clearTimeout(rollTimerRef.current);
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const activeDraw = useMemo(
    () => digitDraws.find((d) => d.gameType === selectedGame) ?? digitDraws[0] ?? null,
    [digitDraws, selectedGame]
  );

  const gameHistory = useMemo(
    () => digitHistory.filter((d) => d.gameType === selectedGame),
    [digitHistory, selectedGame]
  );
  const latestReleased = gameHistory[0] ?? null;

  const digitCount = getDigitGameLength(selectedGame);
  const displayNumber = useMemo(() => {
    const raw = latestReleased?.winningNumber ?? '';
    if (raw.length === digitCount) return raw;
    return '0'.repeat(digitCount);
  }, [latestReleased?.winningNumber, digitCount]);

  // Reset ticket input default cleanly when switching between 2D / 3D / 6D
  useEffect(() => {
    if (selectedGame === '2D') setTicketInput('48');
    else if (selectedGame === '3D') setTicketInput('729');
    else setTicketInput('482915');
  }, [selectedGame]);

  // Auto-trigger physical drum roll when a new 2D/3D/6D result releases
  useEffect(() => {
    const uid = latestReleased?.drawUid ?? null;
    if (!uid) return;
    if (prevReleaseUidRef.current === null) {
      prevReleaseUidRef.current = uid;
      return;
    }
    if (prevReleaseUidRef.current === uid) return;
    prevReleaseUidRef.current = uid;
    setRollSeq((s) => s + 1);
    if (soundEnabled) {
      lotteryAudio.playRollSequence(ROLL_MS);
    }
  }, [latestReleased?.drawUid, soundEnabled]);

  useEffect(() => {
    const digits = displayNumber.split('').map((c) => Number(c) || 0);
    if (rollSeq === prevRollSeqRef.current) {
      setEnableTransition(false);
      setReelOffsets(digits.map((d) => 30 + d));
      return;
    }
    prevRollSeqRef.current = rollSeq;

    if (rollTimerRef.current !== null) window.clearTimeout(rollTimerRef.current);
    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);

    setIsRolling(true);
    setEnableTransition(false);
    setReelOffsets(digits.map((d, idx) => (d + idx + 3) % 10));

    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = window.requestAnimationFrame(() => {
        setEnableTransition(true);
        setReelOffsets(digits.map((d) => 30 + d));
      });
    });

    rollTimerRef.current = window.setTimeout(() => {
      setIsRolling(false);
    }, ROLL_MS + 220);
  }, [rollSeq, displayNumber]);

  const liveRemainingSec = useMemo(() => {
    if (!activeDraw || activeDraw.status !== 'SCHEDULED') return 0;
    return Math.ceil(Math.max(0, activeDraw.scheduledReleaseAtMs - nowMs) / 1000);
  }, [activeDraw, nowMs]);

  const drawLocked =
    !activeDraw ||
    activeDraw.status !== 'SCHEDULED' ||
    liveRemainingSec <= activeDraw.lockBeforeSec;

  const normalizedTicket = normalizeDigitTicketNumber(ticketInput, selectedGame);
  const numericStake = parseFloat(stakeInput);
  const validStake = Number.isFinite(numericStake) && numericStake >= 1 ? numericStake : 0;

  const preview = useMemo(
    () =>
      calculateLotteryTradePreview({
        stake: validStake,
        feePct: activeDraw?.feePct ?? DEFAULT_LOTTERY_FEE_PCT,
        multiplier:
          activeDraw?.payoutMultiplier ??
          (selectedGame === '2D' ? 80 : selectedGame === '3D' ? 500 : 10000),
      }),
    [validStake, activeDraw?.feePct, activeDraw?.payoutMultiplier, selectedGame]
  );

  const filteredBets = useMemo(() => {
    const list = userDigitBets.filter((b) => b.gameType === selectedGame);
    if (betFilter === 'ALL') return list;
    return list.filter((b) => b.outcome === betFilter);
  }, [userDigitBets, selectedGame, betFilter]);

  const handleSubmitTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    lotteryAudio.unlock();
    if (!activeDraw || drawLocked || !normalizedTicket || validStake < 1 || validStake > availableBalance) {
      return;
    }
    setPlacing(true);
    try {
      const ok = await onPlaceDigitBet({
        drawUid: activeDraw.drawUid,
        pickedNumber: normalizedTicket,
        stake: validStake,
      });
      if (ok) {
        lotteryAudio.playBetConfirm();
      }
    } finally {
      setPlacing(false);
    }
  };

  const scheduledDateLabel = activeDraw
    ? new Date(activeDraw.scheduledReleaseAtMs).toLocaleString([], {
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '--';

  return (
    <div className="space-y-1.5 sm:space-y-2.5" data-testid="digit-lottery-workspace">
      {/* Game Mode Selector & Scheduled Release Bar */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-2 sm:p-3 space-y-1.5 sm:space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2">
          <div className="flex bg-slate-950 p-0.5 rounded-lg border border-slate-800 gap-0.5 sm:gap-1">
            {(['2D', '3D', '6D'] as const).map((game) => {
              const active = selectedGame === game;
              const multLabel = game === '2D' ? '80x' : game === '3D' ? '500x' : '10,000x';
              return (
                <button
                  key={game}
                  type="button"
                  data-testid={`digit-game-tab-${game}`}
                  onClick={() => setSelectedGame(game)}
                  className={`px-2 sm:px-3 py-1 rounded-md text-[10px] sm:text-xs font-bold font-mono transition-colors ${
                    active
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-400 hover:text-white hover:bg-slate-900'
                  }`}
                >
                  {game} ({multLabel})
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-mono tabular-nums">
            <span className="hidden sm:flex items-center gap-1 text-slate-300">
              <CalendarClock className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
              Release: <strong className="text-white">{scheduledDateLabel}</strong>
            </span>
            <span
              data-testid="digit-draw-countdown"
              className={`px-1.5 sm:px-2 py-0.5 rounded border font-bold ${
                drawLocked
                  ? 'bg-red-500/15 border-red-500/50 text-red-300'
                  : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
              }`}
            >
              {drawLocked ? 'LOCKED' : `OPEN · ${formatLotteryCountdown(liveRemainingSec)}`}
            </span>
          </div>
        </div>

        {/* Multi-Digit Physical Drum Result Stage */}
        <div className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 sm:p-3 flex items-center justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <span className="text-[9px] sm:text-[10px] font-mono uppercase text-slate-400 block truncate">
              {selectedGame} Latest Result
            </span>
            <span className="text-[11px] sm:text-xs font-mono font-bold text-amber-400 block truncate">
              {latestReleased?.drawLabel ?? `${selectedGame} Draw`}
            </span>
          </div>

          <div className="flex items-center gap-1 sm:gap-2 shrink-0" data-testid="digit-reel-strip">
            {displayNumber.split('').map((_, idx) => {
              const offsetIdx = reelOffsets[idx] ?? 30;
              return (
                <div
                  key={`drum-${selectedGame}-${idx}`}
                  className={`relative w-[36px] sm:w-[46px] h-[52px] rounded-lg border-2 overflow-hidden select-none bg-slate-900 ${
                    isRolling ? 'border-amber-400' : 'border-emerald-500/60'
                  }`}
                >
                  <div
                    className="will-change-transform"
                    style={{
                      transform: `translate3d(0, -${offsetIdx * DRUM_CELL_PX}px, 0)`,
                      transition: enableTransition
                        ? `transform ${ROLL_MS + idx * 90}ms cubic-bezier(0.08, 0.88, 0.16, 1)`
                        : 'none',
                    }}
                  >
                    {DIGIT_STRIP.map((digit, cellIdx) => (
                      <div
                        key={`c-${idx}-${cellIdx}`}
                        className="h-[52px] flex items-center justify-center font-mono text-lg sm:text-2xl font-black text-emerald-300 tabular-nums"
                      >
                        {digit}
                      </div>
                    ))}
                  </div>
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-2.5 bg-gradient-to-b from-slate-950/85 to-transparent" />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2.5 bg-gradient-to-t from-slate-950/85 to-transparent" />
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Main 12-Col Ticket Entry + Results / Tickets */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 sm:gap-3 items-start">
        {/* Left: Compact Ticket Form (5 cols) */}
        <section className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-2.5 sm:p-3.5 space-y-2 sm:space-y-2.5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
            <h2 className="text-[11px] sm:text-xs font-bold text-white flex items-center gap-1.5">
              <Ticket className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
              {selectedGame} Ticket Entry
            </h2>
            <span className="text-[10px] sm:text-[11px] font-mono text-emerald-400 font-bold tabular-nums">
              {activeDraw?.payoutMultiplier ?? 80}x Payout
            </span>
          </div>

          <form onSubmit={handleSubmitTicket} className="space-y-2 sm:space-y-2.5">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] sm:text-[11px]">
                <label htmlFor="digit-ticket-number" className="text-slate-300 font-semibold">
                  Pick {digitCount}-Digit Number ({'0'.repeat(digitCount)}–{'9'.repeat(digitCount)})
                </label>
                <button
                  type="button"
                  onClick={() => setTicketInput(generateRandomDigitTicket(selectedGame))}
                  className="text-amber-400 hover:text-amber-300 font-semibold flex items-center gap-1"
                >
                  <Dices className="w-3 h-3" aria-hidden="true" />
                  Quick Pick
                </button>
              </div>
              <input
                id="digit-ticket-number"
                data-testid="digit-ticket-input"
                type="text"
                inputMode="numeric"
                maxLength={digitCount}
                value={ticketInput}
                onChange={(e) =>
                  setTicketInput(e.target.value.replace(/\D/g, '').slice(0, digitCount))
                }
                placeholder={'0'.repeat(digitCount)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1 sm:py-1.5 min-h-[34px] sm:min-h-[40px] text-center text-base sm:text-lg tracking-[0.35em] font-mono font-black text-amber-300 focus:outline-none focus:border-amber-500"
              />
              {selectedGame === '2D' && (
                <div className="grid grid-cols-6 gap-1 pt-0.5">
                  {QUICK_2D_NUMS.map((numStr) => (
                    <button
                      key={numStr}
                      type="button"
                      onClick={() => setTicketInput(numStr)}
                      className={`py-0.5 sm:py-1 rounded border text-[10px] sm:text-[11px] font-mono font-bold transition-colors ${
                        ticketInput === numStr
                          ? 'bg-amber-500 border-amber-400 text-slate-950'
                          : 'bg-slate-950 hover:bg-slate-800 border-slate-800 text-slate-300'
                      }`}
                    >
                      {numStr}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] sm:text-[11px]">
                <label htmlFor="digit-stake-input" className="text-slate-300 font-semibold">
                  Ticket Stake ({accountMode === 'demo' ? 'Demo' : 'Real'} USD)
                </label>
                <button
                  type="button"
                  onClick={() => setStakeInput('')}
                  className="text-slate-400 hover:text-white"
                >
                  Clear
                </button>
              </div>
              <div className="grid grid-cols-12 sm:grid-cols-1 gap-1.5">
                <input
                  id="digit-stake-input"
                  data-testid="digit-stake-input"
                  type="number"
                  min="1"
                  step="any"
                  required
                  value={stakeInput}
                  onChange={(e) => setStakeInput(e.target.value)}
                  className="col-span-4 sm:col-span-1 w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 sm:px-3 py-1 sm:py-1.5 min-h-[32px] sm:min-h-[36px] text-xs font-mono font-bold text-white tabular-nums"
                />
                <div className="col-span-8 sm:col-span-1 grid grid-cols-4 gap-1 sm:gap-1.5">
                  {QUICK_STAKES.map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setStakeInput(String(amt))}
                      className={`min-h-[32px] sm:min-h-[30px] rounded-md border text-[10px] sm:text-[11px] font-mono font-bold tabular-nums transition-colors ${
                        Number(stakeInput) === amt
                          ? 'bg-blue-600 border-blue-400 text-white'
                          : 'bg-slate-950 hover:bg-slate-800 border-slate-800 text-slate-300'
                      }`}
                    >
                      {amt}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 sm:p-2.5 space-y-0.5 sm:space-y-1 text-[10px] sm:text-[11px] font-mono tabular-nums">
              <div className="flex justify-between text-slate-400">
                <span>Stake / Fee ({preview.feePct}%)</span>
                <span>
                  <strong className="text-white">${preview.stake.toFixed(2)}</strong>
                  <span className="text-slate-600"> · </span>
                  <span className="text-amber-400">-${formatLotteryFeeUsd(preview.feeAmount)}</span>
                </span>
              </div>
              <div className="flex justify-between font-bold border-t border-slate-800 pt-1 text-emerald-400">
                <span>Win Payout ({preview.multiplier}x)</span>
                <span>${preview.grossPayoutOnWin.toFixed(2)}</span>
              </div>
            </div>

            {!normalizedTicket && (
              <p className="text-[10px] sm:text-[11px] text-amber-400">
                Enter all {digitCount} digits to confirm your {selectedGame} ticket.
              </p>
            )}
            {validStake > availableBalance && (
              <p className="text-[10px] sm:text-[11px] text-red-400">Insufficient {accountMode} wallet balance.</p>
            )}

            <button
              type="submit"
              data-testid="digit-confirm-bet"
              disabled={
                placing ||
                drawLocked ||
                !normalizedTicket ||
                validStake < 1 ||
                validStake > availableBalance
              }
              className="w-full min-h-[36px] sm:min-h-[40px] rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              {drawLocked && <Lock className="w-3.5 h-3.5" aria-hidden="true" />}
              {placing
                ? 'Placing Ticket...'
                : drawLocked
                ? `Draw Locked (Final ${activeDraw?.lockBeforeSec ?? 10}s)`
                : `Buy ${selectedGame} Ticket #${normalizedTicket ?? '--'} · $${preview.stake.toFixed(2)}`}
            </button>
          </form>
        </section>

        {/* Right: Recent Draw Results (4) & My 2D/3D/6D Tickets (5) */}
        <section className="lg:col-span-7 space-y-3">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-2">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h2 className="text-xs font-bold text-white">Recent {selectedGame} Released Results</h2>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-slate-400">
                  {gameHistory.length} draws
                </span>
                {gameHistory.length > 0 && (
                  <button
                    type="button"
                    data-testid="digit-results-all-btn"
                    aria-label={`View all ${selectedGame} released results`}
                    title="View all released results"
                    onClick={() => setShowAllDrawsModal(true)}
                    className="min-h-[26px] px-2 py-0.5 rounded-md bg-slate-950 hover:bg-slate-800 border border-slate-700 text-[10px] font-semibold text-slate-200 flex items-center gap-1 transition-colors whitespace-nowrap"
                  >
                    <History className="w-3 h-3 text-amber-400" aria-hidden="true" />
                    <span>All</span>
                  </button>
                )}
              </div>
            </div>

            {gameHistory.length === 0 ? (
              <p className="text-xs text-slate-400">No released {selectedGame} draws yet.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {gameHistory.slice(0, 4).map((draw) => (
                  <div
                    key={draw.drawUid}
                    className="bg-slate-950 border border-emerald-500/35 rounded-lg p-1.5 text-center font-mono tabular-nums"
                  >
                    <span className="text-[9px] text-slate-400 block truncate">
                      {draw.drawLabel}
                    </span>
                    <span className="text-sm font-black text-emerald-300 tracking-wider block">
                      {draw.winningNumber ?? '--'}
                    </span>
                    <span className="text-[9px] text-slate-400 block">
                      {draw.releasedAtMs
                        ? new Date(draw.releasedAtMs).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '--'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
              <h2 className="text-xs font-bold text-white">My {selectedGame} Tickets</h2>
              <div className="flex items-center gap-1.5">
                <div className="flex bg-slate-950 p-0.5 rounded-md border border-slate-800 text-[10px] font-semibold">
                  {(['ALL', 'PENDING', 'WIN', 'LOSS'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setBetFilter(st)}
                      className={`px-2 py-0.5 rounded transition-colors ${
                        betFilter === st ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
                {userDigitBets.some((b) => b.gameType === selectedGame) && (
                  <button
                    type="button"
                    data-testid="digit-tickets-all-btn"
                    aria-label={`View all ${selectedGame} tickets`}
                    title="View all tickets"
                    onClick={() => setShowAllTicketsModal(true)}
                    className="min-h-[26px] px-2 py-0.5 rounded-md bg-slate-950 hover:bg-slate-800 border border-slate-700 text-[10px] font-semibold text-slate-200 flex items-center gap-1 transition-colors whitespace-nowrap"
                  >
                    <History className="w-3 h-3 text-amber-400" aria-hidden="true" />
                    <span>All</span>
                  </button>
                )}
              </div>
            </div>

            {filteredBets.length === 0 ? (
              <p className="text-xs text-slate-400 py-3 text-center">
                No {selectedGame} tickets found in this filter.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table
                  data-testid="digit-tickets-table"
                  className="w-full text-left border-collapse text-[11px] font-mono tabular-nums"
                >
                  <thead>
                    <tr className="border-b border-slate-800 text-[10px] uppercase text-slate-400">
                      <th className="py-1.5 pr-2">Draw</th>
                      <th className="py-1.5 px-2">Number</th>
                      <th className="py-1.5 px-2 text-right">Stake</th>
                      <th className="py-1.5 px-2">Outcome</th>
                      <th className="py-1.5 pl-2 text-right">Net P/L</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {filteredBets.slice(0, 5).map((bet) => (
                      <tr key={bet.id} className="h-8">
                        <td className="py-1 pr-2 text-slate-300 whitespace-nowrap">
                          {bet.drawUid}
                        </td>
                        <td className="py-1 px-2 font-black text-amber-300 tracking-wider">
                          {bet.pickedNumber}
                        </td>
                        <td className="py-1 px-2 text-right text-white">
                          ${bet.stake.toFixed(2)}
                        </td>
                        <td className="py-1 px-2">
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
                            ? `Win $${bet.potentialPayout.toFixed(2)}`
                            : `${bet.netProfit >= 0 ? '+' : ''}$${bet.netProfit.toFixed(2)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* All Released Digit Draw Results Modal */}
      {showAllDrawsModal && (
        <div
          data-testid="digit-results-modal"
          role="dialog"
          aria-modal="true"
          aria-label={`All ${selectedGame} Released Results`}
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
        >
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[82vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-amber-400" aria-hidden="true" />
                <h3 className="text-sm font-bold text-white">
                  All {selectedGame} Released Results
                </h3>
                <span className="text-[11px] font-mono text-slate-400">
                  ({gameHistory.length})
                </span>
              </div>
              <button
                type="button"
                aria-label="Close all released results"
                onClick={() => setShowAllDrawsModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {gameHistory.map((draw) => (
                  <div
                    key={draw.drawUid}
                    className="bg-slate-950 border border-emerald-500/35 rounded-lg p-2 text-center font-mono tabular-nums"
                  >
                    <span className="text-[10px] text-slate-400 block truncate">
                      {draw.drawLabel}
                    </span>
                    <span className="text-base font-black text-emerald-300 tracking-wider block">
                      {draw.winningNumber ?? '--'}
                    </span>
                    <span className="text-[9px] text-slate-400 block">
                      {draw.releasedAtMs
                        ? new Date(draw.releasedAtMs).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '--'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* All My Digit Tickets Modal */}
      {showAllTicketsModal && (
        <div
          data-testid="digit-tickets-modal"
          role="dialog"
          aria-modal="true"
          aria-label={`All ${selectedGame} Tickets`}
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
        >
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-amber-400" aria-hidden="true" />
                <h3 className="text-sm font-bold text-white">All {selectedGame} Tickets</h3>
                <span className="text-[11px] font-mono text-slate-400">
                  ({filteredBets.length})
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex bg-slate-950 p-0.5 rounded-md border border-slate-800 text-[10px] font-semibold">
                  {(['ALL', 'PENDING', 'WIN', 'LOSS'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setBetFilter(st)}
                      className={`px-2 py-0.5 rounded transition-colors ${
                        betFilter === st ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  aria-label="Close all tickets"
                  onClick={() => setShowAllTicketsModal(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-4 overflow-y-auto">
              {filteredBets.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">
                  No {selectedGame} tickets found in this filter.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-[11px] font-mono tabular-nums">
                    <thead>
                      <tr className="border-b border-slate-800 text-[10px] uppercase text-slate-400">
                        <th className="py-1.5 pr-2">Draw</th>
                        <th className="py-1.5 px-2">Number</th>
                        <th className="py-1.5 px-2 text-right">Stake</th>
                        <th className="py-1.5 px-2">Outcome</th>
                        <th className="py-1.5 pl-2 text-right">Net P/L</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {filteredBets.map((bet) => (
                        <tr key={bet.id} className="h-9">
                          <td className="py-1.5 pr-2 text-slate-300 whitespace-nowrap">
                            {bet.drawUid}
                          </td>
                          <td className="py-1.5 px-2 font-black text-amber-300 tracking-wider">
                            {bet.pickedNumber}
                          </td>
                          <td className="py-1.5 px-2 text-right text-white">
                            ${bet.stake.toFixed(2)}
                          </td>
                          <td className="py-1.5 px-2">
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
                              ? `Win $${bet.potentialPayout.toFixed(2)}`
                              : `${bet.netProfit >= 0 ? '+' : ''}$${bet.netProfit.toFixed(2)}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
