import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_QUOTES, mergeBuiltInAndCustomQuotes } from '../data/defaults';
import type { AdminManagedCoin } from '../types';
import {
  BINANCE_COMBINED_STREAM_URL,
  applyLiveMarketTicks,
  evaluateDeterministicFallbackQuotes,
  mapBinanceSymbolToMarketSymbol,
  parseBinanceMiniTickerPayload,
  parseBinanceRestTicker24hr,
  parseCoinbaseExchangeRates,
  type SharedMarketAnchor,
} from './marketFeed';
import type { MarketSymbol } from '../types';

test('BINANCE_COMBINED_STREAM_URL uses combined @miniTicker multi-stream endpoint', () => {
  assert.match(BINANCE_COMBINED_STREAM_URL, /^wss:\/\/stream\.binance\.com:9443\/stream\?streams=/);
  assert.match(BINANCE_COMBINED_STREAM_URL, /btcusdt@miniTicker/);
  assert.match(BINANCE_COMBINED_STREAM_URL, /ethusdt@miniTicker/);
  assert.match(BINANCE_COMBINED_STREAM_URL, /solusdt@miniTicker/);
  assert.match(BINANCE_COMBINED_STREAM_URL, /bnbusdt@miniTicker/);
  assert.match(BINANCE_COMBINED_STREAM_URL, /paxgusdt@miniTicker/);
  assert.equal(mapBinanceSymbolToMarketSymbol('paxgusdt'), 'GOLD');
  assert.equal(mapBinanceSymbolToMarketSymbol('BTCUSDT'), 'BTCUSDT');
});

test('parseBinanceMiniTickerPayload decodes combined stream envelope and computes 24h % change from c and o', () => {
  const tick = parseBinanceMiniTickerPayload({
    stream: 'btcusdt@miniTicker',
    data: {
      e: '24hrMiniTicker',
      s: 'BTCUSDT',
      c: '96500.00',
      o: '95000.00',
      h: '97100.00',
      l: '94200.00',
      v: '12345.67',
    },
  });
  assert.ok(tick);
  assert.equal(tick.symbol, 'BTCUSDT');
  assert.equal(tick.price, 96500);
  assert.equal(tick.changePct, 1.58);
  assert.equal(tick.high24h, 97100);
  assert.equal(tick.low24h, 94200);

  const goldTick = parseBinanceMiniTickerPayload({
    stream: 'paxgusdt@miniTicker',
    data: { s: 'PAXGUSDT', c: '2695.50', o: '2650.00', h: '2700', l: '2640' },
  });
  assert.equal(goldTick?.symbol, 'GOLD');
  assert.equal(goldTick?.price, 2695.5);
});

test('parseBinanceRestTicker24hr & parseCoinbaseExchangeRates parse REST fallback feeds accurately', () => {
  const restTicks = parseBinanceRestTicker24hr([
    {
      symbol: 'SOLUSDT',
      lastPrice: '188.45',
      priceChangePercent: '3.25',
      highPrice: '192.00',
      lowPrice: '180.10',
    },
    {
      symbol: 'UNKNOWNUSDT',
      lastPrice: '10.00',
      priceChangePercent: '0',
    },
  ]);
  assert.equal(restTicks.length, 1);
  assert.equal(restTicks[0].symbol, 'SOLUSDT');
  assert.equal(restTicks[0].price, 188.45);
  assert.equal(restTicks[0].changePct, 3.25);

  const cbTicks = parseCoinbaseExchangeRates(
    {
      data: {
        currency: 'USD',
        rates: {
          BTC: '0.000010526315789',
          ETH: '0.0003125',
          SOL: '0.005',
        },
      },
    },
    INITIAL_QUOTES
  );
  const btc = cbTicks.find((t) => t.symbol === 'BTCUSDT');
  const eth = cbTicks.find((t) => t.symbol === 'ETHUSDT');
  const sol = cbTicks.find((t) => t.symbol === 'SOLUSDT');
  assert.ok(btc && Math.abs(btc.price - 95000) < 5);
  assert.equal(eth?.price, 3200);
  assert.equal(sol?.price, 200);
});

test('applyLiveMarketTicks preserves custom coins & Firestore-overridden coins while avoiding duplicate keys', () => {
  const customCoins: AdminManagedCoin[] = [
    {
      symbol: 'BTCUSDT',
      label: 'BTC / USDT Override',
      shortName: 'BTC/USDT',
      basePrice: 88888,
      currentPrice: 88888,
      openPrice24h: 87500,
      high24h: 90000,
      low24h: 87000,
      changePct: 1.5,
      enabled: true,
      schedule: null,
      updatedAtMs: 1,
    },
    {
      symbol: 'XUUSDT',
      label: 'XU / USDT',
      shortName: 'XU/USDT',
      basePrice: 12.5,
      currentPrice: 12.5,
      openPrice24h: 12.25,
      high24h: 13,
      low24h: 12,
      changePct: 2.0,
      enabled: true,
      schedule: null,
      updatedAtMs: 1,
    },
  ];

  const merged = mergeBuiltInAndCustomQuotes(INITIAL_QUOTES, customCoins);
  const symbolCounts = merged.filter((q) => q.symbol === 'BTCUSDT').length;
  assert.equal(symbolCounts, 1, 'Overridden built-in quote must appear only once (no duplicate React key)');
  assert.equal(merged.find((q) => q.symbol === 'BTCUSDT')?.price, 88888);

  const afterExternalFeed = applyLiveMarketTicks(merged, [
    { symbol: 'BTCUSDT', price: 96000, changePct: 2.2, high24h: 97000, low24h: 94000 },
    { symbol: 'ETHUSDT', price: 3450, changePct: 1.4, high24h: 3500, low24h: 3390 },
  ]);

  // Firestore-overridden BTCUSDT stays at 88888 while non-overridden ETHUSDT updates to 3450
  assert.equal(afterExternalFeed.find((q) => q.symbol === 'BTCUSDT')?.price, 88888);
  assert.equal(afterExternalFeed.find((q) => q.symbol === 'ETHUSDT')?.price, 3450);
  assert.equal(afterExternalFeed.find((q) => q.symbol === 'XUUSDT')?.price, 12.5);
});

test('evaluateDeterministicFallbackQuotes matches 100% across devices for same UTC timestamp and preserves custom coins', () => {
  const anchors = new Map<MarketSymbol, SharedMarketAnchor>([
    ['BTCUSDT', { price: 94250, changePct: 1.2, high24h: 95000, low24h: 93000 }],
    ['ETHUSDT', { price: 3120, changePct: 0.8, high24h: 3180, low24h: 3050 }],
  ]);

  const sharedTimeMs = 1763700123456; // two devices within same UTC second
  const deviceATime = sharedTimeMs;
  const deviceBTime = sharedTimeMs + 300;

  const deviceA = evaluateDeterministicFallbackQuotes(INITIAL_QUOTES, anchors, INITIAL_QUOTES, deviceATime, false);
  const deviceB = evaluateDeterministicFallbackQuotes(INITIAL_QUOTES, anchors, INITIAL_QUOTES, deviceBTime, false);

  assert.equal(deviceA.find((q) => q.symbol === 'BTCUSDT')?.price, deviceB.find((q) => q.symbol === 'BTCUSDT')?.price);
  assert.equal(deviceA.find((q) => q.symbol === 'ETHUSDT')?.price, deviceB.find((q) => q.symbol === 'ETHUSDT')?.price);
  assert.equal(deviceA.find((q) => q.symbol === 'USOIL')?.price, deviceB.find((q) => q.symbol === 'USOIL')?.price);
});
