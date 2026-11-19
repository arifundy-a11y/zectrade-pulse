import test from 'node:test';
import assert from 'node:assert/strict';
import type { WalletTransaction } from '../types';
import {
  extractDepositMethodLabel,
  filterDepositTransactions,
  filterDpWdTransactions,
  formatDepositStatusLabel,
  isDepositTransaction,
  isWithdrawalTransaction,
  mergeWalletTransactionsWithServerActivity,
  normalizeDepositStatus,
  summarizeDepositTransactions,
  summarizeDpWdTransactions,
  summarizeReferralTransactions,
} from './depositHistory';

const sampleTransactions: WalletTransaction[] = [
  {
    id: 'sql-101',
    type: 'DEPOSIT SUBMITTED (KPAY)',
    amount: 250,
    target: 'Tx ID: TX991122 (1,075,000 MMK)',
    status: 'PENDING',
    timestamp: '11/18/2026, 10:00 AM',
    rawTime: 1700000300000,
  },
  {
    id: 'sql-100',
    type: 'DEPOSIT SUBMITTED (USDT)',
    amount: 1000,
    target: 'Tx ID: TRC888999',
    status: 'SUCCESS',
    timestamp: '11/17/2026, 09:00 AM',
    rawTime: 1700000200000,
  },
  {
    id: 'loc-99',
    type: 'DEPOSIT (WAVEPAY)',
    amount: 100,
    target: 'Tx ID: WV111222',
    status: 'APPROVED',
    timestamp: '11/16/2026, 08:00 AM',
    rawTime: 1700000100000,
  },
  {
    id: 'loc-98',
    type: 'DEPOSIT SUBMITTED (KPAY)',
    amount: 50,
    target: 'Tx ID: BAD000',
    status: 'FAILED',
    rejectReason: 'Invalid receipt reference',
    timestamp: '11/15/2026, 07:00 AM',
    rawTime: 1700000050000,
  },
  {
    id: 'bonus-1',
    type: 'REFERRAL BONUS (2% 1ST DEPOSIT REWARD)',
    amount: 20,
    target: 'Real Account',
    status: 'SUCCESS',
    timestamp: '11/17/2026, 09:05 AM',
    rawTime: 1700000210000,
  },
  {
    id: 'wd-1',
    type: 'WITHDRAWAL (KPAY)',
    amount: 120,
    target: '09789123456',
    status: 'SUCCESS',
    timestamp: '11/18/2026, 08:00 AM',
    rawTime: 1700000250000,
  },
];

test('isDepositTransaction includes real deposits and excludes referral bonuses, withdrawals, and transfers', () => {
  assert.equal(isDepositTransaction({ type: 'DEPOSIT SUBMITTED (KPAY)' }), true);
  assert.equal(isDepositTransaction({ type: 'DEPOSIT (USDT)' }), true);
  assert.equal(isDepositTransaction({ type: 'REFERRAL BONUS (2% 1ST DEPOSIT REWARD)' }), false);
  assert.equal(isDepositTransaction({ type: 'WITHDRAWAL (KPAY)' }), false);
  assert.equal(isDepositTransaction({ type: 'P2P TRANSFER RECEIVED' }), false);
});

test('normalizeDepositStatus and formatDepositStatusLabel map pending, completed, and rejected statuses cleanly', () => {
  assert.equal(normalizeDepositStatus('PENDING'), 'pending');
  assert.equal(normalizeDepositStatus('SUCCESS'), 'completed');
  assert.equal(normalizeDepositStatus('APPROVED'), 'completed');
  assert.equal(normalizeDepositStatus('COMPLETED'), 'completed');
  assert.equal(normalizeDepositStatus('FAILED'), 'rejected');
  assert.equal(normalizeDepositStatus('REJECTED'), 'rejected');

  assert.equal(formatDepositStatusLabel('pending'), 'Pending');
  assert.equal(formatDepositStatusLabel('completed'), 'Completed');
  assert.equal(formatDepositStatusLabel('rejected'), 'Rejected');
});

test('extractDepositMethodLabel derives human-readable payment methods', () => {
  assert.equal(extractDepositMethodLabel('DEPOSIT SUBMITTED (KPAY)'), 'KBZPay');
  assert.equal(extractDepositMethodLabel('DEPOSIT (WAVEPAY)'), 'WavePay');
  assert.equal(extractDepositMethodLabel('DEPOSIT SUBMITTED (USDT)'), 'USDT TRC20');
  assert.equal(extractDepositMethodLabel('DEPOSIT (BTC)'), 'Bitcoin (BTC)');
});

test('summarizeDepositTransactions computes pending/completed counts and USD totals accurately', () => {
  const summary = summarizeDepositTransactions(sampleTransactions);
  assert.equal(summary.totalCount, 4);
  assert.equal(summary.pendingCount, 1);
  assert.equal(summary.completedCount, 2);
  assert.equal(summary.rejectedCount, 1);
  assert.equal(summary.totalPendingUsd, 250);
  assert.equal(summary.totalCompletedUsd, 1100);
  assert.equal(summary.latestStatus, 'pending');
});

test('filterDepositTransactions filters by status and search query in newest-first order', () => {
  const pendingOnly = filterDepositTransactions(sampleTransactions, 'pending');
  assert.equal(pendingOnly.length, 1);
  assert.equal(pendingOnly[0].id, 'sql-101');

  const completedOnly = filterDepositTransactions(sampleTransactions, 'completed');
  assert.deepEqual(
    completedOnly.map((t) => t.id),
    ['sql-100', 'loc-99']
  );

  const searchWave = filterDepositTransactions(sampleTransactions, 'all', 'wavepay');
  assert.equal(searchWave.length, 1);
  assert.equal(searchWave[0].id, 'loc-99');
});

test('summarizeDpWdTransactions and filterDpWdTransactions combine deposits and withdrawals cleanly', () => {
  assert.equal(isWithdrawalTransaction({ type: 'WITHDRAWAL (KPAY)' }), true);
  assert.equal(isWithdrawalTransaction({ type: 'P2P TRANSFER SENT' }), false);

  const dpWdSummary = summarizeDpWdTransactions(sampleTransactions);
  assert.equal(dpWdSummary.totalCount, 5);
  assert.equal(dpWdSummary.depositCount, 4);
  assert.equal(dpWdSummary.withdrawalCount, 1);
  assert.equal(dpWdSummary.totalCompletedDepositsUsd, 1100);
  assert.equal(dpWdSummary.totalCompletedWithdrawalsUsd, 120);
  assert.equal(dpWdSummary.totalPendingUsd, 250);

  const onlyWithdrawals = filterDpWdTransactions(sampleTransactions, 'withdrawal', 'all');
  assert.deepEqual(onlyWithdrawals.map((t) => t.id), ['wd-1']);

  const completedAll = filterDpWdTransactions(sampleTransactions, 'all', 'completed');
  assert.deepEqual(completedAll.map((t) => t.id), ['wd-1', 'sql-100', 'loc-99']);

  const refSummary = summarizeReferralTransactions(sampleTransactions);
  assert.equal(refSummary.count, 1);
  assert.equal(refSummary.totalEarnedUsd, 20);
});

test('mergeWalletTransactionsWithServerActivity surfaces Cloud SQL deposit statuses and deduplicates matching local/Firestore entries', () => {
  const nowMs = 1700001000000;
  const existing: WalletTransaction[] = [
    {
      id: 'fs-dup-deposit',
      type: 'DEPOSIT SUBMITTED (KPAY)',
      amount: 500,
      target: 'Tx ID: TX500',
      status: 'PENDING',
      timestamp: 'now',
      rawTime: nowMs,
    },
    {
      id: 'fs-bonus',
      type: 'REFERRAL BONUS (2% 1ST DEPOSIT REWARD)',
      amount: 10,
      target: 'Real Account',
      status: 'SUCCESS',
      timestamp: 'earlier',
      rawTime: nowMs - 10000,
    },
  ];

  const merged = mergeWalletTransactionsWithServerActivity(
    existing,
    [
      {
        id: 77,
        requestKind: 'deposit',
        typeLabel: 'DEPOSIT SUBMITTED (KPAY)',
        method: 'kpay',
        amountUsd: 500,
        target: 'Tx ID: TX500',
        status: 'SUCCESS',
        createdAt: new Date(nowMs + 1500).toISOString(),
      },
      {
        id: 78,
        requestKind: 'transfer_in',
        typeLabel: 'P2P TRANSFER RECEIVED',
        amountUsd: 3000,
        target: 'From admin2@gmail.com',
        status: 'SUCCESS',
        createdAt: new Date(nowMs + 5000).toISOString(),
      },
    ],
    { uid: 'u-1', email: 'member@zectrade.io' }
  );

  assert.equal(merged.length, 3);
  const depositRow = merged.find((t) => t.id === 'sql-77');
  assert.ok(depositRow);
  assert.equal(depositRow.status, 'SUCCESS');
  assert.equal(merged.some((t) => t.id === 'fs-dup-deposit'), false);
  assert.equal(merged.some((t) => t.id === 'fs-bonus'), true);
});
