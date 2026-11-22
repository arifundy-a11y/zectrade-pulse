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

export const CHART_CACHE_VERSION = 'zectrade_chart_v3';
export const HISTORICAL_WAVE_CANDLES = 120;

function seededUnit(seed: number): number {
  const raw = Math.sin(seed * 12.9898 + 78.233) * 43758.5453123;
  return raw - Math.floor(raw);
}

/**
 * Detects whether a candle array is missing, too short, or contains flat historical bars
 * (consecutive candles with High === Low or identical closes) so stale caches are purged.
 */
export function hasFlatCandles(candles: OhlcvCandle[] | null | undefined): boolean {
  if (!Array.isArray(candles) || candles.length < 2) return true;
  const histEnd = candles.length - 1;
  for (let i = 0; i < histEnd; i++) {
    const c = candles[i];
    if (
      !c ||
      !Number.isFinite(c.open) ||
      !Number.isFinite(c.high) ||
      !Number.isFinite(c.low) ||
      !Number.isFinite(c.close) ||
      c.close <= 0 ||
      c.high <= c.low
    ) {
      return true;
    }
    if (i > 0) {
      const prev = candles[i - 1];
      const eps = Math.max(1e-9, Math.abs(c.close) * 1e-7);
      if (Math.abs(c.close - prev.close) <= eps) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Generates realistic trending & mean-reverting candlesticks backwards from livePrice
 * using deterministic multi-frequency sine/cosine waves + UTC-bucket-seeded OHLC bodies
 * and upper/lower wicks so all devices render identical non-flat wave patterns.
 */
export function generateRealisticCandles(
  symbol: MarketSymbol,
  livePrice: number,
  timeframe: ChartTimeframe,
  count = HISTORICAL_WAVE_CANDLES,
  nowMs = Date.now()
): OhlcvCandle[] {
  const safeCount = Math.max(2, Math.round(count));
  const safeLive = Number.isFinite(livePrice) && livePrice > 0 ? livePrice : 100;
  const stepMs = TIMEFRAME_MS[timeframe];
  const stepVol =
    timeframe === '1m'
      ? 0.0022
      : timeframe === '5m'
      ? 0.0038
      : timeframe === '15m'
      ? 0.0058
      : timeframe === '1h'
      ? 0.0088
      : timeframe === '4h'
      ? 0.0145
      : timeframe === '1d'
      ? 0.022
      : timeframe === '1w'
      ? 0.042
      : 0.072;

  const seedOffset = symbol
    .split('')
    .reduce((acc, ch, idx) => acc + ch.charCodeAt(0) * (idx + 17), 0);

  const alignedEndMs = getCandleBucketStartMs(nowMs, timeframe);
  const bucketSlotSpan = Math.max(60_000, stepMs);

  // Build backwards from safeLive so final close equals safeLive with organic trends, pullbacks & swings
  const closes = new Array<number>(safeCount);
  closes[safeCount - 1] = safeLive;
  for (let i = safeCount - 2; i >= 0; i--) {
    const bucketTimeMs = alignedEndMs - (safeCount - 1 - i) * stepMs;
    const utcSlot = Math.floor(bucketTimeMs / bucketSlotSpan);
    const phase = utcSlot + seedOffset * 0.173;

    const macroTrend = Math.sin(phase * 0.082) * 0.44;
    const swingWave = Math.cos(phase * 0.195 + 0.65) * 0.34;
    const pullbackHarmonic = Math.sin(phase * 0.43 + 1.35) * 0.28;
    const microNoise = (seededUnit(phase * 1.37 + 2.91) - 0.5) * 1.25;

    let waveSum = macroTrend + swingWave + pullbackHarmonic + microNoise;
    if (Math.abs(waveSum) < 0.22) {
      const sign = seededUnit(phase * 2.41 + 0.53) >= 0.5 ? 1 : -1;
      waveSum = sign * (0.24 + seededUnit(phase * 3.17 + 1.11) * 0.32);
    }

    const pctDelta = waveSum * stepVol;
    closes[i] = Math.max(0.0001, closes[i + 1] / (1 + pctDelta));
  }

  const candles: OhlcvCandle[] = [];
  for (let i = 0; i < safeCount; i++) {
    const bucketTimeMs = alignedEndMs - (safeCount - 1 - i) * stepMs;
    const utcSlot = Math.floor(bucketTimeMs / bucketSlotSpan);
    const phase = utcSlot + seedOffset * 0.173;

    const close = closes[i];
    const openSeedDelta =
      (seededUnit(phase * 4.07 + 0.77) >= 0.5 ? 1 : -1) *
      stepVol *
      (0.32 + seededUnit(phase * 4.61 + 1.23) * 0.45);
    const open = i === 0 ? Math.max(0.0001, close * (1 - openSeedDelta)) : closes[i - 1];

    const bodyMove = Math.abs(close - open);
    const baseSpread = Math.max(close * stepVol * 0.48, bodyMove * 0.36);
    const upperWick = baseSpread * (0.28 + seededUnit(phase * 5.13 + 1.7) * 1.15);
    const lowerWick = baseSpread * (0.28 + seededUnit(phase * 7.29 + 3.9) * 1.15);
    const high = Math.max(open, close) + upperWick;
    const low = Math.max(0.0001, Math.min(open, close) - lowerWick);
    const volBase = safeLive > 10000 ? 38 : safeLive > 1000 ? 220 : 1450;
    const volume = Number(
      (
        volBase *
        (0.55 +
          (bodyMove / Math.max(0.0001, baseSpread)) * 0.9 +
          seededUnit(phase * 9.17 + 2.3) * 0.85)
      ).toFixed(2)
    );

    candles.push({
      time: bucketTimeMs,
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

export function stepCandleBucketMs(
  bucketStartMs: number,
  timeframe: ChartTimeframe,
  deltaBuckets: number
): number {
  if (timeframe === '1mo') {
    const d = new Date(bucketStartMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + deltaBuckets, 1, 0, 0, 0, 0);
  }
  return bucketStartMs + deltaBuckets * TIMEFRAME_MS[timeframe];
}

export function hashSymbolSeed(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededTriangular(key: string): number {
  const next = mulberry32(hashSymbolSeed(key));
  // Centered [-1, 1] triangular distribution via mulberry32
  return next() + next() - 1;
}

function evaluateOuBlock(tag: string, blockIdx: number, decay: number, windowSize: number): number {
  let acc = 0;
  for (let j = 0; j < windowSize; j++) {
    acc += Math.pow(decay, j) * seededTriangular(`${tag}:${blockIdx - j}`);
  }
  return Math.tanh((acc / Math.sqrt(windowSize)) * 1.48);
}

export interface ForwardCandleOptions {
  trendBias?: 'up' | 'down' | 'neutral';
  volatilityLevel?: 'calm' | 'normal' | 'active';
}

function getVolatilityMultiplier(options?: ForwardCandleOptions): number {
  return options?.volatilityLevel === 'calm'
    ? 0.55
    : options?.volatilityLevel === 'active'
    ? 1.45
    : 1.0;
}

/**
 * Evaluates the deterministic multi-scale boundary log-price offset at an exact UTC minute boundary.
 * Combines 1d/1h/15m/1m mulberry32 mean-reverting random walks + smooth multi-octave waves
 * so price oscillates organically around anchorPrice with pullbacks, runs, and zero cliff spikes.
 */
function evaluateMinuteBoundaryLogOffset(
  symbol: string,
  minuteIdx: number,
  options?: ForwardCandleOptions
): number {
  const volMult = getVolatilityMultiplier(options);
  const symPhase = (hashSymbolSeed(symbol) % 10007) * 0.0017;

  // 1) Macro daily regime wave + 1d seeded walk (smoothly interpolated per minute)
  const dayIdx = Math.floor(minuteIdx / 1440);
  const dayFrac = (minuteIdx - dayIdx * 1440) / 1440;
  const d0 = evaluateOuBlock(`${symbol}:1d`, dayIdx, 0.8, 12);
  const d1 = evaluateOuBlock(`${symbol}:1d`, dayIdx + 1, 0.8, 12);
  const dSmooth = d0 + (d1 - d0) * dayFrac;
  const macroWave = Math.sin(minuteIdx * 0.00065 + symPhase) * 0.35;
  const macroOffset = (dSmooth * 0.85 + macroWave * 0.15) * 0.0028;

  // 2) Swing 1h seeded random walk
  const hourIdx = Math.floor(minuteIdx / 60);
  const hourFrac = (minuteIdx - hourIdx * 60) / 60;
  const h0 = evaluateOuBlock(`${symbol}:1h`, hourIdx, 0.82, 14);
  const h1 = evaluateOuBlock(`${symbol}:1h`, hourIdx + 1, 0.82, 14);
  const hSmooth = h0 + (h1 - h0) * hourFrac;
  const swingWave = Math.cos(minuteIdx * 0.0085 + symPhase * 1.9) * 0.25;
  const swingOffset = (hSmooth * 0.85 + swingWave * 0.15) * 0.0022;

  // 3) Intraday 15m seeded random walk
  const qIdx = Math.floor(minuteIdx / 15);
  const qFrac = (minuteIdx - qIdx * 15) / 15;
  const q0 = evaluateOuBlock(`${symbol}:15m`, qIdx, 0.82, 12);
  const q1 = evaluateOuBlock(`${symbol}:15m`, qIdx + 1, 0.82, 12);
  const qSmooth = q0 + (q1 - q0) * qFrac;
  const qOffset = qSmooth * 0.0018;

  // 4) 1m microstructure random walk
  const mVal = evaluateOuBlock(`${symbol}:1m`, minuteIdx, 0.84, 12);
  const mOffset = mVal * 0.0016;

  // Subtle deterministic non-zero nudge so two adjacent 1m boundaries are never identical
  const parityMicro = ((minuteIdx & 1) === 0 ? 1 : -1) * 0.00018;

  const biasOffset =
    options?.trendBias === 'up'
      ? (0.0038 + Math.sin(minuteIdx * 0.015) * 0.0008) * volMult
      : options?.trendBias === 'down'
      ? -(0.0038 + Math.sin(minuteIdx * 0.015) * 0.0008) * volMult
      : 0;

  return (macroOffset + swingOffset + qOffset + mOffset + parityMicro) * volMult + biasOffset;
}

function evaluateMinuteBoundaryPrice(
  symbol: string,
  anchorPrice: number,
  minuteIdx: number,
  options?: ForwardCandleOptions
): number {
  const safeAnchor = Number.isFinite(anchorPrice) && anchorPrice > 0 ? anchorPrice : 100;
  const logOffset = evaluateMinuteBoundaryLogOffset(symbol, minuteIdx, options);
  return Math.max(0.0001, safeAnchor * Math.exp(logOffset));
}

function evaluateLockedMinuteBoundaryPrice(
  symbol: string,
  anchorPrice: number,
  minuteIdx: number,
  options?: ForwardCandleOptions
): number {
  const curr = evaluateMinuteBoundaryPrice(symbol, anchorPrice, minuteIdx, options);
  const prev = evaluateMinuteBoundaryPrice(symbol, anchorPrice, minuteIdx - 1, options);
  const minEps = Math.max(1e-7, prev * 0.00025);
  if (Math.abs(curr - prev) < minEps) {
    const dir = (minuteIdx & 1) === 0 ? 1 : -1;
    return Math.max(0.0001, prev + dir * minEps * 1.4);
  }
  return curr;
}

/**
 * Generates a deterministic 60-step intra-minute Brownian bridge path (61 points t=0..60)
 * between minuteOpen (t=0) and minuteClose (t=60) seeded by symbol + minuteStartMs.
 */
function buildMinuteIntraPath(
  symbol: string,
  anchorPrice: number,
  minuteStartMs: number,
  minuteOpen: number,
  minuteClose: number,
  options?: ForwardCandleOptions
): number[] {
  const volMult = getVolatilityMultiplier(options);
  const prng = mulberry32(hashSymbolSeed(`${symbol}:intra:${minuteStartMs}`));
  const walks = new Array<number>(61);
  walks[0] = 0;
  for (let s = 1; s <= 60; s++) {
    const shock = prng() + prng() - 1;
    walks[s] = walks[s - 1] + shock;
  }
  const endWalk = walks[60];
  const bridgeScale = Math.max(0.00001, anchorPrice * 0.00042 * volMult);
  const path = new Array<number>(61);
  path[0] = minuteOpen;
  for (let s = 1; s < 60; s++) {
    const frac = s / 60;
    const bridge = (walks[s] - frac * endWalk) * bridgeScale;
    const linear = minuteOpen + frac * (minuteClose - minuteOpen);
    path[s] = Math.max(0.0001, linear + bridge);
  }
  path[60] = minuteClose;
  return path;
}

/**
 * Evaluates the exact deterministic 1-second live price at utcMs along the same
 * underlying seeded curve that builds closed historical candles, guaranteeing zero jump
 * when a live candle closes or when the page is reloaded.
 */
export function evaluateDeterministicCurvePrice(
  symbol: string,
  anchorPrice: number,
  utcMs: number,
  options?: ForwardCandleOptions
): number {
  const safeAnchor = Number.isFinite(anchorPrice) && anchorPrice > 0 ? anchorPrice : 100;
  const minuteIdx = Math.floor(utcMs / 60_000);
  const minuteStartMs = minuteIdx * 60_000;
  const secInMinute = Math.max(0, Math.min(59, Math.floor((utcMs - minuteStartMs) / 1000)));
  if (secInMinute === 0) {
    return evaluateLockedMinuteBoundaryPrice(symbol, safeAnchor, minuteIdx, options);
  }
  const minuteOpen = evaluateLockedMinuteBoundaryPrice(symbol, safeAnchor, minuteIdx, options);
  const minuteClose = evaluateLockedMinuteBoundaryPrice(symbol, safeAnchor, minuteIdx + 1, options);
  const path = buildMinuteIntraPath(symbol, safeAnchor, minuteStartMs, minuteOpen, minuteClose, options);
  return path[secInMinute];
}

/**
 * Evaluates a single immutable 1m OHLCV candle strictly from its fixed UTC minute timestamp.
 * Its open/close/high/low match the exact min/max/endpoints of the 60-second live tick path.
 */
export function evaluateDeterministic1mBar(
  symbol: string,
  anchorPrice: number,
  minuteStartMs: number,
  options?: ForwardCandleOptions
): OhlcvCandle {
  const safeAnchor = Number.isFinite(anchorPrice) && anchorPrice > 0 ? anchorPrice : 100;
  const volMult = getVolatilityMultiplier(options);
  const minuteIdx = Math.floor(minuteStartMs / 60_000);
  const open = evaluateLockedMinuteBoundaryPrice(symbol, safeAnchor, minuteIdx, options);
  const close = evaluateLockedMinuteBoundaryPrice(symbol, safeAnchor, minuteIdx + 1, options);
  const path = buildMinuteIntraPath(symbol, safeAnchor, minuteStartMs, open, close, options);

  let high = Math.max(open, close);
  let low = Math.min(open, close);
  for (let s = 1; s < 60; s++) {
    if (path[s] > high) high = path[s];
    if (path[s] < low) low = path[s];
  }

  // Ensure crisp realistic upper/lower wicks on every 1m bar
  const prng = mulberry32(hashSymbolSeed(`${symbol}:1mw:${minuteStartMs}`));
  const body = Math.abs(close - open);
  const minWick = Math.max(safeAnchor * 0.00018 * volMult, body * 0.22);
  if (high - Math.max(open, close) < minWick * 0.4) {
    high = Math.max(open, close) + minWick * (0.45 + prng() * 0.9);
  }
  if (Math.min(open, close) - low < minWick * 0.4) {
    low = Math.max(0.0001, Math.min(open, close) - minWick * (0.45 + prng() * 0.9));
  }

  const volBase = safeAnchor > 10000 ? 38 : safeAnchor > 1000 ? 220 : 1450;
  const spread = Math.max(0.0001, high - low);
  const volume = Number(
    (volBase * (0.45 + (body / spread) * 0.85 + prng() * 1.15) * (0.75 + 0.25 * volMult)).toFixed(2)
  );

  return {
    time: minuteStartMs,
    open,
    high,
    low,
    close,
    volume,
  };
}

function evaluateLockedTfBoundaryPrice(
  symbol: string,
  anchorPrice: number,
  boundaryMs: number,
  timeframe: ChartTimeframe,
  options?: ForwardCandleOptions
): number {
  const currMinIdx = Math.floor(boundaryMs / 60_000);
  const prevBoundaryMs = stepCandleBucketMs(boundaryMs, timeframe, -1);
  const prevMinIdx = Math.floor(prevBoundaryMs / 60_000);
  const curr = evaluateLockedMinuteBoundaryPrice(symbol, anchorPrice, currMinIdx, options);
  const prev = evaluateLockedMinuteBoundaryPrice(symbol, anchorPrice, prevMinIdx, options);
  const minDiff = Math.max(1e-7, prev * 0.00025);
  if (Math.abs(curr - prev) < minDiff) {
    const dir = (currMinIdx & 1) === 0 ? 1 : -1;
    return Math.max(0.0001, prev + dir * minDiff * 1.4);
  }
  return curr;
}

/**
 * Generates immutable, zero-gap candlesticks strictly forward from fixed UTC bucket timestamps,
 * timeframe interval, symbol seed, and Admin-configured anchor parameters (NEVER backwards from livePrice
 * and NEVER using Math.random()).
 *
 * - `1m` evaluates exact 1m seeded random-walk bars.
 * - `5m` and `15m` aggregate the underlying `1m` deterministic bars so OHLCV matches 100%.
 * - `1h`, `4h`, `1d`, `1w`, `1mo` share the exact same `evaluateLockedMinuteBoundaryPrice` curve
 *   and sample intra-bucket boundary extrema + deterministic wicks for fast, seamless consistency.
 */
export function generateForwardDeterministicCandles(
  symbol: MarketSymbol,
  anchorPrice: number,
  timeframe: ChartTimeframe,
  count = HISTORICAL_WAVE_CANDLES,
  endTimeMs = Date.now(),
  options?: ForwardCandleOptions
): OhlcvCandle[] {
  const safeCount = Math.max(2, Math.round(count));
  const safeAnchor = Number.isFinite(anchorPrice) && anchorPrice > 0 ? anchorPrice : 100;
  const alignedEndMs = getCandleBucketStartMs(endTimeMs, timeframe);

  if (timeframe === '1m' || timeframe === '5m' || timeframe === '15m') {
    const minsPerBar = timeframe === '1m' ? 1 : timeframe === '5m' ? 5 : 15;
    const firstBucketStart = stepCandleBucketMs(alignedEndMs, timeframe, -(safeCount - 1));
    const total1mBars = safeCount * minsPerBar;
    const oneMinBars = new Array<OhlcvCandle>(total1mBars);
    for (let i = 0; i < total1mBars; i++) {
      oneMinBars[i] = evaluateDeterministic1mBar(symbol, safeAnchor, firstBucketStart + i * 60_000, options);
    }
    const aggregated =
      timeframe === '1m' ? oneMinBars : aggregateCandlesByTimeframe(oneMinBars, timeframe);
    return aggregated.slice(-safeCount);
  }

  const volMult = getVolatilityMultiplier(options);
  const volBase = safeAnchor > 10000 ? 38 : safeAnchor > 1000 ? 220 : 1450;
  const tfStepMinutes =
    timeframe === '1h' ? 60 : timeframe === '4h' ? 240 : timeframe === '1d' ? 1440 : 10080;

  const candles: OhlcvCandle[] = [];
  for (let i = 0; i < safeCount; i++) {
    const deltaFromEnd = i - (safeCount - 1);
    const bucketStartMs = stepCandleBucketMs(alignedEndMs, timeframe, deltaFromEnd);
    const bucketEndMs = stepCandleBucketMs(bucketStartMs, timeframe, 1);

    const startMinuteIdx = Math.floor(bucketStartMs / 60_000);
    const endMinuteIdx = Math.floor(bucketEndMs / 60_000);
    const spanMinutes = Math.max(1, endMinuteIdx - startMinuteIdx);

    const open = evaluateLockedTfBoundaryPrice(symbol, safeAnchor, bucketStartMs, timeframe, options);
    const close = evaluateLockedTfBoundaryPrice(symbol, safeAnchor, bucketEndMs, timeframe, options);

    // Sample intra-bucket boundary nodes to reflect true intermediate swings
    const sampleCount = timeframe === '1h' ? 30 : 32;
    let high = Math.max(open, close);
    let low = Math.min(open, close);
    for (let s = 1; s < sampleCount; s++) {
      const mIdx = startMinuteIdx + Math.round((s * spanMinutes) / sampleCount);
      const p = evaluateLockedMinuteBoundaryPrice(symbol, safeAnchor, mIdx, options);
      if (p > high) high = p;
      if (p < low) low = p;
    }

    const prng = mulberry32(hashSymbolSeed(`${symbol}:${timeframe}:${bucketStartMs}`));
    const body = Math.abs(close - open);
    const spanSpread = Math.max(safeAnchor * 0.00045 * volMult, body * 0.32);
    high = Math.max(high, Math.max(open, close) + spanSpread * (0.25 + prng() * 0.85));
    low = Math.max(0.0001, Math.min(low, Math.min(open, close) - spanSpread * (0.25 + prng() * 0.85)));

    const barMultiplier = Math.max(1, Math.sqrt(Math.min(1440, tfStepMinutes)));
    const volume = Number(
      (
        volBase *
        barMultiplier *
        (0.45 + (body / Math.max(0.0001, high - low)) * 0.85 + prng() * 1.05) *
        (0.75 + 0.25 * volMult)
      ).toFixed(2)
    );

    candles.push({
      time: bucketStartMs,
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
 * Normalizes a candle timestamp to Unix milliseconds.
 * If a timestamp is supplied in seconds (< 1e12), multiplies by 1000 cleanly.
 */
export function normalizeCandleTimeMs(rawTime: number): number {
  if (!Number.isFinite(rawTime)) return 0;
  return rawTime > 0 && rawTime < 1e12 ? Math.round(rawTime * 1000) : Math.round(rawTime);
}

export interface CustomCoinTickInitFallback {
  symbol: MarketSymbol;
  anchorPrice: number;
  options?: ForwardCandleOptions;
}

/**
 * Builds deterministic historical OHLCV candles ending right before currentBucketMs,
 * working strictly BACKWARD from the Custom Coin's current live price (`currentPrice`)
 * with realistic ±0.15% to ±0.8% seeded deterministic candle bodies and upper/lower wicks.
 * Never anchors history to 1.0 or 0, eliminating any giant vertical spike.
 */
export function buildBackwardAnchoredCustomCandles(
  symbol: MarketSymbol,
  currentPrice: number,
  timeframe: ChartTimeframe,
  historicalCount = 150,
  nowMs = Date.now(),
  options?: ForwardCandleOptions
): OhlcvCandle[] {
  const safePrice = Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : 100;
  const safeCount = Math.max(2, Math.round(historicalCount));
  const currentBucketMs = getCandleBucketStartMs(nowMs, timeframe);
  const volMult =
    options?.volatilityLevel === 'calm'
      ? 0.65
      : options?.volatilityLevel === 'active'
      ? 1.25
      : 1.0;

  const closes = new Array<number>(safeCount);
  const opens = new Array<number>(safeCount);
  const times = new Array<number>(safeCount);

  closes[safeCount - 1] = safePrice;
  const symSeed = hashSymbolSeed(`${symbol}:${timeframe}`);
  const symPhase = (symSeed % 9973) * 0.0023;
  const biasNudge =
    options?.trendBias === 'up' ? 0.0008 : options?.trendBias === 'down' ? -0.0008 : 0;

  for (let i = safeCount - 1; i >= 0; i--) {
    const bucketTimeMs = stepCandleBucketMs(currentBucketMs, timeframe, -(safeCount - i));
    times[i] = bucketTimeMs;

    const rng = mulberry32(hashSymbolSeed(`${symbol}:bw:${timeframe}:${bucketTimeMs}`));
    const baseStepMag = (0.0015 + rng() * 0.0065) * volMult;
    const clampedMag = Math.max(0.0015, Math.min(0.008, baseStepMag));

    const wave =
      Math.sin(i * 0.14 + symPhase) * 0.45 + Math.cos(i * 0.31 + symPhase * 1.7) * 0.35;
    const meanRevPull = ((safePrice - closes[i]) / safePrice) * 0.18;
    const signedRaw = wave * 0.5 + (rng() - 0.5) * 1.2 + meanRevPull + biasNudge;
    const sign = signedRaw >= 0 ? 1 : -1;
    const stepPct = sign * clampedMag;

    const openVal = Math.max(0.0001, closes[i] / (1 + stepPct));
    opens[i] = openVal;
    if (i > 0) {
      closes[i - 1] = openVal;
    }
  }

  const volBase = safePrice > 10000 ? 38 : safePrice > 1000 ? 220 : 1450;
  const candles: OhlcvCandle[] = new Array(safeCount);
  for (let i = 0; i < safeCount; i++) {
    const open = opens[i];
    const close = closes[i];
    const bucketTimeMs = times[i];
    const rng = mulberry32(hashSymbolSeed(`${symbol}:wick:${timeframe}:${bucketTimeMs}`));
    const body = Math.abs(close - open);
    const wickBase = Math.max(close * 0.0014 * volMult, body * 0.38);
    const upperWick = wickBase * (0.35 + rng() * 1.15);
    const lowerWick = wickBase * (0.35 + rng() * 1.15);
    const high = Math.max(open, close) + upperWick;
    const low = Math.max(0.0001, Math.min(open, close) - lowerWick);
    const volume = Number(
      (volBase * (0.55 + (body / Math.max(0.0001, high - low)) * 0.9 + rng() * 0.9)).toFixed(2)
    );
    candles[i] = {
      time: bucketTimeMs,
      open,
      high,
      low,
      close,
      volume,
    };
  }

  return candles;
}

/**
 * Synchronously initializes 150 backward-anchored deterministic historical candles (tied to livePrice)
 * plus 1 active live candle anchored to currentBucketMs so Custom Coins never show a giant vertical jump.
 */
export function initializeCustomCoinCandlesSeries(
  symbol: MarketSymbol,
  anchorPrice: number,
  timeframe: ChartTimeframe,
  livePrice: number,
  nowMs = Date.now(),
  options?: ForwardCandleOptions,
  closedCount = 150
): OhlcvCandle[] {
  const safeLive =
    Number.isFinite(livePrice) && livePrice > 0
      ? livePrice
      : Number.isFinite(anchorPrice) && anchorPrice > 0
      ? anchorPrice
      : 100;
  const safeClosedCount = Math.max(2, Math.round(closedCount));
  const currentBucketMs = getCandleBucketStartMs(nowMs, timeframe);

  const historicalBars = buildBackwardAnchoredCustomCandles(
    symbol,
    safeLive,
    timeframe,
    safeClosedCount,
    nowMs,
    options
  );

  const liveOpen = historicalBars[historicalBars.length - 1]?.close ?? safeLive;
  const activeCandle: OhlcvCandle = {
    time: currentBucketMs,
    open: liveOpen,
    high: Math.max(liveOpen, safeLive),
    low: Math.min(liveOpen, safeLive),
    close: safeLive,
    volume: 15,
  };

  return [...historicalBars, activeCandle];
}

/**
 * Advances a Custom Coin candle series whenever nowMs enters a newer timeframe bucket
 * (including catching up across multiple missed buckets if tabs were switched).
 * Normalizes all timestamps strictly to milliseconds, freezes closed candles permanently,
 * and appends new candle(s) starting with open = high = low = close = prevCandle.close.
 */
export function rollOverCustomCoinCandles(
  candles: OhlcvCandle[],
  timeframe: ChartTimeframe,
  nowMs: number,
  maxCandles = 300
): { candles: OhlcvCandle[]; rolledCount: number } {
  if (!Array.isArray(candles) || candles.length === 0) {
    return { candles: Array.isArray(candles) ? candles : [], rolledCount: 0 };
  }
  const currentBucketMs = getCandleBucketStartMs(nowMs, timeframe);
  const last = candles[candles.length - 1];
  const lastTimeMs = normalizeCandleTimeMs(last.time);
  const lastBucketMs = getCandleBucketStartMs(lastTimeMs, timeframe);

  if (currentBucketMs <= lastBucketMs) {
    if (lastTimeMs !== last.time) {
      const normalized = candles.map((c) => {
        const t = normalizeCandleTimeMs(c.time);
        return t === c.time ? c : { ...c, time: t };
      });
      return { candles: normalized, rolledCount: 0 };
    }
    return { candles, rolledCount: 0 };
  }

  const nextSeries = candles.map((c) => {
    const t = normalizeCandleTimeMs(c.time);
    return t === c.time ? c : { ...c, time: t };
  });
  let cursorBucket = lastBucketMs;
  const prevClose = last.close;
  let rolledCount = 0;
  const maxSteps = Math.max(1, maxCandles);

  while (cursorBucket < currentBucketMs && rolledCount < maxSteps) {
    const nextBucket = stepCandleBucketMs(cursorBucket, timeframe, 1);
    const targetTime = nextBucket <= currentBucketMs ? nextBucket : currentBucketMs;
    nextSeries.push({
      time: targetTime,
      open: prevClose,
      high: prevClose,
      low: prevClose,
      close: prevClose,
      volume: 15,
    });
    cursorBucket = targetTime;
    rolledCount += 1;
  }

  if (cursorBucket < currentBucketMs) {
    nextSeries.push({
      time: currentBucketMs,
      open: prevClose,
      high: prevClose,
      low: prevClose,
      close: prevClose,
      volume: 15,
    });
    rolledCount += 1;
  }

  return {
    candles: nextSeries.slice(-Math.max(2, maxCandles)),
    rolledCount,
  };
}

/**
 * Performs 1-second candle rollover + active-candle live price tick update for Custom Coins:
 * - Auto-initializes 150 backward-anchored closed + 1 active candle immediately if prev series is empty
 * - Normalizes timestamps strictly to milliseconds
 * - Freezes closed candles permanently (`time < currentBucket`)
 * - Spawns new candle(s) on UTC interval boundary (`open = high = low = close = prev.close, volume = 15`)
 * - Updates ONLY the active rightmost candle's close, high, low, and volume
 */
export function applyCustomCoinLiveTickToSeries(
  candles: OhlcvCandle[],
  timeframe: ChartTimeframe,
  livePrice: number,
  nowMs: number,
  maxCandles = 300,
  initFallback?: CustomCoinTickInitFallback
): { candles: OhlcvCandle[]; rolledCount: number } {
  if ((!Array.isArray(candles) || candles.length === 0) && initFallback) {
    const safePrice =
      Number.isFinite(livePrice) && livePrice > 0 ? livePrice : initFallback.anchorPrice;
    return {
      candles: initializeCustomCoinCandlesSeries(
        initFallback.symbol,
        safePrice,
        timeframe,
        safePrice,
        nowMs,
        initFallback.options,
        150
      ),
      rolledCount: 0,
    };
  }

  const rolled = rollOverCustomCoinCandles(candles, timeframe, nowMs, maxCandles);
  if (rolled.candles.length === 0 || !Number.isFinite(livePrice) || livePrice <= 0) {
    return rolled;
  }

  const next = rolled.candles === candles ? [...candles] : rolled.candles;
  const lastIdx = next.length - 1;
  const last = next[lastIdx];

  const priceDelta = Math.abs(livePrice - last.close);
  const changed = livePrice !== last.close;

  if (!changed && rolled.rolledCount === 0) {
    return rolled;
  }

  const relDelta = last.close > 0 ? priceDelta / last.close : 0;
  const tickVolBump = changed
    ? Number((Math.max(1.5, relDelta * 18000)).toFixed(2))
    : 0;

  next[lastIdx] = {
    ...last,
    close: livePrice,
    high: Math.max(last.high, livePrice),
    low: Math.min(last.low, livePrice),
    volume: Number(((last.volume || 0) + tickVolBump).toFixed(2)),
  };

  return {
    candles: next,
    rolledCount: rolled.rolledCount,
  };
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
 * - Uses forward pure-deterministic UTC-bucket padding anchored to immutable anchor price
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
    const closedCount = Math.max(1, totalCount - 1);
    const prevEnd = stepCandleBucketMs(currentBucketStart, timeframe, -1);
    const closedBars = generateForwardDeterministicCandles(
      symbol,
      safeLive,
      timeframe,
      closedCount,
      prevEnd
    );
    const open = closedBars[closedBars.length - 1]?.close ?? safeLive;
    return [
      ...closedBars,
      {
        time: currentBucketStart,
        open,
        high: Math.max(open, safeLive),
        low: Math.min(open, safeLive),
        close: safeLive,
        volume: Number((Math.max(18, Math.abs(safeLive - open) * 65 + 24)).toFixed(2)),
      },
    ];
  }

  const aggregated = aggregateCandlesByTimeframe(recorded1mBars, timeframe);

  // Fill forward or update the active current bucket with livePrice
  const lastRecorded = aggregated[aggregated.length - 1];
  if (lastRecorded.time < currentBucketStart) {
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

  // Deterministic pre-launch history anchored purely by fixed UTC bucket timestamps
  const firstRecorded = aggregated[0];
  const needed = totalCount - aggregated.length;
  const prevEnd = stepCandleBucketMs(firstRecorded.time, timeframe, -1);
  const prefix = generateForwardDeterministicCandles(
    `${symbol}:prelaunch`,
    firstRecorded.open,
    timeframe,
    needed,
    prevEnd
  );

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

export const DEFAULT_CHART_RIGHT_OFFSET = 14;
export const MAX_CHART_RIGHT_OFFSET = 35;

export interface PannableChartViewport {
  startIdx: number;
  endIdx: number; // exclusive real-candle boundary (<= totalCount, never reveals future candles)
  clampedVisible: number;
  clampedRightOffset: number; // positive = empty candle widths on right; negative = scrolled back into history
  leftEdgeSlot: number;
  rightEdgeSlot: number;
  minRightOffset: number;
  maxRightOffset: number;
}

export function computePannableChartViewport(
  totalCount: number,
  visibleCount: number,
  rightOffsetSlots: number,
  minVisible = 16,
  maxRightOffset = MAX_CHART_RIGHT_OFFSET
): PannableChartViewport {
  if (totalCount <= 0) {
    return {
      startIdx: 0,
      endIdx: 0,
      clampedVisible: 0,
      clampedRightOffset: 0,
      leftEdgeSlot: 0,
      rightEdgeSlot: 0,
      minRightOffset: 0,
      maxRightOffset: 0,
    };
  }
  const safeMinVisible = Math.min(minVisible, Math.max(minVisible, totalCount));
  const maxVisible = Math.max(safeMinVisible, totalCount);
  const clampedVisible = Math.max(safeMinVisible, Math.min(maxVisible, Math.round(visibleCount)));

  const effectiveMaxRight = Math.min(
    maxRightOffset,
    Math.max(0, clampedVisible - Math.min(3, totalCount))
  );
  const minAllowedRight = totalCount >= clampedVisible ? -(totalCount - clampedVisible) : 0;
  const clampedRightOffset = Math.max(
    minAllowedRight,
    Math.min(effectiveMaxRight, rightOffsetSlots)
  );

  const rightEdgeSlot = totalCount - 1 + clampedRightOffset;
  const leftEdgeSlot = rightEdgeSlot - (clampedVisible - 1);
  const startIdx = Math.max(0, Math.floor(leftEdgeSlot));
  const endIdx = Math.min(totalCount, Math.ceil(rightEdgeSlot) + 1);

  return {
    startIdx,
    endIdx: Math.max(startIdx, endIdx),
    clampedVisible,
    clampedRightOffset,
    leftEdgeSlot,
    rightEdgeSlot,
    minRightOffset: minAllowedRight,
    maxRightOffset: effectiveMaxRight,
  };
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
