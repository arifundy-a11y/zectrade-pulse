import type { MarketSymbol } from '../types';

export type ChartTimeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w' | '1mo';

export interface OhlcvCandle {
  time: number; // unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export const TIMEFRAME_MS: Record<ChartTimeframe, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
  '1w': 7 * 86_400_000,
  '1mo': 30 * 86_400_000,
};

export function getBinanceKlineInterval(timeframe: ChartTimeframe): string {
  return timeframe === '1mo' ? '1M' : timeframe;
}

export function getBinanceKlineSymbol(symbol: MarketSymbol): string | null {
  switch (symbol) {
    case 'BTCUSDT':
    case 'ETHUSDT':
    case 'SOLUSDT':
    case 'BNBUSDT':
    case 'XRPUSDT':
    case 'DOGEUSDT':
    case 'ADAUSDT':
    case 'AVAXUSDT':
    case 'LINKUSDT':
    case 'TONUSDT':
      return symbol;
    case 'GOLD':
      return 'PAXGUSDT';
    case 'USOIL':
    default:
      return null;
  }
}

/**
 * Generates realistic trending & mean-reverting candlesticks anchored strictly to livePrice
 * so fallback/simulated charts (e.g. USOIL, custom coins, or offline) match live price scale cleanly.
 */
export function generateRealisticCandles(
  symbol: MarketSymbol,
  livePrice: number,
  timeframe: ChartTimeframe,
  count = 60,
  nowMs = Date.now()
): OhlcvCandle[] {
  const safeLive = Number.isFinite(livePrice) && livePrice > 0 ? livePrice : 100;
  const stepMs = TIMEFRAME_MS[timeframe];
  const stepVol =
    timeframe === '1m'
      ? 0.0018
      : timeframe === '5m'
      ? 0.0034
      : timeframe === '15m'
      ? 0.0055
      : timeframe === '1h'
      ? 0.0085
      : timeframe === '4h'
      ? 0.014
      : timeframe === '1d'
      ? 0.022
      : timeframe === '1w'
      ? 0.042
      : 0.075;

  const seedOffset = symbol.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);

  // Build backwards from safeLive so final close equals safeLive with natural waves
  const closes = new Array<number>(count);
  closes[count - 1] = safeLive;
  for (let i = count - 2; i >= 0; i--) {
    const t = i + seedOffset;
    const cyclical = Math.sin(t * 0.42) * 0.65 + Math.cos(t * 0.19) * 0.35;
    const micro = ((Math.sin(t * 12.9898) * 43758.5453) % 1) * 0.6;
    const pctDelta = (cyclical + micro) * stepVol;
    closes[i] = Math.max(0.01, closes[i + 1] / (1 + pctDelta));
  }

  const candles: OhlcvCandle[] = [];
  for (let i = 0; i < count; i++) {
    const close = closes[i];
    const open = i === 0 ? close * (1 - stepVol * 0.3) : closes[i - 1];
    const bodyMove = Math.abs(close - open);
    const baseSpread = close * stepVol * 0.45;
    const upperWick = baseSpread * (0.35 + Math.abs(Math.sin(i * 1.7 + seedOffset)) * 0.85);
    const lowerWick = baseSpread * (0.35 + Math.abs(Math.cos(i * 2.1 + seedOffset)) * 0.85);
    const high = Math.max(open, close) + upperWick;
    const low = Math.max(0.01, Math.min(open, close) - lowerWick);
    const volBase = safeLive > 10000 ? 38 : safeLive > 1000 ? 220 : 1450;
    const volume = Number(
      (volBase * (0.55 + (bodyMove / Math.max(0.01, baseSpread)) * 0.9 + Math.abs(Math.sin(i + seedOffset)) * 0.8)).toFixed(2)
    );

    candles.push({
      time: nowMs - (count - 1 - i) * stepMs,
      open,
      high,
      low,
      close,
      volume,
    });
  }
  return candles;
}

/**
 * Aligns any Unix timestamp to its exchange-standard UTC bucket start for the given timeframe.
 */
export function getCandleBucketStartMs(timeMs: number, timeframe: ChartTimeframe): number {
  if (timeframe === '1mo') {
    const d = new Date(timeMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0);
  }
  if (timeframe === '1w') {
    const d = new Date(timeMs);
    const dayOfWeek = d.getUTCDay(); // 0=Sun..6=Sat; Monday=1
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diffToMonday, 0, 0, 0, 0);
  }
  const stepMs = TIMEFRAME_MS[timeframe];
  return Math.floor(timeMs / stepMs) * stepMs;
}

/**
 * Aggregates recorded 1-minute OHLCV candles into higher timeframes (5m, 15m, 1h, 4h, 1d, 1w, 1mo)
 * preserving exact open, high, low, close, and cumulative volume.
 */
export function aggregateCandlesByTimeframe(
  oneMinCandles: OhlcvCandle[],
  timeframe: ChartTimeframe
): OhlcvCandle[] {
  if (oneMinCandles.length === 0) return [];
  const sorted = oneMinCandles.slice().sort((a, b) => a.time - b.time);
  const buckets = new Map<number, OhlcvCandle>();

  for (const bar of sorted) {
    const bucketStart = getCandleBucketStartMs(bar.time, timeframe);
    const existing = buckets.get(bucketStart);
    if (!existing) {
      buckets.set(bucketStart, {
        time: bucketStart,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: Number((bar.volume || 0).toFixed(2)),
      });
    } else {
      existing.high = Math.max(existing.high, bar.high);
      existing.low = Math.min(existing.low, bar.low);
      existing.close = bar.close;
      existing.volume = Number((existing.volume + (bar.volume || 0)).toFixed(2));
    }
  }

  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}

/**
 * Builds an exchange-consistent OHLCV history for Admin-managed custom coins:
 * - Preserves all permanently recorded 1m bars aggregated to the requested timeframe
 * - Anchors any pre-launch historical padding strictly to the immutable first recorded bar
 *   so earlier candles NEVER change or jump when livePrice moves or timeframes are switched.
 */
export function buildPersistentChartCandles(
  symbol: string,
  recorded1mBars: OhlcvCandle[],
  livePrice: number,
  timeframe: ChartTimeframe,
  totalCount = 360,
  nowMs = Date.now()
): OhlcvCandle[] {
  const safeLive = Number.isFinite(livePrice) && livePrice > 0 ? livePrice : 100;
  const currentBucketStart = getCandleBucketStartMs(nowMs, timeframe);

  if (recorded1mBars.length === 0) {
    return generateRealisticCandles(symbol, safeLive, timeframe, totalCount, currentBucketStart);
  }

  const aggregated = aggregateCandlesByTimeframe(recorded1mBars, timeframe);
  const stepMs = TIMEFRAME_MS[timeframe];

  // Fill forward or update the active current bucket with livePrice
  const lastRecorded = aggregated[aggregated.length - 1];
  if (lastRecorded.time < currentBucketStart) {
    // Bridge seamlessly to current bucket if coin was idle
    aggregated.push({
      time: currentBucketStart,
      open: lastRecorded.close,
      high: Math.max(lastRecorded.close, safeLive),
      low: Math.min(lastRecorded.close, safeLive),
      close: safeLive,
      volume: Number((Math.max(50, Math.abs(safeLive - lastRecorded.close) * 40)).toFixed(2)),
    });
  } else if (lastRecorded.time === currentBucketStart) {
    lastRecorded.close = safeLive;
    lastRecorded.high = Math.max(lastRecorded.high, safeLive);
    lastRecorded.low = Math.min(lastRecorded.low, safeLive);
  }

  if (aggregated.length >= totalCount) {
    return aggregated.slice(-totalCount);
  }

  // Deterministic pre-launch history anchored strictly to firstRecorded.open (immutable!)
  const firstRecorded = aggregated[0];
  const needed = totalCount - aggregated.length;
  const preBars = generateRealisticCandles(
    `${symbol}:prelaunch`,
    firstRecorded.open,
    timeframe,
    needed + 1,
    firstRecorded.time
  );
  // Drop the final anchor bar (which sits at firstRecorded.time) so timestamps step cleanly
  const prefix = preBars.slice(0, needed).map((bar, idx) => ({
    ...bar,
    time: firstRecorded.time - (needed - idx) * stepMs,
  }));

  return [...prefix, ...aggregated];
}

export function computeMovingAverage(candles: OhlcvCandle[], period: number): Array<number | null> {
  if (period <= 0) return candles.map(() => null);
  const out: Array<number | null> = new Array(candles.length).fill(null);
  let rollingSum = 0;
  for (let i = 0; i < candles.length; i++) {
    rollingSum += candles[i].close;
    if (i >= period) {
      rollingSum -= candles[i - period].close;
    }
    if (i >= period - 1) {
      out[i] = rollingSum / period;
    }
  }
  return out;
}

export function formatChartTimestamp(timeMs: number, timeframe: ChartTimeframe): string {
  const d = new Date(timeMs);
  const yyyy = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (timeframe === '1mo') {
    return `${yyyy}-${mo}`;
  }
  if (timeframe === '1w') {
    return `${yyyy}-${mo}-${day}`;
  }
  if (timeframe === '1d' || timeframe === '4h') {
    return `${mo}-${day} ${hh}:${mm}`;
  }
  return `${hh}:${mm}`;
}

export function formatChartPrice(price: number): string {
  if (!Number.isFinite(price)) return '0.00';
  if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (price >= 10) return price.toFixed(2);
  if (price >= 1) return price.toFixed(3);
  return price.toFixed(4);
}

export interface CandleCutOffInfo {
  remainingMs: number;
  countdownLabel: string;
  nextCloseMs: number;
  nextCloseClock: string;
}

/**
 * Calculates remaining time until the current candle closes (cut-off time)
 * for Binance/Bybit-aligned timeframe boundaries including 1w and 1mo.
 */
export function computeCandleCutOffCountdown(
  nowMs: number,
  timeframe: ChartTimeframe
): CandleCutOffInfo {
  let nextCloseMs: number;
  if (timeframe === '1mo') {
    const d = new Date(nowMs);
    nextCloseMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0);
  } else if (timeframe === '1w') {
    const d = new Date(nowMs);
    const dayOfWeek = d.getUTCDay(); // 0=Sun..6=Sat; Monday=1
    const daysUntilNextMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
    nextCloseMs = Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate() + daysUntilNextMonday,
      0,
      0,
      0,
      0
    );
  } else {
    const stepMs = TIMEFRAME_MS[timeframe];
    nextCloseMs = (Math.floor(nowMs / stepMs) + 1) * stepMs;
  }

  const remainingMs = Math.max(0, nextCloseMs - nowMs);
  const totalSec = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSec / 86400);
  const hrs = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  const countdownLabel =
    days > 0
      ? `${days}d ${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : hrs > 0 || timeframe === '1h' || timeframe === '4h' || timeframe === '1d' || timeframe === '1w' || timeframe === '1mo'
      ? `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  const closeDate = new Date(nextCloseMs);
  const cy = closeDate.getUTCFullYear();
  const cmo = String(closeDate.getUTCMonth() + 1).padStart(2, '0');
  const cd = String(closeDate.getUTCDate()).padStart(2, '0');
  const ch = String(closeDate.getHours()).padStart(2, '0');
  const cm = String(closeDate.getMinutes()).padStart(2, '0');
  const nextCloseClock =
    timeframe === '1w' || timeframe === '1mo'
      ? `${cy}-${cmo}-${cd}`
      : timeframe === '1d'
      ? `${String(closeDate.getMonth() + 1).padStart(2, '0')}-${String(closeDate.getDate()).padStart(2, '0')} ${ch}:${cm}`
      : `${ch}:${cm}`;

  return {
    remainingMs,
    countdownLabel,
    nextCloseMs,
    nextCloseClock,
  };
}

export interface VisibleChartWindow {
  startIdx: number;
  endIdx: number; // exclusive
  clampedVisible: number;
  clampedOffset: number;
}

export function computeVisibleWindow(
  totalCount: number,
  visibleCount: number,
  panOffsetFromEnd: number,
  minVisible = 12
): VisibleChartWindow {
  if (totalCount <= 0) {
    return { startIdx: 0, endIdx: 0, clampedVisible: 0, clampedOffset: 0 };
  }
  const safeMin = Math.min(minVisible, totalCount);
  const clampedVisible = Math.max(safeMin, Math.min(totalCount, Math.round(visibleCount)));
  const maxOffset = Math.max(0, totalCount - clampedVisible);
  const clampedOffset = Math.max(0, Math.min(maxOffset, Math.round(panOffsetFromEnd)));
  const endIdx = totalCount - clampedOffset;
  const startIdx = Math.max(0, endIdx - clampedVisible);
  return { startIdx, endIdx, clampedVisible, clampedOffset };
}

export function computeEma(candles: OhlcvCandle[], period: number): Array<number | null> {
  if (period <= 0 || candles.length === 0) return candles.map(() => null);
  const out: Array<number | null> = new Array(candles.length).fill(null);
  const k = 2 / (period + 1);
  let sum = 0;
  let ema: number | null = null;
  for (let i = 0; i < candles.length; i++) {
    const close = candles[i].close;
    if (i < period - 1) {
      sum += close;
      continue;
    }
    if (i === period - 1) {
      sum += close;
      ema = sum / period;
      out[i] = ema;
    } else if (ema !== null) {
      ema = close * k + ema * (1 - k);
      out[i] = ema;
    }
  }
  return out;
}

export interface BollingerPoint {
  upper: number | null;
  middle: number | null;
  lower: number | null;
}

export function computeBollingerBands(
  candles: OhlcvCandle[],
  period = 20,
  mult = 2
): BollingerPoint[] {
  if (period <= 1) return candles.map(() => ({ upper: null, middle: null, lower: null }));
  return candles.map((_, idx) => {
    if (idx < period - 1) return { upper: null, middle: null, lower: null };
    let sum = 0;
    for (let j = idx - period + 1; j <= idx; j++) {
      sum += candles[j].close;
    }
    const mean = sum / period;
    let sqDiff = 0;
    for (let j = idx - period + 1; j <= idx; j++) {
      const diff = candles[j].close - mean;
      sqDiff += diff * diff;
    }
    const std = Math.sqrt(sqDiff / period);
    return {
      upper: mean + mult * std,
      middle: mean,
      lower: mean - mult * std,
    };
  });
}

export function computeRsi(candles: OhlcvCandle[], period = 14): Array<number | null> {
  const out: Array<number | null> = new Array(candles.length).fill(null);
  if (period <= 0 || candles.length <= period) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;

  const calcRsi = (g: number, l: number) => {
    if (l === 0) return g === 0 ? 50 : 100;
    const rs = g / l;
    return 100 - 100 / (1 + rs);
  };

  out[period] = calcRsi(avgGain, avgLoss);

  for (let i = period + 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = calcRsi(avgGain, avgLoss);
  }
  return out;
}

export interface MacdPoint {
  dif: number | null;
  dea: number | null;
  histogram: number | null;
}

export function computeMacd(
  candles: OhlcvCandle[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): MacdPoint[] {
  if (candles.length === 0) return [];
  const fastEma = computeEma(candles, fastPeriod);
  const slowEma = computeEma(candles, slowPeriod);
  const difSeries: Array<number | null> = candles.map((_, idx) => {
    const f = fastEma[idx];
    const s = slowEma[idx];
    return f !== null && s !== null ? f - s : null;
  });

  const k = 2 / (signalPeriod + 1);
  const out: MacdPoint[] = candles.map(() => ({ dif: null, dea: null, histogram: null }));
  const validDifs: Array<{ idx: number; val: number }> = [];
  for (let i = 0; i < difSeries.length; i++) {
    if (difSeries[i] !== null) validDifs.push({ idx: i, val: difSeries[i]! });
  }

  let dea: number | null = null;
  for (let j = 0; j < validDifs.length; j++) {
    const { idx, val } = validDifs[j];
    if (j < signalPeriod - 1) {
      out[idx] = { dif: val, dea: null, histogram: null };
      continue;
    }
    if (j === signalPeriod - 1) {
      const sum = validDifs.slice(0, signalPeriod).reduce((acc, item) => acc + item.val, 0);
      dea = sum / signalPeriod;
    } else if (dea !== null) {
      dea = val * k + dea * (1 - k);
    }
    out[idx] = {
      dif: val,
      dea,
      histogram: dea !== null ? val - dea : null,
    };
  }
  return out;
}

export function computeVwap(candles: OhlcvCandle[]): Array<number | null> {
  if (candles.length === 0) return [];
  let cumPv = 0;
  let cumVol = 0;
  return candles.map((c) => {
    const typical = (c.high + c.low + c.close) / 3;
    const vol = Math.max(0.0001, c.volume);
    cumPv += typical * vol;
    cumVol += vol;
    return cumVol > 0 ? cumPv / cumVol : null;
  });
}

export function computeVolumeMa(candles: OhlcvCandle[], period: number): Array<number | null> {
  if (period <= 0) return candles.map(() => null);
  const out: Array<number | null> = new Array(candles.length).fill(null);
  let rollingSum = 0;
  for (let i = 0; i < candles.length; i++) {
    rollingSum += candles[i].volume;
    if (i >= period) {
      rollingSum -= candles[i - period].volume;
    }
    if (i >= period - 1) {
      out[i] = rollingSum / period;
    }
  }
  return out;
}

export interface KdjPoint {
  k: number | null;
  d: number | null;
  j: number | null;
}

export function computeKdj(
  candles: OhlcvCandle[],
  n = 9,
  m1 = 3,
  m2 = 3
): KdjPoint[] {
  if (candles.length === 0 || n <= 0) return [];
  const out: KdjPoint[] = candles.map(() => ({ k: null, d: null, j: null }));
  let kPrev = 50;
  let dPrev = 50;
  const kAlpha = 1 / Math.max(1, m1);
  const dAlpha = 1 / Math.max(1, m2);

  for (let i = 0; i < candles.length; i++) {
    if (i < n - 1) continue;
    let lowest = Infinity;
    let highest = -Infinity;
    for (let j = i - n + 1; j <= i; j++) {
      if (candles[j].low < lowest) lowest = candles[j].low;
      if (candles[j].high > highest) highest = candles[j].high;
    }
    const range = highest - lowest;
    const rsv = range > 0 ? ((candles[i].close - lowest) / range) * 100 : 50;
    const k = (1 - kAlpha) * kPrev + kAlpha * rsv;
    const d = (1 - dAlpha) * dPrev + dAlpha * k;
    const jVal = 3 * k - 2 * d;
    kPrev = k;
    dPrev = d;
    out[i] = { k, d, j: jVal };
  }
  return out;
}

export interface PriceMeasurement {
  priceDelta: number;
  pctChange: number;
  barsCount: number;
  isUp: boolean;
}

export function computePriceMeasurement(
  fromPrice: number,
  toPrice: number,
  fromIdx: number,
  toIdx: number
): PriceMeasurement {
  const priceDelta = toPrice - fromPrice;
  const pctChange = fromPrice > 0 ? (priceDelta / fromPrice) * 100 : 0;
  return {
    priceDelta,
    pctChange,
    barsCount: Math.abs(toIdx - fromIdx) + 1,
    isUp: priceDelta >= 0,
  };
}

export interface OrderBookLevel {
  price: number;
  size: number;
  total: number;
  depthPct: number;
}

export interface BinanceOrderBookSnapshot {
  asks: OrderBookLevel[]; // Highest ask first -> best (lowest) ask last (closest to spread)
  bids: OrderBookLevel[]; // Best (highest) bid first -> lowest bid last
  spreadAbs: number;
  spreadPct: number;
  bidRatioPct: number;
  askRatioPct: number;
}

export function getTickOptionsForPrice(price: number): number[] {
  if (!Number.isFinite(price) || price <= 0) return [0.01, 0.1, 1];
  if (price >= 10000) return [0.1, 1, 10, 50];
  if (price >= 1000) return [0.1, 1, 5, 10];
  if (price >= 50) return [0.01, 0.1, 1];
  if (price >= 1) return [0.001, 0.01, 0.1];
  return [0.0001, 0.001, 0.01];
}

export function buildBinanceOrderBook(
  livePrice: number,
  symbol: string,
  tickSize: number,
  rowsPerSide = 6
): BinanceOrderBookSnapshot {
  const safePrice = Number.isFinite(livePrice) && livePrice > 0 ? livePrice : 1;
  const safeTick = Number.isFinite(tickSize) && tickSize > 0 ? tickSize : getTickOptionsForPrice(safePrice)[0];
  const seed = symbol.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const priceStep = Math.max(safeTick, safePrice * 0.00035);
  const snapToTick = (val: number) => Math.max(safeTick, Math.round(val / safeTick) * safeTick);

  const rawAsks: Array<{ price: number; size: number }> = [];
  const rawBids: Array<{ price: number; size: number }> = [];

  for (let i = 0; i < rowsPerSide; i++) {
    const levelOffset = i + 1;
    const askPrice = snapToTick(safePrice + priceStep * levelOffset);
    const bidPrice = snapToTick(Math.max(safeTick, safePrice - priceStep * levelOffset));
    const askSize = Number((0.35 + ((i * 7 + seed) % 11) * 0.24).toFixed(3));
    const bidSize = Number((0.42 + ((i * 5 + seed + 3) % 11) * 0.25).toFixed(3));
    rawAsks.push({ price: askPrice, size: askSize });
    rawBids.push({ price: bidPrice, size: bidSize });
  }

  // Compute cumulative depth from inside (closest to spread) outward
  let cumAsk = 0;
  const asksWithCum = rawAsks.map((row) => {
    cumAsk += row.size;
    return { ...row, total: Number(cumAsk.toFixed(3)) };
  });
  let cumBid = 0;
  const bidsWithCum = rawBids.map((row) => {
    cumBid += row.size;
    return { ...row, total: Number(cumBid.toFixed(3)) };
  });

  const maxCum = Math.max(0.001, cumAsk, cumBid);
  // Reverse asks so highest ask is at top and lowest/best ask is right above middle price
  const asks: OrderBookLevel[] = asksWithCum
    .slice()
    .reverse()
    .map((r) => ({
      ...r,
      depthPct: Math.min(100, Math.round((r.total / maxCum) * 100)),
    }));
  const bids: OrderBookLevel[] = bidsWithCum.map((r) => ({
    ...r,
    depthPct: Math.min(100, Math.round((r.total / maxCum) * 100)),
  }));

  const bestAsk = rawAsks[0]?.price ?? safePrice;
  const bestBid = rawBids[0]?.price ?? safePrice;
  const spreadAbs = Math.max(0, bestAsk - bestBid);
  const spreadPct = safePrice > 0 ? (spreadAbs / safePrice) * 100 : 0;
  const totalVol = Math.max(0.001, cumBid + cumAsk);
  const bidRatioPct = Math.round((cumBid / totalVol) * 100);
  const askRatioPct = 100 - bidRatioPct;

  return {
    asks,
    bids,
    spreadAbs,
    spreadPct,
    bidRatioPct,
    askRatioPct,
  };
}

export interface RecentTradeFill {
  id: string;
  price: number;
  size: number;
  side: 'buy' | 'sell';
  timeLabel: string;
}

export function generateRecentTrades(
  livePrice: number,
  symbol: string,
  nowMs = Date.now(),
  count = 12
): RecentTradeFill[] {
  const safePrice = Number.isFinite(livePrice) && livePrice > 0 ? livePrice : 1;
  const seed = symbol.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const trades: RecentTradeFill[] = [];

  for (let i = 0; i < count; i++) {
    const wave = Math.sin(i * 1.37 + seed + Math.floor(nowMs / 3000));
    const isBuy = wave >= 0;
    const price = safePrice * (1 + wave * 0.00045);
    const size = Number((0.08 + Math.abs(Math.cos(i * 2.1 + seed)) * 1.85).toFixed(3));
    const ts = new Date(nowMs - i * 4000);
    const hh = String(ts.getHours()).padStart(2, '0');
    const mm = String(ts.getMinutes()).padStart(2, '0');
    const ss = String(ts.getSeconds()).padStart(2, '0');
    trades.push({
      id: `${symbol}-${i}`,
      price,
      size,
      side: isBuy ? 'buy' : 'sell',
      timeLabel: `${hh}:${mm}:${ss}`,
    });
  }
  return trades;
}
