import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LOTTERY_FEE_PCT,
  calculateLotteryTradePreview,
  calculateProjectedHouseProfit,
  checkLotteryColorSideConflict,
  clampFeePct,
  deriveLotteryDrawNumber,
  formatLotteryCountdown,
  formatLotteryFeeUsd,
  generateRandomDigitTicket,
  getLotteryDigitParityLabel,
  isLotteryBettingLocked,
  normalizeDigitTicketNumber,
  resolveLotteryRoundColor,
  resolveLotteryRoundNumber,
  settleDigitLotteryBet,
  settleLotteryBet,
} from './lotteryEngine.ts';

test('calculateLotteryTradePreview computes exact 0.12% default bet fee and payouts across stake sizes', () => {
  assert.equal(DEFAULT_LOTTERY_FEE_PCT, 0.12);
  assert.equal(clampFeePct(Number.NaN), 0.12);

  const preview100 = calculateLotteryTradePreview({
    stake: 100,
    feePct: DEFAULT_LOTTERY_FEE_PCT,
    multiplier: 2,
  });
  assert.equal(preview100.stake, 100);
  assert.equal(preview100.feeAmount, 0.12);
  assert.equal(preview100.netStake, 99.88);
  assert.equal(preview100.grossPayoutOnWin, 199.76);
  assert.equal(preview100.netProfitOnWin, 99.76);
  assert.equal(formatLotteryFeeUsd(preview100.feeAmount), '0.12');

  const preview10 = calculateLotteryTradePreview({
    stake: 10,
    feePct: DEFAULT_LOTTERY_FEE_PCT,
    multiplier: 2,
  });
  assert.equal(preview10.feeAmount, 0.012);
  assert.equal(preview10.netStake, 9.988);
  assert.equal(preview10.grossPayoutOnWin, 19.98);
  assert.equal(formatLotteryFeeUsd(preview10.feeAmount), '0.0120');

  const preview2d = calculateLotteryTradePreview({
    stake: 100,
    feePct: DEFAULT_LOTTERY_FEE_PCT,
    multiplier: 80,
  });
  assert.equal(preview2d.feeAmount, 0.12);
  assert.equal(preview2d.grossPayoutOnWin, 7990.4);
});

test('calculateLotteryTradePreview clamps feePct to [0, 50] and supports custom fees and multipliers', () => {
  const preview5 = calculateLotteryTradePreview({ stake: 200, feePct: 5, multiplier: 2 });
  assert.equal(preview5.feeAmount, 10);
  assert.equal(preview5.netStake, 190);
  assert.equal(preview5.grossPayoutOnWin, 380);
  assert.equal(preview5.netProfitOnWin, 180);

  const clamped = calculateLotteryTradePreview({ stake: 100, feePct: 80, multiplier: 2 });
  assert.equal(clamped.feePct, 50);
  assert.equal(clamped.feeAmount, 50);
  assert.equal(clamped.netStake, 50);
  assert.equal(clamped.grossPayoutOnWin, 100);
});

test('isLotteryBettingLocked locks in final 5 seconds and when paused', () => {
  assert.equal(isLotteryBettingLocked({ remainingSec: 6, lockSeconds: 5, isPaused: false }), false);
  assert.equal(isLotteryBettingLocked({ remainingSec: 5, lockSeconds: 5, isPaused: false }), true);
  assert.equal(isLotteryBettingLocked({ remainingSec: 0, lockSeconds: 5, isPaused: false }), true);
  assert.equal(isLotteryBettingLocked({ remainingSec: 45, lockSeconds: 5, isPaused: true }), true);
});

test('resolveLotteryRoundColor enforces Auto-Balance (minority wins), Manual Override, forcedNumber, and Random RNG', () => {
  assert.equal(
    resolveLotteryRoundColor({ mode: 'auto_balance', greenTotal: 500, redTotal: 150 }),
    'red'
  );
  assert.equal(
    resolveLotteryRoundColor({ mode: 'auto_balance', greenTotal: 100, redTotal: 400 }),
    'green'
  );
  assert.equal(
    resolveLotteryRoundColor({ mode: 'auto_balance', greenTotal: 250, redTotal: 250, rng: 0.2 }),
    'green'
  );
  assert.equal(
    resolveLotteryRoundColor({ mode: 'auto_balance', greenTotal: 250, redTotal: 250, rng: 0.8 }),
    'red'
  );

  // Forced exact number overrides color parity automatically
  assert.equal(
    resolveLotteryRoundColor({ mode: 'manual', greenTotal: 500, redTotal: 0, forcedNumber: 7 }),
    'green'
  );
  assert.equal(
    resolveLotteryRoundColor({ mode: 'manual', greenTotal: 0, redTotal: 500, forcedNumber: 4 }),
    'red'
  );

  // Manual color override
  assert.equal(
    resolveLotteryRoundColor({
      mode: 'manual',
      greenTotal: 50,
      redTotal: 900,
      forcedColor: 'red',
    }),
    'red'
  );

  // Random mode
  assert.equal(
    resolveLotteryRoundColor({ mode: 'random', greenTotal: 0, redTotal: 500, rng: 0.1 }),
    'green'
  );
  assert.equal(
    resolveLotteryRoundColor({ mode: 'random', greenTotal: 500, redTotal: 0, rng: 0.9 }),
    'red'
  );
});

test('checkLotteryColorSideConflict prevents betting opposite color side in the same round', () => {
  const existingGreen = [{ betType: 'color' as const, color: 'green' as const, outcome: 'PENDING' as const }];
  assert.equal(checkLotteryColorSideConflict(existingGreen, 'color', 'green'), null);
  assert.ok(checkLotteryColorSideConflict(existingGreen, 'color', 'red') !== null);
  // Number bets are still allowed cleanly
  assert.equal(checkLotteryColorSideConflict(existingGreen, 'number', 'green'), null);
});

test('resolveLotteryRoundNumber and settleLotteryBet handle exact number bets and color bets', () => {
  const pickedLow = resolveLotteryRoundNumber({
    roundCode: '#20261116-0001',
    mode: 'auto_balance',
    winningColor: 'green',
    numberPayoutExposure: { 1: 500, 3: 500, 5: 100, 7: 500, 9: 500 },
  });
  assert.equal(pickedLow, 5);

  const numWin = settleLotteryBet(
    { betType: 'number', color: 'green', pickedNumber: 5, stake: 100, potentialPayout: 810 },
    'green',
    5
  );
  assert.deepEqual(numWin, { outcome: 'WIN', payoutAmount: 810, netProfit: 710 });

  const numLoss = settleLotteryBet(
    { betType: 'number', color: 'green', pickedNumber: 7, stake: 100, potentialPayout: 810 },
    'green',
    5
  );
  assert.deepEqual(numLoss, { outcome: 'LOSS', payoutAmount: 0, netProfit: -100 });
});

test('calculateProjectedHouseProfit and settleLotteryBet match pool payouts', () => {
  const projection = calculateProjectedHouseProfit({
    greenTotal: 300,
    redTotal: 100,
    feePct: 10,
    multiplier: 2,
  });
  assert.equal(projection.totalPool, 400);
  assert.equal(projection.greenWinPayout, 540);
  assert.equal(projection.redWinPayout, 180);
  assert.equal(projection.profitIfGreenWins, -140);
  assert.equal(projection.profitIfRedWins, 220);

  const win = settleLotteryBet({ color: 'green', stake: 100, potentialPayout: 180 }, 'green');
  assert.deepEqual(win, { outcome: 'WIN', payoutAmount: 180, netProfit: 80 });

  const loss = settleLotteryBet({ color: 'red', stake: 100, potentialPayout: 180 }, 'green');
  assert.deepEqual(loss, { outcome: 'LOSS', payoutAmount: 0, netProfit: -100 });
});

test('formatLotteryCountdown formats mm:ss and hh:mm:ss accurately', () => {
  assert.equal(formatLotteryCountdown(60), '01:00');
  assert.equal(formatLotteryCountdown(5), '00:05');
  assert.equal(formatLotteryCountdown(3665), '01:01:05');
  assert.equal(formatLotteryCountdown(-3), '00:00');
});

test('deriveLotteryDrawNumber returns deterministic color-matched digits 0-9', () => {
  for (let i = 1; i <= 20; i += 1) {
    const code = `20261116-${String(i).padStart(4, '0')}`;
    const greenDigit = deriveLotteryDrawNumber(code, 'green');
    assert.ok(greenDigit >= 0 && greenDigit <= 9);
    assert.equal(greenDigit % 2, 1);
    assert.equal(deriveLotteryDrawNumber(code, 'green'), greenDigit);
    assert.equal(getLotteryDigitParityLabel(greenDigit), 'ODD · GREEN');

    const redDigit = deriveLotteryDrawNumber(code, 'red');
    assert.ok(redDigit >= 0 && redDigit <= 9);
    assert.equal(redDigit % 2, 0);
    assert.equal(deriveLotteryDrawNumber(code, 'red'), redDigit);
    assert.equal(getLotteryDigitParityLabel(redDigit), 'EVEN · RED');
  }
});

test('2D/3D/6D digit ticket normalization, random generation, and settlement work accurately', () => {
  assert.equal(normalizeDigitTicketNumber('07', '2D'), '07');
  assert.equal(normalizeDigitTicketNumber('7', '2D'), null);
  assert.equal(normalizeDigitTicketNumber('419', '3D'), '419');
  assert.equal(normalizeDigitTicketNumber('41', '3D'), null);
  assert.equal(normalizeDigitTicketNumber('048291', '6D'), '048291');
  assert.equal(normalizeDigitTicketNumber('12a456', '6D'), null);

  assert.equal(generateRandomDigitTicket('2D', 0.05), '05');
  assert.equal(generateRandomDigitTicket('3D', 0.007), '007');
  assert.equal(generateRandomDigitTicket('6D', 0).length, 6);

  assert.deepEqual(
    settleDigitLotteryBet({ pickedNumber: '48', stake: 50, potentialPayout: 3800 }, '48'),
    { outcome: 'WIN', payoutAmount: 3800, netProfit: 3750 }
  );
  assert.deepEqual(
    settleDigitLotteryBet({ pickedNumber: '48', stake: 50, potentialPayout: 3800 }, '49'),
    { outcome: 'LOSS', payoutAmount: 0, netProfit: -50 }
  );
});


