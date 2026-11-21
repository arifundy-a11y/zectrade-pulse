import type { CanonicalPlatformStats } from '../types';

export const DEFAULT_PLATFORM_STATS: CanonicalPlatformStats = {
  registeredMembers: 23909,
  membersCount: 23909,
  totalDeposits: 4285000,
  totalWithdrawals: 15240600,
  autoIncrementStats: false,
};

export function parseStatNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    // Reject truncated comma-formatted strings like "$42,8" or "42,85"
    if (trimmed.includes(',') && /,\d{1,2}(?:\D|$)/.test(trimmed)) {
      return fallback;
    }
    const cleaned = trimmed.replace(/[^0-9.-]/g, '');
    if (!cleaned) return fallback;
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.round(parsed);
    }
  }
  return fallback;
}

export function normalizePlatformStats(raw: unknown): CanonicalPlatformStats {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const registeredMembers = parseStatNumber(
    obj.registeredMembers ?? obj.membersCount,
    DEFAULT_PLATFORM_STATS.registeredMembers
  );
  const totalDeposits = parseStatNumber(
    obj.totalDeposits,
    DEFAULT_PLATFORM_STATS.totalDeposits
  );
  const totalWithdrawals = parseStatNumber(
    obj.totalWithdrawals,
    DEFAULT_PLATFORM_STATS.totalWithdrawals
  );
  const autoIncrementStats =
    typeof obj.autoIncrementStats === 'boolean'
      ? obj.autoIncrementStats
      : DEFAULT_PLATFORM_STATS.autoIncrementStats;

  return {
    registeredMembers,
    membersCount: registeredMembers,
    totalDeposits,
    totalWithdrawals,
    autoIncrementStats,
  };
}

export function easeOutExpo(t: number): number {
  if (!Number.isFinite(t) || t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.pow(2, -10 * t);
}

export function interpolateStatValue(from: number, to: number, rawProgress: number): number {
  const start = Number.isFinite(from) ? from : 0;
  const end = Number.isFinite(to) ? to : 0;
  if (rawProgress <= 0) return Math.round(start);
  if (rawProgress >= 1) return Math.round(end);
  const eased = easeOutExpo(rawProgress);
  return Math.round(start + (end - start) * eased);
}

export function formatStatDisplay(value: number, prefix = '', suffix = ''): string {
  const safe = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  return `${prefix}${safe.toLocaleString('en-US')}${suffix}`;
}

export function applyStatQuickAdjust(current: number, delta: number, min = 0): number {
  const safeCurrent = Number.isFinite(current) ? current : 0;
  const safeDelta = Number.isFinite(delta) ? delta : 0;
  return Math.max(min, Math.round(safeCurrent + safeDelta));
}

export type PlatformActivityEvent =
  | { type: 'registration' }
  | { type: 'deposit'; amount: number }
  | { type: 'withdrawal'; amount: number };

export function computeStatsWithActivity(
  current: CanonicalPlatformStats,
  event: PlatformActivityEvent
): CanonicalPlatformStats | null {
  if (!current.autoIncrementStats) return null;

  if (event.type === 'registration') {
    const nextMembers = current.registeredMembers + 1;
    return {
      ...current,
      registeredMembers: nextMembers,
      membersCount: nextMembers,
    };
  }

  const delta = Number.isFinite(event.amount) && event.amount > 0 ? Math.round(event.amount) : 0;
  if (delta <= 0) return null;

  if (event.type === 'deposit') {
    return {
      ...current,
      totalDeposits: current.totalDeposits + delta,
    };
  }

  return {
    ...current,
    totalWithdrawals: current.totalWithdrawals + delta,
  };
}
