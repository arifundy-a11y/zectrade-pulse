import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBinanceOrderBook,
  computeBollingerBands,
  computeCandleCutOffCountdown,
  computeEma,
  computeKdj,
  computeMacd,
  computeMovingAverage,
  computePriceMeasurement,
  computeRsi,
  computeVisibleWindow,
  computeVolumeMa,
  computeVwap,
  formatChartPrice,
  formatChartTimestamp,
  generateRealisticCandles,
  generateRecentTrades,
  getBinanceKlineInterval,
  getBinanceKlineSymbol,
  getTickOptionsForPrice,
} from './chartEngine';

test('generateRealisticCandles anchors closing price smoothly to livePrice without price cliffs', () => {
  const live = 65867.66;
  const candles = generateRealisticCandles('BTCUSDT', live, '15m', 60, 1763140000000);
  assert.equal(candles.length, 60);
  assert.equal(candles[candles.length - 1].close, live);

  for (const c of candles) {
    assert.ok(c.high >= Math.max(c.open, c.close));
    assert.ok(c.low <= Math.min(c.open, c.close));
    assert.ok(c.volume > 0);
    // All candles remain within a realistic +-15% envelope of livePrice (no giant anomaly spikes)
    assert.ok(Math.abs(c.close - live) / live < 0.15);
  }

  // Verify 1w and 1mo historical candle generation
  const weekly = generateRealisticCandles('BTCUSDT', live, '1w', 120, 1763140000000);
  assert.equal(weekly.length, 120);
  assert.equal(weekly[weekly.length - 1].close, live);

  const monthly = generateRealisticCandles('XUUSDT', 100, '1mo', 48, 1763140000000);
  assert.equal(monthly.length, 48);
  assert.equal(monthly[monthly.length - 1].close, 100);
});

test('computeMovingAverage returns accurate rolling averages for periods 7 and 25', () => {
  const sample = Array.from({ length: 10 }, (_, i) => ({
    time: i * 60_000,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100 + i,
    volume: 10,
  }));
  const ma7 = computeMovingAverage(sample, 7);
  assert.equal(ma7[0], null);
  assert.equal(ma7[5], null);
  assert.equal(ma7[6], 103); // avg of 100..106
  assert.equal(ma7[9], 106); // avg of 103..109
});

test('getBinanceKlineSymbol and getBinanceKlineInterval map crypto, gold, custom coins, 1w, and 1mo accurately', () => {
  assert.equal(getBinanceKlineSymbol('BTCUSDT'), 'BTCUSDT');
  assert.equal(getBinanceKlineSymbol('ETHUSDT'), 'ETHUSDT');
  assert.equal(getBinanceKlineSymbol('BNBUSDT'), 'BNBUSDT');
  assert.equal(getBinanceKlineSymbol('XRPUSDT'), 'XRPUSDT');
  assert.equal(getBinanceKlineSymbol('DOGEUSDT'), 'DOGEUSDT');
  assert.equal(getBinanceKlineSymbol('GOLD'), 'PAXGUSDT');
  assert.equal(getBinanceKlineSymbol('USOIL'), null);
  assert.equal(getBinanceKlineSymbol('XUUSDT'), null);
  assert.equal(getBinanceKlineInterval('1w'), '1w');
  assert.equal(getBinanceKlineInterval('1mo'), '1M');
  assert.equal(formatChartPrice(65867.66), '65,867.7');
  assert.equal(formatChartPrice(89.97), '89.97');
  assert.equal(formatChartPrice(2.456), '2.456');
  assert.equal(formatChartPrice(0.1842), '0.1842');
  assert.match(formatChartTimestamp(Date.UTC(2026, 5, 15), '1w'), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(formatChartTimestamp(Date.UTC(2026, 5, 15), '1mo'), /^\d{4}-\d{2}$/);
});

test('computeCandleCutOffCountdown computes exact remaining time for 15m, 1h, 1w, and 1mo bars', () => {
  // 2026-01-01T00:07:15.000Z => 7m45s remaining in 15m candle
  const t1 = Date.UTC(2026, 0, 1, 0, 7, 15, 0);
  const info15m = computeCandleCutOffCountdown(t1, '15m');
  assert.equal(info15m.remainingMs, (7 * 60 + 45) * 1000);
  assert.equal(info15m.countdownLabel, '07:45');

  const info1h = computeCandleCutOffCountdown(t1, '1h');
  assert.equal(info1h.remainingMs, (52 * 60 + 45) * 1000);
  assert.equal(info1h.countdownLabel, '00:52:45');

  const info1w = computeCandleCutOffCountdown(t1, '1w');
  assert.ok(info1w.remainingMs > 3 * 86_400_000);
  assert.match(info1w.countdownLabel, /^\dd \d{2}:\d{2}:\d{2}$/);
  assert.match(info1w.nextCloseClock, /^\d{4}-\d{2}-\d{2}$/);

  const info1mo = computeCandleCutOffCountdown(t1, '1mo');
  assert.ok(info1mo.remainingMs >= 30 * 86_400_000);
  assert.equal(info1mo.nextCloseClock, '2026-02-01');
});

test('computeVisibleWindow clamps zoom level and pan offset accurately', () => {
  const w1 = computeVisibleWindow(180, 36, 0);
  assert.deepEqual(w1, { startIdx: 144, endIdx: 180, clampedVisible: 36, clampedOffset: 0 });

  const w2 = computeVisibleWindow(180, 4, 500, 12);
  assert.deepEqual(w2, { startIdx: 0, endIdx: 12, clampedVisible: 12, clampedOffset: 168 });

  const w3 = computeVisibleWindow(180, 24, 30, 12);
  assert.deepEqual(w3, { startIdx: 126, endIdx: 150, clampedVisible: 24, clampedOffset: 30 });
});

test('computeEma, computeBollingerBands, and computeRsi return bounded indicator values', () => {
  const trending = Array.from({ length: 30 }, (_, i) => ({
    time: i * 60_000,
    open: 100 + i * 2,
    high: 102 + i * 2,
    low: 99 + i * 2,
    close: 101 + i * 2,
    volume: 50,
  }));

  const ema12 = computeEma(trending, 12);
  assert.equal(ema12[10], null);
  assert.ok(typeof ema12[11] === 'number' && ema12[29]! > ema12[11]!);

  const boll = computeBollingerBands(trending, 20, 2);
  assert.equal(boll[18].middle, null);
  assert.ok(boll[29].upper! > boll[29].middle! && boll[29].middle! > boll[29].lower!);

  const rsi = computeRsi(trending, 14);
  assert.equal(rsi[13], null);
  assert.equal(rsi[14], 100);
  assert.equal(rsi[29], 100);
});

test('computeMacd, computeVwap, and computePriceMeasurement calculate accurately', () => {
  const uptrend = Array.from({ length: 45 }, (_, i) => ({
    time: i * 60_000,
    open: 100 + i,
    high: 102 + i,
    low: 99 + i,
    close: 101 + i,
    volume: 100 + i * 5,
  }));

  const macd = computeMacd(uptrend);
  assert.equal(macd[24].dif, null);
  assert.ok(macd[25].dif !== null && macd[25].dif > 0);
  assert.ok(macd[44].dea !== null && macd[44].histogram !== null);

  const vwap = computeVwap(uptrend);
  assert.equal(vwap.length, 45);
  assert.ok(vwap[0] !== null && vwap[44]! > vwap[0]!);
  assert.ok(vwap[44]! < uptrend[44].close);

  const mUp = computePriceMeasurement(100, 125, 10, 22);
  assert.equal(mUp.priceDelta, 25);
  assert.equal(mUp.pctChange, 25);
  assert.equal(mUp.barsCount, 13);
  assert.equal(mUp.isUp, true);
});

test('buildBinanceOrderBook orders asks descending and bids descending around live price', () => {
  const btcTicks = getTickOptionsForPrice(64500);
  assert.deepEqual(btcTicks, [0.1, 1, 10, 50]);
  const dogeTicks = getTickOptionsForPrice(0.1842);
  assert.deepEqual(dogeTicks, [0.0001, 0.001, 0.01]);

  const book = buildBinanceOrderBook(64516.0, 'BTCUSDT', 1, 5);
  assert.equal(book.asks.length, 5);
  assert.equal(book.bids.length, 5);
  // Highest ask at top -> lowest (best) ask closest to middle spread
  assert.ok(book.asks[0].price > book.asks[4].price);
  assert.ok(book.asks[4].price >= book.bids[0].price);
  // Highest (best) bid at top -> lowest bid at bottom
  assert.ok(book.bids[0].price > book.bids[4].price);
  assert.equal(book.bidRatioPct + book.askRatioPct, 100);

  const trades = generateRecentTrades(64516.0, 'BTCUSDT', 1763140000000, 8);
  assert.equal(trades.length, 8);
  assert.ok(trades[0].size > 0);
});

test('computeVolumeMa and computeKdj compute accurate Binance sub-pane values', () => {
  const sample = Array.from({ length: 18 }, (_, i) => ({
    time: i * 60_000,
    open: 100 + i,
    high: 103 + i,
    low: 99 + i,
    close: 102 + i,
    volume: 10 + i * 2,
  }));

  const volMa5 = computeVolumeMa(sample, 5);
  assert.equal(volMa5[3], null);
  assert.equal(volMa5[4], 14); // avg of 10, 12, 14, 16, 18

  const kdj = computeKdj(sample, 9, 3, 3);
  assert.equal(kdj[7].k, null);
  assert.ok(kdj[8].k !== null && kdj[8].k > 50);
  assert.ok(kdj[17].k !== null && kdj[17].d !== null && kdj[17].j !== null);
  assert.ok(kdj[17].j! >= kdj[17].k!);
});

