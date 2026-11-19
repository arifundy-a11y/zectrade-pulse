import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BellPlus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Crosshair,
  Layers,
  Maximize2,
  Minimize2,
  Minus,
  RotateCcw,
  Ruler,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { MarketQuote, MarketSymbol } from '../types';
import { getCustomCoinKlinesStatic } from '../services/coinsService';
import {
  type ChartTimeframe,
  type OhlcvCandle,
  buildBinanceOrderBook,
  getCandleBucketStartMs,
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
} from '../utils/chartEngine';

interface MarketChartProps {
  quote: MarketQuote;
  quotes?: MarketQuote[];
  onSelectSymbol?: (symbol: MarketSymbol) => void;
  onQuickAlert?: (targetPrice: number) => void;
  onSelectPrice?: (price: number) => void;
}

const TIMEFRAMES: ChartTimeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '1w', '1mo'];
const TOTAL_CANDLES = 360;
const BINANCE_HISTORY_LIMIT = 500;
const DEFAULT_VISIBLE_CANDLES = 38;
const MIN_VISIBLE_CANDLES = 12;

type ChartStyleMode = 'candles' | 'hollow' | 'area';
type DrawToolMode = 'none' | 'hline' | 'measure';

interface HorizontalLine {
  id: string;
  price: number;
}

interface MeasureAnchor {
  globalIdx: number;
  price: number;
}

export const MarketChart: React.FC<MarketChartProps> = ({
  quote,
  quotes = [],
  onSelectSymbol,
  onQuickAlert,
  onSelectPrice,
}) => {
  const [timeframe, setTimeframe] = useState<ChartTimeframe>('15m');
  const [pairPickerOpen, setPairPickerOpen] = useState(false);
  const [pairQuery, setPairQuery] = useState('');
  const [pairCategory, setPairCategory] = useState<'all' | 'crypto' | 'commodities'>('all');
  const pairPickerRef = useRef<HTMLDivElement | null>(null);

  const [candles, setCandles] = useState<OhlcvCandle[]>(() =>
    generateRealisticCandles(quote.symbol, quote.price, '15m', TOTAL_CANDLES)
  );
  const [dataSource, setDataSource] = useState<'live' | 'sim'>('sim');

  // Zoom, Pan & Crosshair states
  const [visibleCount, setVisibleCount] = useState<number>(DEFAULT_VISIBLE_CANDLES);
  const [panOffset, setPanOffset] = useState<number>(0);
  const [hoveredLocalIdx, setHoveredLocalIdx] = useState<number | null>(null);
  const [crosshairLocked, setCrosshairLocked] = useState(false);

  // Indicators, Drawing Tools & Chart Modes
  const [chartStyle, setChartStyle] = useState<ChartStyleMode>('candles');
  const [showMa, setShowMa] = useState(true);
  const [showEma, setShowEma] = useState(false);
  const [showBoll, setShowBoll] = useState(false);
  const [showVwap, setShowVwap] = useState(false);
  const [showVol, setShowVol] = useState(true);
  const [showRsi, setShowRsi] = useState(false);
  const [showMacd, setShowMacd] = useState(false);
  const [showKdj, setShowKdj] = useState(false);
  const [maLongPeriod, setMaLongPeriod] = useState<50 | 99>(50);
  const [rsiPeriod, setRsiPeriod] = useState<6 | 14 | 24>(14);
  const [indicatorSettingsOpen, setIndicatorSettingsOpen] = useState(false);
  const indicatorSettingsRef = useRef<HTMLDivElement | null>(null);
  const [showOrderBook, setShowOrderBook] = useState(true);
  const [bookTab, setBookTab] = useState<'book' | 'trades'>('book');
  const [bookMode, setBookMode] = useState<'both' | 'asks' | 'bids'>('both');
  const tickOptions = useMemo(() => getTickOptionsForPrice(quote.price), [quote.price]);
  const [tickSize, setTickSize] = useState<number>(() => getTickOptionsForPrice(quote.price)[0]);

  const [drawTool, setDrawTool] = useState<DrawToolMode>('none');
  const [chartToolsOpen, setChartToolsOpen] = useState(false);
  const [hLines, setHLines] = useState<HorizontalLine[]>([]);
  const [measureStart, setMeasureStart] = useState<MeasureAnchor | null>(null);
  const [measureEnd, setMeasureEnd] = useState<MeasureAnchor | null>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isCompactViewport, setIsCompactViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 : false
  );

  // Live cut-off timer
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const onResize = () => setIsCompactViewport(window.innerWidth < 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const livePriceRef = useRef(quote.price);
  livePriceRef.current = quote.price;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{
    active: boolean;
    startX: number;
    startOffset: number;
    moved: boolean;
  }>({ active: false, startX: 0, startOffset: 0, moved: false });
  const pinchRef = useRef<{ active: boolean; startDist: number; startVisible: number }>({
    active: false,
    startDist: 0,
    startVisible: DEFAULT_VISIBLE_CANDLES,
  });

  // Tick cut-off timer every second
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Close fullscreen on Escape key
  useEffect(() => {
    if (!isFullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFullscreen]);

  // Close pair picker popover on outside click or Escape
  useEffect(() => {
    if (!pairPickerOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (pairPickerRef.current && !pairPickerRef.current.contains(e.target as Node)) {
        setPairPickerOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPairPickerOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [pairPickerOpen]);

  // Close indicator settings popover on outside click or Escape
  useEffect(() => {
    if (!indicatorSettingsOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (indicatorSettingsRef.current && !indicatorSettingsRef.current.contains(e.target as Node)) {
        setIndicatorSettingsOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIndicatorSettingsOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [indicatorSettingsOpen]);

  // Reset pan & drawings when switching symbol or timeframe
  useEffect(() => {
    setPanOffset(0);
    setHoveredLocalIdx(null);
    setCrosshairLocked(false);
    setMeasureStart(null);
    setMeasureEnd(null);
  }, [quote.symbol, timeframe]);

  useEffect(() => {
    setHLines([]);
    setTickSize(getTickOptionsForPrice(livePriceRef.current)[0]);
  }, [quote.symbol]);

  // Load historical klines from Cloud SQL (for custom coins) or Binance REST API (for BTC/ETH/SOL)
  useEffect(() => {
    const controller = new AbortController();
    const binanceSym = getBinanceKlineSymbol(quote.symbol);
    const binanceInterval = getBinanceKlineInterval(timeframe);
    let syncTimer: ReturnType<typeof setInterval> | null = null;

    const loadCustomCoinCandles = async (isInitialLoad: boolean) => {
      if (isInitialLoad) {
        setCandles(generateRealisticCandles(quote.symbol, livePriceRef.current, timeframe, TOTAL_CANDLES));
        setDataSource('live');
      }
      try {
        const rows = await getCustomCoinKlinesStatic(quote.symbol, timeframe, TOTAL_CANDLES);
        if (!controller.signal.aborted && rows.length > 0) {
          setCandles(rows);
          setDataSource('live');
        }
      } catch {
        // Keep current series on transient errors
      }
    };

    const loadCandles = async () => {
      if (quote.isCustom) {
        await loadCustomCoinCandles(true);
        syncTimer = setInterval(() => {
          loadCustomCoinCandles(false);
        }, 15_000);
        return;
      }

      setCandles(generateRealisticCandles(quote.symbol, livePriceRef.current, timeframe, TOTAL_CANDLES));
      setDataSource('sim');

      if (!binanceSym) return;

      try {
        const res = await fetch(
          `https://api.binance.com/api/v3/klines?symbol=${binanceSym}&interval=${binanceInterval}&limit=${BINANCE_HISTORY_LIMIT}`,
          { signal: controller.signal }
        );
        if (!res.ok) return;
        const rows = (await res.json()) as Array<
          [number, string, string, string, string, string, ...unknown[]]
        >;
        if (!Array.isArray(rows) || rows.length === 0) return;
        const parsed: OhlcvCandle[] = rows.map((r) => ({
          time: Number(r[0]),
          open: parseFloat(r[1]),
          high: parseFloat(r[2]),
          low: parseFloat(r[3]),
          close: parseFloat(r[4]),
          volume: parseFloat(r[5]),
        }));
        if (!controller.signal.aborted && parsed.length > 0) {
          setCandles(parsed);
          setDataSource('live');
        }
      } catch {
        // Keep simulated series anchored cleanly around livePrice
      }
    };

    loadCandles();
    return () => {
      controller.abort();
      if (syncTimer) clearInterval(syncTimer);
    };
  }, [quote.symbol, quote.isCustom, timeframe]);

  // Sync active candle with live ticks and roll strictly on exchange-standard UTC timeframe boundaries
  useEffect(() => {
    setCandles((prev) => {
      if (prev.length === 0) {
        return generateRealisticCandles(quote.symbol, quote.price, timeframe, TOTAL_CANDLES);
      }
      const last = prev[prev.length - 1];
      const now = Date.now();
      const currentBucketMs = getCandleBucketStartMs(now, timeframe);
      const lastBucketMs = getCandleBucketStartMs(last.time, timeframe);

      if (currentBucketMs > lastBucketMs) {
        const open = last.close;
        const close = quote.price;
        const stepCandle: OhlcvCandle = {
          time: currentBucketMs,
          open,
          high: Math.max(open, close),
          low: Math.min(open, close),
          close,
          volume: Number((Math.max(12, Math.abs(close - open) * 65 + 6)).toFixed(2)),
        };
        return [...prev.slice(-(BINANCE_HISTORY_LIMIT - 1)), stepCandle];
      }

      if (last.close === quote.price) return prev;

      const next = [...prev];
      const updated = { ...last };
      updated.close = quote.price;
      updated.high = Math.max(updated.high, quote.price);
      updated.low = Math.min(updated.low, quote.price);
      next[next.length - 1] = updated;
      return next;
    });
  }, [quote.price, quote.symbol, quote.isCustom, timeframe]);

  // Full-series technical indicators computed once on all candles
  const ma7All = useMemo(() => computeMovingAverage(candles, 7), [candles]);
  const ma25All = useMemo(() => computeMovingAverage(candles, 25), [candles]);
  const ma50All = useMemo(() => computeMovingAverage(candles, maLongPeriod), [candles, maLongPeriod]);
  const ema12All = useMemo(() => computeEma(candles, 12), [candles]);
  const ema26All = useMemo(() => computeEma(candles, 26), [candles]);
  const bollAll = useMemo(() => computeBollingerBands(candles, 20, 2), [candles]);
  const vwapAll = useMemo(() => computeVwap(candles), [candles]);
  const volMa5All = useMemo(() => computeVolumeMa(candles, 5), [candles]);
  const volMa10All = useMemo(() => computeVolumeMa(candles, 10), [candles]);
  const rsi14All = useMemo(() => computeRsi(candles, rsiPeriod), [candles, rsiPeriod]);
  const macdAll = useMemo(() => computeMacd(candles, 12, 26, 9), [candles]);
  const kdjAll = useMemo(() => computeKdj(candles, 9, 3, 3), [candles]);

  // Visible window slice
  const windowInfo = useMemo(
    () => computeVisibleWindow(candles.length, visibleCount, panOffset, MIN_VISIBLE_CANDLES),
    [candles.length, visibleCount, panOffset]
  );

  const visibleCandles = useMemo(
    () => candles.slice(windowInfo.startIdx, windowInfo.endIdx),
    [candles, windowInfo.startIdx, windowInfo.endIdx]
  );
  const ma7 = useMemo(
    () => ma7All.slice(windowInfo.startIdx, windowInfo.endIdx),
    [ma7All, windowInfo.startIdx, windowInfo.endIdx]
  );
  const ma25 = useMemo(
    () => ma25All.slice(windowInfo.startIdx, windowInfo.endIdx),
    [ma25All, windowInfo.startIdx, windowInfo.endIdx]
  );
  const ma50 = useMemo(
    () => ma50All.slice(windowInfo.startIdx, windowInfo.endIdx),
    [ma50All, windowInfo.startIdx, windowInfo.endIdx]
  );
  const ema12 = useMemo(
    () => ema12All.slice(windowInfo.startIdx, windowInfo.endIdx),
    [ema12All, windowInfo.startIdx, windowInfo.endIdx]
  );
  const ema26 = useMemo(
    () => ema26All.slice(windowInfo.startIdx, windowInfo.endIdx),
    [ema26All, windowInfo.startIdx, windowInfo.endIdx]
  );
  const boll = useMemo(
    () => bollAll.slice(windowInfo.startIdx, windowInfo.endIdx),
    [bollAll, windowInfo.startIdx, windowInfo.endIdx]
  );
  const vwap = useMemo(
    () => vwapAll.slice(windowInfo.startIdx, windowInfo.endIdx),
    [vwapAll, windowInfo.startIdx, windowInfo.endIdx]
  );
  const volMa5 = useMemo(
    () => volMa5All.slice(windowInfo.startIdx, windowInfo.endIdx),
    [volMa5All, windowInfo.startIdx, windowInfo.endIdx]
  );
  const volMa10 = useMemo(
    () => volMa10All.slice(windowInfo.startIdx, windowInfo.endIdx),
    [volMa10All, windowInfo.startIdx, windowInfo.endIdx]
  );
  const rsi14 = useMemo(
    () => rsi14All.slice(windowInfo.startIdx, windowInfo.endIdx),
    [rsi14All, windowInfo.startIdx, windowInfo.endIdx]
  );
  const macd = useMemo(
    () => macdAll.slice(windowInfo.startIdx, windowInfo.endIdx),
    [macdAll, windowInfo.startIdx, windowInfo.endIdx]
  );
  const kdj = useMemo(
    () => kdjAll.slice(windowInfo.startIdx, windowInfo.endIdx),
    [kdjAll, windowInfo.startIdx, windowInfo.endIdx]
  );

  // Zoom & Pan action helpers
  const zoomBy = useCallback(
    (factor: number) => {
      setVisibleCount((prev) => {
        const next = Math.round(prev * factor);
        return Math.max(MIN_VISIBLE_CANDLES, Math.min(candles.length || TOTAL_CANDLES, next));
      });
    },
    [candles.length]
  );

  const panByBars = useCallback(
    (deltaFromEnd: number) => {
      const maxOffset = Math.max(0, candles.length - windowInfo.clampedVisible);
      setPanOffset((prev) => Math.max(0, Math.min(maxOffset, prev + deltaFromEnd)));
    },
    [candles.length, windowInfo.clampedVisible]
  );

  const resetZoomAndPan = useCallback(() => {
    setVisibleCount(DEFAULT_VISIBLE_CANDLES);
    setPanOffset(0);
    setHoveredLocalIdx(null);
    setCrosshairLocked(false);
  }, []);

  const cycleChartStyle = () => {
    setChartStyle((s) => (s === 'candles' ? 'hollow' : s === 'hollow' ? 'area' : 'candles'));
  };

  const cutOffInfo = useMemo(() => computeCandleCutOffCountdown(nowMs, timeframe), [nowMs, timeframe]);

  const { minPrice, maxPrice, maxVol, macdAbsMax, highIdx, lowIdx, activeIdx } = useMemo(() => {
    if (visibleCandles.length === 0) {
      return {
        minPrice: quote.price * 0.99,
        maxPrice: quote.price * 1.01,
        maxVol: 1,
        macdAbsMax: 1,
        highIdx: 0,
        lowIdx: 0,
        activeIdx: 0,
      };
    }
    let min = Infinity;
    let max = -Infinity;
    let mVol = 0;
    let hIdx = 0;
    let lIdx = 0;

    for (let i = 0; i < visibleCandles.length; i++) {
      const c = visibleCandles[i];
      if (c.low < min) {
        min = c.low;
        lIdx = i;
      }
      if (c.high > max) {
        max = c.high;
        hIdx = i;
      }
      if (c.volume > mVol) mVol = c.volume;
    }

    if (showMa) {
      for (const arr of [ma7, ma25, ma50]) {
        for (const v of arr) {
          if (v !== null) {
            if (v < min) min = v;
            if (v > max) max = v;
          }
        }
      }
    }
    if (showEma) {
      for (const arr of [ema12, ema26]) {
        for (const v of arr) {
          if (v !== null) {
            if (v < min) min = v;
            if (v > max) max = v;
          }
        }
      }
    }
    if (showBoll) {
      for (const b of boll) {
        if (b.upper !== null && b.upper > max) max = b.upper;
        if (b.lower !== null && b.lower < min) min = b.lower;
      }
    }
    if (showVwap) {
      for (const v of vwap) {
        if (v !== null) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
    }

    let mMacd = 0.0001;
    if (showMacd) {
      for (const m of macd) {
        if (m.dif !== null) mMacd = Math.max(mMacd, Math.abs(m.dif));
        if (m.dea !== null) mMacd = Math.max(mMacd, Math.abs(m.dea));
        if (m.histogram !== null) mMacd = Math.max(mMacd, Math.abs(m.histogram));
      }
    }

    const span = Math.max(quote.price * 0.002, max - min);
    const padTop = span * 0.14;
    const padBottom = span * 0.12;
    const idx =
      hoveredLocalIdx !== null && visibleCandles[hoveredLocalIdx]
        ? hoveredLocalIdx
        : visibleCandles.length - 1;
    return {
      minPrice: min - padBottom,
      maxPrice: max + padTop,
      maxVol: Math.max(0.01, mVol),
      macdAbsMax: mMacd * 1.15,
      highIdx: hIdx,
      lowIdx: lIdx,
      activeIdx: idx,
    };
  }, [
    visibleCandles,
    hoveredLocalIdx,
    quote.price,
    showMa,
    showEma,
    showBoll,
    showVwap,
    showMacd,
    ma7,
    ma25,
    ma50,
    ema12,
    ema26,
    boll,
    vwap,
    macd,
  ]);

  const activeCandle = visibleCandles[activeIdx] ?? null;
  const activeMa7 = ma7[activeIdx] ?? null;
  const activeMa25 = ma25[activeIdx] ?? null;
  const activeMa50 = ma50[activeIdx] ?? null;
  const activeEma12 = ema12[activeIdx] ?? null;
  const activeEma26 = ema26[activeIdx] ?? null;
  const activeBoll = boll[activeIdx] ?? null;
  const activeVwap = vwap[activeIdx] ?? null;
  const activeVolMa5 = volMa5[activeIdx] ?? null;
  const activeVolMa10 = volMa10[activeIdx] ?? null;
  const activeRsi = rsi14[activeIdx] ?? null;
  const activeMacd = macd[activeIdx] ?? null;
  const activeKdj = kdj[activeIdx] ?? null;

  // Responsive SVG geometry matched pixel-for-pixel to the docked Order Book height
  const bookDockedRight = showOrderBook && !isFullscreen;
  const extraPaneCount = (showRsi ? 1 : 0) + (showMacd ? 1 : 0) + (showKdj ? 1 : 0);
  const splitHeightClass =
    extraPaneCount === 3
      ? 'h-[400px] sm:h-[546px]'
      : extraPaneCount === 2
      ? 'h-[356px] sm:h-[502px]'
      : extraPaneCount === 1
      ? 'h-[312px] sm:h-[457px]'
      : 'h-[268px] sm:h-[412px]';

  const svgWidth = isCompactViewport ? (bookDockedRight ? 245 : 440) : bookDockedRight ? 580 : 760;
  const kdjHeight = showKdj ? (isCompactViewport ? 38 : 54) : 0;
  const kdjGap = showKdj ? 6 : 0;
  const macdHeight = showMacd ? (isCompactViewport ? 42 : 58) : 0;
  const macdGap = showMacd ? 6 : 0;
  const rsiHeight = showRsi ? (isCompactViewport ? 40 : 56) : 0;
  const rsiGap = showRsi ? 6 : 0;
  const volHeight = showVol ? (isCompactViewport ? 34 : 52) : 0;
  const volGap = showVol ? 6 : 0;
  const baseHeight = isFullscreen
    ? isCompactViewport
      ? 440
      : 460
    : isCompactViewport
    ? bookDockedRight
      ? 245
      : 230
    : 375;
  const svgHeight =
    baseHeight +
    (showRsi ? (isCompactViewport ? 38 : 42) : 0) +
    (showMacd ? (isCompactViewport ? 42 : 48) : 0) +
    (showKdj ? (isCompactViewport ? 38 : 44) : 0);

  const rightAxisWidth = isCompactViewport ? (bookDockedRight ? 60 : 72) : 78;
  const bottomAxisHeight = 22;
  const plotLeft = 6;
  const plotRight = svgWidth - rightAxisWidth;
  const plotWidth = plotRight - plotLeft;
  const priceTop = 14;

  const contentBottom = svgHeight - bottomAxisHeight;
  const kdjBottom = contentBottom;
  const kdjTop = kdjBottom - kdjHeight;
  const macdBottom = showKdj ? kdjTop - kdjGap : contentBottom;
  const macdTop = macdBottom - macdHeight;
  const rsiBottom = showMacd ? macdTop - macdGap : showKdj ? kdjTop - kdjGap : contentBottom;
  const rsiTop = rsiBottom - rsiHeight;
  const volBottom = showRsi
    ? rsiTop - rsiGap
    : showMacd
    ? macdTop - macdGap
    : showKdj
    ? kdjTop - kdjGap
    : contentBottom;
  const volTop = volBottom - volHeight;
  const priceBottom = volTop - volGap;
  const priceHeight = Math.max(95, priceBottom - priceTop);

  const priceRange = Math.max(0.0001, maxPrice - minPrice);
  const toY = (p: number) => priceBottom - ((p - minPrice) / priceRange) * priceHeight;
  const fromY = (svgY: number) => {
    const clampedY = Math.max(priceTop, Math.min(priceBottom, svgY));
    return minPrice + ((priceBottom - clampedY) / priceHeight) * priceRange;
  };
  const slotWidth = visibleCandles.length > 0 ? plotWidth / visibleCandles.length : plotWidth;
  const candleX = (idx: number) => plotLeft + idx * slotWidth + slotWidth / 2;

  const buildLinePath = (series: Array<number | null>, yMapper: (v: number) => number = toY) => {
    const pts: string[] = [];
    for (let i = 0; i < series.length; i++) {
      const val = series[i];
      if (val === null || !Number.isFinite(val)) continue;
      const x = candleX(i).toFixed(1);
      const y = yMapper(val).toFixed(1);
      pts.push(`${pts.length === 0 ? 'M' : 'L'}${x} ${y}`);
    }
    return pts.join(' ');
  };

  const buildAreaPath = () => {
    if (visibleCandles.length === 0) return { line: '', area: '' };
    const linePts = visibleCandles.map(
      (c, idx) => `${idx === 0 ? 'M' : 'L'}${candleX(idx).toFixed(1)} ${toY(c.close).toFixed(1)}`
    );
    const firstX = candleX(0).toFixed(1);
    const lastX = candleX(visibleCandles.length - 1).toFixed(1);
    const line = linePts.join(' ');
    const area = `${line} L${lastX} ${priceBottom.toFixed(1)} L${firstX} ${priceBottom.toFixed(1)} Z`;
    return { line, area };
  };

  const buildBollBandFill = () => {
    const upperPts: string[] = [];
    const lowerPts: string[] = [];
    for (let i = 0; i < boll.length; i++) {
      const pt = boll[i];
      if (pt.upper === null || pt.lower === null) continue;
      const x = candleX(i).toFixed(1);
      upperPts.push(`${upperPts.length === 0 ? 'M' : 'L'}${x} ${toY(pt.upper).toFixed(1)}`);
      lowerPts.unshift(`L${x} ${toY(pt.lower).toFixed(1)}`);
    }
    if (upperPts.length === 0) return '';
    return `${upperPts.join(' ')} ${lowerPts.join(' ')} Z`;
  };

  // Binance-style grouped vertical order book (Asks top -> Live Price middle -> Bids bottom) & Recent Trades
  const bookRowsPerSide = bookMode === 'both' ? (isCompactViewport ? 4 : 6) : isCompactViewport ? 8 : 12;
  const orderBook = useMemo(
    () => buildBinanceOrderBook(quote.price, quote.symbol, tickSize, bookRowsPerSide),
    [quote.price, quote.symbol, tickSize, bookRowsPerSide]
  );

  const recentTrades = useMemo(
    () => generateRecentTrades(quote.price, quote.symbol, nowMs, 14),
    [quote.price, quote.symbol, nowMs]
  );

  const updateHoverFromClientX = (clientX: number, rect: DOMRect) => {
    if (visibleCandles.length === 0 || rect.width <= 0) return;
    const relX = ((clientX - rect.left) / rect.width) * svgWidth;
    const idx = Math.floor((relX - plotLeft) / slotWidth);
    if (idx >= 0 && idx < visibleCandles.length) {
      setHoveredLocalIdx(idx);
    } else if (!crosshairLocked) {
      setHoveredLocalIdx(null);
    }
  };

  const handleSvgClickAction = (clientX: number, clientY: number, rect: DOMRect) => {
    if (visibleCandles.length === 0 || rect.width <= 0 || rect.height <= 0) return;
    const relX = ((clientX - rect.left) / rect.width) * svgWidth;
    const relY = ((clientY - rect.top) / rect.height) * svgHeight;
    const localIdx = Math.max(0, Math.min(visibleCandles.length - 1, Math.floor((relX - plotLeft) / slotWidth)));
    const clickedPrice = fromY(relY);

    if (drawTool === 'hline') {
      setHLines((prev) => [...prev.slice(-4), { id: `${Date.now()}`, price: clickedPrice }]);
      return;
    }

    if (drawTool === 'measure') {
      const globalIdx = windowInfo.startIdx + localIdx;
      const snapPrice = visibleCandles[localIdx]?.close ?? clickedPrice;
      if (!measureStart || (measureStart && measureEnd)) {
        setMeasureStart({ globalIdx, price: snapPrice });
        setMeasureEnd(null);
      } else {
        setMeasureEnd({ globalIdx, price: snapPrice });
      }
      return;
    }

    if (crosshairLocked) {
      updateHoverFromClientX(clientX, rect);
    }
  };

  const handleWheelZoom = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 4) {
      panByBars(e.deltaX > 0 ? -3 : 3);
      return;
    }
    zoomBy(e.deltaY < 0 ? 0.85 : 1.18);
  };

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startOffset: windowInfo.clampedOffset,
      moved: false,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (dragRef.current.active) {
      const dx = e.clientX - dragRef.current.startX;
      if (Math.abs(dx) > 5) {
        dragRef.current.moved = true;
        const pxPerBar = (rect.width * (plotWidth / svgWidth)) / Math.max(1, visibleCandles.length);
        const barsShifted = Math.round(dx / Math.max(4, pxPerBar));
        const maxOffset = Math.max(0, candles.length - windowInfo.clampedVisible);
        setPanOffset(Math.max(0, Math.min(maxOffset, dragRef.current.startOffset + barsShifted)));
        return;
      }
    }
    if (!crosshairLocked) {
      updateHoverFromClientX(e.clientX, rect);
    }
  };

  const handleMouseUp = (e: React.MouseEvent<SVGSVGElement>) => {
    if (dragRef.current.active && !dragRef.current.moved) {
      handleSvgClickAction(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
    }
    dragRef.current.active = false;
  };

  const handleTouchStart = (e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = {
        active: true,
        startDist: Math.hypot(dx, dy),
        startVisible: windowInfo.clampedVisible,
      };
      dragRef.current.active = false;
      return;
    }
    if (e.touches.length === 1) {
      dragRef.current = {
        active: true,
        startX: e.touches[0].clientX,
        startOffset: windowInfo.clampedOffset,
        moved: false,
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length === 2 && pinchRef.current.active) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (pinchRef.current.startDist > 10) {
        const scale = pinchRef.current.startDist / Math.max(10, dist);
        const next = Math.round(pinchRef.current.startVisible * scale);
        setVisibleCount(Math.max(MIN_VISIBLE_CANDLES, Math.min(candles.length || TOTAL_CANDLES, next)));
      }
      return;
    }
    if (e.touches.length === 1 && dragRef.current.active) {
      const rect = e.currentTarget.getBoundingClientRect();
      const dx = e.touches[0].clientX - dragRef.current.startX;
      if (Math.abs(dx) > 8) {
        dragRef.current.moved = true;
        const pxPerBar = (rect.width * (plotWidth / svgWidth)) / Math.max(1, visibleCandles.length);
        const barsShifted = Math.round(dx / Math.max(4, pxPerBar));
        const maxOffset = Math.max(0, candles.length - windowInfo.clampedVisible);
        setPanOffset(Math.max(0, Math.min(maxOffset, dragRef.current.startOffset + barsShifted)));
      } else {
        updateHoverFromClientX(e.touches[0].clientX, rect);
      }
    }
  };

  const handleTouchEnd = () => {
    pinchRef.current.active = false;
    dragRef.current.active = false;
  };

  const isPositive = quote.changePct >= 0;
  const lastCandle = visibleCandles[visibleCandles.length - 1];
  const liveBull = lastCandle ? lastCandle.close >= lastCandle.open : isPositive;
  const liveTagColor = liveBull ? '#0ECB81' : '#F6465D';
  const liveY = Math.max(priceTop + 10, Math.min(priceBottom - 22, toY(quote.price)));
  const isAtLiveEdge = windowInfo.clampedOffset === 0;
  const zoomMultiplier = (DEFAULT_VISIBLE_CANDLES / Math.max(1, windowInfo.clampedVisible)).toFixed(1);

  const changeCandlePct =
    activeCandle && activeCandle.open > 0
      ? ((activeCandle.close - activeCandle.open) / activeCandle.open) * 100
      : 0;
  const amplitudePct =
    activeCandle && activeCandle.low > 0
      ? ((activeCandle.high - activeCandle.low) / activeCandle.low) * 100
      : 0;

  // Active measure range (either locked measureEnd or live hovered preview while measureStart is anchored)
  const effectiveMeasureEnd: MeasureAnchor | null =
    measureEnd ??
    (drawTool === 'measure' && measureStart && hoveredLocalIdx !== null && visibleCandles[hoveredLocalIdx]
      ? {
          globalIdx: windowInfo.startIdx + hoveredLocalIdx,
          price: visibleCandles[hoveredLocalIdx].close,
        }
      : null);

  const measurement =
    measureStart && effectiveMeasureEnd
      ? computePriceMeasurement(
          measureStart.price,
          effectiveMeasureEnd.price,
          measureStart.globalIdx,
          effectiveMeasureEnd.globalIdx
        )
      : null;

  const { line: areaLinePath, area: areaFillPath } = chartStyle === 'area' ? buildAreaPath() : { line: '', area: '' };

  const containerClasses = isFullscreen
    ? 'fixed inset-0 z-50 bg-[#0B0E11] flex flex-col p-2.5 sm:p-4 overflow-y-auto space-y-2'
    : 'bg-[#0B0E11] border border-slate-800/90 rounded-xl sm:rounded-2xl p-2 sm:p-3.5 space-y-1.5 sm:space-y-2 shadow-xl';

  return (
    <div className={containerClasses}>
      {/* Compact Exchange Pair Ticker Header */}
      <div className="flex items-start justify-between gap-2 px-0.5">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2.5">
            <div className="relative" ref={pairPickerRef}>
              {quotes.length > 0 && onSelectSymbol ? (
                <button
                  type="button"
                  data-testid="chart-symbol-selector"
                  aria-haspopup="listbox"
                  aria-expanded={pairPickerOpen}
                  onClick={() => setPairPickerOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#161A1E] hover:bg-[#1E2329] border border-[#2B3139] hover:border-[#F0B90B]/60 text-xs sm:text-sm font-bold text-white font-mono tracking-tight transition-colors"
                >
                  <span>{quote.label}</span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-[#F0B90B] transition-transform ${pairPickerOpen ? 'rotate-180' : ''}`}
                    aria-hidden="true"
                  />
                </button>
              ) : (
                <h2 className="text-xs sm:text-sm font-bold text-white font-mono tracking-tight">
                  {quote.label}
                </h2>
              )}

              {pairPickerOpen && quotes.length > 0 && onSelectSymbol && (
                <div
                  role="listbox"
                  aria-label="Select trading pair"
                  className="absolute left-0 top-full mt-1.5 w-[290px] sm:w-[340px] z-40 bg-[#12161C] border border-[#2B3139] rounded-xl shadow-2xl p-2.5 space-y-2"
                >
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
                    <input
                      type="text"
                      value={pairQuery}
                      onChange={(e) => setPairQuery(e.target.value)}
                      placeholder="Search BTC, ETH, SOL, BNB..."
                      className="w-full bg-[#0B0E11] border border-[#2B3139] focus:border-[#F0B90B] rounded-lg pl-8 pr-2.5 py-1.5 text-[11px] font-mono text-white outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-1 bg-[#0B0E11] p-0.5 rounded-lg border border-[#1E2329] text-[10px] font-semibold">
                    {(['all', 'crypto', 'commodities'] as const).map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setPairCategory(cat)}
                        className={`py-1 rounded transition-colors ${
                          pairCategory === cat
                            ? 'bg-[#2B3139] text-[#F0B90B]'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {cat === 'all' ? `All (${quotes.length})` : cat === 'crypto' ? 'Coins' : 'Gold & Oil'}
                      </button>
                    ))}
                  </div>
                  <div className="max-h-60 overflow-y-auto divide-y divide-[#1E2329]/80 pr-0.5">
                    {quotes
                      .filter((item) => {
                        const isCommodity = item.symbol === 'GOLD' || item.symbol === 'USOIL';
                        if (pairCategory === 'crypto' && isCommodity) return false;
                        if (pairCategory === 'commodities' && !isCommodity) return false;
                        const q = pairQuery.trim().toLowerCase();
                        if (!q) return true;
                        return (
                          item.label.toLowerCase().includes(q) ||
                          item.shortName.toLowerCase().includes(q) ||
                          item.symbol.toLowerCase().includes(q)
                        );
                      })
                      .map((item) => {
                        const active = item.symbol === quote.symbol;
                        const pos = item.changePct >= 0;
                        const isCommodity = item.symbol === 'GOLD' || item.symbol === 'USOIL';
                        return (
                          <button
                            key={item.symbol}
                            type="button"
                            role="option"
                            aria-selected={active}
                            onClick={() => {
                              onSelectSymbol(item.symbol);
                              setPairPickerOpen(false);
                              setPairQuery('');
                            }}
                            className={`w-full flex items-center justify-between gap-2 px-2 py-2 rounded-lg text-left transition-colors ${
                              active ? 'bg-[#1E2329]' : 'hover:bg-[#161A1E]'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-bold font-mono text-white">
                                  {item.label}
                                </span>
                                <span
                                  className={`text-[9px] font-mono uppercase px-1 py-0.5 rounded ${
                                    item.isCustom
                                      ? 'bg-amber-500/20 text-amber-300'
                                      : 'bg-[#0B0E11] text-slate-400'
                                  }`}
                                >
                                  {item.isCustom ? 'Official' : isCommodity ? 'Index' : 'Spot/Perp'}
                                </span>
                              </div>
                            </div>
                            <div className="text-right font-mono tabular-nums shrink-0">
                              <span className="block text-xs font-bold text-white">
                                ${formatChartPrice(item.price)}
                              </span>
                              <span className={`block text-[10px] ${pos ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>
                                {pos ? '+' : ''}
                                {item.changePct.toFixed(2)}%
                              </span>
                            </div>
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>

            <span className="text-[10px] font-mono text-[#F0B90B]">
              {dataSource === 'live' ? 'Perp · Live' : quote.isCustom ? 'Official · Live' : 'Index · Live'}
            </span>

            <span
              data-testid="chart-cutoff-timer"
              className="inline-flex items-center gap-1 text-[10px] font-mono tabular-nums text-amber-300 bg-[#161A1E] border border-[#2B3139] px-1.5 py-0.5 rounded"
              title={`Candle closes at ${cutOffInfo.nextCloseClock}`}
            >
              <Clock className="w-3 h-3 text-[#F0B90B]" aria-hidden="true" />
              <span>Cut-off {cutOffInfo.nextCloseClock} · {cutOffInfo.countdownLabel}</span>
            </span>
          </div>

          <div className="flex flex-wrap items-baseline justify-between gap-2 font-mono tabular-nums">
            <div className="flex items-baseline gap-2">
              <span className={`text-base sm:text-lg font-extrabold ${isPositive ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>
                $
                {quote.price.toLocaleString('en-US', {
                  minimumFractionDigits: quote.price < 1 ? 4 : quote.price < 10 ? 3 : 2,
                  maximumFractionDigits: quote.price < 1 ? 4 : quote.price < 10 ? 3 : 2,
                })}
              </span>
              <span className={`text-[11px] font-semibold ${isPositive ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>
                {isPositive ? '+' : ''}
                {quote.changePct.toFixed(2)}%
              </span>
            </div>

            <div className="flex items-center gap-3 text-[10px] sm:text-[11px] text-slate-400">
              <span>
                H <strong className="text-slate-200 font-medium">${formatChartPrice(quote.high24h)}</strong>
              </span>
              <span>
                L <strong className="text-slate-200 font-medium">${formatChartPrice(quote.low24h)}</strong>
              </span>
              {activeCandle && (
                <span className="hidden sm:inline">
                  Vol <strong className="text-slate-200 font-medium">{activeCandle.volume.toLocaleString('en-US')}</strong>
                </span>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsFullscreen((v) => !v)}
          aria-label={isFullscreen ? 'Exit fullscreen chart' : 'Expand chart fullscreen'}
          className="shrink-0 px-2 py-1.5 rounded-lg bg-[#161A1E] hover:bg-[#2B3139] border border-[#2B3139] text-slate-200 text-[10px] sm:text-[11px] font-mono flex items-center gap-1 transition-colors"
        >
          {isFullscreen ? (
            <>
              <Minimize2 className="w-3.5 h-3.5 text-[#F0B90B]" aria-hidden="true" />
              <span className="hidden sm:inline">Close</span>
            </>
          ) : (
            <>
              <Maximize2 className="w-3.5 h-3.5 text-sky-400" aria-hidden="true" />
              <span className="hidden sm:inline">Expand</span>
            </>
          )}
        </button>
      </div>

      {/* Unified Docked Pro Chart Frame (Controls + Indicators + OHLCV + Canvas inside one clean frame) */}
      <div
        className={`w-full overflow-hidden rounded-xl bg-[#070A0E] border border-[#1E2329] ${
          isFullscreen ? 'flex-1 min-h-[380px] flex flex-col' : ''
        }`}
      >
        {/* Clean Single-Row Timeframe Bar + Collapsible Chart Tools Icon */}
        <div className="bg-[#0D1117] border-b border-[#1E2329] text-[10px] font-mono">
          <div className="flex items-center justify-between gap-2 px-2 sm:px-2.5 py-1 sm:py-1.5">
            <div className="flex flex-wrap items-center gap-0.5 min-w-0" data-testid="chart-timeframes">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => setTimeframe(tf)}
                  className={`px-1.5 sm:px-2 py-1 rounded transition-colors ${
                    timeframe === tf
                      ? 'bg-[#2B3139] text-[#F0B90B] font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>

            <button
              type="button"
              data-testid="chart-tools-toggle"
              aria-expanded={chartToolsOpen}
              aria-label={chartToolsOpen ? 'Hide chart tools' : 'Show chart tools'}
              title="Chart tools"
              onClick={() => setChartToolsOpen((v) => !v)}
              className={`relative shrink-0 w-7 h-7 rounded-md border flex items-center justify-center transition-colors ${
                chartToolsOpen || drawTool !== 'none' || crosshairLocked || hLines.length > 0
                  ? 'bg-[#2B3139] border-[#F0B90B]/60 text-[#F0B90B]'
                  : 'bg-[#161A1E] border-[#2B3139] text-slate-300 hover:text-white hover:border-slate-500'
              }`}
            >
              {chartToolsOpen ? (
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
              )}
            </button>
          </div>

          {chartToolsOpen && (
            <div
              data-testid="chart-tools-panel"
              className="px-2.5 py-2 border-t border-[#1E2329] bg-[#090D12] flex flex-wrap items-center justify-between gap-2"
            >
              {/* View Style, Zoom & Pan */}
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={cycleChartStyle}
                  aria-label="Switch chart style"
                  className="px-2 py-1 rounded border bg-[#161A1E] border-[#2B3139] text-slate-200 hover:border-slate-500 transition-colors"
                >
                  {chartStyle === 'candles' ? 'Candles' : chartStyle === 'hollow' ? 'Hollow' : 'Line'}
                </button>
                <div className="flex items-center bg-[#12161C] border border-[#2B3139] rounded overflow-hidden">
                  <button
                    type="button"
                    onClick={() => panByBars(Math.max(4, Math.round(windowInfo.clampedVisible * 0.25)))}
                    disabled={windowInfo.startIdx === 0}
                    aria-label="Pan chart earlier"
                    className="px-1.5 py-1 hover:bg-[#2B3139] disabled:opacity-40 text-slate-200"
                  >
                    <ChevronLeft className="w-3 h-3" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => zoomBy(0.75)}
                    disabled={windowInfo.clampedVisible <= MIN_VISIBLE_CANDLES}
                    aria-label="Zoom in chart"
                    className="px-1.5 py-1 hover:bg-[#2B3139] disabled:opacity-40 text-slate-200 flex items-center gap-0.5 border-l border-[#2B3139]"
                  >
                    <ZoomIn className="w-3 h-3 text-emerald-400" aria-hidden="true" />
                    <span>In</span>
                  </button>
                  <span
                    data-testid="chart-zoom-indicator"
                    className="px-1.5 py-1 text-[10px] text-slate-300 bg-[#070A0E] border-x border-[#2B3139] tabular-nums"
                  >
                    {zoomMultiplier}x ({windowInfo.clampedVisible})
                  </span>
                  <button
                    type="button"
                    onClick={() => zoomBy(1.35)}
                    disabled={windowInfo.clampedVisible >= candles.length}
                    aria-label="Zoom out chart"
                    className="px-1.5 py-1 hover:bg-[#2B3139] disabled:opacity-40 text-slate-200 flex items-center gap-0.5 border-r border-[#2B3139]"
                  >
                    <ZoomOut className="w-3 h-3 text-amber-400" aria-hidden="true" />
                    <span>Out</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => panByBars(-Math.max(4, Math.round(windowInfo.clampedVisible * 0.25)))}
                    disabled={isAtLiveEdge}
                    aria-label="Pan chart toward live"
                    className="px-1.5 py-1 hover:bg-[#2B3139] disabled:opacity-40 text-slate-200"
                  >
                    <ChevronRight className="w-3 h-3" aria-hidden="true" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={resetZoomAndPan}
                  aria-label="Reset zoom and jump to live"
                  className="px-2 py-1 rounded bg-[#161A1E] hover:bg-[#2B3139] border border-[#2B3139] text-slate-200 flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" aria-hidden="true" />
                  <span>Fit</span>
                </button>
              </div>

              {/* Drawing, Crosshair, Alert & Depth */}
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => setDrawTool((d) => (d === 'hline' ? 'none' : 'hline'))}
                  aria-label="Toggle horizontal support resistance line tool"
                  className={`px-2 py-1 rounded border flex items-center gap-1 transition-colors ${
                    drawTool === 'hline'
                      ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                      : 'bg-[#161A1E] border-[#2B3139] text-slate-300 hover:text-white'
                  }`}
                >
                  <Minus className="w-3 h-3" aria-hidden="true" />
                  <span>H-Line{hLines.length > 0 ? ` (${hLines.length})` : ''}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDrawTool((d) => (d === 'measure' ? 'none' : 'measure'));
                    setMeasureStart(null);
                    setMeasureEnd(null);
                  }}
                  aria-label="Toggle price range ruler measurement tool"
                  className={`px-2 py-1 rounded border flex items-center gap-1 transition-colors ${
                    drawTool === 'measure'
                      ? 'bg-sky-500/20 border-sky-400 text-sky-300'
                      : 'bg-[#161A1E] border-[#2B3139] text-slate-300 hover:text-white'
                  }`}
                >
                  <Ruler className="w-3 h-3" aria-hidden="true" />
                  <span>Measure</span>
                </button>
                {(hLines.length > 0 || measureStart) && (
                  <button
                    type="button"
                    onClick={() => {
                      setHLines([]);
                      setMeasureStart(null);
                      setMeasureEnd(null);
                    }}
                    aria-label="Clear chart drawings"
                    className="px-2 py-1 rounded bg-red-500/15 border border-red-500/40 text-red-300 hover:bg-red-500/25 flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" aria-hidden="true" />
                    <span>Clear</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setCrosshairLocked((v) => !v)}
                  aria-label="Toggle crosshair lock"
                  className={`px-2 py-1 rounded border flex items-center gap-1 transition-colors ${
                    crosshairLocked
                      ? 'bg-amber-500/20 border-amber-400/60 text-amber-300'
                      : 'bg-[#161A1E] border-[#2B3139] text-slate-300 hover:text-white'
                  }`}
                >
                  <Crosshair className="w-3 h-3" aria-hidden="true" />
                  <span>Lock</span>
                </button>
                {onQuickAlert && (
                  <button
                    type="button"
                    onClick={() => onQuickAlert(activeCandle ? activeCandle.close : quote.price)}
                    aria-label="Set quick price alert at inspected level"
                    className="px-2 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 flex items-center gap-1"
                  >
                    <BellPlus className="w-3 h-3" aria-hidden="true" />
                    <span>Alert</span>
                  </button>
                )}
                {!isFullscreen && (
                  <button
                    type="button"
                    onClick={() => setShowOrderBook((v) => !v)}
                    aria-label="Toggle order book depth visibility"
                    className={`px-2 py-1 rounded border flex items-center gap-1 transition-colors ${
                      showOrderBook
                        ? 'bg-[#161A1E] border-emerald-500/50 text-emerald-300'
                        : 'bg-[#161A1E] border-[#2B3139] text-slate-400 hover:text-white'
                    }`}
                  >
                    <Layers className="w-3 h-3" aria-hidden="true" />
                    <span>Depth</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Compact Binance OHLC & Main-Chart Overlay Readout (Sub-pane metrics live inside their bottom panes) */}
        {activeCandle && (
          <div className="px-2.5 py-1 border-b border-[#14181F] bg-[#080C11] text-[10px] font-mono tabular-nums space-y-0.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-slate-400">
              <span className="text-slate-300 font-semibold">{formatChartTimestamp(activeCandle.time, timeframe)}</span>
              <span>
                O:<strong className={changeCandlePct >= 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]'}>{formatChartPrice(activeCandle.open)}</strong>
              </span>
              <span>
                H:<strong className={changeCandlePct >= 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]'}>{formatChartPrice(activeCandle.high)}</strong>
              </span>
              <span>
                L:<strong className={changeCandlePct >= 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]'}>{formatChartPrice(activeCandle.low)}</strong>
              </span>
              <span>
                C:<strong className={changeCandlePct >= 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]'}>{formatChartPrice(activeCandle.close)}</strong>
              </span>
              <span className={changeCandlePct >= 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]'}>
                {changeCandlePct >= 0 ? '+' : ''}
                {changeCandlePct.toFixed(2)}%
              </span>
              <span className="text-slate-500">Amp {amplitudePct.toFixed(2)}%</span>
            </div>

            {(showMa || showEma || showBoll || showVwap) && (
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px]">
                {showMa && (
                  <>
                    <span className="text-[#F0B90B]">MA(7): {activeMa7 !== null ? formatChartPrice(activeMa7) : '--'}</span>
                    <span className="text-[#A855F7]">MA(25): {activeMa25 !== null ? formatChartPrice(activeMa25) : '--'}</span>
                    <span className="text-[#38BDF8]">MA({maLongPeriod}): {activeMa50 !== null ? formatChartPrice(activeMa50) : '--'}</span>
                  </>
                )}
                {showEma && (
                  <>
                    <span className="text-teal-300">EMA(12): {activeEma12 !== null ? formatChartPrice(activeEma12) : '--'}</span>
                    <span className="text-orange-300">EMA(26): {activeEma26 !== null ? formatChartPrice(activeEma26) : '--'}</span>
                  </>
                )}
                {showBoll && activeBoll?.middle !== null && (
                  <span className="text-indigo-300">
                    BOLL(20,2) UP:{formatChartPrice(activeBoll.upper!)} MB:{formatChartPrice(activeBoll.middle!)} DN:{formatChartPrice(activeBoll.lower!)}
                  </span>
                )}
                {showVwap && (
                  <span className="text-pink-300">VWAP: {activeVwap !== null ? formatChartPrice(activeVwap) : '--'}</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Main Split Body: Candlestick Chart + Binance Bottom Indicator Bar Left | Vertical Order Book Right */}
        <div
          className={
            bookDockedRight
              ? `grid grid-cols-[minmax(0,1fr)_134px] sm:grid-cols-[minmax(0,1fr)_205px] lg:grid-cols-[minmax(0,1fr)_224px] items-stretch ${splitHeightClass}`
              : 'w-full'
          }
        >
          <div className="min-w-0 h-full flex flex-col">
            <div className="relative flex-1 min-h-0">
              {/* Non-shifting Floating Measure / H-Line HUD */}
              {drawTool !== 'none' && (
                <div className="absolute top-1 left-1.5 right-1.5 z-10 px-2 py-0.5 rounded bg-[#0D1117]/95 border border-[#2B3139] text-[9.5px] font-mono text-amber-300 flex items-center justify-between gap-2 backdrop-blur-xs">
                  <span className="truncate">
                    {drawTool === 'hline'
                      ? 'H-Line: Tap chart to add level'
                      : measureStart && measureEnd && measurement
                      ? `${measurement.isUp ? '+' : ''}${measurement.pctChange.toFixed(2)}% (${measurement.isUp ? '+' : '-'}$${formatChartPrice(Math.abs(measurement.priceDelta))}) · ${measurement.barsCount}b`
                      : measureStart
                      ? 'Measure: Tap 2nd candle'
                      : 'Measure: Tap start candle'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDrawTool('none')}
                    className="text-slate-200 hover:text-white underline shrink-0"
                  >
                    Done
                  </button>
                </div>
              )}

              {/* Main SVG Candlestick & Indicator Canvas */}
              <svg
                ref={svgRef}
                viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                className={`w-full select-none touch-none cursor-crosshair ${
                  isFullscreen ? 'h-full min-h-[380px]' : bookDockedRight ? 'h-full' : 'h-[230px] sm:h-[375px]'
                }`}
                role="img"
                aria-label={`${quote.label} ${timeframe} candlestick chart`}
              onWheel={handleWheelZoom}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={() => {
                dragRef.current.active = false;
                if (!crosshairLocked) setHoveredLocalIdx(null);
              }}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
          <defs>
            <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={liveTagColor} stopOpacity="0.28" />
              <stop offset="100%" stopColor={liveTagColor} stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Vertical Time Grid Lines */}
          {(isCompactViewport ? [0.16, 0.5, 0.84] : [0.14, 0.34, 0.54, 0.74, 0.92]).map((rx) => {
            const x = plotLeft + rx * plotWidth;
            const cIdx = Math.min(
              visibleCandles.length - 1,
              Math.max(0, Math.floor(rx * visibleCandles.length))
            );
            const ts = visibleCandles[cIdx]?.time;
            return (
              <g key={rx}>
                <line x1={x} x2={x} y1={priceTop} y2={contentBottom} stroke="#161B22" strokeWidth={1} />
                {ts && (
                  <text
                    x={x}
                    y={svgHeight - 6}
                    textAnchor="middle"
                    fill="#94A3B8"
                    fontSize={isCompactViewport ? '10' : '10.5'}
                    fontFamily="monospace"
                  >
                    {formatChartTimestamp(ts, timeframe)}
                  </text>
                )}
              </g>
            );
          })}

          {/* Horizontal Price Grid Lines & Right Y-Axis */}
          {[0.12, 0.34, 0.56, 0.78].map((ry) => {
            const y = priceTop + ry * priceHeight;
            const priceVal = maxPrice - ry * priceRange;
            const overlapsLiveTag = y > liveY - 18 && y < liveY + 34;
            const overlapsHoverTag =
              hoveredLocalIdx !== null && activeCandle && Math.abs(y - toY(activeCandle.close)) < 18;
            return (
              <g key={ry}>
                <line
                  x1={plotLeft}
                  x2={plotRight}
                  y1={y}
                  y2={y}
                  stroke="#161B22"
                  strokeDasharray="3 3"
                />
                {!overlapsLiveTag && !overlapsHoverTag && (
                  <text
                    x={plotRight + 5}
                    y={y + 3.5}
                    fill="#94A3B8"
                    fontSize={isCompactViewport ? '10' : '10.5'}
                    fontFamily="monospace"
                  >
                    {formatChartPrice(priceVal)}
                  </text>
                )}
              </g>
            );
          })}

          {/* Pane Dividers */}
          <line x1={plotRight} x2={plotRight} y1={0} y2={contentBottom} stroke="#1E2329" strokeWidth={1} />
          <line x1={0} x2={svgWidth} y1={contentBottom} y2={contentBottom} stroke="#1E2329" strokeWidth={1} />

          {showVol && (
            <>
              <line x1={0} x2={svgWidth} y1={priceBottom + 3} y2={priceBottom + 3} stroke="#1E2329" strokeWidth={1} />
              <text x={plotLeft + 4} y={volTop + 10} fill="#94A3B8" fontSize="9.5" fontFamily="monospace">
                Vol({quote.symbol.replace('USDT', '')}): {activeCandle ? activeCandle.volume.toFixed(2) : '--'}
              </text>
              {!isCompactViewport && activeVolMa5 !== null && (
                <text x={plotLeft + 145} y={volTop + 10} fill="#F0B90B" fontSize="9.5" fontFamily="monospace">
                  MA(5): {activeVolMa5.toFixed(1)}
                </text>
              )}
              {!isCompactViewport && activeVolMa10 !== null && (
                <text x={plotLeft + 235} y={volTop + 10} fill="#A855F7" fontSize="9.5" fontFamily="monospace">
                  MA(10): {activeVolMa10.toFixed(1)}
                </text>
              )}
            </>
          )}

          {showRsi && (
            <>
              <line x1={0} x2={svgWidth} y1={rsiTop - 3} y2={rsiTop - 3} stroke="#1E2329" strokeWidth={1} />
              <line
                x1={plotLeft}
                x2={plotRight}
                y1={rsiTop + rsiHeight * 0.3}
                y2={rsiTop + rsiHeight * 0.3}
                stroke="#334155"
                strokeDasharray="2 3"
              />
              <line
                x1={plotLeft}
                x2={plotRight}
                y1={rsiTop + rsiHeight * 0.7}
                y2={rsiTop + rsiHeight * 0.7}
                stroke="#334155"
                strokeDasharray="2 3"
              />
              <text x={plotLeft + 4} y={rsiTop + 10} fill="#C084FC" fontSize="9.5" fontFamily="monospace">
                RSI({rsiPeriod}): {activeRsi !== null ? activeRsi.toFixed(1) : '--'}
              </text>
              <text x={plotRight + 6} y={rsiTop + rsiHeight * 0.3 + 3} fill="#64748B" fontSize="9.5" fontFamily="monospace">
                70
              </text>
              <text x={plotRight + 6} y={rsiTop + rsiHeight * 0.7 + 3} fill="#64748B" fontSize="9.5" fontFamily="monospace">
                30
              </text>
            </>
          )}

          {showMacd && (
            <>
              <line x1={0} x2={svgWidth} y1={macdTop - 3} y2={macdTop - 3} stroke="#1E2329" strokeWidth={1} />
              <line
                x1={plotLeft}
                x2={plotRight}
                y1={macdTop + macdHeight / 2}
                y2={macdTop + macdHeight / 2}
                stroke="#334155"
                strokeDasharray="2 3"
              />
              <text x={plotLeft + 4} y={macdTop + 10} fill="#22D3EE" fontSize="9.5" fontFamily="monospace">
                MACD(12,26,9)
              </text>
              {!isCompactViewport && activeMacd?.dif !== null && (
                <text x={plotLeft + 92} y={macdTop + 10} fill="#22D3EE" fontSize="9.5" fontFamily="monospace">
                  DIF:{activeMacd.dif!.toFixed(2)}
                </text>
              )}
              {!isCompactViewport && activeMacd?.dea !== null && (
                <text x={plotLeft + 172} y={macdTop + 10} fill="#F59E0B" fontSize="9.5" fontFamily="monospace">
                  DEA:{activeMacd.dea!.toFixed(2)}
                </text>
              )}
            </>
          )}

          {showKdj && (
            <>
              <line x1={0} x2={svgWidth} y1={kdjTop - 3} y2={kdjTop - 3} stroke="#1E2329" strokeWidth={1} />
              <line
                x1={plotLeft}
                x2={plotRight}
                y1={kdjTop + kdjHeight * 0.25}
                y2={kdjTop + kdjHeight * 0.25}
                stroke="#334155"
                strokeDasharray="2 3"
              />
              <line
                x1={plotLeft}
                x2={plotRight}
                y1={kdjTop + kdjHeight * 0.75}
                y2={kdjTop + kdjHeight * 0.75}
                stroke="#334155"
                strokeDasharray="2 3"
              />
              <text x={plotLeft + 4} y={kdjTop + 10} fill="#F0B90B" fontSize="9.5" fontFamily="monospace">
                KDJ(9,3,3){activeKdj?.k !== null && activeKdj?.k !== undefined ? ` K:${activeKdj.k.toFixed(1)}` : ''}
              </text>
              {!isCompactViewport && activeKdj?.d !== null && activeKdj?.d !== undefined && (
                <text x={plotLeft + 122} y={kdjTop + 10} fill="#38BDF8" fontSize="9.5" fontFamily="monospace">
                  D:{activeKdj.d.toFixed(1)}
                </text>
              )}
              {!isCompactViewport && activeKdj?.j !== null && activeKdj?.j !== undefined && (
                <text x={plotLeft + 174} y={kdjTop + 10} fill="#E879F9" fontSize="9.5" fontFamily="monospace">
                  J:{activeKdj.j.toFixed(1)}
                </text>
              )}
              <text x={plotRight + 6} y={kdjTop + kdjHeight * 0.25 + 3} fill="#64748B" fontSize="9" fontFamily="monospace">
                80
              </text>
              <text x={plotRight + 6} y={kdjTop + kdjHeight * 0.75 + 3} fill="#64748B" fontSize="9" fontFamily="monospace">
                20
              </text>
            </>
          )}

          {/* Bollinger Bands Overlay */}
          {showBoll && (
            <g>
              {buildBollBandFill() && <path d={buildBollBandFill()} fill="#6366F1" fillOpacity={0.09} />}
              <path
                d={buildLinePath(boll.map((b) => b.upper))}
                fill="none"
                stroke="#818CF8"
                strokeWidth={1}
                strokeDasharray="3 2"
              />
              <path d={buildLinePath(boll.map((b) => b.middle))} fill="none" stroke="#6366F1" strokeWidth={1} />
              <path
                d={buildLinePath(boll.map((b) => b.lower))}
                fill="none"
                stroke="#818CF8"
                strokeWidth={1}
                strokeDasharray="3 2"
              />
            </g>
          )}

          {/* Moving Average Overlays */}
          {showMa && (
            <g fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d={buildLinePath(ma50)} stroke="#38BDF8" strokeWidth={1.15} opacity={0.85} />
              <path d={buildLinePath(ma25)} stroke="#A855F7" strokeWidth={1.2} opacity={0.9} />
              <path d={buildLinePath(ma7)} stroke="#F0B90B" strokeWidth={1.3} opacity={0.95} />
            </g>
          )}

          {/* EMA Overlays */}
          {showEma && (
            <g fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d={buildLinePath(ema12)} stroke="#5EEAD4" strokeWidth={1.2} />
              <path d={buildLinePath(ema26)} stroke="#FDBA74" strokeWidth={1.2} />
            </g>
          )}

          {/* VWAP Overlay */}
          {showVwap && (
            <path d={buildLinePath(vwap)} fill="none" stroke="#F472B6" strokeWidth={1.3} strokeDasharray="4 2" />
          )}

          {/* User-Placed Horizontal Support / Resistance Lines */}
          {hLines.map((line) => {
            if (line.price < minPrice || line.price > maxPrice) return null;
            const y = toY(line.price);
            return (
              <g key={line.id}>
                <line
                  x1={plotLeft}
                  x2={plotRight}
                  y1={y}
                  y2={y}
                  stroke="#FBBF24"
                  strokeDasharray="5 3"
                  strokeWidth={1.15}
                />
                <rect x={plotRight + 2} y={y - 8} width={rightAxisWidth - 4} height={16} rx={2} fill="#92400E" />
                <text
                  x={plotRight + 6}
                  y={y + 3}
                  fill="#FEF3C7"
                  fontSize="9.5"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  {formatChartPrice(line.price)}
                </text>
              </g>
            );
          })}

          {/* Volume Histogram Bars + Binance Volume MA(5) & MA(10) */}
          {showVol && (
            <g>
              {visibleCandles.map((c, idx) => {
                const xCenter = candleX(idx);
                const barWidth = Math.max(2.5, slotWidth * 0.62);
                const isBull = c.close >= c.open;
                const isHover = hoveredLocalIdx === idx;
                const h = Math.max(2, (c.volume / maxVol) * (volHeight - 17));
                return (
                  <rect
                    key={`vol-${c.time}-${idx}`}
                    x={xCenter - barWidth / 2}
                    y={volBottom - h}
                    width={barWidth}
                    height={h}
                    fill={isBull ? '#0ECB81' : '#F6465D'}
                    fillOpacity={isHover ? 0.92 : 0.42}
                    rx={0.5}
                  />
                );
              })}
              <path
                d={buildLinePath(volMa5, (v) => volBottom - Math.max(1, (v / maxVol) * (volHeight - 17)))}
                fill="none"
                stroke="#F0B90B"
                strokeWidth={1}
                opacity={0.9}
              />
              <path
                d={buildLinePath(volMa10, (v) => volBottom - Math.max(1, (v / maxVol) * (volHeight - 17)))}
                fill="none"
                stroke="#A855F7"
                strokeWidth={1}
                opacity={0.85}
              />
            </g>
          )}

          {/* RSI Line */}
          {showRsi && (
            <path
              d={buildLinePath(rsi14, (v) => rsiBottom - (Math.max(0, Math.min(100, v)) / 100) * (rsiHeight - 16) - 3)}
              fill="none"
              stroke="#C084FC"
              strokeWidth={1.4}
            />
          )}

          {/* MACD Sub-pane (Histogram + DIF + DEA) */}
          {showMacd && (
            <g>
              {macd.map((m, idx) => {
                if (m.histogram === null) return null;
                const xCenter = candleX(idx);
                const barW = Math.max(2, slotWidth * 0.56);
                const midY = macdTop + 6 + (macdHeight - 12) / 2;
                const h = Math.max(1.5, (Math.abs(m.histogram) / macdAbsMax) * ((macdHeight - 16) / 2));
                const y = m.histogram >= 0 ? midY - h : midY;
                return (
                  <rect
                    key={`macd-${idx}`}
                    x={xCenter - barW / 2}
                    y={y}
                    width={barW}
                    height={h}
                    fill={m.histogram >= 0 ? '#0ECB81' : '#F6465D'}
                    fillOpacity={0.65}
                  />
                );
              })}
              <path
                d={buildLinePath(
                  macd.map((m) => m.dif),
                  (v) => macdTop + 6 + (macdHeight - 12) / 2 - (v / macdAbsMax) * ((macdHeight - 16) / 2)
                )}
                fill="none"
                stroke="#22D3EE"
                strokeWidth={1.15}
              />
              <path
                d={buildLinePath(
                  macd.map((m) => m.dea),
                  (v) => macdTop + 6 + (macdHeight - 12) / 2 - (v / macdAbsMax) * ((macdHeight - 16) / 2)
                )}
                fill="none"
                stroke="#F59E0B"
                strokeWidth={1.15}
              />
            </g>
          )}

          {/* KDJ Sub-pane (K, D, J) */}
          {showKdj && (
            <g>
              <path
                d={buildLinePath(
                  kdj.map((pt) => pt.k),
                  (v) => kdjBottom - ((Math.max(-10, Math.min(110, v)) + 10) / 120) * (kdjHeight - 16) - 2
                )}
                fill="none"
                stroke="#F0B90B"
                strokeWidth={1.15}
              />
              <path
                d={buildLinePath(
                  kdj.map((pt) => pt.d),
                  (v) => kdjBottom - ((Math.max(-10, Math.min(110, v)) + 10) / 120) * (kdjHeight - 16) - 2
                )}
                fill="none"
                stroke="#38BDF8"
                strokeWidth={1.15}
              />
              <path
                d={buildLinePath(
                  kdj.map((pt) => pt.j),
                  (v) => kdjBottom - ((Math.max(-10, Math.min(110, v)) + 10) / 120) * (kdjHeight - 16) - 2
                )}
                fill="none"
                stroke="#E879F9"
                strokeWidth={1.15}
              />
            </g>
          )}

          {/* Candlesticks (Solid / Hollow) or Area Line */}
          {chartStyle === 'area' ? (
            <g>
              {areaFillPath && <path d={areaFillPath} fill="url(#areaGrad)" />}
              {areaLinePath && <path d={areaLinePath} fill="none" stroke={liveTagColor} strokeWidth={1.8} />}
            </g>
          ) : (
            visibleCandles.map((c, idx) => {
              const xCenter = candleX(idx);
              const bodyWidth = Math.max(3.5, Math.min(22, slotWidth * 0.64));
              const isBull = c.close >= c.open;
              const color = isBull ? '#0ECB81' : '#F6465D';
              const yHigh = toY(c.high);
              const yLow = toY(c.low);
              const yOpen = toY(c.open);
              const yClose = toY(c.close);
              const bodyTop = Math.min(yOpen, yClose);
              const bodyHeight = Math.max(2, Math.abs(yClose - yOpen));
              const isHover = hoveredLocalIdx === idx;
              const isHollowBull = chartStyle === 'hollow' && isBull;

              return (
                <g key={`c-${c.time}-${idx}`}>
                  <line
                    x1={xCenter}
                    x2={xCenter}
                    y1={yHigh}
                    y2={yLow}
                    stroke={color}
                    strokeWidth={isHover ? 1.8 : 1.25}
                  />
                  <rect
                    x={xCenter - bodyWidth / 2}
                    y={bodyTop}
                    width={bodyWidth}
                    height={bodyHeight}
                    fill={isHollowBull ? '#070A0E' : color}
                    stroke={isHover ? '#FFFFFF' : isHollowBull ? color : 'none'}
                    strokeWidth={isHover ? 0.9 : isHollowBull ? 1.2 : 0}
                    rx={0.8}
                  />
                </g>
              );
            })
          )}

          {/* Interactive Price Range Ruler Overlay */}
          {measureStart && effectiveMeasureEnd && measurement && (
            (() => {
              const l1 = measureStart.globalIdx - windowInfo.startIdx;
              const l2 = effectiveMeasureEnd.globalIdx - windowInfo.startIdx;
              const x1 = candleX(Math.max(0, Math.min(visibleCandles.length - 1, l1)));
              const x2 = candleX(Math.max(0, Math.min(visibleCandles.length - 1, l2)));
              const y1 = toY(measureStart.price);
              const y2 = toY(effectiveMeasureEnd.price);
              const rx = Math.min(x1, x2);
              const ry = Math.min(y1, y2);
              const rw = Math.max(4, Math.abs(x2 - x1));
              const rh = Math.max(4, Math.abs(y2 - y1));
              const fill = measurement.isUp ? '#0ECB81' : '#F6465D';
              const labelText = `${measurement.isUp ? '+' : ''}${measurement.pctChange.toFixed(2)}% · ${measurement.barsCount}b`;
              const labelX = Math.min(plotRight - 115, Math.max(plotLeft + 6, rx + rw / 2 - 54));
              const labelY = Math.max(priceTop + 4, ry - 20);
              return (
                <g pointerEvents="none">
                  <rect x={rx} y={ry} width={rw} height={rh} fill={fill} fillOpacity={0.14} stroke={fill} strokeWidth={1} strokeDasharray="3 2" />
                  <rect x={labelX} y={labelY} width={110} height={17} rx={3} fill={fill} />
                  <text
                    x={labelX + 55}
                    y={labelY + 11.5}
                    textAnchor="middle"
                    fill="#070A0E"
                    fontSize="9.5"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    {labelText}
                  </text>
                </g>
              );
            })()
          )}

          {/* Visible Window High / Low Callout Labels */}
          {visibleCandles[highIdx] && (
            <text
              x={Math.min(plotRight - 65, Math.max(plotLeft + 8, candleX(highIdx)))}
              y={Math.max(priceTop + 10, toY(visibleCandles[highIdx].high) - 4)}
              fill="#CBD5E1"
              fontSize="10"
              fontFamily="monospace"
            >
              ↓ {formatChartPrice(visibleCandles[highIdx].high)}
            </text>
          )}
          {visibleCandles[lowIdx] && (
            <text
              x={Math.min(plotRight - 65, Math.max(plotLeft + 8, candleX(lowIdx)))}
              y={Math.min(priceBottom - 4, toY(visibleCandles[lowIdx].low) + 11)}
              fill="#CBD5E1"
              fontSize="10"
              fontFamily="monospace"
            >
              ↑ {formatChartPrice(visibleCandles[lowIdx].low)}
            </text>
          )}

          {/* Interactive Crosshair */}
          {hoveredLocalIdx !== null && activeCandle && (
            <g pointerEvents="none">
              <line
                x1={candleX(hoveredLocalIdx)}
                x2={candleX(hoveredLocalIdx)}
                y1={priceTop}
                y2={contentBottom}
                stroke="#64748B"
                strokeDasharray="3 3"
                strokeWidth={1}
              />
              <line
                x1={plotLeft}
                x2={plotRight}
                y1={toY(activeCandle.close)}
                y2={toY(activeCandle.close)}
                stroke="#64748B"
                strokeDasharray="3 3"
                strokeWidth={1}
              />
              <rect
                x={plotRight + 2}
                y={toY(activeCandle.close) - 9}
                width={rightAxisWidth - 4}
                height={18}
                rx={2.5}
                fill="#334155"
              />
              <text
                x={plotRight + 6}
                y={toY(activeCandle.close) + 3.5}
                fill="#F8FAFC"
                fontSize="10.5"
                fontFamily="monospace"
                fontWeight="bold"
              >
                {formatChartPrice(activeCandle.close)}
              </text>
              <rect
                x={Math.max(plotLeft, Math.min(plotRight - 78, candleX(hoveredLocalIdx) - 39))}
                y={contentBottom + 3}
                width={78}
                height={18}
                rx={2.5}
                fill="#334155"
              />
              <text
                x={Math.max(plotLeft + 39, Math.min(plotRight - 39, candleX(hoveredLocalIdx)))}
                y={contentBottom + 15}
                textAnchor="middle"
                fill="#F8FAFC"
                fontSize="10"
                fontFamily="monospace"
              >
                {formatChartTimestamp(activeCandle.time, timeframe)}
              </text>
            </g>
          )}

          {/* Live Last Price Line + Right-Axis Pill + Candle Cut-off Countdown */}
          <line
            x1={plotLeft}
            x2={plotRight}
            y1={liveY}
            y2={liveY}
            stroke={liveTagColor}
            strokeDasharray="3 2"
            strokeWidth={1.1}
          />
          <rect
            x={plotRight + 2}
            y={liveY - 9}
            width={rightAxisWidth - 4}
            height={17}
            rx={2.5}
            fill={liveTagColor}
          />
          <text
            x={plotRight + 6}
            y={liveY + 3}
            fill="#070A0E"
            fontSize="10.5"
            fontFamily="monospace"
            fontWeight="bold"
          >
            {formatChartPrice(quote.price)}
          </text>
          {/* Cut-off countdown badge attached cleanly below live price tag */}
          <rect
            x={plotRight + 2}
            y={liveY + 9}
            width={rightAxisWidth - 4}
            height={15}
            rx={2}
            fill="#161A1E"
            stroke={liveTagColor}
            strokeWidth={0.7}
          />
          <text
            x={plotRight + 6}
            y={liveY + 19.5}
            fill="#FCD34D"
            fontSize="9.5"
            fontFamily="monospace"
            fontWeight="bold"
          >
            {cutOffInfo.countdownLabel}
          </text>
              </svg>
            </div>

            {/* Real Binance Bottom Indicator Bar (Overlays | Sub-Panes + Indicator Settings) */}
            <div
              ref={indicatorSettingsRef}
              data-testid="chart-indicator-bar"
              className="relative shrink-0 h-8 px-1.5 sm:px-2 bg-[#0A0E13] border-t border-[#1E2329] flex items-center justify-between gap-1 text-[9.5px] sm:text-[10px] font-mono"
            >
              <div className="flex flex-nowrap items-center gap-0.5 sm:gap-1 min-w-0 overflow-x-auto no-scrollbar">
                <button
                  type="button"
                  onClick={() => setShowMa((v) => !v)}
                  className={`px-1 sm:px-1.5 py-0.5 rounded transition-colors whitespace-nowrap shrink-0 ${
                    showMa ? 'bg-[#1E2329] text-[#F0B90B] font-bold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  MA
                </button>
                <button
                  type="button"
                  onClick={() => setShowEma((v) => !v)}
                  className={`px-1 sm:px-1.5 py-0.5 rounded transition-colors whitespace-nowrap shrink-0 ${
                    showEma ? 'bg-[#1E2329] text-teal-300 font-bold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  EMA
                </button>
                <button
                  type="button"
                  onClick={() => setShowBoll((v) => !v)}
                  className={`px-1 sm:px-1.5 py-0.5 rounded transition-colors whitespace-nowrap shrink-0 ${
                    showBoll ? 'bg-[#1E2329] text-indigo-300 font-bold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  BOLL
                </button>
                <button
                  type="button"
                  onClick={() => setShowVwap((v) => !v)}
                  className={`px-1 sm:px-1.5 py-0.5 rounded transition-colors whitespace-nowrap shrink-0 ${
                    showVwap ? 'bg-[#1E2329] text-pink-300 font-bold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  VWAP
                </button>

                <span className="hidden sm:inline-block h-3 w-px bg-[#1E2329] mx-0.5 shrink-0" aria-hidden="true" />

                <button
                  type="button"
                  onClick={() => setShowVol((v) => !v)}
                  className={`px-1 sm:px-1.5 py-0.5 rounded transition-colors whitespace-nowrap shrink-0 ${
                    showVol ? 'bg-[#1E2329] text-sky-400 font-bold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  VOL
                </button>
                <button
                  type="button"
                  onClick={() => setShowRsi((v) => !v)}
                  className={`px-1 sm:px-1.5 py-0.5 rounded transition-colors whitespace-nowrap shrink-0 ${
                    showRsi ? 'bg-[#1E2329] text-purple-300 font-bold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  RSI
                </button>
                <button
                  type="button"
                  onClick={() => setShowMacd((v) => !v)}
                  className={`px-1 sm:px-1.5 py-0.5 rounded transition-colors whitespace-nowrap shrink-0 ${
                    showMacd ? 'bg-[#1E2329] text-cyan-300 font-bold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  MACD
                </button>
                <button
                  type="button"
                  onClick={() => setShowKdj((v) => !v)}
                  className={`px-1 sm:px-1.5 py-0.5 rounded transition-colors whitespace-nowrap shrink-0 ${
                    showKdj ? 'bg-[#1E2329] text-amber-300 font-bold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  KDJ
                </button>
              </div>

              <button
                type="button"
                aria-label="Indicator settings"
                onClick={() => setIndicatorSettingsOpen((v) => !v)}
                className={`p-1 rounded border transition-colors shrink-0 ${
                  indicatorSettingsOpen
                    ? 'bg-[#1E2329] border-[#F0B90B]/60 text-[#F0B90B]'
                    : 'bg-[#070A0E] border-[#1E2329] text-slate-400 hover:text-white'
                }`}
                title="Indicator Parameters"
              >
                <SlidersHorizontal className="w-3 h-3" aria-hidden="true" />
              </button>

              {indicatorSettingsOpen && (
                <div
                  role="dialog"
                  aria-label="Chart indicator settings"
                  className="absolute right-1.5 bottom-full mb-1.5 w-56 z-30 bg-[#12161C] border border-[#2B3139] rounded-xl shadow-2xl p-2.5 space-y-2.5 text-[10px]"
                >
                  <div className="flex items-center justify-between border-b border-[#1E2329] pb-1.5">
                    <span className="font-bold text-slate-200">Binance Indicators</span>
                    <button
                      type="button"
                      onClick={() => {
                        setShowMa(true);
                        setShowEma(false);
                        setShowBoll(false);
                        setShowVwap(false);
                        setShowVol(true);
                        setShowRsi(false);
                        setShowMacd(false);
                        setShowKdj(false);
                        setMaLongPeriod(50);
                        setRsiPeriod(14);
                      }}
                      className="text-[#F0B90B] hover:underline"
                    >
                      Reset
                    </button>
                  </div>

                  <div className="space-y-1">
                    <span className="text-slate-400 block">MA Long Line</span>
                    <div className="grid grid-cols-2 gap-1">
                      {([50, 99] as const).map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setMaLongPeriod(p)}
                          className={`py-1 rounded border transition-colors ${
                            maLongPeriod === p
                              ? 'bg-[#1E2329] border-[#F0B90B]/60 text-[#F0B90B] font-bold'
                              : 'bg-[#0B0E11] border-[#1E2329] text-slate-400'
                          }`}
                        >
                          MA({p})
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-slate-400 block">RSI Period</span>
                    <div className="grid grid-cols-3 gap-1">
                      {([6, 14, 24] as const).map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setRsiPeriod(p)}
                          className={`py-1 rounded border transition-colors ${
                            rsiPeriod === p
                              ? 'bg-[#1E2329] border-purple-400/60 text-purple-300 font-bold'
                              : 'bg-[#0B0E11] border-[#1E2329] text-slate-400'
                          }`}
                        >
                          RSI({p})
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Docked Right-Side Binance Vertical Order Book & Recent Trades (Up/Down Layout) */}
          {bookDockedRight && (
            <aside
              data-testid="binance-order-book"
              aria-label="Order Book and Recent Trades"
              className="h-full overflow-hidden border-l border-[#1E2329] bg-[#0A0E13] flex flex-col justify-between p-1 sm:p-2 text-[9px] sm:text-[10.5px] font-mono tabular-nums select-none"
            >
              {/* Top Tabs: Order Book | Trades */}
              <div className="space-y-1 sm:space-y-1.5">
                <div className="grid grid-cols-2 gap-1 bg-[#070A0E] p-0.5 rounded-md border border-[#1E2329]">
                  <button
                    type="button"
                    onClick={() => setBookTab('book')}
                    className={`py-1 rounded text-[9.5px] sm:text-[10px] font-bold transition-colors ${
                      bookTab === 'book' ? 'bg-[#1E2329] text-[#F0B90B]' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Book
                  </button>
                  <button
                    type="button"
                    onClick={() => setBookTab('trades')}
                    className={`py-1 rounded text-[9.5px] sm:text-[10px] font-bold transition-colors ${
                      bookTab === 'trades' ? 'bg-[#1E2329] text-[#F0B90B]' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Trades
                  </button>
                </div>

                {bookTab === 'book' && (
                  <div className="flex items-center justify-between gap-1">
                    {/* Binance View Mode Icons: Both / Asks / Bids */}
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        aria-label="Show both asks and bids"
                        onClick={() => setBookMode('both')}
                        title="Asks & Bids"
                        className={`p-1 rounded border transition-colors ${
                          bookMode === 'both'
                            ? 'bg-[#1E2329] border-[#F0B90B]/60'
                            : 'bg-[#070A0E] border-[#1E2329] opacity-65 hover:opacity-100'
                        }`}
                      >
                        <span className="flex flex-col gap-[1.5px] w-2.5">
                          <span className="h-[2px] w-full bg-[#F6465D] rounded-xs" />
                          <span className="h-[2px] w-full bg-[#0ECB81] rounded-xs" />
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label="Show bids only"
                        onClick={() => setBookMode('bids')}
                        title="Bids Only"
                        className={`p-1 rounded border transition-colors ${
                          bookMode === 'bids'
                            ? 'bg-[#1E2329] border-[#0ECB81]/60'
                            : 'bg-[#070A0E] border-[#1E2329] opacity-65 hover:opacity-100'
                        }`}
                      >
                        <span className="flex flex-col gap-[1.5px] w-2.5">
                          <span className="h-[2px] w-full bg-[#0ECB81] rounded-xs" />
                          <span className="h-[2px] w-full bg-[#0ECB81] rounded-xs" />
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label="Show asks only"
                        onClick={() => setBookMode('asks')}
                        title="Asks Only"
                        className={`p-1 rounded border transition-colors ${
                          bookMode === 'asks'
                            ? 'bg-[#1E2329] border-[#F6465D]/60'
                            : 'bg-[#070A0E] border-[#1E2329] opacity-65 hover:opacity-100'
                        }`}
                      >
                        <span className="flex flex-col gap-[1.5px] w-2.5">
                          <span className="h-[2px] w-full bg-[#F6465D] rounded-xs" />
                          <span className="h-[2px] w-full bg-[#F6465D] rounded-xs" />
                        </span>
                      </button>
                    </div>

                    {/* Tick Precision Grouping Dropdown */}
                    <select
                      aria-label="Order book tick grouping"
                      value={tickSize}
                      onChange={(e) => setTickSize(Number(e.target.value))}
                      className="bg-[#070A0E] border border-[#1E2329] rounded px-1 py-0.5 text-[9px] sm:text-[10px] text-slate-300 outline-none focus:border-[#F0B90B]"
                    >
                      {tickOptions.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Column Labels */}
                <div className="flex justify-between text-[9px] text-slate-500 px-0.5">
                  <span>{bookTab === 'book' ? 'Price(USDT)' : 'Price'}</span>
                  <span>{bookTab === 'book' ? 'Amount' : 'Size / Time'}</span>
                </div>
              </div>

              {bookTab === 'book' ? (
                <div className="flex-1 flex flex-col justify-between py-0.5 sm:py-1 space-y-0.5 sm:space-y-1">
                  {/* TOP SECTION: ASKS (SELLS - RED) */}
                  {(bookMode === 'both' || bookMode === 'asks') && (
                    <div className="space-y-0.5">
                      {orderBook.asks.map((row, idx) => (
                        <button
                          key={`ask-${idx}`}
                          type="button"
                          onClick={() => onSelectPrice?.(row.price)}
                          title={`Set limit entry price $${formatChartPrice(row.price)}`}
                          className="w-full relative flex items-center justify-between px-1 py-[1px] sm:py-[2px] rounded-xs overflow-hidden hover:bg-[#1E2329]/80 text-left transition-colors"
                        >
                          <span
                            className="absolute inset-y-0 right-0 bg-[#F6465D]/16 pointer-events-none"
                            style={{ width: `${row.depthPct}%` }}
                          />
                          <span className="relative text-[#F6465D] font-medium truncate">
                            {formatChartPrice(row.price)}
                          </span>
                          <span className="relative text-slate-300 shrink-0 pl-1">
                            {row.size.toFixed(isCompactViewport ? 2 : 3)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* MIDDLE MARK PRICE & SPREAD BAR */}
                  <button
                    type="button"
                    onClick={() => onSelectPrice?.(quote.price)}
                    title="Click to use current live mark price"
                    className="w-full flex items-center justify-between gap-1 px-1.5 py-0.5 sm:py-1 my-0.5 rounded bg-[#12171F] border border-[#1E2329] hover:border-[#F0B90B]/50 transition-colors"
                  >
                    <span
                      className={`text-[11px] sm:text-xs font-extrabold truncate ${
                        liveBull ? 'text-[#0ECB81]' : 'text-[#F6465D]'
                      }`}
                    >
                      {formatChartPrice(quote.price)} {liveBull ? '↑' : '↓'}
                    </span>
                    <span className="hidden sm:inline text-[9px] text-slate-400 shrink-0">
                      {orderBook.spreadPct.toFixed(2)}%
                    </span>
                  </button>

                  {/* BOTTOM SECTION: BIDS (BUYS - GREEN) */}
                  {(bookMode === 'both' || bookMode === 'bids') && (
                    <div className="space-y-0.5">
                      {orderBook.bids.map((row, idx) => (
                        <button
                          key={`bid-${idx}`}
                          type="button"
                          onClick={() => onSelectPrice?.(row.price)}
                          title={`Set limit entry price $${formatChartPrice(row.price)}`}
                          className="w-full relative flex items-center justify-between px-1 py-[1px] sm:py-[2px] rounded-xs overflow-hidden hover:bg-[#1E2329]/80 text-left transition-colors"
                        >
                          <span
                            className="absolute inset-y-0 right-0 bg-[#0ECB81]/16 pointer-events-none"
                            style={{ width: `${row.depthPct}%` }}
                          />
                          <span className="relative text-[#0ECB81] font-medium truncate">
                            {formatChartPrice(row.price)}
                          </span>
                          <span className="relative text-slate-300 shrink-0 pl-1">
                            {row.size.toFixed(isCompactViewport ? 2 : 3)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* RECENT TRADES TAPE */
                <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5 py-1 no-scrollbar">
                  {recentTrades.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onSelectPrice?.(t.price)}
                      className="w-full flex items-center justify-between px-1 py-[2px] rounded-xs hover:bg-[#1E2329]/80 text-left"
                    >
                      <span className={t.side === 'buy' ? 'text-[#0ECB81] font-medium' : 'text-[#F6465D] font-medium'}>
                        {formatChartPrice(t.price)}
                      </span>
                      <span className="text-slate-300 text-[9px] sm:text-[10px]">
                        {t.size.toFixed(2)}
                        <span className="hidden sm:inline text-slate-500 ml-1">{t.timeLabel.slice(3)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* Bottom Binance Buy/Sell Sentiment Pressure Bar */}
              <div className="pt-1 border-t border-[#1E2329] space-y-1">
                <div className="flex items-center justify-between text-[9px] font-bold">
                  <span className="text-[#0ECB81]">B {orderBook.bidRatioPct}%</span>
                  <span className="text-[#F6465D]">{orderBook.askRatioPct}% S</span>
                </div>
                <div className="h-1.5 w-full rounded-full overflow-hidden flex bg-[#161A1E]">
                  <div
                    className="h-full bg-[#0ECB81] transition-all duration-300"
                    style={{ width: `${orderBook.bidRatioPct}%` }}
                  />
                  <div
                    className="h-full bg-[#F6465D] transition-all duration-300"
                    style={{ width: `${orderBook.askRatioPct}%` }}
                  />
                </div>
              </div>
            </aside>
          )}
        </div>
      </div>

      {/* Panning Status Hint when browsing history */}
      {!isAtLiveEdge && (
        <div className="flex items-center justify-between px-2 py-1 rounded-lg bg-[#161A1E] border border-[#2B3139] text-[10px] font-mono text-amber-300">
          <span>
            Viewing historical window ({windowInfo.startIdx + 1}–{windowInfo.endIdx} of {candles.length} bars)
          </span>
          <button
            type="button"
            onClick={() => setPanOffset(0)}
            className="text-sky-400 hover:underline font-bold"
          >
            Jump to Live →
          </button>
        </div>
      )}
    </div>
  );
};
