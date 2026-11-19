import { doc, getDoc, setDoc } from 'firebase/firestore';
import {
  buildLotteryRoundCode,
  createInitialLotteryStorageState,
  defaultDigitMultiplierForGame,
  defaultDigitOffsetMsForGame,
  type LotteryStorageState,
  type StoredDigitDraw,
  type StoredLotteryRound,
} from '../data/defaults';
import type {
  AccountMode,
  DigitLotteryBetRecord,
  DigitLotteryDrawSummary,
  LotteryBetRecord,
  LotteryBetType,
  LotteryColor,
  LotteryConfig,
  LotteryDigitGameType,
  LotteryLiveState,
  LotteryResultMode,
  LotteryRoundSummary,
} from '../types';
import {
  DEFAULT_LOTTERY_FEE_PCT,
  calculateLotteryTradePreview,
  checkLotteryColorSideConflict,
  clampFeePct,
  clampMultiplier,
  deriveLotteryDrawNumber,
  generateRandomDigitTicket,
  getColorFromLotteryDigit,
  isLotteryBettingLocked,
  normalizeDigitTicketNumber,
  resolveLotteryRoundColor,
  resolveLotteryRoundNumber,
  roundCurrency2,
  roundCurrency4,
  settleDigitLotteryBet,
  settleLotteryBet,
} from '../utils/lotteryEngine';
import { db, isFirebaseConfigured } from './firebaseClient';
import { randomHexId, readStorageJson, writeStorageJson } from './storageHelper';

const LOTTERY_STORAGE_KEY = 'zectrade_lottery_state_v1';

function buildDigitDrawUid(gameType: LotteryDigitGameType, nowMs = Date.now()): string {
  const dt = new Date(nowMs);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${gameType}-${y}${m}${d}-${randomHexId(2)}`;
}

function normalizeMode(val: string | null | undefined): LotteryResultMode {
  if (val === 'manual' || val === 'random') return val;
  return 'auto_balance';
}

function normalizeColor(val: string | null | undefined): LotteryColor | null {
  if (val === 'green' || val === 'red') return val;
  return null;
}

function normalizeForcedNumber(val: number | null | undefined): number | null {
  if (typeof val === 'number' && Number.isInteger(val) && val >= 0 && val <= 9) {
    return val;
  }
  return null;
}

function normalizeDigitGameType(val: string | null | undefined): LotteryDigitGameType {
  if (val === '3D') return '3D';
  if (val === '6D') return '6D';
  return '2D';
}

function readOrSeedLotteryStorage(nowMs = Date.now()): LotteryStorageState {
  const saved = readStorageJson<LotteryStorageState>(LOTTERY_STORAGE_KEY);
  if (
    saved &&
    saved.config &&
    Array.isArray(saved.rounds) &&
    saved.rounds.length > 0 &&
    Array.isArray(saved.digitDraws)
  ) {
    return {
      config: {
        roundDurationSec: Math.max(15, Math.min(600, Math.round(saved.config.roundDurationSec || 60))),
        lockSeconds: Math.max(1, Math.min(15, Math.round(saved.config.lockSeconds || 5))),
        feePct: clampFeePct(saved.config.feePct ?? DEFAULT_LOTTERY_FEE_PCT),
        payoutMultiplier: clampMultiplier(saved.config.payoutMultiplier ?? 2),
        numberMultiplier: clampMultiplier(saved.config.numberMultiplier ?? 9),
        resultMode: normalizeMode(saved.config.resultMode),
        forcedResult: normalizeColor(saved.config.forcedResult),
        forcedNumber: normalizeForcedNumber(saved.config.forcedNumber),
        isPaused: Boolean(saved.config.isPaused),
        accumulatedProfit: roundCurrency2(saved.config.accumulatedProfit ?? 0),
      },
      rounds: saved.rounds,
      bets: Array.isArray(saved.bets) ? saved.bets : [],
      digitDraws: saved.digitDraws,
      digitBets: Array.isArray(saved.digitBets) ? saved.digitBets : [],
      updatedAtMs: Number(saved.updatedAtMs ?? nowMs),
    };
  }
  const initial = createInitialLotteryStorageState(nowMs);
  writeStorageJson(LOTTERY_STORAGE_KEY, initial);
  return initial;
}

function persistLotteryStorage(state: LotteryStorageState, nowMs = Date.now()): LotteryStorageState {
  const next: LotteryStorageState = {
    ...state,
    rounds: state.rounds.slice(-40),
    bets: state.bets.slice(0, 200),
    digitDraws: state.digitDraws.slice(-40),
    digitBets: state.digitBets.slice(0, 200),
    updatedAtMs: nowMs,
  };
  writeStorageJson(LOTTERY_STORAGE_KEY, next);
  return next;
}

async function mirrorLotteryToFirestore(state: LotteryStorageState): Promise<void> {
  if (!isFirebaseConfigured || !db) return;
  try {
    await setDoc(doc(db, 'lotteryEngine', 'state'), state);
  } catch {
    // Graceful localStorage fallback when offline or blocked by Firestore rules
  }
}

function ensureOpenRound(state: LotteryStorageState, nowMs: number): { state: LotteryStorageState; mutated: boolean } {
  const hasOpen = state.rounds.some((r) => r.status === 'OPEN');
  if (hasOpen) return { state, mutated: false };
  const maxNum = state.rounds.reduce((acc, r) => Math.max(acc, r.roundNumber), 0);
  const nextNum = maxNum + 1;
  const durationMs = state.config.roundDurationSec * 1000;
  const nextRound: StoredLotteryRound = {
    roundNumber: nextNum,
    roundCode: buildLotteryRoundCode(nextNum, nowMs),
    durationSec: state.config.roundDurationSec,
    startedAtMs: nowMs,
    endsAtMs: nowMs + durationMs,
    pausedRemainingMs: state.config.isPaused ? durationMs : null,
    status: 'OPEN',
    resultMode: state.config.resultMode,
    forcedResult: state.config.forcedResult,
    forcedNumber: state.config.forcedNumber,
    winningColor: null,
    winningNumber: null,
    greenTotal: 0,
    redTotal: 0,
    greenCount: 0,
    redCount: 0,
    totalFees: 0,
    totalPayouts: 0,
    houseProfit: 0,
    settledAtMs: null,
  };
  return {
    state: { ...state, rounds: [...state.rounds, nextRound] },
    mutated: true,
  };
}

function ensureDigitDraws(state: LotteryStorageState, nowMs: number): { state: LotteryStorageState; mutated: boolean } {
  const games: LotteryDigitGameType[] = ['2D', '3D', '6D'];
  let nextDraws = [...state.digitDraws];
  let mutated = false;

  for (const gameType of games) {
    const hasScheduled = nextDraws.some((d) => d.gameType === gameType && d.status === 'SCHEDULED');
    if (!hasScheduled) {
      nextDraws.push({
        drawUid: buildDigitDrawUid(gameType, nowMs),
        gameType,
        drawLabel: `${gameType} Scheduled Official Draw`,
        scheduledReleaseAtMs: nowMs + defaultDigitOffsetMsForGame(gameType),
        lockBeforeSec: 10,
        payoutMultiplier: defaultDigitMultiplierForGame(gameType),
        feePct: DEFAULT_LOTTERY_FEE_PCT,
        manualResult: null,
        winningNumber: null,
        status: 'SCHEDULED',
        totalStake: 0,
        totalPayouts: 0,
        betCount: 0,
        releasedAtMs: null,
      });
      mutated = true;
    }

    const hasReleased = nextDraws.some((d) => d.gameType === gameType && d.status === 'RELEASED');
    if (!hasReleased) {
      const pastMs = nowMs - 15 * 60_000;
      const sampleResult = gameType === '2D' ? '48' : gameType === '3D' ? '729' : '482915';
      nextDraws.push({
        drawUid: buildDigitDrawUid(gameType, pastMs),
        gameType,
        drawLabel: `${gameType} Previous Draw`,
        scheduledReleaseAtMs: pastMs,
        lockBeforeSec: 10,
        payoutMultiplier: defaultDigitMultiplierForGame(gameType),
        feePct: DEFAULT_LOTTERY_FEE_PCT,
        manualResult: sampleResult,
        winningNumber: sampleResult,
        status: 'RELEASED',
        totalStake: 0,
        totalPayouts: 0,
        betCount: 0,
        releasedAtMs: pastMs,
      });
      mutated = true;
    }
  }

  return mutated ? { state: { ...state, digitDraws: nextDraws }, mutated: true } : { state, mutated: false };
}

function settleOpenRoundInState(
  state: LotteryStorageState,
  nowMs: number
): LotteryStorageState {
  const openIdx = state.rounds.findIndex((r) => r.status === 'OPEN');
  if (openIdx < 0) return state;

  const openRound = state.rounds[openIdx];
  const cfg = state.config;
  const mode = normalizeMode(openRound.resultMode || cfg.resultMode);
  const forced = normalizeColor(openRound.forcedResult ?? cfg.forcedResult);
  const forcedNum = normalizeForcedNumber(openRound.forcedNumber ?? cfg.forcedNumber);

  const roundBets = state.bets.filter((b) => b.roundCode === openRound.roundCode);
  const numberPayoutExposure: Record<number, number> = {};
  for (const bet of roundBets) {
    if (bet.betType === 'number' && typeof bet.pickedNumber === 'number') {
      numberPayoutExposure[bet.pickedNumber] = roundCurrency2(
        (numberPayoutExposure[bet.pickedNumber] ?? 0) + bet.potentialPayout
      );
    }
  }

  const winningColor = resolveLotteryRoundColor({
    mode,
    greenTotal: openRound.greenTotal,
    redTotal: openRound.redTotal,
    forcedColor: forced,
    forcedNumber: forcedNum,
  });

  const winningNumber = resolveLotteryRoundNumber({
    roundCode: openRound.roundCode,
    mode,
    winningColor,
    forcedNumber: forcedNum,
    numberPayoutExposure,
  });

  let totalFees = 0;
  let totalStakes = 0;
  let totalPayouts = 0;

  const settledBets = state.bets.map((bet) => {
    if (bet.roundCode !== openRound.roundCode) return bet;
    totalFees = roundCurrency4(totalFees + bet.feeAmount);
    totalStakes = roundCurrency2(totalStakes + bet.stake);
    const settlement = settleLotteryBet(
      {
        betType: bet.betType === 'number' ? 'number' : 'color',
        color: bet.color === 'red' ? 'red' : 'green',
        pickedNumber: bet.pickedNumber,
        stake: bet.stake,
        potentialPayout: bet.potentialPayout,
      },
      winningColor,
      winningNumber
    );
    totalPayouts = roundCurrency2(totalPayouts + settlement.payoutAmount);
    return {
      ...bet,
      outcome: settlement.outcome,
      payoutAmount: settlement.payoutAmount,
      netProfit: settlement.netProfit,
      settledAtMs: nowMs,
    };
  });

  const houseProfit = roundCurrency2(totalStakes - totalPayouts);
  const settledRound: StoredLotteryRound = {
    ...openRound,
    status: 'SETTLED',
    winningColor,
    winningNumber,
    resultMode: mode,
    forcedResult: forced,
    forcedNumber: forcedNum,
    totalFees,
    totalPayouts,
    houseProfit,
    settledAtMs: nowMs,
  };

  const nextNum = openRound.roundNumber + 1;
  const durationMs = cfg.roundDurationSec * 1000;
  const nextRound: StoredLotteryRound = {
    roundNumber: nextNum,
    roundCode: buildLotteryRoundCode(nextNum, nowMs),
    durationSec: cfg.roundDurationSec,
    startedAtMs: nowMs,
    endsAtMs: nowMs + durationMs,
    pausedRemainingMs: cfg.isPaused ? durationMs : null,
    status: 'OPEN',
    resultMode: cfg.resultMode,
    forcedResult: null,
    forcedNumber: null,
    winningColor: null,
    winningNumber: null,
    greenTotal: 0,
    redTotal: 0,
    greenCount: 0,
    redCount: 0,
    totalFees: 0,
    totalPayouts: 0,
    houseProfit: 0,
    settledAtMs: null,
  };

  const nextRounds = [...state.rounds];
  nextRounds[openIdx] = settledRound;
  nextRounds.push(nextRound);

  return {
    ...state,
    config: {
      ...cfg,
      accumulatedProfit: roundCurrency2(cfg.accumulatedProfit + houseProfit),
      forcedResult: null,
      forcedNumber: null,
    },
    rounds: nextRounds,
    bets: settledBets,
  };
}

function releaseDigitDrawInState(
  state: LotteryStorageState,
  drawUid: string,
  nowMs: number
): LotteryStorageState {
  const drawIdx = state.digitDraws.findIndex((d) => d.drawUid === drawUid);
  if (drawIdx < 0) return state;
  const draw = state.digitDraws[drawIdx];
  const gameType = normalizeDigitGameType(draw.gameType);
  const validManual =
    draw.manualResult && normalizeDigitTicketNumber(draw.manualResult, gameType)
      ? draw.manualResult
      : null;
  const winningNumber = validManual ?? generateRandomDigitTicket(gameType);

  let totalPayouts = 0;
  const nextDigitBets = state.digitBets.map((bet) => {
    if (bet.drawUid !== draw.drawUid) return bet;
    const settlement = settleDigitLotteryBet(
      {
        pickedNumber: bet.pickedNumber,
        stake: bet.stake,
        potentialPayout: bet.potentialPayout,
      },
      winningNumber
    );
    totalPayouts = roundCurrency2(totalPayouts + settlement.payoutAmount);
    return {
      ...bet,
      outcome: settlement.outcome,
      payoutAmount: settlement.payoutAmount,
      netProfit: settlement.netProfit,
      settledAtMs: nowMs,
    };
  });

  const releasedDraw: StoredDigitDraw = {
    ...draw,
    status: 'RELEASED',
    winningNumber,
    totalPayouts,
    releasedAtMs: nowMs,
  };

  const nextDraws = [...state.digitDraws];
  nextDraws[drawIdx] = releasedDraw;

  const hasRemainingScheduled = nextDraws.some(
    (d) => d.gameType === gameType && d.status === 'SCHEDULED'
  );
  if (!hasRemainingScheduled) {
    nextDraws.push({
      drawUid: buildDigitDrawUid(gameType, nowMs + 1000),
      gameType,
      drawLabel: `${gameType} Scheduled Official Draw`,
      scheduledReleaseAtMs: nowMs + defaultDigitOffsetMsForGame(gameType),
      lockBeforeSec: draw.lockBeforeSec,
      payoutMultiplier: draw.payoutMultiplier,
      feePct: draw.feePct,
      manualResult: null,
      winningNumber: null,
      status: 'SCHEDULED',
      totalStake: 0,
      totalPayouts: 0,
      betCount: 0,
      releasedAtMs: null,
    });
  }

  return {
    ...state,
    digitDraws: nextDraws,
    digitBets: nextDigitBets,
  };
}

function tickStorageState(
  rawState: LotteryStorageState,
  nowMs = Date.now()
): { state: LotteryStorageState; mutated: boolean } {
  let current = rawState;
  let mutated = false;

  const openRes = ensureOpenRound(current, nowMs);
  current = openRes.state;
  mutated = mutated || openRes.mutated;

  const openRound = current.rounds.find((r) => r.status === 'OPEN');
  if (openRound && !current.config.isPaused && nowMs >= openRound.endsAtMs) {
    current = settleOpenRoundInState(current, nowMs);
    mutated = true;
  }

  const digitRes = ensureDigitDraws(current, nowMs);
  current = digitRes.state;
  mutated = mutated || digitRes.mutated;

  const dueDraws = current.digitDraws.filter(
    (d) => d.status === 'SCHEDULED' && nowMs >= d.scheduledReleaseAtMs
  );
  for (const due of dueDraws) {
    current = releaseDigitDrawInState(current, due.drawUid, nowMs);
    mutated = true;
  }

  return { state: current, mutated };
}

function toConfigDto(cfg: LotteryConfig, isAdmin: boolean): LotteryConfig {
  return {
    roundDurationSec: Math.max(15, Math.min(600, Math.round(cfg.roundDurationSec))),
    lockSeconds: Math.max(1, Math.min(15, Math.round(cfg.lockSeconds))),
    feePct: clampFeePct(cfg.feePct),
    payoutMultiplier: clampMultiplier(cfg.payoutMultiplier),
    numberMultiplier: clampMultiplier(cfg.numberMultiplier ?? 9),
    resultMode: isAdmin ? normalizeMode(cfg.resultMode) : 'auto_balance',
    forcedResult: isAdmin ? normalizeColor(cfg.forcedResult) : null,
    forcedNumber: isAdmin ? normalizeForcedNumber(cfg.forcedNumber) : null,
    isPaused: Boolean(cfg.isPaused),
    accumulatedProfit: isAdmin ? roundCurrency2(cfg.accumulatedProfit) : 0,
  };
}

function toRoundDto(
  row: StoredLotteryRound,
  cfg: LotteryConfig,
  isAdmin: boolean,
  nowMs: number
): LotteryRoundSummary {
  const remainingMs =
    row.status === 'SETTLED'
      ? 0
      : cfg.isPaused
      ? Math.max(0, Number(row.pausedRemainingMs ?? Math.max(0, row.endsAtMs - nowMs)))
      : Math.max(0, row.endsAtMs - nowMs);
  const remainingSec = row.status === 'SETTLED' ? 0 : Math.ceil(remainingMs / 1000);
  const isLocked =
    row.status === 'SETTLED' ||
    isLotteryBettingLocked({
      remainingSec,
      lockSeconds: cfg.lockSeconds,
      isPaused: cfg.isPaused,
    });

  const winningColor = normalizeColor(row.winningColor);
  const winningNumber =
    typeof row.winningNumber === 'number'
      ? row.winningNumber
      : winningColor
      ? deriveLotteryDrawNumber(row.roundCode, winningColor)
      : null;

  return {
    roundCode: row.roundCode,
    roundNumber: row.roundNumber,
    durationSec: row.durationSec,
    startedAtMs: row.startedAtMs,
    endsAtMs: row.endsAtMs,
    remainingSec,
    isLocked,
    isPaused: row.status === 'OPEN' && cfg.isPaused,
    status: row.status === 'SETTLED' ? 'SETTLED' : 'OPEN',
    resultMode: isAdmin ? normalizeMode(row.resultMode) : 'auto_balance',
    forcedResult: isAdmin ? normalizeColor(row.forcedResult) : null,
    forcedNumber: isAdmin ? normalizeForcedNumber(row.forcedNumber) : null,
    winningColor,
    winningNumber,
    greenTotal: roundCurrency2(row.greenTotal),
    redTotal: roundCurrency2(row.redTotal),
    greenCount: row.greenCount,
    redCount: row.redCount,
    totalFees: isAdmin ? roundCurrency2(row.totalFees) : 0,
    totalPayouts: isAdmin ? roundCurrency2(row.totalPayouts) : 0,
    houseProfit: isAdmin ? roundCurrency2(row.houseProfit) : 0,
    settledAtMs: row.settledAtMs ?? null,
  };
}

function toDigitDrawDto(
  row: StoredDigitDraw,
  isAdmin: boolean,
  nowMs: number
): DigitLotteryDrawSummary {
  const remainingMs =
    row.status === 'RELEASED' ? 0 : Math.max(0, row.scheduledReleaseAtMs - nowMs);
  const remainingSec = row.status === 'RELEASED' ? 0 : Math.ceil(remainingMs / 1000);
  const isLocked =
    row.status === 'RELEASED' || remainingSec <= Math.max(0, row.lockBeforeSec);

  return {
    drawUid: row.drawUid,
    gameType: normalizeDigitGameType(row.gameType),
    drawLabel: row.drawLabel,
    scheduledReleaseAtMs: row.scheduledReleaseAtMs,
    remainingSec,
    isLocked,
    lockBeforeSec: row.lockBeforeSec,
    payoutMultiplier: clampMultiplier(row.payoutMultiplier),
    feePct: clampFeePct(row.feePct),
    manualResult: isAdmin ? row.manualResult ?? null : null,
    winningNumber: row.winningNumber ?? null,
    status: row.status === 'RELEASED' ? 'RELEASED' : 'SCHEDULED',
    totalStake: roundCurrency2(row.totalStake),
    totalPayouts: isAdmin ? roundCurrency2(row.totalPayouts) : 0,
    betCount: row.betCount,
    releasedAtMs: row.releasedAtMs ?? null,
  };
}

function buildLiveStateDto(
  state: LotteryStorageState,
  userUid?: string,
  isAdmin = false,
  nowMs = Date.now()
): LotteryLiveState {
  const cfgDto = toConfigDto(state.config, isAdmin);
  const openRound =
    state.rounds.find((r) => r.status === 'OPEN') ?? state.rounds[state.rounds.length - 1];
  const currentRound = toRoundDto(openRound, cfgDto, isAdmin, nowMs);

  const settledRounds = state.rounds
    .filter((r) => r.status === 'SETTLED')
    .sort((a, b) => b.roundNumber - a.roundNumber)
    .slice(0, 24);

  const userBets = userUid
    ? state.bets
        .filter((b) => b.userUid === userUid)
        .sort((a, b) => b.createdAtMs - a.createdAtMs)
        .slice(0, 50)
    : [];

  const scheduledDigitDraws = state.digitDraws
    .filter((d) => d.status === 'SCHEDULED')
    .sort((a, b) => a.scheduledReleaseAtMs - b.scheduledReleaseAtMs);

  const releasedDigitDraws = state.digitDraws
    .filter((d) => d.status === 'RELEASED')
    .sort((a, b) => (b.releasedAtMs ?? 0) - (a.releasedAtMs ?? 0))
    .slice(0, 24);

  const userDigitBets = userUid
    ? state.digitBets
        .filter((b) => b.userUid === userUid)
        .sort((a, b) => b.createdAtMs - a.createdAtMs)
        .slice(0, 50)
    : [];

  return {
    serverTimeMs: nowMs,
    config: cfgDto,
    currentRound,
    historyStrip: settledRounds.map((r) => toRoundDto(r, cfgDto, isAdmin, nowMs)),
    userBets,
    digitDraws: scheduledDigitDraws.map((d) => toDigitDrawDto(d, isAdmin, nowMs)),
    digitHistory: releasedDigitDraws.map((d) => toDigitDrawDto(d, isAdmin, nowMs)),
    userDigitBets,
  };
}

export function getInitialLotteryLiveState(
  userUid?: string,
  isAdmin = false,
  nowMs = Date.now()
): LotteryLiveState {
  const raw = readOrSeedLotteryStorage(nowMs);
  const { state, mutated } = tickStorageState(raw, nowMs);
  const finalState = mutated ? persistLotteryStorage(state, nowMs) : state;
  return buildLiveStateDto(finalState, userUid, isAdmin, nowMs);
}

export async function tickAndGetLotteryStateStatic(
  userUid?: string,
  isAdmin = false
): Promise<LotteryLiveState> {
  const nowMs = Date.now();
  let state = readOrSeedLotteryStorage(nowMs);

  if (isFirebaseConfigured && db) {
    try {
      const snap = await getDoc(doc(db, 'lotteryEngine', 'state'));
      if (snap.exists()) {
        const remote = snap.data() as LotteryStorageState;
        if (
          remote &&
          remote.config &&
          Array.isArray(remote.rounds) &&
          remote.rounds.length > 0 &&
          Array.isArray(remote.digitDraws) &&
          Number(remote.updatedAtMs ?? 0) > Number(state.updatedAtMs ?? 0)
        ) {
          state = remote;
          writeStorageJson(LOTTERY_STORAGE_KEY, state);
        }
      }
    } catch {
      // Offline / rule fallback — keep local state cleanly
    }
  }

  const ticked = tickStorageState(state, nowMs);
  const finalState = ticked.mutated ? persistLotteryStorage(ticked.state, nowMs) : ticked.state;
  if (ticked.mutated) {
    await mirrorLotteryToFirestore(finalState);
  }
  return buildLiveStateDto(finalState, userUid, isAdmin, nowMs);
}

export async function placeLotteryBetStatic(params: {
  userUid: string;
  userEmail: string;
  accountMode: AccountMode;
  betType?: LotteryBetType;
  color?: LotteryColor;
  pickedNumber?: number | null;
  stake: number;
  isAdmin?: boolean;
}): Promise<{ bet: LotteryBetRecord; state: LotteryLiveState }> {
  const nowMs = Date.now();
  const base = tickStorageState(readOrSeedLotteryStorage(nowMs), nowMs).state;
  const openIdx = base.rounds.findIndex((r) => r.status === 'OPEN');
  const openRound = base.rounds[openIdx];
  const cfgDto = toConfigDto(base.config, true);
  const roundDto = toRoundDto(openRound, cfgDto, true, nowMs);

  if (cfgDto.isPaused) {
    throw new Error('Betting is currently paused. Please wait for the next round.');
  }
  if (roundDto.isLocked) {
    throw new Error('Betting is locked for the final 5 seconds of this round.');
  }

  const stake = roundCurrency2(params.stake);
  if (!Number.isFinite(stake) || stake < 1) {
    throw new Error('Minimum trade stake is $1.00.');
  }

  const betType: LotteryBetType = params.betType === 'number' ? 'number' : 'color';
  let resolvedColor: LotteryColor;
  let pickedNumber: number | null = null;
  let effectiveMultiplier = cfgDto.payoutMultiplier;

  if (betType === 'number') {
    const num = Number(params.pickedNumber);
    if (!Number.isInteger(num) || num < 0 || num > 9) {
      throw new Error('Please choose a valid number between 0 and 9.');
    }
    pickedNumber = num;
    resolvedColor = getColorFromLotteryDigit(num);
    effectiveMultiplier = cfgDto.numberMultiplier;
  } else {
    if (params.color !== 'green' && params.color !== 'red') {
      throw new Error('Valid prediction color (green or red) is required.');
    }
    resolvedColor = params.color;
  }

  const existingUserBetsInRound = base.bets.filter(
    (b) => b.roundCode === openRound.roundCode && b.userUid === params.userUid
  );
  const conflictErr = checkLotteryColorSideConflict(
    existingUserBetsInRound,
    betType,
    resolvedColor
  );
  if (conflictErr) {
    throw new Error(conflictErr);
  }

  const preview = calculateLotteryTradePreview({
    stake,
    feePct: cfgDto.feePct,
    multiplier: effectiveMultiplier,
  });

  const newBet: LotteryBetRecord = {
    id: `LOT-${randomHexId(5)}`,
    roundCode: openRound.roundCode,
    userUid: params.userUid,
    userEmail: params.userEmail.toLowerCase(),
    accountMode: params.accountMode === 'real' ? 'real' : 'demo',
    betType,
    color: resolvedColor,
    pickedNumber,
    stake: preview.stake,
    feePct: preview.feePct,
    feeAmount: preview.feeAmount,
    netStake: preview.netStake,
    multiplier: preview.multiplier,
    potentialPayout: preview.grossPayoutOnWin,
    outcome: 'PENDING',
    payoutAmount: 0,
    netProfit: 0,
    createdAtMs: nowMs,
    settledAtMs: null,
  };

  const updatedRound: StoredLotteryRound = {
    ...openRound,
    greenTotal:
      betType === 'color' && resolvedColor === 'green'
        ? roundCurrency2(openRound.greenTotal + preview.stake)
        : openRound.greenTotal,
    redTotal:
      betType === 'color' && resolvedColor === 'red'
        ? roundCurrency2(openRound.redTotal + preview.stake)
        : openRound.redTotal,
    greenCount:
      betType === 'color' && resolvedColor === 'green'
        ? openRound.greenCount + 1
        : openRound.greenCount,
    redCount:
      betType === 'color' && resolvedColor === 'red'
        ? openRound.redCount + 1
        : openRound.redCount,
  };

  const nextRounds = [...base.rounds];
  nextRounds[openIdx] = updatedRound;

  const saved = persistLotteryStorage(
    {
      ...base,
      rounds: nextRounds,
      bets: [newBet, ...base.bets],
    },
    nowMs
  );
  await mirrorLotteryToFirestore(saved);

  return {
    bet: newBet,
    state: buildLiveStateDto(saved, params.userUid, Boolean(params.isAdmin), nowMs),
  };
}

export async function placeDigitLotteryBetStatic(params: {
  userUid: string;
  userEmail: string;
  accountMode: AccountMode;
  drawUid: string;
  pickedNumber: string;
  stake: number;
  isAdmin?: boolean;
}): Promise<{ bet: DigitLotteryBetRecord; state: LotteryLiveState }> {
  const nowMs = Date.now();
  const base = tickStorageState(readOrSeedLotteryStorage(nowMs), nowMs).state;
  const drawIdx = base.digitDraws.findIndex((d) => d.drawUid === params.drawUid);
  if (drawIdx < 0) {
    throw new Error('Scheduled draw not found.');
  }
  const draw = base.digitDraws[drawIdx];
  if (draw.status !== 'SCHEDULED') {
    throw new Error('This draw has already been released.');
  }
  const remainingSec = Math.ceil(Math.max(0, draw.scheduledReleaseAtMs - nowMs) / 1000);
  if (remainingSec <= Math.max(0, draw.lockBeforeSec)) {
    throw new Error('Betting for this draw is closed ahead of result release.');
  }

  const gameType = normalizeDigitGameType(draw.gameType);
  const normalizedPick = normalizeDigitTicketNumber(params.pickedNumber, gameType);
  if (!normalizedPick) {
    throw new Error(`Enter a valid ${gameType} number (${gameType.charAt(0)} digits).`);
  }

  const stake = roundCurrency2(params.stake);
  if (!Number.isFinite(stake) || stake < 1) {
    throw new Error('Minimum ticket stake is $1.00.');
  }

  const preview = calculateLotteryTradePreview({
    stake,
    feePct: draw.feePct,
    multiplier: draw.payoutMultiplier,
  });

  const newBet: DigitLotteryBetRecord = {
    id: `DLT-${randomHexId(5)}`,
    drawUid: draw.drawUid,
    gameType,
    userUid: params.userUid,
    userEmail: params.userEmail.toLowerCase(),
    accountMode: params.accountMode === 'real' ? 'real' : 'demo',
    pickedNumber: normalizedPick,
    stake: preview.stake,
    feePct: preview.feePct,
    feeAmount: preview.feeAmount,
    netStake: preview.netStake,
    multiplier: preview.multiplier,
    potentialPayout: preview.grossPayoutOnWin,
    outcome: 'PENDING',
    payoutAmount: 0,
    netProfit: 0,
    createdAtMs: nowMs,
    settledAtMs: null,
  };

  const nextDraws = [...base.digitDraws];
  nextDraws[drawIdx] = {
    ...draw,
    totalStake: roundCurrency2(draw.totalStake + preview.stake),
    betCount: draw.betCount + 1,
  };

  const saved = persistLotteryStorage(
    {
      ...base,
      digitDraws: nextDraws,
      digitBets: [newBet, ...base.digitBets],
    },
    nowMs
  );
  await mirrorLotteryToFirestore(saved);

  return {
    bet: newBet,
    state: buildLiveStateDto(saved, params.userUid, Boolean(params.isAdmin), nowMs),
  };
}

export async function updateLotteryAdminConfigStatic(
  updates: {
    resultMode?: LotteryResultMode;
    forcedResult?: LotteryColor | null;
    forcedNumber?: number | null;
    feePct?: number;
    payoutMultiplier?: number;
    numberMultiplier?: number;
    roundDurationSec?: number;
    isPaused?: boolean;
    settleNow?: boolean;
  },
  userUid?: string
): Promise<LotteryLiveState> {
  const nowMs = Date.now();
  let state = tickStorageState(readOrSeedLotteryStorage(nowMs), nowMs).state;
  const cfg = state.config;
  const openIdx = state.rounds.findIndex((r) => r.status === 'OPEN');
  const openRound = state.rounds[openIdx];

  const nextMode = updates.resultMode
    ? normalizeMode(updates.resultMode)
    : normalizeMode(cfg.resultMode);

  let nextForced: LotteryColor | null =
    updates.forcedResult !== undefined
      ? normalizeColor(updates.forcedResult)
      : normalizeColor(cfg.forcedResult);
  let nextForcedNumber: number | null =
    updates.forcedNumber !== undefined
      ? normalizeForcedNumber(updates.forcedNumber)
      : normalizeForcedNumber(cfg.forcedNumber);

  if (nextForcedNumber !== null && updates.forcedNumber !== undefined) {
    nextForced = getColorFromLotteryDigit(nextForcedNumber);
  } else if (updates.forcedResult !== undefined && updates.forcedNumber === undefined) {
    nextForcedNumber = null;
  }

  if (
    updates.resultMode &&
    updates.resultMode !== 'manual' &&
    updates.forcedResult === undefined &&
    updates.forcedNumber === undefined
  ) {
    nextForced = null;
    nextForcedNumber = null;
  }

  const nextFeePct =
    updates.feePct !== undefined ? clampFeePct(updates.feePct) : clampFeePct(cfg.feePct);
  const nextMultiplier =
    updates.payoutMultiplier !== undefined
      ? clampMultiplier(updates.payoutMultiplier)
      : clampMultiplier(cfg.payoutMultiplier);
  const nextNumberMultiplier =
    updates.numberMultiplier !== undefined
      ? clampMultiplier(updates.numberMultiplier)
      : clampMultiplier(cfg.numberMultiplier ?? 9);
  const nextDurationSec =
    updates.roundDurationSec !== undefined && Number.isFinite(updates.roundDurationSec)
      ? Math.max(15, Math.min(600, Math.round(updates.roundDurationSec)))
      : cfg.roundDurationSec;
  const nextPaused =
    typeof updates.isPaused === 'boolean' ? updates.isPaused : cfg.isPaused;

  let nextEndsAtMs = openRound.endsAtMs;
  let nextPausedRemainingMs = openRound.pausedRemainingMs ?? null;

  if (typeof updates.isPaused === 'boolean' && updates.isPaused !== cfg.isPaused) {
    if (updates.isPaused) {
      nextPausedRemainingMs = Math.max(0, openRound.endsAtMs - nowMs);
    } else {
      const resumeLeft = Math.max(
        1000,
        Number(openRound.pausedRemainingMs ?? nextDurationSec * 1000)
      );
      nextEndsAtMs = nowMs + resumeLeft;
      nextPausedRemainingMs = null;
    }
  }

  if (
    updates.roundDurationSec !== undefined &&
    updates.roundDurationSec !== cfg.roundDurationSec
  ) {
    const capMs = nextDurationSec * 1000;
    if (nextPaused) {
      nextPausedRemainingMs = Math.min(capMs, Number(nextPausedRemainingMs ?? capMs));
    } else {
      const currentLeft = Math.max(0, nextEndsAtMs - nowMs);
      nextEndsAtMs = nowMs + Math.min(capMs, currentLeft > 0 ? currentLeft : capMs);
    }
  }

  const nextRounds = [...state.rounds];
  nextRounds[openIdx] = {
    ...openRound,
    durationSec: nextDurationSec,
    resultMode: nextMode,
    forcedResult: nextForced,
    forcedNumber: nextForcedNumber,
    endsAtMs: nextEndsAtMs,
    pausedRemainingMs: nextPausedRemainingMs,
  };

  state = {
    ...state,
    config: {
      ...cfg,
      resultMode: nextMode,
      forcedResult: nextForced,
      forcedNumber: nextForcedNumber,
      feePct: nextFeePct,
      payoutMultiplier: nextMultiplier,
      numberMultiplier: nextNumberMultiplier,
      roundDurationSec: nextDurationSec,
      isPaused: nextPaused,
    },
    rounds: nextRounds,
  };

  if (updates.settleNow) {
    state = settleOpenRoundInState(state, nowMs);
  }

  const saved = persistLotteryStorage(state, nowMs);
  await mirrorLotteryToFirestore(saved);
  return buildLiveStateDto(saved, userUid, true, nowMs);
}

export async function adminScheduleDigitDrawStatic(
  params: {
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
  },
  userUid?: string
): Promise<LotteryLiveState> {
  const nowMs = Date.now();
  let state = tickStorageState(readOrSeedLotteryStorage(nowMs), nowMs).state;
  const gameType = normalizeDigitGameType(params.gameType);

  let validatedManual: string | null | undefined = undefined;
  if (params.manualResult === null || params.manualResult === '') {
    validatedManual = null;
  } else if (typeof params.manualResult === 'string') {
    const norm = normalizeDigitTicketNumber(params.manualResult, gameType);
    if (!norm) {
      throw new Error(
        `Manual result for ${gameType} must be exactly ${
          gameType === '2D' ? 2 : gameType === '3D' ? 3 : 6
        } digits.`
      );
    }
    validatedManual = norm;
  }

  const existingIdx =
    params.drawUid && !params.createNew
      ? state.digitDraws.findIndex((d) => d.drawUid === params.drawUid)
      : -1;

  let targetDrawUid: string;
  const nextDraws = [...state.digitDraws];

  if (existingIdx < 0 || params.createNew) {
    const releaseMs =
      typeof params.scheduledReleaseAtMs === 'number' &&
      Number.isFinite(params.scheduledReleaseAtMs)
        ? Math.max(nowMs + 5000, params.scheduledReleaseAtMs)
        : nowMs + defaultDigitOffsetMsForGame(gameType);

    const created: StoredDigitDraw = {
      drawUid: buildDigitDrawUid(gameType, nowMs),
      gameType,
      drawLabel: params.drawLabel?.trim() || `${gameType} Manual Scheduled Draw`,
      scheduledReleaseAtMs: releaseMs,
      lockBeforeSec:
        typeof params.lockBeforeSec === 'number' && Number.isFinite(params.lockBeforeSec)
          ? Math.max(1, Math.min(300, Math.round(params.lockBeforeSec)))
          : 10,
      payoutMultiplier:
        params.payoutMultiplier !== undefined
          ? clampMultiplier(params.payoutMultiplier)
          : defaultDigitMultiplierForGame(gameType),
      feePct:
        params.feePct !== undefined ? clampFeePct(params.feePct) : DEFAULT_LOTTERY_FEE_PCT,
      manualResult: validatedManual ?? null,
      winningNumber: null,
      status: 'SCHEDULED',
      totalStake: 0,
      totalPayouts: 0,
      betCount: 0,
      releasedAtMs: null,
    };
    nextDraws.push(created);
    targetDrawUid = created.drawUid;
  } else {
    const targetDraw = nextDraws[existingIdx];
    if (targetDraw.status !== 'SCHEDULED') {
      throw new Error('Cannot modify a draw that has already been released.');
    }
    nextDraws[existingIdx] = {
      ...targetDraw,
      drawLabel: params.drawLabel?.trim() || targetDraw.drawLabel,
      scheduledReleaseAtMs:
        typeof params.scheduledReleaseAtMs === 'number' &&
        Number.isFinite(params.scheduledReleaseAtMs)
          ? Math.max(nowMs + 2000, params.scheduledReleaseAtMs)
          : targetDraw.scheduledReleaseAtMs,
      lockBeforeSec:
        typeof params.lockBeforeSec === 'number' && Number.isFinite(params.lockBeforeSec)
          ? Math.max(1, Math.min(300, Math.round(params.lockBeforeSec)))
          : targetDraw.lockBeforeSec,
      payoutMultiplier:
        params.payoutMultiplier !== undefined
          ? clampMultiplier(params.payoutMultiplier)
          : targetDraw.payoutMultiplier,
      feePct:
        params.feePct !== undefined ? clampFeePct(params.feePct) : targetDraw.feePct,
      manualResult: validatedManual !== undefined ? validatedManual : targetDraw.manualResult,
    };
    targetDrawUid = targetDraw.drawUid;
  }

  state = { ...state, digitDraws: nextDraws };
  if (params.releaseNow) {
    state = releaseDigitDrawInState(state, targetDrawUid, nowMs);
  }

  const saved = persistLotteryStorage(state, nowMs);
  await mirrorLotteryToFirestore(saved);
  return buildLiveStateDto(saved, userUid, true, nowMs);
}
