import type {
  AccountMode,
  AdminManagedCoin,
  AdminProfitClaim,
  CoinTradeAnalytics,
  CoinTradeRecord,
  CoinTrendBias,
  MarketSymbol,
  OrderSide,
  Position,
  PreOrder,
  StaffTabId,
  UserProfile,
  UserRole,
} from '../types';

export const OPEN_FEE_RATE = 0.0018; // 0.18% per trade open
export const CLOSE_FEE_RATE = 0.0018; // 0.18% per trade close
export const PROFIT_CLOSE_FEE_RATE = CLOSE_FEE_RATE;
export const SPOT_SWAP_FEE_RATE = 0.00015; // 0.015%
export const FIRST_REGISTER_REAL_BONUS_USD = 2;

export const SYMBOL_TO_TV: Record<string, string> = {
  BTCUSDT: 'BINANCE:BTCUSDT',
  ETHUSDT: 'BINANCE:ETHUSDT',
  SOLUSDT: 'BINANCE:SOLUSDT',
  BNBUSDT: 'BINANCE:BNBUSDT',
  XRPUSDT: 'BINANCE:XRPUSDT',
  DOGEUSDT: 'BINANCE:DOGEUSDT',
  ADAUSDT: 'BINANCE:ADAUSDT',
  AVAXUSDT: 'BINANCE:AVAXUSDT',
  LINKUSDT: 'BINANCE:LINKUSDT',
  TONUSDT: 'BINANCE:TONUSDT',
  GOLD: 'BINANCE:PAXGUSDT',
  USOIL: 'TVC:USOIL',
};

export function getCleanSymbol(fullSymbol: string): MarketSymbol {
  const clean = fullSymbol.replace('BINANCE:', '').replace('TVC:', '').replace('/', '').toUpperCase().trim();
  if (clean === 'PAXGUSDT' || clean === 'GOLD') return 'GOLD';
  if (clean) return clean;
  return 'BTCUSDT';
}

export interface PositionPreviewInput {
  margin: number;
  leverage: number;
  side: OrderSide;
  marketPrice: number;
  customEntryPrice?: number | null;
}

export interface PositionPreview {
  effectiveEntryPrice: number;
  isLimitOrder: boolean;
  totalValue: number;
  tradeFee: number;
  closeFee: number;
  totalRequired: number;
  liqPriceValue: number | null;
  liqPriceFormatted: string;
  qty: string;
}

export function calculatePositionPreview(input: PositionPreviewInput): PositionPreview {
  const safeMargin = Number.isFinite(input.margin) && input.margin > 0 ? input.margin : 0;
  const safeLev = Number.isFinite(input.leverage) && input.leverage >= 1 ? input.leverage : 1;
  const marketPrice = Number.isFinite(input.marketPrice) && input.marketPrice > 0 ? input.marketPrice : 1;

  const hasCustom =
    typeof input.customEntryPrice === 'number' &&
    Number.isFinite(input.customEntryPrice) &&
    input.customEntryPrice > 0;
  const isLimitOrder = hasCustom && Math.abs((input.customEntryPrice as number) - marketPrice) > 0.01;
  const effectiveEntryPrice = hasCustom ? (input.customEntryPrice as number) : marketPrice;

  const totalValue = safeMargin * safeLev;
  const tradeFee = totalValue * OPEN_FEE_RATE;
  const closeFee = totalValue * CLOSE_FEE_RATE;
  const totalRequired = safeMargin + tradeFee;

  let liqPriceValue: number | null = null;
  let liqPriceFormatted = 'None (Spot Mode)';

  if (safeLev > 1 && safeMargin > 0) {
    liqPriceValue =
      input.side === 'buy'
        ? effectiveEntryPrice * (1 - 1 / safeLev)
        : effectiveEntryPrice * (1 + 1 / safeLev);
    liqPriceFormatted = `$${liqPriceValue.toFixed(2)}`;
  }

  const qty = effectiveEntryPrice > 0 ? (totalValue / effectiveEntryPrice).toFixed(3) : '0.000';

  return {
    effectiveEntryPrice,
    isLimitOrder,
    totalValue,
    tradeFee,
    closeFee,
    totalRequired,
    liqPriceValue,
    liqPriceFormatted,
    qty,
  };
}

export function calculateUnrealizedPnl(
  pos: Pick<Position, 'side' | 'entryPrice' | 'totalValue' | 'leverage'>,
  markPrice: number
): { pnlVal: number; pnlPct: number } {
  if (pos.entryPrice <= 0 || markPrice <= 0) {
    return { pnlVal: 0, pnlPct: 0 };
  }
  const units = pos.totalValue / pos.entryPrice;
  if (pos.side === 'buy') {
    const pnlVal = (markPrice - pos.entryPrice) * units;
    const pnlPct = ((markPrice - pos.entryPrice) / pos.entryPrice) * 100 * pos.leverage;
    return { pnlVal, pnlPct };
  }
  const pnlVal = (pos.entryPrice - markPrice) * units;
  const pnlPct = ((pos.entryPrice - markPrice) / pos.entryPrice) * 100 * pos.leverage;
  return { pnlVal, pnlPct };
}

export function calculateCloseSettlement(
  pos: Pick<Position, 'margin' | 'tradingFeePaid' | 'fundingFeePaid'> & { totalValue?: number },
  pnlVal: number
): {
  closeFee: number;
  closeProfitFee: number;
  finalNetProfit: number;
  totalFeesPaid: number;
  netReturnToWallet: number;
} {
  const closeNotional =
    typeof pos.totalValue === 'number' && Number.isFinite(pos.totalValue) && pos.totalValue > 0
      ? pos.totalValue
      : pos.margin;
  const closeFee = Number((closeNotional * CLOSE_FEE_RATE).toFixed(4));
  const finalNetProfit = pnlVal - closeFee;
  const totalFeesPaid = (pos.tradingFeePaid || 0) + (pos.fundingFeePaid || 0) + closeFee;
  const netReturnToWallet = Math.max(0, pos.margin + finalNetProfit);

  return {
    closeFee,
    closeProfitFee: closeFee,
    finalNetProfit,
    totalFeesPaid,
    netReturnToWallet,
  };
}

export function shouldTriggerPreOrder(order: Pick<PreOrder, 'side' | 'entryPrice'>, currentPrice: number): boolean {
  if (currentPrice <= 0) return false;
  if (order.side === 'buy') {
    return currentPrice <= order.entryPrice;
  }
  return currentPrice >= order.entryPrice;
}

export function shouldTriggerSlTp(
  pos: Pick<Position, 'side' | 'stopLoss' | 'takeProfit'>,
  currentPrice: number
): 'sl' | 'tp' | null {
  if (currentPrice <= 0) return null;
  if (pos.side === 'buy') {
    if (pos.stopLoss && currentPrice <= pos.stopLoss) return 'sl';
    if (pos.takeProfit && currentPrice >= pos.takeProfit) return 'tp';
  } else {
    if (pos.stopLoss && currentPrice >= pos.stopLoss) return 'sl';
    if (pos.takeProfit && currentPrice <= pos.takeProfit) return 'tp';
  }
  return null;
}

export function getNumericLiqPrice(
  pos: Pick<Position, 'side' | 'entryPrice' | 'leverage' | 'liqPrice'>
): number | null {
  if (pos.leverage <= 1 || pos.entryPrice <= 0) return null;
  if (typeof pos.liqPrice === 'string') {
    const cleaned = parseFloat(pos.liqPrice.replace(/[^0-9.]/g, ''));
    if (Number.isFinite(cleaned) && cleaned > 0) return cleaned;
  }
  return pos.side === 'buy'
    ? pos.entryPrice * (1 - 1 / pos.leverage)
    : pos.entryPrice * (1 + 1 / pos.leverage);
}

export function shouldLiquidatePosition(
  pos: Pick<Position, 'side' | 'entryPrice' | 'leverage' | 'liqPrice'>,
  currentPrice: number
): boolean {
  if (currentPrice <= 0 || pos.leverage <= 1) return false;
  const liqPrice = getNumericLiqPrice(pos);
  if (liqPrice === null || liqPrice <= 0) return false;
  if (pos.side === 'buy') {
    return currentPrice <= liqPrice;
  }
  return currentPrice >= liqPrice;
}

export function shouldTriggerPriceAlert(
  alert: { condition: 'above' | 'below'; targetPrice: number; triggered: boolean },
  currentPrice: number
): boolean {
  if (alert.triggered || currentPrice <= 0 || alert.targetPrice <= 0) return false;
  if (alert.condition === 'above') {
    return currentPrice >= alert.targetPrice;
  }
  return currentPrice <= alert.targetPrice;
}

export interface OrderConflictResult {
  allowed: boolean;
  conflictType: 'none' | 'opposite_side' | 'same_side';
  existingSide: OrderSide | null;
  reason: string | null;
}

/**
 * Prevents trading both Buy (Long) and Sell (Short) simultaneously on the same coin
 * and prevents duplicate concurrent positions/pre-orders on the same symbol in the active account mode.
 */
export function checkOrderDirectionConflict(
  symbol: MarketSymbol,
  side: OrderSide,
  accountMode: AccountMode,
  activePositions: Array<Pick<Position, 'symbol' | 'side' | 'accountMode'>>,
  preOrders: Array<Pick<PreOrder, 'symbol' | 'side' | 'accountMode'>>
): OrderConflictResult {
  const cleanSym = symbol.toUpperCase().replace('/', '').trim();
  const existingPos = activePositions.find(
    (p) => p.symbol.toUpperCase().replace('/', '').trim() === cleanSym && p.accountMode === accountMode
  );
  const existingOrder = preOrders.find(
    (o) => o.symbol.toUpperCase().replace('/', '').trim() === cleanSym && o.accountMode === accountMode
  );
  const existing = existingPos ?? existingOrder;

  if (!existing) {
    return { allowed: true, conflictType: 'none', existingSide: null, reason: null };
  }

  if (existing.side !== side) {
    const existingLabel = existing.side === 'buy' ? 'Buy / Long' : 'Sell / Short';
    const newLabel = side === 'buy' ? 'Buy / Long' : 'Sell / Short';
    return {
      allowed: false,
      conflictType: 'opposite_side',
      existingSide: existing.side,
      reason: `Cannot trade both Buy and Sell on ${cleanSym}. Close or cancel your active ${existingLabel} before opening ${newLabel}.`,
    };
  }

  return {
    allowed: false,
    conflictType: 'same_side',
    existingSide: existing.side,
    reason: `An active ${existing.side === 'buy' ? 'Long' : 'Short'} position or pre-order already exists for ${cleanSym}.`,
  };
}

export function validateSlTpTargets(
  side: OrderSide,
  entryPrice: number,
  stopLoss: number | null,
  takeProfit: number | null
): { valid: boolean; reason: string | null } {
  if (entryPrice <= 0) return { valid: true, reason: null };
  if (stopLoss !== null) {
    if (!Number.isFinite(stopLoss) || stopLoss <= 0) {
      return { valid: false, reason: 'Stop Loss must be greater than $0.' };
    }
    if (side === 'buy' && stopLoss >= entryPrice) {
      return { valid: false, reason: 'For Buy / Long, Stop Loss must be below the entry price.' };
    }
    if (side === 'sell' && stopLoss <= entryPrice) {
      return { valid: false, reason: 'For Sell / Short, Stop Loss must be above the entry price.' };
    }
  }
  if (takeProfit !== null) {
    if (!Number.isFinite(takeProfit) || takeProfit <= 0) {
      return { valid: false, reason: 'Take Profit must be greater than $0.' };
    }
    if (side === 'buy' && takeProfit <= entryPrice) {
      return { valid: false, reason: 'For Buy / Long, Take Profit must be above the entry price.' };
    }
    if (side === 'sell' && takeProfit >= entryPrice) {
      return { valid: false, reason: 'For Sell / Short, Take Profit must be below the entry price.' };
    }
  }
  return { valid: true, reason: null };
}

export function calculateProjectedSlTp(input: {
  side: OrderSide;
  leverage: number;
  margin: number;
  entryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
}): {
  slPnlUsd: number | null;
  slPnlPct: number | null;
  tpPnlUsd: number | null;
  tpPnlPct: number | null;
} {
  const safeMargin = Number.isFinite(input.margin) && input.margin > 0 ? input.margin : 0;
  const safeLev = Number.isFinite(input.leverage) && input.leverage >= 1 ? input.leverage : 1;
  const totalValue = safeMargin * safeLev;

  const closeFee = totalValue * CLOSE_FEE_RATE;

  let slPnlUsd: number | null = null;
  let slPnlPct: number | null = null;
  if (input.stopLoss && input.stopLoss > 0 && input.entryPrice > 0 && safeMargin > 0) {
    const res = calculateUnrealizedPnl(
      { side: input.side, entryPrice: input.entryPrice, totalValue, leverage: safeLev },
      input.stopLoss
    );
    slPnlUsd = Math.max(-safeMargin, res.pnlVal - closeFee);
    slPnlPct = Math.max(-100, res.pnlPct);
  }

  let tpPnlUsd: number | null = null;
  let tpPnlPct: number | null = null;
  if (input.takeProfit && input.takeProfit > 0 && input.entryPrice > 0 && safeMargin > 0) {
    const res = calculateUnrealizedPnl(
      { side: input.side, entryPrice: input.entryPrice, totalValue, leverage: safeLev },
      input.takeProfit
    );
    tpPnlUsd = Math.max(-safeMargin, res.pnlVal - closeFee);
    tpPnlPct = res.pnlPct;
  }

  return { slPnlUsd, slPnlPct, tpPnlUsd, tpPnlPct };
}

export function evaluatePositionAutoClose(
  pos: Pick<Position, 'side' | 'entryPrice' | 'leverage' | 'liqPrice' | 'margin' | 'totalValue' | 'stopLoss' | 'takeProfit'>,
  currentPrice: number
): {
  trigger: 'liquidation' | 'tp' | 'sl';
  isLiquidated: boolean;
  reasonLabel: string;
} | null {
  if (currentPrice <= 0) return null;

  // 1. Strict liquidation check: touching liqPrice OR full margin depletion
  const liqHit = shouldLiquidatePosition(pos, currentPrice);
  const { pnlVal } = calculateUnrealizedPnl(pos, currentPrice);
  const marginWiped = pos.leverage > 1 && pos.margin > 0 && pnlVal <= -pos.margin;

  if (liqHit || marginWiped) {
    return {
      trigger: 'liquidation',
      isLiquidated: true,
      reasonLabel: 'LIQUIDATED',
    };
  }

  // 2. Stop Loss / Take Profit auto-close check
  const slTpHit = shouldTriggerSlTp(pos, currentPrice);
  if (slTpHit === 'tp') {
    return {
      trigger: 'tp',
      isLiquidated: false,
      reasonLabel: 'Take Profit Hit',
    };
  }
  if (slTpHit === 'sl') {
    return {
      trigger: 'sl',
      isLiquidated: false,
      reasonLabel: 'Stop Loss Hit',
    };
  }

  return null;
}

export function calculateSpotSwap(
  direction: 'usdtToCoin' | 'coinToUsdt',
  amount: number,
  marketPrice: number
): { feeUsdt: number; netOutput: number } {
  const safeAmount = Number.isFinite(amount) && amount > 0 ? amount : 0;
  const safePrice = Number.isFinite(marketPrice) && marketPrice > 0 ? marketPrice : 1;

  if (direction === 'usdtToCoin') {
    const feeUsdt = safeAmount * SPOT_SWAP_FEE_RATE;
    const netUsdt = Math.max(0, safeAmount - feeUsdt);
    return { feeUsdt, netOutput: netUsdt / safePrice };
  }

  const grossUsdt = safeAmount * safePrice;
  const feeUsdt = grossUsdt * SPOT_SWAP_FEE_RATE;
  const netUsdt = Math.max(0, grossUsdt - feeUsdt);
  return { feeUsdt, netOutput: netUsdt };
}

export function convertCurrencyMmkUsd(
  inputVal: number,
  currencyMode: 'usdt' | 'mmk',
  rateMMK: number
): { usdAmount: number; mmkAmount: number } {
  const safeVal = Number.isFinite(inputVal) && inputVal > 0 ? inputVal : 0;
  const safeRate = Number.isFinite(rateMMK) && rateMMK > 0 ? rateMMK : 4300;
  if (currencyMode === 'usdt') {
    return { usdAmount: safeVal, mmkAmount: safeVal * safeRate };
  }
  return { usdAmount: safeVal / safeRate, mmkAmount: safeVal };
}

export function generateWalletCsv(
  transactions: Array<{
    type: string;
    amount: number;
    target: string;
    isAdjustment?: boolean;
    status: string;
    timestamp: string;
  }>
): string {
  const header = 'Transaction Type,Amount (USD),Target Account/Recipient,Status,Timestamp';
  const rows = transactions.map((tx) => {
    let displayType = tx.type || '';
    if (displayType.includes('ADD') || displayType.includes('DEPOSIT')) displayType = 'DEPOSIT';
    else if (displayType.includes('DEDUCT') || displayType.includes('WITHDRAW')) displayType = 'WITHDRAW';

    const cleanType = `"${displayType.replace(/"/g, '""')}"`;
    const cleanAmount = Number(tx.amount || 0).toFixed(2);
    const cleanTarget = tx.isAdjustment ? '"System Wallet"' : `"${(tx.target || '').replace(/"/g, '""')}"`;
    const cleanStatus = `"${(tx.status || 'PENDING').replace(/"/g, '""')}"`;
    const cleanTime = `"${(tx.timestamp || '').replace(/"/g, '""')}"`;
    return `${cleanType},${cleanAmount},${cleanTarget},${cleanStatus},${cleanTime}`;
  });
  return [header, ...rows].join('\n');
}

export interface WithdrawalEligibilityResult {
  allowed: boolean;
  reason: string | null;
  lockType:
    | 'none'
    | 'account_blocked'
    | 'admin_withdraw_blocked'
    | 'no_deposit'
    | 'no_trade_after_deposit';
}

export function evaluateWithdrawalEligibility(
  user: Pick<
    UserProfile,
    | 'isBlocked'
    | 'isWithdrawBlocked'
    | 'hasDepositedBefore'
    | 'hasTradedAfterDeposit'
    | 'withdrawLockClearedByAdmin'
  >
): WithdrawalEligibilityResult {
  if (user.isBlocked) {
    return {
      allowed: false,
      reason: 'Account is currently restricted. Withdrawals are disabled.',
      lockType: 'account_blocked',
    };
  }
  if (user.isWithdrawBlocked) {
    return {
      allowed: false,
      reason: 'Withdrawals are currently locked on this account. Please contact support.',
      lockType: 'admin_withdraw_blocked',
    };
  }
  if (user.withdrawLockClearedByAdmin) {
    return {
      allowed: true,
      reason: null,
      lockType: 'none',
    };
  }
  if (!user.hasDepositedBefore) {
    return {
      allowed: false,
      reason: 'Please make your first deposit to withdraw funds.',
      lockType: 'no_deposit',
    };
  }
  if (!user.hasTradedAfterDeposit) {
    return {
      allowed: false,
      reason: 'Trade required after deposit: execute at least 1 Real Account trade before withdrawing.',
      lockType: 'no_trade_after_deposit',
    };
  }
  return {
    allowed: true,
    reason: null,
    lockType: 'none',
  };
}

export function canClearWithdrawLock(actorRole: UserRole): boolean {
  return actorRole === 'admin';
}

export function extractAccountTargetNumber(targetDesc: string): string {
  const raw = (targetDesc || '').trim();
  if (!raw) return '';
  const match = raw.match(/\(([^)]+)\)/);
  if (match && match[1]) {
    return match[1].trim();
  }
  return raw;
}

export function getAllowedStaffTabs(role: UserRole): StaffTabId[] {
  if (role === 'admin') {
    return ['rates', 'coins', 'lottery', 'news', 'faq', 'caiwu', 'chukuan', 'admin', 'search', 'roles'];
  }
  if (role === 'staff') {
    return ['rates', 'faq', 'caiwu', 'chukuan', 'admin', 'search', 'roles'];
  }
  if (role === 'caiwu') {
    return ['caiwu', 'search'];
  }
  if (role === 'chukuan') {
    return ['chukuan'];
  }
  return [];
}

export function canAccessStaffTab(role: UserRole, tab: StaffTabId): boolean {
  return getAllowedStaffTabs(role).includes(tab);
}

function roundCoinPrice(val: number): number {
  if (!Number.isFinite(val) || val <= 0) return 0.0001;
  if (val >= 1000) return Number(val.toFixed(2));
  if (val >= 1) return Number(val.toFixed(3));
  return Number(val.toFixed(4));
}

function easeInOutSmooth(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return 0.5 - 0.5 * Math.cos(Math.PI * clamped);
}

/**
 * Generates synchronized, deterministic live market ticks around an anchor price
 * so officially launched custom coins move continuously like live Binance markets.
 */
export function computeOrganicMarketTickPrice(
  anchorPrice: number,
  symbol: string,
  nowMs: number,
  amplitudePct = 0.0045,
  trendBias: CoinTrendBias = 'neutral'
): number {
  const safeAnchor = Number.isFinite(anchorPrice) && anchorPrice > 0 ? anchorPrice : 1;
  const secBucket = Math.floor(nowMs / 1000);
  const seed = symbol.split('').reduce((acc, ch, i) => acc + ch.charCodeAt(0) * (i + 3), 0);

  const slowWave = Math.sin((secBucket + seed) * 0.055) * 0.52;
  const midWave = Math.cos((secBucket + seed * 2) * 0.23) * 0.31;
  const fastWave = Math.sin((secBucket + seed * 5) * 0.91) * 0.17;
  const pseudoHash = Math.sin((secBucket + 1) * 12.9898 + seed * 78.233) * 43758.5453;
  const microTick = ((pseudoHash - Math.floor(pseudoHash)) - 0.5) * 0.5;

  // Gradual cyclical trend bias wave when Admin tilts ongoing market sentiment up or down
  const biasWave =
    trendBias === 'up'
      ? 0.0035 + Math.sin(secBucket * 0.015) * 0.0025
      : trendBias === 'down'
      ? -(0.0035 + Math.sin(secBucket * 0.015) * 0.0025)
      : 0;

  const pctOffset = (slowWave + midWave + fastWave + microTick) * amplitudePct + biasWave;
  return roundCoinPrice(Math.max(0.0001, safeAnchor * (1 + pctOffset)));
}

export function computeScheduledCoinPrice(
  coin: Pick<AdminManagedCoin, 'currentPrice' | 'schedule'>,
  nowMs: number
): {
  price: number;
  completed: boolean;
  phase: 'manual' | 'up' | 'down' | 'completed';
  remainingSec: number;
  progressPct: number;
} {
  const sched = coin.schedule;
  if (!sched || !sched.active || sched.paused || sched.mode === 'manual') {
    return {
      price: coin.currentPrice,
      completed: false,
      phase: 'manual',
      remainingSec: 0,
      progressPct: 0,
    };
  }

  const elapsedSec = Math.max(0, (nowMs - sched.startedAtMs) / 1000);
  const upDur = Math.max(0, sched.upDurationSec);
  const downDur = Math.max(0.5, sched.downDurationSec);

  if (sched.mode === 'glide_to_target') {
    const glideDur = Math.max(0.5, sched.upDurationSec);
    if (elapsedSec >= glideDur) {
      return {
        price: roundCoinPrice(sched.upTargetPrice),
        completed: true,
        phase: 'completed',
        remainingSec: 0,
        progressPct: 100,
      };
    }
    const p = elapsedSec / glideDur;
    const eased = easeInOutSmooth(p);
    const span = sched.upTargetPrice - sched.startPrice;
    const ripple = Math.sin(elapsedSec * 1.4) * Math.abs(span) * 0.015 * Math.sin(p * Math.PI);
    const raw = sched.startPrice + span * eased + ripple;
    return {
      price: roundCoinPrice(Math.max(0.0001, raw)),
      completed: false,
      phase: sched.upTargetPrice >= sched.startPrice ? 'up' : 'down',
      remainingSec: Math.max(0, Math.ceil(glideDur - elapsedSec)),
      progressPct: Math.min(99, Math.round(p * 100)),
    };
  }

  if (sched.mode === 'down_sweep') {
    if (elapsedSec >= downDur) {
      return {
        price: roundCoinPrice(sched.downTargetPrice),
        completed: true,
        phase: 'completed',
        remainingSec: 0,
        progressPct: 100,
      };
    }
    const progress = elapsedSec / downDur;
    const eased = easeInOutSmooth(progress);
    const span = sched.downTargetPrice - sched.startPrice;
    const ripple = Math.sin(elapsedSec * 1.5) * Math.abs(span) * 0.014 * Math.sin(progress * Math.PI);
    const raw = sched.startPrice + span * eased + ripple;
    return {
      price: roundCoinPrice(Math.max(0.0001, raw)),
      completed: false,
      phase: 'down',
      remainingSec: Math.max(0, Math.ceil(downDur - elapsedSec)),
      progressPct: Math.min(99, Math.round(progress * 100)),
    };
  }

  // 'up_then_down': smooth gradual climb & gradual descent (1-shot OR continuous repeatLoop)
  const totalDur = Math.max(0.5, upDur + downDur);

  if (sched.repeatLoop) {
    const cycleCount = Math.floor(elapsedSec / totalDur);
    const cycleElapsed = elapsedSec - cycleCount * totalDur;
    const cycleStartPrice = cycleCount === 0 ? sched.startPrice : sched.downTargetPrice;
    const ripple =
      Math.sin(elapsedSec * 1.6) * Math.abs(sched.upTargetPrice - sched.downTargetPrice) * 0.016;

    if (upDur > 0 && cycleElapsed < upDur) {
      const p1 = cycleElapsed / upDur;
      const eased1 = easeInOutSmooth(p1);
      const raw = cycleStartPrice + (sched.upTargetPrice - cycleStartPrice) * eased1 + ripple;
      return {
        price: roundCoinPrice(Math.max(0.0001, raw)),
        completed: false,
        phase: 'up',
        remainingSec: Math.max(1, Math.ceil(totalDur - cycleElapsed)),
        progressPct: Math.min(99, Math.round((cycleElapsed / totalDur) * 100)),
      };
    }

    const p2 = Math.min(1, Math.max(0, (cycleElapsed - upDur) / downDur));
    const eased2 = easeInOutSmooth(p2);
    const raw = sched.upTargetPrice + (sched.downTargetPrice - sched.upTargetPrice) * eased2 + ripple;
    return {
      price: roundCoinPrice(Math.max(0.0001, raw)),
      completed: false,
      phase: 'down',
      remainingSec: Math.max(1, Math.ceil(totalDur - cycleElapsed)),
      progressPct: Math.min(99, Math.round((cycleElapsed / totalDur) * 100)),
    };
  }

  if (upDur > 0 && elapsedSec < upDur) {
    const p1 = elapsedSec / upDur;
    const eased1 = easeInOutSmooth(p1);
    const wave = Math.sin(p1 * Math.PI) * Math.abs(sched.upTargetPrice - sched.startPrice) * 0.02;
    const raw = sched.startPrice + (sched.upTargetPrice - sched.startPrice) * eased1 + wave;
    return {
      price: roundCoinPrice(Math.max(0.0001, raw)),
      completed: false,
      phase: 'up',
      remainingSec: Math.max(0, Math.ceil(totalDur - elapsedSec)),
      progressPct: Math.min(99, Math.round((elapsedSec / totalDur) * 100)),
    };
  }

  if (elapsedSec < totalDur) {
    const p2 = (elapsedSec - upDur) / downDur;
    const eased2 = easeInOutSmooth(p2);
    const wave = Math.sin(p2 * Math.PI) * Math.abs(sched.upTargetPrice - sched.downTargetPrice) * 0.014;
    const raw = sched.upTargetPrice + (sched.downTargetPrice - sched.upTargetPrice) * eased2 + wave;
    return {
      price: roundCoinPrice(Math.max(0.0001, raw)),
      completed: false,
      phase: 'down',
      remainingSec: Math.max(0, Math.ceil(totalDur - elapsedSec)),
      progressPct: Math.min(99, Math.round((elapsedSec / totalDur) * 100)),
    };
  }

  return {
    price: roundCoinPrice(sched.downTargetPrice),
    completed: true,
    phase: 'completed',
    remainingSec: 0,
    progressPct: 100,
  };
}

export function summarizeCoinTradeAnalytics(
  symbol: string,
  trades: CoinTradeRecord[],
  claims: AdminProfitClaim[]
): CoinTradeAnalytics {
  const cleanSym = symbol.toUpperCase();
  const symTrades = trades.filter((t) => t.symbol.toUpperCase() === cleanSym);
  const symClaims = claims.filter((c) => c.symbol.toUpperCase() === cleanSym);

  let openTrades = 0;
  let closedWinTrades = 0;
  let closedLossTrades = 0;
  let liquidatedTrades = 0;
  let totalVolumeUsd = 0;
  let totalUserWinProfitUsd = 0;
  let totalUserLossUsd = 0;
  let totalTradingFeesUsd = 0;
  let openLongExposureUsd = 0;
  let openShortExposureUsd = 0;

  const openLongLiqs: number[] = [];
  const openShortLiqs: number[] = [];

  for (const t of symTrades) {
    const notional = t.margin * Math.max(1, t.leverage);
    totalVolumeUsd += notional;
    totalTradingFeesUsd += t.tradingFee || 0;

    if (t.status === 'OPEN') {
      openTrades += 1;
      if (t.side === 'buy') {
        openLongExposureUsd += notional;
        if (t.liqPrice && t.liqPrice > 0) openLongLiqs.push(t.liqPrice);
      } else {
        openShortExposureUsd += notional;
        if (t.liqPrice && t.liqPrice > 0) openShortLiqs.push(t.liqPrice);
      }
      continue;
    }

    if (t.status === 'LIQUIDATED') {
      liquidatedTrades += 1;
      totalUserLossUsd += Math.max(t.margin, Math.abs(t.pnlVal));
    } else if (t.pnlVal >= 0) {
      closedWinTrades += 1;
      totalUserWinProfitUsd += t.pnlVal;
    } else {
      closedLossTrades += 1;
      totalUserLossUsd += Math.abs(t.pnlVal);
    }
  }

  const netAdminProfitUsd = Number(
    (totalUserLossUsd + totalTradingFeesUsd - totalUserWinProfitUsd).toFixed(2)
  );
  const alreadyClaimedUsd = Number(
    symClaims.reduce((sum, c) => sum + (c.amountUsd || 0), 0).toFixed(2)
  );
  const claimableProfitUsd = Number(Math.max(0, netAdminProfitUsd - alreadyClaimedUsd).toFixed(2));
  const recommendedLiqBottomPrice =
    openLongLiqs.length > 0 ? Number((Math.min(...openLongLiqs) * 0.96).toFixed(3)) : null;
  const recommendedShortSqueezePrice =
    openShortLiqs.length > 0 ? Number((Math.max(...openShortLiqs) * 1.04).toFixed(3)) : null;

  return {
    symbol: cleanSym,
    totalTrades: symTrades.length,
    openTrades,
    closedWinTrades,
    closedLossTrades,
    liquidatedTrades,
    totalVolumeUsd: Number(totalVolumeUsd.toFixed(2)),
    totalUserWinProfitUsd: Number(totalUserWinProfitUsd.toFixed(2)),
    totalUserLossUsd: Number(totalUserLossUsd.toFixed(2)),
    totalTradingFeesUsd: Number(totalTradingFeesUsd.toFixed(2)),
    netAdminProfitUsd,
    alreadyClaimedUsd,
    claimableProfitUsd,
    recommendedLiqBottomPrice,
    recommendedShortSqueezePrice,
    openLongExposureUsd: Number(openLongExposureUsd.toFixed(2)),
    openShortExposureUsd: Number(openShortExposureUsd.toFixed(2)),
    trades: symTrades,
    claims: symClaims,
  };
}

export interface MemberProfileInput {
  username?: string;
  email?: string;
  avatarUrl?: string | null;
  fullName?: string | null;
  phone?: string | null;
  country?: string | null;
  bio?: string | null;
  withdrawMethod?: string | null;
  withdrawAccountName?: string | null;
  withdrawAccountNumber?: string | null;
  securityPin?: string | null;
}

export interface NormalizedMemberProfile {
  username?: string;
  email?: string;
  avatarUrl?: string | null;
  fullName?: string | null;
  phone?: string | null;
  country?: string | null;
  bio?: string | null;
  withdrawMethod?: 'kpay' | 'wavepay' | 'usdt' | 'bank';
  withdrawAccountName?: string | null;
  withdrawAccountNumber?: string | null;
  securityPin?: string;
}

const VALID_WITHDRAW_METHODS = new Set(['kpay', 'wavepay', 'usdt', 'bank']);
const MAX_AVATAR_DATA_URL_BYTES = 280_000;

function trimNullableText(val: unknown, maxLen: number): string | null | undefined {
  if (val === undefined) return undefined;
  if (val === null) return null;
  if (typeof val !== 'string') return null;
  const cleaned = val.trim().slice(0, maxLen);
  return cleaned.length > 0 ? cleaned : null;
}

export function normalizeMemberProfileInput(
  input: MemberProfileInput,
  options: { allowEmailAndPin?: boolean } = {}
): { ok: true; data: NormalizedMemberProfile } | { ok: false; error: string } {
  const data: NormalizedMemberProfile = {};

  if (input.username !== undefined) {
    const trimmed = String(input.username).trim().slice(0, 48);
    if (!trimmed) {
      return { ok: false, error: 'Display username cannot be empty.' };
    }
    data.username = trimmed;
  }

  if (options.allowEmailAndPin && input.email !== undefined) {
    const email = String(input.email).trim().toLowerCase().slice(0, 120);
    if (!email || !email.includes('@')) {
      return { ok: false, error: 'Enter a valid email address.' };
    }
    data.email = email;
  }

  if (options.allowEmailAndPin && input.securityPin !== undefined && input.securityPin !== null) {
    const pinStr = String(input.securityPin).trim();
    if (pinStr.length > 0) {
      if (!/^\d{4}$/.test(pinStr)) {
        return { ok: false, error: 'Security PIN must be exactly 4 digits.' };
      }
      data.securityPin = pinStr;
    }
  }

  if (input.avatarUrl !== undefined) {
    if (input.avatarUrl === null || input.avatarUrl === '') {
      data.avatarUrl = null;
    } else if (typeof input.avatarUrl === 'string') {
      const trimmedAvatar = input.avatarUrl.trim();
      if (trimmedAvatar.length > MAX_AVATAR_DATA_URL_BYTES) {
        return { ok: false, error: 'Profile image is too large. Please upload a smaller image.' };
      }
      const isValidDataImage = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[a-zA-Z0-9+/=]+$/i.test(trimmedAvatar);
      const isValidHttpImage = /^https?:\/\/.+/i.test(trimmedAvatar);
      if (!isValidDataImage && !isValidHttpImage) {
        return { ok: false, error: 'Invalid profile picture format.' };
      }
      data.avatarUrl = trimmedAvatar;
    }
  }

  const fullName = trimNullableText(input.fullName, 80);
  if (fullName !== undefined) data.fullName = fullName;

  const phone = trimNullableText(input.phone, 40);
  if (phone !== undefined) data.phone = phone;

  const country = trimNullableText(input.country, 80);
  if (country !== undefined) data.country = country;

  const bio = trimNullableText(input.bio, 240);
  if (bio !== undefined) data.bio = bio;

  if (input.withdrawMethod !== undefined && input.withdrawMethod !== null) {
    const m = String(input.withdrawMethod).trim().toLowerCase();
    if (!VALID_WITHDRAW_METHODS.has(m)) {
      return { ok: false, error: 'Invalid withdraw method.' };
    }
    data.withdrawMethod = m as 'kpay' | 'wavepay' | 'usdt' | 'bank';
  }

  const withdrawAccountName = trimNullableText(input.withdrawAccountName, 90);
  if (withdrawAccountName !== undefined) data.withdrawAccountName = withdrawAccountName;

  const withdrawAccountNumber = trimNullableText(input.withdrawAccountNumber, 96);
  if (withdrawAccountNumber !== undefined) data.withdrawAccountNumber = withdrawAccountNumber;

  return { ok: true, data };
}

export function resolveWithdrawDefaults(
  user: Pick<UserProfile, 'withdrawMethod' | 'withdrawAccountName' | 'withdrawAccountNumber' | 'fullName'>
): {
  method: 'kpay' | 'wavepay' | 'usdt' | 'bank';
  holderName: string;
  target: string;
} {
  const m = user.withdrawMethod && VALID_WITHDRAW_METHODS.has(user.withdrawMethod)
    ? user.withdrawMethod
    : 'kpay';
  return {
    method: m,
    holderName: (user.withdrawAccountName || user.fullName || '').trim(),
    target: (user.withdrawAccountNumber || '').trim(),
  };
}

export function sanitizeMemberNoticeText(raw: string | null | undefined): string {
  const text = (raw || '').trim();
  if (!text) return '';
  if (/^ADMIN ADD BALANCE$/i.test(text)) return 'SYSTEM CREDIT';
  if (/^ADMIN DEDUCT BALANCE$/i.test(text)) return 'SYSTEM ADJUSTMENT';
  if (/rejected by finance\/admin/i.test(text)) {
    return 'Verification declined. Please check details or contact support.';
  }
  return text
    .replace(/\(unless\s+admin\s+clears\s+lock\)/gi, '')
    .replace(/\(or\s+cleared\s+by\s+admin\)/gi, '')
    .replace(/\bby\s+(?:admin|staff|caiwu|chukuan|finance\/admin)\b/gi, 'by system verification')
    .replace(/\s{2,}/g, ' ')
    .trim();
}


