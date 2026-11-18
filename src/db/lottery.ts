import crypto from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db } from './index.ts';
import {
  digitLotteryBets,
  digitLotteryDraws,
  lotteryBets,
  lotteryConfig,
  lotteryRounds,
} from './schema.ts';
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
} from '../types.ts';
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
} from '../utils/lotteryEngine.ts';

type DbLotteryConfig = typeof lotteryConfig.$inferSelect;
type DbLotteryRound = typeof lotteryRounds.$inferSelect;
type DbLotteryBet = typeof lotteryBets.$inferSelect;
type DbDigitDraw = typeof digitLotteryDraws.$inferSelect;
type DbDigitBet = typeof digitLotteryBets.$inferSelect;

let lotteryMutex: Promise<unknown> = Promise.resolve();

function withLotteryLock<T>(task: () => Promise<T>): Promise<T> {
  const run = lotteryMutex.then(task, task);
  lotteryMutex = run.catch(() => {});
  return run;
}

function buildRoundCode(roundNumber: number, nowMs = Date.now()): string {
  const dt = new Date(nowMs);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `#${y}${m}${d}-${String(roundNumber).padStart(4, '0')}`;
}

function buildDigitDrawUid(gameType: LotteryDigitGameType, nowMs = Date.now()): string {
  const dt = new Date(nowMs);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${gameType}-${y}${m}${d}-${rand}`;
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

function defaultMultiplierForGame(gameType: LotteryDigitGameType): number {
  if (gameType === '2D') return 80;
  if (gameType === '3D') return 500;
  return 10000;
}

function defaultOffsetMsForGame(gameType: LotteryDigitGameType): number {
  if (gameType === '2D') return 10 * 60_000;
  if (gameType === '3D') return 30 * 60_000;
  return 60 * 60_000;
}

function toConfigDto(row: DbLotteryConfig, isAdmin: boolean): LotteryConfig {
  return {
    roundDurationSec: Math.max(15, Math.min(600, Math.round(row.roundDurationSec))),
    lockSeconds: Math.max(1, Math.min(15, Math.round(row.lockSeconds))),
    feePct: clampFeePct(row.feePct),
    payoutMultiplier: clampMultiplier(row.payoutMultiplier),
    numberMultiplier: clampMultiplier(row.numberMultiplier ?? 9),
    resultMode: isAdmin ? normalizeMode(row.resultMode) : 'auto_balance',
    forcedResult: isAdmin ? normalizeColor(row.forcedResult) : null,
    forcedNumber: isAdmin ? normalizeForcedNumber(row.forcedNumber) : null,
    isPaused: Boolean(row.isPaused),
    accumulatedProfit: isAdmin ? roundCurrency2(row.accumulatedProfit) : 0,
  };
}

function toRoundDto(
  row: DbLotteryRound,
  cfg: LotteryConfig,
  isAdmin: boolean,
  nowMs = Date.now()
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
    settledAtMs: row.settledAt ? row.settledAt.getTime() : null,
  };
}

function toBetDto(row: DbLotteryBet): LotteryBetRecord {
  const betType: LotteryBetType = row.betType === 'number' ? 'number' : 'color';
  return {
    id: row.betUid,
    roundCode: row.roundCode,
    userUid: row.userUid,
    userEmail: row.userEmail,
    accountMode: row.accountMode === 'real' ? 'real' : 'demo',
    betType,
    color: row.color === 'red' ? 'red' : 'green',
    pickedNumber: typeof row.pickedNumber === 'number' ? row.pickedNumber : null,
    stake: roundCurrency2(row.stake),
    feePct: clampFeePct(row.feePct),
    feeAmount: roundCurrency4(row.feeAmount),
    netStake: roundCurrency4(row.netStake),
    multiplier: clampMultiplier(row.multiplier),
    potentialPayout: roundCurrency2(row.potentialPayout),
    outcome:
      row.outcome === 'WIN' ? 'WIN' : row.outcome === 'LOSS' ? 'LOSS' : 'PENDING',
    payoutAmount: roundCurrency2(row.payoutAmount),
    netProfit: roundCurrency2(row.netProfit),
    createdAtMs: row.createdAt.getTime(),
    settledAtMs: row.settledAt ? row.settledAt.getTime() : null,
  };
}

function toDigitDrawDto(
  row: DbDigitDraw,
  isAdmin: boolean,
  nowMs = Date.now()
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
    releasedAtMs: row.releasedAt ? row.releasedAt.getTime() : null,
  };
}

function toDigitBetDto(row: DbDigitBet): DigitLotteryBetRecord {
  return {
    id: row.betUid,
    drawUid: row.drawUid,
    gameType: normalizeDigitGameType(row.gameType),
    userUid: row.userUid,
    userEmail: row.userEmail,
    accountMode: row.accountMode === 'real' ? 'real' : 'demo',
    pickedNumber: row.pickedNumber,
    stake: roundCurrency2(row.stake),
    feePct: clampFeePct(row.feePct),
    feeAmount: roundCurrency4(row.feeAmount),
    netStake: roundCurrency4(row.netStake),
    multiplier: clampMultiplier(row.multiplier),
    potentialPayout: roundCurrency2(row.potentialPayout),
    outcome:
      row.outcome === 'WIN' ? 'WIN' : row.outcome === 'LOSS' ? 'LOSS' : 'PENDING',
    payoutAmount: roundCurrency2(row.payoutAmount),
    netProfit: roundCurrency2(row.netProfit),
    createdAtMs: row.createdAt.getTime(),
    settledAtMs: row.settledAt ? row.settledAt.getTime() : null,
  };
}

async function getOrCreateConfigRow(): Promise<DbLotteryConfig> {
  const existing = await db
    .select()
    .from(lotteryConfig)
    .where(eq(lotteryConfig.id, 1))
    .limit(1);
  if (existing[0]) return existing[0];

  const [inserted] = await db
    .insert(lotteryConfig)
    .values({
      id: 1,
      roundDurationSec: 60,
      lockSeconds: 5,
      feePct: DEFAULT_LOTTERY_FEE_PCT,
      payoutMultiplier: 2,
      numberMultiplier: 9,
      resultMode: 'auto_balance',
      forcedResult: null,
      forcedNumber: null,
      isPaused: false,
      accumulatedProfit: 0,
    })
    .onConflictDoNothing({ target: lotteryConfig.id })
    .returning();
  if (inserted) return inserted;

  const fallback = await db
    .select()
    .from(lotteryConfig)
    .where(eq(lotteryConfig.id, 1))
    .limit(1);
  return fallback[0];
}

async function seedAndOpenFirstRoundIfNeeded(cfg: DbLotteryConfig): Promise<DbLotteryRound> {
  const existingRounds = await db
    .select()
    .from(lotteryRounds)
    .orderBy(desc(lotteryRounds.roundNumber))
    .limit(1);

  const nowMs = Date.now();
  if (existingRounds.length === 0) {
    const seedColors: LotteryColor[] = [
      'green',
      'red',
      'green',
      'green',
      'red',
      'green',
      'red',
      'green',
    ];
    for (let i = 0; i < seedColors.length; i++) {
      const rn = i + 1;
      const startMs = nowMs - (seedColors.length - i + 1) * 60_000;
      const endMs = startMs + 60_000;
      const code = buildRoundCode(rn, endMs);
      await db
        .insert(lotteryRounds)
        .values({
          roundNumber: rn,
          roundCode: code,
          durationSec: 60,
          startedAtMs: startMs,
          endsAtMs: endMs,
          status: 'SETTLED',
          resultMode: 'auto_balance',
          winningColor: seedColors[i],
          winningNumber: deriveLotteryDrawNumber(code, seedColors[i]),
          greenTotal: seedColors[i] === 'green' ? 120 : 280,
          redTotal: seedColors[i] === 'red' ? 140 : 320,
          greenCount: 2,
          redCount: 3,
          totalFees: 40,
          totalPayouts: 216,
          houseProfit: 184,
          settledAt: new Date(endMs),
        })
        .onConflictDoNothing({ target: lotteryRounds.roundNumber });
    }

    const openNum = seedColors.length + 1;
    const durationMs = cfg.roundDurationSec * 1000;
    const [created] = await db
      .insert(lotteryRounds)
      .values({
        roundNumber: openNum,
        roundCode: buildRoundCode(openNum, nowMs),
        durationSec: cfg.roundDurationSec,
        startedAtMs: nowMs,
        endsAtMs: nowMs + durationMs,
        pausedRemainingMs: cfg.isPaused ? durationMs : null,
        status: 'OPEN',
        resultMode: cfg.resultMode,
        forcedResult: cfg.forcedResult,
        forcedNumber: cfg.forcedNumber,
      })
      .returning();
    return created;
  }

  const latest = existingRounds[0];
  if (latest.status === 'OPEN') return latest;

  const nextNum = latest.roundNumber + 1;
  const durationMs = cfg.roundDurationSec * 1000;
  const [created] = await db
    .insert(lotteryRounds)
    .values({
      roundNumber: nextNum,
      roundCode: buildRoundCode(nextNum, nowMs),
      durationSec: cfg.roundDurationSec,
      startedAtMs: nowMs,
      endsAtMs: nowMs + durationMs,
      pausedRemainingMs: cfg.isPaused ? durationMs : null,
      status: 'OPEN',
      resultMode: cfg.resultMode,
      forcedResult: cfg.forcedResult,
      forcedNumber: cfg.forcedNumber,
    })
    .returning();
  return created;
}

async function seedDigitDrawsIfNeeded(nowMs = Date.now()): Promise<void> {
  const games: LotteryDigitGameType[] = ['2D', '3D', '6D'];
  for (const gameType of games) {
    const active = await db
      .select()
      .from(digitLotteryDraws)
      .where(
        and(
          eq(digitLotteryDraws.gameType, gameType),
          eq(digitLotteryDraws.status, 'SCHEDULED')
        )
      )
      .limit(1);

    if (active.length === 0) {
      await db.insert(digitLotteryDraws).values({
        drawUid: buildDigitDrawUid(gameType, nowMs),
        gameType,
        drawLabel: `${gameType} Scheduled Official Draw`,
        scheduledReleaseAtMs: nowMs + defaultOffsetMsForGame(gameType),
        lockBeforeSec: 10,
        payoutMultiplier: defaultMultiplierForGame(gameType),
        feePct: DEFAULT_LOTTERY_FEE_PCT,
        manualResult: null,
        winningNumber: null,
        status: 'SCHEDULED',
      });
    }

    const released = await db
      .select()
      .from(digitLotteryDraws)
      .where(
        and(
          eq(digitLotteryDraws.gameType, gameType),
          eq(digitLotteryDraws.status, 'RELEASED')
        )
      )
      .limit(1);

    if (released.length === 0) {
      const pastMs = nowMs - 15 * 60_000;
      const sampleResult = gameType === '2D' ? '48' : gameType === '3D' ? '729' : '482915';
      await db.insert(digitLotteryDraws).values({
        drawUid: buildDigitDrawUid(gameType, pastMs),
        gameType,
        drawLabel: `${gameType} Previous Draw`,
        scheduledReleaseAtMs: pastMs,
        lockBeforeSec: 10,
        payoutMultiplier: defaultMultiplierForGame(gameType),
        feePct: DEFAULT_LOTTERY_FEE_PCT,
        manualResult: sampleResult,
        winningNumber: sampleResult,
        status: 'RELEASED',
        totalStake: 0,
        totalPayouts: 0,
        betCount: 0,
        releasedAt: new Date(pastMs),
      });
    }
  }
}

async function releaseDigitDrawInternal(
  draw: DbDigitDraw,
  nowMs: number
): Promise<DbDigitDraw> {
  const gameType = normalizeDigitGameType(draw.gameType);
  const validManual =
    draw.manualResult && normalizeDigitTicketNumber(draw.manualResult, gameType)
      ? draw.manualResult
      : null;
  const winningNumber = validManual ?? generateRandomDigitTicket(gameType);

  const pendingBets = await db
    .select()
    .from(digitLotteryBets)
    .where(eq(digitLotteryBets.drawUid, draw.drawUid));

  let totalPayouts = 0;
  for (const bet of pendingBets) {
    const settlement = settleDigitLotteryBet(
      {
        pickedNumber: bet.pickedNumber,
        stake: bet.stake,
        potentialPayout: bet.potentialPayout,
      },
      winningNumber
    );
    totalPayouts = roundCurrency2(totalPayouts + settlement.payoutAmount);
    await db
      .update(digitLotteryBets)
      .set({
        outcome: settlement.outcome,
        payoutAmount: settlement.payoutAmount,
        netProfit: settlement.netProfit,
        settledAt: new Date(nowMs),
      })
      .where(eq(digitLotteryBets.id, bet.id));
  }

  const [released] = await db
    .update(digitLotteryDraws)
    .set({
      status: 'RELEASED',
      winningNumber,
      totalPayouts,
      releasedAt: new Date(nowMs),
    })
    .where(eq(digitLotteryDraws.id, draw.id))
    .returning();

  // Ensure next scheduled draw exists for this gameType
  const remainingScheduled = await db
    .select()
    .from(digitLotteryDraws)
    .where(
      and(
        eq(digitLotteryDraws.gameType, gameType),
        eq(digitLotteryDraws.status, 'SCHEDULED')
      )
    )
    .limit(1);

  if (remainingScheduled.length === 0) {
    await db.insert(digitLotteryDraws).values({
      drawUid: buildDigitDrawUid(gameType, nowMs + 1000),
      gameType,
      drawLabel: `${gameType} Scheduled Official Draw`,
      scheduledReleaseAtMs: nowMs + defaultOffsetMsForGame(gameType),
      lockBeforeSec: draw.lockBeforeSec,
      payoutMultiplier: draw.payoutMultiplier,
      feePct: draw.feePct,
      manualResult: null,
      winningNumber: null,
      status: 'SCHEDULED',
    });
  }

  return released;
}

async function autoReleaseDueDigitDraws(nowMs: number): Promise<void> {
  const scheduled = await db
    .select()
    .from(digitLotteryDraws)
    .where(eq(digitLotteryDraws.status, 'SCHEDULED'));

  for (const draw of scheduled) {
    if (nowMs >= draw.scheduledReleaseAtMs) {
      await releaseDigitDrawInternal(draw, nowMs);
    }
  }
}

async function settleAndAdvanceRound(
  cfgRow: DbLotteryConfig,
  openRound: DbLotteryRound,
  nowMs: number
): Promise<{ config: DbLotteryConfig; openRound: DbLotteryRound }> {
  const mode = normalizeMode(openRound.resultMode || cfgRow.resultMode);
  const forced = normalizeColor(openRound.forcedResult ?? cfgRow.forcedResult);
  const forcedNum = normalizeForcedNumber(openRound.forcedNumber ?? cfgRow.forcedNumber);

  const roundBets = await db
    .select()
    .from(lotteryBets)
    .where(eq(lotteryBets.roundCode, openRound.roundCode));

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

  for (const bet of roundBets) {
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

    await db
      .update(lotteryBets)
      .set({
        outcome: settlement.outcome,
        payoutAmount: settlement.payoutAmount,
        netProfit: settlement.netProfit,
        settledAt: new Date(nowMs),
      })
      .where(eq(lotteryBets.id, bet.id));
  }

  const houseProfit = roundCurrency2(totalStakes - totalPayouts);

  await db
    .update(lotteryRounds)
    .set({
      status: 'SETTLED',
      winningColor,
      winningNumber,
      resultMode: mode,
      forcedResult: forced,
      forcedNumber: forcedNum,
      totalFees,
      totalPayouts,
      houseProfit,
      settledAt: new Date(nowMs),
    })
    .where(eq(lotteryRounds.id, openRound.id));

  const nextAccumulatedProfit = roundCurrency2(cfgRow.accumulatedProfit + houseProfit);
  const [updatedCfg] = await db
    .update(lotteryConfig)
    .set({
      accumulatedProfit: nextAccumulatedProfit,
      forcedResult: null,
      forcedNumber: null,
      updatedAt: new Date(nowMs),
    })
    .where(eq(lotteryConfig.id, 1))
    .returning();

  const nextNum = openRound.roundNumber + 1;
  const durationMs = updatedCfg.roundDurationSec * 1000;
  const [nextRound] = await db
    .insert(lotteryRounds)
    .values({
      roundNumber: nextNum,
      roundCode: buildRoundCode(nextNum, nowMs),
      durationSec: updatedCfg.roundDurationSec,
      startedAtMs: nowMs,
      endsAtMs: nowMs + durationMs,
      pausedRemainingMs: updatedCfg.isPaused ? durationMs : null,
      status: 'OPEN',
      resultMode: updatedCfg.resultMode,
      forcedResult: null,
      forcedNumber: null,
    })
    .returning();

  return { config: updatedCfg, openRound: nextRound };
}

async function tickLotteryInternal(): Promise<{
  config: DbLotteryConfig;
  openRound: DbLotteryRound;
}> {
  let cfg = await getOrCreateConfigRow();
  let openRound = await seedAndOpenFirstRoundIfNeeded(cfg);
  const nowMs = Date.now();

  if (!cfg.isPaused && openRound.status === 'OPEN' && nowMs >= openRound.endsAtMs) {
    const settled = await settleAndAdvanceRound(cfg, openRound, nowMs);
    cfg = settled.config;
    openRound = settled.openRound;
  }

  await seedDigitDrawsIfNeeded(nowMs);
  await autoReleaseDueDigitDraws(nowMs);

  return { config: cfg, openRound };
}

async function buildLiveStatePayload(params: {
  cfgRow: DbLotteryConfig;
  openRound: DbLotteryRound;
  userUid?: string;
  isAdmin: boolean;
  nowMs: number;
}): Promise<LotteryLiveState> {
  const { cfgRow, openRound, userUid, isAdmin, nowMs } = params;
  const configDto = toConfigDto(cfgRow, isAdmin);
  const currentRound = toRoundDto(openRound, configDto, isAdmin, nowMs);

  const settledRows = await db
    .select()
    .from(lotteryRounds)
    .where(eq(lotteryRounds.status, 'SETTLED'))
    .orderBy(desc(lotteryRounds.roundNumber))
    .limit(24);

  const userBetRows = userUid
    ? await db
        .select()
        .from(lotteryBets)
        .where(eq(lotteryBets.userUid, userUid))
        .orderBy(desc(lotteryBets.createdAt))
        .limit(50)
    : [];

  const scheduledDigitRows = await db
    .select()
    .from(digitLotteryDraws)
    .where(eq(digitLotteryDraws.status, 'SCHEDULED'))
    .orderBy(digitLotteryDraws.scheduledReleaseAtMs);

  const releasedDigitRows = await db
    .select()
    .from(digitLotteryDraws)
    .where(eq(digitLotteryDraws.status, 'RELEASED'))
    .orderBy(desc(digitLotteryDraws.releasedAt))
    .limit(24);

  const userDigitBetRows = userUid
    ? await db
        .select()
        .from(digitLotteryBets)
        .where(eq(digitLotteryBets.userUid, userUid))
        .orderBy(desc(digitLotteryBets.createdAt))
        .limit(50)
    : [];

  return {
    serverTimeMs: nowMs,
    config: configDto,
    currentRound,
    historyStrip: settledRows.map((row) => toRoundDto(row, configDto, isAdmin, nowMs)),
    userBets: userBetRows.map(toBetDto),
    digitDraws: scheduledDigitRows.map((row) => toDigitDrawDto(row, isAdmin, nowMs)),
    digitHistory: releasedDigitRows.map((row) => toDigitDrawDto(row, isAdmin, nowMs)),
    userDigitBets: userDigitBetRows.map(toDigitBetDto),
  };
}

export async function tickLotteryEngine(): Promise<void> {
  await withLotteryLock(async () => {
    await tickLotteryInternal();
  });
}

export async function getLotteryLiveState(
  userUid?: string,
  isAdmin = false
): Promise<LotteryLiveState> {
  return withLotteryLock(async () => {
    const { config: cfgRow, openRound } = await tickLotteryInternal();
    const nowMs = Date.now();
    return buildLiveStatePayload({
      cfgRow,
      openRound,
      userUid,
      isAdmin,
      nowMs,
    });
  });
}

export async function placeLotteryBet(params: {
  userUid: string;
  userEmail: string;
  accountMode: AccountMode;
  betType?: LotteryBetType;
  color?: LotteryColor;
  pickedNumber?: number | null;
  stake: number;
  isAdmin?: boolean;
}): Promise<{ bet: LotteryBetRecord; state: LotteryLiveState }> {
  return withLotteryLock(async () => {
    const { config: cfgRow, openRound } = await tickLotteryInternal();
    const nowMs = Date.now();
    const isAdmin = Boolean(params.isAdmin);
    const configDto = toConfigDto(cfgRow, true);
    const roundDto = toRoundDto(openRound, configDto, true, nowMs);

    if (configDto.isPaused) {
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
    let effectiveMultiplier = configDto.payoutMultiplier;

    if (betType === 'number') {
      const num = Number(params.pickedNumber);
      if (!Number.isInteger(num) || num < 0 || num > 9) {
        throw new Error('Please choose a valid number between 0 and 9.');
      }
      pickedNumber = num;
      resolvedColor = getColorFromLotteryDigit(num);
      effectiveMultiplier = configDto.numberMultiplier;
    } else {
      if (params.color !== 'green' && params.color !== 'red') {
        throw new Error('Valid prediction color (green or red) is required.');
      }
      resolvedColor = params.color;
    }

    // Enforce Single-Side Rule on color bets for this user in the active round
    const existingRoundUserBets = await db
      .select()
      .from(lotteryBets)
      .where(
        and(
          eq(lotteryBets.roundCode, openRound.roundCode),
          eq(lotteryBets.userUid, params.userUid)
        )
      );

    const conflictErr = checkLotteryColorSideConflict(
      existingRoundUserBets.map(toBetDto),
      betType,
      resolvedColor
    );
    if (conflictErr) {
      throw new Error(conflictErr);
    }

    const preview = calculateLotteryTradePreview({
      stake,
      feePct: configDto.feePct,
      multiplier: effectiveMultiplier,
    });

    const betUid = `LOT-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    const [insertedBet] = await db
      .insert(lotteryBets)
      .values({
        betUid,
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
      })
      .returning();

    const nextGreenTotal =
      betType === 'color' && resolvedColor === 'green'
        ? roundCurrency2(openRound.greenTotal + preview.stake)
        : openRound.greenTotal;
    const nextRedTotal =
      betType === 'color' && resolvedColor === 'red'
        ? roundCurrency2(openRound.redTotal + preview.stake)
        : openRound.redTotal;
    const nextGreenCount =
      betType === 'color' && resolvedColor === 'green'
        ? openRound.greenCount + 1
        : openRound.greenCount;
    const nextRedCount =
      betType === 'color' && resolvedColor === 'red'
        ? openRound.redCount + 1
        : openRound.redCount;

    const [updatedRound] = await db
      .update(lotteryRounds)
      .set({
        greenTotal: nextGreenTotal,
        redTotal: nextRedTotal,
        greenCount: nextGreenCount,
        redCount: nextRedCount,
      })
      .where(eq(lotteryRounds.id, openRound.id))
      .returning();

    const state = await buildLiveStatePayload({
      cfgRow,
      openRound: updatedRound,
      userUid: params.userUid,
      isAdmin,
      nowMs,
    });

    return {
      bet: toBetDto(insertedBet),
      state,
    };
  });
}

export async function placeDigitLotteryBet(params: {
  userUid: string;
  userEmail: string;
  accountMode: AccountMode;
  drawUid: string;
  pickedNumber: string;
  stake: number;
  isAdmin?: boolean;
}): Promise<{ bet: DigitLotteryBetRecord; state: LotteryLiveState }> {
  return withLotteryLock(async () => {
    const { config: cfgRow, openRound } = await tickLotteryInternal();
    const nowMs = Date.now();

    const drawRows = await db
      .select()
      .from(digitLotteryDraws)
      .where(eq(digitLotteryDraws.drawUid, params.drawUid))
      .limit(1);
    const draw = drawRows[0];
    if (!draw) {
      throw new Error('Scheduled draw not found.');
    }
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

    const betUid = `DLT-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    const [inserted] = await db
      .insert(digitLotteryBets)
      .values({
        betUid,
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
      })
      .returning();

    await db
      .update(digitLotteryDraws)
      .set({
        totalStake: roundCurrency2(draw.totalStake + preview.stake),
        betCount: draw.betCount + 1,
      })
      .where(eq(digitLotteryDraws.id, draw.id));

    const state = await buildLiveStatePayload({
      cfgRow,
      openRound,
      userUid: params.userUid,
      isAdmin: Boolean(params.isAdmin),
      nowMs,
    });

    return {
      bet: toDigitBetDto(inserted),
      state,
    };
  });
}

export async function updateLotteryAdminConfig(updates: {
  resultMode?: LotteryResultMode;
  forcedResult?: LotteryColor | null;
  forcedNumber?: number | null;
  feePct?: number;
  payoutMultiplier?: number;
  numberMultiplier?: number;
  roundDurationSec?: number;
  isPaused?: boolean;
  settleNow?: boolean;
}): Promise<LotteryLiveState> {
  return withLotteryLock(async () => {
    const { config: cfgRow, openRound } = await tickLotteryInternal();
    const nowMs = Date.now();

    const nextMode = updates.resultMode
      ? normalizeMode(updates.resultMode)
      : normalizeMode(cfgRow.resultMode);

    let nextForced: LotteryColor | null =
      updates.forcedResult !== undefined
        ? normalizeColor(updates.forcedResult)
        : normalizeColor(cfgRow.forcedResult);
    let nextForcedNumber: number | null =
      updates.forcedNumber !== undefined
        ? normalizeForcedNumber(updates.forcedNumber)
        : normalizeForcedNumber(cfgRow.forcedNumber);

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
      updates.feePct !== undefined ? clampFeePct(updates.feePct) : clampFeePct(cfgRow.feePct);
    const nextMultiplier =
      updates.payoutMultiplier !== undefined
        ? clampMultiplier(updates.payoutMultiplier)
        : clampMultiplier(cfgRow.payoutMultiplier);
    const nextNumberMultiplier =
      updates.numberMultiplier !== undefined
        ? clampMultiplier(updates.numberMultiplier)
        : clampMultiplier(cfgRow.numberMultiplier ?? 9);
    const nextDurationSec =
      updates.roundDurationSec !== undefined && Number.isFinite(updates.roundDurationSec)
        ? Math.max(15, Math.min(600, Math.round(updates.roundDurationSec)))
        : cfgRow.roundDurationSec;

    const nextPaused =
      typeof updates.isPaused === 'boolean' ? updates.isPaused : cfgRow.isPaused;

    const [updatedCfg] = await db
      .update(lotteryConfig)
      .set({
        resultMode: nextMode,
        forcedResult: nextForced,
        forcedNumber: nextForcedNumber,
        feePct: nextFeePct,
        payoutMultiplier: nextMultiplier,
        numberMultiplier: nextNumberMultiplier,
        roundDurationSec: nextDurationSec,
        isPaused: nextPaused,
        updatedAt: new Date(nowMs),
      })
      .where(eq(lotteryConfig.id, 1))
      .returning();

    let nextEndsAtMs = openRound.endsAtMs;
    let nextPausedRemainingMs = openRound.pausedRemainingMs;

    if (typeof updates.isPaused === 'boolean' && updates.isPaused !== cfgRow.isPaused) {
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
      updates.roundDurationSec !== cfgRow.roundDurationSec
    ) {
      const capMs = nextDurationSec * 1000;
      if (nextPaused) {
        nextPausedRemainingMs = Math.min(
          capMs,
          Number(nextPausedRemainingMs ?? capMs)
        );
      } else {
        const currentLeft = Math.max(0, nextEndsAtMs - nowMs);
        nextEndsAtMs = nowMs + Math.min(capMs, currentLeft > 0 ? currentLeft : capMs);
      }
    }

    const [updatedRound] = await db
      .update(lotteryRounds)
      .set({
        durationSec: nextDurationSec,
        resultMode: nextMode,
        forcedResult: nextForced,
        forcedNumber: nextForcedNumber,
        endsAtMs: nextEndsAtMs,
        pausedRemainingMs: nextPausedRemainingMs,
      })
      .where(eq(lotteryRounds.id, openRound.id))
      .returning();

    let finalCfg = updatedCfg;
    let finalRound = updatedRound;

    if (updates.settleNow) {
      const settled = await settleAndAdvanceRound(finalCfg, finalRound, nowMs);
      finalCfg = settled.config;
      finalRound = settled.openRound;
    }

    return buildLiveStatePayload({
      cfgRow: finalCfg,
      openRound: finalRound,
      isAdmin: true,
      nowMs,
    });
  });
}

export async function adminUpsertOrScheduleDigitDraw(params: {
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
}): Promise<LotteryLiveState> {
  return withLotteryLock(async () => {
    const { config: cfgRow, openRound } = await tickLotteryInternal();
    const nowMs = Date.now();
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

    let targetDraw: DbDigitDraw | null = null;
    if (params.drawUid && !params.createNew) {
      const rows = await db
        .select()
        .from(digitLotteryDraws)
        .where(eq(digitLotteryDraws.drawUid, params.drawUid))
        .limit(1);
      targetDraw = rows[0] ?? null;
    }

    if (!targetDraw || params.createNew) {
      const releaseMs =
        typeof params.scheduledReleaseAtMs === 'number' &&
        Number.isFinite(params.scheduledReleaseAtMs)
          ? Math.max(nowMs + 5000, params.scheduledReleaseAtMs)
          : nowMs + defaultOffsetMsForGame(gameType);

      const [created] = await db
        .insert(digitLotteryDraws)
        .values({
          drawUid: buildDigitDrawUid(gameType, nowMs),
          gameType,
          drawLabel:
            params.drawLabel?.trim() || `${gameType} Manual Scheduled Draw`,
          scheduledReleaseAtMs: releaseMs,
          lockBeforeSec:
            typeof params.lockBeforeSec === 'number' && Number.isFinite(params.lockBeforeSec)
              ? Math.max(1, Math.min(300, Math.round(params.lockBeforeSec)))
              : 10,
          payoutMultiplier:
            params.payoutMultiplier !== undefined
              ? clampMultiplier(params.payoutMultiplier)
              : defaultMultiplierForGame(gameType),
          feePct:
            params.feePct !== undefined ? clampFeePct(params.feePct) : DEFAULT_LOTTERY_FEE_PCT,
          manualResult: validatedManual ?? null,
          winningNumber: null,
          status: 'SCHEDULED',
        })
        .returning();
      targetDraw = created;
    } else {
      if (targetDraw.status !== 'SCHEDULED') {
        throw new Error('Cannot modify a draw that has already been released.');
      }

      const [updated] = await db
        .update(digitLotteryDraws)
        .set({
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
            params.feePct !== undefined
              ? clampFeePct(params.feePct)
              : targetDraw.feePct,
          manualResult:
            validatedManual !== undefined ? validatedManual : targetDraw.manualResult,
        })
        .where(eq(digitLotteryDraws.id, targetDraw.id))
        .returning();
      targetDraw = updated;
    }

    if (params.releaseNow && targetDraw.status === 'SCHEDULED') {
      await releaseDigitDrawInternal(targetDraw, nowMs);
    }

    return buildLiveStatePayload({
      cfgRow,
      openRound,
      isAdmin: true,
      nowMs,
    });
  });
}
