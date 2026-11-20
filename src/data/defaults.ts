import type {
  AdminManagedCoin,
  DepositAccounts,
  DigitLotteryBetRecord,
  DigitLotteryDrawSummary,
  FaqEntry,
  LiveFeedItem,
  LotteryBetRecord,
  LotteryColor,
  LotteryConfig,
  LotteryDigitGameType,
  LotteryRoundSummary,
  ManagedMember,
  MarketQuote,
  NewsArticle,
  UserProfile,
} from '../types';
import {
  DEFAULT_LOTTERY_FEE_PCT,
  deriveLotteryDrawNumber,
} from '../utils/lotteryEngine';
import { FIRST_REGISTER_REAL_BONUS_USD } from '../utils/tradingEngine';

export const INITIAL_QUOTES: MarketQuote[] = [
  {
    symbol: 'BTCUSDT',
    tvSymbol: 'BINANCE:BTCUSDT',
    label: 'BTC / USDT',
    shortName: 'BTC/USDT',
    price: 65867.66,
    changePct: -1.42,
    high24h: 67210.0,
    low24h: 64980.0,
  },
  {
    symbol: 'ETHUSDT',
    tvSymbol: 'BINANCE:ETHUSDT',
    label: 'ETH / USDT',
    shortName: 'ETH/USDT',
    price: 1835.4,
    changePct: -2.18,
    high24h: 1912.0,
    low24h: 1805.0,
  },
  {
    symbol: 'SOLUSDT',
    tvSymbol: 'BINANCE:SOLUSDT',
    label: 'SOL / USDT',
    shortName: 'SOL/USDT',
    price: 72.45,
    changePct: 1.64,
    high24h: 74.8,
    low24h: 70.1,
  },
  {
    symbol: 'BNBUSDT',
    tvSymbol: 'BINANCE:BNBUSDT',
    label: 'BNB / USDT',
    shortName: 'BNB/USDT',
    price: 598.4,
    changePct: 0.92,
    high24h: 612.0,
    low24h: 584.5,
  },
  {
    symbol: 'XRPUSDT',
    tvSymbol: 'BINANCE:XRPUSDT',
    label: 'XRP / USDT',
    shortName: 'XRP/USDT',
    price: 0.6845,
    changePct: 2.34,
    high24h: 0.701,
    low24h: 0.652,
  },
  {
    symbol: 'DOGEUSDT',
    tvSymbol: 'BINANCE:DOGEUSDT',
    label: 'DOGE / USDT',
    shortName: 'DOGE/USDT',
    price: 0.1842,
    changePct: 3.15,
    high24h: 0.192,
    low24h: 0.174,
  },
  {
    symbol: 'ADAUSDT',
    tvSymbol: 'BINANCE:ADAUSDT',
    label: 'ADA / USDT',
    shortName: 'ADA/USDT',
    price: 0.462,
    changePct: -0.84,
    high24h: 0.478,
    low24h: 0.451,
  },
  {
    symbol: 'AVAXUSDT',
    tvSymbol: 'BINANCE:AVAXUSDT',
    label: 'AVAX / USDT',
    shortName: 'AVAX/USDT',
    price: 24.85,
    changePct: 1.48,
    high24h: 25.9,
    low24h: 23.9,
  },
  {
    symbol: 'LINKUSDT',
    tvSymbol: 'BINANCE:LINKUSDT',
    label: 'LINK / USDT',
    shortName: 'LINK/USDT',
    price: 13.72,
    changePct: 0.76,
    high24h: 14.2,
    low24h: 13.15,
  },
  {
    symbol: 'TONUSDT',
    tvSymbol: 'BINANCE:TONUSDT',
    label: 'TON / USDT',
    shortName: 'TON/USDT',
    price: 4.825,
    changePct: 1.12,
    high24h: 4.98,
    low24h: 4.68,
  },
  {
    symbol: 'GOLD',
    tvSymbol: 'BINANCE:PAXGUSDT',
    label: 'GOLD (XAU)',
    shortName: 'XAU/USD',
    price: 4135.61,
    changePct: 0.38,
    high24h: 4158.0,
    low24h: 4112.0,
  },
  {
    symbol: 'USOIL',
    tvSymbol: 'TVC:USOIL',
    label: 'WTI / USD',
    shortName: 'WTI/USD',
    price: 89.97,
    changePct: -0.22,
    high24h: 91.1,
    low24h: 88.85,
  },
];

export function createDefaultAdminCoins(nowMs = Date.now()): AdminManagedCoin[] {
  return [
    {
      symbol: 'XUUSDT',
      label: 'XU / USDT',
      shortName: 'XU/USDT',
      basePrice: 100.0,
      targetPrice: 100.0,
      currentPrice: 100.0,
      openPrice24h: 98.5,
      changePct: 1.52,
      high24h: 102.4,
      low24h: 97.1,
      enabled: true,
      schedule: null,
      updatedAtMs: nowMs,
    },
  ];
}

export const DEFAULT_ADMIN_COINS: AdminManagedCoin[] = createDefaultAdminCoins();

export function mergeBuiltInAndCustomQuotes(
  builtIn: MarketQuote[],
  customCoins: AdminManagedCoin[]
): MarketQuote[] {
  const customQuotes: MarketQuote[] = customCoins
    .filter((c) => c.enabled)
    .map((c) => ({
      symbol: c.symbol,
      tvSymbol: `CUSTOM:${c.symbol}`,
      label: c.label,
      shortName: c.shortName,
      price: Number(c.currentPrice),
      changePct: Number(c.changePct),
      high24h: Number(c.high24h),
      low24h: Number(c.low24h),
      isCustom: true,
    }));
  if (builtIn.length === 0) return customQuotes;
  return [builtIn[0], ...customQuotes, ...builtIn.slice(1)];
}

export const DEFAULT_FAQ: FaqEntry[] = [
  {
    q: 'How do I get started with Zectrade Pulse?',
    a: 'Register with your email or launch the instant Demo Workspace to trade with $100,000 virtual capital and join Lottery Live Red/Green prediction rounds.',
  },
  {
    q: 'What payment gateways are supported for Real Accounts?',
    a: 'KBZPay (KPay), WavePay, Bank Transfers, and USDT TRC20 wallets are supported with 4-digit PIN authorization.',
  },
  {
    q: 'How does Lottery Live Red/Green trading work?',
    a: 'Select Green or Red before the final 5-second countdown lock. A 0.12% platform fee per bet and exact 2x net payouts are displayed before you confirm.',
  },
  {
    q: 'What leverage tiers and trading fees apply?',
    a: 'Spot (1x) and Futures Leverage (5x–100x) are supported with a 0.18% open fee and a 0.18% close fee per trade.',
  },
];

export const DEFAULT_DESCRIPTION =
  'Zectrade Pulse is a multi-asset trading and live prediction workspace combining Spot (1x) & Futures Leverage (5x–100x) across BTC, ETH, SOL, Gold (XAU), and WTI Crude Oil, resettable $100k Demo practice, live market news, Lottery Live prediction rounds, and PIN-secured settlement. Trading carries risk of loss; no profit is guaranteed.';

export const DEFAULT_DEPOSIT_ACCOUNTS: DepositAccounts = {
  kpay: { name: 'Zectrade Official', number: '09789123456' },
  wavepay: { name: 'Zectrade Agent', number: '09987654321' },
  usdt: { name: 'TRC20 Wallet', number: 'TX982353835ks839209485732' },
  btc: { name: 'Bitcoin Network', number: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh' },
};

export const SEED_FEED: LiveFeedItem[] = [
  { id: 'f1', type: 'WITHDRAWAL', method: 'KBZPay', amount: 850, user: '097***841', time: 'Just now' },
  { id: 'f2', type: 'DEPOSIT', method: 'WavePay', amount: 300, user: '099***120', time: '1 min ago' },
  { id: 'f3', type: 'WITHDRAWAL', method: 'USDT TRC20', amount: 980, user: '0x8f...e3a', time: '2 mins ago' },
  { id: 'f4', type: 'DEPOSIT', method: 'KBZPay', amount: 150, user: '094***559', time: '3 mins ago' },
];

export const DEMO_USER_TEMPLATE: UserProfile = {
  uid: 'DEMO-ZEC-8841',
  isLoggedIn: true,
  isLocalDemoSession: true,
  username: 'Demo Trader',
  email: 'demo@zectrade.local',
  pin: '1234',
  role: 'user',
  isBlocked: false,
  isWithdrawBlocked: false,
  invitedBy: null,
  hasDepositedBefore: false,
  hasTradedAfterDeposit: false,
  withdrawLockClearedByAdmin: false,
  demoBalance: 100000,
  realBalance: FIRST_REGISTER_REAL_BONUS_USD,
  spotHoldings: {},
  avatarUrl: null,
  fullName: null,
  phone: null,
  country: null,
  bio: null,
  withdrawMethod: 'kpay',
  withdrawAccountName: null,
  withdrawAccountNumber: null,
};

export const SEED_MANAGED_MEMBERS: ManagedMember[] = [
  {
    uid: 'ADMIN-ZEC-0001',
    username: 'Lead Admin',
    email: 'admin@zectrade.io',
    role: 'admin',
    isBlocked: false,
    isWithdrawBlocked: false,
    hasDepositedBefore: true,
    hasTradedAfterDeposit: true,
    withdrawLockClearedByAdmin: true,
    realBalance: 25000.0,
    demoBalance: 100000,
    securityPin: '8888',
    fullName: 'Lead Platform Administrator',
    phone: '+95 9789 000 001',
    country: 'Singapore',
    bio: 'Zectrade Pulse Operations Lead',
    withdrawMethod: 'kpay',
    withdrawAccountName: 'Zectrade Treasury',
    withdrawAccountNumber: '09789123456',
  },
  {
    uid: 'USR-9012',
    username: 'Aung Kyaw',
    email: 'aung.kyaw@zectrade.io',
    role: 'user',
    isBlocked: false,
    isWithdrawBlocked: false,
    hasDepositedBefore: false,
    hasTradedAfterDeposit: false,
    withdrawLockClearedByAdmin: false,
    realBalance: 2.0,
    demoBalance: 98500,
    securityPin: '1234',
    fullName: 'Aung Kyaw Moe',
    phone: '09789445566',
    country: 'Yangon, Myanmar',
    bio: 'Spot & Futures Trader',
    withdrawMethod: 'kpay',
    withdrawAccountName: 'Aung Kyaw Moe',
    withdrawAccountNumber: '09789445566',
  },
  {
    uid: 'USR-4418',
    username: 'Su Myat',
    email: 'sumyat@zectrade.io',
    role: 'user',
    isBlocked: false,
    isWithdrawBlocked: false,
    hasDepositedBefore: true,
    hasTradedAfterDeposit: false,
    withdrawLockClearedByAdmin: false,
    realBalance: 1120.0,
    demoBalance: 100000,
    securityPin: '4321',
    fullName: 'Su Myat Noe',
    phone: '09988223344',
    country: 'Mandalay, Myanmar',
    bio: 'Gold & Crypto Trader',
    withdrawMethod: 'wavepay',
    withdrawAccountName: 'Su Myat Noe',
    withdrawAccountNumber: '09988223344',
  },
  {
    uid: 'USR-7731',
    username: 'Marcus Chen',
    email: 'marcus.c@zectrade.io',
    role: 'staff',
    isBlocked: false,
    isWithdrawBlocked: false,
    hasDepositedBefore: true,
    hasTradedAfterDeposit: true,
    withdrawLockClearedByAdmin: false,
    realBalance: 8900.0,
    demoBalance: 120000,
    securityPin: '7777',
    fullName: 'Marcus Chen',
    phone: '+65 8123 4567',
    country: 'Singapore',
    bio: 'Senior Desk Operator',
    withdrawMethod: 'usdt',
    withdrawAccountName: 'Marcus Chen',
    withdrawAccountNumber: 'TX982353835ks839209485732',
  },
];

export function createDefaultNewsArticles(nowMs = Date.now()): NewsArticle[] {
  const hour = 60 * 60 * 1000;
  return [
    {
      id: 1,
      slug: 'global-liquidity-flows-tighten-central-bank-policy-week',
      title: 'Global Liquidity Flows Steady Ahead of Central Bank Policy Decisions',
      summary:
        'Treasury yields hold near recent corridors as institutional desks rebalance cross-asset exposure across dollar indices, sovereign bonds, and major crypto pairs.',
      content: [
        'Institutional trading desks entered the weekly session with disciplined positioning ahead of major central bank policy announcements and updated forward guidance on benchmark overnight rates.',
        'Order-book liquidity across primary dollar crosses and sovereign yield benchmarks remained concentrated within tight intraday bands, signaling cautious risk deployment rather than aggressive directional liquidation.',
        'Cross-asset desks report that macro funds have paired selective long duration exposure with hedged perpetual futures positions in Bitcoin and Ethereum to insulate portfolios against headline rate surprises.',
        'Traders monitoring intraday volatility should watch Treasury auction demand metrics and London-New York session overlap spreads, where institutional block execution typically sets the directional tone for the remainder of the week.',
      ].join('\n\n'),
      category: 'Macro & Rates',
      authorName: 'Elena Vance · Macro Strategy',
      imageUrl: '/src/assets/images/news_lead_macro_1794937556483.jpg',
      isFeatured: true,
      isPublished: true,
      readTimeMin: 3,
      publishedAtMs: nowMs - 1 * hour,
      updatedAtMs: nowMs - 1 * hour,
    },
    {
      id: 2,
      slug: 'institutional-spot-desk-volumes-expand-btc-eth-perpetuals',
      title: 'Institutional Spot Volumes Expand Across BTC and ETH Perpetual Venues',
      summary:
        'Balanced funding rates and deeper resting bid liquidity point to constructive accumulation rather than over-leveraged retail chasing.',
      content: [
        'Spot-to-perpetual volume ratios improved markedly over the past 48 hours as market makers tightened top-of-book spreads on flagship Bitcoin and Ethereum pairs.',
        'Unlike previous speculative rallies marked by steeply positive perpetual funding, current derivatives pricing reflects measured two-way hedging and healthy open-interest turnover.',
        'Analysts note that sustained spot inflows during Asia and European market opens continue to anchor support zones while reducing forced liquidation cascades during brief pullbacks.',
      ].join('\n\n'),
      category: 'Crypto',
      authorName: 'Marcus Chen · Digital Assets Desk',
      imageUrl: '/src/assets/images/news_crypto_liquidity_1794937557683.jpg',
      isFeatured: false,
      isPublished: true,
      readTimeMin: 3,
      publishedAtMs: nowMs - 3 * hour,
      updatedAtMs: nowMs - 3 * hour,
    },
    {
      id: 3,
      slug: 'gold-bullion-holds-structural-support-energy-routes-shift',
      title: 'Gold Bullion Holds Structural Support as Crude Markets Track Maritime Flows',
      summary:
        'Physical reserve demand underpins precious metals while refinery margin spreads and freight schedules keep WTI crude pricing responsive.',
      content: [
        'Spot gold continues to attract defensive allocation from multi-asset portfolios seeking protection against sovereign fiscal expansion and currency valuation swings.',
        'Across energy desks, West Texas Intermediate (WTI) crude futures traded within an active range as traders balanced seasonal refinery maintenance schedules against shifting global tanker routing metrics.',
        'Commodity strategists emphasize watching inventory drawdowns alongside dollar index momentum to gauge whether bullion breaks above upper resistance or consolidates near weekly VWAP.',
      ].join('\n\n'),
      category: 'Commodities',
      authorName: 'David Okafor · Commodities Desk',
      imageUrl: '/src/assets/images/news_commodities_desk_1794937558337.jpg',
      isFeatured: false,
      isPublished: true,
      readTimeMin: 3,
      publishedAtMs: nowMs - 6 * hour,
      updatedAtMs: nowMs - 6 * hour,
    },
    {
      id: 4,
      slug: 'solana-layer1-open-interest-rebalances-spot-rotation',
      title: 'Solana and Layer-1 Open Interest Rebalances After Spot Rotation',
      summary:
        'Derivatives positioning resets to neutral leverage multiples following sharp intraday rotation across high-throughput ecosystems.',
      content: [
        'Major Layer-1 digital assets experienced constructive deleveraging overnight as short-term momentum accounts locked in gains and spot buyers stepped in along key 15-minute moving averages.',
        'Lower aggregate leverage across SOL, BNB, and AVAX markets reduces tail-risk sensitivity and sets a cleaner foundation for technical trend continuation.',
      ].join('\n\n'),
      category: 'Market Brief',
      authorName: 'Zectrade Research Desk',
      imageUrl: null,
      isFeatured: false,
      isPublished: true,
      readTimeMin: 2,
      publishedAtMs: nowMs - 11 * hour,
      updatedAtMs: nowMs - 11 * hour,
    },
    {
      id: 5,
      slug: 'zectrade-realtime-pnl-analytics-and-withdraw-transparency',
      title: 'Platform Notice: Real-Time Asset PnL Analytics & MMK Rate Transparency Live',
      summary:
        'Traders can now inspect per-asset cumulative PnL growth in real time inside Markets and verify live USD/MMK payout conversion rates before submitting requests.',
      content: [
        'Zectrade Pulse has deployed our latest trading analytics upgrade inside the Markets workspace, enabling members to monitor closed trade performance alongside live open mark-to-market PnL for each selected pair.',
        'In addition, the Withdrawal panel now surfaces live USD-to-MMK exchange rates and maximum payout previews automatically whenever local MMK payout channels are selected.',
        'All market dispatches and operational announcements published on the News Desk are curated directly by platform leadership to ensure verified, timely updates.',
      ].join('\n\n'),
      category: 'Platform Update',
      authorName: 'Zectrade Operations',
      imageUrl: null,
      isFeatured: false,
      isPublished: true,
      readTimeMin: 2,
      publishedAtMs: nowMs - 18 * hour,
      updatedAtMs: nowMs - 18 * hour,
    },
  ];
}

export const DEFAULT_NEWS_ARTICLES: NewsArticle[] = createDefaultNewsArticles();

export const DEFAULT_LOTTERY_CONFIG: LotteryConfig = {
  roundDurationSec: 60,
  lockSeconds: 5,
  feePct: DEFAULT_LOTTERY_FEE_PCT,
  payoutMultiplier: 2,
  numberMultiplier: 9,
  resultMode: 'auto_balance',
  forcedResult: null,
  forcedNumber: null,
  isPaused: false,
  accumulatedProfit: 0,
};

export interface StoredLotteryRound extends Omit<LotteryRoundSummary, 'remainingSec' | 'isLocked' | 'isPaused'> {
  pausedRemainingMs?: number | null;
}

export interface StoredDigitDraw extends Omit<DigitLotteryDrawSummary, 'remainingSec' | 'isLocked'> {}

export interface LotteryStorageState {
  config: LotteryConfig;
  rounds: StoredLotteryRound[];
  bets: LotteryBetRecord[];
  digitDraws: StoredDigitDraw[];
  digitBets: DigitLotteryBetRecord[];
  updatedAtMs: number;
}

export function buildLotteryRoundCode(roundNumber: number, nowMs = Date.now()): string {
  const dt = new Date(nowMs);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `#${y}${m}${d}-${String(roundNumber).padStart(4, '0')}`;
}

export function defaultDigitMultiplierForGame(gameType: LotteryDigitGameType): number {
  if (gameType === '2D') return 80;
  if (gameType === '3D') return 500;
  return 10000;
}

export function defaultDigitOffsetMsForGame(gameType: LotteryDigitGameType): number {
  if (gameType === '2D') return 10 * 60_000;
  if (gameType === '3D') return 30 * 60_000;
  return 60 * 60_000;
}

export function createInitialLotteryStorageState(nowMs = Date.now()): LotteryStorageState {
  const seedColors: LotteryColor[] = [
    'green',
    'red',
    'green',
    'green',
    'red',
    'green',
    'red',
    'green',
  ];

  const rounds: StoredLotteryRound[] = seedColors.map((winColor, i) => {
    const rn = i + 1;
    const startMs = nowMs - (seedColors.length - i + 1) * 60_000;
    const endMs = startMs + 60_000;
    const code = buildLotteryRoundCode(rn, endMs);
    return {
      roundNumber: rn,
      roundCode: code,
      durationSec: 60,
      startedAtMs: startMs,
      endsAtMs: endMs,
      pausedRemainingMs: null,
      status: 'SETTLED',
      resultMode: 'auto_balance',
      forcedResult: null,
      forcedNumber: null,
      winningColor: winColor,
      winningNumber: deriveLotteryDrawNumber(code, winColor),
      greenTotal: winColor === 'green' ? 120 : 280,
      redTotal: winColor === 'red' ? 140 : 320,
      greenCount: 2,
      redCount: 3,
      totalFees: 40,
      totalPayouts: 216,
      houseProfit: 184,
      settledAtMs: endMs,
    };
  });

  const openNum = seedColors.length + 1;
  const durationSec = DEFAULT_LOTTERY_CONFIG.roundDurationSec;
  rounds.push({
    roundNumber: openNum,
    roundCode: buildLotteryRoundCode(openNum, nowMs),
    durationSec,
    startedAtMs: nowMs,
    endsAtMs: nowMs + durationSec * 1000,
    pausedRemainingMs: null,
    status: 'OPEN',
    resultMode: DEFAULT_LOTTERY_CONFIG.resultMode,
    forcedResult: null,
    forcedNumber: null,
    winningColor: null,
    winningNumber: null,
    greenTotal: 0,
    redTotal: 0,
    greenCount: 0,
    redCount: 0,
    totalFees: 0,
    totalPayouts: 0,
    houseProfit: 0,
    settledAtMs: null,
  });

  const dt = new Date(nowMs);
  const ymd = `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, '0')}${String(
    dt.getUTCDate()
  ).padStart(2, '0')}`;

  const games: LotteryDigitGameType[] = ['2D', '3D', '6D'];
  const digitDraws: StoredDigitDraw[] = [];

  for (const gameType of games) {
    digitDraws.push({
      drawUid: `${gameType}-${ymd}-0002`,
      gameType,
      drawLabel: `${gameType} Scheduled Official Draw`,
      scheduledReleaseAtMs: nowMs + defaultDigitOffsetMsForGame(gameType),
      lockBeforeSec: 10,
      payoutMultiplier: defaultDigitMultiplierForGame(gameType),
      feePct: DEFAULT_LOTTERY_FEE_PCT,
      manualResult: null,
      winningNumber: null,
      status: 'SCHEDULED',
      totalStake: 0,
      totalPayouts: 0,
      betCount: 0,
      releasedAtMs: null,
    });

    const pastMs = nowMs - 15 * 60_000;
    const sampleResult = gameType === '2D' ? '48' : gameType === '3D' ? '729' : '482915';
    digitDraws.push({
      drawUid: `${gameType}-${ymd}-0001`,
      gameType,
      drawLabel: `${gameType} Previous Draw`,
      scheduledReleaseAtMs: pastMs,
      lockBeforeSec: 10,
      payoutMultiplier: defaultDigitMultiplierForGame(gameType),
      feePct: DEFAULT_LOTTERY_FEE_PCT,
      manualResult: sampleResult,
      winningNumber: sampleResult,
      status: 'RELEASED',
      totalStake: 0,
      totalPayouts: 0,
      betCount: 0,
      releasedAtMs: pastMs,
    });
  }

  return {
    config: { ...DEFAULT_LOTTERY_CONFIG },
    rounds,
    bets: [],
    digitDraws,
    digitBets: [],
    updatedAtMs: nowMs,
  };
}
