import type {
  LotteryBetRecord,
  LotteryBetType,
  LotteryColor,
  LotteryDigitGameType,
  LotteryResultMode,
} from '../types';

export interface LotteryTradePreviewInput {
  stake: number;
  feePct: number;
  multiplier: number;
}

export interface LotteryTradePreview {
  stake: number;
  feePct: number;
  feeAmount: number;
  netStake: number;
  multiplier: number;
  grossPayoutOnWin: number;
  netProfitOnWin: number;
}

export interface ProjectedHouseProfit {
  totalPool: number;
  greenWinPayout: number;
  redWinPayout: number;
  profitIfGreenWins: number;
  profitIfRedWins: number;
}

export const DEFAULT_LOTTERY_FEE_PCT = 0.12;

export function roundCurrency2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(2));
}

export function roundCurrency4(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(4));
}

export function formatLotteryFeeUsd(feeAmount: number): string {
  if (!Number.isFinite(feeAmount) || feeAmount <= 0) return '0.00';
  if (Math.abs(feeAmount * 100 - Math.round(feeAmount * 100)) < 1e-6) {
    return feeAmount.toFixed(2);
  }
  return feeAmount.toFixed(4);
}

export function clampFeePct(feePct: number): number {
  if (!Number.isFinite(feePct)) return DEFAULT_LOTTERY_FEE_PCT;
  return Math.max(0, Math.min(50, roundCurrency2(feePct)));
}

export function clampMultiplier(multiplier: number): number {
  if (!Number.isFinite(multiplier)) return 2;
  return Math.max(1.05, Math.min(100000, roundCurrency2(multiplier)));
}

export function calculateLotteryTradePreview(
  input: LotteryTradePreviewInput
): LotteryTradePreview {
  const stake = Number.isFinite(input.stake) && input.stake > 0 ? roundCurrency2(input.stake) : 0;
  const feePct = clampFeePct(input.feePct);
  const multiplier = clampMultiplier(input.multiplier);

  const feeAmount = roundCurrency4(stake * (feePct / 100));
  const netStake = roundCurrency4(Math.max(0, stake - feeAmount));
  const grossPayoutOnWin = roundCurrency2(netStake * multiplier);
  const netProfitOnWin = roundCurrency2(grossPayoutOnWin - stake);

  return {
    stake,
    feePct,
    feeAmount,
    netStake,
    multiplier,
    grossPayoutOnWin,
    netProfitOnWin,
  };
}

export function isLotteryBettingLocked(params: {
  remainingSec: number;
  lockSeconds: number;
  isPaused: boolean;
}): boolean {
  if (params.isPaused) return true;
  if (!Number.isFinite(params.remainingSec)) return true;
  return params.remainingSec <= Math.max(0, params.lockSeconds);
}

export function getColorFromLotteryDigit(digit: number): LotteryColor {
  return Math.abs(Math.trunc(digit)) % 2 === 1 ? 'green' : 'red';
}

export function getActiveRoundColorSide(
  pendingBets: Array<Pick<LotteryBetRecord, 'betType' | 'color' | 'outcome'>>
): LotteryColor | null {
  const activeColorBet = pendingBets.find(
    (b) => b.outcome === 'PENDING' && b.betType === 'color'
  );
  return activeColorBet ? activeColorBet.color : null;
}

export function checkLotteryColorSideConflict(
  pendingBets: Array<Pick<LotteryBetRecord, 'betType' | 'color' | 'outcome'>>,
  candidateBetType: LotteryBetType,
  candidateColor: LotteryColor
): string | null {
  if (candidateBetType !== 'color') return null;
  const activeSide = getActiveRoundColorSide(pendingBets);
  if (activeSide && activeSide !== candidateColor) {
    return `Single-side rule: you already bet ${activeSide.toUpperCase()} in this round and cannot bet ${candidateColor.toUpperCase()}.`;
  }
  return null;
}

export function resolveLotteryRoundColor(params: {
  mode: LotteryResultMode;
  greenTotal: number;
  redTotal: number;
  forcedColor?: LotteryColor | null;
  forcedNumber?: number | null;
  rng?: number;
}): LotteryColor {
  if (
    params.mode === 'manual' &&
    typeof params.forcedNumber === 'number' &&
    Number.isInteger(params.forcedNumber) &&
    params.forcedNumber >= 0 &&
    params.forcedNumber <= 9
  ) {
    return getColorFromLotteryDigit(params.forcedNumber);
  }

  const randomRoll =
    typeof params.rng === 'number' && Number.isFinite(params.rng) ? params.rng : Math.random();

  if (params.mode === 'manual') {
    if (params.forcedColor === 'green' || params.forcedColor === 'red') {
      return params.forcedColor;
    }
    return randomRoll < 0.5 ? 'green' : 'red';
  }

  if (params.mode === 'auto_balance') {
    const green = Number.isFinite(params.greenTotal) ? params.greenTotal : 0;
    const red = Number.isFinite(params.redTotal) ? params.redTotal : 0;
    if (green > red) return 'red';
    if (red > green) return 'green';
    return randomRoll < 0.5 ? 'green' : 'red';
  }

  return randomRoll < 0.5 ? 'green' : 'red';
}

export function resolveLotteryRoundNumber(params: {
  roundCode: string;
  mode: LotteryResultMode;
  winningColor: LotteryColor;
  forcedNumber?: number | null;
  numberPayoutExposure?: Record<number, number>;
  rng?: number;
}): number {
  if (
    params.mode === 'manual' &&
    typeof params.forcedNumber === 'number' &&
    Number.isInteger(params.forcedNumber) &&
    params.forcedNumber >= 0 &&
    params.forcedNumber <= 9
  ) {
    return params.forcedNumber;
  }

  const candidates = params.winningColor === 'green' ? [1, 3, 5, 7, 9] : [0, 2, 4, 6, 8];

  if (params.mode === 'auto_balance' && params.numberPayoutExposure) {
    let minExposure = Infinity;
    let lowestCandidates: number[] = [];
    for (const digit of candidates) {
      const exp = Number(params.numberPayoutExposure[digit] ?? 0);
      if (exp < minExposure) {
        minExposure = exp;
        lowestCandidates = [digit];
      } else if (exp === minExposure) {
        lowestCandidates.push(digit);
      }
    }
    if (lowestCandidates.length === 1) {
      return lowestCandidates[0];
    }
    if (lowestCandidates.length > 1 && lowestCandidates.length < candidates.length) {
      const idx =
        typeof params.rng === 'number' && Number.isFinite(params.rng)
          ? Math.min(lowestCandidates.length - 1, Math.floor(Math.max(0, params.rng) * lowestCandidates.length))
          : Math.floor(Math.random() * lowestCandidates.length);
      return lowestCandidates[idx];
    }
  }

  if (typeof params.rng === 'number' && Number.isFinite(params.rng)) {
    const idx = Math.min(candidates.length - 1, Math.floor(Math.max(0, params.rng) * candidates.length));
    return candidates[idx];
  }

  return deriveLotteryDrawNumber(params.roundCode, params.winningColor);
}

export function calculateProjectedHouseProfit(params: {
  greenTotal: number;
  redTotal: number;
  feePct: number;
  multiplier: number;
}): ProjectedHouseProfit {
  const green = Number.isFinite(params.greenTotal) && params.greenTotal > 0 ? params.greenTotal : 0;
  const red = Number.isFinite(params.redTotal) && params.redTotal > 0 ? params.redTotal : 0;
  const feePct = clampFeePct(params.feePct);
  const multiplier = clampMultiplier(params.multiplier);

  const totalPool = roundCurrency2(green + red);
  const netFactor = (1 - feePct / 100) * multiplier;
  const greenWinPayout = roundCurrency2(green * netFactor);
  const redWinPayout = roundCurrency2(red * netFactor);

  return {
    totalPool,
    greenWinPayout,
    redWinPayout,
    profitIfGreenWins: roundCurrency2(totalPool - greenWinPayout),
    profitIfRedWins: roundCurrency2(totalPool - redWinPayout),
  };
}

export function settleLotteryBet(
  bet: {
    betType?: LotteryBetType;
    color: LotteryColor;
    pickedNumber?: number | null;
    stake: number;
    potentialPayout: number;
  },
  winningColor: LotteryColor,
  winningNumber?: number | null
): {
  outcome: 'WIN' | 'LOSS';
  payoutAmount: number;
  netProfit: number;
} {
  const isWin =
    bet.betType === 'number' && typeof bet.pickedNumber === 'number'
      ? typeof winningNumber === 'number' && bet.pickedNumber === winningNumber
      : bet.color === winningColor;

  if (isWin) {
    const payoutAmount = roundCurrency2(bet.potentialPayout);
    return {
      outcome: 'WIN',
      payoutAmount,
      netProfit: roundCurrency2(payoutAmount - bet.stake),
    };
  }
  return {
    outcome: 'LOSS',
    payoutAmount: 0,
    netProfit: roundCurrency2(-bet.stake),
  };
}

export function formatLotteryCountdown(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const hrs = Math.floor(clamped / 3600);
  const mins = Math.floor((clamped % 3600) / 60);
  const secs = clamped % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

const GREEN_ODD_DIGITS = [1, 3, 5, 7, 9] as const;
const RED_EVEN_DIGITS = [0, 2, 4, 6, 8] as const;

export function deriveLotteryDrawNumber(roundCode: string, winningColor: LotteryColor): number {
  let hash = 2166136261;
  const input = `${roundCode}:${winningColor}`;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const idx = (hash >>> 0) % 5;
  return winningColor === 'green' ? GREEN_ODD_DIGITS[idx] : RED_EVEN_DIGITS[idx];
}

export function getLotteryDigitParityLabel(digit: number): 'ODD · GREEN' | 'EVEN · RED' {
  return Math.abs(Math.trunc(digit)) % 2 === 1 ? 'ODD · GREEN' : 'EVEN · RED';
}

export function getDigitGameLength(gameType: LotteryDigitGameType): number {
  if (gameType === '2D') return 2;
  if (gameType === '3D') return 3;
  return 6;
}

export function normalizeDigitTicketNumber(
  raw: string,
  gameType: LotteryDigitGameType
): string | null {
  const cleaned = raw.trim();
  const len = getDigitGameLength(gameType);
  if (!/^\d+$/.test(cleaned)) return null;
  if (cleaned.length !== len) return null;
  return cleaned;
}

export function generateRandomDigitTicket(
  gameType: LotteryDigitGameType,
  rng?: number
): string {
  const len = getDigitGameLength(gameType);
  const max = Math.pow(10, len);
  const val =
    typeof rng === 'number' && Number.isFinite(rng)
      ? Math.min(max - 1, Math.floor(Math.max(0, rng) * max))
      : Math.floor(Math.random() * max);
  return String(val).padStart(len, '0');
}

export function settleDigitLotteryBet(
  bet: { pickedNumber: string; stake: number; potentialPayout: number },
  winningNumber: string
): {
  outcome: 'WIN' | 'LOSS';
  payoutAmount: number;
  netProfit: number;
} {
  if (bet.pickedNumber === winningNumber) {
    const payoutAmount = roundCurrency2(bet.potentialPayout);
    return {
      outcome: 'WIN',
      payoutAmount,
      netProfit: roundCurrency2(payoutAmount - bet.stake),
    };
  }
  return {
    outcome: 'LOSS',
    payoutAmount: 0,
    netProfit: roundCurrency2(-bet.stake),
  };
}


