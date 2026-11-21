import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOM_COINS_COLLECTION,
  claimAdminCoinProfitStatic,
  deleteCustomCoinStatic,
  evaluateCoinTick,
  evaluateCustomCoinsForCurrentSecondStatic,
  getCoinTradeAnalyticsStatic,
  getCustomCoinKlinesStatic,
  getInitialAdminCoinsSync,
  purgeStaleFlatCandleCaches,
  readCachedChartCandlesStatic,
  recordCoinTradeStatic,
  syncAndListCustomCoinsStatic,
  updateCoinPriceControlStatic,
  upsertCustomCoinStatic,
  writeCachedChartCandlesStatic,
} from './coinsService';
import {
  CHART_CACHE_VERSION,
  type ChartTimeframe,
  hasFlatCandles,
} from '../utils/chartEngine';
import {
  executeDirectP2PTransfer,
  lookupTransferRecipientDirect,
} from './transferEngine';
import {
  adminScheduleDigitDrawStatic,
  getInitialLotteryLiveState,
  placeDigitLotteryBetStatic,
  placeLotteryBetStatic,
  tickAndGetLotteryStateStatic,
  updateLotteryAdminConfigStatic,
} from './lotteryService';
import {
  createNewsArticleStatic,
  deleteNewsArticleStatic,
  getInitialNewsArticlesSync,
  listNewsArticlesStatic,
  updateNewsArticleStatic,
} from './newsService';
import { clearMemoryStorageForTests } from './storageHelper';
import { firebaseConfig } from './firebaseClient';
import {
  adjustMemberBalanceStatic,
  approveDepositRequestStatic,
  assignMemberRoleStatic,
  authenticateStaticAdmin,
  createWalletRequestStatic,
  executeP2PTransferStatic,
  getInitialPlatformSettingsSync,
  getMemberActivitySync,
  incrementPlatformStatsForActivityStatic,
  listMembersStatic,
  listStaffRequestsStatic,
  lookupTransferRecipientStatic,
  rejectWithdrawalRequestStatic,
  saveBrandLogoStatic,
  savePlatformSettingsStatic,
  savePlatformStatsOnlyStatic,
} from './walletAdminService';
import { deduplicateFirestoreAgainstSql } from '../utils/depositHistory';

beforeEach(() => {
  clearMemoryStorageForTests();
});

describe('Synchronous built-in defaults for instant Netlify startup', () => {
  it('loads 5 default news articles synchronously without network calls', () => {
    const articles = getInitialNewsArticlesSync(false);
    assert.equal(articles.length, 5);
    assert.equal(articles[0].isFeatured, true);
  });

  it('loads pre-seeded XUUSDT custom coin anchored at $100.00 synchronously', () => {
    const coins = getInitialAdminCoinsSync(false);
    const xu = coins.find((c) => c.symbol === 'XUUSDT');
    assert.ok(xu);
    assert.equal(xu.basePrice, 100);
    assert.ok(xu.currentPrice >= 99 && xu.currentPrice <= 101);
    assert.equal(xu.shortName, 'XU/USDT');
  });

  it('loads Lottery Live engine with open Color/0-9 round, history, and 2D/3D/6D scheduled draws immediately', () => {
    const state = getInitialLotteryLiveState('USR-9012', false);
    assert.equal(state.currentRound.status, 'OPEN');
    assert.ok(state.historyStrip.length >= 8);
    const gameTypes = new Set(state.digitDraws.map((d) => d.gameType));
    assert.deepEqual([...gameTypes].sort(), ['2D', '3D', '6D']);
  });
});

describe('newsService static persistence & CRUD', () => {
  it('creates, updates featured exclusivity, and persists deletions without re-seeding', async () => {
    const created = await createNewsArticleStatic({
      title: 'ZEC Token Liquidity Expansion',
      summary: 'New orderbook depth across Asian market hours.',
      content: 'Full liquidity expansion details across ZEC/USDT and BTC/USDT perpetual contracts.',
      category: 'Platform Update',
      isFeatured: true,
      isPublished: true,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.article.isFeatured, true);
    const featuredCount = created.articles.filter((a) => a.isFeatured).length;
    assert.equal(featuredCount, 1);

    const updated = await updateNewsArticleStatic(created.article.id, {
      title: 'ZEC Token Liquidity Expansion v2',
    });
    assert.equal(updated.ok, true);

    const del = await deleteNewsArticleStatic(1);
    assert.equal(del.ok, true);
    const afterList = await listNewsArticlesStatic(true);
    assert.equal(afterList.some((a) => a.id === 1), false);
    assert.equal(afterList.some((a) => a.title === 'ZEC Token Liquidity Expansion v2'), true);
  });
});

describe('coinsService price control, klines, trades & analytics', () => {
  it('launches custom coin, executes price glide/up_then_down/pause/resume/stop, builds klines, records trade & claims profit', async () => {
    const launched = await upsertCustomCoinStatic({
      symbol: 'ZECX',
      label: 'ZECX / USDT',
      initialPrice: 50,
      enabled: true,
    });
    assert.equal(launched.symbol, 'ZECXUSDT');
    assert.ok(Math.abs(launched.currentPrice - 50) < 1);

    const manualUpdate = await updateCoinPriceControlStatic('ZECXUSDT', {
      mode: 'manual',
      manualPrice: 62.5,
      transitionSec: 0,
    });
    assert.ok(manualUpdate);
    assert.ok(Math.abs(manualUpdate.currentPrice - 62.5) < 1);

    const scheduled = await updateCoinPriceControlStatic('ZECXUSDT', {
      mode: 'up_then_down',
      upTargetPrice: 75,
      upDurationSec: 30,
      downTargetPrice: 55,
      downDurationSec: 45,
      repeatLoop: true,
    });
    assert.ok(scheduled?.schedule?.active);
    assert.equal(scheduled?.schedule?.mode, 'up_then_down');

    const paused = await updateCoinPriceControlStatic('ZECXUSDT', { mode: 'pause' });
    assert.equal(paused?.schedule?.paused, true);
    const resumed = await updateCoinPriceControlStatic('ZECXUSDT', { mode: 'resume' });
    assert.equal(resumed?.schedule?.paused, false);
    const stopped = await updateCoinPriceControlStatic('ZECXUSDT', { mode: 'stop' });
    assert.equal(stopped?.schedule?.active, false);

    const candles = await getCustomCoinKlinesStatic('ZECXUSDT', '15m', 120);
    assert.equal(candles.length, 120);
    assert.ok(candles[candles.length - 1].close > 0);

    await recordCoinTradeStatic({
      tradeUid: 'TRD-LOSS-1',
      symbol: 'ZECXUSDT',
      userUid: 'USR-9012',
      userEmail: 'alex.chen@zectrade.io',
      side: 'buy',
      leverage: 20,
      margin: 250,
      entryPrice: 62.5,
      liqPrice: 59.5,
      tradingFee: 4.5,
      pnlVal: -250,
      status: 'CLOSED',
      closePrice: 59.5,
      accountMode: 'real',
    });

    const analyticsBefore = await getCoinTradeAnalyticsStatic('ZECXUSDT');
    assert.equal(analyticsBefore.totalTrades, 1);
    assert.equal(analyticsBefore.closedLossTrades, 1);
    assert.ok(analyticsBefore.claimableProfitUsd > 0);

    const claimed = await claimAdminCoinProfitStatic({
      symbol: 'ZECXUSDT',
      adminUid: 'ADMIN-ZEC-0001',
      adminEmail: 'admin@zectrade.io',
    });
    assert.ok(claimed.claimedAmount > 0);
    assert.equal(claimed.analytics.claimableProfitUsd, 0);

    const deleted = await deleteCustomCoinStatic('XUUSDT');
    assert.equal(deleted, true);
    const listed = await syncAndListCustomCoinsStatic(true);
    assert.equal(listed.some((c) => c.symbol === 'XUUSDT'), false);
  });

  it('uses shared Firestore custom_coins collection and deterministic UTC-second pricing without random drift', async () => {
    assert.equal(CUSTOM_COINS_COLLECTION, 'custom_coins');
    const coins = getInitialAdminCoinsSync(false);
    const xu = coins.find((c) => c.symbol === 'XUUSDT');
    assert.ok(xu);

    const fixedUtcMs = 1760000123456;
    const sameSecLaterMs = 1760000123987;
    const tickA = evaluateCoinTick(xu, fixedUtcMs, false).coin;
    const tickB = evaluateCoinTick(xu, sameSecLaterMs, false).coin;
    assert.equal(tickA.currentPrice, tickB.currentPrice);
    assert.equal(tickA.basePrice, xu.basePrice);

    const listA = evaluateCustomCoinsForCurrentSecondStatic(false, fixedUtcMs);
    const listB = evaluateCustomCoinsForCurrentSecondStatic(false, sameSecLaterMs);
    assert.equal(listA[0].currentPrice, listB[0].currentPrice);

    const klinesA = await getCustomCoinKlinesStatic('XUUSDT', '15m', 120);
    const klinesB = await getCustomCoinKlinesStatic('XUUSDT', '15m', 120);
    assert.equal(klinesA.length, 120);
    assert.deepEqual(klinesA, klinesB);
    assert.equal(hasFlatCandles(klinesA), false);

    const allTimeframes: ChartTimeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '1w', '1mo'];
    for (const tf of allTimeframes) {
      const bars = await getCustomCoinKlinesStatic('XUUSDT', tf, 60);
      // Enforces minimum 120 historical wave candles even if smaller limit requested
      assert.equal(bars.length, 120);
      assert.equal(hasFlatCandles(bars), false);
    }

    // Verify stale flat cache is rejected and valid v3 wave cache is preserved
    purgeStaleFlatCandleCaches();
    writeCachedChartCandlesStatic('XUUSDT', '15m', klinesA);
    const validCached = readCachedChartCandlesStatic('XUUSDT', '15m');
    assert.ok(validCached && validCached.length === 120);
    assert.equal(CHART_CACHE_VERSION, 'zectrade_chart_v3');

    const shortFlat = klinesA.slice(0, 10).map((c) => ({ ...c, high: c.close, low: c.close }));
    writeCachedChartCandlesStatic('ZECTESTUSDT', '15m', shortFlat);
    assert.equal(readCachedChartCandlesStatic('ZECTESTUSDT', '15m'), null);
  });
});

describe('lotteryService Color/0-9 & 2D/3D/6D manual scheduling and settlement', () => {
  it('enforces single-side color bet, manual round settlement, and 2D/3D/6D manual draw release', async () => {
    const firstBet = await placeLotteryBetStatic({
      userUid: 'USR-9012',
      userEmail: 'alex.chen@zectrade.io',
      accountMode: 'real',
      betType: 'color',
      color: 'green',
      stake: 50,
    });
    assert.equal(firstBet.bet.color, 'green');
    assert.equal(firstBet.state.currentRound.greenTotal, 50);

    await assert.rejects(
      () =>
        placeLotteryBetStatic({
          userUid: 'USR-9012',
          userEmail: 'alex.chen@zectrade.io',
          accountMode: 'real',
          betType: 'color',
          color: 'red',
          stake: 25,
        }),
      /single-side/i
    );

    const settledColor = await updateLotteryAdminConfigStatic(
      {
        resultMode: 'manual',
        forcedNumber: 7,
        settleNow: true,
      },
      'USR-9012'
    );
    assert.equal(settledColor.historyStrip[0].winningNumber, 7);
    assert.equal(settledColor.historyStrip[0].winningColor, 'green');
    assert.equal(settledColor.userBets[0].outcome, 'WIN');

    const draw2d = settledColor.digitDraws.find((d) => d.gameType === '2D');
    assert.ok(draw2d);

    const digitBetRes = await placeDigitLotteryBetStatic({
      userUid: 'USR-9012',
      userEmail: 'alex.chen@zectrade.io',
      accountMode: 'real',
      drawUid: draw2d.drawUid,
      pickedNumber: '48',
      stake: 20,
    });
    assert.equal(digitBetRes.bet.pickedNumber, '48');

    const released = await adminScheduleDigitDrawStatic(
      {
        drawUid: draw2d.drawUid,
        gameType: '2D',
        manualResult: '48',
        releaseNow: true,
      },
      'USR-9012'
    );
    assert.equal(released.digitHistory[0].winningNumber, '48');
    assert.equal(released.userDigitBets[0].outcome, 'WIN');
    assert.ok(released.userDigitBets[0].payoutAmount > 0);
    // Spawns next scheduled 2D draw automatically
    assert.ok(released.digitDraws.some((d) => d.gameType === '2D' && d.status === 'SCHEDULED'));

    const guestView = await tickAndGetLotteryStateStatic('USR-9012', false);
    assert.equal(guestView.config.forcedResult, null);
    assert.equal(guestView.config.forcedNumber, null);
  });
});

describe('walletAdminService auth, deposits, withdrawals, transfers, roles & settings', () => {
  it('authenticates built-in admin@zectrade.io, processes deposits/withdrawals, P2P transfers, member adjustments & settings', async () => {
    const badLogin = await authenticateStaticAdmin('admin@zectrade.io', 'wrong');
    assert.equal(badLogin.ok, false);

    const adminLogin = await authenticateStaticAdmin('admin@zectrade.io', 'Admin@2026');
    assert.equal(adminLogin.ok, true);

    const depReq = await createWalletRequestStatic({
      userUid: 'USR-4418',
      userEmail: 'maya.patel@zectrade.io',
      requestKind: 'deposit',
      typeLabel: 'DEPOSIT (TRC20)',
      method: 'USDT TRC20',
      amountUsd: 500,
      target: 'TxID-998877',
    });

    const staffInbox = await listStaffRequestsStatic('admin');
    assert.ok(staffInbox.deposits.some((d) => d.id === depReq.id));

    const approved = await approveDepositRequestStatic({
      id: depReq.id,
      source: 'local',
      userId: depReq.userUid,
      userEmail: depReq.userEmail,
      kind: 'deposit',
      type: depReq.typeLabel,
      method: depReq.method,
      amount: depReq.amountUsd,
      target: depReq.target,
      status: 'PENDING',
      createdAtLabel: 'now',
    });
    assert.ok(approved.updatedMember);
    assert.equal(approved.updatedMember.hasDepositedBefore, true);
    assert.equal(approved.updatedMember.hasFirstDeposit, true);
    assert.equal(approved.updatedMember.totalDeposited, 1620);
    assert.equal(approved.updatedMember.realBalance, 1620);

    const wdReq = await createWalletRequestStatic({
      userUid: 'USR-4418',
      userEmail: 'sumyat@zectrade.io',
      requestKind: 'withdrawal',
      typeLabel: 'WITHDRAWAL (KPAY)',
      method: 'KBZPay',
      amountUsd: 100,
      target: 'Maya (091234567)',
    });

    const rejected = await rejectWithdrawalRequestStatic(
      {
        id: wdReq.id,
        source: 'local',
        userId: wdReq.userUid,
        userEmail: wdReq.userEmail,
        kind: 'withdrawal',
        type: wdReq.typeLabel,
        method: wdReq.method,
        amount: wdReq.amountUsd,
        target: wdReq.target,
        status: 'PENDING',
        createdAtLabel: 'now',
      },
      'Account number mismatch'
    );
    assert.equal(rejected.updatedMember?.realBalance, 1720);

    const lookupByUpperEmail = await lookupTransferRecipientStatic('MARCUS.C@ZECTRADE.IO');
    assert.equal(lookupByUpperEmail?.uid, 'USR-7731');

    const directLookup = await lookupTransferRecipientDirect('MARCUS.C@ZECTRADE.IO');
    assert.equal(directLookup?.uid, 'USR-7731');

    const lookupByUid = await lookupTransferRecipientStatic('USR-7731');
    assert.equal(lookupByUid?.email, 'marcus.c@zectrade.io');

    // User without first deposit (USR-9012) is blocked from P2P transfer
    const blockedTransfer = await executeDirectP2PTransfer({
      senderUid: 'USR-9012',
      senderEmail: 'aung.kyaw@zectrade.io',
      senderUsername: 'Aung Kyaw',
      recipientIdentifier: 'MARCUS.C@ZECTRADE.IO',
      accountMode: 'real',
      amount: 1,
      pin: '1234',
    });
    assert.equal(blockedTransfer.ok, false);
    if (!blockedTransfer.ok) {
      assert.match(blockedTransfer.error, /First Deposit Required/i);
    }

    // User with approved deposit (USR-4418) can send P2P to USR-9012 without unlocking USR-9012's first deposit
    const toUndeposited = await executeDirectP2PTransfer({
      senderUid: 'USR-4418',
      senderEmail: 'sumyat@zectrade.io',
      senderUsername: 'Su Myat',
      recipientIdentifier: 'USR-9012',
      accountMode: 'real',
      amount: 10,
      pin: '4321',
    });
    assert.equal(toUndeposited.ok, true);
    const recipientMemberAfter = (await listMembersStatic('USR-9012')).find((m) => m.uid === 'USR-9012');
    assert.equal(recipientMemberAfter?.realBalance, 12);
    assert.equal(Boolean(recipientMemberAfter?.hasFirstDeposit), false);
    assert.equal(Boolean(recipientMemberAfter?.hasDepositedBefore), false);

    // USR-4418 can also send P2P to USR-7731
    const transfer = await executeDirectP2PTransfer({
      senderUid: 'USR-4418',
      senderEmail: 'sumyat@zectrade.io',
      senderUsername: 'Su Myat',
      recipientIdentifier: 'MARCUS.C@ZECTRADE.IO',
      accountMode: 'real',
      amount: 1,
      pin: '4321',
    });
    assert.equal(typeof executeP2PTransferStatic, 'function');
    assert.equal(transfer.ok, true);
    if (transfer.ok) {
      assert.equal(transfer.recipient.newBalance, 8901);
      assert.equal(transfer.sentTransaction.type, 'P2P TRANSFER SENT (REAL)');

      const senderHistory = getMemberActivitySync('USR-4418');
      const recipientHistory = getMemberActivitySync('USR-7731');
      assert.equal(senderHistory.some((tx) => tx.id === transfer.sentTransaction.id), true);
      assert.equal(
        recipientHistory.some(
          (tx) => tx.type === 'P2P TRANSFER RECEIVED (REAL)' && tx.amount === 1
        ),
        true
      );

      const deduped = deduplicateFirestoreAgainstSql(
        [transfer.sentTransaction],
        [transfer.sentTransaction]
      );
      assert.equal(deduped.length, 1);
    }

    const adjusted = await adjustMemberBalanceStatic({
      identifier: 'USR-7731',
      wallet: 'real',
      action: 'add',
      amount: 40,
      reason: 'Promo reward',
    });
    assert.equal(adjusted?.realBalance, 8941);

    const promoted = await assignMemberRoleStatic('USR-7731', 'caiwu');
    assert.equal(promoted?.role, 'caiwu');

    const members = await listMembersStatic('USR-7731');
    assert.equal(members.length, 1);
    assert.equal(members[0].role, 'caiwu');

    await saveBrandLogoStatic('/logo.png');
    await savePlatformSettingsStatic({
      csrTelegramLink: 'https://t.me/custom_csr',
      platformStats: {
        membersCount: 25000,
        totalDeposits: '$50,000,000',
        totalWithdrawals: '$18,000,000',
      },
      depositRateMMK: 4400,
      withdrawRateMMK: 4350,
      depositAccounts: {
        kpay: { name: 'Test KPay', number: '09111111' },
        wavepay: { name: 'Test Wave', number: '09222222' },
        usdt: { name: 'TRC20 Wallet', number: 'TTestAddress' },
        btc: { name: 'Bitcoin Network', number: 'bc1qtest' },
      },
    });
    const settings = getInitialPlatformSettingsSync();
    assert.equal(settings.brandLogoUrl, '/logo.png');
    assert.equal(settings.depositRateMMK, 4400);
    assert.equal(settings.csrTelegramLink, 'https://t.me/custom_csr');
  });

  it('uses the exact zectrade-357ff Firebase configuration with custom authDomain', () => {
    assert.deepEqual(firebaseConfig, {
      apiKey: 'AIzaSyDZETBSCx35a_syK069_WUvw6wEOMYCKyc',
      authDomain: 'zectrading.com',
      projectId: 'zectrade-357ff',
      storageBucket: 'zectrade-357ff.firebasestorage.app',
      messagingSenderId: '1079525755073',
      appId: '1:1079525755073:web:fbbca0e3521a5709af6c40',
      measurementId: 'G-P4EQE872T5',
    });
  });

  it('configures Netlify /__/auth/* proxy rule before the SPA catch-all /* rule', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const redirectsPath = path.resolve(process.cwd(), 'public/_redirects');
    const content = fs.readFileSync(redirectsPath, 'utf8');
    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));

    const authIdx = lines.findIndex((line) =>
      /^\/__\/auth\/\*\s+https:\/\/zectrade-357ff\.firebaseapp\.com\/__\/auth\/:splat\s+200$/.test(line),
    );
    const spaIdx = lines.findIndex((line) =>
      /^\/\*\s+\/index\.html\s+200$/.test(line),
    );

    assert.ok(authIdx !== -1, 'Expected /__/auth/* 200 proxy rule in public/_redirects');
    assert.ok(spaIdx !== -1, 'Expected /* /index.html 200 SPA catch-all rule in public/_redirects');
    assert.ok(authIdx < spaIdx, '/__/auth/* proxy rule must appear BEFORE /* catch-all rule');
  });

  it('saves manual platform stats cleanly and only auto-increments when autoIncrementStats is ON', async () => {
    const initial = getInitialPlatformSettingsSync().platformStats;
    assert.equal(initial.membersCount, 23909);
    assert.equal(initial.totalDeposits, 4285000);
    assert.equal(initial.totalWithdrawals, 15240600);
    assert.equal(initial.autoIncrementStats, false);

    // With autoIncrementStats OFF, real activity must NOT modify counters
    assert.equal(
      await incrementPlatformStatsForActivityStatic({ type: 'registration' }, 'uid-manual-1'),
      null
    );
    assert.equal(
      await incrementPlatformStatsForActivityStatic({ type: 'deposit', amount: 500 }),
      null
    );

    // Admin saves manual update and enables Auto-Add Real Activity
    const saved = await savePlatformStatsOnlyStatic({
      registeredMembers: 24500,
      membersCount: 24500,
      totalDeposits: 4500000,
      totalWithdrawals: 16000000,
      autoIncrementStats: true,
    });
    assert.equal(saved.registeredMembers, 24500);
    assert.equal(saved.autoIncrementStats, true);

    const afterReg = await incrementPlatformStatsForActivityStatic(
      { type: 'registration' },
      'uid-auto-1'
    );
    assert.equal(afterReg?.registeredMembers, 24501);
    // Same UID deduplicated
    assert.equal(
      await incrementPlatformStatsForActivityStatic({ type: 'registration' }, 'uid-auto-1'),
      null
    );

    const afterDep = await incrementPlatformStatsForActivityStatic({ type: 'deposit', amount: 1200 });
    assert.equal(afterDep?.totalDeposits, 4501200);

    const afterWd = await incrementPlatformStatsForActivityStatic({ type: 'withdrawal', amount: 800 });
    assert.equal(afterWd?.totalWithdrawals, 16000800);
  });
});
