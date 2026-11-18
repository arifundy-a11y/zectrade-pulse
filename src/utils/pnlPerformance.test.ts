import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPnlPerformanceSeries, computeZeroOffsetRatio } from './pnlPerformance';
import type { MarketQuote, Position, TradeHistoryItem } from '../types';

const SAMPLE_QUOTES: MarketQuote[] = [
  {
    symbol: 'BTCUSDT',
    tvSymbol: 'BINANCE:BTCUSDT',
    label: 'BTC / USDT',
    shortName: 'BTC',
    price: 68000,
    changePct: 2.1,
    high24h: 69000,
    low24h: 65000,
  },
  {
    symbol: 'ETHUSDT',
    tvSymbol: 'BINANCE:ETHUSDT',
    label: 'ETH / USDT',
    shortName: 'ETH',
    price: 3400,
    changePct: -1.2,
    high24h: 3500,
    low24h: 3300,
  },
];

function makeTrade(overrides: Partial<TradeHistoryItem>): TradeHistoryItem {
  return {
    id: 't1',
    symbol: 'BTCUSDT',
    side: 'buy',
    leverage: 10,
    entryPrice: 65000,
    closePrice: 66000,
    totalFees: 2,
    pnlVal: 100,
    pnlPct: 15.38,
    accountMode: 'demo',
    closedAt: '10:00:00',
    rawTime: 1000,
    ...overrides,
  };
}

test('buildPnlPerformanceSeries returns empty points and zeroed stats when no trades or positions exist', () => {
  const result = buildPnlPerformanceSeries({
    tradeHistory: [],
    activePositions: [],
    quotes: SAMPLE_QUOTES,
    accountMode: 'demo',
    nowMs: 100000,
  });

  assert.equal(result.points.length, 0);
  assert.equal(result.stats.netPnl, 0);
  assert.equal(result.stats.realizedPnl, 0);
  assert.equal(result.stats.totalTrades, 0);
  assert.equal(result.stats.winRatePct, 0);
  assert.equal(result.stats.maxDrawdown, 0);
});

test('buildPnlPerformanceSeries computes cumulative PnL curve, drawdown, profit factor, and win rate chronologically', () => {
  const now = 1_700_000_000_000;
  const trades: TradeHistoryItem[] = [
    // Out-of-order input to confirm sorting by rawTime ascending
    makeTrade({ id: 't3', pnlVal: 250, pnlPct: 25, rawTime: now - 1000 }),
    makeTrade({ id: 't1', pnlVal: 150, pnlPct: 15, rawTime: now - 5000 }),
    makeTrade({ id: 't2', pnlVal: -80, pnlPct: -8, rawTime: now - 3000 }),
  ];

  const result = buildPnlPerformanceSeries({
    tradeHistory: trades,
    activePositions: [],
    quotes: SAMPLE_QUOTES,
    accountMode: 'demo',
    includeUnrealized: false,
    nowMs: now,
  });

  // Baseline + 3 trades
  assert.equal(result.points.length, 4);
  assert.deepEqual(
    result.points.map((p) => p.cumulativePnl),
    [0, 150, 70, 320]
  );
  assert.equal(result.stats.realizedPnl, 320);
  assert.equal(result.stats.netPnl, 320);
  assert.equal(result.stats.totalTrades, 3);
  assert.equal(result.stats.winCount, 2);
  assert.equal(result.stats.lossCount, 1);
  assert.equal(result.stats.breakevenCount, 0);
  assert.equal(result.stats.winRatePct, 66.67);
  assert.equal(result.stats.bestTradePnl, 250);
  assert.equal(result.stats.worstTradePnl, -80);
  assert.equal(result.stats.maxDrawdown, 80); // dropped from 150 peak to 70
  assert.equal(result.stats.profitFactor, 5); // (150 + 250) / 80
});

test('buildPnlPerformanceSeries scopes by accountMode and timeframe and appends live unrealized PnL', () => {
  const now = 1_700_000_000_000;
  const trades: TradeHistoryItem[] = [
    makeTrade({ id: 'old-demo', accountMode: 'demo', pnlVal: 500, rawTime: now - 10 * 24 * 60 * 60 * 1000 }),
    makeTrade({ id: 'recent-demo', accountMode: 'demo', pnlVal: 120, rawTime: now - 2 * 60 * 60 * 1000 }),
    makeTrade({ id: 'recent-real', accountMode: 'real', pnlVal: -40, rawTime: now - 1 * 60 * 60 * 1000 }),
  ];

  const openDemoPos: Position = {
    id: 'pos-1',
    symbol: 'BTCUSDT',
    side: 'buy',
    leverage: 10,
    entryPrice: 65000,
    markPrice: 68000,
    liqPrice: '$58500.00',
    margin: 650,
    btcQty: '0.1',
    totalValue: 6500, // 0.1 BTC notional -> (68000 - 65000) * 0.1 = +$300 unrealized
    tradingFeePaid: 13,
    fundingFeePaid: 0,
    openedAt: now - 1000,
    accountMode: 'demo',
  };

  const demo24h = buildPnlPerformanceSeries({
    tradeHistory: trades,
    activePositions: [openDemoPos],
    quotes: SAMPLE_QUOTES,
    accountMode: 'demo',
    accountScope: 'active',
    timeframe: '24h',
    includeUnrealized: true,
    nowMs: now,
  });

  // Baseline (0) -> recent-demo (+120) -> Live Open (+300 => +420)
  assert.equal(demo24h.points.length, 3);
  assert.equal(demo24h.points[1].cumulativePnl, 120);
  assert.equal(demo24h.points[2].isLiveUnrealized, true);
  assert.equal(demo24h.points[2].tradePnl, 300);
  assert.equal(demo24h.points[2].cumulativePnl, 420);
  assert.equal(demo24h.stats.realizedPnl, 120);
  assert.equal(demo24h.stats.unrealizedPnl, 300);
  assert.equal(demo24h.stats.netPnl, 420);

  const realAll = buildPnlPerformanceSeries({
    tradeHistory: trades,
    activePositions: [openDemoPos],
    quotes: SAMPLE_QUOTES,
    accountMode: 'real',
    accountScope: 'active',
    timeframe: 'all',
    includeUnrealized: true,
    nowMs: now,
  });

  assert.equal(realAll.points.length, 2);
  assert.equal(realAll.stats.netPnl, -40);
  assert.equal(realAll.stats.unrealizedPnl, 0);
});

test('buildPnlPerformanceSeries isolates selectedSymbol history and active positions when symbolScope is selected', () => {
  const now = 1_700_000_000_000;
  const trades: TradeHistoryItem[] = [
    makeTrade({ id: 'btc-1', symbol: 'BTCUSDT', pnlVal: 180, rawTime: now - 3000 }),
    makeTrade({ id: 'eth-1', symbol: 'ETHUSDT', pnlVal: -95, rawTime: now - 2000 }),
  ];

  const openPositions: Position[] = [
    {
      id: 'pos-eth',
      symbol: 'ETHUSDT',
      side: 'buy',
      leverage: 10,
      entryPrice: 3200,
      markPrice: 3400,
      liqPrice: '$2880.00',
      margin: 320,
      btcQty: '1',
      totalValue: 3200,
      tradingFeePaid: 6.4,
      fundingFeePaid: 0,
      openedAt: now - 1000,
      accountMode: 'demo',
    },
  ];

  const btcOnly = buildPnlPerformanceSeries({
    tradeHistory: trades,
    activePositions: openPositions,
    quotes: SAMPLE_QUOTES,
    accountMode: 'demo',
    selectedSymbol: 'BTCUSDT',
    symbolScope: 'selected',
    includeUnrealized: true,
    nowMs: now,
  });

  assert.equal(btcOnly.stats.totalTrades, 1);
  assert.equal(btcOnly.stats.openPositionCount, 0);
  assert.equal(btcOnly.stats.realizedPnl, 180);
  assert.equal(btcOnly.stats.netPnl, 180);

  const ethOnly = buildPnlPerformanceSeries({
    tradeHistory: trades,
    activePositions: openPositions,
    quotes: SAMPLE_QUOTES,
    accountMode: 'demo',
    selectedSymbol: 'ETHUSDT',
    symbolScope: 'selected',
    includeUnrealized: true,
    nowMs: now,
  });

  assert.equal(ethOnly.stats.totalTrades, 1);
  assert.equal(ethOnly.stats.openPositionCount, 1);
  assert.equal(ethOnly.stats.realizedPnl, -95);
  assert.equal(ethOnly.stats.unrealizedPnl, 200);
  assert.equal(ethOnly.stats.netPnl, 105);

  assert.equal(computeZeroOffsetRatio(ethOnly.points), 105 / 200);
});
