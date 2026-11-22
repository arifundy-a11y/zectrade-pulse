import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getDocsFromServer,
  onSnapshot,
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
import {
  CHART_CACHE_VERSION,
  type ChartTimeframe,
  HISTORICAL_WAVE_CANDLES,
  type OhlcvCandle,
  generateForwardDeterministicCandles,
  getCandleBucketStartMs,
  hasFlatCandles,
  stepCandleBucketMs,
} from '../utils/chartEngine';
import {
  computeOrganicMarketTickPrice,
  computeScheduledCoinPrice,
  summarizeCoinTradeAnalytics,
} from '../utils/tradingEngine';
import { db, isFirebaseConfigured } from './firebaseClient';
import {
  randomHexId,
  readStorageJson,
  removeStorageKey,
  writeStorageJson,
} from './storageHelper';

export const CUSTOM_COINS_COLLECTION = 'custom_coins';
const COINS_STORAGE_KEY = 'zectrade_custom_coins_v1';
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

function normalizeAdminCoinDoc(raw: Partial<AdminManagedCoin> & Record<string, unknown>, docId?: string): AdminManagedCoin | null {
  const symRaw = String(raw.symbol || docId || '').trim();
  if (!symRaw) return null;
  const { symbol, label, shortName } = normalizeSymbolParts(
    symRaw,
    typeof raw.label === 'string' ? raw.label : undefined
  );
  const parsedCurrent = Number(raw.currentPrice);
  const parsedBase = Number(raw.basePrice);
  const safeBase =
    Number.isFinite(parsedBase) && parsedBase > 0
      ? parsedBase
      : Number.isFinite(parsedCurrent) && parsedCurrent > 0
        ? parsedCurrent
        : 100;
  const safeCurrent =
    Number.isFinite(parsedCurrent) && parsedCurrent > 0 ? parsedCurrent : safeBase;
  const schedule = (raw.schedule as AdminPriceSchedule | null | undefined) ?? null;
  const parsedTarget = raw.targetPrice != null ? Number(raw.targetPrice) : null;
  const effectiveTarget =
    parsedTarget !== null && Number.isFinite(parsedTarget) && parsedTarget > 0
      ? parsedTarget
      : schedule?.active
        ? schedule.downTargetPrice || schedule.upTargetPrice
        : safeBase;
  const open24h =
    Number.isFinite(Number(raw.openPrice24h)) && Number(raw.openPrice24h) > 0
      ? Number(raw.openPrice24h)
      : safeBase;
  const high24h =
    Number.isFinite(Number(raw.high24h)) && Number(raw.high24h) > 0
      ? Number(raw.high24h)
      : Math.max(safeBase, safeCurrent);
  const low24h =
    Number.isFinite(Number(raw.low24h)) && Number(raw.low24h) > 0
      ? Number(raw.low24h)
      : Math.min(safeBase, safeCurrent);
  const changePct =
    open24h > 0 ? Number((((safeCurrent - open24h) / open24h) * 100).toFixed(2)) : 0;

  return {
    symbol,
    label: typeof raw.label === 'string' && raw.label.trim() ? raw.label : label,
    shortName:
      typeof raw.shortName === 'string' && raw.shortName.trim() ? raw.shortName : shortName,
    basePrice: safeBase,
    targetPrice: effectiveTarget,
    currentPrice: safeCurrent,
    openPrice24h: open24h,
    changePct,
    high24h,
    low24h,
    enabled: raw.enabled === undefined ? true : Boolean(raw.enabled),
    schedule,
    updatedAtMs:
      typeof raw.updatedAtMs === 'number' && Number.isFinite(raw.updatedAtMs)
        ? raw.updatedAtMs
        : Date.now(),
  };
}

function readStoredCoins(): AdminManagedCoin[] {
  const saved = readStorageJson<StoredCoinsPayload | AdminManagedCoin[]>(COINS_STORAGE_KEY);
  if (Array.isArray(saved)) {
    const normalized = saved
      .map((c) => normalizeAdminCoinDoc(c as unknown as Record<string, unknown>, c.symbol))
      .filter((c): c is AdminManagedCoin => Boolean(c));
    writeStorageJson(COINS_STORAGE_KEY, { initialized: true, coins: normalized });
    return normalized;
  }
  if (saved && saved.initialized && Array.isArray(saved.coins)) {
    return saved.coins
      .map((c) => normalizeAdminCoinDoc(c as unknown as Record<string, unknown>, c.symbol))
      .filter((c): c is AdminManagedCoin => Boolean(c));
  }
  const seeded = createDefaultAdminCoins();
  writeStorageJson(COINS_STORAGE_KEY, { initialized: true, coins: seeded });
  return seeded;
}

function saveStoredCoins(coins: AdminManagedCoin[]): void {
  writeStorageJson(COINS_STORAGE_KEY, { initialized: true, coins });
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

/**
 * Evaluates a coin's live price purely from its Firestore anchor (`basePrice` + `schedule`)
 * and the shared UTC second (`Math.floor(nowMs / 1000)`), ensuring every connected phone
 * computes the exact same price to the cent at the exact same second without Math.random().
 */
export function evaluateCoinTick(
  coin: AdminManagedCoin,
  nowMs = Date.now(),
  runSideEffects = true
): {
  coin: AdminManagedCoin;
  persistedUpdate: boolean;
} {
  const utcSecMs = Math.floor(nowMs / 1000) * 1000;
  const schedule = coin.schedule;
  const anchorPrice =
    Number(coin.basePrice) > 0
      ? Number(coin.basePrice)
      : Number(coin.currentPrice) > 0
        ? Number(coin.currentPrice)
        : 100;

  let currentPrice = Number(coin.currentPrice) > 0 ? Number(coin.currentPrice) : anchorPrice;
  let nextBasePrice = anchorPrice;
  let high24h = Number(coin.high24h) > 0 ? Number(coin.high24h) : anchorPrice;
  let low24h = Number(coin.low24h) > 0 ? Number(coin.low24h) : anchorPrice;
  let nextSchedule = schedule;
  let persistedUpdate = false;

  const trendBias: CoinTrendBias = schedule?.trendBias ?? 'neutral';
  const amp = getVolatilityAmplitude(schedule?.volatilityLevel);

  if (schedule && schedule.active) {
    if (!schedule.paused) {
      const evaluated = computeScheduledCoinPrice(
        { currentPrice: anchorPrice, schedule },
        utcSecMs
      );
      currentPrice = evaluated.price;
      high24h = Math.max(high24h, currentPrice);
      low24h = Math.min(low24h, currentPrice);

      if (evaluated.completed) {
        nextBasePrice = evaluated.price;
        nextSchedule = {
          ...schedule,
          active: false,
          paused: false,
          pausedAtMs: undefined,
        };
        persistedUpdate = true;
      }
    }
  } else if (coin.enabled && !schedule?.paused) {
    currentPrice = computeOrganicMarketTickPrice(
      anchorPrice,
      coin.symbol,
      utcSecMs,
      amp,
      trendBias
    );
    high24h = Math.max(high24h, currentPrice);
    low24h = Math.min(low24h, currentPrice);
  }

  if (runSideEffects && coin.enabled) {
    autoLiquidateTradesLocally(coin.symbol, currentPrice, utcSecMs);
  }

  const open24h = Number(coin.openPrice24h) > 0 ? Number(coin.openPrice24h) : nextBasePrice;
  const changePct =
    open24h > 0 ? Number((((currentPrice - open24h) / open24h) * 100).toFixed(2)) : 0;

  return {
    coin: {
      ...coin,
      basePrice: nextBasePrice,
      targetPrice: coin.targetPrice ?? nextBasePrice,
      currentPrice,
      openPrice24h: open24h,
      changePct,
      high24h,
      low24h,
      schedule: nextSchedule,
      updatedAtMs: persistedUpdate ? utcSecMs : coin.updatedAtMs,
    },
    persistedUpdate,
  };
}

async function mirrorCoinToFirestore(coin: AdminManagedCoin): Promise<void> {
  if (!isFirebaseConfigured || !db) return;
  try {
    await setDoc(doc(db, CUSTOM_COINS_COLLECTION, coin.symbol), {
      ...coin,
      basePrice: coin.basePrice ?? coin.currentPrice,
      targetPrice: coin.targetPrice ?? coin.basePrice ?? coin.currentPrice,
    });
  } catch {
    // Graceful localStorage fallback
  }
}

async function deleteCoinFromFirestore(symbol: string): Promise<void> {
  if (!isFirebaseConfigured || !db) return;
  try {
    await deleteDoc(doc(db, CUSTOM_COINS_COLLECTION, symbol));
  } catch {
    // Graceful localStorage fallback
  }
}

export function getInitialAdminCoinsSync(includeDisabled = false): AdminManagedCoin[] {
  const nowMs = Date.now();
  const coins = readStoredCoins().map((c) => evaluateCoinTick(c, nowMs, false).coin);
  return includeDisabled ? coins : coins.filter((c) => c.enabled);
}

/**
 * Re-evaluates the already-synced custom coins deterministically for the current UTC second
 * without overwriting Firestore anchor prices or trusting stale cache timestamps.
 */
export function evaluateCustomCoinsForCurrentSecondStatic(
  includeDisabled = false,
  nowMs = Date.now()
): AdminManagedCoin[] {
  const coins = readStoredCoins();
  let anyCompleted = false;
  const nextStored: AdminManagedCoin[] = [];
  const evaluatedList: AdminManagedCoin[] = [];

  for (const rawCoin of coins) {
    const res = evaluateCoinTick(rawCoin, nowMs, true);
    evaluatedList.push(res.coin);
    if (res.persistedUpdate) {
      anyCompleted = true;
      nextStored.push(res.coin);
    } else {
      nextStored.push(rawCoin);
    }
  }

  if (anyCompleted) {
    saveStoredCoins(nextStored);
  }

  return includeDisabled ? evaluatedList : evaluatedList.filter((c) => c.enabled);
}

/**
 * Real-time Firestore listener (`onSnapshot`) on the shared `custom_coins` collection.
 * Always prioritizes and overwrites any stale `localStorage` coins/prices with the live
 * Firestore snapshot so all connected devices reflect Admin price updates immediately.
 */
export function subscribeToCustomCoinsStatic(
  includeDisabled: boolean,
  onCoins: (coins: AdminManagedCoin[]) => void
): () => void {
  if (!isFirebaseConfigured || !db) {
    onCoins(evaluateCustomCoinsForCurrentSecondStatic(includeDisabled));
    return () => {};
  }

  const colRef = collection(db, CUSTOM_COINS_COLLECTION);
  const unsub = onSnapshot(
    colRef,
    (snap) => {
      if (!snap.empty) {
        const remoteCoins: AdminManagedCoin[] = [];
        snap.forEach((docSnap) => {
          const parsed = normalizeAdminCoinDoc(
            docSnap.data() as Record<string, unknown>,
            docSnap.id
          );
          if (parsed) remoteCoins.push(parsed);
        });
        if (remoteCoins.length > 0) {
          saveStoredCoins(remoteCoins);
          const nowMs = Date.now();
          const evaluated = remoteCoins.map((c) => evaluateCoinTick(c, nowMs, true).coin);
          onCoins(includeDisabled ? evaluated : evaluated.filter((c) => c.enabled));
          return;
        }
      } else {
        const seeded = readStoredCoins();
        void Promise.all(seeded.map((c) => mirrorCoinToFirestore(c)));
      }
      onCoins(evaluateCustomCoinsForCurrentSecondStatic(includeDisabled));
    },
    () => {
      onCoins(evaluateCustomCoinsForCurrentSecondStatic(includeDisabled));
    }
  );

  return unsub;
}

export async function syncAndListCustomCoinsStatic(
  includeDisabled = false
): Promise<AdminManagedCoin[]> {
  const nowMs = Date.now();
  let coins = readStoredCoins();

  if (isFirebaseConfigured && db) {
    try {
      const colRef = collection(db, CUSTOM_COINS_COLLECTION);
      const snap = await getDocsFromServer(colRef).catch(() => getDocs(colRef));
      if (!snap.empty) {
        const remoteCoins: AdminManagedCoin[] = [];
        snap.forEach((d) => {
          const parsed = normalizeAdminCoinDoc(d.data() as Record<string, unknown>, d.id);
          if (parsed) remoteCoins.push(parsed);
        });
        if (remoteCoins.length > 0) {
          // Always prioritize & overwrite any stale localStorage coin/price with live Firestore data
          coins = remoteCoins;
          saveStoredCoins(remoteCoins);
        }
      } else {
        await Promise.all(coins.map((c) => mirrorCoinToFirestore(c)));
      }
    } catch {
      // Offline / rule fallback
    }
  }

  let anyCompleted = false;
  const nextStored: AdminManagedCoin[] = [];
  const evaluated = coins.map((c) => {
    const res = evaluateCoinTick(c, nowMs, true);
    if (res.persistedUpdate) {
      anyCompleted = true;
      nextStored.push(res.coin);
    } else {
      nextStored.push(c);
    }
    return res.coin;
  });

  if (anyCompleted) {
    saveStoredCoins(nextStored);
    void Promise.all(
      nextStored.filter((_, i) => evaluated[i]?.updatedAtMs !== coins[i]?.updatedAtMs).map(mirrorCoinToFirestore)
    );
  }

  return includeDisabled ? evaluated : evaluated.filter((c) => c.enabled);
}

const LEGACY_CHART_KEY_PREFIXES = [
  'zectrade_chart_v1',
  'zectrade_chart_v2',
  'zectrade_klines',
  'zectrade_kline',
];

function buildChartCacheKey(symbol: string, timeframe: ChartTimeframe): string {
  return `${CHART_CACHE_VERSION}_${symbol.toUpperCase().replace('/', '')}_${timeframe}`;
}

/**
 * Purges all legacy chart cache keys (v1/v2) and any v3 cache entries whose
 * historical candles contain consecutive flat bars (High === Low or identical closes).
 */
export function purgeStaleFlatCandleCaches(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k) continue;
      if (LEGACY_CHART_KEY_PREFIXES.some((prefix) => k.startsWith(prefix))) {
        keysToRemove.push(k);
        continue;
      }
      if (k.startsWith(`${CHART_CACHE_VERSION}_`)) {
        const raw = window.localStorage.getItem(k);
        if (!raw) {
          keysToRemove.push(k);
          continue;
        }
        try {
          const parsed = JSON.parse(raw) as OhlcvCandle[];
          if (!Array.isArray(parsed) || parsed.length < HISTORICAL_WAVE_CANDLES || hasFlatCandles(parsed)) {
            keysToRemove.push(k);
          }
        } catch {
          keysToRemove.push(k);
        }
      }
    }
    for (const key of keysToRemove) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage quota/security errors cleanly
  }
}

export function readCachedChartCandlesStatic(
  symbol: string,
  timeframe: ChartTimeframe
): OhlcvCandle[] | null {
  purgeStaleFlatCandleCaches();
  const key = buildChartCacheKey(symbol, timeframe);
  const cached = readStorageJson<OhlcvCandle[]>(key);
  if (!Array.isArray(cached) || cached.length < HISTORICAL_WAVE_CANDLES || hasFlatCandles(cached)) {
    removeStorageKey(key);
    return null;
  }
  return cached;
}

export function writeCachedChartCandlesStatic(
  symbol: string,
  timeframe: ChartTimeframe,
  candles: OhlcvCandle[]
): void {
  if (!Array.isArray(candles) || candles.length < HISTORICAL_WAVE_CANDLES || hasFlatCandles(candles)) {
    return;
  }
  writeStorageJson(buildChartCacheKey(symbol, timeframe), candles.slice(-500));
}

/**
 * Generates deterministic, immutable UTC-aligned OHLCV klines purely forward from the
 * authoritative coin (`basePrice`, `schedule`, `symbol`) and fixed UTC candle timestamps:
 * - Closed historical candles strictly depend only on their fixed UTC bucket timestamp and
 *   never shift when the live price moves or when a new candle opens.
 * - Adjacent candles share exact continuity (`candle[i].open === candle[i - 1].close`).
 */
export async function getCustomCoinKlinesStatic(
  rawSymbol: string,
  timeframe: ChartTimeframe,
  limit = HISTORICAL_WAVE_CANDLES
): Promise<OhlcvCandle[]> {
  purgeStaleFlatCandleCaches();
  const { symbol } = normalizeSymbolParts(rawSymbol);
  const coins = await syncAndListCustomCoinsStatic(true);
  const target = coins.find((c) => c.symbol === symbol);
  if (!target) return [];

  const nowMs = Date.now();
  const utcSecMs = Math.floor(nowMs / 1000) * 1000;
  const liveCoin = evaluateCoinTick(target, utcSecMs, false).coin;
  const safeLimit = Math.min(500, Math.max(HISTORICAL_WAVE_CANDLES, Math.round(limit)));
  const currentBucketStart = getCandleBucketStartMs(utcSecMs, timeframe);
  const prevBucketStart = stepCandleBucketMs(currentBucketStart, timeframe, -1);

  const forwardOptions = {
    trendBias: target.schedule?.trendBias ?? 'neutral',
    volatilityLevel: target.schedule?.volatilityLevel ?? 'normal',
  } as const;

  const anchorBasePrice =
    typeof target.basePrice === 'number' && Number.isFinite(target.basePrice) && target.basePrice > 0
      ? target.basePrice
      : target.currentPrice;

  const historicalBars = generateForwardDeterministicCandles(
    symbol,
    anchorBasePrice,
    timeframe,
    safeLimit - 1,
    prevBucketStart,
    forwardOptions
  );

  // Sample deterministic intra-bucket ticks from currentBucketStart to utcSecMs for accurate live wicks
  const liveOpen = historicalBars[historicalBars.length - 1]?.close ?? anchorBasePrice;
  const liveClose = liveCoin.currentPrice;
  let liveHigh = Math.max(liveOpen, liveClose);
  let liveLow = Math.min(liveOpen, liveClose);

  const elapsedMs = Math.max(0, utcSecMs - currentBucketStart);
  if (elapsedMs >= 2000) {
    for (let step = 1; step <= 8; step++) {
      const sampleTs =
        currentBucketStart + Math.floor(((elapsedMs * step) / 9) / 1000) * 1000;
      const samplePrice = evaluateCoinTick(target, sampleTs, false).coin.currentPrice;
      if (Number.isFinite(samplePrice) && samplePrice > 0) {
        liveHigh = Math.max(liveHigh, samplePrice);
        liveLow = Math.min(liveLow, samplePrice);
      }
    }
  }

  const movePct = liveOpen > 0 ? Math.abs(liveClose - liveOpen) / liveOpen : 0;
  const rangePct = liveOpen > 0 ? (liveHigh - liveLow) / liveOpen : 0;
  const elapsedMinutes = Math.max(0.02, elapsedMs / 60_000);
  const volBase = anchorBasePrice > 10000 ? 18 : anchorBasePrice > 1000 ? 110 : 680;
  const liveCandle: OhlcvCandle = {
    time: currentBucketStart,
    open: liveOpen,
    high: liveHigh,
    low: liveLow,
    close: liveClose,
    volume: Number(
      (volBase * Math.min(4, Math.sqrt(elapsedMinutes)) * (0.2 + (movePct + rangePct) * 180)).toFixed(2)
    ),
  };

  const series = [...historicalBars, liveCandle];
  writeCachedChartCandlesStatic(symbol, timeframe, series);
  return series;
}

export async function upsertCustomCoinStatic(params: {
  symbol: string;
  label?: string;
  initialPrice: number;
  enabled?: boolean;
}): Promise<AdminManagedCoin> {
  const { symbol, label, shortName } = normalizeSymbolParts(params.symbol, params.label);
  const safePrice =
    Number.isFinite(params.initialPrice) && params.initialPrice > 0 ? params.initialPrice : 100;
  const enabled = params.enabled ?? true;
  const nowMs = Date.now();

  const coins = readStoredCoins();
  const existing = coins.find((c) => c.symbol === symbol);

  const savedCoin: AdminManagedCoin = existing
    ? {
        ...existing,
        label,
        shortName,
        basePrice: safePrice,
        targetPrice: safePrice,
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
        basePrice: safePrice,
        targetPrice: safePrice,
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
  return evaluateCoinTick(savedCoin, nowMs, false).coin;
}

export async function deleteCustomCoinStatic(rawSymbol: string): Promise<boolean> {
  const { symbol } = normalizeSymbolParts(rawSymbol);
  const coins = readStoredCoins();
  const exists = coins.some((c) => c.symbol === symbol);
  if (!exists) return false;

  saveStoredCoins(coins.filter((c) => c.symbol !== symbol));
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
  const currentEvaluated = evaluateCoinTick(existing, nowMs, false).coin;
  const existingSched = currentEvaluated.schedule;
  const nextTrendBias: CoinTrendBias = payload.trendBias ?? existingSched?.trendBias ?? 'neutral';
  const nextVolatility: CoinVolatilityLevel =
    payload.volatilityLevel ?? existingSched?.volatilityLevel ?? 'normal';

  let nextPrice = currentEvaluated.currentPrice;
  let nextBasePrice = nextPrice;
  let nextTargetPrice: number | null = existing.targetPrice ?? nextPrice;
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
    nextTargetPrice = targetPrice;
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
      nextBasePrice = targetPrice;
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
    nextTargetPrice = targetPrice;
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
      nextBasePrice = targetPrice;
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
    nextBasePrice = nextPrice;
    nextTargetPrice = nextPrice;
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
    nextTargetPrice = downTarget;
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
    nextTargetPrice = downTarget;
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
  } else {
    // Applying trendBias / volatilityLevel / enabled toggle only: keep existing anchor
    nextBasePrice = Number(existing.basePrice ?? nextPrice);
  }

  const changePct = nextOpen > 0 ? Number((((nextPrice - nextOpen) / nextOpen) * 100).toFixed(2)) : 0;
  const updated: AdminManagedCoin = {
    ...existing,
    basePrice: nextBasePrice,
    targetPrice: nextTargetPrice,
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
  return evaluateCoinTick(updated, nowMs, false).coin;
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
