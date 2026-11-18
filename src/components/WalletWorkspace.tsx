import React, { useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpRight,
  Camera,
  CheckCircle2,
  Clock,
  Copy,
  IdCard,
  KeyRound,
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
  filterDepositTransactions,
  formatDepositStatusLabel,
  normalizeDepositStatus,
  summarizeDepositTransactions,
  type DepositFilterStatus,
} from '../utils/depositHistory';

type WalletTab = 'overview' | 'deposit_history';

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
  const [depositFilter, setDepositFilter] = useState<DepositFilterStatus>('all');
  const [depositSearch, setDepositSearch] = useState('');

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

  const depositSummary = useMemo(
    () => summarizeDepositTransactions(transactions),
    [transactions]
  );

  const filteredDeposits = useMemo(
    () => filterDepositTransactions(transactions, depositFilter, depositSearch),
    [transactions, depositFilter, depositSearch]
  );

  return (
    <div className="space-y-4">
      {/* Account Mode Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-xs sm:text-sm font-bold text-white">
            Active Mode:{' '}
            <span className={accountMode === 'demo' ? 'text-amber-400' : 'text-blue-400'}>
              {accountMode.toUpperCase()} ACCOUNT
            </span>
          </p>
          <p className="text-[11px] text-slate-400">
            {accountMode === 'demo'
              ? 'Practice strategies with resettable virtual funds.'
              : 'Live settlement mode with spot holdings, deposits, and withdrawals.'}
          </p>
        </div>
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

      {/* Wallet Workspace Navigation Tabs */}
      <div
        role="tablist"
        aria-label="Wallet workspace sections"
        className="inline-flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-xl"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'overview'}
          data-testid="wallet-tab-overview"
          onClick={() => setActiveTab('overview')}
          className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'overview'
              ? 'bg-blue-600 text-white font-bold shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
          }`}
        >
          Wallet Overview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'deposit_history'}
          data-testid="wallet-tab-deposit-history"
          onClick={() => setActiveTab('deposit_history')}
          className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
            activeTab === 'deposit_history'
              ? 'bg-emerald-600 text-white font-bold shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
          }`}
        >
          <ArrowDownToLine className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Deposit History</span>
          {depositSummary.totalCount > 0 && (
            <span
              className={`font-mono text-[11px] tabular-nums ${
                activeTab === 'deposit_history' ? 'text-emerald-100' : 'text-slate-400'
              }`}
            >
              · {depositSummary.totalCount}
            </span>
          )}
        </button>
      </div>

      {activeTab === 'overview' ? (
        <>
          {/* Profile & Wallet Summary */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
              {/* Identity & Invitation */}
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

                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] sm:text-xs font-semibold text-amber-400">
                      Invitation Program · $1 Sign-Up + 2% First Deposit
                    </p>
                    <p className="text-[10px] sm:text-xs font-mono text-slate-300 truncate">
                      {user.uid}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onCopyReferral}
                    className="px-2.5 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-[10px] sm:text-xs font-semibold shrink-0 whitespace-nowrap"
                  >
                    Copy Code
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
      ) : (
        /* DEPOSIT HISTORY TAB */
        <section
          data-testid="wallet-deposit-history-panel"
          aria-label="Deposit History"
          className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4"
        >
          {/* Header & Primary Action */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-white">Deposit History</h2>
              <p className="text-[11px] sm:text-xs text-slate-400">
                Track verification status for your pending and completed Real Account deposits.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
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
                data-testid="deposit-history-new-deposit-btn"
                className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
              >
                <PlusCircle className="w-3.5 h-3.5" aria-hidden="true" />
                <span>New Deposit</span>
              </button>
            </div>
          </div>

          {/* Summary Strip (Flat single-elevation cells with tabular numerals) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-800 bg-slate-950 border border-slate-800 rounded-xl">
            <div className="p-3 sm:p-3.5">
              <p className="text-[11px] text-slate-400">Total Completed Deposits</p>
              <p className="text-base sm:text-lg font-extrabold text-emerald-400 font-mono tabular-nums mt-0.5">
                $
                {depositSummary.totalCompletedUsd.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
              <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                {depositSummary.completedCount} completed
              </p>
            </div>
            <div className="p-3 sm:p-3.5">
              <p className="text-[11px] text-slate-400">Pending Verification</p>
              <p className="text-base sm:text-lg font-extrabold text-amber-400 font-mono tabular-nums mt-0.5">
                $
                {depositSummary.totalPendingUsd.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
              <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                {depositSummary.pendingCount} pending
              </p>
            </div>
            <div className="p-3 sm:p-3.5">
              <p className="text-[11px] text-slate-400">All Deposit Requests</p>
              <p className="text-base sm:text-lg font-extrabold text-white font-mono tabular-nums mt-0.5">
                {depositSummary.totalCount}
              </p>
              <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                {depositSummary.rejectedCount} rejected
              </p>
            </div>
          </div>

          {/* Filter Tabs & Search */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5">
            <div
              role="group"
              aria-label="Filter deposits by status"
              className="grid grid-cols-4 sm:inline-flex bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px] font-semibold"
            >
              {(
                [
                  { id: 'all', label: `All (${depositSummary.totalCount})` },
                  { id: 'pending', label: `Pending (${depositSummary.pendingCount})` },
                  { id: 'completed', label: `Completed (${depositSummary.completedCount})` },
                  { id: 'rejected', label: `Rejected (${depositSummary.rejectedCount})` },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`deposit-filter-${item.id}`}
                  onClick={() => setDepositFilter(item.id)}
                  className={`px-2.5 py-1.5 rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    depositFilter === item.id
                      ? 'bg-slate-800 text-white font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="relative w-full md:w-64">
              <Search
                className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label="Search deposit transactions"
                data-testid="deposit-history-search"
                value={depositSearch}
                onChange={(e) => setDepositSearch(e.target.value)}
                placeholder="Search method or Tx ID..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Transactions Table / Mobile List / Empty State */}
          {filteredDeposits.length === 0 ? (
            <div
              data-testid="deposit-history-empty"
              className="bg-slate-950 border border-slate-800 rounded-xl py-10 px-4 text-center space-y-2.5"
            >
              <p className="text-xs sm:text-sm font-semibold text-slate-300">
                {depositSummary.totalCount === 0
                  ? 'No deposit transactions recorded yet.'
                  : 'No deposit transactions match the selected filter.'}
              </p>
              <p className="text-[11px] text-slate-500 max-w-md mx-auto">
                {depositSummary.totalCount === 0
                  ? 'Submit a Real Account deposit via KBZPay, WavePay, USDT TRC20, or Bitcoin to fund your account and unlock withdrawals.'
                  : 'Try switching status filters or clearing your search query.'}
              </p>
              {depositSummary.totalCount === 0 ? (
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
                    setDepositFilter('all');
                    setDepositSearch('');
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors"
                >
                  Show All Deposits
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
                      <th className="py-2.5 px-3.5 font-semibold">Method</th>
                      <th className="py-2.5 px-3.5 font-semibold">Reference / Details</th>
                      <th className="py-2.5 px-3.5 font-semibold text-right">Amount (USD)</th>
                      <th className="py-2.5 px-3.5 font-semibold">Status</th>
                      <th className="py-2.5 px-3.5 font-semibold text-right">Submitted</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {filteredDeposits.map((tx) => {
                      const normStatus = normalizeDepositStatus(tx.status);
                      const statusLabel = formatDepositStatusLabel(normStatus);
                      const methodLabel = extractDepositMethodLabel(tx.type);
                      return (
                        <tr
                          key={tx.id}
                          data-testid={`deposit-row-${tx.id}`}
                          className="hover:bg-slate-900/60 transition-colors"
                        >
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
                          <td className="py-2.5 px-3.5 text-right font-mono font-bold text-amber-400 whitespace-nowrap">
                            ${Number(tx.amount || 0).toFixed(2)}
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
                {filteredDeposits.map((tx) => {
                  const normStatus = normalizeDepositStatus(tx.status);
                  const statusLabel = formatDepositStatusLabel(normStatus);
                  const methodLabel = extractDepositMethodLabel(tx.type);
                  return (
                    <div
                      key={tx.id}
                      className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <strong className="text-xs text-white">{methodLabel}</strong>
                        <span className="text-sm font-extrabold font-mono tabular-nums text-amber-400">
                          ${Number(tx.amount || 0).toFixed(2)}
                        </span>
                      </div>
                      <p className="text-[11px] font-mono text-slate-300 break-all">
                        {sanitizeMemberNoticeText(tx.target)}
                      </p>
                      {tx.rejectReason && (
                        <p className="text-[10px] text-red-400">
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
            </>
          )}
        </section>
      )}
    </div>
  );
};

