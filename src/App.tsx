import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { X } from 'lucide-react';
import { AuthLanding } from './components/AuthLanding';
import type { DigitDrawSchedulePayload } from './components/LotteryAdminConsole';
import { LotteryLiveWorkspace } from './components/LotteryLiveWorkspace';
import { MobileBottomNav } from './components/MobileBottomNav';
import {
  DepositModal,
  ModifyOrderModal,
  PinModal,
  ProfileEditModal,
  StaffControlModal,
  SwapModal,
  TradeHistoryModal,
  TransferModal,
  WalletHistoryModal,
  WithdrawModal,
  type MemberProfileUpdatePayload,
  type VerifiedTransferRecipient,
} from './components/Modals';
import { NewsWorkspace } from './components/NewsWorkspace';
import { TopBar } from './components/TopBar';
import { TradingWorkspace } from './components/TradingWorkspace';
import { WalletWorkspace } from './components/WalletWorkspace';
import {
  deduplicateFirestoreAgainstSql,
  mergeWalletTransactionsWithServerActivity,
  type ServerWalletActivityRow,
} from './utils/depositHistory';
import { auth, db, googleAuthProvider, oauthAuth } from './services/firebaseClient';
import type {
  AccountMode,
  AdminManagedCoin,
  AlertCondition,
  AppSection,
  CoinScheduleMode,
  CoinTradeAnalytics,
  DepositAccounts,
  FaqEntry,
  LiveFeedItem,
  LotteryBetType,
  LotteryColor,
  LotteryLiveState,
  LotteryResultMode,
  ManagedMember,
  MarketQuote,
  MarketSymbol,
  NewsArticle,
  NewsCategory,
  OrderSide,
  PlatformStats,
  Position,
  PreOrder,
  PriceAlert,
  StaffTabId,
  StaffWalletRequest,
  ToastMessage,
  TradeHistoryItem,
  UserProfile,
  UserRole,
  WalletTransaction,
  WithdrawMethod,
} from './types';
import {
  FIRST_REGISTER_REAL_BONUS_USD,
  calculateCloseSettlement,
  calculatePositionPreview,
  calculateSpotSwap,
  calculateUnrealizedPnl,
  canClearWithdrawLock,
  checkOrderDirectionConflict,
  evaluatePositionAutoClose,
  evaluateWithdrawalEligibility,
  getNumericLiqPrice,
  shouldTriggerPreOrder,
  shouldTriggerPriceAlert,
  validateSlTpTargets,
} from './utils/tradingEngine';

const INITIAL_QUOTES: MarketQuote[] = [
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

const DEFAULT_FAQ: FaqEntry[] = [
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

const DEFAULT_DESCRIPTION =
  'Zectrade Pulse combines low-latency multi-asset spot & futures execution across BTC, ETH, SOL, Gold (XAU), and WTI Crude with real-time Red/Green Lottery Live prediction rounds engineered for mobile and desktop.';

const DEFAULT_DEPOSIT_ACCOUNTS: DepositAccounts = {
  kpay: { name: 'Zectrade Official', number: '09789123456' },
  wavepay: { name: 'Zectrade Agent', number: '09987654321' },
  usdt: { name: 'TRC20 Wallet', number: 'TX982353835ks839209485732' },
  btc: { name: 'Bitcoin Network', number: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh' },
};

const SEED_FEED: LiveFeedItem[] = [
  { id: 'f1', type: 'WITHDRAWAL', method: 'KBZPay', amount: 850, user: '097***841', time: 'Just now' },
  { id: 'f2', type: 'DEPOSIT', method: 'WavePay', amount: 300, user: '099***120', time: '1 min ago' },
  { id: 'f3', type: 'WITHDRAWAL', method: 'USDT TRC20', amount: 980, user: '0x8f...e3a', time: '2 mins ago' },
  { id: 'f4', type: 'DEPOSIT', method: 'KBZPay', amount: 150, user: '094***559', time: '3 mins ago' },
];

const DEMO_USER_TEMPLATE: UserProfile = {
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

const SEED_MANAGED_MEMBERS: ManagedMember[] = [
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
    securityPin: '8888',
    fullName: 'Marcus Chen',
    phone: '+65 8123 4567',
    country: 'Singapore',
    bio: 'Senior Desk Operator',
    withdrawMethod: 'usdt',
    withdrawAccountName: 'Marcus Chen',
    withdrawAccountNumber: 'TX982353835ks839209485732',
  },
];

const STORAGE_KEY = 'zectrade_pulse_workspace_v1';

export default function App() {
  const [quotes, setQuotes] = useState<MarketQuote[]>(INITIAL_QUOTES);
  const [selectedSymbol, setSelectedSymbol] = useState<MarketSymbol>('BTCUSDT');
  const [activeSection, setActiveSection] = useState<AppSection>('trade');
  const [accountMode, setAccountMode] = useState<AccountMode>('demo');

  const [user, setUser] = useState<UserProfile>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.user?.isLoggedIn) {
          return { ...DEMO_USER_TEMPLATE, ...parsed.user };
        }
      }
    } catch {
      // ignore storage errors
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      return DEMO_USER_TEMPLATE;
    }
    return { ...DEMO_USER_TEMPLATE, isLoggedIn: false };
  });

  const [preOrders, setPreOrders] = useState<PreOrder[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved).preOrders ?? [] : [];
    } catch {
      return [];
    }
  });
  const [activePositions, setActivePositions] = useState<Position[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved).activePositions ?? [] : [];
    } catch {
      return [];
    }
  });
  const [tradeHistory, setTradeHistory] = useState<TradeHistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved).tradeHistory ?? [] : [];
    } catch {
      return [];
    }
  });
  const [walletTransactions, setWalletTransactions] = useState<WalletTransaction[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved).walletTransactions ?? [] : [];
    } catch {
      return [];
    }
  });
  const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved).priceAlerts ?? [] : [];
    } catch {
      return [];
    }
  });
  const [managedMembers, setManagedMembers] = useState<ManagedMember[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved && Array.isArray(JSON.parse(saved).managedMembers)
        ? JSON.parse(saved).managedMembers
        : SEED_MANAGED_MEMBERS;
    } catch {
      return SEED_MANAGED_MEMBERS;
    }
  });

  const [csrTelegramLink, setCsrTelegramLink] = useState('https://t.me/zectrade_csr');
  const [platformStats, setPlatformStats] = useState<PlatformStats>({
    membersCount: 23909,
    totalDeposits: '$42,850,910',
    totalWithdrawals: '$15,240,600',
  });
  const [platformDescription, setPlatformDescription] = useState(DEFAULT_DESCRIPTION);
  const [faqEntries, setFaqEntries] = useState<FaqEntry[]>(DEFAULT_FAQ);
  const [liveFeedItems, setLiveFeedItems] = useState<LiveFeedItem[]>(SEED_FEED);
  const [depositRateMMK, setDepositRateMMK] = useState(4300);
  const [withdrawRateMMK, setWithdrawRateMMK] = useState(4300);
  const [depositAccounts, setDepositAccounts] = useState<DepositAccounts>(DEFAULT_DEPOSIT_ACCOUNTS);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [lotteryState, setLotteryState] = useState<LotteryLiveState | null>(null);
  const [latestLotteryBanner, setLatestLotteryBanner] = useState<{
    roundCode: string;
    winningColor: LotteryColor;
    winningNumber?: number | null;
    userNetProfit: number | null;
    userOutcome: 'WIN' | 'LOSS' | 'NONE';
  } | null>(null);
  const lastSeenSettledRoundRef = useRef<string | null>(null);
  const settledLotteryBetIdsRef = useRef<Set<string>>(new Set());
  const settledDigitBetIdsRef = useRef<Set<string>>(new Set());
  const [pendingDeposits, setPendingDeposits] = useState<StaffWalletRequest[]>([]);
  const [pendingWithdrawals, setPendingWithdrawals] = useState<StaffWalletRequest[]>([]);
  const [staffRequestsLoading, setStaffRequestsLoading] = useState(false);
  const [adminCoins, setAdminCoins] = useState<AdminManagedCoin[]>([]);
  const [selectedCoinAnalytics, setSelectedCoinAnalytics] = useState<CoinTradeAnalytics | null>(null);
  const [coinAnalyticsLoading, setCoinAnalyticsLoading] = useState(false);
  const closingIdsRef = useRef<Set<string>>(new Set());
  const settledIdsRef = useRef<Set<string>>(new Set());
  const pendingWalletDeltasRef = useRef(0);
  const seenSqlTransferIdsRef = useRef<Set<string>>(new Set());
  const initialWalletSyncDoneRef = useRef(false);
  const lastFirestoreSyncedBalRef = useRef<{ uid: string; real: number; demo: number } | null>(null);

  // Modal States
  const [swapModalState, setSwapModalState] = useState<{
    open: boolean;
    symbol?: MarketSymbol;
    direction?: 'usdtToCoin' | 'coinToUsdt';
  }>({ open: false });
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [profileEditModalOpen, setProfileEditModalOpen] = useState(false);
  const [modifyOrderTarget, setModifyOrderTarget] = useState<PreOrder | null>(null);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [walletHistoryModalOpen, setWalletHistoryModalOpen] = useState(false);
  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [staffModalInitialTab, setStaffModalInitialTab] = useState<StaffTabId | undefined>(undefined);
  const [newsArticles, setNewsArticles] = useState<NewsArticle[]>([]);
  const [adminNewsArticles, setAdminNewsArticles] = useState<NewsArticle[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [adminNewsLoading, setAdminNewsLoading] = useState(false);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-2), { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  // Persist local demo state
  useEffect(() => {
    if (!user.isLocalDemoSession) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          user,
          preOrders,
          activePositions,
          tradeHistory,
          walletTransactions,
          priceAlerts,
          managedMembers,
        })
      );
    } catch {
      // ignore storage quota
    }
  }, [user, preOrders, activePositions, tradeHistory, walletTransactions, priceAlerts, managedMembers]);

  // Load Public Settings from Firestore safely
  useEffect(() => {
    const loadPublicSettings = async () => {
      try {
        const [faqSnap, csrSnap, statsSnap, accSnap, rateSnap] = await Promise.all([
          getDoc(doc(db, 'settings', 'faqConfig')),
          getDoc(doc(db, 'settings', 'csrConfig')),
          getDoc(doc(db, 'settings', 'landingStats')),
          getDoc(doc(db, 'settings', 'depositAccounts')),
          getDoc(doc(db, 'settings', 'exchangeRates')),
        ]);
        if (faqSnap.exists()) {
          const d = faqSnap.data();
          if (Array.isArray(d.faqList) && d.faqList.length > 0) setFaqEntries(d.faqList);
          if (d.platformDesc) setPlatformDescription(d.platformDesc);
        }
        if (csrSnap.exists() && csrSnap.data().telegramLink) {
          setCsrTelegramLink(csrSnap.data().telegramLink);
        }
        if (statsSnap.exists()) {
          const d = statsSnap.data();
          setPlatformStats((prev) => ({
            membersCount: d.membersCount ?? prev.membersCount,
            totalDeposits: d.totalDeposits ?? prev.totalDeposits,
            totalWithdrawals: d.totalWithdrawals ?? prev.totalWithdrawals,
          }));
        }
        if (accSnap.exists()) setDepositAccounts(accSnap.data() as DepositAccounts);
        if (rateSnap.exists()) {
          const d = rateSnap.data();
          if (d.depositMMK) setDepositRateMMK(Number(d.depositMMK));
          if (d.withdrawMMK) setWithdrawRateMMK(Number(d.withdrawMMK));
        }
      } catch {
        // Use local defaults cleanly when offline or blocked
      }
    };
    loadPublicSettings();
  }, []);

  const authTokenRef = useRef<string | null>(null);
  authTokenRef.current = authToken;

  const syncWalletFromServer = useCallback(
    async (opts?: { tokenOverride?: string | null; force?: boolean; silent?: boolean }) => {
      const token = opts?.tokenOverride !== undefined ? opts.tokenOverride : authTokenRef.current;
      if (!token) return;
      if (stateRef.current.user.isLocalDemoSession && !opts?.tokenOverride) return;
      if (!opts?.force && pendingWalletDeltasRef.current > 0) return;

      try {
        const res = await fetch('/api/wallet/sync', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const syncData = await res.json();

        const srvReal =
          typeof syncData.realBalance === 'number' ? Number(syncData.realBalance) : undefined;
        const srvDemo =
          typeof syncData.demoBalance === 'number' ? Number(syncData.demoBalance) : undefined;

        setUser((prev) => {
          const nextUser: UserProfile = {
            ...prev,
            realBalance: srvReal !== undefined ? srvReal : prev.realBalance,
            demoBalance: srvDemo !== undefined ? srvDemo : prev.demoBalance,
            pin:
              typeof syncData.securityPin === 'string' && /^\d{4}$/.test(syncData.securityPin)
                ? syncData.securityPin
                : prev.pin,
            hasDepositedBefore:
              typeof syncData.hasDepositedBefore === 'boolean'
                ? syncData.hasDepositedBefore
                : prev.hasDepositedBefore,
            hasTradedAfterDeposit:
              typeof syncData.hasTradedAfterDeposit === 'boolean'
                ? syncData.hasTradedAfterDeposit
                : prev.hasTradedAfterDeposit,
            withdrawLockClearedByAdmin:
              typeof syncData.withdrawLockClearedByAdmin === 'boolean'
                ? syncData.withdrawLockClearedByAdmin
                : prev.withdrawLockClearedByAdmin,
            isWithdrawBlocked:
              typeof syncData.isWithdrawBlocked === 'boolean'
                ? syncData.isWithdrawBlocked
                : prev.isWithdrawBlocked,
            isBlocked:
              typeof syncData.isBlocked === 'boolean' ? syncData.isBlocked : prev.isBlocked,
          };
          stateRef.current.user = nextUser;
          return nextUser;
        });

        // Keep logged-in user's own Firestore doc aligned with authoritative Cloud SQL balance
        if (
          auth.currentUser &&
          auth.currentUser.uid === stateRef.current.user.uid &&
          srvReal !== undefined &&
          srvDemo !== undefined
        ) {
          const prevSynced = lastFirestoreSyncedBalRef.current;
          if (
            !prevSynced ||
            prevSynced.uid !== auth.currentUser.uid ||
            prevSynced.real !== srvReal ||
            prevSynced.demo !== srvDemo
          ) {
            lastFirestoreSyncedBalRef.current = {
              uid: auth.currentUser.uid,
              real: srvReal,
              demo: srvDemo,
            };
            updateDoc(doc(db, 'users', auth.currentUser.uid), {
              realBalance: srvReal,
              demoBalance: srvDemo,
            }).catch(() => {});
          }
        }

        if (Array.isArray(syncData.activity)) {
          const activeUser = stateRef.current.user;
          const serverRows = syncData.activity as ServerWalletActivityRow[];
          const incomingTransfers = serverRows
            .filter((a) => a.requestKind === 'transfer_in')
            .map((a) => ({
              id: `sql-${a.id}`,
              amount: Number(a.amountUsd || 0),
              target: a.target,
              type: a.typeLabel,
            }));

          const newIncoming = incomingTransfers.filter(
            (tx) =>
              tx.type.includes('RECEIVED') && !seenSqlTransferIdsRef.current.has(tx.id)
          );
          if (initialWalletSyncDoneRef.current && newIncoming.length > 0) {
            for (const inc of newIncoming) {
              showToast(`Received $${inc.amount.toFixed(2)} transfer (${inc.target})!`);
            }
          }
          for (const row of serverRows) {
            seenSqlTransferIdsRef.current.add(`sql-${row.id}`);
          }
          initialWalletSyncDoneRef.current = true;

          setWalletTransactions((prev) =>
            mergeWalletTransactionsWithServerActivity(prev, serverRows, {
              uid: activeUser.uid,
              email: activeUser.email,
            })
          );
        }
      } catch {
        // Keep current state cleanly on transient network issues
      }
    },
    [showToast]
  );

  const applyWalletDeltaOnServer = useCallback(
    async (
      wallet: 'real' | 'demo',
      delta: number,
      markTradedAfterDeposit = false
    ) => {
      const token = authTokenRef.current;
      if (!token || stateRef.current.user.isLocalDemoSession) return;
      if (!Number.isFinite(delta) || (delta === 0 && !markTradedAfterDeposit)) return;

      pendingWalletDeltasRef.current += 1;
      try {
        const res = await fetch('/api/wallet/delta', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ wallet, delta, markTradedAfterDeposit }),
        });
        if (!res.ok) return;
        const data = await res.json();
        setUser((prev) => {
          const nextUser: UserProfile = {
            ...prev,
            realBalance:
              typeof data.realBalance === 'number' ? data.realBalance : prev.realBalance,
            demoBalance:
              typeof data.demoBalance === 'number' ? data.demoBalance : prev.demoBalance,
            hasDepositedBefore:
              typeof data.hasDepositedBefore === 'boolean'
                ? data.hasDepositedBefore
                : prev.hasDepositedBefore,
            hasTradedAfterDeposit:
              typeof data.hasTradedAfterDeposit === 'boolean'
                ? data.hasTradedAfterDeposit
                : prev.hasTradedAfterDeposit,
            withdrawLockClearedByAdmin:
              typeof data.withdrawLockClearedByAdmin === 'boolean'
                ? data.withdrawLockClearedByAdmin
                : prev.withdrawLockClearedByAdmin,
          };
          stateRef.current.user = nextUser;
          return nextUser;
        });
      } catch {
        // Keep optimistic UI state on transient failure
      } finally {
        pendingWalletDeltasRef.current = Math.max(0, pendingWalletDeltasRef.current - 1);
      }
    },
    []
  );

  // Firebase Auth listener
  useEffect(() => {
    let unsubUser: (() => void) | null = null;
    let unsubPos: (() => void) | null = null;
    let unsubOrd: (() => void) | null = null;
    let unsubTx: (() => void) | null = null;

    const handleFirebaseUser = async (fbUser: import('firebase/auth').User | null) => {
      if (unsubUser) unsubUser();
      if (unsubPos) unsubPos();
      if (unsubOrd) unsubOrd();
      if (unsubTx) unsubTx();

      if (!fbUser) return;

      try {
        seenSqlTransferIdsRef.current.clear();
        initialWalletSyncDoneRef.current = false;
        const idToken = await fbUser.getIdToken();
        setAuthToken(idToken);
        authTokenRef.current = idToken;

        let syncedRole: UserRole = 'user';
        let syncedServerUser: Record<string, unknown> | null = null;
        try {
          const sessionRes = await fetch('/api/auth/session', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({ username: fbUser.displayName || fbUser.email?.split('@')[0] }),
          });
          if (sessionRes.ok) {
            const sessionData = await sessionRes.json();
            if (sessionData?.user) {
              syncedServerUser = sessionData.user as Record<string, unknown>;
              if (sessionData.user.role) {
                syncedRole = sessionData.user.role as UserRole;
              }
            }
          }
        } catch {
          // Graceful fallback if offline
        }

        const userRef = doc(db, 'users', fbUser.uid);
        const snap = await getDoc(userRef);
        const data = snap.exists() ? snap.data() : {};
        if (data.isBlocked || syncedServerUser?.isBlocked) {
          await signOut(auth).catch(() => {});
          await signOut(oauthAuth).catch(() => {});
          setAuthToken(null);
          showToast('Your account is currently restricted. Please contact support.', 'error');
          return;
        }

        const effectiveRole = (
          syncedRole === 'admin' || data.role === 'admin'
            ? 'admin'
            : (syncedRole || (data.role as UserRole) || 'user')
        ) as UserRole;

        const initialReal = Number(
          syncedServerUser?.realBalance ?? data.realBalance ?? FIRST_REGISTER_REAL_BONUS_USD
        );
        const initialDemo = Number(syncedServerUser?.demoBalance ?? data.demoBalance ?? 100000);

        setUser({
          uid: fbUser.uid,
          isLoggedIn: true,
          isLocalDemoSession: false,
          username: String(
            syncedServerUser?.username || data.username || fbUser.displayName || fbUser.email?.split('@')[0] || 'Trader'
          ),
          email: String(syncedServerUser?.email || fbUser.email || ''),
          pin: String(syncedServerUser?.securityPin || data.securityPin || '1234'),
          role: effectiveRole,
          isBlocked: !!(syncedServerUser?.isBlocked ?? data.isBlocked),
          isWithdrawBlocked: !!(syncedServerUser?.isWithdrawBlocked ?? data.isWithdrawBlocked),
          invitedBy: data.invitedBy || null,
          hasDepositedBefore: !!(syncedServerUser?.hasDepositedBefore ?? data.hasDepositedBefore),
          hasTradedAfterDeposit: !!(syncedServerUser?.hasTradedAfterDeposit ?? data.hasTradedAfterDeposit),
          withdrawLockClearedByAdmin: !!(syncedServerUser?.withdrawLockClearedByAdmin ?? data.withdrawLockClearedByAdmin),
          demoBalance: initialDemo,
          realBalance: initialReal,
          spotHoldings: data.spotHoldings || {},
          avatarUrl: (syncedServerUser?.avatarUrl as string | null | undefined) ?? data.avatarUrl ?? null,
          fullName: (syncedServerUser?.fullName as string | null | undefined) ?? data.fullName ?? null,
          phone: (syncedServerUser?.phone as string | null | undefined) ?? data.phone ?? null,
          country: (syncedServerUser?.country as string | null | undefined) ?? data.country ?? null,
          bio: (syncedServerUser?.bio as string | null | undefined) ?? data.bio ?? null,
          withdrawMethod: ((syncedServerUser?.withdrawMethod || data.withdrawMethod || 'kpay') as WithdrawMethod),
          withdrawAccountName:
            (syncedServerUser?.withdrawAccountName as string | null | undefined) ?? data.withdrawAccountName ?? null,
          withdrawAccountNumber:
            (syncedServerUser?.withdrawAccountNumber as string | null | undefined) ?? data.withdrawAccountNumber ?? null,
        });

        // Heal stale Firestore balance/eligibility fields from authoritative Cloud SQL on login
        if (syncedServerUser) {
          lastFirestoreSyncedBalRef.current = {
            uid: fbUser.uid,
            real: initialReal,
            demo: initialDemo,
          };
          if (
            Number(data.realBalance ?? 0) !== initialReal ||
            Number(data.demoBalance ?? 100000) !== initialDemo
          ) {
            updateDoc(userRef, {
              realBalance: initialReal,
              demoBalance: initialDemo,
            }).catch(() => {});
          }
        }

        unsubUser = onSnapshot(userRef, (dSnap) => {
          if (!dSnap.exists()) return;
          const d = dSnap.data();
          // Keep profile/holdings synced without overwriting authoritative Cloud SQL balances or withdraw lock state
          setUser((prev) => ({
            ...prev,
            username: d.username ?? prev.username,
            role: (d.role as UserRole) || prev.role,
            spotHoldings: d.spotHoldings || {},
            avatarUrl: d.avatarUrl !== undefined ? d.avatarUrl : prev.avatarUrl,
            fullName: d.fullName !== undefined ? d.fullName : prev.fullName,
            phone: d.phone !== undefined ? d.phone : prev.phone,
            country: d.country !== undefined ? d.country : prev.country,
            bio: d.bio !== undefined ? d.bio : prev.bio,
            withdrawMethod: (d.withdrawMethod as WithdrawMethod | undefined) ?? prev.withdrawMethod,
            withdrawAccountName:
              d.withdrawAccountName !== undefined ? d.withdrawAccountName : prev.withdrawAccountName,
            withdrawAccountNumber:
              d.withdrawAccountNumber !== undefined ? d.withdrawAccountNumber : prev.withdrawAccountNumber,
          }));
        });

        unsubPos = onSnapshot(collection(db, 'users', fbUser.uid, 'positions'), (qSnap) => {
          setActivePositions(
            qSnap.docs
              .filter((d) => !settledIdsRef.current.has(d.id))
              .map((d) => ({ id: d.id, ...d.data() } as Position))
          );
        });

        unsubOrd = onSnapshot(collection(db, 'users', fbUser.uid, 'orders'), (qSnap) => {
          setPreOrders(qSnap.docs.map((d) => ({ id: d.id, ...d.data() } as PreOrder)));
        });

        unsubTx = onSnapshot(collection(db, 'users', fbUser.uid, 'transactions'), (qSnap) => {
          const list: WalletTransaction[] = qSnap.docs.map((d) => {
            const raw = d.data();
            const dt = raw.createdAt?.toDate ? raw.createdAt.toDate() : new Date();
            return {
              id: d.id,
              type: raw.type || 'TX',
              amount: Number(raw.amount || 0),
              target: raw.target || 'System Wallet',
              isAdjustment: Boolean(raw.isAdjustment),
              status: raw.status || 'PENDING',
              rejectReason: raw.rejectReason || null,
              rawTime: dt.getTime(),
              timestamp: dt.toLocaleString(),
            };
          });
          setWalletTransactions((prev) => {
            const sqlEntries = prev.filter((t) => t.id.startsWith('sql-'));
            return deduplicateFirestoreAgainstSql(sqlEntries, list);
          });
        });

        // Immediately sync wallet balance + Cloud SQL transfer history
        await syncWalletFromServer({ tokenOverride: idToken, force: true, silent: true });
      } catch {
        // Ignore Firestore read errors gracefully
      }
    };

    const unsubAuth = onAuthStateChanged(auth, handleFirebaseUser);
    const unsubOAuth = onAuthStateChanged(oauthAuth, handleFirebaseUser);

    return () => {
      unsubAuth();
      unsubOAuth();
      if (unsubUser) unsubUser();
      if (unsubPos) unsubPos();
      if (unsubOrd) unsubOrd();
      if (unsubTx) unsubTx();
    };
  }, [showToast, syncWalletFromServer]);

  // Poll authoritative wallet state every 4s so live incoming P2P transfers & approvals deliver automatically
  useEffect(() => {
    if (!user.isLoggedIn || user.isLocalDemoSession || !authToken) return;
    if (activeSection === 'profile') {
      syncWalletFromServer({ force: true, silent: true });
    }
    const id = setInterval(() => {
      syncWalletFromServer({ silent: true });
    }, 4000);
    return () => clearInterval(id);
  }, [user.isLoggedIn, user.isLocalDemoSession, authToken, activeSection, syncWalletFromServer]);

  // Live Market Ticker (Binance REST Snapshot + WebSocket + Smooth Fallback Simulation)
  useEffect(() => {
    let ws: WebSocket | null = null;
    let wsActive = false;
    const controller = new AbortController();

    const applyBinanceTicker = (rawSymbol: string, last: number, pct: number, hi: number, lo: number) => {
      const sym: MarketSymbol = rawSymbol.toUpperCase() === 'PAXGUSDT' ? 'GOLD' : (rawSymbol.toUpperCase() as MarketSymbol);
      if (!Number.isFinite(last)) return;
      setQuotes((prev) =>
        prev.map((q) =>
          q.symbol === sym
            ? {
                ...q,
                price: last,
                changePct: Number.isFinite(pct) ? pct : q.changePct,
                high24h: Number.isFinite(hi) && hi > 0 ? hi : q.high24h,
                low24h: Number.isFinite(lo) && lo > 0 ? lo : q.low24h,
              }
            : q
        )
      );
    };

    const binanceRestSymbols = encodeURIComponent(
      JSON.stringify([
        'BTCUSDT',
        'ETHUSDT',
        'SOLUSDT',
        'BNBUSDT',
        'XRPUSDT',
        'DOGEUSDT',
        'ADAUSDT',
        'AVAXUSDT',
        'LINKUSDT',
        'TONUSDT',
        'PAXGUSDT',
      ])
    );
    fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${binanceRestSymbols}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Array<{ symbol: string; lastPrice: string; priceChangePercent: string; highPrice: string; lowPrice: string }>) => {
        if (!Array.isArray(rows)) return;
        for (const item of rows) {
          applyBinanceTicker(
            item.symbol,
            parseFloat(item.lastPrice),
            parseFloat(item.priceChangePercent),
            parseFloat(item.highPrice),
            parseFloat(item.lowPrice)
          );
        }
      })
      .catch(() => {
        // Fallback smoothly when offline
      });

    try {
      ws = new WebSocket(
        'wss://stream.binance.com:9443/ws/btcusdt@ticker/ethusdt@ticker/solusdt@ticker/bnbusdt@ticker/xrpusdt@ticker/dogeusdt@ticker/adausdt@ticker/avaxusdt@ticker/linkusdt@ticker/tonusdt@ticker/paxgusdt@ticker'
      );
      ws.onmessage = (event) => {
        try {
          const item = JSON.parse(event.data);
          if (!item?.s) return;
          wsActive = true;
          applyBinanceTicker(
            item.s,
            parseFloat(item.c),
            parseFloat(item.P),
            parseFloat(item.h),
            parseFloat(item.l)
          );
        } catch {
          // ignore malformed tick
        }
      };
    } catch {
      wsActive = false;
    }

    const fallbackInterval = setInterval(() => {
      setQuotes((prev) =>
        prev.map((q) => {
          if (q.isCustom) return q;
          if (wsActive && q.symbol !== 'USOIL') return q;
          const delta = (Math.random() - 0.495) * q.price * 0.0012;
          const decimals = q.price < 1 ? 4 : q.price < 10 ? 3 : 2;
          const minFloor = q.price < 1 ? 0.0001 : 0.1;
          const nextPrice = Math.max(minFloor, Number((q.price + delta).toFixed(decimals)));
          return {
            ...q,
            price: nextPrice,
            changePct: Number((q.changePct + (delta / q.price) * 100).toFixed(2)),
          };
        })
      );
    }, 2500);

    return () => {
      controller.abort();
      clearInterval(fallbackInterval);
      if (ws) ws.close();
    };
  }, []);

  // Poll Admin-managed Custom Coins (e.g., XU/USDT) live from Cloud SQL server
  useEffect(() => {
    let cancelled = false;
    const syncCustomCoins = async () => {
      try {
        const res = await fetch('/api/coins');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const serverCoins = Array.isArray(data?.coins) ? (data.coins as AdminManagedCoin[]) : [];
        const customQuotes: MarketQuote[] = serverCoins.map((c) => ({
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
        setQuotes((prev) => {
          const builtIn = prev.filter((q) => !q.isCustom);
          if (builtIn.length === 0) return customQuotes;
          return [builtIn[0], ...customQuotes, ...builtIn.slice(1)];
        });
      } catch {
        // Ignore transient network errors
      }
    };

    syncCustomCoins();
    const timer = setInterval(syncCustomCoins, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Landing Live Feed Stream rotation
  useEffect(() => {
    if (user.isLoggedIn) return;
    const methods = ['KBZPay', 'WavePay', 'USDT TRC20', 'Bank Transfer'];
    const id = setInterval(() => {
      const isWithdraw = Math.random() > 0.4;
      const method = methods[Math.floor(Math.random() * methods.length)];
      const amount = Math.floor(Math.random() * 880) + 120;
      const masked =
        method === 'USDT TRC20'
          ? `0x${Math.random().toString(16).slice(2, 6)}...${Math.random().toString(16).slice(2, 5)}`
          : `09${Math.floor(Math.random() * 8 + 1)}***${Math.floor(Math.random() * 899 + 100)}`;
      setLiveFeedItems((prev) => [
        {
          id: `${Date.now()}`,
          type: isWithdraw ? 'WITHDRAWAL' : 'DEPOSIT',
          method,
          amount,
          user: masked,
          time: 'Just now',
        },
        ...prev.slice(0, 3),
      ]);
    }, 4500);
    return () => clearInterval(id);
  }, [user.isLoggedIn]);

  // Ref for triggering pre-orders & SL/TP without stale closures
  const stateRef = useRef({ preOrders, activePositions, quotes, user });
  stateRef.current = { preOrders, activePositions, quotes, user };

  const recordTradeOnServer = useCallback(
    (payload: {
      tradeUid: string;
      symbol: string;
      side: OrderSide;
      leverage: number;
      margin: number;
      entryPrice: number;
      closePrice?: number | null;
      liqPrice?: number | null;
      tradingFee: number;
      pnlVal: number;
      status: 'OPEN' | 'CLOSED' | 'LIQUIDATED';
      accountMode: AccountMode;
    }) => {
      const currentUser = stateRef.current.user;
      fetch('/api/trades/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          userUid: currentUser.uid,
          userEmail: currentUser.email,
        }),
      }).catch(() => {
        // Non-blocking telemetry sync
      });
    },
    []
  );

  const closePositionById = useCallback(
    async (id: string, reasonLabel?: string, isLiquidated = false) => {
      if (closingIdsRef.current.has(id) || settledIdsRef.current.has(id)) return;
      const pos = stateRef.current.activePositions.find((p) => p.id === id);
      if (!pos) return;
      closingIdsRef.current.add(id);
      settledIdsRef.current.add(id);

      try {
        const quote = stateRef.current.quotes.find((q) => q.symbol === pos.symbol);
        const markPrice = quote ? quote.price : pos.entryPrice;
        const autoEval = evaluatePositionAutoClose(pos, markPrice);
        const effectiveLiquidated = isLiquidated || Boolean(autoEval?.isLiquidated);
        const effectiveReason = reasonLabel ?? autoEval?.reasonLabel;
        const rawPnl = calculateUnrealizedPnl(pos, markPrice);
        const settlement = effectiveLiquidated
          ? {
              totalFeesPaid: pos.tradingFeePaid,
              finalNetProfit: -pos.margin,
              netReturnToWallet: 0,
            }
          : calculateCloseSettlement(pos, rawPnl.pnlVal);
        const effectivePnlPct = effectiveLiquidated ? -100 : rawPnl.pnlPct;

        const nextDemoBal =
          pos.accountMode === 'demo'
            ? Math.max(0, stateRef.current.user.demoBalance + settlement.netReturnToWallet)
            : stateRef.current.user.demoBalance;
        const nextRealBal =
          pos.accountMode === 'real'
            ? Math.max(0, stateRef.current.user.realBalance + settlement.netReturnToWallet)
            : stateRef.current.user.realBalance;

        stateRef.current.activePositions = stateRef.current.activePositions.filter((p) => p.id !== id);
        stateRef.current.user = {
          ...stateRef.current.user,
          demoBalance: nextDemoBal,
          realBalance: nextRealBal,
        };

        setActivePositions((prev) => prev.filter((p) => p.id !== id));
        setUser((prev) => ({
          ...prev,
          demoBalance:
            pos.accountMode === 'demo'
              ? Math.max(0, prev.demoBalance + settlement.netReturnToWallet)
              : prev.demoBalance,
          realBalance:
            pos.accountMode === 'real'
              ? Math.max(0, prev.realBalance + settlement.netReturnToWallet)
              : prev.realBalance,
        }));

        const historyEntry: TradeHistoryItem = {
          id: `${Date.now()}-${id}`,
          symbol: pos.symbol,
          side: pos.side,
          leverage: pos.leverage,
          entryPrice: pos.entryPrice,
          closePrice: markPrice,
          totalFees: settlement.totalFeesPaid,
          pnlVal: settlement.finalNetProfit,
          pnlPct: effectivePnlPct,
          accountMode: pos.accountMode,
          isLiquidated: effectiveLiquidated,
          closedAt: new Date().toLocaleTimeString(),
          rawTime: Date.now(),
        };
        setTradeHistory((prev) => [historyEntry, ...prev]);

        recordTradeOnServer({
          tradeUid: pos.id,
          symbol: pos.symbol,
          side: pos.side,
          leverage: pos.leverage,
          margin: pos.margin,
          entryPrice: pos.entryPrice,
          closePrice: markPrice,
          liqPrice: getNumericLiqPrice(pos),
          tradingFee: settlement.totalFeesPaid,
          pnlVal: settlement.finalNetProfit,
          status: effectiveLiquidated ? 'LIQUIDATED' : 'CLOSED',
          accountMode: pos.accountMode,
        });

        if (!stateRef.current.user.isLocalDemoSession && settlement.netReturnToWallet !== 0) {
          applyWalletDeltaOnServer(pos.accountMode, settlement.netReturnToWallet);
        }

        if (!stateRef.current.user.isLocalDemoSession && auth.currentUser) {
          try {
            const uid = auth.currentUser.uid;
            await deleteDoc(doc(db, 'users', uid, 'positions', id));
            await updateDoc(doc(db, 'users', uid), {
              [pos.accountMode === 'demo' ? 'demoBalance' : 'realBalance']:
                pos.accountMode === 'demo' ? nextDemoBal : nextRealBal,
            });
            await addDoc(collection(db, 'users', uid, 'history'), {
              ...historyEntry,
              closedAt: serverTimestamp(),
            });
          } catch {
            // ignore offline sync error
          }
        }

        showToast(
          effectiveLiquidated
            ? `LIQUIDATED: ${pos.symbol} at $${markPrice.toFixed(2)} (-$${pos.margin.toFixed(2)} Margin Lost)`
            : `${effectiveReason ? `${effectiveReason}: ` : ''}${pos.symbol} closed (${
                settlement.finalNetProfit >= 0 ? '+' : ''
              }$${settlement.finalNetProfit.toFixed(2)})`,
          effectiveLiquidated ? 'error' : 'success'
        );
      } finally {
        closingIdsRef.current.delete(id);
      }
    },
    [recordTradeOnServer, applyWalletDeltaOnServer, showToast]
  );

  const runMarketTriggerSweep = useCallback(() => {
    const {
      preOrders: currentOrders,
      activePositions: currentPositions,
      quotes: currentQuotes,
      user: currentUser,
    } = stateRef.current;

    for (const order of currentOrders) {
      const q = currentQuotes.find((item) => item.symbol === order.symbol);
      if (!q) continue;
      if (shouldTriggerPreOrder(order, q.price)) {
        setPreOrders((prev) => prev.filter((o) => o.id !== order.id));
        const filledPos: Position = { ...order, markPrice: q.price };
        setActivePositions((prev) => [...prev, filledPos]);
        recordTradeOnServer({
          tradeUid: order.id,
          symbol: order.symbol,
          side: order.side,
          leverage: order.leverage,
          margin: order.margin,
          entryPrice: order.entryPrice,
          liqPrice: getNumericLiqPrice(order),
          tradingFee: order.tradingFeePaid,
          pnlVal: 0,
          status: 'OPEN',
          accountMode: order.accountMode,
        });
        if (!currentUser.isLocalDemoSession && auth.currentUser) {
          const uid = auth.currentUser.uid;
          deleteDoc(doc(db, 'users', uid, 'orders', order.id)).catch(() => {});
          setDoc(doc(db, 'users', uid, 'positions', order.id), filledPos).catch(() => {});
        }
        showToast(`Limit Pre-Order triggered for ${order.symbol} at $${q.price.toFixed(2)}`);
      }
    }

    for (const pos of currentPositions) {
      if (closingIdsRef.current.has(pos.id) || settledIdsRef.current.has(pos.id)) continue;
      const q = currentQuotes.find((item) => item.symbol === pos.symbol);
      if (!q) continue;
      const hit = evaluatePositionAutoClose(pos, q.price);
      if (hit) {
        closePositionById(pos.id, hit.reasonLabel, hit.isLiquidated);
      }
    }
  }, [closePositionById, recordTradeOnServer, showToast]);

  // Auto-check limit pre-orders, liquidation triggers, SL/TP triggers & custom Price Alerts on price updates
  useEffect(() => {
    runMarketTriggerSweep();

    const newlyTriggeredIds: string[] = [];
    for (const alert of priceAlerts) {
      if (alert.triggered) continue;
      const q = quotes.find((item) => item.symbol === alert.symbol);
      if (!q) continue;
      if (shouldTriggerPriceAlert(alert, q.price)) {
        newlyTriggeredIds.push(alert.id);
        const dirWord = alert.condition === 'above' ? 'above' : 'below';
        const msg = `Price Alert: ${alert.symbol} hit $${q.price.toFixed(2)} (${dirWord} $${alert.targetPrice.toFixed(2)})`;
        showToast(msg);
        if (
          typeof window !== 'undefined' &&
          'Notification' in window &&
          Notification.permission === 'granted'
        ) {
          try {
            new Notification('Zectrade Price Alert', { body: msg });
          } catch {
            // ignore notification errors
          }
        }
      }
    }

    if (newlyTriggeredIds.length > 0) {
      const nowTime = new Date().toLocaleTimeString();
      setPriceAlerts((prev) =>
        prev.map((a) =>
          newlyTriggeredIds.includes(a.id) ? { ...a, triggered: true, triggeredAt: nowTime } : a
        )
      );
    }
  }, [quotes, preOrders, activePositions, priceAlerts, runMarketTriggerSweep, showToast]);

  // Continuous 500ms safety sweep guarantees SL/TP & liquidation close promptly even between quote re-renders
  useEffect(() => {
    const id = setInterval(() => {
      runMarketTriggerSweep();
    }, 500);
    return () => clearInterval(id);
  }, [runMarketTriggerSweep]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`zectrade_lottery_settled_${user.uid}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          settledLotteryBetIdsRef.current = new Set(parsed.map(String));
        } else {
          settledLotteryBetIdsRef.current = new Set();
        }
      } else {
        settledLotteryBetIdsRef.current = new Set();
      }
    } catch {
      settledLotteryBetIdsRef.current = new Set();
    }

    try {
      const rawDigit = localStorage.getItem(`zectrade_digit_settled_${user.uid}`);
      if (rawDigit) {
        const parsedDigit = JSON.parse(rawDigit);
        if (Array.isArray(parsedDigit)) {
          settledDigitBetIdsRef.current = new Set(parsedDigit.map(String));
        } else {
          settledDigitBetIdsRef.current = new Set();
        }
      } else {
        settledDigitBetIdsRef.current = new Set();
      }
    } catch {
      settledDigitBetIdsRef.current = new Set();
    }
  }, [user.uid]);

  const fetchLotteryState = useCallback(
    async (tokenOverride?: string | null) => {
      try {
        const activeToken = tokenOverride !== undefined ? tokenOverride : authToken;
        const url = `/api/lottery/state?userUid=${encodeURIComponent(user.uid)}`;
        const res = await fetch(url, {
          headers: activeToken ? { Authorization: `Bearer ${activeToken}` } : undefined,
        });
        if (!res.ok) return;
        const data = (await res.json()) as LotteryLiveState;
        setLotteryState(data);

        // Reconcile newly settled live bets once per bet ID
        const newlySettled = (data.userBets ?? []).filter(
          (b) =>
            (b.outcome === 'WIN' || b.outcome === 'LOSS') &&
            !settledLotteryBetIdsRef.current.has(b.id)
        );

        let demoCredit = 0;
        let realCredit = 0;

        if (newlySettled.length > 0) {
          let totalNetProfit = 0;

          for (const bet of newlySettled) {
            settledLotteryBetIdsRef.current.add(bet.id);
            if (bet.outcome === 'WIN') {
              if (bet.accountMode === 'demo') demoCredit += bet.payoutAmount;
              else realCredit += bet.payoutAmount;
            }
            totalNetProfit += bet.netProfit;
          }

          try {
            localStorage.setItem(
              `zectrade_lottery_settled_${user.uid}`,
              JSON.stringify(Array.from(settledLotteryBetIdsRef.current).slice(-200))
            );
          } catch {
            // ignore storage quota errors
          }

          const latestBet = newlySettled[0];
          const settledRound = data.historyStrip.find((r) => r.roundCode === latestBet.roundCode);
          const winColor: LotteryColor =
            settledRound?.winningColor ??
            (latestBet.outcome === 'WIN'
              ? latestBet.color
              : latestBet.color === 'green'
              ? 'red'
              : 'green');

          if (data.historyStrip.length > 0) {
            lastSeenSettledRoundRef.current = data.historyStrip[0].roundCode;
          } else {
            lastSeenSettledRoundRef.current = latestBet.roundCode;
          }

          setLatestLotteryBanner({
            roundCode: latestBet.roundCode,
            winningColor: winColor,
            winningNumber: settledRound?.winningNumber ?? null,
            userNetProfit: Number(totalNetProfit.toFixed(2)),
            userOutcome: totalNetProfit >= 0 ? 'WIN' : 'LOSS',
          });

          if (totalNetProfit >= 0) {
            showToast(
              `Lottery Result: WON +$${(demoCredit + realCredit).toFixed(2)} (${winColor.toUpperCase()})!`
            );
          } else {
            showToast(
              `Lottery Result: ${winColor.toUpperCase()} won · Net ${totalNetProfit.toFixed(2)} USD`,
              'error'
            );
          }
        } else if (data.historyStrip.length > 0) {
          const latestRound = data.historyStrip[0];
          if (
            lastSeenSettledRoundRef.current &&
            lastSeenSettledRoundRef.current !== latestRound.roundCode &&
            latestRound.winningColor
          ) {
            setLatestLotteryBanner({
              roundCode: latestRound.roundCode,
              winningColor: latestRound.winningColor,
              winningNumber: latestRound.winningNumber ?? null,
              userNetProfit: null,
              userOutcome: 'NONE',
            });
          }
          lastSeenSettledRoundRef.current = latestRound.roundCode;
        }

        // Reconcile newly settled 2D/3D/6D tickets once per ticket ID
        const newlySettledDigits = (data.userDigitBets ?? []).filter(
          (b) =>
            (b.outcome === 'WIN' || b.outcome === 'LOSS') &&
            !settledDigitBetIdsRef.current.has(b.id)
        );

        let digitDemoCredit = 0;
        let digitRealCredit = 0;
        if (newlySettledDigits.length > 0) {
          for (const dBet of newlySettledDigits) {
            settledDigitBetIdsRef.current.add(dBet.id);
            if (dBet.outcome === 'WIN') {
              if (dBet.accountMode === 'demo') digitDemoCredit += dBet.payoutAmount;
              else digitRealCredit += dBet.payoutAmount;
            }
          }
          try {
            localStorage.setItem(
              `zectrade_digit_settled_${user.uid}`,
              JSON.stringify(Array.from(settledDigitBetIdsRef.current).slice(-200))
            );
          } catch {
            // ignore storage quota errors
          }

          const latestDigit = newlySettledDigits[0];
          if (digitDemoCredit + digitRealCredit > 0) {
            showToast(
              `${latestDigit.gameType} Draw ${latestDigit.drawUid}: Ticket #${latestDigit.pickedNumber} WON +$${(digitDemoCredit + digitRealCredit).toFixed(2)}!`
            );
          } else {
            showToast(
              `${latestDigit.gameType} Draw ${latestDigit.drawUid}: Result released (Ticket #${latestDigit.pickedNumber}).`,
              'error'
            );
          }
        }

        const totalDemoCredit = demoCredit + digitDemoCredit;
        const totalRealCredit = realCredit + digitRealCredit;
        if (totalDemoCredit > 0 || totalRealCredit > 0) {
          setUser((prev) => {
            const nextDemo = Number((prev.demoBalance + totalDemoCredit).toFixed(2));
            const nextReal = Number((prev.realBalance + totalRealCredit).toFixed(2));
            if (!prev.isLocalDemoSession && auth.currentUser) {
              updateDoc(doc(db, 'users', prev.uid), {
                demoBalance: nextDemo,
                realBalance: nextReal,
              }).catch(() => {});
            }
            return { ...prev, demoBalance: nextDemo, realBalance: nextReal };
          });
          if (!stateRef.current.user.isLocalDemoSession) {
            if (totalDemoCredit > 0) applyWalletDeltaOnServer('demo', totalDemoCredit);
            if (totalRealCredit > 0) applyWalletDeltaOnServer('real', totalRealCredit);
          }
        }
      } catch {
        // Keep UI responsive
      }
    },
    [authToken, user.uid, showToast, applyWalletDeltaOnServer]
  );

  useEffect(() => {
    fetchLotteryState();
    const intervalMs = activeSection === 'lottery' || staffModalOpen ? 1000 : 3000;
    const id = setInterval(() => {
      fetchLotteryState();
    }, intervalMs);
    return () => clearInterval(id);
  }, [fetchLotteryState, activeSection, staffModalOpen]);

  const fetchPublicNews = useCallback(async () => {
    setNewsLoading(true);
    try {
      const res = await fetch('/api/news');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.articles)) {
        setNewsArticles(data.articles as NewsArticle[]);
      }
    } catch {
      // keep existing articles cleanly
    } finally {
      setNewsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPublicNews();
  }, [fetchPublicNews]);

  useEffect(() => {
    if (activeSection === 'news') {
      fetchPublicNews();
    }
  }, [activeSection, fetchPublicNews]);

  const fetchAdminNews = useCallback(
    async (tokenOverride?: string | null) => {
      const activeToken = tokenOverride ?? authToken;
      if (!activeToken) return;
      setAdminNewsLoading(true);
      try {
        const res = await fetch('/api/admin/news', {
          headers: { Authorization: `Bearer ${activeToken}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data?.articles)) {
          setAdminNewsArticles(data.articles as NewsArticle[]);
        }
      } catch {
        // ignore cleanly
      } finally {
        setAdminNewsLoading(false);
      }
    },
    [authToken]
  );

  const handleCreateAdminNews = useCallback(
    async (payload: {
      title: string;
      summary: string;
      content: string;
      category: NewsCategory;
      authorName: string;
      imageUrl: string | null;
      isFeatured: boolean;
      isPublished: boolean;
    }): Promise<boolean> => {
      if (!authToken) {
        showToast('Admin authentication required to publish dispatches.', 'error');
        return false;
      }
      try {
        const res = await fetch('/api/admin/news', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
          showToast(data?.error || 'Unable to publish news dispatch.', 'error');
          return false;
        }
        await Promise.all([fetchAdminNews(authToken), fetchPublicNews()]);
        showToast('News dispatch published.');
        return true;
      } catch {
        showToast('Network error publishing news dispatch.', 'error');
        return false;
      }
    },
    [authToken, fetchAdminNews, fetchPublicNews, showToast]
  );

  const handleUpdateAdminNews = useCallback(
    async (
      id: number,
      updates: Partial<{
        title: string;
        summary: string;
        content: string;
        category: NewsCategory;
        authorName: string;
        imageUrl: string | null;
        isFeatured: boolean;
        isPublished: boolean;
      }>
    ): Promise<boolean> => {
      if (!authToken) {
        showToast('Admin authentication required.', 'error');
        return false;
      }
      try {
        const res = await fetch(`/api/admin/news/${id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify(updates),
        });
        const data = await res.json();
        if (!res.ok) {
          showToast(data?.error || 'Unable to update news dispatch.', 'error');
          return false;
        }
        await Promise.all([fetchAdminNews(authToken), fetchPublicNews()]);
        showToast('News dispatch updated.');
        return true;
      } catch {
        showToast('Network error updating news dispatch.', 'error');
        return false;
      }
    },
    [authToken, fetchAdminNews, fetchPublicNews, showToast]
  );

  const handleDeleteAdminNews = useCallback(
    async (id: number): Promise<boolean> => {
      if (!authToken) {
        showToast('Admin authentication required.', 'error');
        return false;
      }
      try {
        const res = await fetch(`/api/admin/news/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${authToken}` },
        });
        const data = await res.json();
        if (!res.ok) {
          showToast(data?.error || 'Unable to delete news dispatch.', 'error');
          return false;
        }
        await Promise.all([fetchAdminNews(authToken), fetchPublicNews()]);
        showToast('News dispatch deleted.');
        return true;
      } catch {
        showToast('Network error deleting news dispatch.', 'error');
        return false;
      }
    },
    [authToken, fetchAdminNews, fetchPublicNews, showToast]
  );

  const fetchAdminMembersFromServer = useCallback(async (tokenOverride?: string, queryText = '') => {
    const activeToken = tokenOverride ?? authToken;
    if (!activeToken) return;
    try {
      const url = queryText
        ? `/api/admin/members?q=${encodeURIComponent(queryText)}`
        : '/api/admin/members';
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${activeToken}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.members)) {
        setManagedMembers(
          data.members.map((m: Record<string, unknown>) => ({
            uid: String(m.uid || ''),
            username: String(m.username || 'Trader'),
            email: String(m.email || ''),
            role: (m.role as UserRole) || 'user',
            isBlocked: Boolean(m.isBlocked),
            isWithdrawBlocked: Boolean(m.isWithdrawBlocked),
            hasDepositedBefore: Boolean(m.hasDepositedBefore),
            hasTradedAfterDeposit: Boolean(m.hasTradedAfterDeposit),
            withdrawLockClearedByAdmin: Boolean(m.withdrawLockClearedByAdmin),
            realBalance: Number(m.realBalance ?? 0),
            demoBalance: Number(m.demoBalance ?? 100000),
            securityPin: m.securityPin ? String(m.securityPin) : undefined,
            invitedBy: m.invitedBy ? String(m.invitedBy) : null,
            avatarUrl: m.avatarUrl ? String(m.avatarUrl) : null,
            fullName: m.fullName ? String(m.fullName) : null,
            phone: m.phone ? String(m.phone) : null,
            country: m.country ? String(m.country) : null,
            bio: m.bio ? String(m.bio) : null,
            withdrawMethod: (m.withdrawMethod as WithdrawMethod | undefined) || 'kpay',
            withdrawAccountName: m.withdrawAccountName ? String(m.withdrawAccountName) : null,
            withdrawAccountNumber: m.withdrawAccountNumber ? String(m.withdrawAccountNumber) : null,
          }))
        );
      }
    } catch {
      // ignore fetch errors gracefully
    }
  }, [authToken]);

  const loadStaffRequests = useCallback(
    async (tokenOverride?: string) => {
      const role = stateRef.current.user.role;
      const isStaffRole = ['admin', 'staff', 'caiwu', 'chukuan'].includes(role);
      if (!isStaffRole) return;

      const activeToken = tokenOverride ?? authToken;
      const canSeeDeposits = role === 'admin' || role === 'staff' || role === 'caiwu';
      const canSeeWithdrawals = role === 'admin' || role === 'staff' || role === 'chukuan';

      setStaffRequestsLoading(true);
      try {
        const depositsList: StaffWalletRequest[] = [];
        const withdrawalsList: StaffWalletRequest[] = [];
        const seenKeys = new Set<string>();

        if (activeToken) {
          try {
            const res = await fetch('/api/staff/requests', {
              headers: { Authorization: `Bearer ${activeToken}` },
            });
            if (res.ok) {
              const data = await res.json();
              if (canSeeDeposits && Array.isArray(data?.deposits)) {
                for (const d of data.deposits as Array<Record<string, unknown>>) {
                  const idStr = `srv-${String(d.id)}`;
                  const dt = d.createdAt ? new Date(String(d.createdAt)) : new Date();
                  depositsList.push({
                    id: idStr,
                    serverId: Number(d.id),
                    source: 'server',
                    userId: String(d.userUid || ''),
                    userEmail: String(d.userEmail || ''),
                    kind: 'deposit',
                    type: String(d.typeLabel || 'DEPOSIT SUBMITTED'),
                    method: String(d.method || 'kpay'),
                    amount: Number(d.amountUsd || 0),
                    target: String(d.target || ''),
                    status: String(d.status || 'PENDING'),
                    rejectReason: d.rejectReason ? String(d.rejectReason) : null,
                    createdAtLabel: Number.isNaN(dt.getTime()) ? 'Just now' : dt.toLocaleString(),
                  });
                  seenKeys.add(`dep|${String(d.userUid)}|${Number(d.amountUsd || 0)}|${String(d.target || '')}`);
                }
              }
              if (canSeeWithdrawals && Array.isArray(data?.withdrawals)) {
                for (const w of data.withdrawals as Array<Record<string, unknown>>) {
                  const idStr = `srv-${String(w.id)}`;
                  const dt = w.createdAt ? new Date(String(w.createdAt)) : new Date();
                  withdrawalsList.push({
                    id: idStr,
                    serverId: Number(w.id),
                    source: 'server',
                    userId: String(w.userUid || ''),
                    userEmail: String(w.userEmail || ''),
                    kind: 'withdrawal',
                    type: String(w.typeLabel || 'WITHDRAWAL'),
                    method: String(w.method || 'kpay'),
                    amount: Number(w.amountUsd || 0),
                    target: String(w.target || ''),
                    status: String(w.status || 'PENDING'),
                    rejectReason: w.rejectReason ? String(w.rejectReason) : null,
                    createdAtLabel: Number.isNaN(dt.getTime()) ? 'Just now' : dt.toLocaleString(),
                  });
                  seenKeys.add(`wd|${String(w.userUid)}|${Number(w.amountUsd || 0)}|${String(w.target || '')}`);
                }
              }
            }
          } catch {
            // graceful fallback
          }
        }

        // Safely merge Firestore pending transactions if permitted (silently ignore cross-user rule errors)
        if (!stateRef.current.user.isLocalDemoSession && auth.currentUser) {
          try {
            const usersSnap = await getDocs(collection(db, 'users'));
            for (const userDoc of usersSnap.docs) {
              try {
                const txSnap = await getDocs(
                  query(
                    collection(db, 'users', userDoc.id, 'transactions'),
                    where('status', '==', 'PENDING')
                  )
                );
                txSnap.forEach((txDoc) => {
                  const raw = txDoc.data();
                  const txType = String(raw.type || '');
                  const amount = Number(raw.amount || 0);
                  const target = String(raw.target || '');
                  const dt = raw.createdAt?.toDate ? raw.createdAt.toDate() : new Date();
                  const uid = String(raw.userId || userDoc.id);
                  const email = String(raw.userEmail || userDoc.data().email || 'Unknown');

                  if (canSeeDeposits && txType.includes('DEPOSIT')) {
                    const dedup = `dep|${uid}|${amount}|${target}`;
                    if (!seenKeys.has(dedup)) {
                      seenKeys.add(dedup);
                      depositsList.push({
                        id: `fs-${txDoc.id}`,
                        source: 'firestore',
                        firestorePath: txDoc.ref.path,
                        userId: uid,
                        userEmail: email,
                        kind: 'deposit',
                        type: txType,
                        method: txType,
                        amount,
                        target,
                        status: 'PENDING',
                        createdAtLabel: dt.toLocaleString(),
                      });
                    }
                  } else if (canSeeWithdrawals && txType.includes('WITHDRAWAL')) {
                    const dedup = `wd|${uid}|${amount}|${target}`;
                    if (!seenKeys.has(dedup)) {
                      seenKeys.add(dedup);
                      withdrawalsList.push({
                        id: `fs-${txDoc.id}`,
                        source: 'firestore',
                        firestorePath: txDoc.ref.path,
                        userId: uid,
                        userEmail: email,
                        kind: 'withdrawal',
                        type: txType,
                        method: txType,
                        amount,
                        target,
                        status: 'PENDING',
                        createdAtLabel: dt.toLocaleString(),
                      });
                    }
                  }
                });
              } catch {
                // Skip restricted user subcollections silently without surfacing permission errors
              }
            }
          } catch {
            // Firestore cross-user directory restricted by rules — rely on Cloud SQL backend cleanly
          }
        }

        // Also include any pending local session transactions not yet synced
        for (const tx of walletTransactions) {
          if (tx.status !== 'PENDING') continue;
          const uid = tx.userId || stateRef.current.user.uid;
          const email = tx.userEmail || stateRef.current.user.email;
          if (canSeeDeposits && tx.type.includes('DEPOSIT')) {
            const dedup = `dep|${uid}|${tx.amount}|${tx.target}`;
            if (!seenKeys.has(dedup)) {
              seenKeys.add(dedup);
              depositsList.push({
                id: `loc-${tx.id}`,
                source: 'local',
                userId: uid,
                userEmail: email,
                kind: 'deposit',
                type: tx.type,
                method: tx.type,
                amount: tx.amount,
                target: tx.target,
                status: 'PENDING',
                createdAtLabel: tx.timestamp,
              });
            }
          } else if (canSeeWithdrawals && tx.type.includes('WITHDRAWAL')) {
            const dedup = `wd|${uid}|${tx.amount}|${tx.target}`;
            if (!seenKeys.has(dedup)) {
              seenKeys.add(dedup);
              withdrawalsList.push({
                id: `loc-${tx.id}`,
                source: 'local',
                userId: uid,
                userEmail: email,
                kind: 'withdrawal',
                type: tx.type,
                method: tx.type,
                amount: tx.amount,
                target: tx.target,
                status: 'PENDING',
                createdAtLabel: tx.timestamp,
              });
            }
          }
        }

        setPendingDeposits(depositsList);
        setPendingWithdrawals(withdrawalsList);
      } finally {
        setStaffRequestsLoading(false);
      }
    },
    [authToken, walletTransactions]
  );

  const fetchAdminCoins = useCallback(
    async (tokenOverride?: string) => {
      const activeToken = tokenOverride ?? authToken;
      if (!activeToken || stateRef.current.user.role !== 'admin') return;
      try {
        const res = await fetch('/api/admin/coins', {
          headers: { Authorization: `Bearer ${activeToken}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data?.coins)) {
          setAdminCoins(data.coins as AdminManagedCoin[]);
        }
      } catch {
        // Ignore transient network errors
      }
    },
    [authToken]
  );

  const fetchCoinAnalytics = useCallback(
    async (symbol: string, tokenOverride?: string) => {
      const activeToken = tokenOverride ?? authToken;
      if (!activeToken || stateRef.current.user.role !== 'admin' || !symbol) return;
      setCoinAnalyticsLoading(true);
      try {
        const res = await fetch(`/api/admin/coins/${encodeURIComponent(symbol)}/analytics`, {
          headers: { Authorization: `Bearer ${activeToken}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data?.analytics) {
          setSelectedCoinAnalytics(data.analytics as CoinTradeAnalytics);
        }
      } catch {
        // Ignore errors gracefully
      } finally {
        setCoinAnalyticsLoading(false);
      }
    },
    [authToken]
  );

  const handleUpsertAdminCoin = useCallback(
    async (payload: { symbol: string; label?: string; initialPrice: number; enabled?: boolean }) => {
      if (!authToken || user.role !== 'admin') {
        showToast('Only Full Admin can add custom coins.', 'error');
        return null;
      }
      try {
        const res = await fetch('/api/admin/coins', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok || !data?.coin) {
          showToast(data?.error || 'Failed to save custom coin.', 'error');
          return null;
        }
        const saved = data.coin as AdminManagedCoin;
        setAdminCoins((prev) => {
          const exists = prev.some((c) => c.symbol === saved.symbol);
          return exists ? prev.map((c) => (c.symbol === saved.symbol ? saved : c)) : [saved, ...prev];
        });
        if (saved.enabled) {
          setQuotes((prev) => {
            const nextQuote: MarketQuote = {
              symbol: saved.symbol,
              tvSymbol: `CUSTOM:${saved.symbol}`,
              label: saved.label,
              shortName: saved.shortName,
              price: saved.currentPrice,
              changePct: saved.changePct,
              high24h: saved.high24h,
              low24h: saved.low24h,
              isCustom: true,
            };
            const others = prev.filter((q) => q.symbol !== saved.symbol);
            return [others[0], nextQuote, ...others.slice(1)].filter(Boolean);
          });
        }
        showToast(`${saved.shortName} officially launched on Main Market at $${saved.currentPrice.toFixed(2)}.`);
        return saved;
      } catch {
        showToast('Network error saving custom coin.', 'error');
        return null;
      }
    },
    [authToken, user.role, showToast]
  );

  const handleUpdateCoinPriceControl = useCallback(
    async (
      symbol: string,
      payload: {
        mode?: CoinScheduleMode | 'stop' | 'pause' | 'resume';
        manualPrice?: number;
        deltaPct?: number;
        transitionSec?: number;
        upTargetPrice?: number;
        upDurationSec?: number;
        downTargetPrice?: number;
        downDurationSec?: number;
        repeatLoop?: boolean;
        enabled?: boolean;
        trendBias?: 'up' | 'neutral' | 'down';
        volatilityLevel?: 'calm' | 'normal' | 'active';
        resetBaseline?: boolean;
      }
    ) => {
      if (!authToken || user.role !== 'admin') {
        showToast('Only Full Admin can control coin prices.', 'error');
        return null;
      }
      try {
        const res = await fetch(`/api/admin/coins/${encodeURIComponent(symbol)}/price-control`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok || !data?.coin) {
          showToast(data?.error || 'Failed to update coin price schedule.', 'error');
          return null;
        }
        const updated = data.coin as AdminManagedCoin;
        setAdminCoins((prev) => prev.map((c) => (c.symbol === updated.symbol ? updated : c)));
        setQuotes((prev) => {
          if (!updated.enabled) return prev.filter((q) => q.symbol !== updated.symbol);
          const nextQuote: MarketQuote = {
            symbol: updated.symbol,
            tvSymbol: `CUSTOM:${updated.symbol}`,
            label: updated.label,
            shortName: updated.shortName,
            price: updated.currentPrice,
            changePct: updated.changePct,
            high24h: updated.high24h,
            low24h: updated.low24h,
            isCustom: true,
          };
          const exists = prev.some((q) => q.symbol === updated.symbol);
          return exists
            ? prev.map((q) => (q.symbol === updated.symbol ? nextQuote : q))
            : [prev[0], nextQuote, ...prev.slice(1)].filter(Boolean);
        });
        await fetchCoinAnalytics(updated.symbol);
        const glideDur = payload.transitionSec ?? 0;
        showToast(
          payload.mode === 'up_then_down'
            ? payload.repeatLoop
              ? `Auto Loop Up ⇅ Down active for ${updated.shortName}!`
              : `Scheduled ${updated.shortName}: gradual Up → Down movement!`
            : payload.mode === 'down_sweep'
            ? `Gradually sweeping ${updated.shortName} toward liquidation bottom over ${payload.downDurationSec ?? 45}s.`
            : payload.mode === 'glide_to_target' || (glideDur > 0 && (typeof payload.deltaPct === 'number' || typeof payload.manualPrice === 'number'))
            ? `${updated.shortName} gliding smoothly over ${glideDur || 30}s.`
            : payload.mode === 'pause'
            ? `Paused ${updated.shortName} price schedule.`
            : payload.mode === 'resume'
            ? `Resumed ${updated.shortName} price schedule.`
            : payload.resetBaseline
            ? `Reset 24h % baseline for ${updated.shortName} at $${updated.currentPrice.toFixed(2)}.`
            : typeof payload.deltaPct === 'number'
            ? `Adjusted ${updated.shortName} ${payload.deltaPct > 0 ? `+${payload.deltaPct}%` : `${payload.deltaPct}%`} → $${updated.currentPrice.toFixed(2)}`
            : `Updated ${updated.shortName} live control.`
        );
        return updated;
      } catch {
        showToast('Network error updating coin price schedule.', 'error');
        return null;
      }
    },
    [authToken, user.role, fetchCoinAnalytics, showToast]
  );

  const handleDeleteAdminCoin = useCallback(
    async (symbol: string): Promise<boolean> => {
      if (!authToken || user.role !== 'admin') {
        showToast('Only Full Admin can delete custom coins.', 'error');
        return false;
      }
      try {
        const res = await fetch(`/api/admin/coins/${encodeURIComponent(symbol)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${authToken}` },
        });
        const data = await res.json();
        if (!res.ok) {
          showToast(data?.error || 'Failed to delete coin.', 'error');
          return false;
        }
        const cleanSym = symbol.toUpperCase().replace('/', '').trim();
        setAdminCoins((prev) => prev.filter((c) => c.symbol !== cleanSym));
        setQuotes((prev) => prev.filter((q) => q.symbol !== cleanSym));
        if (selectedSymbol === cleanSym) {
          setSelectedSymbol('BTCUSDT');
        }
        showToast(`Deleted ${cleanSym} from custom coins & Main Market.`);
        return true;
      } catch {
        showToast('Network error deleting coin.', 'error');
        return false;
      }
    },
    [authToken, user.role, selectedSymbol, showToast]
  );

  const handleClaimCoinProfit = useCallback(
    async (symbol: string): Promise<boolean> => {
      if (!authToken || user.role !== 'admin') {
        showToast('Only Full Admin can claim coin profit.', 'error');
        return false;
      }
      try {
        const res = await fetch(`/api/admin/coins/${encodeURIComponent(symbol)}/claim-profit`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
        });
        const data = await res.json();
        if (!res.ok) {
          showToast(data?.error || 'Failed to claim profit.', 'error');
          return false;
        }
        const claimedAmount = Number(data?.claimedAmount ?? 0);
        if (claimedAmount <= 0) {
          showToast('No unclaimed profit available to claim yet.', 'error');
          return false;
        }
        const newBal = Number(data?.newAdminRealBalance ?? user.realBalance + claimedAmount);
        setUser((prev) => ({ ...prev, realBalance: newBal }));
        setManagedMembers((prev) =>
          prev.map((m) => (m.uid === user.uid ? { ...m, realBalance: newBal } : m))
        );
        if (data?.analytics) {
          setSelectedCoinAnalytics(data.analytics as CoinTradeAnalytics);
        }
        showToast(`Claimed $${claimedAmount.toFixed(2)} net profit to Admin Real Wallet!`);
        return true;
      } catch {
        showToast('Network error claiming profit.', 'error');
        return false;
      }
    },
    [authToken, user.role, user.uid, user.realBalance, showToast]
  );

  useEffect(() => {
    if (user.isLoggedIn && authToken) {
      if (user.role === 'admin') {
        fetchAdminCoins(authToken);
      }
      if (['admin', 'staff', 'caiwu'].includes(user.role)) {
        fetchAdminMembersFromServer(authToken);
      }
      if (['admin', 'staff', 'caiwu', 'chukuan'].includes(user.role)) {
        loadStaffRequests(authToken);
      }
    }
  }, [
    user.isLoggedIn,
    user.role,
    authToken,
    fetchAdminCoins,
    fetchAdminMembersFromServer,
    loadStaffRequests,
  ]);

  useEffect(() => {
    if (staffModalOpen) {
      loadStaffRequests();
      if (user.role === 'admin') {
        fetchAdminCoins();
        fetchAdminNews();
      }
    }
  }, [staffModalOpen, user.role, loadStaffRequests, fetchAdminCoins, fetchAdminNews]);

  const handlePlaceLotteryBet = useCallback(
    async (payload: {
      betType: LotteryBetType;
      color?: LotteryColor;
      pickedNumber?: number | null;
      stake: number;
    }): Promise<boolean> => {
      const stake = Number(payload.stake.toFixed(2));
      const activeBal = accountMode === 'demo' ? user.demoBalance : user.realBalance;
      if (!Number.isFinite(stake) || stake < 1) {
        showToast('Minimum trade stake is $1.00.', 'error');
        return false;
      }
      if (stake > activeBal) {
        showToast(`Insufficient ${accountMode} balance for this trade.`, 'error');
        return false;
      }

      const balanceField = accountMode === 'demo' ? 'demoBalance' : 'realBalance';
      setUser((prev) => ({
        ...prev,
        [balanceField]: Number(Math.max(0, prev[balanceField] - stake).toFixed(2)),
      }));

      try {
        const res = await fetch('/api/lottery/bet', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({
            userUid: user.uid,
            userEmail: user.email,
            accountMode,
            betType: payload.betType,
            color: payload.color,
            pickedNumber: payload.pickedNumber,
            stake,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setUser((prev) => ({
            ...prev,
            [balanceField]: Number((prev[balanceField] + stake).toFixed(2)),
          }));
          showToast(data?.error || 'Failed to confirm Lottery trade.', 'error');
          return false;
        }
        if (data?.state) {
          setLotteryState(data.state);
        }
        if (!user.isLocalDemoSession) {
          applyWalletDeltaOnServer(accountMode, -stake);
        }
        if (!user.isLocalDemoSession && auth.currentUser) {
          const nextBal = Number(Math.max(0, activeBal - stake).toFixed(2));
          updateDoc(doc(db, 'users', user.uid), { [balanceField]: nextBal }).catch(() => {});
        }
        const label =
          payload.betType === 'number'
            ? `#${payload.pickedNumber}`
            : (payload.color ?? 'green').toUpperCase();
        showToast(`Confirmed ${label} trade · $${stake.toFixed(2)}.`);
        return true;
      } catch {
        setUser((prev) => ({
          ...prev,
          [balanceField]: Number((prev[balanceField] + stake).toFixed(2)),
        }));
        showToast('Network error confirming Lottery trade.', 'error');
        return false;
      }
    },
    [
      accountMode,
      authToken,
      user.demoBalance,
      user.realBalance,
      user.uid,
      user.email,
      user.isLocalDemoSession,
      applyWalletDeltaOnServer,
      showToast,
    ]
  );

  const handlePlaceDigitLotteryBet = useCallback(
    async (payload: { drawUid: string; pickedNumber: string; stake: number }): Promise<boolean> => {
      const stake = Number(payload.stake.toFixed(2));
      const activeBal = accountMode === 'demo' ? user.demoBalance : user.realBalance;
      if (!Number.isFinite(stake) || stake < 1) {
        showToast('Minimum ticket stake is $1.00.', 'error');
        return false;
      }
      if (stake > activeBal) {
        showToast(`Insufficient ${accountMode} balance for this ticket.`, 'error');
        return false;
      }

      const balanceField = accountMode === 'demo' ? 'demoBalance' : 'realBalance';
      setUser((prev) => ({
        ...prev,
        [balanceField]: Number(Math.max(0, prev[balanceField] - stake).toFixed(2)),
      }));

      try {
        const res = await fetch('/api/lottery/digit-bet', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({
            userUid: user.uid,
            userEmail: user.email,
            accountMode,
            drawUid: payload.drawUid,
            pickedNumber: payload.pickedNumber,
            stake,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setUser((prev) => ({
            ...prev,
            [balanceField]: Number((prev[balanceField] + stake).toFixed(2)),
          }));
          showToast(data?.error || 'Failed to place 2D/3D/6D ticket.', 'error');
          return false;
        }
        if (data?.state) {
          setLotteryState(data.state);
        }
        if (!user.isLocalDemoSession) {
          applyWalletDeltaOnServer(accountMode, -stake);
        }
        if (!user.isLocalDemoSession && auth.currentUser) {
          const nextBal = Number(Math.max(0, activeBal - stake).toFixed(2));
          updateDoc(doc(db, 'users', user.uid), { [balanceField]: nextBal }).catch(() => {});
        }
        showToast(
          `Confirmed ${data?.bet?.gameType ?? ''} Ticket #${data?.bet?.pickedNumber ?? payload.pickedNumber} · $${stake.toFixed(2)}`
        );
        return true;
      } catch {
        setUser((prev) => ({
          ...prev,
          [balanceField]: Number((prev[balanceField] + stake).toFixed(2)),
        }));
        showToast('Network error placing 2D/3D/6D ticket.', 'error');
        return false;
      }
    },
    [
      accountMode,
      authToken,
      user.demoBalance,
      user.realBalance,
      user.uid,
      user.email,
      user.isLocalDemoSession,
      applyWalletDeltaOnServer,
      showToast,
    ]
  );

  const handleUnlockLotteryAdmin = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      try {
        const res = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok || !data?.token) {
          showToast(data?.error || 'Invalid Admin credentials.', 'error');
          return false;
        }
        setAuthToken(data.token);
        fetchAdminMembersFromServer(data.token);
        fetchLotteryState(data.token);
        showToast('Lottery Admin Control Console unlocked.');
        return true;
      } catch {
        showToast('Unable to verify Admin credentials.', 'error');
        return false;
      }
    },
    [fetchAdminMembersFromServer, fetchLotteryState, showToast]
  );

  const handleUpdateLotteryAdminConfig = useCallback(
    async (payload: {
      resultMode?: LotteryResultMode;
      forcedResult?: LotteryColor | null;
      forcedNumber?: number | null;
      feePct?: number;
      payoutMultiplier?: number;
      numberMultiplier?: number;
      roundDurationSec?: number;
      isPaused?: boolean;
      settleNow?: boolean;
    }): Promise<boolean> => {
      if (!authToken) {
        showToast('Admin authentication required.', 'error');
        return false;
      }
      try {
        const res = await fetch('/api/admin/lottery/config', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
          showToast(data?.error || 'Failed to update Lottery configuration.', 'error');
          return false;
        }
        await fetchLotteryState(authToken);
        if (typeof payload.forcedNumber === 'number') {
          showToast(`Next round outcome locked to #${payload.forcedNumber}.`);
        } else if (payload.forcedResult) {
          showToast(`Next round outcome locked to ${payload.forcedResult.toUpperCase()}.`);
        } else if (payload.settleNow) {
          showToast('Current round settled and next round opened.');
        } else if (typeof payload.isPaused === 'boolean') {
          showToast(payload.isPaused ? 'Lottery rounds paused.' : 'Lottery rounds resumed.');
        } else {
          showToast('Lottery Live configuration updated.');
        }
        return true;
      } catch {
        showToast('Network error updating Lottery configuration.', 'error');
        return false;
      }
    },
    [authToken, fetchLotteryState, showToast]
  );

  const handleScheduleDigitDraw = useCallback(
    async (payload: DigitDrawSchedulePayload): Promise<boolean> => {
      if (!authToken) {
        showToast('Admin authentication required.', 'error');
        return false;
      }
      try {
        const res = await fetch('/api/admin/lottery/digit-draw', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
          showToast(data?.error || 'Failed to update 2D/3D/6D schedule.', 'error');
          return false;
        }
        setLotteryState(data);
        if (payload.releaseNow) {
          showToast(`${payload.gameType} result released & settled.`);
        } else {
          showToast(`${payload.gameType} draw schedule saved.`);
        }
        return true;
      } catch {
        showToast('Network error updating 2D/3D/6D schedule.', 'error');
        return false;
      }
    },
    [authToken, showToast]
  );

  // Handlers
  const handleEnterDemoWorkspace = () => {
    closingIdsRef.current.clear();
    settledIdsRef.current.clear();
    seenSqlTransferIdsRef.current.clear();
    initialWalletSyncDoneRef.current = false;
    pendingWalletDeltasRef.current = 0;
    lastFirestoreSyncedBalRef.current = null;
    setAuthToken(null);
    authTokenRef.current = null;
    setUser(DEMO_USER_TEMPLATE);
    setActiveSection('trade');
    showToast('Entered $100,000 Demo Workspace.');
  };

  const handleGoogleSignIn = async () => {
    try {
      await signInWithPopup(oauthAuth, googleAuthProvider);
      showToast('Signed in with Google.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Google Sign-In failed.';
      showToast(msg, 'error');
    }
  };

  const handleAuthSubmit = async (payload: {
    mode: 'register' | 'login' | 'forgot';
    email: string;
    password: string;
    username: string;
    referralCode: string;
  }) => {
    if (!payload.email) {
      showToast('Please enter your email address.', 'error');
      return;
    }

    try {
      if (payload.mode === 'forgot') {
        await sendPasswordResetEmail(auth, payload.email);
        showToast(`Password reset email sent to ${payload.email}.`);
        return;
      }

      if (!payload.password || payload.password.length < 6) {
        showToast('Password must be at least 6 characters.', 'error');
        return;
      }

      if (payload.mode === 'login' && payload.email.trim().toLowerCase() === 'admin@zectrade.io') {
        const res = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: payload.email,
            password: payload.password,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data?.token || !data?.user) {
          showToast('Invalid email or password.', 'error');
          return;
        }
        setAuthToken(data.token);
        setUser({
          uid: data.user.uid,
          isLoggedIn: true,
          isLocalDemoSession: false,
          username: data.user.username || 'Lead Admin',
          email: data.user.email,
          pin: data.user.securityPin || '8888',
          role: 'admin',
          isBlocked: false,
          isWithdrawBlocked: false,
          invitedBy: null,
          hasDepositedBefore: true,
          hasTradedAfterDeposit: true,
          withdrawLockClearedByAdmin: true,
          demoBalance: Number(data.user.demoBalance ?? 100000),
          realBalance: Number(data.user.realBalance ?? 25000),
          spotHoldings: {},
          avatarUrl: data.user.avatarUrl ?? null,
          fullName: data.user.fullName ?? null,
          phone: data.user.phone ?? null,
          country: data.user.country ?? null,
          bio: data.user.bio ?? null,
          withdrawMethod: (data.user.withdrawMethod as WithdrawMethod | undefined) || 'kpay',
          withdrawAccountName: data.user.withdrawAccountName ?? null,
          withdrawAccountNumber: data.user.withdrawAccountNumber ?? null,
        });
        authTokenRef.current = data.token;
        setActiveSection('lottery');
        fetchLotteryState(data.token);
        fetchAdminMembersFromServer(data.token);
        fetchAdminCoins(data.token);
        fetchAdminNews(data.token);
        syncWalletFromServer({ tokenOverride: data.token, force: true, silent: true });
        showToast('Signed in successfully.');
        return;
      }

      if (payload.mode === 'register') {
        const cred = await createUserWithEmailAndPassword(auth, payload.email, payload.password);
        const name = payload.username || payload.email.split('@')[0];
        await setDoc(doc(db, 'users', cred.user.uid), {
          username: name,
          email: payload.email.toLowerCase(),
          role: 'user',
          securityPin: '1234',
          isBlocked: false,
          isWithdrawBlocked: false,
          invitedBy: payload.referralCode || null,
          hasDepositedBefore: false,
          hasTradedAfterDeposit: false,
          withdrawLockClearedByAdmin: false,
          demoBalance: 100000,
          realBalance: FIRST_REGISTER_REAL_BONUS_USD,
          spotHoldings: {},
          createdAt: serverTimestamp(),
        });
        await addDoc(collection(db, 'users', cred.user.uid, 'transactions'), {
          userId: cred.user.uid,
          userEmail: payload.email.toLowerCase(),
          type: 'SIGN-UP WELCOME BONUS',
          amount: FIRST_REGISTER_REAL_BONUS_USD,
          target: 'Real Account ($2 Bonus)',
          isAdjustment: true,
          status: 'SUCCESS',
          createdAt: serverTimestamp(),
        });
        showToast('Account registered! $2.00 Real bonus credited (deposit & trade required to withdraw).');
      } else {
        await signInWithEmailAndPassword(auth, payload.email, payload.password);
        showToast('Signed in successfully.');
      }
    } catch (err: unknown) {
      const fbErr = err as { code?: string; message?: string };
      let msg = fbErr?.message || 'Authentication error';
      if (fbErr?.code === 'auth/user-not-found' || fbErr?.code === 'auth/invalid-credential') {
        msg = 'Account does not exist or incorrect password.';
      } else if (fbErr?.code === 'auth/wrong-password') {
        msg = 'Incorrect password. Please try again or click Forgot Password.';
      } else if (fbErr?.code === 'auth/email-already-in-use') {
        msg = 'This email is already registered. Please sign in instead.';
      } else if (fbErr?.code === 'auth/invalid-email') {
        msg = 'Please enter a valid email address.';
      }
      showToast(msg, 'error');
    }
  };

  const handlePlaceOrder = async (payload: {
    symbol: MarketSymbol;
    side: OrderSide;
    margin: number;
    leverage: number;
    customEntryPrice: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
  }): Promise<boolean> => {
    if (user.isBlocked) {
      showToast('Your account is currently restricted. Please contact support.', 'error');
      return false;
    }
    const quote = quotes.find((q) => q.symbol === payload.symbol) ?? quotes[0];
    if (!Number.isFinite(payload.margin) || payload.margin <= 0) {
      showToast('Enter a valid margin amount greater than $0.', 'error');
      return false;
    }

    const preview = calculatePositionPreview({
      margin: payload.margin,
      leverage: payload.leverage,
      side: payload.side,
      marketPrice: quote.price,
      customEntryPrice: payload.customEntryPrice,
    });

    const avail = accountMode === 'demo' ? user.demoBalance : user.realBalance;
    if (preview.totalRequired > avail) {
      showToast(`Insufficient ${accountMode.toUpperCase()} balance (Need $${preview.totalRequired.toFixed(2)}).`, 'error');
      return false;
    }

    const conflict = checkOrderDirectionConflict(
      payload.symbol,
      payload.side,
      accountMode,
      activePositions,
      preOrders
    );
    if (!conflict.allowed) {
      showToast(conflict.reason || `Cannot open conflicting order on ${payload.symbol}.`, 'error');
      return false;
    }

    const slTpCheck = validateSlTpTargets(
      payload.side,
      preview.effectiveEntryPrice,
      payload.stopLoss,
      payload.takeProfit
    );
    if (!slTpCheck.valid) {
      showToast(slTpCheck.reason || 'Invalid Stop Loss or Take Profit price.', 'error');
      return false;
    }

    const nextDemo = accountMode === 'demo' ? user.demoBalance - preview.totalRequired : user.demoBalance;
    const nextReal = accountMode === 'real' ? user.realBalance - preview.totalRequired : user.realBalance;
    const tradedReal = accountMode === 'real';

    setUser((prev) => ({
      ...prev,
      demoBalance: nextDemo,
      realBalance: nextReal,
      hasTradedAfterDeposit: tradedReal ? true : prev.hasTradedAfterDeposit,
    }));

    const orderId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const orderData: PreOrder = {
      id: orderId,
      symbol: payload.symbol,
      side: payload.side,
      leverage: payload.leverage,
      entryPrice: preview.effectiveEntryPrice,
      markPrice: quote.price,
      liqPrice: preview.liqPriceFormatted,
      margin: payload.margin,
      btcQty: preview.qty,
      totalValue: preview.totalValue,
      tradingFeePaid: preview.tradeFee,
      fundingFeePaid: 0,
      stopLoss: payload.stopLoss,
      takeProfit: payload.takeProfit,
      openedAt: Date.now(),
      accountMode,
    };

    if (preview.isLimitOrder) {
      setPreOrders((prev) => [...prev, orderData]);
      showToast(`Limit Pre-Order queued for ${payload.symbol} at $${preview.effectiveEntryPrice.toFixed(2)}.`);
    } else {
      setActivePositions((prev) => [...prev, orderData]);
      recordTradeOnServer({
        tradeUid: orderId,
        symbol: payload.symbol,
        side: payload.side,
        leverage: payload.leverage,
        margin: payload.margin,
        entryPrice: preview.effectiveEntryPrice,
        liqPrice: getNumericLiqPrice(orderData),
        tradingFee: preview.tradeFee,
        pnlVal: 0,
        status: 'OPEN',
        accountMode,
      });
      showToast(`Opened ${payload.side.toUpperCase()} ${payload.symbol} (${payload.leverage}x).`);
    }

    if (!user.isLocalDemoSession) {
      applyWalletDeltaOnServer(accountMode, -preview.totalRequired, tradedReal);
    }

    if (!user.isLocalDemoSession && auth.currentUser) {
      try {
        const uid = auth.currentUser.uid;
        await updateDoc(doc(db, 'users', uid), {
          [accountMode === 'demo' ? 'demoBalance' : 'realBalance']: accountMode === 'demo' ? nextDemo : nextReal,
          ...(tradedReal ? { hasTradedAfterDeposit: true } : {}),
        });
        await setDoc(
          doc(db, 'users', uid, preview.isLimitOrder ? 'orders' : 'positions', orderId),
          orderData
        );
      } catch {
        // ignore offline fallback
      }
    }

    return true;
  };

  const handleUpdatePositionSlTp = useCallback(
    async (id: string, stopLoss: number | null, takeProfit: number | null): Promise<boolean> => {
      const pos = stateRef.current.activePositions.find((p) => p.id === id);
      if (!pos) return false;
      const check = validateSlTpTargets(pos.side, pos.entryPrice, stopLoss, takeProfit);
      if (!check.valid) {
        showToast(check.reason || 'Invalid Stop Loss or Take Profit level.', 'error');
        return false;
      }
      setActivePositions((prev) =>
        prev.map((p) => (p.id === id ? { ...p, stopLoss, takeProfit } : p))
      );
      if (!stateRef.current.user.isLocalDemoSession && auth.currentUser) {
        try {
          await updateDoc(doc(db, 'users', auth.currentUser.uid, 'positions', id), {
            stopLoss: stopLoss ?? null,
            takeProfit: takeProfit ?? null,
          });
        } catch {
          // ignore offline fallback
        }
      }
      showToast(`Updated SL/TP for ${pos.symbol}.`);
      return true;
    },
    [showToast]
  );

  const handleChasePreOrder = async (id: string) => {
    const order = preOrders.find((o) => o.id === id);
    if (!order) return;
    const quote = quotes.find((q) => q.symbol === order.symbol);
    const livePrice = quote ? quote.price : order.entryPrice;

    setPreOrders((prev) => prev.filter((o) => o.id !== id));
    setActivePositions((prev) => [...prev, { ...order, entryPrice: livePrice, markPrice: livePrice }]);
    recordTradeOnServer({
      tradeUid: order.id,
      symbol: order.symbol,
      side: order.side,
      leverage: order.leverage,
      margin: order.margin,
      entryPrice: livePrice,
      liqPrice: getNumericLiqPrice({ ...order, entryPrice: livePrice }),
      tradingFee: order.tradingFeePaid,
      pnlVal: 0,
      status: 'OPEN',
      accountMode: order.accountMode,
    });
    showToast(`Order chased to market $${livePrice.toFixed(2)} and opened.`);
  };

  const handleSaveModifiedOrder = async (id: string, entryPrice: number, margin: number) => {
    setPreOrders((prev) =>
      prev.map((o) => (o.id === id ? { ...o, entryPrice, margin, totalValue: margin * o.leverage } : o))
    );
    showToast('Pre-order target updated.');
  };

  const handleCancelPreOrder = async (id: string) => {
    const order = preOrders.find((o) => o.id === id);
    if (!order) return;
    const refund = order.margin + order.tradingFeePaid;
    setPreOrders((prev) => prev.filter((o) => o.id !== id));
    setUser((prev) => ({
      ...prev,
      demoBalance: order.accountMode === 'demo' ? prev.demoBalance + refund : prev.demoBalance,
      realBalance: order.accountMode === 'real' ? prev.realBalance + refund : prev.realBalance,
    }));
    if (!user.isLocalDemoSession) {
      applyWalletDeltaOnServer(order.accountMode, refund);
      if (auth.currentUser) {
        deleteDoc(doc(db, 'users', auth.currentUser.uid, 'orders', id)).catch(() => {});
      }
    }
    showToast('Pre-order cancelled and margin refunded.');
  };

  const handleExecuteSwap = async (
    symbol: MarketSymbol,
    direction: 'usdtToCoin' | 'coinToUsdt',
    amount: number
  ) => {
    if (accountMode !== 'real') {
      showToast('Spot Swap requires Real Account mode.', 'error');
      return;
    }
    const quote = quotes.find((q) => q.symbol === symbol);
    const livePrice = quote ? quote.price : 1;
    const currentHolding = user.spotHoldings[symbol] ?? { units: 0, avgPrice: 0 };

    if (direction === 'usdtToCoin') {
      if (amount <= 0 || amount > user.realBalance) {
        showToast('Insufficient Real USDT balance.', 'error');
        return;
      }
      const { feeUsdt, netOutput } = calculateSpotSwap('usdtToCoin', amount, livePrice);
      const netUsdt = amount - feeUsdt;
      const totalUnits = currentHolding.units + netOutput;
      const totalCost = currentHolding.units * currentHolding.avgPrice + netUsdt;
      const nextHoldings = {
        ...user.spotHoldings,
        [symbol]: { units: totalUnits, avgPrice: totalCost / totalUnits },
      };
      setUser((prev) => ({
        ...prev,
        realBalance: prev.realBalance - amount,
        spotHoldings: nextHoldings,
        hasTradedAfterDeposit: true,
      }));
      if (!user.isLocalDemoSession) {
        applyWalletDeltaOnServer('real', -amount, true);
      }
      if (!user.isLocalDemoSession && auth.currentUser) {
        try {
          await updateDoc(doc(db, 'users', auth.currentUser.uid), {
            realBalance: user.realBalance - amount,
            spotHoldings: nextHoldings,
            hasTradedAfterDeposit: true,
          });
        } catch {
          // ignore
        }
      }
      showToast(`Swapped $${amount.toFixed(2)} USDT into ${netOutput.toFixed(6)} ${symbol}.`);
    } else {
      if (amount <= 0 || amount > currentHolding.units) {
        showToast(`Insufficient ${symbol} holding.`, 'error');
        return;
      }
      const { netOutput } = calculateSpotSwap('coinToUsdt', amount, livePrice);
      const remaining = currentHolding.units - amount;
      const nextHoldings = { ...user.spotHoldings };
      if (remaining <= 0.000001) delete nextHoldings[symbol];
      else nextHoldings[symbol] = { ...currentHolding, units: remaining };

      setUser((prev) => ({
        ...prev,
        realBalance: prev.realBalance + netOutput,
        spotHoldings: nextHoldings,
        hasTradedAfterDeposit: true,
      }));
      if (!user.isLocalDemoSession) {
        applyWalletDeltaOnServer('real', netOutput, true);
      }
      if (!user.isLocalDemoSession && auth.currentUser) {
        try {
          await updateDoc(doc(db, 'users', auth.currentUser.uid), {
            realBalance: user.realBalance + netOutput,
            spotHoldings: nextHoldings,
            hasTradedAfterDeposit: true,
          });
        } catch {
          // ignore
        }
      }
      showToast(`Exchanged ${amount.toFixed(6)} ${symbol} for $${netOutput.toFixed(2)} USDT.`);
    }
  };

  const handleSubmitDeposit = async (method: string, usdAmount: number, targetDesc: string) => {
    const isDemo = user.isLocalDemoSession;
    const typeLabel = `DEPOSIT (${method.toUpperCase()})`;
    const tx: WalletTransaction = {
      id: Date.now().toString(),
      userId: user.uid,
      userEmail: user.email,
      type: typeLabel,
      amount: usdAmount,
      target: targetDesc,
      status: isDemo ? 'APPROVED' : 'PENDING',
      timestamp: new Date().toLocaleString(),
      rawTime: Date.now(),
    };
    setWalletTransactions((prev) => [tx, ...prev]);

    if (isDemo) {
      setUser((prev) => ({
        ...prev,
        realBalance: prev.realBalance + usdAmount,
        hasDepositedBefore: true,
        hasTradedAfterDeposit: false,
        withdrawLockClearedByAdmin: false,
      }));
    }

    if (!isDemo && authToken) {
      try {
        const reqRes = await fetch('/api/wallet/requests', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            requestKind: 'deposit',
            typeLabel: `DEPOSIT SUBMITTED (${method.toUpperCase()})`,
            method,
            amountUsd: usdAmount,
            target: targetDesc,
          }),
        });
        if (reqRes.ok) {
          const reqData = await reqRes.json();
          const createdId = reqData?.request?.id;
          if (createdId) {
            setWalletTransactions((prev) =>
              prev.map((item) =>
                item.id === tx.id ? { ...item, id: `sql-${createdId}` } : item
              )
            );
          }
        }
      } catch {
        // ignore network error
      }
    }

    if (!isDemo && auth.currentUser) {
      try {
        await addDoc(collection(db, 'users', auth.currentUser.uid, 'transactions'), {
          userId: auth.currentUser.uid,
          userEmail: user.email,
          type: `DEPOSIT SUBMITTED (${method.toUpperCase()})`,
          amount: usdAmount,
          target: targetDesc,
          status: 'PENDING',
          createdAt: serverTimestamp(),
        });
      } catch {
        // ignore offline
      }
    }
    showToast(
      isDemo
        ? `Deposit of $${usdAmount.toFixed(2)} credited. Complete 1 Real trade to unlock withdrawals.`
        : `Deposit request of $${usdAmount.toFixed(2)} submitted for verification. Withdrawals unlock once your first deposit is credited.`
    );
  };

  const handleSubmitWithdraw = async (
    method: string,
    usdAmount: number,
    targetDesc: string,
    pin: string
  ): Promise<boolean> => {
    const eligibility = evaluateWithdrawalEligibility(user);
    if (!eligibility.allowed) {
      showToast(eligibility.reason || 'Withdrawals are locked for your account.', 'error');
      return false;
    }
    if (pin !== user.pin) {
      showToast('Incorrect 4-digit Security PIN.', 'error');
      return false;
    }
    if (usdAmount <= 0 || usdAmount > user.realBalance) {
      showToast('Insufficient Real Balance for withdrawal.', 'error');
      return false;
    }
    const nextReal = user.realBalance - usdAmount;
    const typeLabel = `WITHDRAWAL (${method.toUpperCase()})`;
    setUser((prev) => ({ ...prev, realBalance: nextReal }));
    setWalletTransactions((prev) => [
      {
        id: Date.now().toString(),
        userId: user.uid,
        userEmail: user.email,
        type: typeLabel,
        amount: usdAmount,
        target: targetDesc,
        status: 'PENDING',
        timestamp: new Date().toLocaleString(),
        rawTime: Date.now(),
      },
      ...prev,
    ]);

    if (!user.isLocalDemoSession) {
      applyWalletDeltaOnServer('real', -usdAmount);
    }

    if (!user.isLocalDemoSession && authToken) {
      try {
        await fetch('/api/wallet/requests', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            requestKind: 'withdrawal',
            typeLabel,
            method,
            amountUsd: usdAmount,
            target: targetDesc,
          }),
        });
      } catch {
        // ignore network error
      }
    }

    if (!user.isLocalDemoSession && auth.currentUser) {
      try {
        await updateDoc(doc(db, 'users', auth.currentUser.uid), {
          realBalance: nextReal,
        });
        await addDoc(collection(db, 'users', auth.currentUser.uid, 'transactions'), {
          userId: auth.currentUser.uid,
          userEmail: user.email,
          type: typeLabel,
          amount: usdAmount,
          target: targetDesc,
          status: 'PENDING',
          createdAt: serverTimestamp(),
        });
      } catch {
        // ignore offline fallback
      }
    }

    showToast(`Withdrawal request for $${usdAmount.toFixed(2)} submitted.`);
    return true;
  };

  const handleLookupTransferRecipient = useCallback(
    async (
      recipient: string
    ): Promise<
      { ok: true; recipient: VerifiedTransferRecipient } | { ok: false; error: string }
    > => {
      const trimmed = recipient.trim();
      if (!trimmed) {
        return { ok: false, error: 'Enter recipient UID or email.' };
      }
      if (trimmed === user.uid || trimmed.toLowerCase() === user.email.toLowerCase()) {
        return { ok: false, error: 'Cannot transfer to your own account.' };
      }

      try {
        const res = await fetch(
          `/api/wallet/transfer/lookup?identifier=${encodeURIComponent(trimmed)}`
        );
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.recipient) {
          return { ok: true, recipient: data.recipient as VerifiedTransferRecipient };
        }
        if (res.status !== 404) {
          return { ok: false, error: data?.error || "Account doesn't exist." };
        }
      } catch {
        // Fallback to local/Firestore check below
      }

      if (!user.isLocalDemoSession && auth.currentUser) {
        try {
          const uidSnap = await getDoc(doc(db, 'users', trimmed));
          if (uidSnap.exists()) {
            const d = uidSnap.data();
            return {
              ok: true,
              recipient: {
                uid: uidSnap.id,
                username: String(d.username || 'Trader'),
                email: String(d.email || ''),
              },
            };
          }
          const emailSnap = await getDocs(
            query(collection(db, 'users'), where('email', '==', trimmed.toLowerCase()))
          );
          if (!emailSnap.empty) {
            const first = emailSnap.docs[0];
            const d = first.data();
            return {
              ok: true,
              recipient: {
                uid: first.id,
                username: String(d.username || 'Trader'),
                email: String(d.email || ''),
              },
            };
          }
        } catch {
          // Ignore Firestore lookup failure
        }
      }

      return { ok: false, error: "Account doesn't exist." };
    },
    [user.uid, user.email, user.isLocalDemoSession]
  );

  const handleSubmitTransfer = async (
    recipient: string,
    amount: number,
    pin: string
  ): Promise<{ ok: boolean; error?: string }> => {
    if (pin !== user.pin) {
      showToast('Incorrect 4-digit Security PIN.', 'error');
      return { ok: false, error: 'Incorrect 4-digit Security PIN.' };
    }
    const avail = accountMode === 'demo' ? user.demoBalance : user.realBalance;
    if (!Number.isFinite(amount) || amount < 1 || amount > avail) {
      const msg =
        amount < 1
          ? 'Minimum transfer amount is $1.00.'
          : `Insufficient ${accountMode.toUpperCase()} balance.`;
      showToast(msg, 'error');
      return { ok: false, error: msg };
    }
    if (recipient === user.uid || recipient.toLowerCase() === user.email.toLowerCase()) {
      showToast('Cannot transfer to your own account.', 'error');
      return { ok: false, error: 'Cannot transfer to your own account.' };
    }

    let resolvedRecipient: VerifiedTransferRecipient = {
      uid: recipient,
      username: recipient,
      email: recipient,
    };
    let nextSenderBalance = Number((avail - amount).toFixed(2));
    let nextRecipientBalance: number | null = null;

    try {
      const res = await fetch('/api/wallet/transfer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          senderUid: user.uid,
          senderEmail: user.email,
          recipientIdentifier: recipient,
          accountMode,
          amount,
          pin,
          localSenderBalance: avail,
          expectedPin: user.pin,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMsg = typeof data?.error === 'string' ? data.error : "Account doesn't exist.";
        showToast(errMsg, 'error');
        return { ok: false, error: errMsg };
      }
      if (data?.recipient) {
        resolvedRecipient = {
          uid: String(data.recipient.uid),
          username: String(data.recipient.username || data.recipient.uid),
          email: String(data.recipient.email || ''),
        };
        if (typeof data.recipient.newBalance === 'number') {
          nextRecipientBalance = Number(data.recipient.newBalance);
        }
      }
      if (typeof data?.senderRemainingBalance === 'number') {
        nextSenderBalance = Number(data.senderRemainingBalance);
      }
    } catch {
      showToast('Unable to verify transfer on server. Please try again.', 'error');
      return { ok: false, error: 'Unable to verify transfer on server.' };
    }

    setUser((prev) => ({
      ...prev,
      demoBalance: accountMode === 'demo' ? nextSenderBalance : prev.demoBalance,
      realBalance: accountMode === 'real' ? nextSenderBalance : prev.realBalance,
    }));

    setManagedMembers((prev) =>
      prev.map((m) => {
        if (
          m.uid !== resolvedRecipient.uid &&
          m.email.toLowerCase() !== resolvedRecipient.email.toLowerCase()
        ) {
          return m;
        }
        return {
          ...m,
          realBalance:
            accountMode === 'real'
              ? nextRecipientBalance ?? Number((m.realBalance + amount).toFixed(2))
              : m.realBalance,
          demoBalance:
            accountMode === 'demo'
              ? nextRecipientBalance ?? Number((m.demoBalance + amount).toFixed(2))
              : m.demoBalance,
        };
      })
    );

    const targetLabel = `${resolvedRecipient.username} (${resolvedRecipient.uid})`;
    setWalletTransactions((prev) => [
      {
        id: `${Date.now()}-p2p`,
        userId: user.uid,
        userEmail: user.email,
        type: `P2P TRANSFER SENT (${accountMode.toUpperCase()})`,
        amount,
        target: targetLabel,
        status: 'SUCCESS',
        timestamp: new Date().toLocaleString(),
        rawTime: Date.now(),
      },
      ...prev,
    ]);

    if (!user.isLocalDemoSession && auth.currentUser) {
      const balField = accountMode === 'demo' ? 'demoBalance' : 'realBalance';
      try {
        await updateDoc(doc(db, 'users', auth.currentUser.uid), {
          [balField]: nextSenderBalance,
        });
        await addDoc(collection(db, 'users', auth.currentUser.uid, 'transactions'), {
          userId: auth.currentUser.uid,
          userEmail: user.email,
          type: `P2P TRANSFER SENT (${accountMode.toUpperCase()})`,
          amount,
          target: targetLabel,
          status: 'SUCCESS',
          createdAt: serverTimestamp(),
        });
      } catch {
        // Cloud SQL already completed atomically
      }
      if (nextRecipientBalance !== null) {
        updateDoc(doc(db, 'users', resolvedRecipient.uid), {
          [balField]: nextRecipientBalance,
        }).catch(() => {});
        addDoc(collection(db, 'users', resolvedRecipient.uid, 'transactions'), {
          userId: resolvedRecipient.uid,
          userEmail: resolvedRecipient.email,
          type: `P2P TRANSFER RECEIVED (${accountMode.toUpperCase()})`,
          amount,
          target: `${user.username} (${user.uid})`,
          status: 'SUCCESS',
          createdAt: serverTimestamp(),
        }).catch(() => {});
      }
    }

    showToast(`Transferred $${amount.toFixed(2)} to ${resolvedRecipient.username} (${resolvedRecipient.uid}).`);
    return { ok: true };
  };

  const handleSavePin = async (pin: string) => {
    setUser((prev) => ({ ...prev, pin }));
    if (authToken) {
      try {
        await fetch('/api/profile/pin', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ pin }),
        });
      } catch {
        // ignore network error
      }
    }
    if (!user.isLocalDemoSession && auth.currentUser) {
      try {
        await updateDoc(doc(db, 'users', auth.currentUser.uid), { securityPin: pin });
      } catch {
        // ignore
      }
    }
    showToast('Security PIN updated.');
  };

  const handleSaveOwnProfile = async (payload: MemberProfileUpdatePayload): Promise<boolean> => {
    if (authToken && !user.isLocalDemoSession) {
      try {
        const res = await fetch('/api/profile', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
          showToast(data?.error || 'Failed to update profile.', 'error');
          return false;
        }
        if (data?.user) {
          const u = data.user as Record<string, unknown>;
          setUser((prev) => ({
            ...prev,
            username: String(u.username || payload.username || prev.username),
            avatarUrl: (u.avatarUrl as string | null | undefined) ?? null,
            fullName: (u.fullName as string | null | undefined) ?? null,
            phone: (u.phone as string | null | undefined) ?? null,
            country: (u.country as string | null | undefined) ?? null,
            bio: (u.bio as string | null | undefined) ?? null,
            withdrawMethod: (u.withdrawMethod as WithdrawMethod | undefined) ?? prev.withdrawMethod,
            withdrawAccountName: (u.withdrawAccountName as string | null | undefined) ?? null,
            withdrawAccountNumber: (u.withdrawAccountNumber as string | null | undefined) ?? null,
          }));
        }
      } catch {
        showToast('Network error saving profile.', 'error');
        return false;
      }
    } else {
      setUser((prev) => ({
        ...prev,
        username: payload.username ?? prev.username,
        avatarUrl: payload.avatarUrl !== undefined ? payload.avatarUrl : prev.avatarUrl,
        fullName: payload.fullName !== undefined ? payload.fullName : prev.fullName,
        phone: payload.phone !== undefined ? payload.phone : prev.phone,
        country: payload.country !== undefined ? payload.country : prev.country,
        bio: payload.bio !== undefined ? payload.bio : prev.bio,
        withdrawMethod: payload.withdrawMethod ?? prev.withdrawMethod,
        withdrawAccountName:
          payload.withdrawAccountName !== undefined
            ? payload.withdrawAccountName
            : prev.withdrawAccountName,
        withdrawAccountNumber:
          payload.withdrawAccountNumber !== undefined
            ? payload.withdrawAccountNumber
            : prev.withdrawAccountNumber,
      }));
    }

    if (!user.isLocalDemoSession && auth.currentUser) {
      try {
        await updateDoc(doc(db, 'users', auth.currentUser.uid), {
          ...(payload.username ? { username: payload.username } : {}),
          avatarUrl: payload.avatarUrl ?? null,
          fullName: payload.fullName ?? null,
          phone: payload.phone ?? null,
          country: payload.country ?? null,
          bio: payload.bio ?? null,
          ...(payload.withdrawMethod ? { withdrawMethod: payload.withdrawMethod } : {}),
          withdrawAccountName: payload.withdrawAccountName ?? null,
          withdrawAccountNumber: payload.withdrawAccountNumber ?? null,
        });
      } catch {
        // ignore Firestore rule errors cleanly
      }
    }

    showToast('Profile and withdraw account saved.');
    return true;
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch {
      // ignore
    }
    try {
      await signOut(oauthAuth);
    } catch {
      // ignore
    }
    localStorage.removeItem(STORAGE_KEY);
    closingIdsRef.current.clear();
    settledIdsRef.current.clear();
    seenSqlTransferIdsRef.current.clear();
    initialWalletSyncDoneRef.current = false;
    pendingWalletDeltasRef.current = 0;
    lastFirestoreSyncedBalRef.current = null;
    setAuthToken(null);
    authTokenRef.current = null;
    setUser({ ...DEMO_USER_TEMPLATE, isLoggedIn: false });
    setActiveSection('trade');
    showToast('Signed out.');
  };

  const copyText = (val: string, label: string) => {
    navigator.clipboard?.writeText(val);
    showToast(`Copied ${label}: ${val}`);
  };

  const handleAddPriceAlert = (
    symbol: MarketSymbol,
    condition: AlertCondition,
    targetPrice: number
  ) => {
    if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
      showToast('Enter a valid target price above $0.', 'error');
      return;
    }
    const newAlert: PriceAlert = {
      id: `al-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      symbol,
      condition,
      targetPrice,
      triggered: false,
      createdAt: new Date().toLocaleTimeString(),
    };
    setPriceAlerts((prev) => [newAlert, ...prev]);
    showToast(
      `Price alert armed: ${symbol} ${condition === 'above' ? '>=' : '<='} $${targetPrice.toFixed(2)}`
    );
  };

  const handleRemovePriceAlert = (id: string) => {
    setPriceAlerts((prev) => prev.filter((a) => a.id !== id));
    showToast('Price alert removed.');
  };

  const handleRearmPriceAlert = (id: string) => {
    setPriceAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, triggered: false, triggeredAt: undefined } : a))
    );
    showToast('Price alert re-armed.');
  };

  const handleSearchMembers = async (queryText: string) => {
    const isStaffSearch = ['admin', 'staff', 'caiwu'].includes(user.role);
    if (!isStaffSearch) return;
    if (user.isLocalDemoSession && !authToken) {
      return;
    }

    const merged = new Map<string, ManagedMember>();
    if (authToken && isStaffSearch) {
      try {
        const url = queryText
          ? `/api/admin/members?q=${encodeURIComponent(queryText)}`
          : '/api/admin/members';
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data?.members)) {
            for (const m of data.members as Record<string, unknown>[]) {
              const uid = String(m.uid || '');
              if (!uid) continue;
              merged.set(uid, {
                uid,
                username: String(m.username || 'Trader'),
                email: String(m.email || ''),
                role: (m.role as UserRole) || 'user',
                isBlocked: Boolean(m.isBlocked),
                isWithdrawBlocked: Boolean(m.isWithdrawBlocked),
                hasDepositedBefore: Boolean(m.hasDepositedBefore),
                hasTradedAfterDeposit: Boolean(m.hasTradedAfterDeposit),
                withdrawLockClearedByAdmin: Boolean(m.withdrawLockClearedByAdmin),
                realBalance: Number(m.realBalance ?? 0),
                demoBalance: Number(m.demoBalance ?? 100000),
                securityPin: m.securityPin ? String(m.securityPin) : undefined,
                invitedBy: m.invitedBy ? String(m.invitedBy) : null,
                avatarUrl: m.avatarUrl ? String(m.avatarUrl) : null,
                fullName: m.fullName ? String(m.fullName) : null,
                phone: m.phone ? String(m.phone) : null,
                country: m.country ? String(m.country) : null,
                bio: m.bio ? String(m.bio) : null,
                withdrawMethod: (m.withdrawMethod as WithdrawMethod | undefined) || 'kpay',
                withdrawAccountName: m.withdrawAccountName ? String(m.withdrawAccountName) : null,
                withdrawAccountNumber: m.withdrawAccountNumber ? String(m.withdrawAccountNumber) : null,
              });
            }
          }
        }
      } catch {
        // continue to Firestore fallback/merge
      }
    }

    if (!user.isLocalDemoSession && auth.currentUser) {
      try {
        const toMember = (id: string, d: Record<string, unknown>): ManagedMember => ({
          uid: id,
          username: String(d.username || 'Trader'),
          email: String(d.email || ''),
          role: (d.role as UserRole) || 'user',
          isBlocked: !!d.isBlocked,
          isWithdrawBlocked: !!d.isWithdrawBlocked,
          hasDepositedBefore: !!d.hasDepositedBefore,
          hasTradedAfterDeposit: !!d.hasTradedAfterDeposit,
          withdrawLockClearedByAdmin: !!d.withdrawLockClearedByAdmin,
          realBalance: Number(d.realBalance ?? 0),
          demoBalance: Number(d.demoBalance ?? 100000),
          securityPin: d.securityPin ? String(d.securityPin) : undefined,
          invitedBy: d.invitedBy ? String(d.invitedBy) : null,
          avatarUrl: d.avatarUrl ? String(d.avatarUrl) : null,
          fullName: d.fullName ? String(d.fullName) : null,
          phone: d.phone ? String(d.phone) : null,
          country: d.country ? String(d.country) : null,
          bio: d.bio ? String(d.bio) : null,
          withdrawMethod: (d.withdrawMethod as WithdrawMethod | undefined) || 'kpay',
          withdrawAccountName: d.withdrawAccountName ? String(d.withdrawAccountName) : null,
          withdrawAccountNumber: d.withdrawAccountNumber ? String(d.withdrawAccountNumber) : null,
        });

        if (queryText) {
          const directSnap = await getDoc(doc(db, 'users', queryText));
          if (directSnap.exists()) {
            const m = toMember(directSnap.id, directSnap.data());
            if (!merged.has(m.uid)) merged.set(m.uid, m);
          } else {
            const emailSnap = await getDocs(
              query(collection(db, 'users'), where('email', '==', queryText.toLowerCase()))
            );
            emailSnap.forEach((docSnap) => {
              const m = toMember(docSnap.id, docSnap.data());
              if (!merged.has(m.uid)) merged.set(m.uid, m);
            });
          }
        } else {
          const allSnap = await getDocs(collection(db, 'users'));
          allSnap.forEach((docSnap) => {
            const m = toMember(docSnap.id, docSnap.data());
            if (!merged.has(m.uid)) merged.set(m.uid, m);
          });
        }
      } catch {
        // Silently ignore if Firestore rules restrict cross-user reads
      }
    }

    if (merged.size > 0) {
      setManagedMembers((prev) => {
        const map = new Map(prev.map((m) => [m.uid, m]));
        for (const [id, item] of merged.entries()) map.set(id, item);
        return Array.from(map.values());
      });
    }
  };

  const patchMemberServer = async (uid: string, body: Record<string, unknown>) => {
    if (!authToken) return;
    try {
      await fetch(`/api/admin/members/${encodeURIComponent(uid)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(body),
      });
    } catch {
      // ignore network error gracefully
    }
  };

  const handleToggleBlockMember = async (uid: string, blocked: boolean) => {
    if (!['admin', 'staff', 'caiwu'].includes(user.role)) {
      showToast('Staff permission required to block or unblock members.', 'error');
      return;
    }
    const target = managedMembers.find((m) => m.uid === uid) ?? (uid === user.uid ? user : undefined);
    setManagedMembers((prev) =>
      prev.map((m) => (m.uid === uid ? { ...m, isBlocked: blocked } : m))
    );
    if (uid === user.uid) {
      setUser((prev) => ({ ...prev, isBlocked: blocked }));
    }
    await patchMemberServer(uid, { isBlocked: blocked });
    if (!user.isLocalDemoSession && auth.currentUser) {
      try {
        await updateDoc(doc(db, 'users', uid), { isBlocked: blocked });
      } catch {
        // ignore offline fallback
      }
    }
    showToast(
      `${target?.username ?? uid} has been ${blocked ? 'BLOCKED' : 'UNBLOCKED'}.`,
      blocked ? 'error' : 'success'
    );
  };

  const handleToggleWithdrawBlock = async (uid: string, blocked: boolean) => {
    if (!['admin', 'staff', 'caiwu'].includes(user.role)) {
      showToast('Staff permission required to lock or unlock member withdrawals.', 'error');
      return;
    }
    const target = managedMembers.find((m) => m.uid === uid) ?? (uid === user.uid ? user : undefined);
    setManagedMembers((prev) =>
      prev.map((m) =>
        m.uid === uid
          ? {
              ...m,
              isWithdrawBlocked: blocked,
              ...(user.role === 'admin' ? { withdrawLockClearedByAdmin: !blocked } : {}),
            }
          : m
      )
    );
    if (uid === user.uid) {
      setUser((prev) => ({
        ...prev,
        isWithdrawBlocked: blocked,
        ...(user.role === 'admin' ? { withdrawLockClearedByAdmin: !blocked } : {}),
      }));
    }
    await patchMemberServer(uid, {
      isWithdrawBlocked: blocked,
      ...(user.role === 'admin' ? { withdrawLockClearedByAdmin: !blocked } : {}),
    });
    if (!user.isLocalDemoSession && auth.currentUser) {
      try {
        await updateDoc(doc(db, 'users', uid), {
          isWithdrawBlocked: blocked,
          ...(user.role === 'admin' ? { withdrawLockClearedByAdmin: !blocked } : {}),
        });
      } catch {
        // ignore offline fallback
      }
    }
    showToast(
      `Withdrawals ${blocked ? 'locked' : 'unlocked'} for ${target?.username ?? uid}.`,
      blocked ? 'error' : 'success'
    );
  };

  const handleClearWithdrawLock = async (uid: string) => {
    if (!canClearWithdrawLock(user.role)) {
      showToast('Only Admin can clear member withdrawal locks.', 'error');
      return;
    }
    const target = managedMembers.find((m) => m.uid === uid) ?? (uid === user.uid ? user : undefined);
    setManagedMembers((prev) =>
      prev.map((m) =>
        m.uid === uid
          ? { ...m, isWithdrawBlocked: false, withdrawLockClearedByAdmin: true }
          : m
      )
    );
    if (uid === user.uid) {
      setUser((prev) => ({
        ...prev,
        isWithdrawBlocked: false,
        withdrawLockClearedByAdmin: true,
      }));
    }
    await patchMemberServer(uid, {
      isWithdrawBlocked: false,
      withdrawLockClearedByAdmin: true,
    });
    if (!user.isLocalDemoSession && auth.currentUser) {
      try {
        await updateDoc(doc(db, 'users', uid), {
          isWithdrawBlocked: false,
          withdrawLockClearedByAdmin: true,
        });
      } catch {
        // ignore offline fallback
      }
    }
    showToast(`Admin cleared withdrawal lock for ${target?.username ?? uid}.`);
  };

  const handleAdjustMemberBalance = async (
    uid: string,
    wallet: 'real' | 'demo',
    action: 'add' | 'deduct',
    amount: number
  ) => {
    if (!canClearWithdrawLock(user.role)) {
      showToast('Only Admin can adjust member balances.', 'error');
      return;
    }
    const target = managedMembers.find((m) => m.uid === uid) ?? (uid === user.uid ? user : undefined);
    if (!target || amount <= 0) return;
    const currentVal = wallet === 'real' ? target.realBalance : target.demoBalance;
    const nextVal = action === 'add' ? currentVal + amount : Math.max(0, currentVal - amount);
    const field = wallet === 'real' ? 'realBalance' : 'demoBalance';

    setManagedMembers((prev) =>
      prev.map((m) => (m.uid === uid ? { ...m, [field]: nextVal } : m))
    );
    if (uid === user.uid) {
      setUser((prev) => ({ ...prev, [field]: nextVal }));
    }
    await patchMemberServer(uid, { [field]: nextVal });
    if (!user.isLocalDemoSession && auth.currentUser) {
      try {
        await updateDoc(doc(db, 'users', uid), { [field]: nextVal });
      } catch {
        // ignore
      }
    }
    showToast(
      `${action === 'add' ? 'Added' : 'Deducted'} $${amount.toFixed(2)} (${wallet.toUpperCase()}) for ${target.username}.`
    );
  };

  const handleAssignMemberRole = async (uid: string, role: UserRole) => {
    if (!canClearWithdrawLock(user.role)) {
      showToast('Only Admin can assign member roles.', 'error');
      return;
    }
    const target = managedMembers.find((m) => m.uid === uid) ?? (uid === user.uid ? user : undefined);
    setManagedMembers((prev) => prev.map((m) => (m.uid === uid ? { ...m, role } : m)));
    if (uid === user.uid) {
      setUser((prev) => ({ ...prev, role }));
    }
    await patchMemberServer(uid, { role });
    if (!user.isLocalDemoSession && auth.currentUser) {
      try {
        await updateDoc(doc(db, 'users', uid), { role });
      } catch {
        // ignore
      }
    }
    showToast(`Updated ${target?.username ?? uid} role to ${role.toUpperCase()}.`);
  };

  const handleAdminUpdateMemberProfile = async (
    uid: string,
    payload: MemberProfileUpdatePayload
  ): Promise<boolean> => {
    if (!canClearWithdrawLock(user.role)) {
      showToast('Only Full Admin can edit member profiles.', 'error');
      return false;
    }

    let updatedFromServer: Record<string, unknown> | null = null;
    if (authToken) {
      try {
        const res = await fetch(`/api/admin/members/${encodeURIComponent(uid)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
          showToast(data?.error || 'Failed to update member info.', 'error');
          return false;
        }
        if (data?.member) {
          updatedFromServer = data.member as Record<string, unknown>;
        }
      } catch {
        showToast('Network error updating member profile.', 'error');
        return false;
      }
    }

    const patchMemberObj = (existing: ManagedMember): ManagedMember => {
      if (updatedFromServer) {
        return {
          ...existing,
          username: String(updatedFromServer.username || existing.username),
          email: String(updatedFromServer.email || existing.email),
          securityPin: updatedFromServer.securityPin
            ? String(updatedFromServer.securityPin)
            : existing.securityPin,
          avatarUrl: (updatedFromServer.avatarUrl as string | null | undefined) ?? null,
          fullName: (updatedFromServer.fullName as string | null | undefined) ?? null,
          phone: (updatedFromServer.phone as string | null | undefined) ?? null,
          country: (updatedFromServer.country as string | null | undefined) ?? null,
          bio: (updatedFromServer.bio as string | null | undefined) ?? null,
          withdrawMethod:
            (updatedFromServer.withdrawMethod as WithdrawMethod | undefined) ??
            existing.withdrawMethod,
          withdrawAccountName:
            (updatedFromServer.withdrawAccountName as string | null | undefined) ?? null,
          withdrawAccountNumber:
            (updatedFromServer.withdrawAccountNumber as string | null | undefined) ?? null,
        };
      }
      return {
        ...existing,
        username: payload.username ?? existing.username,
        email: payload.email ?? existing.email,
        securityPin: payload.securityPin ?? existing.securityPin,
        avatarUrl: payload.avatarUrl !== undefined ? payload.avatarUrl : existing.avatarUrl,
        fullName: payload.fullName !== undefined ? payload.fullName : existing.fullName,
        phone: payload.phone !== undefined ? payload.phone : existing.phone,
        country: payload.country !== undefined ? payload.country : existing.country,
        bio: payload.bio !== undefined ? payload.bio : existing.bio,
        withdrawMethod: payload.withdrawMethod ?? existing.withdrawMethod,
        withdrawAccountName:
          payload.withdrawAccountName !== undefined
            ? payload.withdrawAccountName
            : existing.withdrawAccountName,
        withdrawAccountNumber:
          payload.withdrawAccountNumber !== undefined
            ? payload.withdrawAccountNumber
            : existing.withdrawAccountNumber,
      };
    };

    setManagedMembers((prev) => prev.map((m) => (m.uid === uid ? patchMemberObj(m) : m)));

    if (uid === user.uid) {
      setUser((prev) => ({
        ...prev,
        username: (updatedFromServer?.username as string | undefined) ?? payload.username ?? prev.username,
        email: (updatedFromServer?.email as string | undefined) ?? payload.email ?? prev.email,
        pin: (updatedFromServer?.securityPin as string | undefined) ?? payload.securityPin ?? prev.pin,
        avatarUrl:
          updatedFromServer !== null
            ? ((updatedFromServer.avatarUrl as string | null | undefined) ?? null)
            : payload.avatarUrl !== undefined
            ? payload.avatarUrl
            : prev.avatarUrl,
        fullName:
          updatedFromServer !== null
            ? ((updatedFromServer.fullName as string | null | undefined) ?? null)
            : payload.fullName !== undefined
            ? payload.fullName
            : prev.fullName,
        phone:
          updatedFromServer !== null
            ? ((updatedFromServer.phone as string | null | undefined) ?? null)
            : payload.phone !== undefined
            ? payload.phone
            : prev.phone,
        country:
          updatedFromServer !== null
            ? ((updatedFromServer.country as string | null | undefined) ?? null)
            : payload.country !== undefined
            ? payload.country
            : prev.country,
        bio:
          updatedFromServer !== null
            ? ((updatedFromServer.bio as string | null | undefined) ?? null)
            : payload.bio !== undefined
            ? payload.bio
            : prev.bio,
        withdrawMethod:
          (updatedFromServer?.withdrawMethod as WithdrawMethod | undefined) ??
          payload.withdrawMethod ??
          prev.withdrawMethod,
        withdrawAccountName:
          updatedFromServer !== null
            ? ((updatedFromServer.withdrawAccountName as string | null | undefined) ?? null)
            : payload.withdrawAccountName !== undefined
            ? payload.withdrawAccountName
            : prev.withdrawAccountName,
        withdrawAccountNumber:
          updatedFromServer !== null
            ? ((updatedFromServer.withdrawAccountNumber as string | null | undefined) ?? null)
            : payload.withdrawAccountNumber !== undefined
            ? payload.withdrawAccountNumber
            : prev.withdrawAccountNumber,
      }));
    }

    if (!user.isLocalDemoSession && auth.currentUser) {
      try {
        await updateDoc(doc(db, 'users', uid), {
          ...(payload.username ? { username: payload.username } : {}),
          ...(payload.email ? { email: payload.email.toLowerCase() } : {}),
          ...(payload.securityPin ? { securityPin: payload.securityPin } : {}),
          avatarUrl: payload.avatarUrl ?? null,
          fullName: payload.fullName ?? null,
          phone: payload.phone ?? null,
          country: payload.country ?? null,
          bio: payload.bio ?? null,
          ...(payload.withdrawMethod ? { withdrawMethod: payload.withdrawMethod } : {}),
          withdrawAccountName: payload.withdrawAccountName ?? null,
          withdrawAccountNumber: payload.withdrawAccountNumber ?? null,
        });
      } catch {
        // ignore Firestore rule errors cleanly
      }
    }

    showToast(`Saved profile & withdraw details for ${payload.username || uid}.`);
    return true;
  };

  const handleApproveDeposit = async (req: StaffWalletRequest) => {
    if (!['admin', 'staff', 'caiwu'].includes(user.role)) {
      showToast('Permission denied.', 'error');
      return;
    }
    if (req.serverId && authToken) {
      try {
        const res = await fetch(`/api/staff/deposits/${req.serverId}/approve`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.member) {
            const m = data.member as Record<string, unknown>;
            const nextReal = Number(m.realBalance ?? 0);
            setManagedMembers((prev) =>
              prev.map((item) =>
                item.uid === req.userId
                  ? { ...item, realBalance: nextReal, hasDepositedBefore: true }
                  : item
              )
            );
            if (req.userId === user.uid) {
              setUser((prev) => ({ ...prev, realBalance: nextReal, hasDepositedBefore: true }));
            }
          }
        }
      } catch {
        // continue gracefully
      }
    }

    if (!req.serverId && req.source === 'firestore' && authToken) {
      try {
        await fetch('/api/admin/adjust-balance', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            identifier: req.userId,
            wallet: 'real',
            action: 'add',
            amount: req.amount,
          }),
        });
        await patchMemberServer(req.userId, { hasDepositedBefore: true });
      } catch {
        // continue gracefully
      }
    }

    if (req.firestorePath && auth.currentUser) {
      try {
        const segments = req.firestorePath.split('/');
        const txDocRef = doc(db, segments[0], ...segments.slice(1));
        await updateDoc(txDocRef, { status: 'SUCCESS' });

        const uRef = doc(db, 'users', req.userId);
        const uSnap = await getDoc(uRef);
        if (uSnap.exists()) {
          const ud = uSnap.data();
          const newReal = Number(ud.realBalance || 0) + req.amount;
          const isFirstDeposit = !ud.hasDepositedBefore;
          await updateDoc(uRef, {
            realBalance: newReal,
            hasDepositedBefore: true,
          });
          if (isFirstDeposit && ud.invitedBy && ud.invitedBy !== req.userId) {
            const refRef = doc(db, 'users', String(ud.invitedBy));
            const refSnap = await getDoc(refRef);
            if (refSnap.exists()) {
              const refBal = Number(refSnap.data().realBalance || 0);
              const bonus = req.amount * 0.02;
              await updateDoc(refRef, { realBalance: refBal + bonus });
              await addDoc(collection(db, 'users', String(ud.invitedBy), 'transactions'), {
                userId: String(ud.invitedBy),
                type: 'REFERRAL BONUS (2% 1ST DEPOSIT REWARD)',
                amount: bonus,
                target: 'Real Account',
                isAdjustment: true,
                status: 'SUCCESS',
                createdAt: serverTimestamp(),
              });
            }
          }
        }
      } catch {
        // ignore Firestore rule errors
      }
    }

    if (req.source === 'local') {
      const rawId = req.id.replace(/^loc-/, '');
      setWalletTransactions((prev) =>
        prev.map((tx) => (tx.id === rawId ? { ...tx, status: 'APPROVED' } : tx))
      );
      setManagedMembers((prev) =>
        prev.map((m) =>
          m.uid === req.userId
            ? { ...m, realBalance: m.realBalance + req.amount, hasDepositedBefore: true }
            : m
        )
      );
      if (req.userId === user.uid) {
        setUser((prev) => ({
          ...prev,
          realBalance: prev.realBalance + req.amount,
          hasDepositedBefore: true,
        }));
      }
    }

    setPendingDeposits((prev) => prev.filter((item) => item.id !== req.id));
    showToast(`Deposit of $${req.amount.toFixed(2)} approved & credited!`);
    await loadStaffRequests();
  };

  const handleRejectDeposit = async (req: StaffWalletRequest) => {
    if (!['admin', 'staff', 'caiwu'].includes(user.role)) {
      showToast('Permission denied.', 'error');
      return;
    }
    if (req.serverId && authToken) {
      try {
        await fetch(`/api/staff/deposits/${req.serverId}/reject`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ reason: 'Verification declined. Please check details or contact support.' }),
        });
      } catch {
        // ignore
      }
    }
    if (req.firestorePath && auth.currentUser) {
      try {
        const segments = req.firestorePath.split('/');
        await updateDoc(doc(db, segments[0], ...segments.slice(1)), {
          status: 'FAILED',
          rejectReason: 'Verification declined. Please check details or contact support.',
        });
      } catch {
        // ignore
      }
    }
    if (req.source === 'local') {
      const rawId = req.id.replace(/^loc-/, '');
      setWalletTransactions((prev) =>
        prev.map((tx) => (tx.id === rawId ? { ...tx, status: 'REJECTED' } : tx))
      );
    }
    setPendingDeposits((prev) => prev.filter((item) => item.id !== req.id));
    showToast('Deposit request rejected.', 'error');
    await loadStaffRequests();
  };

  const handleApproveWithdrawal = async (req: StaffWalletRequest) => {
    if (!['admin', 'staff', 'chukuan'].includes(user.role)) {
      showToast('Permission denied.', 'error');
      return;
    }
    if (req.serverId && authToken) {
      try {
        await fetch(`/api/staff/withdrawals/${req.serverId}/approve`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
        });
      } catch {
        // ignore
      }
    }
    if (req.firestorePath && auth.currentUser) {
      try {
        const segments = req.firestorePath.split('/');
        await updateDoc(doc(db, segments[0], ...segments.slice(1)), {
          status: 'SUCCESS',
        });
      } catch {
        // ignore
      }
    }
    if (req.source === 'local') {
      const rawId = req.id.replace(/^loc-/, '');
      setWalletTransactions((prev) =>
        prev.map((tx) => (tx.id === rawId ? { ...tx, status: 'SUCCESS' } : tx))
      );
    }
    setPendingWithdrawals((prev) => prev.filter((item) => item.id !== req.id));
    showToast(`Withdrawal approved for payout ($${req.amount.toFixed(2)}).`);
    await loadStaffRequests();
  };

  const handleRejectWithdrawal = async (req: StaffWalletRequest, reason: string) => {
    if (!['admin', 'staff', 'chukuan'].includes(user.role)) {
      showToast('Permission denied.', 'error');
      return;
    }
    if (!reason.trim()) {
      showToast('Rejection reason is mandatory.', 'error');
      return;
    }
    if (req.serverId && authToken) {
      try {
        const res = await fetch(`/api/staff/withdrawals/${req.serverId}/reject`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ reason }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.member) {
            const m = data.member as Record<string, unknown>;
            const nextReal = Number(m.realBalance ?? 0);
            setManagedMembers((prev) =>
              prev.map((item) => (item.uid === req.userId ? { ...item, realBalance: nextReal } : item))
            );
            if (req.userId === user.uid) {
              setUser((prev) => ({ ...prev, realBalance: nextReal }));
            }
          }
        }
      } catch {
        // ignore
      }
    }
    if (req.firestorePath && auth.currentUser) {
      try {
        const segments = req.firestorePath.split('/');
        await updateDoc(doc(db, segments[0], ...segments.slice(1)), {
          status: 'FAILED',
          rejectReason: reason,
        });
        const uRef = doc(db, 'users', req.userId);
        const uSnap = await getDoc(uRef);
        if (uSnap.exists()) {
          await updateDoc(uRef, {
            realBalance: Number(uSnap.data().realBalance || 0) + req.amount,
          });
        }
      } catch {
        // ignore
      }
    }
    if (req.source === 'local') {
      const rawId = req.id.replace(/^loc-/, '');
      setWalletTransactions((prev) =>
        prev.map((tx) =>
          tx.id === rawId ? { ...tx, status: 'REJECTED', rejectReason: reason } : tx
        )
      );
      setManagedMembers((prev) =>
        prev.map((m) => (m.uid === req.userId ? { ...m, realBalance: m.realBalance + req.amount } : m))
      );
      if (req.userId === user.uid) {
        setUser((prev) => ({ ...prev, realBalance: prev.realBalance + req.amount }));
      }
    }
    setPendingWithdrawals((prev) => prev.filter((item) => item.id !== req.id));
    showToast(`Withdrawal rejected & $${req.amount.toFixed(2)} refunded.`, 'error');
    await loadStaffRequests();
  };

  const handleExecuteBalanceAdjustByTarget = async (payload: {
    identifier: string;
    wallet: 'real' | 'demo';
    action: 'add' | 'deduct';
    amount: number;
    reason: string;
  }): Promise<boolean> => {
    if (!canClearWithdrawLock(user.role) && !authToken) {
      showToast('Only Full Admin can execute member balance adjustments.', 'error');
      return false;
    }

    const q = payload.identifier.trim().toLowerCase();
    const isLocalOnlyDemoTarget =
      user.isLocalDemoSession && (q === user.uid.toLowerCase() || q === user.email.toLowerCase());
    let updatedMember: ManagedMember | null = null;

    if (authToken && !isLocalOnlyDemoTarget) {
      try {
        const res = await fetch('/api/admin/adjust-balance', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.member) {
            const m = data.member as Record<string, unknown>;
            updatedMember = {
              uid: String(m.uid || ''),
              username: String(m.username || 'Trader'),
              email: String(m.email || ''),
              role: (m.role as UserRole) || 'user',
              isBlocked: Boolean(m.isBlocked),
              isWithdrawBlocked: Boolean(m.isWithdrawBlocked),
              hasDepositedBefore: Boolean(m.hasDepositedBefore),
              hasTradedAfterDeposit: Boolean(m.hasTradedAfterDeposit),
              withdrawLockClearedByAdmin: Boolean(m.withdrawLockClearedByAdmin),
              realBalance: Number(m.realBalance ?? 0),
              demoBalance: Number(m.demoBalance ?? 100000),
              securityPin: m.securityPin ? String(m.securityPin) : undefined,
              invitedBy: m.invitedBy ? String(m.invitedBy) : null,
            };
          }
        }
      } catch {
        // continue to local/Firestore lookup
      }
    }

    if (!user.isLocalDemoSession && auth.currentUser) {
      try {
        let targetUid = payload.identifier.trim();
        let uSnap = await getDoc(doc(db, 'users', targetUid));
        if (!uSnap.exists()) {
          const qSnap = await getDocs(
            query(collection(db, 'users'), where('email', '==', q))
          );
          if (!qSnap.empty) {
            uSnap = qSnap.docs[0];
            targetUid = uSnap.id;
          }
        }
        if (uSnap.exists()) {
          const d = uSnap.data();
          const field = payload.wallet === 'real' ? 'realBalance' : 'demoBalance';
          const currentVal = Number(d[field] || 0);
          const nextVal =
            payload.action === 'add'
              ? currentVal + payload.amount
              : Math.max(0, currentVal - payload.amount);
          await updateDoc(doc(db, 'users', targetUid), { [field]: nextVal });
          await addDoc(collection(db, 'users', targetUid, 'transactions'), {
            userId: targetUid,
            type: payload.action === 'add' ? 'SYSTEM CREDIT' : 'SYSTEM ADJUSTMENT',
            amount: payload.amount,
            target: 'System Wallet',
            isAdjustment: true,
            adminReason: payload.reason,
            status: 'SUCCESS',
            createdAt: serverTimestamp(),
          });
          if (!updatedMember) {
            updatedMember = {
              uid: targetUid,
              username: String(d.username || 'Trader'),
              email: String(d.email || ''),
              role: (d.role as UserRole) || 'user',
              isBlocked: !!d.isBlocked,
              isWithdrawBlocked: !!d.isWithdrawBlocked,
              hasDepositedBefore: !!d.hasDepositedBefore,
              hasTradedAfterDeposit: !!d.hasTradedAfterDeposit,
              withdrawLockClearedByAdmin: !!d.withdrawLockClearedByAdmin,
              realBalance: payload.wallet === 'real' ? nextVal : Number(d.realBalance || 0),
              demoBalance: payload.wallet === 'demo' ? nextVal : Number(d.demoBalance || 100000),
              securityPin: d.securityPin ? String(d.securityPin) : undefined,
              invitedBy: d.invitedBy ? String(d.invitedBy) : null,
            };
          }
        }
      } catch {
        // ignore Firestore rule errors
      }
    }

    if (!updatedMember) {
      const localMatch =
        managedMembers.find((m) => m.uid.toLowerCase() === q || m.email.toLowerCase() === q) ??
        (user.uid.toLowerCase() === q || user.email.toLowerCase() === q
          ? {
              uid: user.uid,
              username: user.username,
              email: user.email,
              role: user.role,
              isBlocked: user.isBlocked,
              isWithdrawBlocked: user.isWithdrawBlocked,
              hasDepositedBefore: user.hasDepositedBefore,
              hasTradedAfterDeposit: user.hasTradedAfterDeposit,
              withdrawLockClearedByAdmin: user.withdrawLockClearedByAdmin,
              realBalance: user.realBalance,
              demoBalance: user.demoBalance,
              securityPin: user.pin,
              invitedBy: user.invitedBy,
            }
          : null);
      if (localMatch) {
        const nextReal =
          payload.wallet === 'real'
            ? payload.action === 'add'
              ? localMatch.realBalance + payload.amount
              : Math.max(0, localMatch.realBalance - payload.amount)
            : localMatch.realBalance;
        const nextDemo =
          payload.wallet === 'demo'
            ? payload.action === 'add'
              ? localMatch.demoBalance + payload.amount
              : Math.max(0, localMatch.demoBalance - payload.amount)
            : localMatch.demoBalance;
        updatedMember = { ...localMatch, realBalance: nextReal, demoBalance: nextDemo };
      }
    }

    if (!updatedMember) {
      showToast(`Member "${payload.identifier}" not found.`, 'error');
      return false;
    }

    const finalMember = updatedMember;
    setManagedMembers((prev) => {
      const exists = prev.some((m) => m.uid === finalMember.uid);
      return exists
        ? prev.map((m) => (m.uid === finalMember.uid ? finalMember : m))
        : [finalMember, ...prev];
    });
    if (finalMember.uid === user.uid || finalMember.email.toLowerCase() === user.email.toLowerCase()) {
      setUser((prev) => ({
        ...prev,
        realBalance: finalMember.realBalance,
        demoBalance: finalMember.demoBalance,
      }));
    }
    showToast(
      `Executed ${payload.action === 'add' ? '+' : '-'}$${payload.amount.toFixed(2)} (${payload.wallet.toUpperCase()}) for ${finalMember.username}.`
    );
    return true;
  };

  const handleAssignStaffRoleByTarget = async (
    identifier: string,
    role: UserRole
  ): Promise<boolean> => {
    if (!canClearWithdrawLock(user.role)) {
      showToast('Only Full Admin can assign system roles.', 'error');
      return false;
    }
    const q = identifier.trim().toLowerCase();
    let updatedMember: ManagedMember | null = null;

    if (authToken) {
      try {
        const res = await fetch('/api/admin/assign-role', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ identifier, role }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.member) {
            const m = data.member as Record<string, unknown>;
            updatedMember = {
              uid: String(m.uid || ''),
              username: String(m.username || 'Trader'),
              email: String(m.email || ''),
              role: (m.role as UserRole) || role,
              isBlocked: Boolean(m.isBlocked),
              isWithdrawBlocked: Boolean(m.isWithdrawBlocked),
              hasDepositedBefore: Boolean(m.hasDepositedBefore),
              hasTradedAfterDeposit: Boolean(m.hasTradedAfterDeposit),
              withdrawLockClearedByAdmin: Boolean(m.withdrawLockClearedByAdmin),
              realBalance: Number(m.realBalance ?? 0),
              demoBalance: Number(m.demoBalance ?? 100000),
              securityPin: m.securityPin ? String(m.securityPin) : undefined,
              invitedBy: m.invitedBy ? String(m.invitedBy) : null,
            };
          }
        }
      } catch {
        // continue
      }
    }

    if (!user.isLocalDemoSession && auth.currentUser) {
      try {
        let targetUid = identifier.trim();
        let uSnap = await getDoc(doc(db, 'users', targetUid));
        if (!uSnap.exists()) {
          const qSnap = await getDocs(
            query(collection(db, 'users'), where('email', '==', q))
          );
          if (!qSnap.empty) {
            uSnap = qSnap.docs[0];
            targetUid = uSnap.id;
          }
        }
        if (uSnap.exists()) {
          await updateDoc(doc(db, 'users', targetUid), { role });
          const d = uSnap.data();
          if (!updatedMember) {
            updatedMember = {
              uid: targetUid,
              username: String(d.username || 'Trader'),
              email: String(d.email || ''),
              role,
              isBlocked: !!d.isBlocked,
              isWithdrawBlocked: !!d.isWithdrawBlocked,
              hasDepositedBefore: !!d.hasDepositedBefore,
              hasTradedAfterDeposit: !!d.hasTradedAfterDeposit,
              withdrawLockClearedByAdmin: !!d.withdrawLockClearedByAdmin,
              realBalance: Number(d.realBalance ?? 0),
              demoBalance: Number(d.demoBalance ?? 100000),
              securityPin: d.securityPin ? String(d.securityPin) : undefined,
              invitedBy: d.invitedBy ? String(d.invitedBy) : null,
            };
          }
        }
      } catch {
        // ignore Firestore rule errors
      }
    }

    if (!updatedMember) {
      const localMatch = managedMembers.find(
        (m) => m.uid.toLowerCase() === q || m.email.toLowerCase() === q
      );
      if (localMatch) {
        updatedMember = { ...localMatch, role };
      }
    }

    if (!updatedMember) {
      showToast(`User account "${identifier}" not found.`, 'error');
      return false;
    }

    const finalMember = updatedMember;
    setManagedMembers((prev) => {
      const exists = prev.some((m) => m.uid === finalMember.uid);
      return exists
        ? prev.map((m) => (m.uid === finalMember.uid ? finalMember : m))
        : [finalMember, ...prev];
    });
    if (finalMember.uid === user.uid || finalMember.email.toLowerCase() === user.email.toLowerCase()) {
      setUser((prev) => ({ ...prev, role }));
    }
    showToast(`Assigned ${role.toUpperCase()} permission to ${finalMember.username}.`);
    return true;
  };

  const handleSelectSection = useCallback((section: AppSection) => {
    setActiveSection(section);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, []);

  const availableBalance = accountMode === 'demo' ? user.demoBalance : user.realBalance;

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* Toast Notifications */}
      <div
        aria-live="polite"
        className="fixed bottom-16 sm:bottom-5 right-3 sm:right-5 z-[100] flex flex-col gap-2 w-[calc(100%-1.5rem)] sm:w-full max-w-sm pointer-events-none"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl border text-xs font-semibold shadow-2xl ${
              t.type === 'error'
                ? 'bg-red-950/95 border-red-500/40 text-red-200'
                : 'bg-slate-900/95 border-emerald-500/40 text-emerald-300'
            }`}
          >
            <span>{t.message}</span>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => setToasts((prev) => prev.filter((item) => item.id !== t.id))}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Top Navigation Bar */}
      <TopBar
        isLoggedIn={user.isLoggedIn}
        activeSection={activeSection}
        onSelectSection={handleSelectSection}
        csrTelegramLink={csrTelegramLink}
        onPrimaryAction={() => {
          if (!user.isLoggedIn) {
            handleEnterDemoWorkspace();
          } else {
            handleSelectSection(activeSection === 'lottery' ? 'trade' : 'lottery');
          }
        }}
        primaryActionLabel={
          !user.isLoggedIn
            ? 'Launch Demo'
            : activeSection === 'lottery'
            ? 'Open Markets'
            : 'Lottery Live'
        }
      />

      {/* Main Content */}
      {!user.isLoggedIn ? (
        <AuthLanding
          quotes={quotes}
          platformStats={platformStats}
          platformDescription={platformDescription}
          faqEntries={faqEntries}
          liveFeedItems={liveFeedItems}
          csrTelegramLink={csrTelegramLink}
          onAuthSubmit={handleAuthSubmit}
          onGoogleSignIn={handleGoogleSignIn}
          onEnterDemoWorkspace={handleEnterDemoWorkspace}
        />
      ) : (
        <main className="flex-1 w-full max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6 pb-20 sm:pb-8">
          {activeSection === 'trade' && (
            <TradingWorkspace
              quotes={quotes}
              selectedSymbol={selectedSymbol}
              onSelectSymbol={setSelectedSymbol}
              accountMode={accountMode}
              onSetAccountMode={setAccountMode}
              availableBalance={availableBalance}
              preOrders={preOrders}
              activePositions={activePositions}
              tradeHistory={tradeHistory}
              priceAlerts={priceAlerts}
              onAddPriceAlert={handleAddPriceAlert}
              onRemovePriceAlert={handleRemovePriceAlert}
              onRearmPriceAlert={handleRearmPriceAlert}
              onPlaceOrder={handlePlaceOrder}
              onChasePreOrder={handleChasePreOrder}
              onOpenModifyOrder={(order) => setModifyOrderTarget(order)}
              onCancelPreOrder={handleCancelPreOrder}
              onClosePosition={(id) => closePositionById(id)}
              onUpdatePositionSlTp={handleUpdatePositionSlTp}
              onOpenHistoryModal={() => setHistoryModalOpen(true)}
            />
          )}

          {activeSection === 'news' && (
            <NewsWorkspace
              articles={newsArticles}
              loading={newsLoading}
              isAdmin={user.role === 'admin'}
              onRefresh={fetchPublicNews}
              onOpenAdminNewsDesk={() => {
                setStaffModalInitialTab('news');
                setStaffModalOpen(true);
              }}
              onNavigateToTrade={() => handleSelectSection('trade')}
            />
          )}

          {activeSection === 'profile' && (
            <WalletWorkspace
              user={user}
              accountMode={accountMode}
              onSetAccountMode={setAccountMode}
              quotes={quotes}
              transactions={walletTransactions}
              csrTelegramLink={csrTelegramLink}
              onRefresh={async () => {
                await syncWalletFromServer({ force: true, silent: true });
                showToast('Balances synchronized.');
              }}
              onResetDemo={() => {
                const delta = 100000 - user.demoBalance;
                setUser((prev) => ({ ...prev, demoBalance: 100000 }));
                if (!user.isLocalDemoSession && delta !== 0) {
                  applyWalletDeltaOnServer('demo', delta);
                }
                showToast('Demo balance reset to $100,000.00.');
              }}
              onCopyUid={() => copyText(user.uid, 'User ID')}
              onCopyReferral={() => copyText(user.uid, 'Invitation Code')}
              onOpenProfileEditModal={() => setProfileEditModalOpen(true)}
              onOpenPinModal={() => setPinModalOpen(true)}
              onOpenSwapModal={(sym, dir) =>
                setSwapModalState({ open: true, symbol: sym ?? 'BTCUSDT', direction: dir ?? 'usdtToCoin' })
              }
              onOpenDepositModal={() => setDepositModalOpen(true)}
              onOpenWithdrawModal={() => setWithdrawModalOpen(true)}
              onOpenTransferModal={() => setTransferModalOpen(true)}
              onOpenWalletHistoryModal={() => setWalletHistoryModalOpen(true)}
              onOpenStaffModal={() => {
                setStaffModalInitialTab(undefined);
                setStaffModalOpen(true);
              }}
              onLogout={handleLogout}
            />
          )}

          {activeSection === 'lottery' && (
            <LotteryLiveWorkspace
              userUid={user.uid}
              userEmail={user.email}
              userRole={user.role}
              hasAdminToken={Boolean(authToken)}
              accountMode={accountMode}
              onSetAccountMode={setAccountMode}
              availableBalance={availableBalance}
              demoBalance={user.demoBalance}
              realBalance={user.realBalance}
              lotteryState={lotteryState}
              latestSettlementBanner={latestLotteryBanner}
              members={[
                {
                  uid: user.uid,
                  username: user.username,
                  email: user.email,
                  role: user.role,
                  isBlocked: user.isBlocked,
                  isWithdrawBlocked: user.isWithdrawBlocked,
                  hasDepositedBefore: user.hasDepositedBefore,
                  hasTradedAfterDeposit: user.hasTradedAfterDeposit,
                  withdrawLockClearedByAdmin: user.withdrawLockClearedByAdmin,
                  realBalance: user.realBalance,
                  demoBalance: user.demoBalance,
                  securityPin: user.pin,
                  invitedBy: user.invitedBy,
                },
                ...managedMembers.filter((m) => m.uid !== user.uid),
              ]}
              onRefreshState={() => fetchLotteryState()}
              onPlaceBet={handlePlaceLotteryBet}
              onPlaceDigitBet={handlePlaceDigitLotteryBet}
              onUnlockAdminWithPassword={handleUnlockLotteryAdmin}
              onUpdateAdminConfig={handleUpdateLotteryAdminConfig}
              onScheduleDigitDraw={handleScheduleDigitDraw}
              onAdjustWallet={async (adj) =>
                handleExecuteBalanceAdjustByTarget({
                  ...adj,
                  reason: 'Lottery Live System Adjustment',
                })
              }
            />
          )}
        </main>
      )}

      {/* Quiet Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950 py-4 px-3 sm:px-6 text-[10px] sm:text-xs text-slate-500 mb-14 sm:mb-0">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-center sm:text-left">
          <span className="font-semibold text-slate-400">Zectrade Global Financial Technologies Ltd. © 2026</span>
          <span>Multi-asset trading &amp; Lottery Live prediction engine.</span>
        </div>
      </footer>

      {/* Mobile Bottom Navigation */}
      {user.isLoggedIn && (
        <MobileBottomNav activeSection={activeSection} onSelectSection={handleSelectSection} />
      )}

      {/* Modals */}
      {swapModalState.open && (
        <SwapModal
          user={user}
          quotes={quotes}
          initialSymbol={swapModalState.symbol}
          initialDirection={swapModalState.direction}
          onExecuteSwap={handleExecuteSwap}
          onClose={() => setSwapModalState({ open: false })}
        />
      )}

      {depositModalOpen && (
        <DepositModal
          depositAccounts={depositAccounts}
          depositRateMMK={depositRateMMK}
          onCopyText={copyText}
          onSubmitDeposit={handleSubmitDeposit}
          onClose={() => setDepositModalOpen(false)}
        />
      )}

      {withdrawModalOpen && (
        <WithdrawModal
          user={user}
          withdrawRateMMK={withdrawRateMMK}
          onSubmitWithdraw={handleSubmitWithdraw}
          onOpenDeposit={() => setDepositModalOpen(true)}
          onClose={() => setWithdrawModalOpen(false)}
        />
      )}

      {transferModalOpen && (
        <TransferModal
          accountMode={accountMode}
          availableBalance={availableBalance}
          currentUserUid={user.uid}
          currentUserEmail={user.email}
          userPin={user.pin}
          onLookupRecipient={handleLookupTransferRecipient}
          onSubmitTransfer={handleSubmitTransfer}
          onClose={() => setTransferModalOpen(false)}
        />
      )}

      {pinModalOpen && (
        <PinModal onSavePin={handleSavePin} onClose={() => setPinModalOpen(false)} />
      )}

      {profileEditModalOpen && (
        <ProfileEditModal
          user={user}
          onSaveProfile={handleSaveOwnProfile}
          onClose={() => setProfileEditModalOpen(false)}
        />
      )}

      {modifyOrderTarget && (
        <ModifyOrderModal
          order={modifyOrderTarget}
          onSave={handleSaveModifiedOrder}
          onClose={() => setModifyOrderTarget(null)}
        />
      )}

      {historyModalOpen && (
        <TradeHistoryModal history={tradeHistory} onClose={() => setHistoryModalOpen(false)} />
      )}

      {walletHistoryModalOpen && (
        <WalletHistoryModal
          transactions={walletTransactions}
          username={user.username}
          onClose={() => setWalletHistoryModalOpen(false)}
        />
      )}

      {staffModalOpen && (
        <StaffControlModal
          userRole={user.role}
          currentUserUid={user.uid}
          csrTelegramLink={csrTelegramLink}
          platformStats={platformStats}
          platformDescription={platformDescription}
          faqEntries={faqEntries}
          depositRateMMK={depositRateMMK}
          withdrawRateMMK={withdrawRateMMK}
          depositAccounts={depositAccounts}
          members={[
            {
              uid: user.uid,
              username: user.username,
              email: user.email,
              role: user.role,
              isBlocked: user.isBlocked,
              isWithdrawBlocked: user.isWithdrawBlocked,
              hasDepositedBefore: user.hasDepositedBefore,
              hasTradedAfterDeposit: user.hasTradedAfterDeposit,
              withdrawLockClearedByAdmin: user.withdrawLockClearedByAdmin,
              realBalance: user.realBalance,
              demoBalance: user.demoBalance,
              securityPin: user.pin,
              invitedBy: user.invitedBy,
              avatarUrl: user.avatarUrl ?? null,
              fullName: user.fullName ?? null,
              phone: user.phone ?? null,
              country: user.country ?? null,
              bio: user.bio ?? null,
              withdrawMethod: user.withdrawMethod ?? 'kpay',
              withdrawAccountName: user.withdrawAccountName ?? null,
              withdrawAccountNumber: user.withdrawAccountNumber ?? null,
            },
            ...managedMembers.filter((m) => m.uid !== user.uid),
          ]}
          pendingDeposits={pendingDeposits}
          pendingWithdrawals={pendingWithdrawals}
          staffRequestsLoading={staffRequestsLoading}
          onRefreshStaffRequests={() => loadStaffRequests()}
          onApproveDeposit={handleApproveDeposit}
          onRejectDeposit={handleRejectDeposit}
          onApproveWithdrawal={handleApproveWithdrawal}
          onRejectWithdrawal={handleRejectWithdrawal}
          onExecuteBalanceAdjustByTarget={handleExecuteBalanceAdjustByTarget}
          onAssignStaffRoleByTarget={handleAssignStaffRoleByTarget}
          onCopyText={copyText}
          onSearchMembers={handleSearchMembers}
          onToggleBlockMember={handleToggleBlockMember}
          onToggleWithdrawBlock={handleToggleWithdrawBlock}
          onClearWithdrawLock={handleClearWithdrawLock}
          onAdjustMemberBalance={handleAdjustMemberBalance}
          onAssignMemberRole={handleAssignMemberRole}
          onAdminUpdateMemberProfile={handleAdminUpdateMemberProfile}
          onSaveSettings={async (payload) => {
            setCsrTelegramLink(payload.csrTelegramLink);
            setPlatformStats(payload.platformStats);
            setDepositRateMMK(payload.depositRateMMK);
            setWithdrawRateMMK(payload.withdrawRateMMK);
            setDepositAccounts(payload.depositAccounts);
            if (!user.isLocalDemoSession && auth.currentUser) {
              try {
                await Promise.all([
                  setDoc(doc(db, 'settings', 'csrConfig'), { telegramLink: payload.csrTelegramLink }),
                  setDoc(doc(db, 'settings', 'landingStats'), payload.platformStats),
                  setDoc(doc(db, 'settings', 'exchangeRates'), {
                    depositMMK: payload.depositRateMMK,
                    withdrawMMK: payload.withdrawRateMMK,
                  }),
                  setDoc(doc(db, 'settings', 'depositAccounts'), payload.depositAccounts),
                ]);
              } catch {
                // ignore Firestore rule errors cleanly
              }
            }
            showToast('Platform settings saved.');
          }}
          adminCoins={adminCoins}
          selectedCoinAnalytics={selectedCoinAnalytics}
          coinAnalyticsLoading={coinAnalyticsLoading}
          onRefreshAdminCoins={fetchAdminCoins}
          onUpsertAdminCoin={handleUpsertAdminCoin}
          onUpdateCoinPriceControl={handleUpdateCoinPriceControl}
          onDeleteAdminCoin={handleDeleteAdminCoin}
          onLoadCoinAnalytics={fetchCoinAnalytics}
          onClaimCoinProfit={handleClaimCoinProfit}
          lotteryState={lotteryState}
          onRefreshLotteryState={() => fetchLotteryState()}
          onUpdateLotteryConfig={handleUpdateLotteryAdminConfig}
          onScheduleDigitDraw={handleScheduleDigitDraw}
          onSaveFaqAndDesc={async (desc, faqs) => {
            setPlatformDescription(desc);
            setFaqEntries(faqs);
            if (!user.isLocalDemoSession && auth.currentUser) {
              try {
                await setDoc(doc(db, 'settings', 'faqConfig'), {
                  platformDesc: desc,
                  faqList: faqs,
                });
              } catch {
                // ignore Firestore rule errors cleanly
              }
            }
            showToast('Platform description and FAQ saved.');
          }}
          initialTab={staffModalInitialTab}
          adminNews={adminNewsArticles}
          adminNewsLoading={adminNewsLoading}
          onRefreshAdminNews={() => fetchAdminNews()}
          onCreateAdminNews={handleCreateAdminNews}
          onUpdateAdminNews={handleUpdateAdminNews}
          onDeleteAdminNews={handleDeleteAdminNews}
          onClose={() => {
            setStaffModalOpen(false);
            setStaffModalInitialTab(undefined);
          }}
        />
      )}
    </div>
  );
}
