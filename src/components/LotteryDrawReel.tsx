import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Disc3, Lock, Sparkles } from 'lucide-react';
import type { LotteryColor } from '../types';
import {
  deriveLotteryDrawNumber,
  formatLotteryCountdown,
  getLotteryDigitParityLabel,
} from '../utils/lotteryEngine';

interface LotteryDrawReelProps {
  currentRoundCode: string;
  remainingSec: number;
  lockSeconds: number;
  isPaused: boolean;
  payoutMultiplier: number;
  greenPoolTotal: number;
  redPoolTotal: number;
  lastSettledRound: {
    roundCode: string;
    winningColor: LotteryColor;
    winningNumber?: number | null;
  } | null;
  rollSequenceId: number;
}

const DIGIT_STRIP = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
];

const HERO_CELL_PX = 58;
const FLANK_CELL_PX = 46;
const ROLL_DURATION_MS = 1350;

function extractRoundTwoDigits(roundCode: string | undefined): [number, number] {
  if (!roundCode) return [0, 0];
  const digits = roundCode.replace(/\D/g, '');
  if (digits.length < 2) return [0, Number(digits[0] || 0)];
  return [
    Number(digits[digits.length - 2]) || 0,
    Number(digits[digits.length - 1]) || 0,
  ];
}

export const LotteryDrawReel: React.FC<LotteryDrawReelProps> = ({
  currentRoundCode,
  remainingSec,
  lockSeconds,
  isPaused,
  payoutMultiplier,
  greenPoolTotal,
  redPoolTotal,
  lastSettledRound,
  rollSequenceId,
}) => {
  const winningColor: LotteryColor = lastSettledRound?.winningColor ?? 'green';
  const settledCode = lastSettledRound?.roundCode ?? currentRoundCode;
  const targetDigit = useMemo(() => {
    if (
      lastSettledRound &&
      typeof lastSettledRound.winningNumber === 'number' &&
      Number.isInteger(lastSettledRound.winningNumber)
    ) {
      return lastSettledRound.winningNumber;
    }
    return lastSettledRound ? deriveLotteryDrawNumber(settledCode, winningColor) : 7;
  }, [lastSettledRound, settledCode, winningColor]);

  const [flankTens, flankUnits] = useMemo(
    () => extractRoundTwoDigits(lastSettledRound ? settledCode : currentRoundCode),
    [lastSettledRound, settledCode, currentRoundCode]
  );

  const isTumblingWindow = !isPaused && remainingSec > 0 && remainingSec <= lockSeconds;

  const [isRolling, setIsRolling] = useState(false);
  const [enableTransition, setEnableTransition] = useState(false);
  const [stripIndexHero, setStripIndexHero] = useState(() => 30 + targetDigit);
  const [stripIndexLeft, setStripIndexLeft] = useState(() => 30 + flankTens);
  const [stripIndexRight, setStripIndexRight] = useState(() => 30 + flankUnits);

  const prevRollIdRef = useRef(rollSequenceId);
  const rollTimeoutRef = useRef<number | null>(null);
  const rafOneRef = useRef<number | null>(null);
  const rafTwoRef = useRef<number | null>(null);

  useEffect(() => {
    const cleanup = () => {
      if (rollTimeoutRef.current !== null) {
        window.clearTimeout(rollTimeoutRef.current);
        rollTimeoutRef.current = null;
      }
      if (rafOneRef.current !== null) {
        window.cancelAnimationFrame(rafOneRef.current);
        rafOneRef.current = null;
      }
      if (rafTwoRef.current !== null) {
        window.cancelAnimationFrame(rafTwoRef.current);
        rafTwoRef.current = null;
      }
    };

    if (rollSequenceId === prevRollIdRef.current) {
      setEnableTransition(false);
      setStripIndexHero(30 + targetDigit);
      setStripIndexLeft(30 + flankTens);
      setStripIndexRight(30 + flankUnits);
      return cleanup;
    }

    prevRollIdRef.current = rollSequenceId;
    cleanup();

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      setIsRolling(false);
      setEnableTransition(false);
      setStripIndexHero(30 + targetDigit);
      setStripIndexLeft(30 + flankTens);
      setStripIndexRight(30 + flankUnits);
      return cleanup;
    }

    setIsRolling(true);
    setEnableTransition(false);
    setStripIndexHero((targetDigit + 3) % 10);
    setStripIndexLeft((flankTens + 4) % 10);
    setStripIndexRight((flankUnits + 6) % 10);

    rafOneRef.current = window.requestAnimationFrame(() => {
      rafTwoRef.current = window.requestAnimationFrame(() => {
        setEnableTransition(true);
        setStripIndexHero(30 + targetDigit);
        setStripIndexLeft(30 + flankTens);
        setStripIndexRight(30 + flankUnits);
      });
    });

    rollTimeoutRef.current = window.setTimeout(() => {
      setIsRolling(false);
    }, ROLL_DURATION_MS + 140);

    return cleanup;
  }, [rollSequenceId, targetDigit, flankTens, flankUnits]);

  const drawState: 'idle' | 'tumbling' | 'rolling' | 'settled' = isRolling
    ? 'rolling'
    : isTumblingWindow
    ? 'tumbling'
    : lastSettledRound
    ? 'settled'
    : 'idle';

  const totalPool = Math.max(0, greenPoolTotal + redPoolTotal);
  const greenSharePct = totalPool > 0 ? Math.round((greenPoolTotal / totalPool) * 100) : 50;
  const redSharePct = totalPool > 0 ? 100 - greenSharePct : 50;

  const isGreenResult = winningColor === 'green';
  const parityLabel = getLotteryDigitParityLabel(targetDigit);

  return (
    <section
      data-testid="lottery-draw-stage"
      data-draw-state={drawState}
      data-winning-digit={String(targetDigit)}
      className="bg-slate-900 border border-slate-800 rounded-xl p-2 sm:p-3 space-y-1.5 sm:space-y-2 overflow-hidden"
    >
      {/* Compact Stage Top Bar */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <Disc3
            className={`w-3.5 h-3.5 shrink-0 ${
              isRolling
                ? 'text-amber-400 animate-spin'
                : isTumblingWindow
                ? 'text-red-400'
                : 'text-emerald-400'
            }`}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <h2 className="text-[11px] sm:text-xs font-extrabold text-white tracking-tight truncate">
              Live Number Draw Machine
            </h2>
            <p className="hidden sm:block text-[10px] font-mono text-slate-400 truncate">
              Odd (1,3,5,7,9) = Green · Even (0,2,4,6,8) = Red
            </p>
          </div>
        </div>

        <span
          data-testid="lottery-draw-phase-badge"
          className={`shrink-0 px-1.5 sm:px-2 py-0.5 rounded border text-[10px] font-mono font-bold tabular-nums ${
            isRolling
              ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
              : isTumblingWindow
              ? 'bg-red-500/15 border-red-500/50 text-red-300'
              : isPaused
              ? 'bg-amber-500/10 border-amber-500/40 text-amber-300'
              : 'bg-slate-950 border-slate-700 text-slate-200'
          }`}
        >
          {isRolling
            ? 'ROLLING...'
            : isTumblingWindow
            ? `LOCKED · ${formatLotteryCountdown(remainingSec)}`
            : isPaused
            ? 'PAUSED'
            : `LIVE · ${formatLotteryCountdown(remainingSec)}`}
        </span>
      </div>

      {/* Compact 3-Column Tumbler Chamber (Side-by-side Reel + Ball on Mobile) */}
      <div className="grid grid-cols-12 gap-1.5 sm:gap-2.5 items-center">
        {/* Left Compact Telemetry (Desktop only to keep mobile compact) */}
        <div className="hidden lg:grid lg:col-span-3 bg-slate-950 border border-slate-800 rounded-lg p-2.5 grid-cols-1 gap-y-1 font-mono tabular-nums text-[10px]">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Last Ball</span>
            <span className={`font-bold ${lastSettledRound ? (isGreenResult ? 'text-emerald-400' : 'text-red-400') : 'text-slate-400'}`}>
              {lastSettledRound ? `#${targetDigit} · ${winningColor.toUpperCase()}` : '--'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Color Payout</span>
            <span className="text-emerald-400 font-bold">{payoutMultiplier.toFixed(2)}x</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Lock</span>
            <span className="text-slate-200 flex items-center gap-1">
              <Lock className="w-2.5 h-2.5 text-slate-400" aria-hidden="true" />
              Final {lockSeconds}s
            </span>
          </div>
        </div>

        {/* Center Compact 3-Drum Physical Mechanical Reel */}
        <div className="col-span-7 sm:col-span-8 lg:col-span-6 flex justify-center">
          <div className="w-full max-w-[290px] bg-slate-950 border border-slate-700 rounded-xl px-2 sm:px-3 py-1.5 sm:py-2">
            <div className="hidden sm:flex items-center justify-between text-[9px] font-mono uppercase tracking-wider text-slate-400 mb-1 px-1">
              <span>TENS</span>
              <span className="text-amber-400 font-bold">DRAW DIGIT (0-9)</span>
              <span>UNIT</span>
            </div>

            <div className="flex items-center justify-center gap-1 sm:gap-2">
              <span
                aria-hidden="true"
                className={`text-amber-400 font-mono text-[10px] sm:text-xs select-none transition-transform duration-200 ${
                  isRolling ? 'translate-x-0.5' : ''
                }`}
              >
                ▸
              </span>

              {/* Flank Drum Left */}
              <div
                aria-hidden="true"
                className="relative w-[34px] sm:w-[42px] h-[46px] rounded-lg bg-slate-900 border border-slate-700 overflow-hidden select-none"
              >
                <div
                  className="will-change-transform"
                  style={{
                    transform: `translate3d(0, -${stripIndexLeft * FLANK_CELL_PX}px, 0)`,
                    transition: enableTransition
                      ? 'transform 1120ms cubic-bezier(0.10, 0.86, 0.22, 1)'
                      : 'none',
                  }}
                >
                  {DIGIT_STRIP.map((digit, idx) => (
                    <div
                      key={`l-${idx}`}
                      className="h-[46px] flex items-center justify-center font-mono text-base sm:text-lg font-bold text-slate-300 tabular-nums"
                    >
                      {digit}
                    </div>
                  ))}
                </div>
                <div className="pointer-events-none absolute inset-x-0 top-0 h-2.5 bg-gradient-to-b from-slate-950/85 to-transparent" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2.5 bg-gradient-to-t from-slate-950/85 to-transparent" />
              </div>

              {/* Primary Hero Drum */}
              <div
                data-testid="lottery-hero-reel"
                className={`relative w-[56px] sm:w-[68px] h-[58px] rounded-lg border-2 overflow-hidden select-none transition-colors duration-200 ${
                  isRolling
                    ? 'bg-slate-900 border-amber-400/80'
                    : isGreenResult
                    ? 'bg-emerald-950/40 border-emerald-500/70'
                    : 'bg-red-950/40 border-red-500/70'
                }`}
              >
                <div
                  className="will-change-transform"
                  style={{
                    transform: `translate3d(0, -${stripIndexHero * HERO_CELL_PX}px, 0)`,
                    transition: enableTransition
                      ? `transform ${ROLL_DURATION_MS}ms cubic-bezier(0.08, 0.88, 0.16, 1)`
                      : 'none',
                  }}
                >
                  {DIGIT_STRIP.map((digit, idx) => {
                    const odd = digit % 2 === 1;
                    return (
                      <div
                        key={`c-${idx}`}
                        className={`h-[58px] flex flex-col items-center justify-center font-mono tabular-nums ${
                          odd ? 'text-emerald-300' : 'text-red-300'
                        }`}
                      >
                        <span className="text-xl sm:text-3xl font-black leading-none">
                          {digit}
                        </span>
                        <span className="text-[7px] sm:text-[8px] font-bold tracking-wider uppercase opacity-80 mt-0.5">
                          {odd ? 'GREEN' : 'RED'}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="pointer-events-none absolute inset-x-0 top-0 h-3 bg-gradient-to-b from-slate-950/90 to-transparent" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3 bg-gradient-to-t from-slate-950/90 to-transparent" />
              </div>

              {/* Flank Drum Right */}
              <div
                aria-hidden="true"
                className="relative w-[34px] sm:w-[42px] h-[46px] rounded-lg bg-slate-900 border border-slate-700 overflow-hidden select-none"
              >
                <div
                  className="will-change-transform"
                  style={{
                    transform: `translate3d(0, -${stripIndexRight * FLANK_CELL_PX}px, 0)`,
                    transition: enableTransition
                      ? 'transform 1520ms cubic-bezier(0.10, 0.86, 0.20, 1)'
                      : 'none',
                  }}
                >
                  {DIGIT_STRIP.map((digit, idx) => (
                    <div
                      key={`r-${idx}`}
                      className="h-[46px] flex items-center justify-center font-mono text-base sm:text-lg font-bold text-slate-300 tabular-nums"
                    >
                      {digit}
                    </div>
                  ))}
                </div>
                <div className="pointer-events-none absolute inset-x-0 top-0 h-2.5 bg-gradient-to-b from-slate-950/85 to-transparent" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2.5 bg-gradient-to-t from-slate-950/85 to-transparent" />
              </div>

              <span
                aria-hidden="true"
                className={`text-amber-400 font-mono text-[10px] sm:text-xs select-none transition-transform duration-200 ${
                  isRolling ? '-translate-x-0.5' : ''
                }`}
              >
                ◂
              </span>
            </div>
          </div>
        </div>

        {/* Right Compact Drawn Ball Sphere Reveal */}
        <div className="col-span-5 sm:col-span-4 lg:col-span-3 bg-slate-950 border border-slate-800 rounded-lg p-2 sm:p-2.5 flex items-center gap-2">
          <div
            className="w-7 h-7 sm:w-9 sm:h-9 shrink-0 rounded-full flex items-center justify-center font-mono text-xs sm:text-base font-black text-white tabular-nums border border-white/25 transition-transform duration-300"
            style={{
              transform: isRolling ? 'scale(0.92)' : 'scale(1)',
              background: isRolling
                ? 'radial-gradient(circle at 32% 28%, #fbbf24, #b45309 62%, #451a03 100%)'
                : isGreenResult
                ? 'radial-gradient(circle at 32% 28%, #34d399, #059669 62%, #064e3b 100%)'
                : 'radial-gradient(circle at 32% 28%, #f87171, #dc2626 62%, #7f1d1d 100%)',
            }}
            aria-label={
              isRolling
                ? 'Rolling draw ball'
                : `Drawn number ${targetDigit}, ${winningColor}`
            }
          >
            {isRolling ? '?' : targetDigit}
          </div>

          <div className="min-w-0 leading-tight space-y-0.5">
            <div className="flex items-center gap-1 text-[8px] sm:text-[9px] font-mono uppercase text-slate-400">
              <Sparkles className="w-2.5 h-2.5 text-amber-400 shrink-0" aria-hidden="true" />
              <span className="truncate">{isRolling ? 'Spin' : 'Ball'}</span>
            </div>
            <div
              data-testid="lottery-draw-result-label"
              className={`text-[10px] sm:text-xs font-extrabold font-mono tabular-nums truncate ${
                isRolling
                  ? 'text-amber-300'
                  : isGreenResult
                  ? 'text-emerald-400'
                  : 'text-red-400'
              }`}
            >
              {isRolling ? 'DRAWING' : `${targetDigit} · ${parityLabel}`}
            </div>
            <p className="text-[9px] sm:text-[10px] font-mono text-slate-400 truncate">
              {lastSettledRound ? (isGreenResult ? 'Odd · Green' : 'Even · Red') : 'Pending'}
            </p>
          </div>
        </div>
      </div>

      {/* Compact Pool Split Momentum Bar */}
      <div className="bg-slate-950 border border-slate-800 rounded-lg px-2 sm:px-2.5 py-1 sm:py-1.5 space-y-1">
        <div className="flex items-center justify-between gap-1 text-[9px] sm:text-[10px] font-mono tabular-nums">
          <span className="text-emerald-400 font-bold">
            GREEN: ${greenPoolTotal.toFixed(0)} ({greenSharePct}%)
          </span>
          <span className="text-slate-400">Pool: ${totalPool.toFixed(0)}</span>
          <span className="text-red-400 font-bold">
            RED: ${redPoolTotal.toFixed(0)} ({redSharePct}%)
          </span>
        </div>
        <div className="h-1 sm:h-1.5 w-full rounded overflow-hidden bg-slate-900 flex">
          <div
            className="h-full bg-emerald-500 transition-[width] duration-300"
            style={{ width: `${greenSharePct}%` }}
          />
          <div
            className="h-full bg-red-500 transition-[width] duration-300"
            style={{ width: `${redSharePct}%` }}
          />
        </div>
      </div>
    </section>
  );
};
