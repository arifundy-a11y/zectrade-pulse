export type BuiltInMarketSymbol =
  | 'BTCUSDT'
  | 'ETHUSDT'
  | 'SOLUSDT'
  | 'BNBUSDT'
  | 'XRPUSDT'
  | 'DOGEUSDT'
  | 'ADAUSDT'
  | 'AVAXUSDT'
  | 'LINKUSDT'
  | 'TONUSDT'
  | 'GOLD'
  | 'USOIL';

export type MarketSymbol = BuiltInMarketSymbol | (string & {});

export type TradingViewSymbol = string;

export interface MarketQuote {
  symbol: MarketSymbol;
  tvSymbol: TradingViewSymbol;
  label: string;
  shortName: string;
  price: number;
  changePct: number;
  high24h: number;
  low24h: number;
  isCustom?: boolean;
}

export type OrderSide = 'buy' | 'sell';
export type AccountMode = 'demo' | 'real';
export type WalletExecutionMode = 'spot' | 'leverage';
export type UserRole = 'user' | 'admin' | 'staff' | 'caiwu' | 'chukuan';

export interface PreOrder {
  id: string;
  symbol: MarketSymbol;
  side: OrderSide;
  leverage: number;
  entryPrice: number;
  markPrice: number;
  liqPrice: string;
  margin: number;
  btcQty: string;
  totalValue: number;
  tradingFeePaid: number;
  fundingFeePaid: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  openedAt: number;
  accountMode: AccountMode;
}

export interface Position extends PreOrder {
  currentPnlVal?: number;
  currentPnlPct?: number;
}

export interface TradeHistoryItem {
  id: string;
  symbol: MarketSymbol;
  side: OrderSide;
  leverage: number;
  entryPrice: number;
  closePrice: number;
  totalFees: number;
  pnlVal: number;
  pnlPct: number;
  accountMode: AccountMode;
  isLiquidated?: boolean;
  closedAt: string;
  rawTime: number;
}

export interface SpotHolding {
  units: number;
  avgPrice: number;
}

export type SpotHoldingsMap = Partial<Record<MarketSymbol, SpotHolding>>;

export interface WalletTransaction {
  id: string;
  path?: string;
  userId?: string;
  userEmail?: string;
  type: string;
  amount: number;
  target: string;
  isAdjustment?: boolean;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'APPROVED' | 'REJECTED' | 'COMPLETED';
  rejectReason?: string | null;
  timestamp: string;
  rawTime: number;
}

export type WithdrawMethod = 'kpay' | 'wavepay' | 'usdt' | 'bank';

export interface UserProfile {
  uid: string;
  isLoggedIn: boolean;
  isLocalDemoSession: boolean;
  username: string;
  email: string;
  pin: string;
  role: UserRole;
  isBlocked: boolean;
  isWithdrawBlocked: boolean;
  invitedBy: string | null;
  hasDepositedBefore: boolean;
  hasTradedAfterDeposit: boolean;
  withdrawLockClearedByAdmin: boolean;
  demoBalance: number;
  realBalance: number;
  spotHoldings: SpotHoldingsMap;
  avatarUrl?: string | null;
  fullName?: string | null;
  phone?: string | null;
  country?: string | null;
  bio?: string | null;
  withdrawMethod?: WithdrawMethod;
  withdrawAccountName?: string | null;
  withdrawAccountNumber?: string | null;
}

export interface DepositAccountInfo {
  name: string;
  number: string;
}

export interface DepositAccounts {
  kpay: DepositAccountInfo;
  wavepay: DepositAccountInfo;
  usdt: DepositAccountInfo;
  btc: DepositAccountInfo;
}

export interface FaqEntry {
  q: string;
  a: string;
}

export interface PlatformStats {
  membersCount: number;
  totalDeposits: string;
  totalWithdrawals: string;
}

export interface LiveFeedItem {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAWAL';
  method: string;
  amount: number;
  user: string;
  time: string;
}

export type AppSection = 'trade' | 'news' | 'lottery' | 'profile';

export type LotteryColor = 'green' | 'red';
export type LotteryBetType = 'color' | 'number';
export type LotteryResultMode = 'auto_balance' | 'manual' | 'random';
export type LotteryDigitGameType = '2D' | '3D' | '6D';

export interface LotteryConfig {
  roundDurationSec: number;
  lockSeconds: number;
  feePct: number;
  payoutMultiplier: number;
  numberMultiplier: number;
  resultMode: LotteryResultMode;
  forcedResult: LotteryColor | null;
  forcedNumber: number | null;
  isPaused: boolean;
  accumulatedProfit: number;
}

export interface LotteryRoundSummary {
  roundCode: string;
  roundNumber: number;
  durationSec: number;
  startedAtMs: number;
  endsAtMs: number;
  remainingSec: number;
  isLocked: boolean;
  isPaused: boolean;
  status: 'OPEN' | 'SETTLED';
  resultMode: LotteryResultMode;
  forcedResult: LotteryColor | null;
  forcedNumber: number | null;
  winningColor: LotteryColor | null;
  winningNumber: number | null;
  greenTotal: number;
  redTotal: number;
  greenCount: number;
  redCount: number;
  totalFees: number;
  totalPayouts: number;
  houseProfit: number;
  settledAtMs?: number | null;
}

export interface LotteryBetRecord {
  id: string;
  roundCode: string;
  userUid: string;
  userEmail: string;
  accountMode: AccountMode;
  betType: LotteryBetType;
  color: LotteryColor;
  pickedNumber: number | null;
  stake: number;
  feePct: number;
  feeAmount: number;
  netStake: number;
  multiplier: number;
  potentialPayout: number;
  outcome: 'PENDING' | 'WIN' | 'LOSS';
  payoutAmount: number;
  netProfit: number;
  createdAtMs: number;
  settledAtMs?: number | null;
}

export interface DigitLotteryDrawSummary {
  drawUid: string;
  gameType: LotteryDigitGameType;
  drawLabel: string;
  scheduledReleaseAtMs: number;
  remainingSec: number;
  isLocked: boolean;
  lockBeforeSec: number;
  payoutMultiplier: number;
  feePct: number;
  manualResult: string | null;
  winningNumber: string | null;
  status: 'SCHEDULED' | 'RELEASED';
  totalStake: number;
  totalPayouts: number;
  betCount: number;
  releasedAtMs: number | null;
}

export interface DigitLotteryBetRecord {
  id: string;
  drawUid: string;
  gameType: LotteryDigitGameType;
  userUid: string;
  userEmail: string;
  accountMode: AccountMode;
  pickedNumber: string;
  stake: number;
  feePct: number;
  feeAmount: number;
  netStake: number;
  multiplier: number;
  potentialPayout: number;
  outcome: 'PENDING' | 'WIN' | 'LOSS';
  payoutAmount: number;
  netProfit: number;
  createdAtMs: number;
  settledAtMs: number | null;
}

export interface LotteryLiveState {
  serverTimeMs: number;
  config: LotteryConfig;
  currentRound: LotteryRoundSummary;
  historyStrip: LotteryRoundSummary[];
  userBets: LotteryBetRecord[];
  digitDraws: DigitLotteryDrawSummary[];
  digitHistory: DigitLotteryDrawSummary[];
  userDigitBets: DigitLotteryBetRecord[];
}

export type AlertCondition = 'above' | 'below';

export interface PriceAlert {
  id: string;
  symbol: MarketSymbol;
  condition: AlertCondition;
  targetPrice: number;
  triggered: boolean;
  createdAt: string;
  triggeredAt?: string;
}

export type StaffTabId =
  | 'rates'
  | 'coins'
  | 'lottery'
  | 'news'
  | 'faq'
  | 'caiwu'
  | 'chukuan'
  | 'admin'
  | 'search'
  | 'roles';

export type CoinScheduleMode = 'manual' | 'glide_to_target' | 'up_then_down' | 'down_sweep';
export type CoinTrendBias = 'up' | 'neutral' | 'down';
export type CoinVolatilityLevel = 'calm' | 'normal' | 'active';

export interface AdminPriceSchedule {
  mode: CoinScheduleMode;
  startedAtMs: number;
  startPrice: number;
  upTargetPrice: number;
  upDurationSec: number;
  downTargetPrice: number;
  downDurationSec: number;
  repeatLoop?: boolean;
  paused?: boolean;
  pausedAtMs?: number;
  trendBias?: CoinTrendBias;
  volatilityLevel?: CoinVolatilityLevel;
  active: boolean;
}

export interface AdminManagedCoin {
  symbol: string;
  label: string;
  shortName: string;
  basePrice?: number;
  targetPrice?: number | null;
  currentPrice: number;
  openPrice24h: number;
  changePct: number;
  high24h: number;
  low24h: number;
  enabled: boolean;
  schedule: AdminPriceSchedule | null;
  updatedAtMs: number;
}

export interface CoinTradeRecord {
  id: string;
  symbol: string;
  userUid: string;
  userEmail: string;
  side: OrderSide;
  leverage: number;
  margin: number;
  entryPrice: number;
  closePrice: number | null;
  liqPrice: number | null;
  tradingFee: number;
  pnlVal: number;
  status: 'OPEN' | 'CLOSED' | 'LIQUIDATED';
  accountMode: AccountMode;
  openedAtMs: number;
  closedAtMs?: number | null;
}

export interface AdminProfitClaim {
  id: string;
  symbol: string;
  amountUsd: number;
  claimedByUid: string;
  claimedByEmail: string;
  claimedAtLabel: string;
  claimedAtMs: number;
}

export interface CoinTradeAnalytics {
  symbol: string;
  totalTrades: number;
  openTrades: number;
  closedWinTrades: number;
  closedLossTrades: number;
  liquidatedTrades: number;
  totalVolumeUsd: number;
  totalUserWinProfitUsd: number;
  totalUserLossUsd: number;
  totalTradingFeesUsd: number;
  netAdminProfitUsd: number;
  alreadyClaimedUsd: number;
  claimableProfitUsd: number;
  recommendedLiqBottomPrice: number | null;
  recommendedShortSqueezePrice?: number | null;
  openLongExposureUsd?: number;
  openShortExposureUsd?: number;
  trades: CoinTradeRecord[];
  claims: AdminProfitClaim[];
}

export interface StaffWalletRequest {
  id: string;
  serverId?: number;
  source: 'server' | 'firestore' | 'local';
  firestorePath?: string;
  userId: string;
  userEmail: string;
  kind: 'deposit' | 'withdrawal';
  type: string;
  method: string;
  amount: number;
  target: string;
  status: string;
  rejectReason?: string | null;
  createdAtLabel: string;
}

export interface ManagedMember {
  uid: string;
  username: string;
  email: string;
  role: UserRole;
  isBlocked: boolean;
  isWithdrawBlocked: boolean;
  hasDepositedBefore?: boolean;
  hasTradedAfterDeposit?: boolean;
  withdrawLockClearedByAdmin?: boolean;
  realBalance: number;
  demoBalance: number;
  securityPin?: string;
  invitedBy?: string | null;
  avatarUrl?: string | null;
  fullName?: string | null;
  phone?: string | null;
  country?: string | null;
  bio?: string | null;
  withdrawMethod?: WithdrawMethod;
  withdrawAccountName?: string | null;
  withdrawAccountNumber?: string | null;
}

export type HeatmapMetricMode = 'intensity' | 'recovery';

export interface FitnessHeatmapRecord {
  id: number;
  memberUid: string;
  memberName: string;
  memberEmail: string;
  dayDate: string;
  dayLabel: string;
  discipline: string;
  intensityScore: number;
  recoveryScore: number;
  avgBpm: number;
  strainScore: number;
  durationMinutes: number;
}

export interface ToastMessage {
  id: string;
  message: string;
  type: 'success' | 'error';
}

export type NewsCategory =
  | 'Market Brief'
  | 'Macro & Rates'
  | 'Crypto'
  | 'Commodities'
  | 'Platform Update';

export interface NewsArticle {
  id: number;
  slug: string;
  title: string;
  summary: string;
  content: string;
  category: NewsCategory;
  authorName: string;
  imageUrl?: string | null;
  isFeatured: boolean;
  isPublished: boolean;
  readTimeMin: number;
  publishedAtMs: number;
  updatedAtMs: number;
}
