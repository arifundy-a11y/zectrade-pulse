import type { WalletTransaction } from '../types';
import { sanitizeMemberNoticeText } from './tradingEngine';

export type DepositFilterStatus = 'all' | 'pending' | 'completed' | 'rejected';
export type NormalizedDepositStatus = 'pending' | 'completed' | 'rejected';

export interface ServerWalletActivityRow {
  id: number;
  requestKind: string;
  typeLabel: string;
  method?: string;
  amountUsd: number;
  target: string;
  status: string;
  rejectReason?: string | null;
  createdAt: string;
  processedAt?: string | null;
}

export interface DepositHistorySummary {
  totalCount: number;
  pendingCount: number;
  completedCount: number;
  rejectedCount: number;
  totalCompletedUsd: number;
  totalPendingUsd: number;
  latestStatus: NormalizedDepositStatus | null;
}

export function isDepositTransaction(tx: Pick<WalletTransaction, 'type'>): boolean {
  const upper = (tx.type || '').toUpperCase();
  if (!upper.includes('DEPOSIT')) return false;
  if (upper.includes('REFERRAL BONUS')) return false;
  if (upper.includes('TRANSFER')) return false;
  if (upper.includes('WITHDRAW')) return false;
  return true;
}

export function normalizeDepositStatus(
  status: WalletTransaction['status'] | string | undefined
): NormalizedDepositStatus {
  const upper = String(status || 'PENDING').toUpperCase();
  if (upper === 'APPROVED' || upper === 'SUCCESS' || upper === 'COMPLETED') {
    return 'completed';
  }
  if (upper === 'REJECTED' || upper === 'FAILED') {
    return 'rejected';
  }
  return 'pending';
}

export function formatDepositStatusLabel(status: NormalizedDepositStatus): string {
  if (status === 'completed') return 'Completed';
  if (status === 'rejected') return 'Rejected';
  return 'Pending';
}

export function extractDepositMethodLabel(typeLabel: string): string {
  const upper = (typeLabel || '').toUpperCase();
  if (upper.includes('KPAY') || upper.includes('KBZ')) return 'KBZPay';
  if (upper.includes('WAVEPAY') || upper.includes('WAVE')) return 'WavePay';
  if (upper.includes('USDT')) return 'USDT TRC20';
  if (upper.includes('BTC') || upper.includes('BITCOIN')) return 'Bitcoin (BTC)';
  if (upper.includes('BANK')) return 'Bank Transfer';
  const match = /\(([^)]+)\)/.exec(typeLabel || '');
  if (match && match[1]) {
    return sanitizeMemberNoticeText(match[1].trim());
  }
  return 'Real Deposit';
}

export function summarizeDepositTransactions(
  transactions: WalletTransaction[]
): DepositHistorySummary {
  const deposits = transactions
    .filter(isDepositTransaction)
    .slice()
    .sort((a, b) => (b.rawTime ?? 0) - (a.rawTime ?? 0));

  let pendingCount = 0;
  let completedCount = 0;
  let rejectedCount = 0;
  let totalCompletedUsd = 0;
  let totalPendingUsd = 0;

  for (const tx of deposits) {
    const normalized = normalizeDepositStatus(tx.status);
    const amount = Number(tx.amount || 0);
    if (normalized === 'completed') {
      completedCount += 1;
      totalCompletedUsd += amount;
    } else if (normalized === 'rejected') {
      rejectedCount += 1;
    } else {
      pendingCount += 1;
      totalPendingUsd += amount;
    }
  }

  return {
    totalCount: deposits.length,
    pendingCount,
    completedCount,
    rejectedCount,
    totalCompletedUsd: Math.round(totalCompletedUsd * 100) / 100,
    totalPendingUsd: Math.round(totalPendingUsd * 100) / 100,
    latestStatus: deposits.length > 0 ? normalizeDepositStatus(deposits[0].status) : null,
  };
}

export function filterDepositTransactions(
  transactions: WalletTransaction[],
  filter: DepositFilterStatus,
  searchQuery = ''
): WalletTransaction[] {
  const q = searchQuery.trim().toLowerCase();
  return transactions
    .filter(isDepositTransaction)
    .filter((tx) => {
      if (filter !== 'all' && normalizeDepositStatus(tx.status) !== filter) {
        return false;
      }
      if (!q) return true;
      const method = extractDepositMethodLabel(tx.type).toLowerCase();
      const target = (tx.target || '').toLowerCase();
      const status = formatDepositStatusLabel(normalizeDepositStatus(tx.status)).toLowerCase();
      return method.includes(q) || target.includes(q) || status.includes(q);
    })
    .slice()
    .sort((a, b) => (b.rawTime ?? 0) - (a.rawTime ?? 0));
}

function mapServerStatusToWalletStatus(status: string): WalletTransaction['status'] {
  const upper = String(status || 'PENDING').toUpperCase();
  if (upper === 'SUCCESS' || upper === 'APPROVED' || upper === 'COMPLETED') return 'SUCCESS';
  if (upper === 'FAILED' || upper === 'REJECTED') return 'FAILED';
  return 'PENDING';
}

export function deduplicateFirestoreAgainstSql(
  sqlEntries: WalletTransaction[],
  nonSqlEntries: WalletTransaction[]
): WalletTransaction[] {
  const sqlDepositAndWithdrawalSignatures = sqlEntries
    .filter((row) => isDepositTransaction(row) || row.type.toUpperCase().includes('WITHDRAWAL'))
    .map((row) => ({
      isDeposit: isDepositTransaction(row),
      amountCents: Math.round(row.amount * 100),
      targetNorm: (row.target || '').trim().toLowerCase(),
      rawTime: row.rawTime,
    }));

  const filtered = nonSqlEntries.filter((item) => {
    if (item.id.startsWith('sql-')) return false;
    const itemIsDeposit = isDepositTransaction(item);
    const itemIsWithdraw = item.type.toUpperCase().includes('WITHDRAWAL');
    if (!itemIsDeposit && !itemIsWithdraw) return true;

    const itemAmountCents = Math.round(Number(item.amount || 0) * 100);
    const itemTarget = (item.target || '').trim().toLowerCase();
    const matchesSql = sqlDepositAndWithdrawalSignatures.some(
      (sig) =>
        sig.isDeposit === itemIsDeposit &&
        sig.amountCents === itemAmountCents &&
        sig.targetNorm === itemTarget &&
        Math.abs(sig.rawTime - (item.rawTime ?? 0)) <= 5 * 60 * 1000
    );
    return !matchesSql;
  });

  const merged = [...sqlEntries, ...filtered];
  merged.sort((a, b) => (b.rawTime ?? 0) - (a.rawTime ?? 0));
  return merged;
}

export function mergeWalletTransactionsWithServerActivity(
  existing: WalletTransaction[],
  serverActivity: ServerWalletActivityRow[],
  activeUser: { uid: string; email: string }
): WalletTransaction[] {
  const allowedKinds = new Set(['deposit', 'withdrawal', 'transfer_in', 'transfer_out']);

  const serverRows: WalletTransaction[] = serverActivity
    .filter((row) => allowedKinds.has(row.requestKind))
    .map((row) => {
      const dt = new Date(row.createdAt || Date.now());
      return {
        id: `sql-${row.id}`,
        userId: activeUser.uid,
        userEmail: activeUser.email,
        type: row.typeLabel,
        amount: Number(row.amountUsd || 0),
        target: row.target,
        status: mapServerStatusToWalletStatus(row.status),
        rejectReason: row.rejectReason ?? null,
        timestamp: dt.toLocaleString(),
        rawTime: dt.getTime(),
      };
    });

  return deduplicateFirestoreAgainstSql(serverRows, existing);
}
