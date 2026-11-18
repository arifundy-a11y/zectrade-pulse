import type { AccountMode, MarketQuote, Position, TradeHistoryItem } from '../types';
import { calculateUnrealizedPnl, shouldLiquidatePosition } from './tradingEngine';

export type PnlTimeframe = '24h' | '7d' | '30d' | 'all';
export type PnlAccountScope = 'active' | 'all';
export type PnlSymbolScope = 'selected' | 'all';

export interface PnlCurvePoint {
  index: number;
  id: string;
  label: string;
  shortLabel: string;
  symbol: string;
  side: 'buy' | 'sell' | 'baseline' | 'live';
  tradePnl: number;
  pnlPct: number;
  cumulativePnl: number;
  timestampMs: number;
  timestampLabel: string;
  isBaseline: boolean;
  isLiveUnrealized?: boolean;
  isLiquidated?: boolean;
}

export interface PnlSummaryStats {
  netPnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  openPositionCount: number;
  totalTrades: number;
  winCount: number;
  lossCount: number;
  breakevenCount: number;
  winRatePct: number;
  bestTradePnl: number;
  worstTradePnl: number;
  maxDrawdown: number;
  profitFactor: number | null;
}

export interface PnlPerformanceSeries {
  points: PnlCurvePoint[];
  stats: PnlSummaryStats;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const TIMEFRAME_MS: Record<Exclude<PnlTimeframe, 'all'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

export function computeZeroOffsetRatio(points: PnlCurvePoint[]): number {
  if (points.length === 0) return 0.5;
  const values = points.map((p) => p.cumulativePnl);
  const maxVal = Math.max(...values);
  const minVal = Math.min(...values);
  if (maxVal <= 0) return 0;
  if (minVal >= 0) return 1;
  return maxVal / (maxVal - minVal);
}

export function buildPnlPerformanceSeries(params: {
  tradeHistory: TradeHistoryItem[];
  activePositions?: Position[];
  quotes?: MarketQuote[];
  accountMode: AccountMode;
  accountScope?: PnlAccountScope;
  selectedSymbol?: string;
  symbolScope?: PnlSymbolScope;
  timeframe?: PnlTimeframe;
  includeUnrealized?: boolean;
  nowMs?: number;
}): PnlPerformanceSeries {
  const {
    tradeHistory,
    activePositions = [],
    quotes = [],
    accountMode,
    accountScope = 'active',
    selectedSymbol,
    symbolScope = 'all',
    timeframe = 'all',
    includeUnrealized = true,
    nowMs = Date.now(),
  } = params;

  const cutoffMs = timeframe === 'all' ? 0 : nowMs - TIMEFRAME_MS[timeframe];
  const filterBySymbol = Boolean(selectedSymbol && symbolScope === 'selected');

  const scopedHistory = tradeHistory
    .filter((item) => {
      if (accountScope === 'active' && item.accountMode !== accountMode) return false;
      if (filterBySymbol && item.symbol !== selectedSymbol) return false;
      if (cutoffMs > 0 && item.rawTime > 0 && item.rawTime < cutoffMs) return false;
      return true;
    })
    .slice()
    .sort((a, b) => {
      const timeDiff = (a.rawTime || 0) - (b.rawTime || 0);
      if (timeDiff !== 0) return timeDiff;
      return a.id.localeCompare(b.id);
    });

  const scopedOpenPositions = includeUnrealized
    ? activePositions.filter((pos) => {
        if (accountScope !== 'all' && pos.accountMode !== accountMode) return false;
        if (filterBySymbol && pos.symbol !== selectedSymbol) return false;
        return true;
      })
    : [];

  let totalUnrealized = 0;
  for (const pos of scopedOpenPositions) {
    const liveQuote = quotes.find((q) => q.symbol === pos.symbol);
    const markPrice = liveQuote ? liveQuote.price : pos.markPrice || pos.entryPrice;
    const { pnlVal } = calculateUnrealizedPnl(pos, markPrice);
    const isLiq = shouldLiquidatePosition(pos, markPrice) || pnlVal <= -pos.margin;
    totalUnrealized += isLiq ? -pos.margin : pnlVal;
  }
  totalUnrealized = round2(totalUnrealized);

  let realizedPnl = 0;
  let winCount = 0;
  let lossCount = 0;
  let breakevenCount = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let bestTradePnl = 0;
  let worstTradePnl = 0;

  const points: PnlCurvePoint[] = [];

  if (scopedHistory.length > 0 || scopedOpenPositions.length > 0) {
    const firstTime =
      scopedHistory.length > 0
        ? scopedHistory[0].rawTime || nowMs
        : nowMs;

    points.push({
      index: 0,
      id: 'baseline-start',
      label: 'Start',
      shortLabel: 'Start',
      symbol: selectedSymbol && filterBySymbol ? selectedSymbol : 'START',
      side: 'baseline',
      tradePnl: 0,
      pnlPct: 0,
      cumulativePnl: 0,
      timestampMs: firstTime,
      timestampLabel: 'Initial',
      isBaseline: true,
    });
  }

  let runningCumulative = 0;
  let peakCumulative = 0;
  let maxDrawdown = 0;

  scopedHistory.forEach((item, idx) => {
    const tradePnl = round2(item.pnlVal);
    realizedPnl = round2(realizedPnl + tradePnl);
    runningCumulative = round2(runningCumulative + tradePnl);

    if (tradePnl > 0) {
      winCount += 1;
      grossProfit += tradePnl;
    } else if (tradePnl < 0) {
      lossCount += 1;
      grossLoss += Math.abs(tradePnl);
    } else {
      breakevenCount += 1;
    }

    if (idx === 0 || tradePnl > bestTradePnl) bestTradePnl = tradePnl;
    if (idx === 0 || tradePnl < worstTradePnl) worstTradePnl = tradePnl;

    if (runningCumulative > peakCumulative) {
      peakCumulative = runningCumulative;
    }
    const drawdown = round2(peakCumulative - runningCumulative);
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }

    points.push({
      index: points.length,
      id: item.id,
      label: `#${idx + 1} ${item.symbol}`,
      shortLabel: `#${idx + 1}`,
      symbol: item.symbol,
      side: item.side,
      tradePnl,
      pnlPct: round2(item.pnlPct),
      cumulativePnl: runningCumulative,
      timestampMs: item.rawTime || nowMs,
      timestampLabel: item.closedAt || new Date(item.rawTime || nowMs).toLocaleTimeString(),
      isBaseline: false,
      isLiquidated: Boolean(item.isLiquidated),
    });
  });

  if (scopedOpenPositions.length > 0) {
    const liveCum = round2(runningCumulative + totalUnrealized);
    if (liveCum > peakCumulative) {
      peakCumulative = liveCum;
    }
    const drawdown = round2(peakCumulative - liveCum);
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }

    points.push({
      index: points.length,
      id: 'live-open-positions',
      label: `Live (${scopedOpenPositions.length} Open)`,
      shortLabel: 'Live',
      symbol: scopedOpenPositions.length === 1 ? scopedOpenPositions[0].symbol : `${scopedOpenPositions.length} Open`,
      side: 'live',
      tradePnl: totalUnrealized,
      pnlPct: 0,
      cumulativePnl: liveCum,
      timestampMs: nowMs,
      timestampLabel: 'Live Mark',
      isBaseline: false,
      isLiveUnrealized: true,
    });
  }

  const totalTrades = scopedHistory.length;
  const winRatePct = totalTrades > 0 ? round2((winCount / totalTrades) * 100) : 0;
  const profitFactor =
    grossLoss > 0
      ? round2(grossProfit / grossLoss)
      : grossProfit > 0
      ? null
      : null;

  const netPnl = round2(realizedPnl + (scopedOpenPositions.length > 0 ? totalUnrealized : 0));

  return {
    points,
    stats: {
      netPnl,
      realizedPnl,
      unrealizedPnl: totalUnrealized,
      openPositionCount: scopedOpenPositions.length,
      totalTrades,
      winCount,
      lossCount,
      breakevenCount,
      winRatePct,
      bestTradePnl: totalTrades > 0 ? round2(bestTradePnl) : 0,
      worstTradePnl: totalTrades > 0 ? round2(worstTradePnl) : 0,
      maxDrawdown: round2(maxDrawdown),
      profitFactor,
    },
  };
}
