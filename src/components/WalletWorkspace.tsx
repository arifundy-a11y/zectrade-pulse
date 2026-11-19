import React, { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpRight,
  Camera,
  Check,
  CheckCircle2,
  ChevronUp,
  Clock,
  Copy,
  Gift,
  IdCard,
  KeyRound,
  LayoutList,
  Link2,
  LogOut,
  PlusCircle,
  RefreshCw,
  Search,
  Send,
  Settings,
  XCircle,
} from 'lucide-react';
import type {
  AccountMode,
  MarketQuote,
  MarketSymbol,
  UserProfile,
  WalletTransaction,
} from '../types';
import { evaluateWithdrawalEligibility, sanitizeMemberNoticeText } from '../utils/tradingEngine';
import { formatChartPrice } from '../utils/chartEngine';
import { getAvatarInitials } from '../utils/avatarHelper';
import {
  extractDepositMethodLabel,
  filterDpWdTransactions,
  formatDepositStatusLabel,
  isDepositTransaction,
  normalizeDepositStatus,
  summarizeDpWdTransactions,
  summarizeReferralTransactions,
  type DepositFilterStatus,
  type DpWdKindFilter,
} from '../utils/depositHistory';

type WalletTab = 'overview' | 'dp_wd_history' | 'invitation';

interface WalletWorkspaceProps {
  user: UserProfile;
  accountMode: AccountMode;
  onSetAccountMode: (mode: AccountMode) => void;
  quotes: MarketQuote[];
  transactions: WalletTransaction[];
  csrTelegramLink: string;
  onRefresh: () => void;
  onResetDemo: () => void;
  onCopyUid: () => void;
  onCopyReferral: () => void;
  onCopyInviteLink?: () => void;
  onOpenProfileEditModal: () => void;
  onOpenPinModal: () => void;
  onOpenSwapModal: (symbol?: MarketSymbol, dir?: 'usdtToCoin' | 'coinToUsdt') => void;
  onOpenDepositModal: () => void;
  onOpenWithdrawModal: () => void;
  onOpenTransferModal: () => void;
  onOpenWalletHistoryModal: () => void;
  onOpenStaffModal: () => void;
  onLogout: () => void;
}

export const WalletWorkspace: React.FC<WalletWorkspaceProps> = ({
  user,
  accountMode,
  onSetAccountMode,
  quotes,
  transactions,
  csrTelegramLink,
  onRefresh,
  onResetDemo,
  onCopyUid,
  onCopyReferral,
  onCopyInviteLink,
  onOpenProfileEditModal,
  onOpenPinModal,
  onOpenSwapModal,
  onOpenDepositModal,
  onOpenWithdrawModal,
  onOpenTransferModal,
  onOpenWalletHistoryModal,
  onOpenStaffModal,
  onLogout,
}) => {
  const [activeTab, setActiveTab] = useState<WalletTab>('overview');
  const [kindFilter, setKindFilter] = useState<DpWdKindFilter>('all');
  const [statusFilter, setStatusFilter] = useState<DepositFilterStatus>('all');
  const [dpWdSearch, setDpWdSearch] = useState('');
  const [showAllDpWd, setShowAllDpWd] = useState(false);
  const [copiedCodeFeedback, setCopiedCodeFeedback] = useState(false);
  const [copiedLinkFeedback, setCopiedLinkFeedback] = useState(false);

  const DP_WD_PREVIEW_LIMIT = 5;

  const isStaff =
    user.role === 'admin' ||
    user.role === 'staff' ||
    user.role === 'caiwu' ||
    user.role === 'chukuan';
  const displayedBalance = accountMode === 'demo' ? user.demoBalance : user.realBalance;
  const withdrawalEligibility = evaluateWithdrawalEligibility(user);
  const holdingsEntries = Object.entries(user.spotHoldings || {}) as Array<
    [MarketSymbol, { units: number; avgPrice: number }]
  >;
  const initials = getAvatarInitials(user.fullName || user.username, user.email);

  const dpWdSummary = useMemo(
    () => summarizeDpWdTransactions(transactions),
    [transactions]
  );

  const filteredDpWd = useMemo(
    () => filterDpWdTransactions(transactions, kindFilter, statusFilter, dpWdSearch),
    [transactions, kindFilter, statusFilter, dpWdSearch]
  );

  const visibleDpWd = useMemo(
    () => (showAllDpWd ? filteredDpWd : filteredDpWd.slice(0, DP_WD_PREVIEW_LIMIT)),
    [filteredDpWd, showAllDpWd]
  );
  const hasMoreDpWd = filteredDpWd.length > DP_WD_PREVIEW_LIMIT;

  const referralSummary = useMemo(
    () => summarizeReferralTransactions(transactions),
    [transactions]
  );

  const inviteLink =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?ref=${encodeURIComponent(user.uid)}`
      : `/?ref=${encodeURIComponent(user.uid)}`;

  const handleCopyInviteCode = () => {
    onCopyReferral();
    setCopiedCodeFeedback(true);
    window.setTimeout(() => setCopiedCodeFeedback(false), 1800);
  };

  const handleCopyInviteLink = () => {
    if (onCopyInviteLink) {
      onCopyInviteLink();
    } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(inviteLink);
    }
    setCopiedLinkFeedback(true);
    window.setTimeout(() => setCopiedLinkFeedback(false), 1800);
  };

  return (
    <div className="space-y-4">
      {/* Account Mode Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-xs sm:text-sm font-bold text-white">
          Active Mode:{' '}
          <span className={accountMode === 'demo' ? 'text-amber-400' : 'text-blue-400'}>
            {accountMode.toUpperCase()} ACCOUNT
          </span>
        </p>
        <div className="grid grid-cols-2 sm:flex bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs font-semibold">
          <button
            type="button"
            onClick={() => onSetAccountMode('demo')}
            className={`px-3 py-1.5 rounded-md transition-colors whitespace-nowrap shrink-0 ${
              accountMode === 'demo' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            Demo Account
          </button>
          <button
            type="button"
            onClick={() => onSetAccountMode('real')}
            className={`px-3 py-1.5 rounded-md transition-colors whitespace-nowrap shrink-0 ${
              accountMode === 'real' ? 'bg-blue-600 text-white font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            Real Account
          </button>
        </div>
      </div>

      {/* 3-Tab Wallet Workspace Navigation Bar */}
      <div
        role="tablist"
        aria-label="Wallet workspace sections"
        className="grid grid-cols-3 sm:inline-flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-xl w-full sm:w-auto"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'overview'}
          data-testid="wallet-tab-overview"
          onClick={() => setActiveTab('overview')}
          className={`px-2 sm:px-3.5 py-2 rounded-lg text-[11px] sm:text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 ${
            activeTab === 'overview'
              ? 'bg-blue-600 text-white font-bold shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
          }`}
        >
          <span className="sm:hidden">Overview</span>
          <span className="hidden sm:inline">Wallet Overview</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'dp_wd_history'}
          data-testid="wallet-tab-dp-wd-history"
          onClick={() => setActiveTab('dp_wd_history')}
          className={`px-2 sm:px-3.5 py-2 rounded-lg text-[11px] sm:text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 ${
            activeTab === 'dp_wd_history'
              ? 'bg-emerald-600 text-white font-bold shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
          }`}
        >
          <ArrowDownToLine className="hidden sm:inline-block w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>DP &amp; WD History</span>
          {dpWdSummary.totalCount > 0 && (
            <span
              className={`hidden sm:inline font-mono text-[11px] tabular-nums ${
                activeTab === 'dp_wd_history' ? 'text-emerald-100' : 'text-slate-400'
              }`}
            >
              · {dpWdSummary.totalCount}
            </span>
          )}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'invitation'}
          data-testid="wallet-tab-invitation"
          onClick={() => setActiveTab('invitation')}
          className={`px-2 sm:px-3.5 py-2 rounded-lg text-[11px] sm:text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 ${
            activeTab === 'invitation'
              ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
          }`}
        >
          <Gift className="hidden sm:inline-block w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Invitation Code</span>
        </button>
      </div>

      {/* TAB 1: WALLET OVERVIEW */}
      {activeTab === 'overview' && (
        <>
          {/* Profile & Wallet Summary */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
              {/* Identity & Quick Account Summary */}
              <div className="lg:col-span-7 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-3 min-w-0">
                    <button
                      type="button"
                      onClick={onOpenProfileEditModal}
                      aria-label="Change profile picture and view member details"
                      data-testid="wallet-avatar-btn"
                      className="relative w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-slate-800 border border-slate-700 hover:border-amber-400/70 overflow-hidden shrink-0 flex items-center justify-center group transition-colors"
                    >
                      {user.avatarUrl ? (
                        <img
                          src={user.avatarUrl}
                          alt={user.username}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-sm sm:text-base font-extrabold text-amber-400 tracking-wide">
                          {initials}
                        </span>
                      )}
                      <span className="absolute inset-0 bg-slate-950/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                        <Camera className="w-4 h-4 text-white" aria-hidden="true" />
                      </span>
                    </button>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm sm:text-lg font-bold text-white truncate">
                          {user.username}
                        </h2>
                        <span className="text-[10px] sm:text-xs font-mono text-emerald-400">
                          {isStaff ? `${user.role.toUpperCase()} ACCOUNT` : 'Level 2 Verified'}
                        </span>
                      </div>
                      <p className="text-[11px] sm:text-xs text-slate-400 truncate">{user.email}</p>
                      <div className="flex items-center gap-2 mt-1 text-[10px] sm:text-xs font-mono text-slate-400">
                        <span className="truncate max-w-[190px] sm:max-w-none text-amber-400">
                          UID: {user.uid}
                        </span>
                        <button
                          type="button"
                          aria-label="Copy User ID"
                          onClick={onCopyUid}
                          className="p-1 text-slate-400 hover:text-white"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Single Compact Icon Button for Hidden Member Info & Withdraw Account + Support Link */}
                  <div className="flex items-center gap-2.5 shrink-0">
                    <button
                      type="button"
                      onClick={onOpenProfileEditModal}
                      data-testid="wallet-edit-profile-btn"
                      aria-label="View and edit member information and withdraw account"
                      title="Member Info & Withdraw Account"
                      className="w-10 h-10 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-amber-400/60 text-amber-400 flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                    >
                      <IdCard className="w-4 h-4" aria-hidden="true" />
                    </button>
                    <a
                      href={csrTelegramLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-semibold text-sky-400 hover:underline shrink-0 whitespace-nowrap"
                    >
                      CSR Support
                    </a>
                  </div>
                </div>

                {/* Hairline Account Quick Strip */}
                <div className="grid grid-cols-2 divide-x divide-slate-800 bg-slate-950 border border-slate-800 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setActiveTab('dp_wd_history')}
                    className="p-3 text-left hover:bg-slate-900/60 transition-colors rounded-l-xl"
                  >
                    <span className="text-[10px] sm:text-[11px] text-slate-400 block">
                      DP &amp; WD Activity
                    </span>
                    <span className="text-xs sm:text-sm font-bold text-white font-mono tabular-nums mt-0.5 block">
                      {dpWdSummary.totalCount} Requests
                      {dpWdSummary.pendingCount > 0 && (
                        <span className="text-amber-400 font-normal">
                          {' '}
                          · {dpWdSummary.pendingCount} pending
                        </span>
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('invitation')}
                    className="p-3 text-left hover:bg-slate-900/60 transition-colors rounded-r-xl"
                  >
                    <span className="text-[10px] sm:text-[11px] text-slate-400 block">
                      Invitation Rewards
                    </span>
                    <span className="text-xs sm:text-sm font-bold text-amber-400 font-mono tabular-nums mt-0.5 block">
                      ${referralSummary.totalEarnedUsd.toFixed(2)} Earned
                      <span className="text-slate-400 font-normal"> · View Code</span>
                    </span>
                  </button>
                </div>
              </div>

              {/* Balance & Wallet Controls */}
              <div className="lg:col-span-5 bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-3">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>
                    {accountMode === 'demo' ? 'Demo Balance (USDT)' : 'Real Balance (USDT)'}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={onRefresh}
                      className="text-blue-400 hover:text-blue-300 flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" aria-hidden="true" />
                      <span>Refresh</span>
                    </button>
                    {accountMode === 'demo' && (
                      <button
                        type="button"
                        onClick={onResetDemo}
                        className="text-amber-400 hover:underline"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>

                <p className="text-xl sm:text-2xl font-extrabold text-amber-400 font-mono tabular-nums">
                  $
                  {displayedBalance.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>

                {accountMode === 'real' && (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenSwapModal()}
                      className="py-2 min-h-[38px] rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] sm:text-xs font-semibold flex items-center justify-center gap-1"
                    >
                      <ArrowLeftRight className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Swap Coin</span>
                    </button>
                    <button
                      type="button"
                      onClick={onOpenDepositModal}
                      className="py-2 min-h-[38px] rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] sm:text-xs font-semibold flex items-center justify-center gap-1"
                    >
                      <PlusCircle className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Deposit</span>
                    </button>
                    <button
                      type="button"
                      onClick={onOpenWithdrawModal}
                      className="py-2 min-h-[38px] rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] sm:text-xs font-semibold flex items-center justify-center gap-1"
                    >
                      <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Withdraw</span>
                    </button>
                    <button
                      type="button"
                      onClick={onOpenTransferModal}
                      className="py-2 min-h-[38px] rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-[11px] sm:text-xs font-semibold flex items-center justify-center gap-1"
                    >
                      <Send className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Transfer</span>
                    </button>
                  </div>
                )}

                {accountMode === 'real' && (
                  <div
                    data-testid="wallet-withdraw-eligibility"
                    className={`rounded-lg px-2.5 py-2 text-[10px] sm:text-[11px] border flex items-center justify-between gap-2 ${
                      withdrawalEligibility.allowed
                        ? 'bg-emerald-950/35 border-emerald-500/30 text-emerald-300'
                        : 'bg-amber-950/35 border-amber-500/30 text-amber-300'
                    }`}
                  >
                    <span>
                      {withdrawalEligibility.allowed
                        ? 'Withdrawal Eligible: Deposit & trade verification satisfied.'
                        : withdrawalEligibility.reason}
                    </span>
                    {withdrawalEligibility.lockType === 'no_deposit' && (
                      <button
                        type="button"
                        onClick={onOpenDepositModal}
                        className="shrink-0 px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold transition-colors"
                      >
                        Deposit
                      </button>
                    )}
                  </div>
                )}

                <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px]">
                  <button
                    type="button"
                    onClick={onOpenWalletHistoryModal}
                    className="text-indigo-400 hover:underline flex items-center gap-1 font-semibold"
                  >
                    <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Wallet History (90d)</span>
                  </button>
                  {isStaff && (
                    <button
                      type="button"
                      onClick={onOpenStaffModal}
                      className="text-purple-400 hover:underline flex items-center gap-1 font-semibold"
                    >
                      <Settings className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Staff Panel</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Footer Security Row */}
            <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] sm:text-xs">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={onOpenPinModal}
                  className="text-amber-400 hover:underline flex items-center gap-1 font-medium"
                >
                  <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Security PIN</span>
                </button>
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="text-slate-400 hover:text-red-400 flex items-center gap-1 font-medium"
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>

          {/* Spot Portfolio Holdings (Real Mode) */}
          {accountMode === 'real' && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                <h3 className="text-xs sm:text-sm font-bold text-white">Spot Portfolio Holdings</h3>
                <button
                  type="button"
                  onClick={() => onOpenSwapModal()}
                  className="text-[11px] sm:text-xs font-semibold text-indigo-400 hover:underline"
                >
                  Swap USDT / Coins
                </button>
              </div>
              {holdingsEntries.length === 0 ? (
                <p className="py-5 text-center text-xs text-slate-500">
                  No spot holdings yet. Use Swap Coin to exchange USDT into BTC, ETH, SOL, BNB, XRP,
                  GOLD, or Oil.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {holdingsEntries.map(([sym, holding]) => {
                    const quote = quotes.find((q) => q.symbol === sym);
                    const livePrice = quote ? quote.price : holding.avgPrice;
                    const value = holding.units * livePrice;
                    const cost = holding.units * holding.avgPrice;
                    const pnlPct = cost > 0 ? ((value - cost) / cost) * 100 : 0;
                    const isPos = pnlPct >= 0;

                    return (
                      <div
                        key={sym}
                        className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2 font-mono"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <strong className="text-white">{sym}</strong>
                          <span
                            className={
                              isPos ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'
                            }
                          >
                            {isPos ? '+' : ''}
                            {pnlPct.toFixed(2)}%
                          </span>
                        </div>
                        <div className="text-[11px] space-y-0.5 text-slate-400 tabular-nums">
                          <div className="flex justify-between">
                            <span>Units</span>
                            <span className="text-white">{holding.units.toFixed(6)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Avg Entry</span>
                            <span>${formatChartPrice(holding.avgPrice)}</span>
                          </div>
                          <div className="flex justify-between border-t border-slate-800 pt-1">
                            <span>Value</span>
                            <span className="text-amber-400 font-bold">${value.toFixed(2)}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onOpenSwapModal(sym, 'coinToUsdt')}
                          className="w-full py-1.5 rounded-lg bg-slate-900 hover:bg-indigo-600 border border-slate-800 text-indigo-300 hover:text-white text-[11px] font-semibold transition-colors"
                        >
                          Swap to USDT
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* TAB 2: DP & WD HISTORY */}
      {activeTab === 'dp_wd_history' && (
        <section
          data-testid="wallet-dp-wd-history-panel"
          aria-label="Deposit and Withdrawal History"
          className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4"
        >
          {/* Header & Primary Actions */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-white">
                Deposit &amp; Withdrawal History
              </h2>
              <p className="text-[11px] sm:text-xs text-slate-400">
                Track verification and settlement status across all Real Account deposits and withdrawals.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onRefresh}
                className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Refresh</span>
              </button>
              <button
                type="button"
                onClick={onOpenDepositModal}
                data-testid="dpwd-new-deposit-btn"
                className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
              >
                <PlusCircle className="w-3.5 h-3.5" aria-hidden="true" />
                <span>New Deposit</span>
              </button>
              <button
                type="button"
                onClick={onOpenWithdrawModal}
                data-testid="dpwd-new-withdraw-btn"
                className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
              >
                <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Withdraw</span>
              </button>
              {hasMoreDpWd && (
                <button
                  type="button"
                  onClick={() => setShowAllDpWd((prev) => !prev)}
                  data-testid="dpwd-header-view-all-btn"
                  aria-expanded={showAllDpWd}
                  title={showAllDpWd ? 'Show latest 5 transactions' : `View all ${filteredDpWd.length} transactions`}
                  className="px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-amber-300 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                >
                  {showAllDpWd ? (
                    <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                  ) : (
                    <LayoutList className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  <span>{showAllDpWd ? 'Top 5' : `All (${filteredDpWd.length})`}</span>
                </button>
              )}
            </div>
          </div>

          {/* 3-Cell Hairline-Divided Summary Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-800 bg-slate-950 border border-slate-800 rounded-xl">
            <div className="p-3 sm:p-3.5">
              <p className="text-[11px] text-slate-400">Completed Deposits</p>
              <p className="text-base sm:text-lg font-extrabold text-emerald-400 font-mono tabular-nums mt-0.5">
                $
                {dpWdSummary.totalCompletedDepositsUsd.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
              <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                {dpWdSummary.depositCount} deposit requests
              </p>
            </div>
            <div className="p-3 sm:p-3.5">
              <p className="text-[11px] text-slate-400">Completed Withdrawals</p>
              <p className="text-base sm:text-lg font-extrabold text-blue-400 font-mono tabular-nums mt-0.5">
                $
                {dpWdSummary.totalCompletedWithdrawalsUsd.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
              <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                {dpWdSummary.withdrawalCount} withdrawal requests
              </p>
            </div>
            <div className="p-3 sm:p-3.5">
              <p className="text-[11px] text-slate-400">Pending Review</p>
              <p className="text-base sm:text-lg font-extrabold text-amber-400 font-mono tabular-nums mt-0.5">
                $
                {dpWdSummary.totalPendingUsd.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
              <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                {dpWdSummary.pendingCount} pending · {dpWdSummary.rejectedCount} rejected
              </p>
            </div>
          </div>

          {/* Type + Status Filters & Search */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              {/* Kind Switcher */}
              <div
                role="group"
                aria-label="Filter by transaction kind"
                className="grid grid-cols-3 sm:inline-flex bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px] font-semibold"
              >
                {(
                  [
                    { id: 'all', label: `All (${dpWdSummary.totalCount})` },
                    { id: 'deposit', label: `Deposits (${dpWdSummary.depositCount})` },
                    { id: 'withdrawal', label: `Withdrawals (${dpWdSummary.withdrawalCount})` },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    data-testid={`dpwd-kind-${item.id}`}
                    onClick={() => setKindFilter(item.id)}
                    className={`px-2.5 py-1.5 rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      kindFilter === item.id
                        ? 'bg-emerald-600 text-white font-bold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {/* Status Switcher */}
              <div
                role="group"
                aria-label="Filter by request status"
                className="grid grid-cols-4 sm:inline-flex bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px] font-semibold"
              >
                {(
                  [
                    { id: 'all', label: 'All' },
                    { id: 'pending', label: 'Pending' },
                    { id: 'completed', label: 'Completed' },
                    { id: 'rejected', label: 'Rejected' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    data-testid={`dpwd-status-${item.id}`}
                    onClick={() => setStatusFilter(item.id)}
                    className={`px-2.5 py-1.5 rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      statusFilter === item.id
                        ? 'bg-slate-800 text-white font-bold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative w-full lg:w-64">
              <Search
                className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label="Search deposit and withdrawal transactions"
                data-testid="dpwd-history-search"
                value={dpWdSearch}
                onChange={(e) => setDpWdSearch(e.target.value)}
                placeholder="Search method, account, or Tx..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Transactions Table / Mobile List / Empty State */}
          {filteredDpWd.length === 0 ? (
            <div
              data-testid="dpwd-history-empty"
              className="bg-slate-950 border border-slate-800 rounded-xl py-10 px-4 text-center space-y-2.5"
            >
              <p className="text-xs sm:text-sm font-semibold text-slate-300">
                {dpWdSummary.totalCount === 0
                  ? 'No deposit or withdrawal transactions recorded yet.'
                  : 'No transactions match the selected filters.'}
              </p>
              <p className="text-[11px] text-slate-500 max-w-md mx-auto">
                {dpWdSummary.totalCount === 0
                  ? 'Submit a Real Account deposit via KBZPay, WavePay, USDT TRC20, or Bitcoin to fund your wallet and unlock withdrawals.'
                  : 'Try switching transaction type or status filters, or clear your search query.'}
              </p>
              {dpWdSummary.totalCount === 0 ? (
                <button
                  type="button"
                  onClick={onOpenDepositModal}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors"
                >
                  <PlusCircle className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Make First Deposit</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setKindFilter('all');
                    setStatusFilter('all');
                    setDpWdSearch('');
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors"
                >
                  Reset Filters
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto bg-slate-950 border border-slate-800 rounded-xl">
                <table className="w-full text-left text-xs tabular-nums">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
                      <th className="py-2.5 px-3.5 font-semibold">Type</th>
                      <th className="py-2.5 px-3.5 font-semibold">Method</th>
                      <th className="py-2.5 px-3.5 font-semibold">Reference / Account</th>
                      <th className="py-2.5 px-3.5 font-semibold text-right">Amount (USD)</th>
                      <th className="py-2.5 px-3.5 font-semibold">Status</th>
                      <th className="py-2.5 px-3.5 font-semibold text-right">Submitted</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {visibleDpWd.map((tx) => {
                      const isDeposit = isDepositTransaction(tx);
                      const normStatus = normalizeDepositStatus(tx.status);
                      const statusLabel = formatDepositStatusLabel(normStatus);
                      const methodLabel = extractDepositMethodLabel(tx.type);
                      return (
                        <tr
                          key={tx.id}
                          data-testid={`dpwd-row-${tx.id}`}
                          className="hover:bg-slate-900/60 transition-colors"
                        >
                          <td className="py-2.5 px-3.5 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-1.5 font-semibold ${
                                isDeposit ? 'text-emerald-400' : 'text-blue-400'
                              }`}
                            >
                              {isDeposit ? (
                                <ArrowDownLeft className="w-3.5 h-3.5" aria-hidden="true" />
                              ) : (
                                <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                              )}
                              <span>{isDeposit ? 'Deposit' : 'Withdrawal'}</span>
                            </span>
                          </td>
                          <td className="py-2.5 px-3.5 font-semibold text-white whitespace-nowrap">
                            {methodLabel}
                          </td>
                          <td className="py-2.5 px-3.5 text-slate-300 font-mono text-[11px]">
                            <span>{sanitizeMemberNoticeText(tx.target)}</span>
                            {tx.rejectReason && (
                              <span className="block text-[10px] text-red-400 mt-0.5 font-sans">
                                Reason: {sanitizeMemberNoticeText(tx.rejectReason)}
                              </span>
                            )}
                          </td>
                          <td
                            className={`py-2.5 px-3.5 text-right font-mono font-bold whitespace-nowrap ${
                              isDeposit ? 'text-emerald-400' : 'text-amber-400'
                            }`}
                          >
                            {isDeposit ? '+' : '-'}${Number(tx.amount || 0).toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3.5 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-1.5 font-semibold ${
                                normStatus === 'completed'
                                  ? 'text-emerald-400'
                                  : normStatus === 'rejected'
                                  ? 'text-red-400'
                                  : 'text-amber-400'
                              }`}
                            >
                              {normStatus === 'completed' ? (
                                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                              ) : normStatus === 'rejected' ? (
                                <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                              ) : (
                                <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                              )}
                              <span>{statusLabel}</span>
                            </span>
                          </td>
                          <td className="py-2.5 px-3.5 text-right font-mono text-[11px] text-slate-400 whitespace-nowrap">
                            {tx.timestamp}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card Rows */}
              <div className="md:hidden space-y-2">
                {visibleDpWd.map((tx) => {
                  const isDeposit = isDepositTransaction(tx);
                  const normStatus = normalizeDepositStatus(tx.status);
                  const statusLabel = formatDepositStatusLabel(normStatus);
                  const methodLabel = extractDepositMethodLabel(tx.type);
                  return (
                    <div
                      key={tx.id}
                      className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className={`inline-flex items-center gap-1 text-[11px] font-bold shrink-0 ${
                              isDeposit ? 'text-emerald-400' : 'text-blue-400'
                            }`}
                          >
                            {isDeposit ? (
                              <ArrowDownLeft className="w-3.5 h-3.5" aria-hidden="true" />
                            ) : (
                              <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                            )}
                            <span>{isDeposit ? 'Deposit' : 'Withdrawal'}</span>
                          </span>
                          <span className="text-slate-600">·</span>
                          <strong className="text-xs text-white truncate">{methodLabel}</strong>
                        </div>
                        <span
                          className={`text-sm font-extrabold font-mono tabular-nums shrink-0 ${
                            isDeposit ? 'text-emerald-400' : 'text-amber-400'
                          }`}
                        >
                          {isDeposit ? '+' : '-'}${Number(tx.amount || 0).toFixed(2)}
                        </span>
                      </div>
                      <p className="text-[11px] font-mono text-slate-300 break-all">
                        {sanitizeMemberNoticeText(tx.target)}
                      </p>
                      {tx.rejectReason && (
                        <p className="text-[10px] text-red-400 break-words">
                          Reason: {sanitizeMemberNoticeText(tx.rejectReason)}
                        </p>
                      )}
                      <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-[11px]">
                        <span
                          className={`inline-flex items-center gap-1 font-semibold ${
                            normStatus === 'completed'
                              ? 'text-emerald-400'
                              : normStatus === 'rejected'
                              ? 'text-red-400'
                              : 'text-amber-400'
                          }`}
                        >
                          {normStatus === 'completed' ? (
                            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                          ) : normStatus === 'rejected' ? (
                            <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                          ) : (
                            <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                          )}
                          <span>{statusLabel}</span>
                        </span>
                        <span className="font-mono text-[10px] text-slate-400">{tx.timestamp}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* View All / Collapse Toggle Row */}
              {hasMoreDpWd && (
                <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-slate-400">
                  <span className="font-mono tabular-nums">
                    Showing {visibleDpWd.length} of {filteredDpWd.length}
                  </span>
                  <button
                    type="button"
                    data-testid="dpwd-view-all-btn"
                    aria-expanded={showAllDpWd}
                    onClick={() => setShowAllDpWd((prev) => !prev)}
                    className="px-3 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-amber-300 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                  >
                    {showAllDpWd ? (
                      <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                    ) : (
                      <LayoutList className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    <span>{showAllDpWd ? 'Show Top 5' : `View All (${filteredDpWd.length})`}</span>
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* TAB 3: INVITATION CODE */}
      {activeTab === 'invitation' && (
        <section
          data-testid="wallet-invitation-panel"
          aria-label="Invitation Code and Referral Rewards"
          className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-white">
                Invitation Code &amp; Referral Program
              </h2>
              <p className="text-[11px] sm:text-xs text-slate-400">
                Share your invitation code or direct link to earn Real Account rewards when new traders join.
              </p>
            </div>
            <span className="text-[11px] font-mono text-amber-400 shrink-0">
              $1.00 Sign-Up + 2% 1st Deposit
            </span>
          </div>

          {/* Code & Share Box */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="text-[11px] font-semibold text-slate-400">
                Your Personal Invitation Code
              </p>
              <p
                data-testid="invitation-code-value"
                className="text-sm sm:text-base font-extrabold font-mono text-amber-400 break-all select-all"
              >
                {user.uid}
              </p>
              <p className="text-[10px] sm:text-[11px] font-mono text-slate-500 truncate">
                {inviteLink}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                data-testid="invitation-copy-code-btn"
                onClick={handleCopyInviteCode}
                className="px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
              >
                {copiedCodeFeedback ? (
                  <Check className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{copiedCodeFeedback ? 'Code Copied' : 'Copy Code'}</span>
              </button>
              <button
                type="button"
                data-testid="invitation-copy-link-btn"
                onClick={handleCopyInviteLink}
                className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
              >
                {copiedLinkFeedback ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                ) : (
                  <Link2 className="w-3.5 h-3.5 text-blue-400" aria-hidden="true" />
                )}
                <span>{copiedLinkFeedback ? 'Link Copied' : 'Copy Invite Link'}</span>
              </button>
            </div>
          </div>

          {/* 3-Cell Reward Schedule & Earnings Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-800 bg-slate-950 border border-slate-800 rounded-xl">
            <div className="p-3 sm:p-3.5">
              <p className="text-[11px] text-slate-400">Sign-Up Bonus</p>
              <p className="text-base sm:text-lg font-extrabold text-amber-400 font-mono tabular-nums mt-0.5">
                $1.00 USD
              </p>
              <p className="text-[11px] text-slate-500">Per verified registration</p>
            </div>
            <div className="p-3 sm:p-3.5">
              <p className="text-[11px] text-slate-400">First Deposit Commission</p>
              <p className="text-base sm:text-lg font-extrabold text-emerald-400 font-mono tabular-nums mt-0.5">
                2.00%
              </p>
              <p className="text-[11px] text-slate-500">On invitee&apos;s first approved deposit</p>
            </div>
            <div className="p-3 sm:p-3.5">
              <p className="text-[11px] text-slate-400">Your Earned Rewards</p>
              <p className="text-base sm:text-lg font-extrabold text-white font-mono tabular-nums mt-0.5">
                $
                {referralSummary.totalEarnedUsd.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
              <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                {referralSummary.count} credited payouts
              </p>
            </div>
          </div>

          {/* 3-Step Workflow Guide */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-1">
              <p className="text-xs font-bold text-white font-mono">01. Share Code or Link</p>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Send your invitation code or personal referral URL to friends registering on Zectrade Pulse.
              </p>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-1">
              <p className="text-xs font-bold text-white font-mono">02. Friend Registers</p>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                When they register using your code, your Real Account automatically receives a $1.00 bonus.
              </p>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-1">
              <p className="text-xs font-bold text-white font-mono">03. First Deposit Payout</p>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Receive an automatic 2.00% USDT reward when your invited member&apos;s first deposit is approved.
              </p>
            </div>
          </div>

          {/* Referral Reward Payouts Log */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-200">Referral Reward History</h3>
              <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                {referralSummary.count} entries
              </span>
            </div>
            {referralSummary.items.length === 0 ? (
              <div className="bg-slate-950 border border-slate-800 rounded-xl py-6 px-4 text-center">
                <p className="text-xs text-slate-400">
                  No referral rewards credited yet. Copy your invitation code above to invite traders.
                </p>
              </div>
            ) : (
              <div className="bg-slate-950 border border-slate-800 rounded-xl divide-y divide-slate-800/80">
                {referralSummary.items.map((tx) => (
                  <div
                    key={tx.id}
                    className="p-3 flex items-center justify-between gap-2 text-xs tabular-nums"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-white truncate">{tx.type}</p>
                      <p className="text-[11px] font-mono text-slate-400 truncate">
                        {sanitizeMemberNoticeText(tx.target)} · {tx.timestamp}
                      </p>
                    </div>
                    <span className="font-mono font-bold text-emerald-400 shrink-0">
                      +${Number(tx.amount || 0).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

    </div>
  );
};
