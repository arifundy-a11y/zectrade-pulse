import type { MarketQuote, MarketSymbol } from '../types';
import { computeOrganicMarketTickPrice } from './tradingEngine';

export const BINANCE_STREAM_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'BNBUSDT',
  'XRPUSDT',
  'DOGEUSDT',
  'ADAUSDT',
  'AVAXUSDT',
  'LINKUSDT',
  'TONUSDT',
  'PAXGUSDT',
] as const;

export const BINANCE_COMBINED_STREAM_URL = `wss://stream.binance.com:9443/stream?streams=${BINANCE_STREAM_SYMBOLS.map(
  (s) => `${s.toLowerCase()}@miniTicker`
).join('/')}`;

export const BINANCE_REST_TICKER_URL = `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(
  JSON.stringify(BINANCE_STREAM_SYMBOLS)
)}`;

export const COINBASE_EXCHANGE_RATES_URL = 'https://api.coinbase.com/v2/exchange-rates?currency=USD';

export interface ParsedMarketTick {
  symbol: MarketSymbol;
  price: number;
  changePct: number | null;
  high24h: number | null;
  low24h: number | null;
}

export interface SharedMarketAnchor {
  price: number;
  changePct: number;
  high24h: number;
  low24h: number;
}

const COINBASE_RATE_TO_SYMBOL: ReadonlyArray<{ coinbaseCode: string; symbol: MarketSymbol }> = [
  { coinbaseCode: 'BTC', symbol: 'BTCUSDT' },
  { coinbaseCode: 'ETH', symbol: 'ETHUSDT' },
  { coinbaseCode: 'SOL', symbol: 'SOLUSDT' },
  { coinbaseCode: 'BNB', symbol: 'BNBUSDT' },
  { coinbaseCode: 'XRP', symbol: 'XRPUSDT' },
  { coinbaseCode: 'DOGE', symbol: 'DOGEUSDT' },
  { coinbaseCode: 'ADA', symbol: 'ADAUSDT' },
  { coinbaseCode: 'AVAX', symbol: 'AVAXUSDT' },
  { coinbaseCode: 'LINK', symbol: 'LINKUSDT' },
  { coinbaseCode: 'TON', symbol: 'TONUSDT' },
  { coinbaseCode: 'PAXG', symbol: 'GOLD' },
];

export function mapBinanceSymbolToMarketSymbol(rawSymbol: string): MarketSymbol | null {
  const clean = String(rawSymbol || '').trim().toUpperCase();
  if (!clean) return null;
  if (clean === 'PAXGUSDT') return 'GOLD';
  if ((BINANCE_STREAM_SYMBOLS as readonly string[]).includes(clean)) {
    return clean as MarketSymbol;
  }
  return null;
}

function roundQuotePct(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Number(val.toFixed(2));
}

export function parseBinanceMiniTickerPayload(payload: unknown): ParsedMarketTick | null {
  if (!payload || typeof payload !== 'object') return null;
  const envelope = payload as Record<string, unknown>;
  const inner =
    envelope.data && typeof envelope.data === 'object'
      ? (envelope.data as Record<string, unknown>)
      : envelope;

  const sym = mapBinanceSymbolToMarketSymbol(String(inner.s || ''));
  if (!sym) return null;

  const close = Number.parseFloat(String(inner.c ?? ''));
  if (!Number.isFinite(close) || close <= 0) return null;

  const open = Number.parseFloat(String(inner.o ?? ''));
  const explicitPct = inner.P !== undefined ? Number.parseFloat(String(inner.P)) : Number.NaN;
  const high = Number.parseFloat(String(inner.h ?? ''));
  const low = Number.parseFloat(String(inner.l ?? ''));

  const changePct = Number.isFinite(explicitPct)
    ? roundQuotePct(explicitPct)
    : Number.isFinite(open) && open > 0
      ? roundQuotePct(((close - open) / open) * 100)
      : null;

  return {
    symbol: sym,
    price: close,
    changePct,
    high24h: Number.isFinite(high) && high > 0 ? high : null,
    low24h: Number.isFinite(low) && low > 0 ? low : null,
  };
}

export function parseBinanceRestTicker24hr(rows: unknown): ParsedMarketTick[] {
  if (!Array.isArray(rows)) return [];
  const ticks: ParsedMarketTick[] = [];
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const sym = mapBinanceSymbolToMarketSymbol(String(row.symbol || ''));
    if (!sym) continue;
    const lastPrice = Number.parseFloat(String(row.lastPrice ?? ''));
    if (!Number.isFinite(lastPrice) || lastPrice <= 0) continue;
    const pct = Number.parseFloat(String(row.priceChangePercent ?? ''));
    const high = Number.parseFloat(String(row.highPrice ?? ''));
    const low = Number.parseFloat(String(row.lowPrice ?? ''));
    ticks.push({
      symbol: sym,
      price: lastPrice,
      changePct: Number.isFinite(pct) ? roundQuotePct(pct) : null,
      high24h: Number.isFinite(high) && high > 0 ? high : null,
      low24h: Number.isFinite(low) && low > 0 ? low : null,
    });
  }
  return ticks;
}

export function parseCoinbaseExchangeRates(
  payload: unknown,
  referenceQuotes: MarketQuote[]
): ParsedMarketTick[] {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as Record<string, unknown>;
  const data = root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : root;
  const rates = data.rates && typeof data.rates === 'object' ? (data.rates as Record<string, unknown>) : null;
  if (!rates) return [];

  const refMap = new Map(referenceQuotes.map((q) => [q.symbol, q]));
  const ticks: ParsedMarketTick[] = [];

  for (const { coinbaseCode, symbol } of COINBASE_RATE_TO_SYMBOL) {
    const rawRate = rates[coinbaseCode];
    if (rawRate === undefined || rawRate === null) continue;
    const perUsd = Number.parseFloat(String(rawRate));
    if (!Number.isFinite(perUsd) || perUsd <= 0) continue;

    const rawPrice = 1 / perUsd;
    const price =
      rawPrice >= 1000
        ? Number(rawPrice.toFixed(2))
        : rawPrice >= 1
          ? Number(rawPrice.toFixed(3))
          : Number(rawPrice.toFixed(4));
    if (!Number.isFinite(price) || price <= 0) continue;

    const ref = refMap.get(symbol);
    let changePct: number | null = null;
    if (ref && ref.price > 0) {
      const denom = 1 + ref.changePct / 100;
      const estimatedOpen = denom > 0 ? ref.price / denom : ref.price;
      if (estimatedOpen > 0) {
        changePct = roundQuotePct(((price - estimatedOpen) / estimatedOpen) * 100);
      }
    }

    ticks.push({
      symbol,
      price,
      changePct,
      high24h: ref ? Math.max(ref.high24h, price) : price,
      low24h: ref && ref.low24h > 0 ? Math.min(ref.low24h, price) : price,
    });
  }

  return ticks;
}

export function applyLiveMarketTicks(
  prevQuotes: MarketQuote[],
  ticks: ParsedMarketTick[]
): MarketQuote[] {
  if (ticks.length === 0) return prevQuotes;
  const tickMap = new Map<MarketSymbol, ParsedMarketTick>();
  for (const t of ticks) {
    tickMap.set(t.symbol, t);
  }

  let changed = false;
  const next = prevQuotes.map((q) => {
    // Admin-added custom coins and built-in symbols with active Firestore overrides are never overwritten by external feeds
    if (q.isCustom) return q;
    const tick = tickMap.get(q.symbol);
    if (!tick) return q;

    const nextChange = tick.changePct !== null ? tick.changePct : q.changePct;
    const nextHigh = tick.high24h !== null ? tick.high24h : Math.max(q.high24h, tick.price);
    const nextLow = tick.low24h !== null ? tick.low24h : q.low24h > 0 ? Math.min(q.low24h, tick.price) : tick.price;

    if (
      q.price === tick.price &&
      q.changePct === nextChange &&
      q.high24h === nextHigh &&
      q.low24h === nextLow
    ) {
      return q;
    }

    changed = true;
    return {
      ...q,
      price: tick.price,
      changePct: nextChange,
      high24h: nextHigh,
      low24h: nextLow,
    };
  });

  return changed ? next : prevQuotes;
}

export function evaluateDeterministicFallbackQuotes(
  prevQuotes: MarketQuote[],
  sharedAnchors: ReadonlyMap<MarketSymbol, SharedMarketAnchor>,
  fallbackSeeds: readonly MarketQuote[],
  nowMs: number,
  wsHealthy: boolean
): MarketQuote[] {
  const utcSecMs = Math.floor(nowMs / 1000) * 1000;
  const seedMap = new Map(fallbackSeeds.map((s) => [s.symbol, s]));
  let changed = false;

  const next = prevQuotes.map((q) => {
    if (q.isCustom) return q;
    if (wsHealthy && q.symbol !== 'USOIL') return q;

    const anchor = sharedAnchors.get(q.symbol) ?? seedMap.get(q.symbol);
    const anchorPrice = anchor?.price ?? q.price;
    if (!Number.isFinite(anchorPrice) || anchorPrice <= 0) return q;

    const nextPrice = computeOrganicMarketTickPrice(
      anchorPrice,
      q.symbol,
      utcSecMs,
      q.symbol === 'USOIL' ? 0.004 : 0.0018,
      'neutral'
    );

    const anchorOpen =
      anchor && 1 + anchor.changePct / 100 > 0
        ? anchor.price / (1 + anchor.changePct / 100)
        : anchorPrice;
    const nextChangePct =
      anchorOpen > 0 ? roundQuotePct(((nextPrice - anchorOpen) / anchorOpen) * 100) : q.changePct;
    const nextHigh = Math.max(q.high24h, nextPrice);
    const nextLow = q.low24h > 0 ? Math.min(q.low24h, nextPrice) : nextPrice;

    if (
      q.price === nextPrice &&
      q.changePct === nextChangePct &&
      q.high24h === nextHigh &&
      q.low24h === nextLow
    ) {
      return q;
    }

    changed = true;
    return {
      ...q,
      price: nextPrice,
      changePct: nextChangePct,
      high24h: nextHigh,
      low24h: nextLow,
    };
  });

  return changed ? next : prevQuotes;
}
