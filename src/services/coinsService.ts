import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  setDoc,
} from 'firebase/firestore';
import { createDefaultAdminCoins } from '../data/defaults';
import type {
  AdminManagedCoin,
  AdminPriceSchedule,
  AdminProfitClaim,
  CoinTradeAnalytics,
  CoinTradeRecord,
  CoinTrendBias,
  CoinVolatilityLevel,
} from '../types';
import { type ChartTimeframe, type OhlcvCandle, buildPersistentChartCandles } from '../utils/chartEngine';
import {
  computeOrganicMarketTickPrice,
  computeScheduledCoinPrice,
  summarizeCoinTradeAnalytics,
} from '../utils/tradingEngine';
import { db, isFirebaseConfigured } from './firebaseClient';
import { randomHexId, readStorageJson, writeStorageJson } from './storageHelper';

const COINS_STORAGE_KEY = 'zectrade_custom_coins_v1';
const COIN_CANDLES_KEY = 'zectrade_coin_candles_v1';
const COIN_TRADES_KEY = 'zectrade_coin_trades_v1';
const COIN_CLAIMS_KEY = 'zectrade_coin_claims_v1';

interface StoredCoinsPayload {
  initialized: boolean;
  coins: AdminManagedCoin[];
}

function normalizeSymbolParts(rawSymbol: string, rawLabel?: string): {
  symbol: string;
  label: string;
  shortName: string;
} {
  const cleaned = rawSymbol.toUpperCase().replace(/[^A-Z0-9/]/g, '').trim();
  const compact = cleaned.replace('/', '');
  const symbol =
    compact.endsWith('USDT') || compact === 'GOLD' || compact === 'USOIL'
      ? compact
      : `${compact}USDT`;
  const base = symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol;
  const shortName = `${base}/USDT`;
  const label = rawLabel?.trim() || `${base} / USDT`;
  return { symbol, label, shortName };
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

function readStoredCoins(): AdminManagedCoin[] {
  const saved = readStorageJson<StoredCoinsPayload | AdminManagedCoin[]>(COINS_STORAGE_KEY);
  if (Array.isArray(saved)) {
    writeStorageJson(COINS_STORAGE_KEY, { initialized: true, coins: saved });
    return saved;
  }
  if (saved && saved.initialized && Array.isArray(saved.coins)) {
    return saved.coins;
  }
  const seeded = createDefaultAdminCoins();
  writeStorageJson(COINS_STORAGE_KEY, { initialized: true, coins: seeded });
  return seeded;
}

function saveStoredCoins(coins: AdminManagedCoin[]): void {
  writeStorageJson(COINS_STORAGE_KEY, { initialized: true, coins });
}

function readCandlesMap(): Record<string, OhlcvCandle[]> {
  return readStorageJson<Record<string, OhlcvCandle[]>>(COIN_CANDLES_KEY) ?? {};
}

function saveCandlesMap(map: Record<string, OhlcvCandle[]>): void {
  writeStorageJson(COIN_CANDLES_KEY, map);
}

function readStoredTrades(): CoinTradeRecord[] {
  return readStorageJson<CoinTradeRecord[]>(COIN_TRADES_KEY) ?? [];
}

function saveStoredTrades(trades: CoinTradeRecord[]): void {
  writeStorageJson(COIN_TRADES_KEY, trades.slice(0, 500));
}

function readStoredClaims(): AdminProfitClaim[] {
  return readStorageJson<AdminProfitClaim[]>(COIN_CLAIMS_KEY) ?? [];
}

function saveStoredClaims(claims: AdminProfitClaim[]): void {
  writeStorageJson(COIN_CLAIMS_KEY, claims.slice(0, 200));
}

const lastRecordedCandleBySymbol = new Map<string, { bucketTimeMs: number; price: number }>();

function recordLocalCoinCandleTick(symbol: string, price: number, nowMs: number): void {
  if (!Number.isFinite(price) || price <= 0) return;
  const bucketTimeMs = Math.floor(nowMs / 60_000) * 60_000;
  const cached = lastRecordedCandleBySymbol.get(symbol);
  if (cached && cached.bucketTimeMs === bucketTimeMs && Math.abs(cached.price - price) < 0.00001) {
    return;
  }

  const map = readCandlesMap();
  const list = Array.isArray(map[symbol]) ? [...map[symbol]] : [];
  const last = list[list.length - 1];
  const openPrice = cached ? cached.price : last ? last.close : price;
  const tickVol = Number((Math.max(8, Math.abs(price - openPrice) * 65 + 6)).toFixed(2));
  lastRecordedCandleBySymbol.set(symbol, { bucketTimeMs, price });

  if (last && last.time === bucketTimeMs) {
    list[list.length - 1] = {
      ...last,
      high: Math.max(last.high, price),
      low: Math.min(last.low, price),
      close: price,
      volume: Number((last.volume + tickVol).toFixed(2)),
    };
  } else {
    list.push({
      time: bucketTimeMs,
      open: openPrice,
      high: Math.max(openPrice, price),
      low: Math.min(openPrice, price),
      close: price,
      volume: tickVol,
    });
  }

  map[symbol] = list.slice(-500);
  saveCandlesMap(map);
}

function autoLiquidateTradesLocally(symbol: string, currentPrice: number, nowMs: number): void {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return;
  const trades = readStoredTrades();
  let changed = false;
  const updated = trades.map((t) => {
    if (t.symbol !== symbol || t.status !== 'OPEN' || !t.liqPrice || t.liqPrice <= 0) return t;
    const hitLong = t.side === 'buy' && currentPrice <= t.liqPrice;
    const hitShort = t.side === 'sell' && currentPrice >= t.liqPrice;
    if (!hitLong && !hitShort) return t;
    changed = true;
    return {
      ...t,
      status: 'LIQUIDATED' as const,
      closePrice: currentPrice,
      pnlVal: -t.margin,
      closedAtMs: nowMs,
    };
  });
  if (changed) saveStoredTrades(updated);
}

function evaluateCoinTick(coin: AdminManagedCoin, nowMs = Date.now()): {
  coin: AdminManagedCoin;
  persistedUpdate: boolean;
} {
  const schedule = coin.schedule;
  let currentPrice = Number(coin.currentPrice);
  let high24h = Number(coin.high24h);
  let low24h = Number(coin.low24h);
  let nextSchedule = schedule;
  let persistedUpdate = false;

  const trendBias: CoinTrendBias = schedule?.trendBias ?? 'neutral';
  const amp = getVolatilityAmplitude(schedule?.volatilityLevel);

  if (schedule && schedule.active) {
    if (!schedule.paused) {
      const evaluated = computeScheduledCoinPrice({ currentPrice, schedule }, nowMs);
      currentPrice = evaluated.price;
      high24h = Math.max(high24h, currentPrice);
      low24h = Math.min(low24h, currentPrice);

      if (evaluated.completed) {
        nextSchedule = {
          ...schedule,
          active: false,
          paused: false,
          pausedAtMs: undefined,
        };
        persistedUpdate = true;
      } else if (Math.abs(currentPrice - coin.currentPrice) > 0.00001) {
        persistedUpdate = true;
      }
    }
  } else if (coin.enabled && !schedule?.paused) {
    currentPrice = computeOrganicMarketTickPrice(currentPrice, coin.symbol, nowMs, amp, trendBias);
    high24h = Math.max(high24h, currentPrice);
    low24h = Math.min(low24h, currentPrice);
  }

  if (coin.enabled) {
    recordLocalCoinCandleTick(coin.symbol, currentPrice, nowMs);
    autoLiquidateTradesLocally(coin.symbol, currentPrice, nowMs);
  }

  const open24h = Number(coin.openPrice24h) > 0 ? Number(coin.openPrice24h) : currentPrice;
  const changePct = open24h > 0 ? Number((((currentPrice - open24h) / open24h) * 100).toFixed(2)) : 0;

  return {
    coin: {
      ...coin,
      currentPrice,
      openPrice24h: open24h,
      changePct,
      high24h,
      low24h,
      schedule: nextSchedule,
      updatedAtMs: persistedUpdate ? nowMs : coin.updatedAtMs,
    },
    persistedUpdate,
  };
}

async function mirrorCoinToFirestore(coin: AdminManagedCoin): Promise<void> {
  if (!isFirebaseConfigured || !db) return;
  try {
    await setDoc(doc(db, 'customCoins', coin.symbol), coin);
  } catch {
    // Graceful localStorage fallback
  }
}

async function deleteCoinFromFirestore(symbol: string): Promise<void> {
  if (!isFirebaseConfigured || !db) return;
  try {
    await deleteDoc(doc(db, 'customCoins', symbol));
  } catch {
    // Graceful localStorage fallback
  }
}

export function getInitialAdminCoinsSync(includeDisabled = false): AdminManagedCoin[] {
  const coins = readStoredCoins();
  return includeDisabled ? coins : coins.filter((c) => c.enabled);
}

export async function syncAndListCustomCoinsStatic(includeDisabled = false): Promise<AdminManagedCoin[]> {
  const nowMs = Date.now();
  let coins = readStoredCoins();

  if (isFirebaseConfigured && db) {
    try {
      const snap = await getDocs(collection(db, 'customCoins'));
      if (!snap.empty) {
        const map = new Map(coins.map((c) => [c.symbol, c]));
        snap.forEach((d) => {
          const remote = d.data() as AdminManagedCoin;
          if (!remote?.symbol) return;
          const local = map.get(remote.symbol);
          if (!local || Number(remote.updatedAtMs ?? 0) > Number(local.updatedAtMs ?? 0)) {
            map.set(remote.symbol, remote);
          }
        });
        coins = Array.from(map.values());
      } else {
        await Promise.all(coins.map((c) => mirrorCoinToFirestore(c)));
      }
    } catch {
      // Offline / rule fallback
    }
  }

  let anyPersisted = false;
  const evaluated = coins.map((c) => {
    const res = evaluateCoinTick(c, nowMs);
    if (res.persistedUpdate) anyPersisted = true;
    return res.coin;
  });

  if (anyPersisted) {
    saveStoredCoins(evaluated);
  } else {
    saveStoredCoins(coins);
  }

  return includeDisabled ? evaluated : evaluated.filter((c) => c.enabled);
}

export async function getCustomCoinKlinesStatic(
  rawSymbol: string,
  timeframe: ChartTimeframe,
  limit = 360
): Promise<OhlcvCandle[]> {
  const { symbol } = normalizeSymbolParts(rawSymbol);
  const coins = readStoredCoins();
  const target = coins.find((c) => c.symbol === symbol);
  if (!target) return [];

  const nowMs = Date.now();
  const liveCoin = evaluateCoinTick(target, nowMs).coin;
  const map = readCandlesMap();
  const recorded1m = Array.isArray(map[symbol]) ? map[symbol] : [];
  const safeLimit = Math.min(500, Math.max(60, Math.round(limit)));
  return buildPersistentChartCandles(symbol, recorded1m, liveCoin.currentPrice, timeframe, safeLimit, nowMs);
}

export async function upsertCustomCoinStatic(params: {
  symbol: string;
  label?: string;
  initialPrice: number;
  enabled?: boolean;
}): Promise<AdminManagedCoin> {
  const { symbol, label, shortName } = normalizeSymbolParts(params.symbol, params.label);
  const safePrice = Number.isFinite(params.initialPrice) && params.initialPrice > 0 ? params.initialPrice : 100;
  const enabled = params.enabled ?? true;
  const nowMs = Date.now();

  const coins = readStoredCoins();
  const existing = coins.find((c) => c.symbol === symbol);

  const savedCoin: AdminManagedCoin = existing
    ? {
        ...existing,
        label,
        shortName,
        currentPrice: safePrice,
        openPrice24h: safePrice,
        changePct: 0,
        high24h: Math.max(existing.high24h, safePrice),
        low24h: Math.min(existing.low24h, safePrice),
        enabled,
        schedule: null,
        updatedAtMs: nowMs,
      }
    : {
        symbol,
        label,
        shortName,
        currentPrice: safePrice,
        openPrice24h: safePrice,
        changePct: 0,
        high24h: safePrice,
        low24h: safePrice,
        enabled,
        schedule: null,
        updatedAtMs: nowMs,
      };

  const nextList = existing
    ? coins.map((c) => (c.symbol === symbol ? savedCoin : c))
    : [savedCoin, ...coins];
  saveStoredCoins(nextList);
  await mirrorCoinToFirestore(savedCoin);
  return evaluateCoinTick(savedCoin, nowMs).coin;
}

export async function deleteCustomCoinStatic(rawSymbol: string): Promise<boolean> {
  const { symbol } = normalizeSymbolParts(rawSymbol);
  lastRecordedCandleBySymbol.delete(symbol);
  const coins = readStoredCoins();
  const exists = coins.some((c) => c.symbol === symbol);
  if (!exists) return false;

  saveStoredCoins(coins.filter((c) => c.symbol !== symbol));
  const candles = readCandlesMap();
  delete candles[symbol];
  saveCandlesMap(candles);
  await deleteCoinFromFirestore(symbol);
  return true;
}

export async function updateCoinPriceControlStatic(
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
  const coins = readStoredCoins();
  const idx = coins.findIndex((c) => c.symbol === symbol);
  if (idx < 0) return null;

  const nowMs = Date.now();
  const existing = coins[idx];
  const currentEvaluated = evaluateCoinTick(existing, nowMs).coin;
  const existingSched = currentEvaluated.schedule;
  const nextTrendBias: CoinTrendBias = payload.trendBias ?? existingSched?.trendBias ?? 'neutral';
  const nextVolatility: CoinVolatilityLevel = payload.volatilityLevel ?? existingSched?.volatilityLevel ?? 'normal';

  let nextPrice = currentEvaluated.currentPrice;
  const nextOpen = payload.resetBaseline ? nextPrice : Number(existing.openPrice24h);
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

  const changePct = nextOpen > 0 ? Number((((nextPrice - nextOpen) / nextOpen) * 100).toFixed(2)) : 0;
  const updated: AdminManagedCoin = {
    ...existing,
    currentPrice: nextPrice,
    openPrice24h: nextOpen,
    changePct,
    high24h: nextHigh,
    low24h: nextLow,
    enabled: nextEnabled,
    schedule: nextSchedule,
    updatedAtMs: nowMs,
  };

  const nextList = [...coins];
  nextList[idx] = updated;
  saveStoredCoins(nextList);
  await mirrorCoinToFirestore(updated);
  return evaluateCoinTick(updated, nowMs).coin;
}

export async function recordCoinTradeStatic(params: {
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
  const nowMs = Date.now();

  const trades = readStoredTrades();
  const existingIdx = trades.findIndex((t) => t.id === params.tradeUid);
  const record: CoinTradeRecord = {
    id: params.tradeUid,
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
    openedAtMs: existingIdx >= 0 ? trades[existingIdx].openedAtMs : nowMs,
    closedAtMs: isFinal ? nowMs : null,
  };

  if (existingIdx >= 0) {
    trades[existingIdx] = record;
  } else {
    trades.unshift(record);
  }
  saveStoredTrades(trades);

  if (isFirebaseConfigured && db) {
    try {
      await setDoc(doc(db, 'coinTrades', record.id), record);
    } catch {
      // Graceful localStorage fallback
    }
  }

  return record;
}

export async function getCoinTradeAnalyticsStatic(rawSymbol: string): Promise<CoinTradeAnalytics> {
  const symbol = rawSymbol.toUpperCase().replace('/', '').trim();
  let trades = readStoredTrades().filter((t) => t.symbol === symbol);
  let claims = readStoredClaims().filter((c) => c.symbol === symbol);

  if (isFirebaseConfigured && db) {
    try {
      const [tradeSnap, claimSnap] = await Promise.all([
        getDocs(collection(db, 'coinTrades')),
        getDocs(collection(db, 'adminProfitClaims')),
      ]);
      if (!tradeSnap.empty) {
        const tradeMap = new Map(readStoredTrades().map((t) => [t.id, t]));
        tradeSnap.forEach((d) => {
          const r = d.data() as CoinTradeRecord;
          if (r?.id) tradeMap.set(r.id, r);
        });
        const allTrades = Array.from(tradeMap.values()).sort((a, b) => b.openedAtMs - a.openedAtMs);
        saveStoredTrades(allTrades);
        trades = allTrades.filter((t) => t.symbol === symbol);
      }
      if (!claimSnap.empty) {
        const claimMap = new Map(readStoredClaims().map((c) => [c.id, c]));
        claimSnap.forEach((d) => {
          const c = d.data() as AdminProfitClaim;
          if (c?.id) claimMap.set(c.id, c);
        });
        const allClaims = Array.from(claimMap.values()).sort((a, b) => b.claimedAtMs - a.claimedAtMs);
        saveStoredClaims(allClaims);
        claims = allClaims.filter((c) => c.symbol === symbol);
      }
    } catch {
      // Keep local trades & claims
    }
  }

  return summarizeCoinTradeAnalytics(symbol, trades, claims);
}

export async function claimAdminCoinProfitStatic(params: {
  symbol: string;
  adminUid: string;
  adminEmail: string;
}): Promise<{
  claimedAmount: number;
  claim: AdminProfitClaim | null;
  analytics: CoinTradeAnalytics;
}> {
  const symbol = params.symbol.toUpperCase().replace('/', '').trim();
  const before = await getCoinTradeAnalyticsStatic(symbol);
  if (before.claimableProfitUsd <= 0) {
    return {
      claimedAmount: 0,
      claim: null,
      analytics: before,
    };
  }

  const nowMs = Date.now();
  const amount = before.claimableProfitUsd;
  const claim: AdminProfitClaim = {
    id: `clm-${randomHexId(4)}`,
    symbol,
    amountUsd: amount,
    claimedByUid: params.adminUid,
    claimedByEmail: params.adminEmail.toLowerCase(),
    claimedAtLabel: new Date(nowMs).toLocaleString(),
    claimedAtMs: nowMs,
  };

  const claims = [claim, ...readStoredClaims()];
  saveStoredClaims(claims);

  if (isFirebaseConfigured && db) {
    try {
      await setDoc(doc(db, 'adminProfitClaims', claim.id), claim);
    } catch {
      // Graceful localStorage fallback
    }
  }

  const after = await getCoinTradeAnalyticsStatic(symbol);
  return {
    claimedAmount: amount,
    claim,
    analytics: after,
  };
}
