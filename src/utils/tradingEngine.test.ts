import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BRAND_LOGO_URL,
  FIRST_REGISTER_REAL_BONUS_USD,
  calculateCloseSettlement,
  calculatePositionPreview,
  calculateProjectedSlTp,
  calculateSpotSwap,
  calculateUnrealizedPnl,
  canAccessStaffTab,
  canClearWithdrawLock,
  checkOrderDirectionConflict,
  computeOrganicMarketTickPrice,
  computeScheduledCoinPrice,
  convertCurrencyMmkUsd,
  evaluatePositionAutoClose,
  evaluateWithdrawalEligibility,
  extractAccountTargetNumber,
  generateWalletCsv,
  getAllowedStaffTabs,
  getCleanSymbol,
  normalizeBrandLogoUrl,
  sanitizeMemberNoticeText,
  shouldLiquidatePosition,
  shouldTriggerPreOrder,
  shouldTriggerPriceAlert,
  shouldTriggerSlTp,
  summarizeCoinTradeAnalytics,
  validateSlTpTargets,
} from './tradingEngine';
import {
  aggregateCandlesByTimeframe,
  buildPersistentChartCandles,
  getCandleBucketStartMs,
} from './chartEngine';

test('calculatePositionPreview computes leverage, fees, and liquidation accurately', () => {
  const long10x = calculatePositionPreview({
    margin: 500,
    leverage: 10,
    side: 'buy',
    marketPrice: 80000,
  });
  assert.equal(long10x.totalValue, 5000);
  assert.equal(long10x.tradeFee, 9); // 0.18% of 5000
  assert.equal(long10x.closeFee, 9); // 0.18% of 5000
  assert.equal(long10x.totalRequired, 509);
  assert.equal(long10x.isLimitOrder, false);
  assert.equal(long10x.liqPriceValue, 72000);
  assert.equal(long10x.liqPriceFormatted, '$72000.00');

  const spot1x = calculatePositionPreview({
    margin: 200,
    leverage: 1,
    side: 'buy',
    marketPrice: 4000,
    customEntryPrice: 3900,
  });
  assert.equal(spot1x.isLimitOrder, true);
  assert.equal(spot1x.liqPriceValue, null);
  assert.equal(spot1x.liqPriceFormatted, 'None (Spot Mode)');
});

test('calculateUnrealizedPnl handles Long and Short profits and losses', () => {
  const longPnl = calculateUnrealizedPnl(
    { side: 'buy', entryPrice: 2000, totalValue: 10000, leverage: 10 },
    2200
  );
  assert.equal(Math.round(longPnl.pnlVal), 1000);
  assert.equal(Math.round(longPnl.pnlPct), 100);

  const shortPnl = calculateUnrealizedPnl(
    { side: 'sell', entryPrice: 100, totalValue: 1000, leverage: 5 },
    90
  );
  assert.equal(Math.round(shortPnl.pnlVal), 100);
  assert.equal(Math.round(shortPnl.pnlPct), 50);
});

test('calculateCloseSettlement deducts 0.18% close fee on every closed trade', () => {
  // 10x $1,000 margin -> $10,000 notional -> 0.18% open fee ($18) + 0.18% close fee ($18)
  const win = calculateCloseSettlement(
    { margin: 1000, totalValue: 10000, tradingFeePaid: 18, fundingFeePaid: 0 },
    1000
  );
  assert.equal(win.closeFee, 18);
  assert.equal(win.closeProfitFee, 18);
  assert.equal(win.finalNetProfit, 982);
  assert.equal(win.totalFeesPaid, 36);
  assert.equal(win.netReturnToWallet, 1982);

  const loss = calculateCloseSettlement(
    { margin: 1000, totalValue: 10000, tradingFeePaid: 18, fundingFeePaid: 0 },
    -300
  );
  assert.equal(loss.closeFee, 18);
  assert.equal(loss.closeProfitFee, 18);
  assert.equal(loss.finalNetProfit, -318);
  assert.equal(loss.totalFeesPaid, 36);
  assert.equal(loss.netReturnToWallet, 682);
});

test('shouldTriggerPreOrder and shouldTriggerSlTp detect price crosses properly', () => {
  assert.equal(shouldTriggerPreOrder({ side: 'buy', entryPrice: 80000 }, 79990), true);
  assert.equal(shouldTriggerPreOrder({ side: 'buy', entryPrice: 80000 }, 80100), false);
  assert.equal(shouldTriggerPreOrder({ side: 'sell', entryPrice: 85000 }, 85050), true);

  assert.equal(shouldTriggerSlTp({ side: 'buy', stopLoss: 78000, takeProfit: 84000 }, 77900), 'sl');
  assert.equal(shouldTriggerSlTp({ side: 'buy', stopLoss: 78000, takeProfit: 84000 }, 84100), 'tp');
  assert.equal(shouldTriggerSlTp({ side: 'sell', stopLoss: 86000, takeProfit: 79000 }, 78500), 'tp');
});

test('calculateSpotSwap and convertCurrencyMmkUsd compute exact outputs', () => {
  const swapToCoin = calculateSpotSwap('usdtToCoin', 1000, 100);
  assert.equal(swapToCoin.feeUsdt, 0.15);
  assert.equal(Number(swapToCoin.netOutput.toFixed(4)), 9.9985);

  const mmk = convertCurrencyMmkUsd(100, 'usdt', 4300);
  assert.equal(mmk.mmkAmount, 430000);

  const csv = generateWalletCsv([
    { type: 'DEPOSIT SUBMITTED', amount: 250, target: 'Tx123', status: 'SUCCESS', timestamp: '2026-11-14' },
  ]);
  assert.match(csv, /^Transaction Type,Amount \(USD\)/);
  assert.match(csv, /"DEPOSIT",250\.00,"Tx123","SUCCESS"/);
});

test('shouldTriggerPriceAlert fires only once when above or below threshold is reached', () => {
  assert.equal(
    shouldTriggerPriceAlert({ condition: 'above', targetPrice: 70000, triggered: false }, 70050),
    true
  );
  assert.equal(
    shouldTriggerPriceAlert({ condition: 'above', targetPrice: 70000, triggered: false }, 69900),
    false
  );
  assert.equal(
    shouldTriggerPriceAlert({ condition: 'below', targetPrice: 2000, triggered: false }, 1995),
    true
  );
  assert.equal(
    shouldTriggerPriceAlert({ condition: 'below', targetPrice: 2000, triggered: true }, 1900),
    false
  );
});

test('evaluateWithdrawalEligibility enforces deposit, trade-after-deposit, and admin-only unlock', () => {
  assert.equal(FIRST_REGISTER_REAL_BONUS_USD, 2);

  // Freshly registered user ($2 real balance, no deposit yet)
  const freshUser = evaluateWithdrawalEligibility({
    isBlocked: false,
    isWithdrawBlocked: false,
    hasDepositedBefore: false,
    hasTradedAfterDeposit: false,
    withdrawLockClearedByAdmin: false,
  });
  assert.equal(freshUser.allowed, false);
  assert.equal(freshUser.lockType, 'no_deposit');
  assert.match(freshUser.reason || '', /make your first deposit/i);

  // After deposit, before placing any real trade
  const afterDepositNoTrade = evaluateWithdrawalEligibility({
    isBlocked: false,
    isWithdrawBlocked: false,
    hasDepositedBefore: true,
    hasTradedAfterDeposit: false,
    withdrawLockClearedByAdmin: false,
  });
  assert.equal(afterDepositNoTrade.allowed, false);
  assert.equal(afterDepositNoTrade.lockType, 'no_trade_after_deposit');

  // After deposit + real trade -> withdrawal unlocked
  const afterDepositAndTrade = evaluateWithdrawalEligibility({
    isBlocked: false,
    isWithdrawBlocked: false,
    hasDepositedBefore: true,
    hasTradedAfterDeposit: true,
    withdrawLockClearedByAdmin: false,
  });
  assert.equal(afterDepositAndTrade.allowed, true);
  assert.equal(afterDepositAndTrade.lockType, 'none');

  // Admin clears lock directly even without deposit/trade
  const adminCleared = evaluateWithdrawalEligibility({
    isBlocked: false,
    isWithdrawBlocked: false,
    hasDepositedBefore: false,
    hasTradedAfterDeposit: false,
    withdrawLockClearedByAdmin: true,
  });
  assert.equal(adminCleared.allowed, true);

  // Ensure member-visible notices never mention admin, staff, caiwu, or chukuan
  const blockedUser = evaluateWithdrawalEligibility({
    isBlocked: true,
    isWithdrawBlocked: false,
    hasDepositedBefore: false,
    hasTradedAfterDeposit: false,
    withdrawLockClearedByAdmin: false,
  });
  const staffLockedUser = evaluateWithdrawalEligibility({
    isBlocked: false,
    isWithdrawBlocked: true,
    hasDepositedBefore: true,
    hasTradedAfterDeposit: true,
    withdrawLockClearedByAdmin: false,
  });
  for (const r of [freshUser.reason, afterDepositNoTrade.reason, blockedUser.reason, staffLockedUser.reason]) {
    assert.ok(r);
    assert.equal(/\b(admin|staff|caiwu|chukuan)\b/i.test(r), false);
  }
  assert.equal(sanitizeMemberNoticeText('ADMIN ADD BALANCE'), 'SYSTEM CREDIT');
  assert.equal(sanitizeMemberNoticeText('ADMIN DEDUCT BALANCE'), 'SYSTEM ADJUSTMENT');
  assert.equal(
    /\b(admin|staff|caiwu|chukuan)\b/i.test(sanitizeMemberNoticeText('Rejected by Finance/Admin')),
    false
  );
  const mmkWd = convertCurrencyMmkUsd(200000, 'mmk', 4300);
  assert.ok(Math.abs(mmkWd.usdAmount - 46.51) < 0.02);
  assert.equal(mmkWd.mmkAmount, 200000);

  // Admin role check: only admin may clear member withdraw locks
  assert.equal(canClearWithdrawLock('admin'), true);
  assert.equal(canClearWithdrawLock('staff'), false);
  assert.equal(canClearWithdrawLock('caiwu'), false);
  assert.equal(canClearWithdrawLock('chukuan'), false);
  assert.equal(canClearWithdrawLock('user'), false);
});

test('resolveHasFirstDeposit supports legacy flags/deposits while ignoring P2P transfers and honoring Admin revoke', async () => {
  const { resolveHasFirstDeposit } = await import('./tradingEngine');

  // Fresh account or user who only received P2P transfers -> false
  assert.equal(
    resolveHasFirstDeposit(
      { hasFirstDeposit: false, hasDepositedBefore: false, totalDeposited: 0 },
      [{ type: 'P2P TRANSFER RECEIVED (REAL)', status: 'SUCCESS' }]
    ),
    false
  );

  // Legacy user with hasDepositedBefore === true -> true
  assert.equal(
    resolveHasFirstDeposit({ hasDepositedBefore: true }),
    true
  );

  // Legacy user with approved DEPOSIT transaction -> true
  assert.equal(
    resolveHasFirstDeposit(
      { hasFirstDeposit: false, hasDepositedBefore: false, totalDeposited: 0 },
      [{ type: 'DEPOSIT SUBMITTED (KPAY)', status: 'APPROVED' }]
    ),
    true
  );

  // Legacy user with totalDeposited > 0 -> true
  assert.equal(
    resolveHasFirstDeposit({ hasFirstDeposit: false, hasDepositedBefore: false, totalDeposited: 250 }),
    true
  );

  // Admin manual revoke overrides historical flags cleanly
  assert.equal(
    resolveHasFirstDeposit(
      {
        hasFirstDeposit: false,
        hasDepositedBefore: false,
        totalDeposited: 250,
        firstDepositRevokedByAdmin: true,
      },
      [{ type: 'DEPOSIT SUBMITTED (KPAY)', status: 'APPROVED' }]
    ),
    false
  );
});

test('extractAccountTargetNumber extracts account/phone from formatted descriptions', () => {
  assert.equal(extractAccountTargetNumber('KPay - Ko Mg (09789123456)'), '09789123456');
  assert.equal(extractAccountTargetNumber('USDT TRC20 (TX98235abc)'), 'TX98235abc');
  assert.equal(extractAccountTargetNumber('09911223344'), '09911223344');
  assert.equal(extractAccountTargetNumber(''), '');
});

test('getAllowedStaffTabs and canAccessStaffTab enforce role-based access control', () => {
  assert.deepEqual(getAllowedStaffTabs('admin'), ['rates', 'coins', 'lottery', 'news', 'faq', 'caiwu', 'chukuan', 'admin', 'search', 'roles']);
  assert.deepEqual(getAllowedStaffTabs('staff'), ['rates', 'faq', 'caiwu', 'chukuan', 'admin', 'search', 'roles']);
  assert.deepEqual(getAllowedStaffTabs('caiwu'), ['caiwu', 'search']);
  assert.deepEqual(getAllowedStaffTabs('chukuan'), ['chukuan']);
  assert.deepEqual(getAllowedStaffTabs('user'), []);

  assert.equal(canAccessStaffTab('admin', 'coins'), true);
  assert.equal(canAccessStaffTab('staff', 'coins'), false);
  assert.equal(canAccessStaffTab('caiwu', 'caiwu'), true);
  assert.equal(canAccessStaffTab('caiwu', 'search'), true);
  assert.equal(canAccessStaffTab('caiwu', 'chukuan'), false);
  assert.equal(canAccessStaffTab('chukuan', 'chukuan'), true);
  assert.equal(canAccessStaffTab('chukuan', 'caiwu'), false);
  assert.equal(canAccessStaffTab('user', 'rates'), false);
});

test('shouldLiquidatePosition triggers when mark price crosses leveraged liquidation threshold', () => {
  const long10x = { side: 'buy' as const, entryPrice: 100, leverage: 10, liqPrice: '$90.00' };
  assert.equal(shouldLiquidatePosition(long10x, 92), false);
  assert.equal(shouldLiquidatePosition(long10x, 90), true);
  assert.equal(shouldLiquidatePosition(long10x, 82), true);

  const short10x = { side: 'sell' as const, entryPrice: 100, leverage: 10, liqPrice: '$110.00' };
  assert.equal(shouldLiquidatePosition(short10x, 108), false);
  assert.equal(shouldLiquidatePosition(short10x, 110), true);

  const spot1x = { side: 'buy' as const, entryPrice: 100, leverage: 1, liqPrice: 'None (Spot Mode)' };
  assert.equal(shouldLiquidatePosition(spot1x, 1), false);
  assert.equal(getCleanSymbol('XU/USDT'), 'XUUSDT');
});

test('computeScheduledCoinPrice progresses smoothly up then down to liquidation bottom', () => {
  const startMs = 1_700_000_000_000;
  const coin = {
    currentPrice: 100,
    schedule: {
      mode: 'up_then_down' as const,
      startedAtMs: startMs,
      startPrice: 100,
      upTargetPrice: 120,
      upDurationSec: 4,
      downTargetPrice: 80,
      downDurationSec: 4,
      active: true,
    },
  };

  const midUp = computeScheduledCoinPrice(coin, startMs + 2000);
  assert.equal(midUp.phase, 'up');
  assert.ok(midUp.price > 105 && midUp.price < 120);

  const midDown = computeScheduledCoinPrice(coin, startMs + 6000);
  assert.equal(midDown.phase, 'down');
  assert.ok(midDown.price < 110 && midDown.price > 85);

  const done = computeScheduledCoinPrice(coin, startMs + 9000);
  assert.equal(done.completed, true);
  assert.equal(done.price, 80);
});

test('summarizeCoinTradeAnalytics tallies total trades, wins, losses, net admin profit, and claimable balance', () => {
  const summary = summarizeCoinTradeAnalytics(
    'XUUSDT',
    [
      {
        id: 't1',
        symbol: 'XUUSDT',
        userUid: 'u1',
        userEmail: 'u1@test.com',
        side: 'buy',
        leverage: 10,
        margin: 500,
        entryPrice: 100,
        closePrice: 88,
        liqPrice: 90,
        tradingFee: 10,
        pnlVal: -500,
        status: 'LIQUIDATED',
        accountMode: 'real',
        openedAtMs: 1000,
      },
      {
        id: 't2',
        symbol: 'XUUSDT',
        userUid: 'u2',
        userEmail: 'u2@test.com',
        side: 'buy',
        leverage: 5,
        margin: 200,
        entryPrice: 100,
        closePrice: 110,
        liqPrice: 80,
        tradingFee: 2,
        pnlVal: 100,
        status: 'CLOSED',
        accountMode: 'real',
        openedAtMs: 2000,
      },
      {
        id: 't3',
        symbol: 'XUUSDT',
        userUid: 'u3',
        userEmail: 'u3@test.com',
        side: 'buy',
        leverage: 10,
        margin: 300,
        entryPrice: 100,
        closePrice: null,
        liqPrice: 90,
        tradingFee: 6,
        pnlVal: 0,
        status: 'OPEN',
        accountMode: 'real',
        openedAtMs: 3000,
      },
    ],
    [
      {
        id: 'c1',
        symbol: 'XUUSDT',
        amountUsd: 150,
        claimedByUid: 'ADMIN-1',
        claimedByEmail: 'admin@zectrade.io',
        claimedAtLabel: '2026-11-15',
        claimedAtMs: 4000,
      },
    ]
  );

  assert.equal(summary.totalTrades, 3);
  assert.equal(summary.openTrades, 1);
  assert.equal(summary.closedWinTrades, 1);
  assert.equal(summary.liquidatedTrades, 1);
  assert.equal(summary.totalUserWinProfitUsd, 100);
  assert.equal(summary.totalUserLossUsd, 500);
  assert.equal(summary.totalTradingFeesUsd, 18);
  assert.equal(summary.netAdminProfitUsd, 418); // 500 + 18 - 100
  assert.equal(summary.alreadyClaimedUsd, 150);
  assert.equal(summary.claimableProfitUsd, 268);
  assert.equal(summary.recommendedLiqBottomPrice, Number((90 * 0.96).toFixed(3)));
});

test('computeOrganicMarketTickPrice generates realistic bounded continuous live movement around anchor price', () => {
  const anchor = 100;
  const baseTime = 1_700_000_000_000;
  const samples = new Set<number>();
  for (let s = 0; s < 12; s++) {
    const p = computeOrganicMarketTickPrice(anchor, 'XUUSDT', baseTime + s * 1000);
    assert.ok(p >= 98 && p <= 102, `Expected live tick ${p} near ${anchor}`);
    samples.add(p);
  }
  // Should move continuously across seconds instead of remaining frozen
  assert.ok(samples.size >= 8, `Expected dynamic live movement, got ${samples.size} unique values`);
  // Same second & symbol must match deterministically across all clients
  assert.equal(
    computeOrganicMarketTickPrice(anchor, 'XUUSDT', baseTime + 2100),
    computeOrganicMarketTickPrice(anchor, 'XUUSDT', baseTime + 2900)
  );
});

test('computeScheduledCoinPrice supports continuous repeatLoop cycling up and down indefinitely', () => {
  const startMs = 1_700_000_000_000;
  const coin = {
    currentPrice: 100,
    schedule: {
      mode: 'up_then_down' as const,
      startedAtMs: startMs,
      startPrice: 100,
      upTargetPrice: 120,
      upDurationSec: 4,
      downTargetPrice: 80,
      downDurationSec: 4,
      repeatLoop: true,
      active: true,
    },
  };

  const c1Up = computeScheduledCoinPrice(coin, startMs + 2000);
  assert.equal(c1Up.completed, false);
  assert.equal(c1Up.phase, 'up');

  // In cycle 2 (after 8s total cycle), it should NEVER mark completed and should rise up again!
  const c2Up = computeScheduledCoinPrice(coin, startMs + 10_000);
  assert.equal(c2Up.completed, false);
  assert.equal(c2Up.phase, 'up');
  assert.ok(c2Up.price > 90 && c2Up.price <= 122);

  const c2Down = computeScheduledCoinPrice(coin, startMs + 14_000);
  assert.equal(c2Down.completed, false);
  assert.equal(c2Down.phase, 'down');
});

test('computeScheduledCoinPrice glides gradually without instant jumps on glide_to_target and respects paused', () => {
  const startMs = 1_700_000_000_000;
  const glideCoin = {
    currentPrice: 100,
    schedule: {
      mode: 'glide_to_target' as const,
      startedAtMs: startMs,
      startPrice: 100,
      upTargetPrice: 80,
      upDurationSec: 30,
      downTargetPrice: 80,
      downDurationSec: 30,
      active: true,
    },
  };

  // At t=3s (10% of 30s), price should still be near 100 (NOT dropped to 80!)
  const early = computeScheduledCoinPrice(glideCoin, startMs + 3_000);
  assert.equal(early.completed, false);
  assert.equal(early.phase, 'down');
  assert.ok(early.price > 95 && early.price < 100, `Expected gentle early drop, got ${early.price}`);
  assert.equal(early.progressPct, 10);

  // At t=15s (50% of 30s), easeInOutSmooth(0.5) = 0.5 -> ~90
  const mid = computeScheduledCoinPrice(glideCoin, startMs + 15_000);
  assert.equal(mid.completed, false);
  assert.ok(mid.price >= 89 && mid.price <= 91, `Expected smooth midpoint ~90, got ${mid.price}`);

  // At t=30s -> completed at 80
  const done = computeScheduledCoinPrice(glideCoin, startMs + 30_000);
  assert.equal(done.completed, true);
  assert.equal(done.price, 80);

  // When paused, price freezes at currentPrice
  const paused = computeScheduledCoinPrice(
    {
      currentPrice: 93.45,
      schedule: { ...glideCoin.schedule, paused: true },
    },
    startMs + 20_000
  );
  assert.equal(paused.price, 93.45);
  assert.equal(paused.completed, false);
});

test('computeOrganicMarketTickPrice reflects trendBias up/down and summarizeCoinTradeAnalytics computes long/short exposure', () => {
  const baseTime = 1_700_000_000_000;
  const upPrice = computeOrganicMarketTickPrice(100, 'XUUSDT', baseTime, 0.0045, 'up');
  const downPrice = computeOrganicMarketTickPrice(100, 'XUUSDT', baseTime, 0.0045, 'down');
  assert.ok(upPrice > downPrice, `Expected bullish bias (${upPrice}) > bearish bias (${downPrice})`);

  const summary = summarizeCoinTradeAnalytics(
    'XUUSDT',
    [
      {
        id: 'l1',
        symbol: 'XUUSDT',
        userUid: 'u1',
        userEmail: 'long@test.com',
        side: 'buy',
        leverage: 10,
        margin: 100,
        entryPrice: 100,
        closePrice: null,
        liqPrice: 90,
        tradingFee: 2,
        pnlVal: 0,
        status: 'OPEN',
        accountMode: 'real',
        openedAtMs: 1000,
      },
      {
        id: 's1',
        symbol: 'XUUSDT',
        userUid: 'u2',
        userEmail: 'short@test.com',
        side: 'sell',
        leverage: 5,
        margin: 300,
        entryPrice: 100,
        closePrice: null,
        liqPrice: 120,
        tradingFee: 3,
        pnlVal: 0,
        status: 'OPEN',
        accountMode: 'real',
        openedAtMs: 2000,
      },
    ],
    []
  );

  assert.equal(summary.openLongExposureUsd, 1000);
  assert.equal(summary.openShortExposureUsd, 1500);
  assert.equal(summary.recommendedLiqBottomPrice, Number((90 * 0.96).toFixed(3)));
  assert.equal(summary.recommendedShortSqueezePrice, Number((120 * 1.04).toFixed(3)));
});

test('checkOrderDirectionConflict disallows simultaneous Buy and Sell on the same coin', () => {
  const activePositions = [
    { symbol: 'XUUSDT', side: 'buy' as const, accountMode: 'real' as const },
  ];
  const preOrders = [
    { symbol: 'ETHUSDT', side: 'sell' as const, accountMode: 'real' as const },
  ];

  // Opposite side on same coin must be blocked
  const oppSell = checkOrderDirectionConflict('XUUSDT', 'sell', 'real', activePositions, preOrders);
  assert.equal(oppSell.allowed, false);
  assert.equal(oppSell.conflictType, 'opposite_side');
  assert.equal(oppSell.existingSide, 'buy');
  assert.equal(
    oppSell.reason,
    'You already have an active position or pending order on XUUSDT. Close or cancel it first.'
  );

  // Same side duplicate on same coin is also blocked
  const dupBuy = checkOrderDirectionConflict('XUUSDT', 'buy', 'real', activePositions, preOrders);
  assert.equal(dupBuy.allowed, false);
  assert.equal(dupBuy.conflictType, 'same_side');
  assert.equal(
    dupBuy.reason,
    'You already have an active position or pending order on XUUSDT. Close or cancel it first.'
  );

  // Opposite side against pending pre-order is blocked
  const oppBuyEth = checkOrderDirectionConflict('ETHUSDT', 'buy', 'real', activePositions, preOrders);
  assert.equal(oppBuyEth.allowed, false);
  assert.equal(oppBuyEth.conflictType, 'opposite_side');
  assert.equal(
    oppBuyEth.reason,
    'You already have an active position or pending order on ETHUSDT. Close or cancel it first.'
  );

  // Different coin or different account mode is allowed
  const btcBuy = checkOrderDirectionConflict('BTCUSDT', 'buy', 'real', activePositions, preOrders);
  assert.equal(btcBuy.allowed, true);
  const xuDemo = checkOrderDirectionConflict('XUUSDT', 'sell', 'demo', activePositions, preOrders);
  assert.equal(xuDemo.allowed, true);
});

test('validateSlTpTargets and calculateProjectedSlTp validate direction and auto-count exact USD/ROI%', () => {
  // Long: SL < Entry < TP
  assert.equal(validateSlTpTargets('buy', 100, 95, 115).valid, true);
  assert.equal(validateSlTpTargets('buy', 100, 105, 115).valid, false);
  assert.equal(validateSlTpTargets('buy', 100, 95, 99).valid, false);

  // Short: TP < Entry < SL
  assert.equal(validateSlTpTargets('sell', 100, 105, 85).valid, true);
  assert.equal(validateSlTpTargets('sell', 100, 95, 85).valid, false);
  assert.equal(validateSlTpTargets('sell', 100, 105, 102).valid, false);

  // 10x Long $1,000 margin at $100 entry -> $10,000 notional -> 0.18% close fee = $18
  const proj = calculateProjectedSlTp({
    side: 'buy',
    leverage: 10,
    margin: 1000,
    entryPrice: 100,
    stopLoss: 95,
    takeProfit: 120,
  });
  // SL gross = -$500 minus 0.18% close fee ($18) = -$518
  assert.equal(Math.round(proj.slPnlUsd!), -518);
  assert.equal(Math.round(proj.slPnlPct!), -50);
  // TP gross = +$2,000 minus 0.18% close fee ($18) = $1,982
  assert.equal(proj.tpPnlUsd, 1982);
  assert.equal(Math.round(proj.tpPnlPct!), 200);
});

test('evaluatePositionAutoClose strictly liquidates at liqPrice or margin wipeout and triggers TP/SL', () => {
  const xuLong10x = {
    side: 'buy' as const,
    entryPrice: 108.16,
    leverage: 10,
    liqPrice: '$97.34',
    margin: 300_000,
    totalValue: 3_000_000,
    stopLoss: 99,
    takeProfit: 120,
  };

  // Price dropped below liqPrice ($85.99 <= $97.34) -> MUST liquidate immediately!
  const liqHit = evaluatePositionAutoClose(xuLong10x, 85.99);
  assert.ok(liqHit);
  assert.equal(liqHit.trigger, 'liquidation');
  assert.equal(liqHit.isLiquidated, true);

  // Exact touch at liqPrice
  const exactLiq = evaluatePositionAutoClose(xuLong10x, 97.34);
  assert.ok(exactLiq);
  assert.equal(exactLiq.isLiquidated, true);

  // Stop Loss triggered above liquidation
  const slHit = evaluatePositionAutoClose(xuLong10x, 99);
  assert.ok(slHit);
  assert.equal(slHit.trigger, 'sl');
  assert.equal(slHit.isLiquidated, false);

  // Take Profit triggered
  const tpHit = evaluatePositionAutoClose(xuLong10x, 120.5);
  assert.ok(tpHit);
  assert.equal(tpHit.trigger, 'tp');
  assert.equal(tpHit.isLiquidated, false);
});

test('aggregateCandlesByTimeframe and buildPersistentChartCandles preserve immutable history across timeframes', () => {
  const baseMin = Date.UTC(2026, 10, 16, 10, 0, 0, 0); // 10:00 UTC exact 15m boundary
  const recorded1m = [
    { time: baseMin, open: 100, high: 103, low: 99, close: 102, volume: 10 },
    { time: baseMin + 60_000, open: 102, high: 105, low: 101, close: 104, volume: 15 },
    { time: baseMin + 120_000, open: 104, high: 104, low: 98, close: 99, volume: 20 },
    { time: baseMin + 5 * 60_000, open: 99, high: 106, low: 98.5, close: 105, volume: 25 },
  ];

  // 5m aggregation combines first 3 bars into 10:00 and 4th bar into 10:05
  const agg5m = aggregateCandlesByTimeframe(recorded1m, '5m');
  assert.equal(agg5m.length, 2);
  assert.equal(agg5m[0].time, baseMin);
  assert.equal(agg5m[0].open, 100);
  assert.equal(agg5m[0].high, 105);
  assert.equal(agg5m[0].low, 98);
  assert.equal(agg5m[0].close, 99);
  assert.equal(agg5m[0].volume, 45);
  assert.equal(agg5m[1].time, baseMin + 5 * 60_000);
  assert.equal(agg5m[1].close, 105);

  // Earlier historical candles must NOT change when livePrice later changes from 105 to 125!
  const seriesA = buildPersistentChartCandles('XUUSDT', recorded1m, 105, '5m', 20, baseMin + 6 * 60_000);
  const seriesB = buildPersistentChartCandles('XUUSDT', recorded1m, 125, '5m', 20, baseMin + 6 * 60_000);
  assert.equal(seriesA.length, 20);
  assert.equal(seriesB.length, 20);
  assert.deepEqual(seriesA.slice(0, 19), seriesB.slice(0, 19));
  assert.equal(seriesB[19].close, 125);
  assert.equal(getCandleBucketStartMs(baseMin + 125_000, '15m'), baseMin);
});

test('normalizeMemberProfileInput validates profile fields, withdraw method, PIN, and image data URLs', async () => {
  const { normalizeMemberProfileInput, resolveWithdrawDefaults } = await import('./tradingEngine');

  const valid = normalizeMemberProfileInput(
    {
      username: '  Dubai Pro  ',
      fullName: '  Tariq Al Mansoor ',
      phone: ' +971 50 123 4567 ',
      country: ' Dubai, UAE ',
      bio: ' Swing & Futures ',
      withdrawMethod: 'BANK',
      withdrawAccountName: ' Tariq Al Mansoor ',
      withdrawAccountNumber: ' AE120001122334455 ',
      avatarUrl: 'data:image/jpeg;base64,AAAA',
    },
    { allowEmailAndPin: false }
  );
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.data.username, 'Dubai Pro');
    assert.equal(valid.data.withdrawMethod, 'bank');
    assert.equal(valid.data.withdrawAccountName, 'Tariq Al Mansoor');
    assert.equal(valid.data.withdrawAccountNumber, 'AE120001122334455');
  }

  // Admin can update email and 4-digit PIN, invalid PIN must be rejected
  const badPin = normalizeMemberProfileInput(
    { securityPin: '12ab' },
    { allowEmailAndPin: true }
  );
  assert.equal(badPin.ok, false);

  const goodAdmin = normalizeMemberProfileInput(
    { email: '  Updated@Test.IO ', securityPin: '9090' },
    { allowEmailAndPin: true }
  );
  assert.equal(goodAdmin.ok, true);
  if (goodAdmin.ok) {
    assert.equal(goodAdmin.data.email, 'updated@test.io');
    assert.equal(goodAdmin.data.securityPin, '9090');
  }

  // Bad avatar URL rejected
  const badAvatar = normalizeMemberProfileInput({ avatarUrl: 'javascript:alert(1)' });
  assert.equal(badAvatar.ok, false);

  // Withdraw defaults resolution
  const defaults = resolveWithdrawDefaults({
    withdrawMethod: 'wavepay',
    withdrawAccountName: 'Su Myat Noe',
    withdrawAccountNumber: '09988223344',
    fullName: 'Fallback',
  });
  assert.deepEqual(defaults, {
    method: 'wavepay',
    holderName: 'Su Myat Noe',
    target: '09988223344',
  });
});

test('normalizeBrandLogoUrl validates custom URLs, uploaded base64 icons, default reset, and rejects unsafe URIs', () => {
  assert.deepEqual(normalizeBrandLogoUrl(''), { ok: true, url: null });
  assert.deepEqual(normalizeBrandLogoUrl(DEFAULT_BRAND_LOGO_URL), { ok: true, url: null });

  const httpsRes = normalizeBrandLogoUrl('https://cdn.example.com/brand-logo.png');
  assert.deepEqual(httpsRes, { ok: true, url: 'https://cdn.example.com/brand-logo.png' });

  const svgData = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
  assert.deepEqual(normalizeBrandLogoUrl(svgData), { ok: true, url: svgData });

  const xssRes = normalizeBrandLogoUrl('javascript:alert(1)');
  assert.equal(xssRes.ok, false);
});






