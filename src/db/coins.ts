import { and, asc, desc, eq, gt, gte, isNotNull, lte, or, sql } from 'drizzle-orm';
import type {
  AdminManagedCoin,
  AdminPriceSchedule,
  AdminProfitClaim,
  CoinTradeAnalytics,
  CoinTradeRecord,
  CoinTrendBias,
  CoinVolatilityLevel,
} from '../types.ts';
import {
  computeOrganicMarketTickPrice,
  computeScheduledCoinPrice,
  summarizeCoinTradeAnalytics,
} from '../utils/tradingEngine.ts';
import {
  type ChartTimeframe,
  type OhlcvCandle,
  buildPersistentChartCandles,
} from '../utils/chartEngine.ts';
import { db } from './index.ts';
import { adminProfitClaims, coinTrades, customCoinCandles, customCoins, users } from './schema.ts';
import { findUserByIdentifier } from './users.ts';

function normalizeSymbolParts(rawSymbol: string, rawLabel?: string): {
  symbol: string;
  label: string;
  shortName: string;
} {
  const cleaned = rawSymbol.toUpperCase().replace(/[^A-Z0-9/]/g, '').trim();
  const compact = cleaned.replace('/', '');
  const symbol = compact.endsWith('USDT') || compact === 'GOLD' || compact === 'USOIL' ? compact : `${compact}USDT`;
  const base = symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol;
  const shortName = `${base}/USDT`;
  const label = rawLabel?.trim() || `${base} / USDT`;
  return { symbol, label, shortName };
}

function parseSchedule(json: string | null): AdminPriceSchedule | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as AdminPriceSchedule;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function getVolatilityAmplitude(level?: CoinVolatilityLevel): number {
  if (level === 'calm') return 0.0018;
  if (level === 'active') return 0.011;
  return 0.0045;
}

function formatRoundedPrice(val: number): number {
  if (val >= 1000) return Number(val.toFixed(2));
  if (val >= 1) return Number(val.toFixed(3));
  return Number(val.toFixed(4));
}

const lastRecordedCandleBySymbol = new Map<string, { bucketTimeMs: number; price: number }>();
const lastLiqCheckBySymbol = new Map<string, { timeMs: number; price: number }>();

async function recordCoinCandleTick(symbol: string, price: number, nowMs: number): Promise<void> {
  if (!Number.isFinite(price) || price <= 0) return;
  const bucketTimeMs = Math.floor(nowMs / 60_000) * 60_000;
  const cached = lastRecordedCandleBySymbol.get(symbol);
  if (cached && cached.bucketTimeMs === bucketTimeMs && Math.abs(cached.price - price) < 0.00001) {
    return;
  }

  const openPrice = cached ? cached.price : price;
  const highPrice = Math.max(openPrice, price);
  const lowPrice = Math.min(openPrice, price);
  const tickVol = Number((Math.max(8, Math.abs(price - openPrice) * 65 + 6)).toFixed(2));
  lastRecordedCandleBySymbol.set(symbol, { bucketTimeMs, price });

  await db
    .insert(customCoinCandles)
    .values({
      symbol,
      bucketTimeMs,
      open: openPrice,
      high: highPrice,
      low: lowPrice,
      close: price,
      volume: tickVol,
    })
    .onConflictDoUpdate({
      target: [customCoinCandles.symbol, customCoinCandles.bucketTimeMs],
      set: {
        high: sql`GREATEST(${customCoinCandles.high}, ${price})`,
        low: sql`LEAST(${customCoinCandles.low}, ${price})`,
        close: price,
        volume: sql`${customCoinCandles.volume} + ${tickVol}`,
      },
    })
    .catch(() => {});
}

async function autoLiquidateCoinTradesOnServer(symbol: string, currentPrice: number, nowMs: number): Promise<void> {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return;
  const prev = lastLiqCheckBySymbol.get(symbol);
  if (prev && nowMs - prev.timeMs < 1000 && Math.abs(prev.price - currentPrice) < 0.00001) {
    return;
  }
  lastLiqCheckBySymbol.set(symbol, { timeMs: nowMs, price: currentPrice });

  await db
    .update(coinTrades)
    .set({
      status: 'LIQUIDATED',
      closePrice: currentPrice,
      pnlVal: sql`-${coinTrades.margin}`,
      closedAt: new Date(nowMs),
    })
    .where(
      and(
        eq(coinTrades.symbol, symbol),
        eq(coinTrades.status, 'OPEN'),
        isNotNull(coinTrades.liqPrice),
        gt(coinTrades.liqPrice, 0),
        or(
          // Long (buy) liquidates when currentPrice <= liq_price (so liq_price >= currentPrice)
          and(eq(coinTrades.side, 'buy'), gte(coinTrades.liqPrice, currentPrice)),
          // Short (sell) liquidates when currentPrice >= liq_price (so liq_price <= currentPrice)
          and(eq(coinTrades.side, 'sell'), lte(coinTrades.liqPrice, currentPrice))
        )
      )
    )
    .catch(() => {});
}

async function mapCoinRowWithSchedule(row: typeof customCoins.$inferSelect, nowMs = Date.now()): Promise<AdminManagedCoin> {
  const schedule = parseSchedule(row.scheduleJson);
  let currentPrice = Number(row.currentPrice);
  let high24h = Number(row.high24h);
  let low24h = Number(row.low24h);
  let activeSchedule = schedule;

  const trendBias: CoinTrendBias = schedule?.trendBias ?? 'neutral';
  const amp = getVolatilityAmplitude(schedule?.volatilityLevel);

  if (schedule && schedule.active) {
    if (schedule.paused) {
      // Price stays frozen while Admin pauses an active schedule
      currentPrice = Number(row.currentPrice);
    } else {
      const evaluated = computeScheduledCoinPrice(
        { currentPrice, schedule },
        nowMs
      );
      currentPrice = evaluated.price;
      high24h = Math.max(high24h, currentPrice);
      low24h = Math.min(low24h, currentPrice);

      if (evaluated.completed) {
        activeSchedule = {
          ...schedule,
          active: false,
          paused: false,
          pausedAtMs: undefined,
        };
        await db
          .update(customCoins)
          .set({
            currentPrice,
            high24h,
            low24h,
            scheduleJson: JSON.stringify(activeSchedule),
            updatedAt: new Date(nowMs),
          })
          .where(eq(customCoins.id, row.id))
          .catch(() => {});
      } else if (Math.abs(currentPrice - row.currentPrice) > 0.00001) {
        await db
          .update(customCoins)
          .set({
            currentPrice,
            high24h,
            low24h,
            updatedAt: new Date(nowMs),
          })
          .where(eq(customCoins.id, row.id))
          .catch(() => {});
      }
    }
  } else if (row.enabled && !schedule?.paused) {
    // Live organic market ticks synchronized across all users around Admin's current anchor price
    currentPrice = computeOrganicMarketTickPrice(currentPrice, row.symbol, nowMs, amp, trendBias);
    high24h = Math.max(high24h, currentPrice);
    low24h = Math.min(low24h, currentPrice);
  }

  if (row.enabled) {
    await Promise.all([
      recordCoinCandleTick(row.symbol, currentPrice, nowMs),
      autoLiquidateCoinTradesOnServer(row.symbol, currentPrice, nowMs),
    ]);
  }

  const open24h = Number(row.openPrice24h) > 0 ? Number(row.openPrice24h) : currentPrice;
  const changePct = open24h > 0 ? Number((((currentPrice - open24h) / open24h) * 100).toFixed(2)) : 0;

  return {
    symbol: row.symbol,
    label: row.label,
    shortName: row.shortName,
    currentPrice,
    openPrice24h: open24h,
    changePct,
    high24h,
    low24h,
    enabled: row.enabled,
    schedule: activeSchedule,
    updatedAtMs: row.updatedAt ? new Date(row.updatedAt).getTime() : nowMs,
  };
}

export async function listCustomCoins(includeDisabled = false): Promise<AdminManagedCoin[]> {
  const rows = await db
    .select()
    .from(customCoins)
    .orderBy(customCoins.id);
  const nowMs = Date.now();
  const mapped = await Promise.all(rows.map((r) => mapCoinRowWithSchedule(r, nowMs)));
  return includeDisabled ? mapped : mapped.filter((c) => c.enabled);
}

export async function upsertCustomCoin(params: {
  symbol: string;
  label?: string;
  initialPrice: number;
  enabled?: boolean;
}): Promise<AdminManagedCoin> {
  const { symbol, label, shortName } = normalizeSymbolParts(params.symbol, params.label);
  const safePrice = Number.isFinite(params.initialPrice) && params.initialPrice > 0 ? params.initialPrice : 100;
  const enabled = params.enabled ?? true;
  const now = new Date();

  const existing = await db.select().from(customCoins).where(eq(customCoins.symbol, symbol)).limit(1);
  if (existing[0]) {
    const [updated] = await db
      .update(customCoins)
      .set({
        label,
        shortName,
        currentPrice: safePrice,
        openPrice24h: safePrice,
        high24h: Math.max(existing[0].high24h, safePrice),
        low24h: Math.min(existing[0].low24h, safePrice),
        enabled,
        scheduleJson: null,
        updatedAt: now,
      })
      .where(eq(customCoins.id, existing[0].id))
      .returning();
    return mapCoinRowWithSchedule(updated, now.getTime());
  }

  const [created] = await db
    .insert(customCoins)
    .values({
      symbol,
      label,
      shortName,
      currentPrice: safePrice,
      openPrice24h: safePrice,
      high24h: safePrice,
      low24h: safePrice,
      enabled,
      scheduleJson: null,
      updatedAt: now,
    })
    .returning();
  return mapCoinRowWithSchedule(created, now.getTime());
}

export async function deleteCustomCoin(rawSymbol: string): Promise<boolean> {
  const { symbol } = normalizeSymbolParts(rawSymbol);
  lastRecordedCandleBySymbol.delete(symbol);
  lastLiqCheckBySymbol.delete(symbol);
  await db.delete(customCoinCandles).where(eq(customCoinCandles.symbol, symbol)).catch(() => {});
  const deleted = await db
    .delete(customCoins)
    .where(eq(customCoins.symbol, symbol))
    .returning({ id: customCoins.id });
  return deleted.length > 0;
}

export async function getCustomCoinKlines(
  rawSymbol: string,
  timeframe: ChartTimeframe,
  limit = 360
): Promise<OhlcvCandle[]> {
  const { symbol } = normalizeSymbolParts(rawSymbol);
  const coinRows = await db.select().from(customCoins).where(eq(customCoins.symbol, symbol)).limit(1);
  if (!coinRows[0]) return [];

  const liveCoin = await mapCoinRowWithSchedule(coinRows[0], Date.now());
  const candleRows = await db
    .select()
    .from(customCoinCandles)
    .where(eq(customCoinCandles.symbol, symbol))
    .orderBy(asc(customCoinCandles.bucketTimeMs));

  const recorded1m: OhlcvCandle[] = candleRows.map((c) => ({
    time: Number(c.bucketTimeMs),
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: Number(c.volume),
  }));

  const safeLimit = Math.min(500, Math.max(60, Math.round(limit)));
  return buildPersistentChartCandles(symbol, recorded1m, liveCoin.currentPrice, timeframe, safeLimit, Date.now());
}

export async function updateCoinPriceControl(
  rawSymbol: string,
  payload: {
    mode?: 'manual' | 'glide_to_target' | 'up_then_down' | 'down_sweep' | 'stop' | 'pause' | 'resume';
    manualPrice?: number;
    deltaPct?: number;
    transitionSec?: number;
    upTargetPrice?: number;
    upDurationSec?: number;
    downTargetPrice?: number;
    downDurationSec?: number;
    repeatLoop?: boolean;
    enabled?: boolean;
    trendBias?: CoinTrendBias;
    volatilityLevel?: CoinVolatilityLevel;
    resetBaseline?: boolean;
  }
): Promise<AdminManagedCoin | null> {
  const { symbol } = normalizeSymbolParts(rawSymbol);
  const rows = await db.select().from(customCoins).where(eq(customCoins.symbol, symbol)).limit(1);
  const existing = rows[0];
  if (!existing) return null;

  const nowMs = Date.now();
  const currentEvaluated = await mapCoinRowWithSchedule(existing, nowMs);
  const existingSched = currentEvaluated.schedule;
  const nextTrendBias: CoinTrendBias = payload.trendBias ?? existingSched?.trendBias ?? 'neutral';
  const nextVolatility: CoinVolatilityLevel = payload.volatilityLevel ?? existingSched?.volatilityLevel ?? 'normal';

  let nextPrice = currentEvaluated.currentPrice;
  let nextOpen = payload.resetBaseline ? nextPrice : Number(existing.openPrice24h);
  let nextHigh = payload.resetBaseline ? nextPrice : currentEvaluated.high24h;
  let nextLow = payload.resetBaseline ? nextPrice : currentEvaluated.low24h;
  let nextSchedule: AdminPriceSchedule | null = existingSched
    ? {
        ...existingSched,
        trendBias: nextTrendBias,
        volatilityLevel: nextVolatility,
      }
    : {
        mode: 'manual',
        startedAtMs: nowMs,
        startPrice: nextPrice,
        upTargetPrice: nextPrice,
        upDurationSec: 0,
        downTargetPrice: nextPrice,
        downDurationSec: 0,
        active: false,
        paused: false,
        trendBias: nextTrendBias,
        volatilityLevel: nextVolatility,
      };
  const nextEnabled = typeof payload.enabled === 'boolean' ? payload.enabled : existing.enabled;

  const transitionSec =
    typeof payload.transitionSec === 'number' && Number.isFinite(payload.transitionSec)
      ? Math.max(0, Math.min(3600, payload.transitionSec))
      : 0;

  if (typeof payload.deltaPct === 'number' && Number.isFinite(payload.deltaPct) && payload.deltaPct !== 0) {
    const targetPrice = formatRoundedPrice(
      Math.max(0.0001, currentEvaluated.currentPrice * (1 + payload.deltaPct / 100))
    );
    if (transitionSec > 0) {
      nextSchedule = {
        mode: 'glide_to_target',
        startedAtMs: nowMs,
        startPrice: nextPrice,
        upTargetPrice: targetPrice,
        upDurationSec: transitionSec,
        downTargetPrice: targetPrice,
        downDurationSec: transitionSec,
        repeatLoop: false,
        paused: false,
        trendBias: nextTrendBias,
        volatilityLevel: nextVolatility,
        active: true,
      };
    } else {
      nextPrice = targetPrice;
      nextHigh = Math.max(nextHigh, nextPrice);
      nextLow = Math.min(nextLow, nextPrice);
      nextSchedule = {
        mode: 'manual',
        startedAtMs: nowMs,
        startPrice: nextPrice,
        upTargetPrice: nextPrice,
        upDurationSec: 0,
        downTargetPrice: nextPrice,
        downDurationSec: 0,
        paused: false,
        trendBias: nextTrendBias,
        volatilityLevel: nextVolatility,
        active: false,
      };
    }
  } else if (
    (payload.mode === 'manual' || payload.mode === 'glide_to_target') &&
    typeof payload.manualPrice === 'number' &&
    payload.manualPrice > 0
  ) {
    const targetPrice = formatRoundedPrice(payload.manualPrice);
    const glideDur = payload.mode === 'glide_to_target' ? Math.max(1, transitionSec || 30) : transitionSec;
    if (glideDur > 0) {
      nextSchedule = {
        mode: 'glide_to_target',
        startedAtMs: nowMs,
        startPrice: nextPrice,
        upTargetPrice: targetPrice,
        upDurationSec: glideDur,
        downTargetPrice: targetPrice,
        downDurationSec: glideDur,
        repeatLoop: false,
        paused: false,
        trendBias: nextTrendBias,
        volatilityLevel: nextVolatility,
        active: true,
      };
    } else {
      nextPrice = targetPrice;
      nextHigh = Math.max(nextHigh, nextPrice);
      nextLow = Math.min(nextLow, nextPrice);
      nextSchedule = {
        mode: 'manual',
        startedAtMs: nowMs,
        startPrice: nextPrice,
        upTargetPrice: nextPrice,
        upDurationSec: 0,
        downTargetPrice: nextPrice,
        downDurationSec: 0,
        paused: false,
        trendBias: nextTrendBias,
        volatilityLevel: nextVolatility,
        active: false,
      };
    }
  } else if (payload.mode === 'pause') {
    if (nextSchedule) {
      nextSchedule = {
        ...nextSchedule,
        paused: true,
        pausedAtMs: nowMs,
      };
    }
  } else if (payload.mode === 'resume') {
    if (nextSchedule) {
      const pauseDelta = nextSchedule.pausedAtMs ? Math.max(0, nowMs - nextSchedule.pausedAtMs) : 0;
      nextSchedule = {
        ...nextSchedule,
        startedAtMs: nextSchedule.startedAtMs + pauseDelta,
        paused: false,
        pausedAtMs: undefined,
      };
    }
  } else if (payload.mode === 'stop') {
    nextSchedule = {
      ...(nextSchedule ?? {
        mode: 'manual',
        startedAtMs: nowMs,
        startPrice: nextPrice,
        upTargetPrice: nextPrice,
        upDurationSec: 0,
        downTargetPrice: nextPrice,
        downDurationSec: 0,
      }),
      active: false,
      repeatLoop: false,
      paused: false,
      pausedAtMs: undefined,
      trendBias: nextTrendBias,
      volatilityLevel: nextVolatility,
    };
  } else if (payload.mode === 'up_then_down') {
    const upTarget =
      typeof payload.upTargetPrice === 'number' && payload.upTargetPrice > 0
        ? payload.upTargetPrice
        : Number((nextPrice * 1.15).toFixed(3));
    const downTarget =
      typeof payload.downTargetPrice === 'number' && payload.downTargetPrice > 0
        ? payload.downTargetPrice
        : Number((nextPrice * 0.78).toFixed(3));
    nextSchedule = {
      mode: 'up_then_down',
      startedAtMs: nowMs,
      startPrice: nextPrice,
      upTargetPrice: upTarget,
      upDurationSec: Math.max(1, Number(payload.upDurationSec ?? 60)),
      downTargetPrice: downTarget,
      downDurationSec: Math.max(1, Number(payload.downDurationSec ?? 90)),
      repeatLoop: Boolean(payload.repeatLoop),
      paused: false,
      trendBias: nextTrendBias,
      volatilityLevel: nextVolatility,
      active: true,
    };
  } else if (payload.mode === 'down_sweep') {
    const downTarget =
      typeof payload.downTargetPrice === 'number' && payload.downTargetPrice > 0
        ? payload.downTargetPrice
        : Number((nextPrice * 0.75).toFixed(3));
    nextSchedule = {
      mode: 'down_sweep',
      startedAtMs: nowMs,
      startPrice: nextPrice,
      upTargetPrice: nextPrice,
      upDurationSec: 0,
      downTargetPrice: downTarget,
      downDurationSec: Math.max(1, Number(payload.downDurationSec ?? 45)),
      paused: false,
      trendBias: nextTrendBias,
      volatilityLevel: nextVolatility,
      active: true,
    };
  }

  const [updated] = await db
    .update(customCoins)
    .set({
      currentPrice: nextPrice,
      openPrice24h: nextOpen,
      high24h: nextHigh,
      low24h: nextLow,
      enabled: nextEnabled,
      scheduleJson: nextSchedule ? JSON.stringify(nextSchedule) : null,
      updatedAt: new Date(nowMs),
    })
    .where(eq(customCoins.id, existing.id))
    .returning();

  return mapCoinRowWithSchedule(updated, nowMs);
}

export async function recordCoinTrade(params: {
  tradeUid: string;
  symbol: string;
  userUid: string;
  userEmail: string;
  side: 'buy' | 'sell';
  leverage: number;
  margin: number;
  entryPrice: number;
  closePrice?: number | null;
  liqPrice?: number | null;
  tradingFee: number;
  pnlVal?: number;
  status: 'OPEN' | 'CLOSED' | 'LIQUIDATED';
  accountMode: 'demo' | 'real';
}): Promise<CoinTradeRecord> {
  const symbol = params.symbol.toUpperCase().replace('/', '').trim();
  const isFinal = params.status === 'CLOSED' || params.status === 'LIQUIDATED';
  const now = new Date();

  const [saved] = await db
    .insert(coinTrades)
    .values({
      tradeUid: params.tradeUid,
      symbol,
      userUid: params.userUid,
      userEmail: params.userEmail.toLowerCase(),
      side: params.side,
      leverage: Math.max(1, Math.round(params.leverage)),
      margin: params.margin,
      entryPrice: params.entryPrice,
      closePrice: params.closePrice ?? null,
      liqPrice: params.liqPrice ?? null,
      tradingFee: params.tradingFee,
      pnlVal: params.pnlVal ?? 0,
      status: params.status,
      accountMode: params.accountMode,
      openedAt: now,
      closedAt: isFinal ? now : null,
    })
    .onConflictDoUpdate({
      target: coinTrades.tradeUid,
      set: {
        closePrice: params.closePrice ?? null,
        tradingFee: params.tradingFee,
        pnlVal: params.pnlVal ?? 0,
        status: params.status,
        closedAt: isFinal ? now : null,
      },
    })
    .returning();

  return {
    id: saved.tradeUid,
    symbol: saved.symbol,
    userUid: saved.userUid,
    userEmail: saved.userEmail,
    side: saved.side === 'sell' ? 'sell' : 'buy',
    leverage: saved.leverage,
    margin: saved.margin,
    entryPrice: saved.entryPrice,
    closePrice: saved.closePrice,
    liqPrice: saved.liqPrice,
    tradingFee: saved.tradingFee,
    pnlVal: saved.pnlVal,
    status: (saved.status as CoinTradeRecord['status']) || 'OPEN',
    accountMode: saved.accountMode === 'real' ? 'real' : 'demo',
    openedAtMs: new Date(saved.openedAt).getTime(),
    closedAtMs: saved.closedAt ? new Date(saved.closedAt).getTime() : null,
  };
}

export async function getCoinTradeAnalytics(rawSymbol: string): Promise<CoinTradeAnalytics> {
  const symbol = rawSymbol.toUpperCase().replace('/', '').trim();
  const [tradeRows, claimRows] = await Promise.all([
    db.select().from(coinTrades).where(eq(coinTrades.symbol, symbol)).orderBy(desc(coinTrades.openedAt)),
    db.select().from(adminProfitClaims).where(eq(adminProfitClaims.symbol, symbol)).orderBy(desc(adminProfitClaims.claimedAt)),
  ]);

  const trades: CoinTradeRecord[] = tradeRows.map((r) => ({
    id: r.tradeUid,
    symbol: r.symbol,
    userUid: r.userUid,
    userEmail: r.userEmail,
    side: r.side === 'sell' ? 'sell' : 'buy',
    leverage: r.leverage,
    margin: r.margin,
    entryPrice: r.entryPrice,
    closePrice: r.closePrice,
    liqPrice: r.liqPrice,
    tradingFee: r.tradingFee,
    pnlVal: r.pnlVal,
    status: (r.status as CoinTradeRecord['status']) || 'OPEN',
    accountMode: r.accountMode === 'real' ? 'real' : 'demo',
    openedAtMs: new Date(r.openedAt).getTime(),
    closedAtMs: r.closedAt ? new Date(r.closedAt).getTime() : null,
  }));

  const claims: AdminProfitClaim[] = claimRows.map((c) => {
    const dt = new Date(c.claimedAt);
    return {
      id: `clm-${c.id}`,
      symbol: c.symbol,
      amountUsd: c.amountUsd,
      claimedByUid: c.claimedByUid,
      claimedByEmail: c.claimedByEmail,
      claimedAtLabel: dt.toLocaleString(),
      claimedAtMs: dt.getTime(),
    };
  });

  return summarizeCoinTradeAnalytics(symbol, trades, claims);
}

export async function claimAdminCoinProfit(params: {
  symbol: string;
  adminUid: string;
  adminEmail: string;
}): Promise<{
  claimedAmount: number;
  claim: AdminProfitClaim | null;
  updatedRealBalance: number | null;
  analytics: CoinTradeAnalytics;
}> {
  const symbol = params.symbol.toUpperCase().replace('/', '').trim();
  const before = await getCoinTradeAnalytics(symbol);
  if (before.claimableProfitUsd <= 0) {
    return {
      claimedAmount: 0,
      claim: null,
      updatedRealBalance: null,
      analytics: before,
    };
  }

  const amount = before.claimableProfitUsd;
  const [inserted] = await db
    .insert(adminProfitClaims)
    .values({
      symbol,
      amountUsd: amount,
      claimedByUid: params.adminUid,
      claimedByEmail: params.adminEmail.toLowerCase(),
    })
    .returning();

  let updatedRealBalance: number | null = null;
  const adminUser =
    (await findUserByIdentifier(params.adminUid)) ??
    (await findUserByIdentifier(params.adminEmail));
  if (adminUser) {
    const nextReal = Number((adminUser.realBalance + amount).toFixed(2));
    const [updated] = await db
      .update(users)
      .set({ realBalance: nextReal })
      .where(eq(users.uid, adminUser.uid))
      .returning();
    updatedRealBalance = updated?.realBalance ?? nextReal;
  }

  const after = await getCoinTradeAnalytics(symbol);
  const dt = new Date(inserted.claimedAt);
  return {
    claimedAmount: amount,
    claim: {
      id: `clm-${inserted.id}`,
      symbol: inserted.symbol,
      amountUsd: inserted.amountUsd,
      claimedByUid: inserted.claimedByUid,
      claimedByEmail: inserted.claimedByEmail,
      claimedAtLabel: dt.toLocaleString(),
      claimedAtMs: dt.getTime(),
    },
    updatedRealBalance,
    analytics: after,
  };
}
