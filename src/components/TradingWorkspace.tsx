import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Edit3, ArrowDownRight, ArrowUpRight, Bell, Check, Lock, RotateCcw, SlidersHorizontal, Trash2, X } from 'lucide-react';
import type {
  AccountMode,
  AlertCondition,
  MarketQuote,
  MarketSymbol,
  OrderSide,
  Position,
  PreOrder,
  PriceAlert,
  TradeHistoryItem,
  WalletExecutionMode,
} from '../types';
import {
  OPEN_FEE_RATE,
  calculatePositionPreview,
  calculateProjectedSlTp,
  calculateUnrealizedPnl,
  checkOrderDirectionConflict,
  shouldLiquidatePosition,
  validateSlTpTargets,
} from '../utils/tradingEngine';
import { formatChartPrice } from '../utils/chartEngine';
import { MarketChart } from './MarketChart';
import { PnlGrowthChart } from './PnlGrowthChart';

interface TradingWorkspaceProps {
  quotes: MarketQuote[];
  selectedSymbol: MarketSymbol;
  onSelectSymbol: (symbol: MarketSymbol) => void;
  accountMode: AccountMode;
  onSetAccountMode: (mode: AccountMode) => void;
  availableBalance: number;
  preOrders: PreOrder[];
  activePositions: Position[];
  tradeHistory: TradeHistoryItem[];
  priceAlerts: PriceAlert[];
  onAddPriceAlert: (symbol: MarketSymbol, condition: AlertCondition, targetPrice: number) => void;
  onRemovePriceAlert: (id: string) => void;
  onRearmPriceAlert: (id: string) => void;
  onPlaceOrder: (payload: {
    symbol: MarketSymbol;
    side: OrderSide;
    margin: number;
    leverage: number;
    customEntryPrice: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
  }) => Promise<boolean>;
  onChasePreOrder: (id: string) => void;
  onOpenModifyOrder: (order: PreOrder) => void;
  onCancelPreOrder: (id: string) => void;
  onClosePosition: (id: string) => void;
  onUpdatePositionSlTp: (id: string, stopLoss: number | null, takeProfit: number | null) => Promise<boolean>;
  onOpenHistoryModal: () => void;
}

export const TradingWorkspace: React.FC<TradingWorkspaceProps> = ({
  quotes,
  selectedSymbol,
  onSelectSymbol,
  accountMode,
  onSetAccountMode,
  availableBalance,
  preOrders,
  activePositions,
  tradeHistory,
  priceAlerts,
  onAddPriceAlert,
  onRemovePriceAlert,
  onRearmPriceAlert,
  onPlaceOrder,
  onChasePreOrder,
  onOpenModifyOrder,
  onCancelPreOrder,
  onClosePosition,
  onUpdatePositionSlTp,
  onOpenHistoryModal,
}) => {
  const [walletExecMode, setWalletExecMode] = useState<WalletExecutionMode>('spot');
  const [marginInput, setMarginInput] = useState('');
  const [customEntryInput, setCustomEntryInput] = useState('');
  const [stopLossInput, setStopLossInput] = useState('');
  const [takeProfitInput, setTakeProfitInput] = useState('');
  const [leverage, setLeverage] = useState(10);
  const [pendingSide, setPendingSide] = useState<OrderSide>('buy');
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const isSubmittingOrderRef = useRef(false);
  const orderCooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (orderCooldownTimerRef.current) {
        clearTimeout(orderCooldownTimerRef.current);
      }
    };
  }, []);

  const [editingSlTpPosId, setEditingSlTpPosId] = useState<string | null>(null);
  const [editSlInput, setEditSlInput] = useState('');
  const [editTpInput, setEditTpInput] = useState('');
  const [savingSlTp, setSavingSlTp] = useState(false);

  const [exchangeTab, setExchangeTab] = useState<'orders' | 'positions' | 'alerts'>('positions');
  const [filterAllMarkets, setFilterAllMarkets] = useState(true);
  const [filterSide, setFilterSide] = useState<'all' | OrderSide>('all');

  const [alertSymbol, setAlertSymbol] = useState<MarketSymbol>(selectedSymbol);
  const [alertCondition, setAlertCondition] = useState<AlertCondition>('above');
  const [alertTargetInput, setAlertTargetInput] = useState('');

  const activeQuote = useMemo(
    () => quotes.find((q) => q.symbol === selectedSymbol) ?? quotes[0],
    [quotes, selectedSymbol]
  );

  const effectiveLeverage = walletExecMode === 'spot' ? 1 : leverage;
  const parsedMargin = parseFloat(marginInput) || 0;
  const parsedCustomEntry = customEntryInput.trim() ? parseFloat(customEntryInput) : null;
  const parsedStopLoss = stopLossInput.trim() ? parseFloat(stopLossInput) : null;
  const parsedTakeProfit = takeProfitInput.trim() ? parseFloat(takeProfitInput) : null;

  const buyConflict = useMemo(
    () => checkOrderDirectionConflict(selectedSymbol, 'buy', accountMode, activePositions, preOrders),
    [selectedSymbol, accountMode, activePositions, preOrders]
  );
  const sellConflict = useMemo(
    () => checkOrderDirectionConflict(selectedSymbol, 'sell', accountMode, activePositions, preOrders),
    [selectedSymbol, accountMode, activePositions, preOrders]
  );

  const previewEntryBase =
    parsedCustomEntry !== null && Number.isFinite(parsedCustomEntry) && parsedCustomEntry > 0
      ? parsedCustomEntry
      : activeQuote.price;

  const effectivePreviewSide: OrderSide = useMemo(() => {
    if (!buyConflict.allowed && sellConflict.allowed) return 'sell';
    if (!sellConflict.allowed && buyConflict.allowed) return 'buy';
    const slSuggestsShort =
      parsedStopLoss !== null && Number.isFinite(parsedStopLoss) && parsedStopLoss > previewEntryBase;
    const tpSuggestsShort =
      parsedTakeProfit !== null && Number.isFinite(parsedTakeProfit) && parsedTakeProfit < previewEntryBase;
    const slSuggestsLong =
      parsedStopLoss !== null && Number.isFinite(parsedStopLoss) && parsedStopLoss < previewEntryBase;
    const tpSuggestsLong =
      parsedTakeProfit !== null && Number.isFinite(parsedTakeProfit) && parsedTakeProfit > previewEntryBase;
    if ((slSuggestsShort || tpSuggestsShort) && !slSuggestsLong && !tpSuggestsLong) return 'sell';
    if ((slSuggestsLong || tpSuggestsLong) && !slSuggestsShort && !tpSuggestsShort) return 'buy';
    return pendingSide;
  }, [buyConflict.allowed, sellConflict.allowed, parsedStopLoss, parsedTakeProfit, previewEntryBase, pendingSide]);

  const preview = useMemo(
    () =>
      calculatePositionPreview({
        margin: parsedMargin,
        leverage: effectiveLeverage,
        side: effectivePreviewSide,
        marketPrice: activeQuote.price,
        customEntryPrice: parsedCustomEntry,
      }),
    [parsedMargin, effectiveLeverage, effectivePreviewSide, activeQuote.price, parsedCustomEntry]
  );

  const projectedSlTp = useMemo(
    () =>
      calculateProjectedSlTp({
        side: effectivePreviewSide,
        leverage: effectiveLeverage,
        margin: parsedMargin,
        entryPrice: preview.effectiveEntryPrice,
        stopLoss: parsedStopLoss !== null && Number.isFinite(parsedStopLoss) ? parsedStopLoss : null,
        takeProfit: parsedTakeProfit !== null && Number.isFinite(parsedTakeProfit) ? parsedTakeProfit : null,
      }),
    [effectivePreviewSide, effectiveLeverage, parsedMargin, preview.effectiveEntryPrice, parsedStopLoss, parsedTakeProfit]
  );

  const slTpValidation = useMemo(
    () =>
      validateSlTpTargets(
        effectivePreviewSide,
        preview.effectiveEntryPrice,
        parsedStopLoss !== null && Number.isFinite(parsedStopLoss) ? parsedStopLoss : null,
        parsedTakeProfit !== null && Number.isFinite(parsedTakeProfit) ? parsedTakeProfit : null
      ),
    [effectivePreviewSide, preview.effectiveEntryPrice, parsedStopLoss, parsedTakeProfit]
  );

  const applyMarginPct = (pct: number) => {
    // Account for 0.18% open fee on leveraged notional so Max fits cleanly
    const feeFactor = 1 + OPEN_FEE_RATE * effectiveLeverage;
    const maxSafe = Math.max(0, (availableBalance * pct) / feeFactor);
    setMarginInput(maxSafe > 0 ? maxSafe.toFixed(2) : '');
  };

  const executeOrder = async (side: OrderSide) => {
    if (isSubmittingOrderRef.current) return;
    isSubmittingOrderRef.current = true;
    setIsSubmittingOrder(true);
    setPendingSide(side);
    try {
      const ok = await onPlaceOrder({
        symbol: selectedSymbol,
        side,
        margin: parsedMargin,
        leverage: effectiveLeverage,
        customEntryPrice: parsedCustomEntry,
        stopLoss: stopLossInput.trim() ? parseFloat(stopLossInput) : null,
        takeProfit: takeProfitInput.trim() ? parseFloat(takeProfitInput) : null,
      });
      if (ok) {
        setMarginInput('');
        setCustomEntryInput('');
        setStopLossInput('');
        setTakeProfitInput('');
        setExchangeTab(preview.isLimitOrder ? 'orders' : 'positions');
      }
    } finally {
      if (orderCooldownTimerRef.current) {
        clearTimeout(orderCooldownTimerRef.current);
      }
      orderCooldownTimerRef.current = setTimeout(() => {
        isSubmittingOrderRef.current = false;
        setIsSubmittingOrder(false);
        orderCooldownTimerRef.current = null;
      }, 1500);
    }
  };

  const filteredOrders = useMemo(
    () =>
      preOrders.filter((o) => {
        const matchMarket = filterAllMarkets || o.symbol === selectedSymbol;
        const matchSide = filterSide === 'all' || o.side === filterSide;
        return matchMarket && matchSide;
      }),
    [preOrders, filterAllMarkets, selectedSymbol, filterSide]
  );

  const filteredPositions = useMemo(
    () =>
      activePositions.filter((p) => {
        const matchMarket = filterAllMarkets || p.symbol === selectedSymbol;
        const matchSide = filterSide === 'all' || p.side === filterSide;
        return matchMarket && matchSide;
      }),
    [activePositions, filterAllMarkets, selectedSymbol, filterSide]
  );

  return (
    <div className="space-y-2.5 sm:space-y-4">
      {/* Compact Account Mode & Balance Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-2 sm:p-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-[10px] sm:text-xs text-slate-400 block leading-tight">
            {accountMode === 'demo' ? 'Demo Spot Balance' : 'Real Spot Balance'}
          </span>
          <span className="text-sm sm:text-xl font-extrabold text-amber-400 font-mono tabular-nums leading-tight">
            ${availableBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
        <div className="flex items-center bg-slate-950 p-0.5 sm:p-1 rounded-lg border border-slate-800 text-[11px] sm:text-xs font-semibold shrink-0">
          <button
            type="button"
            onClick={() => onSetAccountMode('demo')}
            className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-md transition-colors whitespace-nowrap ${
              accountMode === 'demo' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            Demo
          </button>
          <button
            type="button"
            onClick={() => onSetAccountMode('real')}
            className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-md transition-colors whitespace-nowrap ${
              accountMode === 'real' ? 'bg-blue-600 text-white font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            Real
          </button>
        </div>
      </div>

      {/* Market Selection Strip (All Coins + Commodities, Horizontal Scrollable) */}
      <div
        aria-label="Market Pair Switcher Strip"
        className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto pb-0.5 no-scrollbar"
      >
        {quotes.map((q) => {
          const isSelected = q.symbol === selectedSymbol;
          const isPos = q.changePct >= 0;
          const decimals = q.price < 1 ? 4 : q.price < 10 ? 3 : 2;
          return (
            <button
              key={q.symbol}
              type="button"
              onClick={() => onSelectSymbol(q.symbol)}
              className={`min-w-[112px] sm:min-w-[144px] shrink-0 text-left px-2.5 py-1.5 sm:p-3 rounded-xl border transition-colors ${
                isSelected
                  ? 'bg-slate-800 border-amber-400'
                  : 'bg-slate-900 border-slate-800 hover:bg-slate-800/60'
              }`}
            >
              <div className="flex items-center justify-between gap-1 text-[10px] sm:text-xs font-bold leading-tight">
                <span className="text-slate-200 truncate flex items-center gap-1">
                  <span>{q.shortName}</span>
                  {q.isCustom && (
                    <span className="text-[8px] uppercase px-1 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 leading-none">
                      Official
                    </span>
                  )}
                </span>
                <span className={`font-mono tabular-nums ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
                  {isPos ? '+' : ''}
                  {q.changePct.toFixed(2)}%
                </span>
              </div>
              <p className="text-[11px] sm:text-sm font-extrabold text-white font-mono tabular-nums mt-0.5 sm:mt-1 leading-tight">
                ${q.price.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
              </p>
            </button>
          );
        })}
      </div>

      {/* Main Chart + Order Execution Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5 sm:gap-4 items-start">
        <div className="lg:col-span-2">
          <MarketChart
            quote={activeQuote}
            quotes={quotes}
            onSelectSymbol={onSelectSymbol}
            onSelectPrice={(price) =>
              setCustomEntryInput(price.toFixed(price < 1 ? 4 : price < 10 ? 3 : 2))
            }
            onQuickAlert={(targetPrice) =>
              onAddPriceAlert(
                activeQuote.symbol,
                targetPrice >= activeQuote.price ? 'above' : 'below',
                Number(targetPrice.toFixed(activeQuote.price < 1 ? 4 : activeQuote.price < 10 ? 3 : 2))
              )
            }
          />
        </div>

        {/* Execution Panel */}
        <div
          data-testid="order-execution-panel"
          className="bg-slate-900 border border-slate-800 rounded-xl sm:rounded-2xl p-2.5 sm:p-4 space-y-2 sm:space-y-3"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 sm:pb-2.5">
            <h3 className="text-xs sm:text-sm font-bold text-white flex items-center gap-1.5">
              <SlidersHorizontal className="w-3.5 h-3.5 text-blue-400" aria-hidden="true" />
              <span>Order Execution</span>
            </h3>
            <span className="text-[11px] font-mono text-slate-400">{activeQuote.label}</span>
          </div>

          <div className="grid grid-cols-2 bg-slate-950 p-0.5 sm:p-1 rounded-lg border border-slate-800 text-[11px] sm:text-xs font-semibold">
            <button
              type="button"
              onClick={() => setWalletExecMode('spot')}
              className={`py-1 sm:py-1.5 rounded transition-colors ${
                walletExecMode === 'spot' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Spot (1x)
            </button>
            <button
              type="button"
              onClick={() => setWalletExecMode('leverage')}
              className={`py-1 sm:py-1.5 rounded transition-colors ${
                walletExecMode === 'leverage' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Futures Leverage
            </button>
          </div>

          {/* Margin Input + Quick % Presets */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-1">
              <label htmlFor="exec-margin" className="text-[10px] sm:text-[11px] font-semibold text-slate-300 whitespace-nowrap">
                Margin Amount (USD)
              </label>
              <div className="flex items-center gap-1">
                {[0.25, 0.5, 0.75, 1].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => applyMarginPct(pct)}
                    className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded text-slate-300"
                  >
                    {pct === 1 ? 'Max' : `${pct * 100}%`}
                  </button>
                ))}
              </div>
            </div>
            <input
              id="exec-margin"
              type="number"
              min="1"
              step="any"
              value={marginInput}
              onChange={(e) => setMarginInput(e.target.value)}
              placeholder="e.g. 250.00"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 sm:px-3 py-1.5 sm:py-2 min-h-[34px] sm:min-h-[40px] text-xs sm:text-sm font-mono text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Pre-Order Entry Price + Optional Leverage Multiplier */}
          <div className={walletExecMode === 'leverage' ? 'grid grid-cols-12 gap-1.5 sm:gap-2 items-end' : ''}>
            <div className={walletExecMode === 'leverage' ? 'col-span-7' : ''}>
              <div className="flex items-center justify-between mb-0.5 sm:mb-1 gap-1">
                <label htmlFor="exec-entry" className="text-[10px] sm:text-[11px] font-semibold text-slate-300 truncate">
                  {walletExecMode === 'leverage' ? (
                    <>
                      <span className="sm:hidden">Limit Price (Opt.)</span>
                      <span className="hidden sm:inline">Limit Entry Price</span>
                    </>
                  ) : (
                    'Limit Entry Price (Optional)'
                  )}
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setCustomEntryInput(
                      activeQuote.price.toFixed(activeQuote.price < 1 ? 4 : activeQuote.price < 10 ? 3 : 2)
                    )
                  }
                  className="text-[10px] text-blue-400 hover:underline shrink-0"
                >
                  Use Market
                </button>
              </div>
              <input
                id="exec-entry"
                type="number"
                step="any"
                value={customEntryInput}
                onChange={(e) => setCustomEntryInput(e.target.value)}
                placeholder={`Market: $${formatChartPrice(activeQuote.price)}`}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 sm:px-3 py-1.5 sm:py-2 min-h-[34px] sm:min-h-[38px] text-xs font-mono text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            {walletExecMode === 'leverage' && (
              <div className="col-span-5">
                <label htmlFor="exec-leverage" className="text-[10px] sm:text-[11px] font-semibold text-slate-300 block mb-0.5 sm:mb-1 truncate">
                  <span className="sm:hidden">Leverage</span>
                  <span className="hidden sm:inline">Leverage Multiplier</span>
                </label>
                <select
                  id="exec-leverage"
                  value={leverage}
                  onChange={(e) => setLeverage(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 sm:px-2.5 py-1.5 sm:py-2 min-h-[34px] sm:min-h-[38px] text-xs font-mono text-white focus:outline-none focus:border-blue-500"
                >
                  <option value={5}>5x Cross</option>
                  <option value={10}>10x Cross</option>
                  <option value={20}>20x Cross</option>
                  <option value={50}>50x Cross</option>
                  <option value={100}>100x Isolated</option>
                </select>
              </div>
            )}
          </div>

          {/* Optional Stop Loss / Take Profit */}
          <div className="space-y-1.5">
            <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
              <div>
                <label htmlFor="exec-sl" className="text-[10px] text-slate-400 block mb-0.5 sm:mb-1">
                  Stop Loss ($)
                </label>
                <input
                  id="exec-sl"
                  type="number"
                  step="any"
                  value={stopLossInput}
                  onChange={(e) => setStopLossInput(e.target.value)}
                  placeholder="Optional"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 sm:px-2.5 py-1 sm:py-1.5 min-h-[32px] sm:min-h-[36px] text-[11px] font-mono text-white focus:outline-none focus:border-red-500"
                />
              </div>
              <div>
                <label htmlFor="exec-tp" className="text-[10px] text-slate-400 block mb-0.5 sm:mb-1">
                  Take Profit ($)
                </label>
                <input
                  id="exec-tp"
                  type="number"
                  step="any"
                  value={takeProfitInput}
                  onChange={(e) => setTakeProfitInput(e.target.value)}
                  placeholder="Optional"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 sm:px-2.5 py-1 sm:py-1.5 min-h-[32px] sm:min-h-[36px] text-[11px] font-mono text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            {(stopLossInput.trim() !== '' || takeProfitInput.trim() !== '') && (
              <div
                data-testid="sltp-autocount-box"
                className="bg-slate-950/90 border border-slate-800 rounded-lg px-2.5 py-1.5 text-[10px] font-mono tabular-nums space-y-1"
              >
                <div className="flex items-center justify-between text-slate-400">
                  <span>Auto-Count ({effectivePreviewSide === 'buy' ? 'Long' : 'Short'})</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setPendingSide('buy')}
                      className={`px-1.5 py-0.5 rounded ${
                        effectivePreviewSide === 'buy' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      Long
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingSide('sell')}
                      className={`px-1.5 py-0.5 rounded ${
                        effectivePreviewSide === 'sell' ? 'bg-red-500/20 text-red-300' : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      Short
                    </button>
                  </div>
                </div>
                {!slTpValidation.valid ? (
                  <p className="text-red-400 font-sans">{slTpValidation.reason}</p>
                ) : parsedMargin <= 0 ? (
                  <p className="text-slate-400 font-sans">Enter Margin ($) above to auto-count exact TP profit & SL loss.</p>
                ) : (
                  <>
                    {projectedSlTp.tpPnlUsd !== null && projectedSlTp.tpPnlPct !== null && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Est. Take Profit</span>
                        <span className="text-emerald-400 font-bold">
                          +${projectedSlTp.tpPnlUsd.toFixed(2)} (+{projectedSlTp.tpPnlPct.toFixed(2)}%)
                        </span>
                      </div>
                    )}
                    {projectedSlTp.slPnlUsd !== null && projectedSlTp.slPnlPct !== null && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Est. Stop Loss</span>
                        <span className="text-red-400 font-bold">
                          -${Math.abs(projectedSlTp.slPnlUsd).toFixed(2)} ({projectedSlTp.slPnlPct.toFixed(2)}%)
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Preview Breakdown */}
          <div className="bg-slate-950 rounded-lg sm:rounded-xl p-2 sm:p-3 border border-slate-800/90 text-[10px] sm:text-[11px] font-mono tabular-nums grid grid-cols-2 sm:grid-cols-1 gap-x-3 gap-y-1 sm:gap-y-1.5">
            <div className="flex justify-between gap-1 text-slate-400">
              <span>
                <span className="sm:hidden">Size</span>
                <span className="hidden sm:inline">Position Size</span>
              </span>
              <span className="text-emerald-400 font-bold">${preview.totalValue.toFixed(2)}</span>
            </div>
            <div className="flex justify-between gap-1 text-slate-400">
              <span>Est. Entry</span>
              <span className="text-white">${formatChartPrice(preview.effectiveEntryPrice)}</span>
            </div>
            <div className="col-span-2 sm:col-span-1 flex justify-between gap-1 text-slate-400">
              <span>
                <span className="sm:hidden">Est. Liq ({effectivePreviewSide === 'buy' ? 'Long' : 'Short'})</span>
                <span className="hidden sm:inline">Est. Liquidation ({effectivePreviewSide === 'buy' ? 'Long' : 'Short'})</span>
              </span>
              <span className="text-amber-400 font-bold">{preview.liqPriceFormatted}</span>
            </div>
            <div className="col-span-2 sm:col-span-1 grid grid-cols-2 sm:grid-cols-1 gap-x-3 gap-y-1 sm:gap-y-1.5 border-t border-slate-800 pt-1">
              <div className="flex justify-between gap-1 text-slate-400">
                <span>
                  <span className="sm:hidden">Open (0.18%)</span>
                  <span className="hidden sm:inline">Open Fee (0.18%)</span>
                </span>
                <span className="text-red-400">${preview.tradeFee.toFixed(2)}</span>
              </div>
              <div className="flex justify-between gap-1 text-slate-400">
                <span>
                  <span className="sm:hidden">Close (0.18%)</span>
                  <span className="hidden sm:inline">Est. Close Fee (0.18%)</span>
                </span>
                <span className="text-red-400">${preview.closeFee.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {(!buyConflict.allowed || !sellConflict.allowed) && (
            <div
              data-testid="single-side-lock-banner"
              className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-2.5 py-1.5 text-[10.5px] sm:text-[11px] text-amber-200"
            >
              <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                {buyConflict.reason ||
                  sellConflict.reason ||
                  `You already have an active position or pending order on ${selectedSymbol}. Close or cancel it first.`}
              </span>
            </div>
          )}

          {/* Buy / Sell CTA Row */}
          <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
            <button
              type="button"
              data-testid="order-buy-btn"
              disabled={isSubmittingOrder || !buyConflict.allowed}
              onClick={() => executeOrder('buy')}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-bold py-2 sm:py-2.5 min-h-[38px] sm:min-h-[42px] rounded-lg text-xs flex items-center justify-center gap-1 transition-colors"
            >
              <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {isSubmittingOrder
                  ? 'Processing...'
                  : !buyConflict.allowed
                  ? buyConflict.conflictType === 'opposite_side'
                    ? 'Close Short to Buy'
                    : 'Long Active'
                  : 'Buy / Long'}
              </span>
            </button>
            <button
              type="button"
              data-testid="order-sell-btn"
              disabled={isSubmittingOrder || !sellConflict.allowed}
              onClick={() => executeOrder('sell')}
              className="w-full bg-red-600 hover:bg-red-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-bold py-2 sm:py-2.5 min-h-[38px] sm:min-h-[42px] rounded-lg text-xs flex items-center justify-center gap-1 transition-colors"
            >
              <ArrowDownRight className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {isSubmittingOrder
                  ? 'Processing...'
                  : !sellConflict.allowed
                  ? sellConflict.conflictType === 'opposite_side'
                    ? 'Close Long to Sell'
                    : 'Short Active'
                  : 'Sell / Short'}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Orders / Positions / History Exchange Panel */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl sm:rounded-2xl p-2.5 sm:p-5 space-y-2 sm:space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2 sm:pb-2.5">
          <div className="flex items-center gap-3 sm:gap-4 text-[11px] sm:text-sm font-semibold overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setExchangeTab('positions')}
              className={`pb-1 sm:pb-1.5 border-b-2 transition-colors whitespace-nowrap ${
                exchangeTab === 'positions'
                  ? 'text-white border-blue-500'
                  : 'text-slate-400 border-transparent hover:text-slate-200'
              }`}
            >
              Positions ({filteredPositions.length})
            </button>
            <button
              type="button"
              onClick={() => setExchangeTab('orders')}
              className={`pb-1.5 border-b-2 transition-colors whitespace-nowrap ${
                exchangeTab === 'orders'
                  ? 'text-white border-blue-500'
                  : 'text-slate-400 border-transparent hover:text-slate-200'
              }`}
            >
              Pre-Orders ({filteredOrders.length})
            </button>
            <button
              type="button"
              onClick={() => setExchangeTab('alerts')}
              className={`pb-1.5 border-b-2 transition-colors whitespace-nowrap flex items-center gap-1 ${
                exchangeTab === 'alerts'
                  ? 'text-white border-amber-400'
                  : 'text-slate-400 border-transparent hover:text-slate-200'
              }`}
            >
              <Bell className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Alerts ({priceAlerts.filter((a) => !a.triggered).length})</span>
            </button>
            <button
              type="button"
              onClick={onOpenHistoryModal}
              className="pb-1.5 text-slate-400 hover:text-white border-b-2 border-transparent transition-colors whitespace-nowrap"
            >
              History
            </button>
          </div>

          {/* Filter Controls */}
          <div className="flex items-center gap-2 text-[10px] sm:text-xs font-mono">
            <button
              type="button"
              onClick={() => setFilterAllMarkets((prev) => !prev)}
              className={`px-2.5 py-1 rounded-md border transition-colors whitespace-nowrap ${
                filterAllMarkets
                  ? 'bg-blue-600/20 border-blue-500/40 text-blue-300'
                  : 'bg-slate-950 border-slate-800 text-slate-400'
              }`}
            >
              {filterAllMarkets ? 'All Markets' : selectedSymbol}
            </button>
            <select
              aria-label="Filter order side"
              value={filterSide}
              onChange={(e) => setFilterSide(e.target.value as 'all' | OrderSide)}
              className="bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-[10px] sm:text-xs text-slate-300 focus:outline-none"
            >
              <option value="all">All Sides</option>
              <option value="buy">Long</option>
              <option value="sell">Short</option>
            </select>
          </div>
        </div>

        {exchangeTab === 'positions' ? (
          filteredPositions.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">
              No active positions open. Place a market trade to track live PnL here.
            </p>
          ) : (
            <div className="divide-y divide-slate-800/80">
              {filteredPositions.map((pos) => {
                const liveQuote = quotes.find((q) => q.symbol === pos.symbol);
                const markPrice = liveQuote ? liveQuote.price : pos.entryPrice;
                const { pnlVal, pnlPct } = calculateUnrealizedPnl(pos, markPrice);
                const isLiqBreached = shouldLiquidatePosition(pos, markPrice) || pnlVal <= -pos.margin;
                const displayPnlVal = isLiqBreached ? -pos.margin : pnlVal;
                const displayPnlPct = isLiqBreached ? -100 : pnlPct;
                const isPos = displayPnlVal >= 0;

                const posSlTp = calculateProjectedSlTp({
                  side: pos.side,
                  leverage: pos.leverage,
                  margin: pos.margin,
                  entryPrice: pos.entryPrice,
                  stopLoss: pos.stopLoss ?? null,
                  takeProfit: pos.takeProfit ?? null,
                });

                const isEditingSlTp = editingSlTpPosId === pos.id;
                const draftSl = editSlInput.trim() ? parseFloat(editSlInput) : null;
                const draftTp = editTpInput.trim() ? parseFloat(editTpInput) : null;
                const draftProj = isEditingSlTp
                  ? calculateProjectedSlTp({
                      side: pos.side,
                      leverage: pos.leverage,
                      margin: pos.margin,
                      entryPrice: pos.entryPrice,
                      stopLoss: draftSl !== null && Number.isFinite(draftSl) ? draftSl : null,
                      takeProfit: draftTp !== null && Number.isFinite(draftTp) ? draftTp : null,
                    })
                  : null;

                return (
                  <div key={pos.id} className="py-2 sm:py-3 space-y-1.5 sm:space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs sm:text-sm font-bold">
                        <span className="text-white">{pos.symbol}</span>
                        <span className="text-slate-400 font-mono text-[11px]">{pos.leverage}x</span>
                        <span className={pos.side === 'buy' ? 'text-emerald-400 text-xs' : 'text-red-400 text-xs'}>
                          {pos.side === 'buy' ? 'Long' : 'Short'}
                        </span>
                      </div>
                      <div className="text-right font-mono tabular-nums">
                        <span className={`text-xs sm:text-sm font-bold ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
                          {isPos ? '+' : ''}${displayPnlVal.toFixed(2)} ({isPos ? '+' : ''}
                          {displayPnlPct.toFixed(2)}%)
                          {isLiqBreached && ' · Liquidating'}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] sm:text-xs font-mono tabular-nums text-slate-400">
                      <div>
                        <span className="block text-[10px] font-sans text-slate-500">Notional</span>
                        <strong className="text-white">${pos.totalValue.toFixed(2)}</strong>
                      </div>
                      <div>
                        <span className="block text-[10px] font-sans text-slate-500">Margin</span>
                        <strong className="text-amber-400">${pos.margin.toFixed(2)}</strong>
                      </div>
                      <div>
                        <span className="block text-[10px] font-sans text-slate-500">Entry / Mark</span>
                        <strong className="text-slate-200">
                          ${formatChartPrice(pos.entryPrice)} / ${formatChartPrice(markPrice)}
                        </strong>
                      </div>
                      <div>
                        <span className="block text-[10px] font-sans text-slate-500">Liq Price</span>
                        <strong className="text-amber-300">{pos.liqPrice}</strong>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[10px] font-mono text-slate-400">
                        {pos.stopLoss
                          ? `SL $${pos.stopLoss} (${posSlTp.slPnlUsd !== null ? `-$${Math.abs(posSlTp.slPnlUsd).toFixed(2)}` : ''})`
                          : 'No SL'}{' '}
                        ·{' '}
                        {pos.takeProfit
                          ? `TP $${pos.takeProfit} (${posSlTp.tpPnlUsd !== null ? `+$${posSlTp.tpPnlUsd.toFixed(2)}` : ''})`
                          : 'No TP'}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (isEditingSlTp) {
                              setEditingSlTpPosId(null);
                            } else {
                              setEditingSlTpPosId(pos.id);
                              setEditSlInput(pos.stopLoss ? String(pos.stopLoss) : '');
                              setEditTpInput(pos.takeProfit ? String(pos.takeProfit) : '');
                            }
                          }}
                          className="px-2.5 py-1.5 min-h-[34px] rounded-lg bg-slate-950 hover:bg-slate-800 text-slate-200 border border-slate-700 text-[11px] font-semibold flex items-center gap-1 transition-colors"
                        >
                          <Edit3 className="w-3 h-3 text-blue-400" aria-hidden="true" />
                          <span>{isEditingSlTp ? 'Hide SL/TP' : 'Set SL/TP'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onClosePosition(pos.id)}
                          className="px-3 py-1.5 min-h-[34px] rounded-lg bg-red-600/20 hover:bg-red-600 text-red-300 hover:text-white border border-red-500/30 text-[11px] font-semibold flex items-center gap-1 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Close Position</span>
                        </button>
                      </div>
                    </div>

                    {isEditingSlTp && (
                      <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 space-y-2">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
                          <div>
                            <label className="text-[10px] text-slate-400 block mb-1">Stop Loss ($)</label>
                            <input
                              type="number"
                              step="any"
                              value={editSlInput}
                              onChange={(e) => setEditSlInput(e.target.value)}
                              placeholder="Clear or Price"
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] font-mono text-white focus:outline-none focus:border-red-500"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-slate-400 block mb-1">Take Profit ($)</label>
                            <input
                              type="number"
                              step="any"
                              value={editTpInput}
                              onChange={(e) => setEditTpInput(e.target.value)}
                              placeholder="Clear or Price"
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] font-mono text-white focus:outline-none focus:border-emerald-500"
                            />
                          </div>
                          <button
                            type="button"
                            disabled={savingSlTp}
                            onClick={async () => {
                              setSavingSlTp(true);
                              try {
                                const ok = await onUpdatePositionSlTp(
                                  pos.id,
                                  draftSl !== null && Number.isFinite(draftSl) ? draftSl : null,
                                  draftTp !== null && Number.isFinite(draftTp) ? draftTp : null
                                );
                                if (ok) setEditingSlTpPosId(null);
                              } finally {
                                setSavingSlTp(false);
                              }
                            }}
                            className="py-1.5 px-3 min-h-[34px] rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold flex items-center justify-center gap-1"
                          >
                            <Check className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Save SL/TP</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingSlTpPosId(null)}
                            className="py-1.5 px-3 min-h-[34px] rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-[11px] font-semibold"
                          >
                            Cancel
                          </button>
                        </div>
                        {draftProj && (draftProj.tpPnlUsd !== null || draftProj.slPnlUsd !== null) && (
                          <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono">
                            {draftProj.tpPnlUsd !== null && (
                              <span className="text-emerald-400">
                                Auto-Count TP: +${draftProj.tpPnlUsd.toFixed(2)} (+{draftProj.tpPnlPct?.toFixed(2)}%)
                              </span>
                            )}
                            {draftProj.slPnlUsd !== null && (
                              <span className="text-red-400">
                                Auto-Count SL: -${Math.abs(draftProj.slPnlUsd).toFixed(2)} ({draftProj.slPnlPct?.toFixed(2)}%)
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        ) : exchangeTab === 'orders' ? (
          filteredOrders.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-500">
            No pending limit pre-orders. Set a custom entry price to queue a pre-order.
          </p>
        ) : (
          <div className="divide-y divide-slate-800/80">
            {filteredOrders.map((order) => (
              <div key={order.id} className="py-2 sm:py-3 space-y-1.5 sm:space-y-2.5">
                <div className="flex items-center justify-between gap-2 text-xs sm:text-sm font-bold">
                  <div className="flex items-center gap-2">
                    <span className="text-white">{order.symbol}</span>
                    <span className="text-slate-400 font-mono text-[11px]">{order.leverage}x</span>
                    <span className={order.side === 'buy' ? 'text-emerald-400 text-xs' : 'text-red-400 text-xs'}>
                      {order.side === 'buy' ? 'Limit Long' : 'Limit Short'}
                    </span>
                  </div>
                  <span className="text-xs font-mono text-emerald-400">Target ${formatChartPrice(order.entryPrice)}</span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-[10px] sm:text-xs font-mono tabular-nums text-slate-400">
                  <div>
                    <span className="block font-sans text-slate-500">Margin</span>
                    <strong className="text-amber-400">${order.margin.toFixed(2)}</strong>
                  </div>
                  <div>
                    <span className="block font-sans text-slate-500">Notional</span>
                    <strong className="text-white">${order.totalValue.toFixed(2)}</strong>
                  </div>
                  <div>
                    <span className="block font-sans text-slate-500">Liq Price</span>
                    <strong className="text-amber-300">{order.liqPrice}</strong>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => onChasePreOrder(order.id)}
                    className="py-1.5 min-h-[36px] rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-amber-400 text-[11px] font-semibold"
                  >
                    Chase
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenModifyOrder(order)}
                    className="py-1.5 min-h-[36px] rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-white text-[11px] font-semibold"
                  >
                    Modify
                  </button>
                  <button
                    type="button"
                    onClick={() => onCancelPreOrder(order.id)}
                    className="py-1.5 min-h-[36px] rounded-lg bg-slate-950 hover:bg-red-950/60 border border-slate-800 text-red-400 text-[11px] font-semibold"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ))}
          </div>
          )
        ) : (
          <div className="space-y-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const target = parseFloat(alertTargetInput);
                if (!Number.isFinite(target) || target <= 0) return;
                onAddPriceAlert(alertSymbol, alertCondition, target);
                setAlertTargetInput('');
              }}
              className="grid grid-cols-1 sm:grid-cols-12 gap-2 bg-slate-950 border border-slate-800 rounded-xl p-3"
            >
              <div className="sm:col-span-3">
                <label htmlFor="alert-asset" className="text-[10px] text-slate-400 block mb-1">
                  Asset
                </label>
                <select
                  id="alert-asset"
                  value={alertSymbol}
                  onChange={(e) => setAlertSymbol(e.target.value as MarketSymbol)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white"
                >
                  {quotes.map((q) => (
                    <option key={q.symbol} value={q.symbol}>
                      {q.shortName} (${q.price.toFixed(q.price < 1 ? 4 : q.price < 10 ? 3 : 2)})
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-3">
                <label htmlFor="alert-cond" className="text-[10px] text-slate-400 block mb-1">
                  Condition
                </label>
                <select
                  id="alert-cond"
                  value={alertCondition}
                  onChange={(e) => setAlertCondition(e.target.value as AlertCondition)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white"
                >
                  <option value="above">Price Rises Above (&gt;=)</option>
                  <option value="below">Price Drops Below (&lt;=)</option>
                </select>
              </div>
              <div className="sm:col-span-4">
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="alert-target" className="text-[10px] text-slate-400">
                    Target Price ($)
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const q = quotes.find((item) => item.symbol === alertSymbol);
                      if (q) setAlertTargetInput(q.price.toFixed(q.price < 1 ? 4 : q.price < 10 ? 3 : 2));
                    }}
                    className="text-[10px] text-blue-400 hover:underline"
                  >
                    Use Current
                  </button>
                </div>
                <input
                  id="alert-target"
                  type="number"
                  step="any"
                  min="0.01"
                  required
                  value={alertTargetInput}
                  onChange={(e) => setAlertTargetInput(e.target.value)}
                  placeholder="Target USD"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-xs font-mono text-white"
                />
              </div>
              <div className="sm:col-span-2 flex items-end">
                <button
                  type="submit"
                  className="w-full py-2 min-h-[36px] rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs"
                >
                  Set Alert
                </button>
              </div>
            </form>

            {priceAlerts.length === 0 ? (
              <p className="py-4 text-center text-xs text-slate-500">
                No custom price alerts configured. Set a threshold above to get notified automatically.
              </p>
            ) : (
              <div className="divide-y divide-slate-800/70">
                {priceAlerts.map((alert) => {
                  const livePrice = quotes.find((q) => q.symbol === alert.symbol)?.price;
                  return (
                    <div
                      key={alert.id}
                      className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] sm:text-xs font-mono tabular-nums"
                    >
                      <div>
                        <span className="font-bold text-white">{alert.symbol}</span>{' '}
                        <span className={alert.condition === 'above' ? 'text-emerald-400' : 'text-red-400'}>
                          {alert.condition === 'above' ? '>=' : '<='} ${alert.targetPrice.toFixed(2)}
                        </span>
                        <span className="block text-[10px] font-sans text-slate-400">
                          {alert.triggered
                            ? `Triggered at ${alert.triggeredAt ?? 'just now'}`
                            : `Watching · Live $${livePrice?.toFixed(2) ?? '--'}`}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[10px] font-sans font-semibold ${
                            alert.triggered ? 'text-amber-400' : 'text-emerald-400'
                          }`}
                        >
                          {alert.triggered ? 'Triggered' : 'Active'}
                        </span>
                        {alert.triggered && (
                          <button
                            type="button"
                            onClick={() => onRearmPriceAlert(alert.id)}
                            aria-label={`Re-arm ${alert.symbol} alert`}
                            className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-white"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onRemovePriceAlert(alert.id)}
                          aria-label={`Delete ${alert.symbol} alert`}
                          className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-red-400 hover:text-red-300"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Recharts Real-Time Asset PnL Growth Chart */}
      <PnlGrowthChart
        tradeHistory={tradeHistory}
        activePositions={activePositions}
        quotes={quotes}
        selectedSymbol={selectedSymbol}
        accountMode={accountMode}
      />
    </div>
  );
};
