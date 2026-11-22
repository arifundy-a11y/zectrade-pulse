import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  getRedirectResult,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { X } from 'lucide-react';
import { AuthActionPage } from './components/AuthActionPage';
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
} from './utils/depositHistory';
import {
  formatFriendlyAuthError,
  isAuthCancellationError,
  parseAuthActionLocation,
  ZECTRADE_ACTION_CODE_SETTINGS,
  type ParsedAuthActionRoute,
} from './utils/authAction';
import { appendDeterministicLiveFeedItem } from './utils/liveFeed';
import { verifyTotpCode } from './utils/twoFactor';
import {
  auth,
  db,
  googleAuthProvider,
  isFirebaseConfigured,
  isOAuthFirebaseConfigured,
  oauthAuth,
} from './services/firebaseClient';
import {
  DEMO_USER_TEMPLATE,
  INITIAL_QUOTES,
  SEED_FEED,
  SEED_MANAGED_MEMBERS,
  mergeBuiltInAndCustomQuotes,
} from './data/defaults';
import {
  claimAdminCoinProfitStatic,
  deleteCustomCoinStatic,
  evaluateCustomCoinsForCurrentSecondStatic,
  getCoinTradeAnalyticsStatic,
  getInitialAdminCoinsSync,
  recordCoinTradeStatic,
  subscribeToCustomCoinsStatic,
  syncAndListCustomCoinsStatic,
  updateCoinPriceControlStatic,
  upsertCustomCoinStatic,
} from './services/coinsService';
import {
  executeDirectP2PTransfer,
  lookupTransferRecipientDirect,
} from './services/transferEngine';
import {
  adminScheduleDigitDrawStatic,
  getInitialLotteryLiveState,
  placeDigitLotteryBetStatic,
  placeLotteryBetStatic,
  tickAndGetLotteryStateStatic,
  updateLotteryAdminConfigStatic,
} from './services/lotteryService';
import {
  createNewsArticleStatic,
  deleteNewsArticleStatic,
  getInitialNewsArticlesSync,
  listNewsArticlesStatic,
  updateNewsArticleStatic,
} from './services/newsService';
import {
  adjustMemberBalanceStatic,
  applyWalletDeltaStatic,
  approveDepositRequestStatic,
  approveWithdrawalRequestStatic,
  assignMemberRoleStatic,
  authenticateStaticAdmin,
  createWalletRequestStatic,
  getInitialPlatformSettingsSync,
  getMemberWalletSyncStatic,
  incrementPlatformStatsForActivityStatic,
  listMembersStatic,
  listStaffRequestsStatic,
  loadPublicPlatformSettingsStatic,
  rejectDepositRequestStatic,
  rejectWithdrawalRequestStatic,
  saveBrandLogoStatic,
  saveFaqAndDescStatic,
  savePlatformSettingsStatic,
  savePlatformStatsOnlyStatic,
  subscribePlatformStatsStatic,
  syncMemberOnAuthStatic,
  updateMemberFieldsStatic,
} from './services/walletAdminService';
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
  resolveHasFirstDeposit,
  shouldTriggerPreOrder,
  shouldTriggerPriceAlert,
  validateSlTpTargets,
} from './utils/tradingEngine';
import {
  BINANCE_COMBINED_STREAM_URL,
  BINANCE_REST_TICKER_URL,
  COINBASE_EXCHANGE_RATES_URL,
  SharedMarketAnchor,
  applyLiveMarketTicks,
  evaluateDeterministicFallbackQuotes,
  parseBinanceMiniTickerPayload,
  parseBinanceRestTicker24hr,
  parseCoinbaseExchangeRates,
} from './utils/marketFeed';
import { FIRST_DEPOSIT_REQUIRED_MESSAGE } from './utils/transferEngine';

const STORAGE_KEY = 'zectrade_pulse_workspace_v1';

export default function App() {
  const [quotes, setQuotes] = useState<MarketQuote[]>(() =>
    mergeBuiltInAndCustomQuotes(INITIAL_QUOTES, getInitialAdminCoinsSync(false))
  );
  const [selectedSymbol, setSelectedSymbol] = useState<MarketSymbol>('BTCUSDT');
  const [activeSection, setActiveSection] = useState<AppSection>('trade');
  const [accountMode, setAccountMode] = useState<AccountMode>('demo');
  const [authActionRoute, setAuthActionRoute] = useState<ParsedAuthActionRoute>(() =>
    typeof window !== 'undefined'
      ? parseAuthActionLocation(window.location.pathname, window.location.search)
      : { isAuthActionRoute: false, mode: 'unknown', oobCode: '', continueUrl: null }
  );
  const [landingAuthMode, setLandingAuthMode] = useState<'register' | 'login' | 'forgot'>('register');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlePopState = () => {
      setAuthActionRoute(parseAuthActionLocation(window.location.pathname, window.location.search));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

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

  const effectiveHasFirstDeposit = useMemo(
    () => resolveHasFirstDeposit(user, walletTransactions),
    [user, walletTransactions]
  );

  const initialPlatform = getInitialPlatformSettingsSync();
  const [csrTelegramLink, setCsrTelegramLink] = useState(initialPlatform.csrTelegramLink);
  const [platformStats, setPlatformStats] = useState<PlatformStats>(initialPlatform.platformStats);
  const [platformDescription, setPlatformDescription] = useState(initialPlatform.platformDescription);
  const [faqEntries, setFaqEntries] = useState<FaqEntry[]>(initialPlatform.faqEntries);
  const [liveFeedItems, setLiveFeedItems] = useState<LiveFeedItem[]>(SEED_FEED);
  const [depositRateMMK, setDepositRateMMK] = useState(initialPlatform.depositRateMMK);
  const [withdrawRateMMK, setWithdrawRateMMK] = useState(initialPlatform.withdrawRateMMK);
  const [depositAccounts, setDepositAccounts] = useState<DepositAccounts>(initialPlatform.depositAccounts);
  const [brandLogoUrl, setBrandLogoUrl] = useState<string | null>(initialPlatform.brandLogoUrl);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [lotteryState, setLotteryState] = useState<LotteryLiveState | null>(() =>
    getInitialLotteryLiveState(user.uid, user.role === 'admin')
  );
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
  const [adminCoins, setAdminCoins] = useState<AdminManagedCoin[]>(() =>
    getInitialAdminCoinsSync(true)
  );
  const [selectedCoinAnalytics, setSelectedCoinAnalytics] = useState<CoinTradeAnalytics | null>(null);
  const [coinAnalyticsLoading, setCoinAnalyticsLoading] = useState(false);
  const closingIdsRef = useRef<Set<string>>(new Set());
  const settledIdsRef = useRef<Set<string>>(new Set());
  const triggeredPreOrderIdsRef = useRef<Set<string>>(new Set());
  const isSubmittingOrderRef = useRef(false);
  const orderCooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingWalletDeltasRef = useRef(0);
  const seenSqlTransferIdsRef = useRef<Set<string>>(new Set());
  const initialWalletSyncDoneRef = useRef(false);

  useEffect(() => {
    return () => {
      if (orderCooldownTimerRef.current) clearTimeout(orderCooldownTimerRef.current);
    };
  }, []);

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
  const [newsArticles, setNewsArticles] = useState<NewsArticle[]>(() =>
    getInitialNewsArticlesSync(false)
  );
  const [adminNewsArticles, setAdminNewsArticles] = useState<NewsArticle[]>(() =>
    getInitialNewsArticlesSync(true)
  );
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

  // Sync Browser Tab Favicon dynamically with Admin Brand Logo or /logo.png
  useEffect(() => {
    const targetHref = brandLogoUrl?.trim() || '/logo.png';
    const rels = ['icon', 'apple-touch-icon'];
    rels.forEach((rel) => {
      let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
      if (!link) {
        link = document.createElement('link');
        link.rel = rel;
        document.head.appendChild(link);
      }
      link.href = targetHref;
      if (targetHref.endsWith('.svg') || targetHref.startsWith('data:image/svg+xml')) {
        link.type = 'image/svg+xml';
      } else if (targetHref.endsWith('.png') || targetHref.startsWith('data:image/png')) {
        link.type = 'image/png';
      } else {
        link.removeAttribute('type');
      }
    });
    try {
      if (brandLogoUrl) {
        localStorage.setItem('zectrade_brand_logo_v1', brandLogoUrl);
      } else {
        localStorage.removeItem('zectrade_brand_logo_v1');
      }
    } catch {
      // ignore storage quota
    }
  }, [brandLogoUrl]);

  // Load Public Settings from Firestore + localStorage safely
  useEffect(() => {
    const loadPublicSettings = async () => {
      const settings = await loadPublicPlatformSettingsStatic();
      setFaqEntries(settings.faqEntries);
      setPlatformDescription(settings.platformDescription);
      setCsrTelegramLink(settings.csrTelegramLink);
      setPlatformStats(settings.platformStats);
      setDepositAccounts(settings.depositAccounts);
      setDepositRateMMK(settings.depositRateMMK);
      setWithdrawRateMMK(settings.withdrawRateMMK);
      if (settings.brandLogoUrl) {
        setBrandLogoUrl(settings.brandLogoUrl);
      }
    };
    loadPublicSettings();
    const unsubPlatformStats = subscribePlatformStatsStatic((nextStats) => {
      setPlatformStats(nextStats);
    });
    return () => unsubPlatformStats();
  }, []);

  const authTokenRef = useRef<string | null>(null);
  authTokenRef.current = authToken;

  const syncWalletFromServer = useCallback(
    async (opts?: { tokenOverride?: string | null; force?: boolean; silent?: boolean }) => {
      const token = opts?.tokenOverride !== undefined ? opts.tokenOverride : authTokenRef.current;
      if (!token && stateRef.current.user.isLocalDemoSession) return;
      if (stateRef.current.user.isLocalDemoSession && !opts?.tokenOverride) return;
      if (!opts?.force && pendingWalletDeltasRef.current > 0) return;

      try {
        const activeUid = stateRef.current.user.uid;
        if (!activeUid) return;
        const { member: syncData, activity } = await getMemberWalletSyncStatic(activeUid);
        if (syncData) {
          const srvReal = Number(syncData.realBalance);
          const srvDemo = Number(syncData.demoBalance);

          setUser((prev) => {
            const nextUser: UserProfile = {
              ...prev,
              realBalance: Number.isFinite(srvReal) ? srvReal : prev.realBalance,
              demoBalance: Number.isFinite(srvDemo) ? srvDemo : prev.demoBalance,
              pin:
                typeof syncData.securityPin === 'string' && /^\d{4}$/.test(syncData.securityPin)
                  ? syncData.securityPin
                  : prev.pin,
              hasDepositedBefore: Boolean(syncData.hasDepositedBefore),
              hasFirstDeposit: syncData.hasFirstDeposit ?? Boolean(syncData.hasDepositedBefore),
              totalDeposited:
                typeof syncData.totalDeposited === 'number' && Number.isFinite(syncData.totalDeposited)
                  ? syncData.totalDeposited
                  : prev.totalDeposited ?? 0,
              firstDepositRevokedByAdmin:
                typeof syncData.firstDepositRevokedByAdmin === 'boolean'
                  ? syncData.firstDepositRevokedByAdmin
                  : prev.firstDepositRevokedByAdmin ?? false,
              hasTradedAfterDeposit: Boolean(syncData.hasTradedAfterDeposit),
              withdrawLockClearedByAdmin: Boolean(syncData.withdrawLockClearedByAdmin),
              isWithdrawBlocked: Boolean(syncData.isWithdrawBlocked),
              isBlocked: Boolean(syncData.isBlocked),
            };
            stateRef.current.user = nextUser;
            return nextUser;
          });
        }

        if (Array.isArray(activity) && activity.length > 0) {
          const newIncoming = activity.filter(
            (tx) =>
              tx.type.includes('RECEIVED') && !seenSqlTransferIdsRef.current.has(tx.id)
          );
          if (initialWalletSyncDoneRef.current && newIncoming.length > 0) {
            for (const inc of newIncoming) {
              showToast(`Received $${inc.amount.toFixed(2)} transfer (${inc.target})!`);
            }
          }
          for (const row of activity) {
            seenSqlTransferIdsRef.current.add(row.id);
          }
          initialWalletSyncDoneRef.current = true;
          setWalletTransactions((prev) => deduplicateFirestoreAgainstSql(activity, prev));
        }
      } catch {
        if (!opts?.silent) {
          showToast('Unable to refresh wallet balance right now.', 'error');
        }
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
        const updated = await applyWalletDeltaStatic({
          uid: stateRef.current.user.uid,
          email: stateRef.current.user.email,
          wallet,
          delta,
          markTradedAfterDeposit,
        });
        if (!updated) return;
        setUser((prev) => {
          const nextUser: UserProfile = {
            ...prev,
            realBalance: updated.realBalance,
            demoBalance: updated.demoBalance,
            hasDepositedBefore: Boolean(updated.hasDepositedBefore),
            hasFirstDeposit: updated.hasFirstDeposit ?? Boolean(updated.hasDepositedBefore),
            totalDeposited:
              typeof updated.totalDeposited === 'number' && Number.isFinite(updated.totalDeposited)
                ? updated.totalDeposited
                : prev.totalDeposited ?? 0,
            firstDepositRevokedByAdmin:
              typeof updated.firstDepositRevokedByAdmin === 'boolean'
                ? updated.firstDepositRevokedByAdmin
                : prev.firstDepositRevokedByAdmin ?? false,
            hasTradedAfterDeposit: Boolean(updated.hasTradedAfterDeposit),
            withdrawLockClearedByAdmin: Boolean(updated.withdrawLockClearedByAdmin),
          };
          stateRef.current.user = nextUser;
          return nextUser;
        });
      } catch {
        // Keep optimistic UI state
      } finally {
        pendingWalletDeltasRef.current = Math.max(0, pendingWalletDeltasRef.current - 1);
      }
    },
    []
  );

  // Firebase Auth listener
  useEffect(() => {
    let unsubPos: (() => void) | null = null;
    let unsubOrd: (() => void) | null = null;

    const handleFirebaseUser = async (fbUser: import('firebase/auth').User | null) => {
      if (unsubPos) unsubPos();
      if (unsubOrd) unsubOrd();

      if (!fbUser) return;

      try {
        seenSqlTransferIdsRef.current.clear();
        initialWalletSyncDoneRef.current = false;
        const idToken = await fbUser.getIdToken();
        setAuthToken(idToken);
        authTokenRef.current = idToken;

        const syncedMember = await syncMemberOnAuthStatic({
          uid: fbUser.uid,
          email: fbUser.email || '',
          username: fbUser.displayName || undefined,
        });

        let data: Record<string, unknown> = {};
        if (isFirebaseConfigured && db) {
          try {
            const userRef = doc(db, 'users', fbUser.uid);
            const snap = await getDocFromServer(userRef).catch(() => getDoc(userRef));
            if (snap.exists()) data = snap.data();
          } catch {
            // Use synced local profile when offline
          }
        }

        if (data.isBlocked || syncedMember.isBlocked) {
          if (auth) await signOut(auth).catch(() => {});
          if (oauthAuth && oauthAuth !== auth) await signOut(oauthAuth).catch(() => {});
          setAuthToken(null);
          showToast('Your account is currently restricted. Please contact support.', 'error');
          return;
        }

        const effectiveRole = (
          syncedMember.role === 'admin' || data.role === 'admin'
            ? 'admin'
            : (syncedMember.role || (data.role as UserRole) || 'user')
        ) as UserRole;

        const initialReal = Number(data.realBalance ?? syncedMember.realBalance ?? FIRST_REGISTER_REAL_BONUS_USD);
        const initialDemo = Number(data.demoBalance ?? syncedMember.demoBalance ?? 100000);

        setUser({
          uid: fbUser.uid,
          isLoggedIn: true,
          isLocalDemoSession: false,
          username: String(
            data.username || syncedMember.username || fbUser.displayName || fbUser.email?.split('@')[0] || 'Trader'
          ),
          email: String(data.email || fbUser.email || syncedMember.email || ''),
          pin: String(data.securityPin || syncedMember.securityPin || '1234'),
          role: effectiveRole,
          isBlocked: Boolean(data.isBlocked ?? syncedMember.isBlocked),
          isWithdrawBlocked: Boolean(data.isWithdrawBlocked ?? syncedMember.isWithdrawBlocked),
          invitedBy: (data.invitedBy as string | null | undefined) ?? syncedMember.invitedBy ?? null,
          hasDepositedBefore: Boolean(data.hasDepositedBefore ?? syncedMember.hasDepositedBefore),
          hasFirstDeposit:
            typeof data.hasFirstDeposit === 'boolean'
              ? data.hasFirstDeposit
              : typeof syncedMember.hasFirstDeposit === 'boolean'
              ? syncedMember.hasFirstDeposit
              : Boolean(data.hasDepositedBefore ?? syncedMember.hasDepositedBefore),
          totalDeposited: Number(data.totalDeposited ?? syncedMember.totalDeposited ?? 0) || 0,
          firstDepositRevokedByAdmin: Boolean(
            data.firstDepositRevokedByAdmin ?? syncedMember.firstDepositRevokedByAdmin
          ),
          hasTradedAfterDeposit: Boolean(data.hasTradedAfterDeposit ?? syncedMember.hasTradedAfterDeposit),
          withdrawLockClearedByAdmin: Boolean(
            data.withdrawLockClearedByAdmin ?? syncedMember.withdrawLockClearedByAdmin
          ),
          demoBalance: Number.isFinite(initialDemo) ? initialDemo : 100000,
          realBalance: Number.isFinite(initialReal) ? initialReal : FIRST_REGISTER_REAL_BONUS_USD,
          spotHoldings: (data.spotHoldings as UserProfile['spotHoldings']) || {},
          avatarUrl: (data.avatarUrl as string | null | undefined) ?? syncedMember.avatarUrl ?? null,
          fullName: (data.fullName as string | null | undefined) ?? syncedMember.fullName ?? null,
          phone: (data.phone as string | null | undefined) ?? syncedMember.phone ?? null,
          country: (data.country as string | null | undefined) ?? syncedMember.country ?? null,
          bio: (data.bio as string | null | undefined) ?? syncedMember.bio ?? null,
          withdrawMethod: ((data.withdrawMethod || syncedMember.withdrawMethod || 'kpay') as WithdrawMethod),
          withdrawAccountName:
            (data.withdrawAccountName as string | null | undefined) ??
            syncedMember.withdrawAccountName ??
            null,
          withdrawAccountNumber:
            (data.withdrawAccountNumber as string | null | undefined) ??
            syncedMember.withdrawAccountNumber ??
            null,
          emailVerified: Boolean(fbUser.emailVerified),
          twoFactorEnabled: Boolean(data.twoFactorEnabled),
          twoFactorSecret: data.twoFactorSecret ? String(data.twoFactorSecret) : null,
        });

        if (isFirebaseConfigured && db) {
          unsubPos = onSnapshot(
            collection(db, 'users', fbUser.uid, 'positions'),
            (qSnap) => {
              setActivePositions(
                qSnap.docs
                  .filter((d) => !settledIdsRef.current.has(d.id))
                  .map((d) => ({ id: d.id, ...d.data() } as Position))
              );
            },
            () => {
              // Ignore listener permission/offline errors gracefully
            }
          );

          unsubOrd = onSnapshot(
            collection(db, 'users', fbUser.uid, 'orders'),
            (qSnap) => {
              setPreOrders(
                qSnap.docs
                  .filter((d) => !triggeredPreOrderIdsRef.current.has(d.id))
                  .map((d) => ({ id: d.id, ...d.data() } as PreOrder))
              );
            },
            () => {
              // Ignore listener permission/offline errors gracefully
            }
          );
        }

        await syncWalletFromServer({ tokenOverride: idToken, force: true, silent: true });
      } catch {
        // Ignore Firestore read errors gracefully
      }
    };

    const unsubAuth = auth ? onAuthStateChanged(auth, handleFirebaseUser) : () => {};
    const unsubOAuth = oauthAuth && oauthAuth !== auth ? onAuthStateChanged(oauthAuth, handleFirebaseUser) : () => {};

    if (isOAuthFirebaseConfigured && oauthAuth) {
      getRedirectResult(oauthAuth)
        .then((result) => {
          if (result?.user) {
            showToast('Signed in with Google.');
          }
        })
        .catch((err: unknown) => {
          if (isAuthCancellationError(err)) {
            return;
          }
          showToast(formatFriendlyAuthError(err, 'Google Sign-In failed.'), 'error');
        });
    }

    return () => {
      unsubAuth();
      unsubOAuth();
      if (unsubPos) unsubPos();
      if (unsubOrd) unsubOrd();
    };
  }, [showToast, syncWalletFromServer]);

  // Real-time Firestore listener (onSnapshot) for active user's balance & wallet history (always active on Account page & live sessions)
  useEffect(() => {
    if (!user.isLoggedIn || user.isLocalDemoSession || !user.uid) return;
    if (!isFirebaseConfigured || !db) return;

    const userRef = doc(db, 'users', user.uid);
    const unsubUser = onSnapshot(
      userRef,
      (dSnap) => {
        if (!dSnap.exists()) return;
        const d = dSnap.data() as Record<string, unknown>;
        const parsedReal = Number(d.realBalance);
        const parsedDemo = Number(d.demoBalance);
        setUser((prev) => {
          if (prev.uid !== user.uid) return prev;
          const nextUser: UserProfile = {
            ...prev,
            username: d.username ? String(d.username) : prev.username,
            role: (d.role as UserRole) || prev.role,
            pin:
              typeof d.securityPin === 'string' && /^\d{4}$/.test(d.securityPin)
                ? d.securityPin
                : prev.pin,
            realBalance: Number.isFinite(parsedReal) ? parsedReal : prev.realBalance,
            demoBalance: Number.isFinite(parsedDemo) ? parsedDemo : prev.demoBalance,
            hasDepositedBefore:
              typeof d.hasDepositedBefore === 'boolean' ? d.hasDepositedBefore : prev.hasDepositedBefore,
            hasFirstDeposit:
              typeof d.hasFirstDeposit === 'boolean'
                ? d.hasFirstDeposit
                : typeof d.hasDepositedBefore === 'boolean'
                ? d.hasDepositedBefore
                : prev.hasFirstDeposit,
            totalDeposited:
              typeof d.totalDeposited === 'number' && Number.isFinite(d.totalDeposited)
                ? d.totalDeposited
                : prev.totalDeposited,
            firstDepositRevokedByAdmin:
              typeof d.firstDepositRevokedByAdmin === 'boolean'
                ? d.firstDepositRevokedByAdmin
                : prev.firstDepositRevokedByAdmin,
            hasTradedAfterDeposit:
              typeof d.hasTradedAfterDeposit === 'boolean'
                ? d.hasTradedAfterDeposit
                : prev.hasTradedAfterDeposit,
            withdrawLockClearedByAdmin:
              typeof d.withdrawLockClearedByAdmin === 'boolean'
                ? d.withdrawLockClearedByAdmin
                : prev.withdrawLockClearedByAdmin,
            isWithdrawBlocked:
              typeof d.isWithdrawBlocked === 'boolean' ? d.isWithdrawBlocked : prev.isWithdrawBlocked,
            isBlocked: typeof d.isBlocked === 'boolean' ? d.isBlocked : prev.isBlocked,
            spotHoldings: (d.spotHoldings as UserProfile['spotHoldings']) || prev.spotHoldings || {},
            avatarUrl: d.avatarUrl !== undefined ? (d.avatarUrl as string | null) : prev.avatarUrl,
            fullName: d.fullName !== undefined ? (d.fullName as string | null) : prev.fullName,
            phone: d.phone !== undefined ? (d.phone as string | null) : prev.phone,
            country: d.country !== undefined ? (d.country as string | null) : prev.country,
            bio: d.bio !== undefined ? (d.bio as string | null) : prev.bio,
            withdrawMethod: (d.withdrawMethod as WithdrawMethod | undefined) ?? prev.withdrawMethod,
            withdrawAccountName:
              d.withdrawAccountName !== undefined
                ? (d.withdrawAccountName as string | null)
                : prev.withdrawAccountName,
            withdrawAccountNumber:
              d.withdrawAccountNumber !== undefined
                ? (d.withdrawAccountNumber as string | null)
                : prev.withdrawAccountNumber,
            twoFactorEnabled:
              typeof d.twoFactorEnabled === 'boolean'
                ? d.twoFactorEnabled
                : prev.twoFactorEnabled,
            twoFactorSecret:
              d.twoFactorSecret !== undefined
                ? d.twoFactorSecret
                  ? String(d.twoFactorSecret)
                  : null
                : prev.twoFactorSecret,
          };
          stateRef.current.user = nextUser;
          return nextUser;
        });
      },
      () => {
        // Fallback cache / manual Refresh sync remains active if Firestore rules block unauthenticated listener
      }
    );

    const txRef = collection(db, 'users', user.uid, 'transactions');
    const unsubTx = onSnapshot(
      txRef,
      (qSnap) => {
        const list: WalletTransaction[] = qSnap.docs.map((d) => {
          const raw = d.data() as Record<string, unknown>;
          const createdAtField = raw.createdAt as { toDate?: () => Date } | undefined;
          const createdAtMs =
            typeof raw.createdAtMs === 'number' && Number.isFinite(raw.createdAtMs)
              ? raw.createdAtMs
              : createdAtField?.toDate
                ? createdAtField.toDate().getTime()
                : Date.now();
          return {
            id: String(raw.id || d.id),
            userId: raw.userId ? String(raw.userId) : user.uid,
            userEmail: raw.userEmail ? String(raw.userEmail) : user.email,
            type: String(raw.type || 'TX'),
            amount: Number(raw.amount || 0),
            target: String(raw.target || 'System Wallet'),
            isAdjustment: Boolean(raw.isAdjustment),
            status: (raw.status as WalletTransaction['status']) || 'PENDING',
            rejectReason: raw.rejectReason ? String(raw.rejectReason) : null,
            rawTime: createdAtMs,
            timestamp: new Date(createdAtMs).toLocaleString(),
          };
        });

        const newIncoming = list.filter(
          (tx) =>
            tx.type.includes('RECEIVED') && !seenSqlTransferIdsRef.current.has(tx.id)
        );
        if (initialWalletSyncDoneRef.current && newIncoming.length > 0) {
          for (const inc of newIncoming) {
            showToast(`Received $${inc.amount.toFixed(2)} transfer (${inc.target})!`);
          }
        }
        for (const row of list) {
          seenSqlTransferIdsRef.current.add(row.id);
        }
        initialWalletSyncDoneRef.current = true;

        setWalletTransactions((prev) => deduplicateFirestoreAgainstSql(list, prev));
      },
      () => {
        // Fallback cache / manual Refresh sync remains active if Firestore rules block unauthenticated listener
      }
    );

    return () => {
      unsubUser();
      unsubTx();
    };
  }, [user.isLoggedIn, user.isLocalDemoSession, user.uid, user.email, showToast]);

  // Fetch authoritative user doc & transactions immediately upon visiting Account page & poll periodically
  useEffect(() => {
    if (!user.isLoggedIn || user.isLocalDemoSession) return;
    if (activeSection === 'profile') {
      syncWalletFromServer({ tokenOverride: authTokenRef.current || 'firestore-sync', force: true, silent: true });
    }
    const id = setInterval(() => {
      syncWalletFromServer({ silent: true });
    }, 8000);
    return () => clearInterval(id);
  }, [user.isLoggedIn, user.isLocalDemoSession, user.uid, activeSection, syncWalletFromServer]);

  // Live Market Feed: Binance Combined Multi-Stream WebSocket (@miniTicker) + Auto-Reconnect + REST Fallback (Binance -> Coinbase) + Deterministic UTC Micro-Ticks
  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let reconnectAttempts = 0;
    let lastWsTickMs = 0;
    let activeAbort: AbortController | null = null;

    const restAnchors = new Map<MarketSymbol, SharedMarketAnchor>();
    for (const seed of INITIAL_QUOTES) {
      restAnchors.set(seed.symbol, {
        price: seed.price,
        changePct: seed.changePct,
        high24h: seed.high24h,
        low24h: seed.low24h,
      });
    }

    const recordAnchors = (ticks: ReturnType<typeof parseBinanceRestTicker24hr>) => {
      for (const tick of ticks) {
        const prevAnchor = restAnchors.get(tick.symbol);
        restAnchors.set(tick.symbol, {
          price: tick.price,
          changePct: tick.changePct ?? prevAnchor?.changePct ?? 0,
          high24h: tick.high24h ?? Math.max(prevAnchor?.high24h ?? tick.price, tick.price),
          low24h:
            tick.low24h ??
            (prevAnchor && prevAnchor.low24h > 0
              ? Math.min(prevAnchor.low24h, tick.price)
              : tick.price),
        });
      }
      return ticks;
    };

    const fetchRestSnapshot = async () => {
      if (disposed) return;
      if (activeAbort) activeAbort.abort();
      const controller = new AbortController();
      activeAbort = controller;
      const timeoutId = window.setTimeout(() => controller.abort(), 4500);

      try {
        const res = await fetch(BINANCE_REST_TICKER_URL, { signal: controller.signal });
        if (res.ok) {
          const rows = await res.json();
          const ticks = parseBinanceRestTicker24hr(rows);
          if (ticks.length > 0 && !disposed) {
            recordAnchors(ticks);
            setQuotes((prev) => applyLiveMarketTicks(prev, ticks));
            return;
          }
        }
      } catch {
        // Fall through to Coinbase public exchange rates
      }

      if (disposed || controller.signal.aborted) {
        window.clearTimeout(timeoutId);
        return;
      }

      try {
        const cbRes = await fetch(COINBASE_EXCHANGE_RATES_URL, { signal: controller.signal });
        if (cbRes.ok) {
          const payload = await cbRes.json();
          const ticks = parseCoinbaseExchangeRates(payload, INITIAL_QUOTES);
          if (ticks.length > 0 && !disposed) {
            recordAnchors(ticks);
            setQuotes((prev) => applyLiveMarketTicks(prev, ticks));
          }
        }
      } catch {
        // Offline / blocked network falls back seamlessly to UTC deterministic micro-ticks
      } finally {
        window.clearTimeout(timeoutId);
      }
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== null) return;
      const delayMs = Math.min(5000, 500 * Math.pow(2, reconnectAttempts));
      reconnectAttempts += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connectWs();
      }, delayMs);
    };

    const connectWs = () => {
      if (disposed || typeof WebSocket === 'undefined') return;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          try {
            ws.close();
          } catch {
            // ignore close error
          }
        }
        ws = null;
      }

      try {
        const nextWs = new WebSocket(BINANCE_COMBINED_STREAM_URL);
        ws = nextWs;

        nextWs.onopen = () => {
          reconnectAttempts = 0;
        };

        nextWs.onmessage = (event) => {
          if (disposed) return;
          try {
            const payload = JSON.parse(String(event.data));
            const tick = parseBinanceMiniTickerPayload(payload);
            if (!tick) return;
            lastWsTickMs = Date.now();
            recordAnchors([tick]);
            setQuotes((prev) => applyLiveMarketTicks(prev, [tick]));
          } catch {
            // ignore malformed frame
          }
        };

        nextWs.onerror = () => {
          if (!disposed && ws === nextWs) {
            scheduleReconnect();
          }
        };

        nextWs.onclose = () => {
          if (!disposed && ws === nextWs) {
            ws = null;
            scheduleReconnect();
          }
        };
      } catch {
        ws = null;
        scheduleReconnect();
      }
    };

    const handleResumeOrWake = () => {
      if (disposed) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void fetchRestSnapshot();
      const staleOrClosed =
        !ws ||
        ws.readyState === WebSocket.CLOSED ||
        ws.readyState === WebSocket.CLOSING ||
        Date.now() - lastWsTickMs > 4000;
      if (staleOrClosed) {
        reconnectAttempts = 0;
        connectWs();
      }
    };

    void fetchRestSnapshot();
    connectWs();

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleResumeOrWake);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('pageshow', handleResumeOrWake);
      window.addEventListener('online', handleResumeOrWake);
    }

    const restFallbackInterval = window.setInterval(() => {
      if (Date.now() - lastWsTickMs > 4500) {
        void fetchRestSnapshot();
      }
    }, 5000);

    const utcMicroTickInterval = window.setInterval(() => {
      const nowMs = Date.now();
      const wsHealthy = nowMs - lastWsTickMs <= 4500;
      setQuotes((prev) =>
        evaluateDeterministicFallbackQuotes(prev, restAnchors, INITIAL_QUOTES, nowMs, wsHealthy)
      );
    }, 1000);

    return () => {
      disposed = true;
      if (activeAbort) activeAbort.abort();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      window.clearInterval(restFallbackInterval);
      window.clearInterval(utcMicroTickInterval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleResumeOrWake);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('pageshow', handleResumeOrWake);
        window.removeEventListener('online', handleResumeOrWake);
      }
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  // Subscribe to shared Firestore "custom_coins" in real time (overwriting stale localStorage) & tick deterministically every UTC second
  useEffect(() => {
    const applyCoinSnapshot = (coins: AdminManagedCoin[]) => {
      setAdminCoins(coins);
      const enabledCoins = coins.filter((c) => c.enabled);
      setQuotes((prev) => {
        const builtIn = prev.filter((q) => !q.isCustom);
        return mergeBuiltInAndCustomQuotes(builtIn, enabledCoins);
      });
    };

    const unsubCoins = subscribeToCustomCoinsStatic(true, applyCoinSnapshot);
    const timer = setInterval(() => {
      applyCoinSnapshot(evaluateCustomCoinsForCurrentSecondStatic(true, Date.now()));
    }, 1000);

    return () => {
      unsubCoins();
      clearInterval(timer);
    };
  }, []);

  // Deterministic Landing Live Feed Stream rotation synced across clients by UTC time slot (deduplicated)
  useEffect(() => {
    if (user.isLoggedIn) return;
    const id = setInterval(() => {
      setLiveFeedItems((prev) => appendDeterministicLiveFeedItem(prev, Date.now()));
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
      void recordCoinTradeStatic({
        ...payload,
        userUid: currentUser.uid,
        userEmail: currentUser.email,
      }).catch(() => {});
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

        if (!stateRef.current.user.isLocalDemoSession && isFirebaseConfigured && db && auth?.currentUser) {
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
      if (triggeredPreOrderIdsRef.current.has(order.id)) continue;
      const q = currentQuotes.find((item) => item.symbol === order.symbol);
      if (!q) continue;
      if (shouldTriggerPreOrder(order, q.price)) {
        triggeredPreOrderIdsRef.current.add(order.id);
        const filledPos: Position = { ...order, markPrice: q.price };
        stateRef.current.preOrders = stateRef.current.preOrders.filter((o) => o.id !== order.id);
        if (!stateRef.current.activePositions.some((p) => p.id === order.id)) {
          stateRef.current.activePositions = [...stateRef.current.activePositions, filledPos];
        }
        setPreOrders((prev) => prev.filter((o) => o.id !== order.id));
        setActivePositions((prev) =>
          prev.some((p) => p.id === order.id) ? prev : [...prev, filledPos]
        );
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
        if (!currentUser.isLocalDemoSession && isFirebaseConfigured && db && auth?.currentUser) {
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
        const isAdminAccess = user.role === 'admin' || Boolean(activeToken);
        const data = await tickAndGetLotteryStateStatic(user.uid, isAdminAccess);
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
            if (!prev.isLocalDemoSession && isFirebaseConfigured && db && auth?.currentUser) {
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
        [authToken, user.uid, user.role, showToast, applyWalletDeltaOnServer]
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
      const list = await listNewsArticlesStatic(false);
      setNewsArticles(list);
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
      if (!activeToken && stateRef.current.user.role !== 'admin') return;
      setAdminNewsLoading(true);
      try {
        const list = await listNewsArticlesStatic(true);
        setAdminNewsArticles(list);
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
      if (!authToken && user.role !== 'admin') {
        showToast('Admin authentication required to publish dispatches.', 'error');
        return false;
      }
      const res = await createNewsArticleStatic(payload);
      if (!res.ok) {
        showToast(res.error || 'Unable to publish news dispatch.', 'error');
        return false;
      }
      setAdminNewsArticles(res.articles);
      setNewsArticles(res.articles.filter((a) => a.isPublished));
      showToast('News dispatch published.');
      return true;
    },
    [authToken, user.role, showToast]
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
      if (!authToken && user.role !== 'admin') {
        showToast('Admin authentication required.', 'error');
        return false;
      }
      const res = await updateNewsArticleStatic(id, updates);
      if (!res.ok) {
        showToast(res.error || 'Unable to update news dispatch.', 'error');
        return false;
      }
      setAdminNewsArticles(res.articles);
      setNewsArticles(res.articles.filter((a) => a.isPublished));
      showToast('News dispatch updated.');
      return true;
    },
    [authToken, user.role, showToast]
  );

  const handleDeleteAdminNews = useCallback(
    async (id: number): Promise<boolean> => {
      if (!authToken && user.role !== 'admin') {
        showToast('Admin authentication required.', 'error');
        return false;
      }
      const res = await deleteNewsArticleStatic(id);
      if (!res.ok) {
        showToast(res.error || 'Unable to delete news dispatch.', 'error');
        return false;
      }
      setAdminNewsArticles(res.articles);
      setNewsArticles(res.articles.filter((a) => a.isPublished));
      showToast('News dispatch deleted.');
      return true;
    },
    [authToken, user.role, showToast]
  );

  const fetchAdminMembersFromServer = useCallback(async (_tokenOverride?: string, queryText = '') => {
    try {
      const list = await listMembersStatic(queryText);
      setManagedMembers(list);
    } catch {
      // ignore cleanly
    }
  }, []);

  const loadStaffRequests = useCallback(
    async (_tokenOverride?: string) => {
      const role = stateRef.current.user.role;
      const isStaffRole = ['admin', 'staff', 'caiwu', 'chukuan'].includes(role);
      if (!isStaffRole) return;

      const canSeeDeposits = role === 'admin' || role === 'staff' || role === 'caiwu';
      const canSeeWithdrawals = role === 'admin' || role === 'staff' || role === 'chukuan';

      setStaffRequestsLoading(true);
      try {
        const { deposits, withdrawals } = await listStaffRequestsStatic(role);
        const depositsList = [...deposits];
        const withdrawalsList = [...withdrawals];
        const seenKeys = new Set<string>([
          ...depositsList.map((d) => `dep|${d.userId}|${d.amount}|${d.target}`),
          ...withdrawalsList.map((w) => `wd|${w.userId}|${w.amount}|${w.target}`),
        ]);

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
    [walletTransactions]
  );

  const fetchAdminCoins = useCallback(async (_tokenOverride?: string) => {
    if (stateRef.current.user.role !== 'admin') return;
    try {
      const list = await syncAndListCustomCoinsStatic(true);
      setAdminCoins(list);
    } catch {
      // Keep current coins cleanly
    }
  }, []);

  const fetchCoinAnalytics = useCallback(async (symbol: string, _tokenOverride?: string) => {
    if (stateRef.current.user.role !== 'admin' || !symbol) return;
    setCoinAnalyticsLoading(true);
    try {
      const analytics = await getCoinTradeAnalyticsStatic(symbol);
      setSelectedCoinAnalytics(analytics);
    } catch {
      // Ignore errors gracefully
    } finally {
      setCoinAnalyticsLoading(false);
    }
  }, []);

  const handleUpsertAdminCoin = useCallback(
    async (payload: { symbol: string; label?: string; initialPrice: number; enabled?: boolean }) => {
      if (user.role !== 'admin' && !authToken) {
        showToast('Only Full Admin can add custom coins.', 'error');
        return null;
      }
      try {
        const saved = await upsertCustomCoinStatic(payload);
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
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Failed to save custom coin.', 'error');
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
      if (user.role !== 'admin' && !authToken) {
        showToast('Only Full Admin can control coin prices.', 'error');
        return null;
      }
      try {
        const updated = await updateCoinPriceControlStatic(symbol, payload);
        if (!updated) {
          showToast('Custom coin not found.', 'error');
          return null;
        }
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
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Failed to update coin price schedule.', 'error');
        return null;
      }
    },
    [authToken, user.role, fetchCoinAnalytics, showToast]
  );

  const handleDeleteAdminCoin = useCallback(
    async (symbol: string): Promise<boolean> => {
      if (user.role !== 'admin' && !authToken) {
        showToast('Only Full Admin can delete custom coins.', 'error');
        return false;
      }
      const removed = await deleteCustomCoinStatic(symbol);
      if (!removed) {
        showToast('Custom coin not found.', 'error');
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
    },
    [authToken, user.role, selectedSymbol, showToast]
  );

  const handleClaimCoinProfit = useCallback(
    async (symbol: string): Promise<boolean> => {
      if (user.role !== 'admin' && !authToken) {
        showToast('Only Full Admin can claim coin profit.', 'error');
        return false;
      }
      const result = await claimAdminCoinProfitStatic({
        symbol,
        adminUid: user.uid,
        adminEmail: user.email,
      });
      if (result.claimedAmount <= 0) {
        showToast('No unclaimed profit available to claim yet.', 'error');
        return false;
      }
      const updatedAdmin = await applyWalletDeltaStatic({
        uid: user.uid,
        email: user.email,
        wallet: 'real',
        delta: result.claimedAmount,
      });
      const newBal = updatedAdmin?.realBalance ?? Number((user.realBalance + result.claimedAmount).toFixed(2));
      setUser((prev) => ({ ...prev, realBalance: newBal }));
      setManagedMembers((prev) =>
        prev.map((m) => (m.uid === user.uid ? { ...m, realBalance: newBal } : m))
      );
      setSelectedCoinAnalytics(result.analytics);
      showToast(`Claimed $${result.claimedAmount.toFixed(2)} net profit to Admin Real Wallet!`);
      return true;
    },
    [authToken, user.role, user.uid, user.email, user.realBalance, showToast]
  );

  useEffect(() => {
    if (user.isLoggedIn && (authToken || ['admin', 'staff', 'caiwu', 'chukuan'].includes(user.role))) {
      if (user.role === 'admin') {
        fetchAdminCoins(authToken ?? undefined);
      }
      if (['admin', 'staff', 'caiwu'].includes(user.role)) {
        fetchAdminMembersFromServer(authToken ?? undefined);
      }
      if (['admin', 'staff', 'caiwu', 'chukuan'].includes(user.role)) {
        loadStaffRequests(authToken ?? undefined);
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
        const res = await placeLotteryBetStatic({
          userUid: user.uid,
          userEmail: user.email,
          accountMode,
          betType: payload.betType,
          color: payload.color,
          pickedNumber: payload.pickedNumber,
          stake,
          isAdmin: user.role === 'admin' || Boolean(authToken),
        });
        setLotteryState(res.state);
        if (!user.isLocalDemoSession) {
          applyWalletDeltaOnServer(accountMode, -stake);
        }
        if (!user.isLocalDemoSession && isFirebaseConfigured && db && auth?.currentUser) {
          const nextBal = Number(Math.max(0, activeBal - stake).toFixed(2));
          updateDoc(doc(db, 'users', user.uid), { [balanceField]: nextBal }).catch(() => {});
        }
        const label =
          payload.betType === 'number'
            ? `#${payload.pickedNumber}`
            : (payload.color ?? 'green').toUpperCase();
        showToast(`Confirmed ${label} trade · $${stake.toFixed(2)}.`);
        return true;
      } catch (err) {
        setUser((prev) => ({
          ...prev,
          [balanceField]: Number((prev[balanceField] + stake).toFixed(2)),
        }));
        showToast(err instanceof Error ? err.message : 'Failed to confirm Lottery trade.', 'error');
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
      user.role,
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
        const res = await placeDigitLotteryBetStatic({
          userUid: user.uid,
          userEmail: user.email,
          accountMode,
          drawUid: payload.drawUid,
          pickedNumber: payload.pickedNumber,
          stake,
          isAdmin: user.role === 'admin' || Boolean(authToken),
        });
        setLotteryState(res.state);
        if (!user.isLocalDemoSession) {
          applyWalletDeltaOnServer(accountMode, -stake);
        }
        if (!user.isLocalDemoSession && isFirebaseConfigured && db && auth?.currentUser) {
          const nextBal = Number(Math.max(0, activeBal - stake).toFixed(2));
          updateDoc(doc(db, 'users', user.uid), { [balanceField]: nextBal }).catch(() => {});
        }
        showToast(
          `Confirmed ${res.bet.gameType} Ticket #${res.bet.pickedNumber} · $${stake.toFixed(2)}`
        );
        return true;
      } catch (err) {
        setUser((prev) => ({
          ...prev,
          [balanceField]: Number((prev[balanceField] + stake).toFixed(2)),
        }));
        showToast(err instanceof Error ? err.message : 'Failed to place 2D/3D/6D ticket.', 'error');
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
      user.role,
      user.isLocalDemoSession,
      applyWalletDeltaOnServer,
      showToast,
    ]
  );

  const handleUnlockLotteryAdmin = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      const res = await authenticateStaticAdmin(email, password);
      if (!res.ok) {
        showToast(res.error || 'Invalid Admin credentials.', 'error');
        return false;
      }
      setAuthToken(res.token);
      authTokenRef.current = res.token;
      fetchAdminMembersFromServer(res.token);
      fetchLotteryState(res.token);
      showToast('Lottery Admin Control Console unlocked.');
      return true;
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
      if (!authToken && user.role !== 'admin') {
        showToast('Admin authentication required.', 'error');
        return false;
      }
      try {
        const nextState = await updateLotteryAdminConfigStatic(payload, user.uid);
        setLotteryState(nextState);
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
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Failed to update Lottery configuration.', 'error');
        return false;
      }
    },
    [authToken, user.role, user.uid, showToast]
  );

  const handleScheduleDigitDraw = useCallback(
    async (payload: DigitDrawSchedulePayload): Promise<boolean> => {
      if (!authToken && user.role !== 'admin') {
        showToast('Admin authentication required.', 'error');
        return false;
      }
      try {
        const nextState = await adminScheduleDigitDrawStatic(payload, user.uid);
        setLotteryState(nextState);
        if (payload.releaseNow) {
          showToast(`${payload.gameType} result released & settled.`);
        } else {
          showToast(`${payload.gameType} draw schedule saved.`);
        }
        return true;
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Failed to update 2D/3D/6D schedule.', 'error');
        return false;
      }
    },
    [authToken, user.role, user.uid, showToast]
  );

  // Handlers
  const handleEnterDemoWorkspace = () => {
    closingIdsRef.current.clear();
    settledIdsRef.current.clear();
    triggeredPreOrderIdsRef.current.clear();
    seenSqlTransferIdsRef.current.clear();
    initialWalletSyncDoneRef.current = false;
    pendingWalletDeltasRef.current = 0;
    setAuthToken(null);
    authTokenRef.current = null;
    setUser(DEMO_USER_TEMPLATE);
    setActiveSection('trade');
    showToast('Entered $100,000 Demo Workspace.');
  };

  const handleGoogleSignIn = async () => {
    if (!isOAuthFirebaseConfigured || !oauthAuth) {
      showToast('Google Sign-In is unavailable without Firebase OAuth config. Use Email login or Launch Demo.', 'error');
      return;
    }
    try {
      await signInWithPopup(oauthAuth, googleAuthProvider);
      showToast('Signed in with Google.');
    } catch (err: unknown) {
      if (isAuthCancellationError(err)) {
        return;
      }

      const code = (err as { code?: string } | null)?.code ?? '';
      if (
        code === 'auth/popup-blocked' ||
        code === 'auth/operation-not-supported-in-this-environment'
      ) {
        try {
          await signInWithRedirect(oauthAuth, googleAuthProvider);
          return;
        } catch (redirectErr: unknown) {
          if (isAuthCancellationError(redirectErr)) {
            return;
          }
          showToast(formatFriendlyAuthError(redirectErr, 'Google Sign-In failed.'), 'error');
          return;
        }
      }

      showToast(formatFriendlyAuthError(err, 'Google Sign-In failed.'), 'error');
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
        if (!isFirebaseConfigured || !auth) {
          showToast('Password reset requires Firebase configuration.', 'error');
          return;
        }
        await sendPasswordResetEmail(auth, payload.email, ZECTRADE_ACTION_CODE_SETTINGS);
        showToast(`Password reset email sent to ${payload.email}.`);
        return;
      }

      if (!payload.password || payload.password.length < 6) {
        showToast('Password must be at least 6 characters.', 'error');
        return;
      }

      if (payload.mode === 'login' && payload.email.trim().toLowerCase() === 'admin@zectrade.io') {
        const res = await authenticateStaticAdmin(payload.email, payload.password);
        if (!res.ok) {
          showToast('Invalid email or password.', 'error');
          return;
        }
        const adminUser = res.user;
        setAuthToken(res.token);
        authTokenRef.current = res.token;
        setUser({
          uid: adminUser.uid,
          isLoggedIn: true,
          isLocalDemoSession: false,
          username: adminUser.username || 'Lead Admin',
          email: adminUser.email,
          pin: adminUser.securityPin || '8888',
          role: 'admin',
          isBlocked: false,
          isWithdrawBlocked: false,
          invitedBy: null,
          hasDepositedBefore: true,
          hasFirstDeposit: true,
          totalDeposited: Number(adminUser.totalDeposited ?? 25000),
          firstDepositRevokedByAdmin: false,
          hasTradedAfterDeposit: true,
          withdrawLockClearedByAdmin: true,
          demoBalance: Number(adminUser.demoBalance ?? 100000),
          realBalance: Number(adminUser.realBalance ?? 25000),
          spotHoldings: {},
          avatarUrl: adminUser.avatarUrl ?? null,
          fullName: adminUser.fullName ?? null,
          phone: adminUser.phone ?? null,
          country: adminUser.country ?? null,
          bio: adminUser.bio ?? null,
          withdrawMethod: (adminUser.withdrawMethod as WithdrawMethod | undefined) || 'kpay',
          withdrawAccountName: adminUser.withdrawAccountName ?? null,
          withdrawAccountNumber: adminUser.withdrawAccountNumber ?? null,
        });
        setActiveSection('lottery');
        fetchLotteryState(res.token);
        fetchAdminMembersFromServer(res.token);
        fetchAdminCoins(res.token);
        fetchAdminNews(res.token);
        syncWalletFromServer({ tokenOverride: res.token, force: true, silent: true });
        showToast('Signed in successfully.');
        return;
      }

      if (!isFirebaseConfigured || !auth || !db) {
        showToast('Member email authentication requires Firebase config. Use Admin Sign-In or Launch Demo.', 'error');
        return;
      }

      if (payload.mode === 'register') {
        const cred = await createUserWithEmailAndPassword(auth, payload.email, payload.password);
        await sendEmailVerification(cred.user, ZECTRADE_ACTION_CODE_SETTINGS).catch(() => {});
        const name = payload.username || payload.email.split('@')[0];
        const cleanRegEmail = payload.email.trim().toLowerCase();
        await setDoc(doc(db, 'users', cred.user.uid), {
          uid: cred.user.uid,
          username: name,
          email: cleanRegEmail,
          role: 'user',
          securityPin: '1234',
          isBlocked: false,
          isWithdrawBlocked: false,
          invitedBy: payload.referralCode || null,
          hasDepositedBefore: false,
          hasFirstDeposit: false,
          totalDeposited: 0,
          firstDepositRevokedByAdmin: false,
          hasTradedAfterDeposit: false,
          withdrawLockClearedByAdmin: false,
          twoFactorEnabled: false,
          demoBalance: 100000,
          realBalance: FIRST_REGISTER_REAL_BONUS_USD,
          spotHoldings: {},
          createdAt: serverTimestamp(),
        });
        await addDoc(collection(db, 'users', cred.user.uid, 'transactions'), {
          userId: cred.user.uid,
          userEmail: cleanRegEmail,
          type: 'SIGN-UP WELCOME BONUS',
          amount: FIRST_REGISTER_REAL_BONUS_USD,
          target: 'Real Account ($2 Bonus)',
          isAdjustment: true,
          status: 'SUCCESS',
          createdAtMs: Date.now(),
          createdAt: serverTimestamp(),
        });
        const nextStats = await incrementPlatformStatsForActivityStatic(
          { type: 'registration' },
          cred.user.uid
        );
        if (nextStats) setPlatformStats(nextStats);
        showToast('Account registered! Verification link sent to your email, and $2.00 Real bonus credited.');
      } else {
        await signInWithEmailAndPassword(auth, payload.email, payload.password);
        showToast('Signed in successfully.');
      }
    } catch (err: unknown) {
      showToast(formatFriendlyAuthError(err, 'Authentication failed. Please try again.'), 'error');
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
    if (isSubmittingOrderRef.current) {
      return false;
    }
    isSubmittingOrderRef.current = true;

    try {
      const {
        user: currentUser,
        quotes: currentQuotes,
        activePositions: currentPositions,
        preOrders: currentPreOrders,
      } = stateRef.current;

      if (currentUser.isBlocked) {
        showToast('Your account is currently restricted. Please contact support.', 'error');
        return false;
      }
      const quote = currentQuotes.find((q) => q.symbol === payload.symbol) ?? currentQuotes[0];
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

      const avail = accountMode === 'demo' ? currentUser.demoBalance : currentUser.realBalance;
      if (preview.totalRequired > avail) {
        showToast(`Insufficient ${accountMode.toUpperCase()} balance (Need $${preview.totalRequired.toFixed(2)}).`, 'error');
        return false;
      }

      const conflict = checkOrderDirectionConflict(
        payload.symbol,
        payload.side,
        accountMode,
        currentPositions,
        currentPreOrders
      );
      if (!conflict.allowed) {
        showToast(conflict.reason || `You already have an active position or pending order on ${payload.symbol}. Close or cancel it first.`, 'error');
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

      const nextDemo = accountMode === 'demo' ? currentUser.demoBalance - preview.totalRequired : currentUser.demoBalance;
      const nextReal = accountMode === 'real' ? currentUser.realBalance - preview.totalRequired : currentUser.realBalance;
      const tradedReal = accountMode === 'real';

      stateRef.current.user = {
        ...currentUser,
        demoBalance: nextDemo,
        realBalance: nextReal,
        hasTradedAfterDeposit: tradedReal ? true : currentUser.hasTradedAfterDeposit,
      };
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
        stateRef.current.preOrders = [...stateRef.current.preOrders, orderData];
        setPreOrders((prev) => (prev.some((o) => o.id === orderId) ? prev : [...prev, orderData]));
        showToast(`Limit Pre-Order queued for ${payload.symbol} at $${preview.effectiveEntryPrice.toFixed(2)}.`);
      } else {
        stateRef.current.activePositions = [...stateRef.current.activePositions, orderData];
        setActivePositions((prev) => (prev.some((p) => p.id === orderId) ? prev : [...prev, orderData]));
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

      if (!currentUser.isLocalDemoSession) {
        applyWalletDeltaOnServer(accountMode, -preview.totalRequired, tradedReal);
      }

      if (!currentUser.isLocalDemoSession && isFirebaseConfigured && db && auth?.currentUser) {
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
    } finally {
      if (orderCooldownTimerRef.current) {
        clearTimeout(orderCooldownTimerRef.current);
      }
      orderCooldownTimerRef.current = setTimeout(() => {
        isSubmittingOrderRef.current = false;
      }, 1500);
    }
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
      if (!stateRef.current.user.isLocalDemoSession && isFirebaseConfigured && db && auth?.currentUser) {
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
    if (triggeredPreOrderIdsRef.current.has(id)) return;
    const order = stateRef.current.preOrders.find((o) => o.id === id);
    if (!order) return;
    triggeredPreOrderIdsRef.current.add(id);

    const quote = stateRef.current.quotes.find((q) => q.symbol === order.symbol);
    const livePrice = quote ? quote.price : order.entryPrice;
    const filledPos: Position = { ...order, entryPrice: livePrice, markPrice: livePrice };

    stateRef.current.preOrders = stateRef.current.preOrders.filter((o) => o.id !== id);
    if (!stateRef.current.activePositions.some((p) => p.id === id)) {
      stateRef.current.activePositions = [...stateRef.current.activePositions, filledPos];
    }
    setPreOrders((prev) => prev.filter((o) => o.id !== id));
    setActivePositions((prev) => (prev.some((p) => p.id === id) ? prev : [...prev, filledPos]));
    recordTradeOnServer({
      tradeUid: order.id,
      symbol: order.symbol,
      side: order.side,
      leverage: order.leverage,
      margin: order.margin,
      entryPrice: livePrice,
      liqPrice: getNumericLiqPrice(filledPos),
      tradingFee: order.tradingFeePaid,
      pnlVal: 0,
      status: 'OPEN',
      accountMode: order.accountMode,
    });
    if (!stateRef.current.user.isLocalDemoSession && isFirebaseConfigured && db && auth?.currentUser) {
      const uid = auth.currentUser.uid;
      deleteDoc(doc(db, 'users', uid, 'orders', id)).catch(() => {});
      setDoc(doc(db, 'users', uid, 'positions', id), filledPos).catch(() => {});
    }
    showToast(`Order chased to market $${livePrice.toFixed(2)} and opened.`);
  };

  const handleSaveModifiedOrder = async (id: string, entryPrice: number, margin: number) => {
    setPreOrders((prev) =>
      prev.map((o) => (o.id === id ? { ...o, entryPrice, margin, totalValue: margin * o.leverage } : o))
    );
    showToast('Pre-order target updated.');
  };

  const handleCancelPreOrder = async (id: string) => {
    if (triggeredPreOrderIdsRef.current.has(id)) return;
    const order = stateRef.current.preOrders.find((o) => o.id === id);
    if (!order) return;
    triggeredPreOrderIdsRef.current.add(id);

    const refund = order.margin + order.tradingFeePaid;
    stateRef.current.preOrders = stateRef.current.preOrders.filter((o) => o.id !== id);
    setPreOrders((prev) => prev.filter((o) => o.id !== id));
    setUser((prev) => ({
      ...prev,
      demoBalance: order.accountMode === 'demo' ? prev.demoBalance + refund : prev.demoBalance,
      realBalance: order.accountMode === 'real' ? prev.realBalance + refund : prev.realBalance,
    }));
    if (!stateRef.current.user.isLocalDemoSession) {
      applyWalletDeltaOnServer(order.accountMode, refund);
      if (isFirebaseConfigured && db && auth?.currentUser) {
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
      if (!user.isLocalDemoSession && isFirebaseConfigured && db && auth?.currentUser) {
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
      if (!user.isLocalDemoSession && isFirebaseConfigured && db && auth?.currentUser) {
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
        hasFirstDeposit: true,
        totalDeposited: Number((Number(prev.totalDeposited ?? 0) + usdAmount).toFixed(2)),
        firstDepositRevokedByAdmin: false,
        hasTradedAfterDeposit: false,
        withdrawLockClearedByAdmin: false,
      }));
    }

    if (!isDemo) {
      try {
        const created = await createWalletRequestStatic({
          userUid: user.uid,
          userEmail: user.email,
          requestKind: 'deposit',
          typeLabel: `DEPOSIT SUBMITTED (${method.toUpperCase()})`,
          method,
          amountUsd: usdAmount,
          target: targetDesc,
        });
        setWalletTransactions((prev) =>
          prev.map((item) => (item.id === tx.id ? { ...item, id: created.id } : item))
        );
      } catch {
        // ignore cleanly
      }
    }

    if (!isDemo && isFirebaseConfigured && db && auth?.currentUser) {
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
    pin: string,
    totpCode?: string
  ): Promise<boolean> => {
    if (!effectiveHasFirstDeposit) {
      showToast(FIRST_DEPOSIT_REQUIRED_MESSAGE, 'error');
      return false;
    }
    const eligibility = evaluateWithdrawalEligibility({
      ...user,
      hasFirstDeposit: effectiveHasFirstDeposit,
      hasDepositedBefore: effectiveHasFirstDeposit,
    });
    if (!eligibility.allowed) {
      showToast(eligibility.reason || 'Withdrawals are locked for your account.', 'error');
      return false;
    }
    if (pin !== user.pin) {
      showToast('Incorrect 4-digit Security PIN.', 'error');
      return false;
    }
    if (user.twoFactorEnabled) {
      if (!verifyTotpCode(user.twoFactorSecret, totpCode || '')) {
        showToast('Invalid 6-digit Google Authenticator code.', 'error');
        return false;
      }
    }
    if (usdAmount <= 0 || usdAmount > user.realBalance) {
      showToast('Insufficient Real Balance for withdrawal.', 'error');
      return false;
    }
    const nextReal = user.realBalance - usdAmount;
    const typeLabel = `WITHDRAWAL (${method.toUpperCase()})`;
    const txId = Date.now().toString();
    setUser((prev) => ({ ...prev, realBalance: nextReal }));
    setWalletTransactions((prev) => [
      {
        id: txId,
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
      try {
        const created = await createWalletRequestStatic({
          userUid: user.uid,
          userEmail: user.email,
          requestKind: 'withdrawal',
          typeLabel,
          method,
          amountUsd: usdAmount,
          target: targetDesc,
        });
        setWalletTransactions((prev) =>
          prev.map((item) => (item.id === txId ? { ...item, id: created.id } : item))
        );
      } catch {
        // ignore cleanly
      }
    }

    if (!user.isLocalDemoSession && isFirebaseConfigured && db && auth?.currentUser) {
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
      if (
        trimmed.toLowerCase() === user.uid.toLowerCase() ||
        trimmed.toLowerCase() === user.email.toLowerCase()
      ) {
        return { ok: false, error: 'Cannot transfer to your own account.' };
      }

      const found = await lookupTransferRecipientDirect(trimmed);
      if (found) {
        return { ok: true, recipient: found };
      }
      return { ok: false, error: "Account doesn't exist." };
    },
    [user.uid, user.email]
  );

  const handleSubmitTransfer = async (
    recipient: string,
    amount: number,
    pin: string,
    totpCode?: string
  ): Promise<{ ok: boolean; error?: string }> => {
    const transferMode: AccountMode = 'real';
    if (!effectiveHasFirstDeposit) {
      showToast(FIRST_DEPOSIT_REQUIRED_MESSAGE, 'error');
      return { ok: false, error: FIRST_DEPOSIT_REQUIRED_MESSAGE };
    }
    if (pin !== user.pin) {
      showToast('Incorrect 4-digit Security PIN.', 'error');
      return { ok: false, error: 'Incorrect 4-digit Security PIN.' };
    }
    if (user.twoFactorEnabled) {
      if (!verifyTotpCode(user.twoFactorSecret, totpCode || '')) {
        showToast('Invalid 6-digit Google Authenticator code.', 'error');
        return { ok: false, error: 'Invalid 6-digit Google Authenticator code.' };
      }
    }
    const avail = user.realBalance;
    if (!Number.isFinite(amount) || amount < 1 || amount > avail) {
      const msg =
        amount < 1
          ? 'Minimum transfer amount is $1.00.'
          : 'Insufficient REAL balance.';
      showToast(msg, 'error');
      return { ok: false, error: msg };
    }
    if (
      recipient.trim().toLowerCase() === user.uid.toLowerCase() ||
      recipient.trim().toLowerCase() === user.email.toLowerCase()
    ) {
      showToast('Cannot transfer to your own account.', 'error');
      return { ok: false, error: 'Cannot transfer to your own account.' };
    }

    const result = await executeDirectP2PTransfer({
      senderUid: user.uid,
      senderEmail: user.email,
      senderUsername: user.username,
      recipientIdentifier: recipient,
      accountMode: transferMode,
      amount,
      pin,
      isLocalDemoSession: user.isLocalDemoSession,
      localSenderBalance: avail,
      expectedLocalPin: user.pin,
      senderHasFirstDeposit: effectiveHasFirstDeposit,
      totpCode,
      expectedLocalTwoFactorEnabled: Boolean(user.twoFactorEnabled),
      expectedLocalTwoFactorSecret: user.twoFactorSecret ?? null,
    });

    if (!result.ok) {
      showToast(result.error, 'error');
      return { ok: false, error: result.error };
    }

    const resolvedRecipient: VerifiedTransferRecipient = {
      uid: result.recipient.uid,
      username: result.recipient.username,
      email: result.recipient.email,
    };
    const nextSenderBalance = result.senderRemainingBalance;
    const nextRecipientBalance = result.recipient.newBalance;

    setUser((prev) => ({
      ...prev,
      realBalance: nextSenderBalance,
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
          realBalance: nextRecipientBalance,
        };
      })
    );

    seenSqlTransferIdsRef.current.add(result.sentTransaction.id);
    setWalletTransactions((prev) => deduplicateFirestoreAgainstSql([result.sentTransaction], prev));

    showToast(`Transferred $${amount.toFixed(2)} to ${resolvedRecipient.username} (${resolvedRecipient.uid}).`);
    return { ok: true };
  };

  const handleSavePin = async (pin: string) => {
    setUser((prev) => ({ ...prev, pin }));
    if (!user.isLocalDemoSession) {
      await updateMemberFieldsStatic(user.uid, { securityPin: pin });
    }
    if (!user.isLocalDemoSession && isFirebaseConfigured && db && auth?.currentUser) {
      try {
        await updateDoc(doc(db, 'users', auth.currentUser.uid), { securityPin: pin });
      } catch {
        // ignore
      }
    }
    showToast('Security PIN updated.');
  };

  const handleSendVerificationEmail = async (): Promise<{ ok: boolean; sentAtMs?: number }> => {
    if (!isFirebaseConfigured || !auth?.currentUser) {
      showToast(
        'Email verification links are sent via Firebase Auth for registered email accounts.',
        'error'
      );
      return { ok: false };
    }
    if (auth.currentUser.emailVerified) {
      setUser((prev) => ({ ...prev, emailVerified: true }));
      showToast('Your email address is already verified.');
      return { ok: false };
    }
    try {
      await sendEmailVerification(auth.currentUser, ZECTRADE_ACTION_CODE_SETTINGS);
      showToast(`Verification link sent to ${auth.currentUser.email || user.email}.`);
      return { ok: true, sentAtMs: Date.now() };
    } catch (err: unknown) {
      const code = (err as { code?: string } | null)?.code;
      if (code === 'auth/too-many-requests') {
        showToast('Please wait 60 seconds before requesting another verification email.', 'error');
      } else {
        showToast('Unable to send verification email right now. Please try again.', 'error');
      }
      return { ok: false };
    }
  };

  const handleRefreshEmailVerification = async (): Promise<void> => {
    if (!isFirebaseConfigured || !auth?.currentUser) {
      showToast('Sign in with a registered email account to check email verification status.', 'error');
      return;
    }
    try {
      await auth.currentUser.reload();
      const verified = Boolean(auth.currentUser.emailVerified);
      setUser((prev) => ({ ...prev, emailVerified: verified }));
      if (verified) {
        if (db) {
          await setDoc(
            doc(db, 'users', auth.currentUser.uid),
            { emailVerified: true },
            { merge: true }
          ).catch(() => {});
        }
        showToast('Email verified successfully!');
      } else {
        showToast('Email is still unverified. Click the link in your inbox, then refresh.', 'error');
      }
    } catch {
      showToast('Could not refresh verification status. Please try again.', 'error');
    }
  };

  const handleEnableTwoFactor = async (
    secretBase32: string,
    verificationCode: string
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!verifyTotpCode(secretBase32, verificationCode)) {
      return { ok: false, error: 'Invalid 6-digit Google Authenticator code.' };
    }
    const targetUid = auth?.currentUser?.uid || user.uid;
    if (!user.isLocalDemoSession && isFirebaseConfigured && db && targetUid) {
      try {
        await setDoc(
          doc(db, 'users', targetUid),
          {
            twoFactorEnabled: true,
            twoFactorSecret: secretBase32,
          },
          { merge: true }
        );
      } catch {
        return {
          ok: false,
          error: 'Could not save 2FA settings to Firestore. Please check your connection.',
        };
      }
    }
    setUser((prev) => ({
      ...prev,
      twoFactorEnabled: true,
      twoFactorSecret: secretBase32,
    }));
    showToast('Google Authenticator (2FA) enabled.');
    return { ok: true };
  };

  const handleDisableTwoFactor = async (
    verificationCode: string
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!verifyTotpCode(user.twoFactorSecret, verificationCode)) {
      return { ok: false, error: 'Invalid 6-digit Google Authenticator code.' };
    }
    const targetUid = auth?.currentUser?.uid || user.uid;
    if (!user.isLocalDemoSession && isFirebaseConfigured && db && targetUid) {
      try {
        await setDoc(
          doc(db, 'users', targetUid),
          {
            twoFactorEnabled: false,
            twoFactorSecret: null,
          },
          { merge: true }
        );
      } catch {
        return {
          ok: false,
          error: 'Could not update 2FA settings in Firestore. Please try again.',
        };
      }
    }
    setUser((prev) => ({
      ...prev,
      twoFactorEnabled: false,
      twoFactorSecret: null,
    }));
    showToast('Google Authenticator (2FA) disabled.');
    return { ok: true };
  };

  const handleSaveOwnProfile = async (payload: MemberProfileUpdatePayload): Promise<boolean> => {
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

    if (!user.isLocalDemoSession) {
      await updateMemberFieldsStatic(user.uid, {
        ...(payload.username ? { username: payload.username } : {}),
        ...(payload.avatarUrl !== undefined ? { avatarUrl: payload.avatarUrl } : {}),
        ...(payload.fullName !== undefined ? { fullName: payload.fullName } : {}),
        ...(payload.phone !== undefined ? { phone: payload.phone } : {}),
        ...(payload.country !== undefined ? { country: payload.country } : {}),
        ...(payload.bio !== undefined ? { bio: payload.bio } : {}),
        ...(payload.withdrawMethod ? { withdrawMethod: payload.withdrawMethod } : {}),
        ...(payload.withdrawAccountName !== undefined
          ? { withdrawAccountName: payload.withdrawAccountName }
          : {}),
        ...(payload.withdrawAccountNumber !== undefined
          ? { withdrawAccountNumber: payload.withdrawAccountNumber }
          : {}),
      });
    }

    if (!user.isLocalDemoSession && isFirebaseConfigured && db && auth?.currentUser) {
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
      if (auth) await signOut(auth);
    } catch {
      // ignore
    }
    try {
      if (oauthAuth) await signOut(oauthAuth);
    } catch {
      // ignore
    }
    localStorage.removeItem(STORAGE_KEY);
    closingIdsRef.current.clear();
    settledIdsRef.current.clear();
    seenSqlTransferIdsRef.current.clear();
    initialWalletSyncDoneRef.current = false;
    pendingWalletDeltasRef.current = 0;
    setAuthToken(null);
    authTokenRef.current = null;
    setUser({ ...DEMO_USER_TEMPLATE, isLoggedIn: false });
    setActiveSection('trade');
    showToast('Signed out.');
  };

  const copyText = (val: string, label: string) => {
    const fallbackCopy = () => {
      try {
        const el = document.createElement('textarea');
        el.value = val;
        el.setAttribute('readonly', '');
        el.style.position = 'fixed';
        el.style.opacity = '0';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      } catch {
        // Ignore clipboard denial in restricted iframe contexts
      }
    };
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(val).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }
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
    try {
      const list = await listMembersStatic(queryText);
      if (list.length > 0) {
        setManagedMembers((prev) => {
          const map = new Map(prev.map((m) => [m.uid, m]));
          for (const item of list) map.set(item.uid, item);
          return Array.from(map.values());
        });
      }
    } catch {
      // ignore cleanly
    }
  };

  const patchMemberServer = async (uid: string, body: Record<string, unknown>) => {
    await updateMemberFieldsStatic(uid, body as Partial<ManagedMember>);
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
    showToast(`Admin cleared withdrawal lock for ${target?.username ?? uid}.`);
  };

  const handleToggleFirstDeposit = async (uid: string, hasDeposited: boolean) => {
    if (!canClearWithdrawLock(user.role)) {
      showToast('Only Admin can update First Deposit status.', 'error');
      return;
    }
    const target = managedMembers.find((m) => m.uid === uid) ?? (uid === user.uid ? user : undefined);
    setManagedMembers((prev) =>
      prev.map((m) =>
        m.uid === uid
          ? {
              ...m,
              hasFirstDeposit: hasDeposited,
              hasDepositedBefore: hasDeposited,
              firstDepositRevokedByAdmin: !hasDeposited,
            }
          : m
      )
    );
    if (uid === user.uid) {
      setUser((prev) => ({
        ...prev,
        hasFirstDeposit: hasDeposited,
        hasDepositedBefore: hasDeposited,
        firstDepositRevokedByAdmin: !hasDeposited,
      }));
    }
    await patchMemberServer(uid, {
      hasFirstDeposit: hasDeposited,
      hasDepositedBefore: hasDeposited,
      firstDepositRevokedByAdmin: !hasDeposited,
    });
    showToast(
      `${target?.username ?? uid} marked as ${hasDeposited ? 'Deposited' : 'No Deposit'}.`
    );
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

    const updatedFromService = await updateMemberFieldsStatic(uid, {
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

    const patchMemberObj = (existing: ManagedMember): ManagedMember =>
      updatedFromService ?? {
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

    setManagedMembers((prev) => prev.map((m) => (m.uid === uid ? patchMemberObj(m) : m)));

    if (uid === user.uid) {
      setUser((prev) => ({
        ...prev,
        username: updatedFromService?.username ?? payload.username ?? prev.username,
        email: updatedFromService?.email ?? payload.email ?? prev.email,
        pin: updatedFromService?.securityPin ?? payload.securityPin ?? prev.pin,
        avatarUrl:
          updatedFromService !== null
            ? (updatedFromService.avatarUrl ?? null)
            : payload.avatarUrl !== undefined
            ? payload.avatarUrl
            : prev.avatarUrl,
        fullName:
          updatedFromService !== null
            ? (updatedFromService.fullName ?? null)
            : payload.fullName !== undefined
            ? payload.fullName
            : prev.fullName,
        phone:
          updatedFromService !== null
            ? (updatedFromService.phone ?? null)
            : payload.phone !== undefined
            ? payload.phone
            : prev.phone,
        country:
          updatedFromService !== null
            ? (updatedFromService.country ?? null)
            : payload.country !== undefined
            ? payload.country
            : prev.country,
        bio:
          updatedFromService !== null
            ? (updatedFromService.bio ?? null)
            : payload.bio !== undefined
            ? payload.bio
            : prev.bio,
        withdrawMethod:
          updatedFromService?.withdrawMethod ?? payload.withdrawMethod ?? prev.withdrawMethod,
        withdrawAccountName:
          updatedFromService !== null
            ? (updatedFromService.withdrawAccountName ?? null)
            : payload.withdrawAccountName !== undefined
            ? payload.withdrawAccountName
            : prev.withdrawAccountName,
        withdrawAccountNumber:
          updatedFromService !== null
            ? (updatedFromService.withdrawAccountNumber ?? null)
            : payload.withdrawAccountNumber !== undefined
            ? payload.withdrawAccountNumber
            : prev.withdrawAccountNumber,
      }));
    }

    showToast(`Saved profile & withdraw details for ${payload.username || uid}.`);
    return true;
  };

  const handleApproveDeposit = async (req: StaffWalletRequest) => {
    if (!['admin', 'staff', 'caiwu'].includes(user.role)) {
      showToast('Permission denied.', 'error');
      return;
    }

    const { updatedMember } = await approveDepositRequestStatic(req);
    if (updatedMember) {
      setManagedMembers((prev) =>
        prev.map((item) => (item.uid === updatedMember.uid ? updatedMember : item))
      );
      if (updatedMember.uid === user.uid) {
        setUser((prev) => ({
          ...prev,
          realBalance: updatedMember.realBalance,
          hasDepositedBefore: true,
          hasFirstDeposit: true,
          firstDepositRevokedByAdmin: false,
          totalDeposited:
            typeof updatedMember.totalDeposited === 'number'
              ? updatedMember.totalDeposited
              : Number((Number(prev.totalDeposited ?? 0) + req.amount).toFixed(2)),
        }));
      }
    }

    if (req.source === 'local') {
      const rawId = req.id.replace(/^loc-/, '');
      setWalletTransactions((prev) =>
        prev.map((tx) => (tx.id === rawId ? { ...tx, status: 'APPROVED' } : tx))
      );
      if (!updatedMember) {
        setManagedMembers((prev) =>
          prev.map((m) =>
            m.uid === req.userId
              ? {
                  ...m,
                  realBalance: m.realBalance + req.amount,
                  hasDepositedBefore: true,
                  hasFirstDeposit: true,
                  firstDepositRevokedByAdmin: false,
                  totalDeposited: Number((Number(m.totalDeposited ?? 0) + req.amount).toFixed(2)),
                }
              : m
          )
        );
        if (req.userId === user.uid) {
          setUser((prev) => ({
            ...prev,
            realBalance: prev.realBalance + req.amount,
            hasDepositedBefore: true,
            hasFirstDeposit: true,
            firstDepositRevokedByAdmin: false,
            totalDeposited: Number((Number(prev.totalDeposited ?? 0) + req.amount).toFixed(2)),
          }));
        }
      }
    }

    setPendingDeposits((prev) => prev.filter((item) => item.id !== req.id));
    const nextStatsAfterDep = await incrementPlatformStatsForActivityStatic({
      type: 'deposit',
      amount: req.amount,
    });
    if (nextStatsAfterDep) setPlatformStats(nextStatsAfterDep);
    showToast(`Deposit of $${req.amount.toFixed(2)} approved & credited!`);
    await loadStaffRequests();
  };

  const handleRejectDeposit = async (req: StaffWalletRequest) => {
    if (!['admin', 'staff', 'caiwu'].includes(user.role)) {
      showToast('Permission denied.', 'error');
      return;
    }
    await rejectDepositRequestStatic(
      req,
      'Verification declined. Please check details or contact support.'
    );
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
    await approveWithdrawalRequestStatic(req);
    if (req.source === 'local') {
      const rawId = req.id.replace(/^loc-/, '');
      setWalletTransactions((prev) =>
        prev.map((tx) => (tx.id === rawId ? { ...tx, status: 'SUCCESS' } : tx))
      );
    }
    setPendingWithdrawals((prev) => prev.filter((item) => item.id !== req.id));
    const nextStatsAfterWd = await incrementPlatformStatsForActivityStatic({
      type: 'withdrawal',
      amount: req.amount,
    });
    if (nextStatsAfterWd) setPlatformStats(nextStatsAfterWd);
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
    const { updatedMember } = await rejectWithdrawalRequestStatic(req, reason);
    if (updatedMember) {
      setManagedMembers((prev) =>
        prev.map((item) => (item.uid === updatedMember.uid ? updatedMember : item))
      );
      if (updatedMember.uid === user.uid) {
        setUser((prev) => ({ ...prev, realBalance: updatedMember.realBalance }));
      }
    }
    if (req.source === 'local') {
      const rawId = req.id.replace(/^loc-/, '');
      setWalletTransactions((prev) =>
        prev.map((tx) =>
          tx.id === rawId ? { ...tx, status: 'REJECTED', rejectReason: reason } : tx
        )
      );
      if (!updatedMember) {
        setManagedMembers((prev) =>
          prev.map((m) =>
            m.uid === req.userId ? { ...m, realBalance: m.realBalance + req.amount } : m
          )
        );
        if (req.userId === user.uid) {
          setUser((prev) => ({ ...prev, realBalance: prev.realBalance + req.amount }));
        }
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

    if (!isLocalOnlyDemoTarget) {
      updatedMember = await adjustMemberBalanceStatic(payload);
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
              hasFirstDeposit: effectiveHasFirstDeposit,
              totalDeposited: user.totalDeposited ?? 0,
              firstDepositRevokedByAdmin: user.firstDepositRevokedByAdmin ?? false,
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
    let updatedMember = await assignMemberRoleStatic(identifier, role);

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
        brandLogoUrl={brandLogoUrl}
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
      {authActionRoute.isAuthActionRoute ? (
        <AuthActionPage
          route={authActionRoute}
          brandLogoUrl={brandLogoUrl}
          isLoggedIn={user.isLoggedIn}
          onBackToLogin={() => {
            if (typeof window !== 'undefined') {
              window.history.replaceState({}, '', '/');
            }
            setAuthActionRoute({
              isAuthActionRoute: false,
              mode: 'unknown',
              oobCode: '',
              continueUrl: null,
            });
            setLandingAuthMode('login');
            if (user.isLoggedIn) {
              void handleLogout();
            }
          }}
          onContinueToAccount={() => {
            if (typeof window !== 'undefined') {
              window.history.replaceState({}, '', '/');
            }
            setAuthActionRoute({
              isAuthActionRoute: false,
              mode: 'unknown',
              oobCode: '',
              continueUrl: null,
            });
            setActiveSection('profile');
          }}
          onEmailVerified={async () => {
            if (auth?.currentUser) {
              await auth.currentUser.reload().catch(() => {});
              if (db && auth.currentUser.uid) {
                await setDoc(
                  doc(db, 'users', auth.currentUser.uid),
                  { emailVerified: true },
                  { merge: true }
                ).catch(() => {});
              }
            }
            setUser((prev) => ({ ...prev, emailVerified: true }));
          }}
          onShowToast={showToast}
        />
      ) : !user.isLoggedIn ? (
        <AuthLanding
          quotes={quotes}
          platformStats={platformStats}
          platformDescription={platformDescription}
          faqEntries={faqEntries}
          liveFeedItems={liveFeedItems}
          csrTelegramLink={csrTelegramLink}
          initialAuthMode={landingAuthMode}
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
              user={{
                ...user,
                hasFirstDeposit: effectiveHasFirstDeposit,
                hasDepositedBefore: effectiveHasFirstDeposit,
              }}
              accountMode={accountMode}
              onSetAccountMode={setAccountMode}
              quotes={quotes}
              transactions={walletTransactions}
              csrTelegramLink={csrTelegramLink}
              onRefresh={async () => {
                await syncWalletFromServer({
                  tokenOverride: authTokenRef.current || 'firestore-sync',
                  force: true,
                  silent: false,
                });
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
              onCopyInviteLink={() =>
                copyText(`${window.location.origin}/?ref=${encodeURIComponent(user.uid)}`, 'Invitation Link')
              }
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
              onSendVerificationEmail={handleSendVerificationEmail}
              onRefreshEmailVerification={handleRefreshEmailVerification}
              onEnableTwoFactor={handleEnableTwoFactor}
              onDisableTwoFactor={handleDisableTwoFactor}
              onCopySetupKey={(secret) => copyText(secret, '2FA Setup Key')}
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
                  hasDepositedBefore: effectiveHasFirstDeposit,
                  hasFirstDeposit: effectiveHasFirstDeposit,
                  totalDeposited: user.totalDeposited ?? 0,
                  firstDepositRevokedByAdmin: user.firstDepositRevokedByAdmin ?? false,
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

      {/* Institutional Footer */}
      <footer
        data-testid="global-footer"
        className="border-t border-slate-800/80 bg-slate-950 py-5 sm:py-6 px-3 sm:px-6 mb-14 sm:mb-0"
      >
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center md:items-center justify-between gap-4">
          {/* Left: Brand Crest & Descriptor */}
          <div className="flex items-center gap-3 text-left">
            <div className="p-[1.5px] rounded-xl bg-gradient-to-br from-blue-500/80 via-indigo-500/70 to-amber-400/80 shrink-0">
              <div className="w-9 h-9 rounded-[10px] bg-slate-950 flex items-center justify-center overflow-hidden">
                <img
                  src={brandLogoUrl?.trim() || '/favicon.svg'}
                  alt="Zectrade Global icon"
                  onError={(e) => {
                    const img = e.currentTarget;
                    if (!img.dataset.fallbackApplied) {
                      img.dataset.fallbackApplied = '1';
                      img.src = '/favicon.svg';
                    }
                  }}
                  className="w-6 h-6 object-contain"
                />
              </div>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-extrabold tracking-wide text-white uppercase">
                  ZECTRADE
                </span>
                <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/35 text-amber-400 font-mono text-[10px] font-bold tracking-wider uppercase whitespace-nowrap">
                  GLOBAL LTD
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
                Authorized Spot &amp; Perpetual Commodities Trading Platform
              </p>
            </div>
          </div>

          {/* Right: Copyright & Derivative Risk Disclaimer */}
          <div className="text-center md:text-right space-y-1 max-w-xl">
            <p className="font-mono text-[11px] sm:text-xs text-slate-300">
              Zectrade Global Financial Technologies Ltd. © 2026. All Rights Reserved.
            </p>
            <p className="text-[10px] sm:text-[11px] text-slate-500 leading-relaxed">
              Trading derivatives carries significant risk to your capital. Markets are real-time
              settled via Tier-1 Mainnet Oracles. Past execution performance is not indicative of
              future returns; profits are not guaranteed.
            </p>
          </div>
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
          user={{
            ...user,
            hasFirstDeposit: effectiveHasFirstDeposit,
            hasDepositedBefore: effectiveHasFirstDeposit,
          }}
          withdrawRateMMK={withdrawRateMMK}
          onSubmitWithdraw={handleSubmitWithdraw}
          onOpenDeposit={() => setDepositModalOpen(true)}
          onClose={() => setWithdrawModalOpen(false)}
        />
      )}

      {transferModalOpen && (
        <TransferModal
          accountMode="real"
          availableBalance={user.realBalance}
          currentUserUid={user.uid}
          currentUserEmail={user.email}
          userPin={user.pin}
          hasFirstDeposit={effectiveHasFirstDeposit}
          onOpenDeposit={() => setDepositModalOpen(true)}
          twoFactorEnabled={Boolean(user.twoFactorEnabled)}
          onVerifyTwoFactor={(code) => verifyTotpCode(user.twoFactorSecret, code)}
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
          brandLogoUrl={brandLogoUrl}
          onSaveBrandLogo={async (nextLogoUrl) => {
            setBrandLogoUrl(nextLogoUrl);
            await saveBrandLogoStatic(nextLogoUrl);
            showToast(
              nextLogoUrl
                ? 'Brand logo & browser tab icon updated.'
                : 'Reset to default Zectrade Pulse logo icon.'
            );
            return true;
          }}
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
              hasDepositedBefore: effectiveHasFirstDeposit,
              hasFirstDeposit: effectiveHasFirstDeposit,
              totalDeposited: user.totalDeposited ?? 0,
              firstDepositRevokedByAdmin: user.firstDepositRevokedByAdmin ?? false,
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
          onToggleFirstDeposit={handleToggleFirstDeposit}
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
            await savePlatformSettingsStatic(payload);
            showToast('Platform settings saved.');
          }}
          onSavePlatformStatsOnly={async (nextStats) => {
            const savedStats = await savePlatformStatsOnlyStatic(nextStats);
            setPlatformStats(savedStats);
            showToast(
              savedStats.syncedToCloud
                ? 'Platform statistics saved & synced live to Firestore.'
                : 'Platform statistics saved locally (sign in with Firebase Admin to sync cloud).'
            );
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
            await saveFaqAndDescStatic(desc, faqs);
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
