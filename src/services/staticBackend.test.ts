import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  claimAdminCoinProfitStatic,
  deleteCustomCoinStatic,
  getCoinTradeAnalyticsStatic,
  getCustomCoinKlinesStatic,
  getInitialAdminCoinsSync,
  recordCoinTradeStatic,
  syncAndListCustomCoinsStatic,
  updateCoinPriceControlStatic,
  upsertCustomCoinStatic,
} from './coinsService';
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
  listMembersStatic,
  listStaffRequestsStatic,
  lookupTransferRecipientStatic,
  rejectWithdrawalRequestStatic,
  saveBrandLogoStatic,
  savePlatformSettingsStatic,
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

  it('loads pre-seeded XUUSDT custom coin at $100.00 synchronously', () => {
    const coins = getInitialAdminCoinsSync(false);
    const xu = coins.find((c) => c.symbol === 'XUUSDT');
    assert.ok(xu);
    assert.equal(xu.currentPrice, 100);
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

    const lookupByUid = await lookupTransferRecipientStatic('USR-7731');
    assert.equal(lookupByUid?.email, 'marcus.c@zectrade.io');

    const transfer = await executeP2PTransferStatic({
      senderUid: 'USR-9012',
      senderEmail: 'alex.chen@zectrade.io',
      senderUsername: 'AlexChen',
      recipientIdentifier: 'MARCUS.C@ZECTRADE.IO',
      accountMode: 'real',
      amount: 1,
      pin: '1234',
    });
    assert.equal(transfer.ok, true);
    if (transfer.ok) {
      assert.equal(transfer.recipient.newBalance, 8901);
      assert.equal(transfer.sentTransaction.type, 'P2P TRANSFER SENT (REAL)');

      const senderHistory = getMemberActivitySync('USR-9012');
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

  it('uses the exact zectrade-357ff Firebase configuration across client initialization', () => {
    assert.deepEqual(firebaseConfig, {
      apiKey: 'AIzaSyDZETBSCx35a_syK069_WUvw6wEOMYCKyc',
      authDomain: 'zectrade-357ff.firebaseapp.com',
      projectId: 'zectrade-357ff',
      storageBucket: 'zectrade-357ff.firebasestorage.app',
      messagingSenderId: '1079525755073',
      appId: '1:1079525755073:web:fbbca0e3521a5709af6c40',
      measurementId: 'G-P4EQE872T5',
    });
  });
});
