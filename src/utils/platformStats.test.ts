import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PLATFORM_STATS,
  parseStatNumber,
  normalizePlatformStats,
  easeOutExpo,
  interpolateStatValue,
  formatStatDisplay,
  applyStatQuickAdjust,
  computeStatsWithActivity,
} from './platformStats';

test('DEFAULT_PLATFORM_STATS matches required defaults', () => {
  assert.deepEqual(DEFAULT_PLATFORM_STATS, {
    registeredMembers: 23909,
    membersCount: 23909,
    totalDeposits: 4285000,
    totalWithdrawals: 15240600,
    autoIncrementStats: false,
  });
});

test('parseStatNumber parses integers and formatted currency strings cleanly', () => {
  assert.equal(parseStatNumber(4285000, 0), 4285000);
  assert.equal(parseStatNumber('$42,850,000', 0), 42850000);
  assert.equal(parseStatNumber('23,909', 0), 23909);
  assert.equal(parseStatNumber('$42,8', 4285000), 4285000);
  assert.equal(parseStatNumber('invalid', 100), 100);
  assert.equal(parseStatNumber(-50, 100), 100);
});

test('normalizePlatformStats handles numeric, legacy string, and missing values', () => {
  const fromLegacy = normalizePlatformStats({
    membersCount: 25100,
    totalDeposits: '$50,000,000',
    totalWithdrawals: '$18,000,000',
  });
  assert.deepEqual(fromLegacy, {
    registeredMembers: 25100,
    membersCount: 25100,
    totalDeposits: 50000000,
    totalWithdrawals: 18000000,
    autoIncrementStats: false,
  });

  const fromFirestore = normalizePlatformStats({
    registeredMembers: 30000,
    totalDeposits: 4500000,
    totalWithdrawals: 16000000,
    autoIncrementStats: true,
  });
  assert.deepEqual(fromFirestore, {
    registeredMembers: 30000,
    membersCount: 30000,
    totalDeposits: 4500000,
    totalWithdrawals: 16000000,
    autoIncrementStats: true,
  });
});

test('easeOutExpo and interpolateStatValue roll smoothly without overshoot', () => {
  assert.equal(easeOutExpo(0), 0);
  assert.equal(easeOutExpo(1), 1);
  assert.ok(easeOutExpo(0.5) > 0.95 && easeOutExpo(0.5) < 1);

  assert.equal(interpolateStatValue(0, 23909, 0), 0);
  assert.equal(interpolateStatValue(0, 23909, 1), 23909);
  const mid = interpolateStatValue(23909, 25000, 0.5);
  assert.ok(mid > 23909 && mid < 25000);
});

test('formatStatDisplay formats numbers with commas and currency prefix', () => {
  assert.equal(formatStatDisplay(23909), '23,909');
  assert.equal(formatStatDisplay(4285000, '$'), '$4,285,000');
  assert.equal(formatStatDisplay(42850000, '$'), '$42,850,000');
  assert.equal(formatStatDisplay(15240600, '$'), '$15,240,600');
});

test('applyStatQuickAdjust respects lower bound 0 and exact steps', () => {
  assert.equal(applyStatQuickAdjust(23909, 1000), 24909);
  assert.equal(applyStatQuickAdjust(4285000, -10000), 4275000);
  assert.equal(applyStatQuickAdjust(50, -100), 0);
});

test('computeStatsWithActivity only increments when autoIncrementStats is enabled', () => {
  const manualStats = { ...DEFAULT_PLATFORM_STATS, autoIncrementStats: false };
  assert.equal(computeStatsWithActivity(manualStats, { type: 'registration' }), null);
  assert.equal(computeStatsWithActivity(manualStats, { type: 'deposit', amount: 500 }), null);
  assert.equal(computeStatsWithActivity(manualStats, { type: 'withdrawal', amount: 250 }), null);

  const autoStats = { ...DEFAULT_PLATFORM_STATS, autoIncrementStats: true };
  const afterReg = computeStatsWithActivity(autoStats, { type: 'registration' });
  assert.equal(afterReg?.registeredMembers, 23910);
  assert.equal(afterReg?.membersCount, 23910);

  const afterDep = computeStatsWithActivity(autoStats, { type: 'deposit', amount: 1250 });
  assert.equal(afterDep?.totalDeposits, 4286250);

  const afterWd = computeStatsWithActivity(autoStats, { type: 'withdrawal', amount: 400 });
  assert.equal(afterWd?.totalWithdrawals, 15241000);
});
