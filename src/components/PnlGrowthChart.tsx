import React, { useId, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity, TrendingDown, TrendingUp } from 'lucide-react';
import type { AccountMode, MarketQuote, MarketSymbol, Position, TradeHistoryItem } from '../types';
import {
  buildPnlPerformanceSeries,
  computeZeroOffsetRatio,
  type PnlAccountScope,
  type PnlCurvePoint,
  type PnlSymbolScope,
  type PnlTimeframe,
} from '../utils/pnlPerformance';

interface PnlGrowthChartProps {
  tradeHistory: TradeHistoryItem[];
  activePositions: Position[];
  quotes: MarketQuote[];
  selectedSymbol: MarketSymbol;
  accountMode: AccountMode;
}

function formatAxisUsd(value: number): string {
  const abs = Math.abs(value);
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  if (abs === 0) return '$0';
  return `${sign}$${abs.toFixed(abs < 10 ? 2 : 0)}`;
}

function formatSignedUsd(value: number): string {
  const abs = Math.abs(value);
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}$${abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: PnlCurvePoint }>;
}

const CustomPnlTooltip: React.FC<CustomTooltipProps> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0]?.payload;
  if (!pt) return null;

  return (
    <div
      data-testid="pnl-hover-tooltip"
      className="rounded-lg bg-slate-900/95 border border-slate-700 px-2.5 py-2 text-[10px] sm:text-[11px] font-mono tabular-nums shadow-xl space-y-0.5 min-w-[170px]"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-bold text-white">{pt.label}</span>
        <span className="text-slate-400">{pt.timestampLabel}</span>
      </div>
      {!pt.isBaseline && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-400">
            {pt.isLiveUnrealized ? 'Open Unrealized' : 'Trade PnL'}
          </span>
          <span className={`font-bold ${pt.tradePnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {formatSignedUsd(pt.tradePnl)}
            {!pt.isLiveUnrealized && ` (${pt.pnlPct >= 0 ? '+' : ''}${pt.pnlPct.toFixed(1)}%)`}
          </span>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 border-t border-slate-800 pt-0.5">
        <span className="text-slate-400">Cumulative</span>
        <span className={`font-extrabold ${pt.cumulativePnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {formatSignedUsd(pt.cumulativePnl)}
        </span>
      </div>
    </div>
  );
};

interface CustomDotProps {
  cx?: number;
  cy?: number;
  payload?: PnlCurvePoint;
  index?: number;
}

const renderTradeDot = (props: CustomDotProps) => {
  const { cx, cy, payload } = props;
  if (typeof cx !== 'number' || typeof cy !== 'number' || !payload) {
    return <g key={props.index} />;
  }
  const fill = payload.isBaseline
    ? '#64748b'
    : payload.isLiveUnrealized
    ? payload.cumulativePnl >= 0
      ? '#38bdf8'
      : '#fb923c'
    : payload.tradePnl >= 0
    ? '#10b981'
    : '#ef4444';

  return (
    <g key={payload.id}>
      {payload.isLiveUnrealized && <circle cx={cx} cy={cy} r={7} fill={fill} opacity={0.22} />}
      <circle
        cx={cx}
        cy={cy}
        r={payload.isLiveUnrealized ? 4 : 3}
        fill={fill}
        stroke="#020617"
        strokeWidth={1.5}
      />
    </g>
  );
};

export const PnlGrowthChart: React.FC<PnlGrowthChartProps> = ({
  tradeHistory,
  activePositions,
  quotes,
  selectedSymbol,
  accountMode,
}) => {
  const uid = useId().replace(/:/g, '');
  const [timeframe, setTimeframe] = useState<PnlTimeframe>('all');
  const [symbolScope, setSymbolScope] = useState<PnlSymbolScope>('selected');
  const [accountScope, setAccountScope] = useState<PnlAccountScope>('active');
  const [includeUnrealized, setIncludeUnrealized] = useState(true);

  const series = useMemo(
    () =>
      buildPnlPerformanceSeries({
        tradeHistory,
        activePositions,
        quotes,
        accountMode,
        accountScope,
        selectedSymbol,
        symbolScope,
        timeframe,
        includeUnrealized,
      }),
    [tradeHistory, activePositions, quotes, accountMode, accountScope, selectedSymbol, symbolScope, timeframe, includeUnrealized]
  );

  const { points, stats } = series;
  const zeroOffset = useMemo(() => computeZeroOffsetRatio(points), [points]);

  const yDomain = useMemo<[number, number]>(() => {
    if (points.length === 0) return [-10, 10];
    const values = points.map((p) => p.cumulativePnl);
    const rawMin = Math.min(0, ...values);
    const rawMax = Math.max(0, ...values);
    const span = rawMax - rawMin;
    const pad = span > 0 ? span * 0.16 : 25;
    const min = rawMin === 0 ? Math.min(0, -pad * 0.25) : rawMin - pad;
    const max = rawMax === 0 ? Math.max(0, pad * 0.25) : rawMax + pad;
    return [min, max];
  }, [points]);

  const isPositiveNet = stats.netPnl >= 0;
  const assetBadge = symbolScope === 'selected' ? selectedSymbol : 'All Assets';

  return (
    <section
      aria-label="Real-Time Asset PnL Growth Chart"
      data-testid="pnl-growth-chart"
      className="bg-slate-900 border border-slate-800 rounded-xl sm:rounded-2xl p-2.5 sm:p-5 space-y-2.5 sm:space-y-3.5"
    >
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2 sm:pb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${
              isPositiveNet
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
            }`}
          >
            {isPositiveNet ? (
              <TrendingUp className="w-4 h-4" aria-hidden="true" />
            ) : (
              <TrendingDown className="w-4 h-4" aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0">
            <h3 className="text-xs sm:text-sm font-bold text-white flex flex-wrap items-center gap-1.5">
              <span>Real-Time PnL Growth</span>
              <span
                data-testid="pnl-asset-badge"
                className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-800 text-amber-300 border border-slate-700"
              >
                {assetBadge}
              </span>
              <span className="text-[10px] font-mono font-semibold text-slate-400">
                ({accountScope === 'active' ? `${accountMode.toUpperCase()}` : 'All Modes'})
              </span>
            </h3>
            <p className="text-[10px] sm:text-[11px] text-slate-400 truncate">
              Cumulative realized trade PnL + {stats.openPositionCount} live open {stats.openPositionCount === 1 ? 'position' : 'positions'}
            </p>
          </div>
        </div>

        {/* Controls: Asset Scope + Live PnL + Account Scope + Timeframe */}
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] sm:text-[11px] font-mono">
          <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800">
            <button
              type="button"
              onClick={() => setSymbolScope('selected')}
              className={`px-2 py-1 rounded transition-colors whitespace-nowrap ${
                symbolScope === 'selected' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              {selectedSymbol}
            </button>
            <button
              type="button"
              onClick={() => setSymbolScope('all')}
              className={`px-2 py-1 rounded transition-colors whitespace-nowrap ${
                symbolScope === 'all' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              All Pairs
            </button>
          </div>

          <button
            type="button"
            onClick={() => setIncludeUnrealized((prev) => !prev)}
            aria-pressed={includeUnrealized}
            className={`px-2 py-1 rounded-md border transition-colors whitespace-nowrap flex items-center gap-1 ${
              includeUnrealized
                ? 'bg-blue-600/20 border-blue-500/40 text-blue-300'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Activity className="w-3 h-3" aria-hidden="true" />
            <span>Live PnL</span>
          </button>

          <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800">
            <button
              type="button"
              onClick={() => setAccountScope('active')}
              className={`px-2 py-1 rounded transition-colors ${
                accountScope === 'active' ? 'bg-slate-800 text-white font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              {accountMode === 'demo' ? 'Demo' : 'Real'}
            </button>
            <button
              type="button"
              onClick={() => setAccountScope('all')}
              className={`px-2 py-1 rounded transition-colors ${
                accountScope === 'all' ? 'bg-slate-800 text-white font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              All
            </button>
          </div>

          <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800">
            {(['24h', '7d', '30d', 'all'] as PnlTimeframe[]).map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                className={`px-2 py-1 rounded uppercase transition-colors ${
                  timeframe === tf ? 'bg-blue-600 text-white font-bold' : 'text-slate-400 hover:text-white'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-3">
        <div className="bg-slate-950 border border-slate-800/90 rounded-xl px-2.5 sm:px-3 py-1.5 sm:py-2">
          <span className="text-[10px] text-slate-400 block">Cumulative Net PnL</span>
          <strong
            data-testid="pnl-net-value"
            className={`text-sm sm:text-base font-extrabold font-mono tabular-nums ${
              stats.netPnl > 0 ? 'text-emerald-400' : stats.netPnl < 0 ? 'text-red-400' : 'text-slate-200'
            }`}
          >
            {formatSignedUsd(stats.netPnl)}
          </strong>
        </div>

        <div className="bg-slate-950 border border-slate-800/90 rounded-xl px-2.5 sm:px-3 py-1.5 sm:py-2">
          <span className="text-[10px] text-slate-400 block">
            Win Rate ({stats.totalTrades} Closed{stats.openPositionCount > 0 ? ` · ${stats.openPositionCount} Live` : ''})
          </span>
          <strong data-testid="pnl-winrate-value" className="text-sm sm:text-base font-extrabold font-mono tabular-nums text-white">
            {stats.winRatePct.toFixed(1)}%
            <span className="text-[10px] font-normal text-slate-400 ml-1">
              ({stats.winCount}W/{stats.lossCount}L{stats.breakevenCount > 0 ? `/${stats.breakevenCount}BE` : ''})
            </span>
          </strong>
        </div>

        <div className="bg-slate-950 border border-slate-800/90 rounded-xl px-2.5 sm:px-3 py-1.5 sm:py-2">
          <span className="text-[10px] text-slate-400 block">Best / Worst Trade</span>
          <strong className="text-xs sm:text-sm font-bold font-mono tabular-nums">
            <span className="text-emerald-400">{formatSignedUsd(stats.bestTradePnl)}</span>
            <span className="text-slate-600 mx-1">/</span>
            <span className="text-red-400">{formatSignedUsd(stats.worstTradePnl)}</span>
          </strong>
        </div>

        <div className="bg-slate-950 border border-slate-800/90 rounded-xl px-2.5 sm:px-3 py-1.5 sm:py-2">
          <span className="text-[10px] text-slate-400 block">Max Drawdown · PF</span>
          <strong className="text-xs sm:text-sm font-bold font-mono tabular-nums text-amber-400">
            -${stats.maxDrawdown.toFixed(2)}
            <span className="text-slate-500 font-normal ml-1.5">
              · {stats.profitFactor !== null ? `${stats.profitFactor.toFixed(2)}x` : stats.winCount > 0 ? '∞' : '--'}
            </span>
          </strong>
        </div>
      </div>

      {/* Recharts Cumulative Curve Surface */}
      <div
        data-testid="pnl-recharts-wrapper"
        className="relative w-full h-[170px] sm:h-[230px] bg-slate-950 border border-slate-800/90 rounded-xl overflow-hidden"
      >
        {points.length === 0 ? (
          <div className="w-full h-full flex items-center justify-center p-4 text-center">
            <div className="max-w-sm space-y-1">
              <p className="text-xs font-semibold text-slate-300">
                No {symbolScope === 'selected' ? `${selectedSymbol} ` : ''}positions or trade history yet
              </p>
              <p className="text-[11px] text-slate-500">
                Open a position or close a {symbolScope === 'selected' ? selectedSymbol : ''} trade to track real-time cumulative PnL growth.
              </p>
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 16, right: 16, left: 4, bottom: 4 }}>
              <defs>
                <linearGradient id={`pnl-fill-${uid}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.34} />
                  <stop offset={`${(zeroOffset * 100).toFixed(2)}%`} stopColor="#10b981" stopOpacity={0.05} />
                  <stop offset={`${(zeroOffset * 100).toFixed(2)}%`} stopColor="#ef4444" stopOpacity={0.05} />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity={0.34} />
                </linearGradient>
                <linearGradient id={`pnl-line-${uid}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset={`${(zeroOffset * 100).toFixed(2)}%`} stopColor="#10b981" />
                  <stop offset={`${(zeroOffset * 100).toFixed(2)}%`} stopColor="#ef4444" />
                  <stop offset="100%" stopColor="#ef4444" />
                </linearGradient>
              </defs>

              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="shortLabel"
                stroke="#64748b"
                tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'ui-monospace, monospace' }}
                tickLine={false}
                axisLine={{ stroke: '#1e293b' }}
                minTickGap={16}
              />
              <YAxis
                width={54}
                domain={yDomain}
                tickFormatter={formatAxisUsd}
                stroke="#64748b"
                tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'ui-monospace, monospace' }}
                tickLine={false}
                axisLine={false}
              />
              <ReferenceLine y={0} stroke="#475569" strokeDasharray="4 4" strokeWidth={1.2} />
              <Tooltip
                content={<CustomPnlTooltip />}
                cursor={{ stroke: '#64748b', strokeDasharray: '3 3' }}
              />
              <Area
                type="monotone"
                dataKey="cumulativePnl"
                stroke={`url(#pnl-line-${uid})`}
                strokeWidth={2.25}
                fill={`url(#pnl-fill-${uid})`}
                isAnimationActive={false}
                dot={renderTradeDot}
                activeDot={{ r: 5, stroke: '#020617', strokeWidth: 2, fill: '#38bdf8' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
};
