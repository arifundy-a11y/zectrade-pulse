import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Ban,
  Camera,
  CheckCircle2,
  Coins,
  Copy,
  Download,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Newspaper,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Shield,
  Star,
  Trash2,
  TrendingDown,
  TrendingUp,
  Upload,
  UserCheck,
  X,
  Zap,
} from 'lucide-react';
import type {
  AccountMode,
  AdminManagedCoin,
  CoinScheduleMode,
  CoinTradeAnalytics,
  CoinTrendBias,
  CoinVolatilityLevel,
  DepositAccounts,
  FaqEntry,
  LotteryColor,
  LotteryLiveState,
  LotteryResultMode,
  ManagedMember,
  MarketQuote,
  MarketSymbol,
  NewsArticle,
  NewsCategory,
  PlatformStats,
  PreOrder,
  StaffTabId,
  StaffWalletRequest,
  TradeHistoryItem,
  UserProfile,
  UserRole,
  WalletTransaction,
  WithdrawMethod,
} from '../types';
import { LotteryAdminConsole, type DigitDrawSchedulePayload } from './LotteryAdminConsole';
import { resolveNewsImageSrc } from './NewsWorkspace';
import { NEWS_CATEGORIES, formatNewsTimestamp } from '../utils/newsUtils';
import {
  DEFAULT_BRAND_LOGO_URL,
  calculateSpotSwap,
  computeScheduledCoinPrice,
  convertCurrencyMmkUsd,
  evaluateWithdrawalEligibility,
  extractAccountTargetNumber,
  generateWalletCsv,
  getAllowedStaffTabs,
  normalizeBrandLogoUrl,
  resolveWithdrawDefaults,
  sanitizeMemberNoticeText,
} from '../utils/tradingEngine';
import { formatChartPrice } from '../utils/chartEngine';
import { getAvatarInitials, resizeImageFileToAvatarDataUrl } from '../utils/avatarHelper';
import {
  calculatePostTransferBalances,
  roundUsd2,
  validateP2PTransferInput,
} from '../utils/transferEngine';

export interface MemberProfileUpdatePayload {
  username?: string;
  email?: string;
  avatarUrl?: string | null;
  fullName?: string | null;
  phone?: string | null;
  country?: string | null;
  bio?: string | null;
  withdrawMethod?: WithdrawMethod;
  withdrawAccountName?: string | null;
  withdrawAccountNumber?: string | null;
  securityPin?: string;
}

interface ModalShellProps {
  title: string;
  onClose: () => void;
  maxWidth?: string;
  children: React.ReactNode;
}

const ModalShell: React.FC<ModalShellProps> = ({
  title,
  onClose,
  maxWidth = 'max-w-md',
  children,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
    >
      <div
        className={`bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 w-full ${maxWidth} max-h-[90vh] flex flex-col space-y-3 shadow-2xl overflow-hidden`}
      >
        <div className="flex items-center justify-between border-b border-slate-800 pb-2.5 shrink-0">
          <h3 className="text-xs sm:text-sm font-bold text-white">{title}</h3>
          <button
            type="button"
            aria-label={`Close ${title}`}
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 pr-0.5 space-y-3 no-scrollbar">{children}</div>
      </div>
    </div>
  );
};

/* ---------------- SWAP MODAL ---------------- */
export const SwapModal: React.FC<{
  user: UserProfile;
  quotes: MarketQuote[];
  initialSymbol?: MarketSymbol;
  initialDirection?: 'usdtToCoin' | 'coinToUsdt';
  onExecuteSwap: (symbol: MarketSymbol, direction: 'usdtToCoin' | 'coinToUsdt', amount: number) => Promise<void>;
  onClose: () => void;
}> = ({ user, quotes, initialSymbol = 'BTCUSDT', initialDirection = 'usdtToCoin', onExecuteSwap, onClose }) => {
  const [symbol, setSymbol] = useState<MarketSymbol>(initialSymbol);
  const [direction, setDirection] = useState<'usdtToCoin' | 'coinToUsdt'>(initialDirection);
  const [amountInput, setAmountInput] = useState(() => {
    if (initialDirection === 'coinToUsdt' && user.spotHoldings[initialSymbol]) {
      return user.spotHoldings[initialSymbol]!.units.toFixed(6);
    }
    return '';
  });

  const livePrice = quotes.find((q) => q.symbol === symbol)?.price ?? 1;
  const amount = parseFloat(amountInput) || 0;
  const { feeUsdt, netOutput } = calculateSpotSwap(direction, amount, livePrice);
  const availCoin = user.spotHoldings[symbol]?.units ?? 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onExecuteSwap(symbol, direction, amount);
    onClose();
  };

  return (
    <ModalShell title="Instant Spot Swap" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px] font-semibold">
          <button
            type="button"
            onClick={() => setDirection('usdtToCoin')}
            className={`py-1.5 rounded ${direction === 'usdtToCoin' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}
          >
            USDT to Coin
          </button>
          <button
            type="button"
            onClick={() => setDirection('coinToUsdt')}
            className={`py-1.5 rounded ${direction === 'coinToUsdt' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}
          >
            Coin to USDT
          </button>
        </div>

        <div>
          <label htmlFor="swap-coin" className="text-[11px] font-semibold text-slate-300 block mb-1">
            Target Asset
          </label>
          <select
            id="swap-coin"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value as MarketSymbol)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white"
          >
            {quotes.map((q) => (
              <option key={q.symbol} value={q.symbol}>
                {q.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="flex justify-between text-[11px] mb-1">
            <label htmlFor="swap-amount" className="font-semibold text-slate-300">
              {direction === 'usdtToCoin' ? 'USDT Amount' : `${symbol.replace('USDT', '')} Amount`}
            </label>
            <span className="font-mono text-amber-400">
              Avail:{' '}
              {direction === 'usdtToCoin'
                ? `$${user.realBalance.toFixed(2)}`
                : `${availCoin.toFixed(6)}`}
            </span>
          </div>
          <input
            id="swap-amount"
            type="number"
            min="0.000001"
            step="any"
            required
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            placeholder="0.00"
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs sm:text-sm font-mono text-white"
          />
        </div>

        <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-[11px] font-mono tabular-nums space-y-1">
          <div className="flex justify-between text-slate-400">
            <span>Market Price</span>
            <span className="text-white">${formatChartPrice(livePrice)}</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>Swap Fee (0.015%)</span>
            <span className="text-red-400">${feeUsdt.toFixed(4)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-800 pt-1 font-bold">
            <span className="text-slate-300">Estimated Output</span>
            <span className="text-emerald-400">
              {direction === 'usdtToCoin'
                ? `${netOutput.toFixed(6)} ${symbol.replace('USDT', '')}`
                : `$${netOutput.toFixed(2)} USDT`}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="py-2 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold"
          >
            Confirm Swap
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

/* ---------------- DEPOSIT MODAL ---------------- */
export const DepositModal: React.FC<{
  depositAccounts: DepositAccounts;
  depositRateMMK: number;
  onCopyText: (val: string, label: string) => void;
  onSubmitDeposit: (method: string, usdAmount: number, targetDesc: string) => Promise<void>;
  onClose: () => void;
}> = ({ depositAccounts, depositRateMMK, onCopyText, onSubmitDeposit, onClose }) => {
  const [method, setMethod] = useState<'kpay' | 'wavepay' | 'usdt' | 'btc'>('kpay');
  const [currencyMode, setCurrencyMode] = useState<'usdt' | 'mmk'>('usdt');
  const [amountInput, setAmountInput] = useState('');
  const [txId, setTxId] = useState('');

  const account = depositAccounts[method] ?? { name: 'Official', number: 'N/A' };
  const isMmkMethod = method === 'kpay' || method === 'wavepay';
  const effectiveCurrency = isMmkMethod ? currencyMode : 'usdt';
  const { usdAmount, mmkAmount } = convertCurrencyMmkUsd(
    parseFloat(amountInput) || 0,
    effectiveCurrency,
    depositRateMMK
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetDesc = `Tx ID: ${txId.trim()}${isMmkMethod ? ` (${mmkAmount.toLocaleString('en-US')} MMK)` : ''}`;
    await onSubmitDeposit(method, usdAmount, targetDesc);
    onClose();
  };

  return (
    <ModalShell title="Recharge Real Account" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor="dep-method" className="text-[11px] font-semibold text-slate-300 block mb-1">
            Payment Method
          </label>
          <select
            id="dep-method"
            value={method}
            onChange={(e) => setMethod(e.target.value as 'kpay' | 'wavepay' | 'usdt' | 'btc')}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white"
          >
            <option value="kpay">KBZPay (KPay)</option>
            <option value="wavepay">WavePay</option>
            <option value="usdt">USDT TRC20</option>
            <option value="btc">Bitcoin (BTC)</option>
          </select>
        </div>

        <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1.5 text-[11px]">
          <div className="flex justify-between">
            <span className="text-slate-400">Account Name</span>
            <strong className="text-white">{account.name}</strong>
          </div>
          <div className="flex justify-between items-center gap-2">
            <span className="text-slate-400">Account / Address</span>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-mono text-emerald-400 font-bold truncate max-w-[150px]">{account.number}</span>
              <button
                type="button"
                aria-label="Copy Deposit Account"
                onClick={() => onCopyText(account.number, 'Deposit Account')}
                className="text-slate-400 hover:text-white"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {isMmkMethod && (
          <div className="grid grid-cols-2 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => setCurrencyMode('usdt')}
              className={`py-1.5 rounded ${currencyMode === 'usdt' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}
            >
              USD ($)
            </button>
            <button
              type="button"
              onClick={() => setCurrencyMode('mmk')}
              className={`py-1.5 rounded ${currencyMode === 'mmk' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}
            >
              MMK (Ks)
            </button>
          </div>
        )}

        <div>
          <label htmlFor="dep-amount" className="text-[11px] font-semibold text-slate-300 block mb-1">
            Amount ({effectiveCurrency.toUpperCase()})
          </label>
          <input
            id="dep-amount"
            type="number"
            min="1"
            step="any"
            required
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            placeholder="Enter amount"
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs sm:text-sm font-mono text-white"
          />
        </div>

        <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-[11px] font-mono tabular-nums flex justify-between">
          <span className="text-slate-400">Rate 1 USD = {depositRateMMK.toLocaleString()} MMK</span>
          <span className="text-emerald-400 font-bold">
            {effectiveCurrency === 'usdt' && isMmkMethod
              ? `${mmkAmount.toLocaleString()} MMK`
              : `$${usdAmount.toFixed(2)} USD`}
          </span>
        </div>

        <div>
          <label htmlFor="dep-txid" className="text-[11px] font-semibold text-slate-300 block mb-1">
            Transaction ID / Last 6 Digits
          </label>
          <input
            id="dep-txid"
            type="text"
            required
            value={txId}
            onChange={(e) => setTxId(e.target.value)}
            placeholder="TX123456"
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white"
          />
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <button type="button" onClick={onClose} className="py-2 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold">
            Cancel
          </button>
          <button type="submit" className="py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold">
            Submit Deposit
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

/* ---------------- WITHDRAW MODAL ---------------- */
export const WithdrawModal: React.FC<{
  user: UserProfile;
  withdrawRateMMK: number;
  onSubmitWithdraw: (
    method: string,
    usdAmount: number,
    targetDesc: string,
    pin: string,
    totpCode?: string
  ) => Promise<boolean>;
  onOpenDeposit?: () => void;
  onClose: () => void;
}> = ({ user, withdrawRateMMK, onSubmitWithdraw, onOpenDeposit, onClose }) => {
  const defaults = resolveWithdrawDefaults(user);
  const [method, setMethod] = useState<'kpay' | 'wavepay' | 'usdt' | 'bank'>(defaults.method);
  const [currencyMode, setCurrencyMode] = useState<'usdt' | 'mmk'>('usdt');
  const [holderName, setHolderName] = useState(defaults.holderName);
  const [target, setTarget] = useState(defaults.target);
  const [amountInput, setAmountInput] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [totpCode, setTotpCode] = useState('');

  const isMmkMethod = method !== 'usdt';
  const effectiveCurrency = isMmkMethod ? currencyMode : 'usdt';
  const { usdAmount, mmkAmount } = convertCurrencyMmkUsd(
    parseFloat(amountInput) || 0,
    effectiveCurrency,
    withdrawRateMMK
  );

  const eligibility = evaluateWithdrawalEligibility(user);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eligibility.allowed) return;
    const targetDesc =
      `${isMmkMethod && holderName.trim() ? `${holderName.trim()} (${target.trim()})` : target.trim()}` +
      `${isMmkMethod ? ` (${mmkAmount.toLocaleString('en-US')} MMK)` : ''}`;
    const ok = await onSubmitWithdraw(
      method,
      usdAmount,
      targetDesc,
      pin.trim(),
      user.twoFactorEnabled ? totpCode.trim() : undefined
    );
    if (ok) onClose();
  };

  return (
    <ModalShell title="Withdraw Funds" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {!eligibility.allowed && (
          <div
            data-testid="withdraw-lock-banner"
            className="bg-red-950/50 border border-red-500/40 rounded-xl p-3 text-[11px] text-red-200 flex items-center justify-between gap-2.5"
          >
            <div className="min-w-0">
              <strong className="block text-red-300 mb-0.5">
                {eligibility.lockType === 'no_deposit' ? 'First Deposit Required' : 'Withdrawal Locked'}
              </strong>
              <span>{eligibility.reason}</span>
            </div>
            {eligibility.lockType === 'no_deposit' && onOpenDeposit && (
              <button
                type="button"
                data-testid="withdraw-make-deposit-btn"
                onClick={() => {
                  onClose();
                  onOpenDeposit();
                }}
                className="shrink-0 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold transition-colors"
              >
                Make First Deposit
              </button>
            )}
          </div>
        )}
        <div>
          <label htmlFor="wd-method" className="text-[11px] font-semibold text-slate-300 block mb-1">
            Payment Method
          </label>
          <select
            id="wd-method"
            value={method}
            onChange={(e) => setMethod(e.target.value as 'kpay' | 'wavepay' | 'usdt' | 'bank')}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white"
          >
            <option value="kpay">KBZPay (KPay)</option>
            <option value="wavepay">WavePay</option>
            <option value="usdt">USDT TRC20</option>
            <option value="bank">Bank Transfer</option>
          </select>
        </div>

        {isMmkMethod && (
          <div>
            <label htmlFor="wd-name" className="text-[11px] font-semibold text-slate-300 block mb-1">
              Account Holder Name
            </label>
            <input
              id="wd-name"
              type="text"
              required
              value={holderName}
              onChange={(e) => setHolderName(e.target.value)}
              placeholder="Full account name"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white"
            />
          </div>
        )}

        <div>
          <label htmlFor="wd-target" className="text-[11px] font-semibold text-slate-300 block mb-1">
            {method === 'usdt' ? 'TRC20 Wallet Address' : method === 'bank' ? 'Bank Account Number' : 'Account Phone'}
          </label>
          <input
            id="wd-target"
            type="text"
            required
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={method === 'usdt' ? 'T...' : '09xxxxxxxxx'}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white"
          />
        </div>

        {isMmkMethod && (
          <div className="grid grid-cols-2 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => setCurrencyMode('usdt')}
              className={`py-1.5 rounded ${currencyMode === 'usdt' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}
            >
              USD ($)
            </button>
            <button
              type="button"
              onClick={() => setCurrencyMode('mmk')}
              className={`py-1.5 rounded ${currencyMode === 'mmk' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}
            >
              MMK (Ks)
            </button>
          </div>
        )}

        <div>
          <div className="flex justify-between text-[11px] mb-1">
            <label htmlFor="wd-amount" className="font-semibold text-slate-300">
              Amount ({effectiveCurrency.toUpperCase()})
            </label>
            <span className="font-mono text-amber-400">Avail: ${user.realBalance.toFixed(2)}</span>
          </div>
          <input
            id="wd-amount"
            type="number"
            min="1"
            step="any"
            required
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            placeholder="0.00"
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs sm:text-sm font-mono text-white"
          />
        </div>

        {isMmkMethod && (
          <div
            data-testid="withdraw-exchange-rate-box"
            className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-[11px] font-mono tabular-nums space-y-1"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">
                Rate 1 USD = {withdrawRateMMK.toLocaleString('en-US')} MMK
              </span>
              <span
                data-testid="withdraw-converted-value"
                className={`font-bold ${
                  usdAmount > user.realBalance ? 'text-red-400' : 'text-blue-400'
                }`}
              >
                {effectiveCurrency === 'mmk'
                  ? `= $${usdAmount.toFixed(2)} USD`
                  : `${mmkAmount.toLocaleString('en-US')} MMK`}
              </span>
            </div>
            {effectiveCurrency === 'mmk' && (
              <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400">
                <span>
                  Max: ≈ {Math.floor(user.realBalance * withdrawRateMMK).toLocaleString('en-US')} MMK
                </span>
                {usdAmount > user.realBalance && (
                  <span className="text-red-400 font-semibold font-sans">
                    Exceeds available balance
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        <div>
          <label htmlFor="wd-pin" className="text-[11px] font-semibold text-amber-400 block mb-1">
            4-Digit Security PIN (Default: 1234)
          </label>
          <div className="relative">
            <input
              id="wd-pin"
              type={showPin ? 'text' : 'password'}
              maxLength={4}
              inputMode="numeric"
              required
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="••••"
              className="w-full bg-slate-950 border border-amber-500/40 rounded-lg pl-3 pr-10 py-2 text-center font-mono tracking-[0.4em] text-sm text-amber-300"
            />
            <button
              type="button"
              aria-label={showPin ? 'Hide PIN' : 'Show PIN'}
              onClick={() => setShowPin((p) => !p)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white"
            >
              {showPin ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {user.twoFactorEnabled && (
          <div>
            <label
              htmlFor="wd-totp"
              className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1.5 mb-1"
            >
              <Shield className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Google Authenticator (6-Digit 2FA Code)</span>
            </label>
            <input
              id="wd-totp"
              data-testid="withdraw-totp-input"
              type="text"
              maxLength={6}
              inputMode="numeric"
              required
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              className="w-full bg-slate-950 border border-emerald-500/40 rounded-lg px-3 py-2 text-center font-mono tracking-[0.35em] text-sm text-emerald-300"
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 pt-1">
          <button type="button" onClick={onClose} className="py-2 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!eligibility.allowed}
            className="py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-xs font-bold"
          >
            {eligibility.allowed ? 'Confirm Withdrawal' : 'Withdraw Locked'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

/* ---------------- TRANSFER MODAL ---------------- */
export interface VerifiedTransferRecipient {
  uid: string;
  username: string;
  email: string;
}

export const TransferModal: React.FC<{
  accountMode: AccountMode;
  availableBalance: number;
  currentUserUid: string;
  currentUserEmail: string;
  userPin: string;
  twoFactorEnabled?: boolean;
  onVerifyTwoFactor?: (code: string) => boolean;
  onLookupRecipient: (
    recipient: string
  ) => Promise<{ ok: true; recipient: VerifiedTransferRecipient } | { ok: false; error: string }>;
  onSubmitTransfer: (
    recipient: string,
    amount: number,
    pin: string,
    totpCode?: string
  ) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}> = ({
  accountMode,
  availableBalance,
  currentUserUid,
  currentUserEmail,
  userPin,
  twoFactorEnabled = false,
  onVerifyTwoFactor,
  onLookupRecipient,
  onSubmitTransfer,
  onClose,
}) => {
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [recipient, setRecipient] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [verifiedRecipient, setVerifiedRecipient] = useState<VerifiedTransferRecipient | null>(
    null
  );

  const parsedAmount = roundUsd2(parseFloat(amountInput) || 0);
  const exceedsBalance = parsedAmount > roundUsd2(availableBalance);
  const { senderRemaining } = calculatePostTransferBalances({
    senderBalance: availableBalance,
    recipientBalance: 0,
    amount: parsedAmount,
  });

  const handleReviewTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const validation = validateP2PTransferInput({
      senderUid: currentUserUid,
      senderEmail: currentUserEmail,
      recipientIdentifier: recipient,
      amount: parsedAmount,
      availableBalance,
      pinInput: pin,
      expectedPin: userPin,
      twoFactorEnabled,
      totpCode,
    });

    if (!validation.ok) {
      setErrorMsg(validation.error);
      return;
    }

    if (twoFactorEnabled && onVerifyTwoFactor && !onVerifyTwoFactor(totpCode.trim())) {
      setErrorMsg('Invalid 6-digit Google Authenticator code.');
      return;
    }

    setVerifying(true);
    try {
      const lookup = await onLookupRecipient(validation.recipientIdentifier);
      if (!lookup.ok) {
        setErrorMsg(lookup.error);
        return;
      }
      setVerifiedRecipient(lookup.recipient);
      setStep('confirm');
    } finally {
      setVerifying(false);
    }
  };

  const handleConfirmSend = async () => {
    if (!verifiedRecipient) return;
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const res = await onSubmitTransfer(
        verifiedRecipient.uid,
        parsedAmount,
        pin.trim(),
        twoFactorEnabled ? totpCode.trim() : undefined
      );
      if (res.ok) {
        onClose();
      } else {
        setErrorMsg(res.error || 'Transfer failed.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title="Direct P2P Transfer" onClose={onClose}>
      <div className="space-y-3">
        {/* Available Balance Banner */}
        <div
          data-testid="transfer-available-balance"
          className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-slate-950 border border-slate-800"
        >
          <div>
            <span className="text-[11px] text-slate-400 block">
              Available Balance · {accountMode.toUpperCase()} Wallet
            </span>
            <span className="text-base font-extrabold text-amber-400 font-mono tabular-nums">
              $
              {availableBalance.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
          {step === 'form' && (
            <button
              type="button"
              disabled={availableBalance < 1}
              onClick={() => {
                setErrorMsg(null);
                setAmountInput(String(Math.floor(availableBalance * 100) / 100));
              }}
              className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-[11px] font-mono font-bold text-amber-300 transition-colors"
            >
              Max
            </button>
          )}
        </div>

        {errorMsg && (
          <div
            role="alert"
            data-testid="transfer-error"
            className="px-3 py-2 rounded-lg bg-red-950/60 border border-red-500/40 text-red-200 text-[11px] font-medium"
          >
            {errorMsg}
          </div>
        )}

        {step === 'form' ? (
          <form onSubmit={handleReviewTransfer} className="space-y-3">
            <div>
              <label htmlFor="tr-rec" className="text-[11px] font-semibold text-slate-300 block mb-1">
                Recipient UID or Email
              </label>
              <input
                id="tr-rec"
                data-testid="transfer-recipient-input"
                type="text"
                required
                value={recipient}
                onChange={(e) => {
                  setRecipient(e.target.value);
                  if (errorMsg) setErrorMsg(null);
                }}
                placeholder="Enter User UID or email"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-[11px] mb-1">
                <label htmlFor="tr-amt" className="font-semibold text-slate-300">
                  Amount ($ USD · {accountMode.toUpperCase()} Wallet)
                </label>
                <span className="font-mono tabular-nums text-amber-400">
                  Avail: ${availableBalance.toFixed(2)}
                </span>
              </div>
              <input
                id="tr-amt"
                data-testid="transfer-amount-input"
                type="number"
                min="1"
                step="any"
                required
                value={amountInput}
                onChange={(e) => {
                  setAmountInput(e.target.value);
                  if (errorMsg) setErrorMsg(null);
                }}
                placeholder="0.00"
                className={`w-full bg-slate-950 border rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none ${
                  exceedsBalance
                    ? 'border-red-500/70 focus:border-red-400'
                    : 'border-slate-800 focus:border-indigo-500'
                }`}
              />
              {exceedsBalance && (
                <p className="mt-1 text-[10px] text-red-400 font-medium">
                  Amount exceeds available {accountMode.toUpperCase()} balance.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="tr-pin" className="text-[11px] font-semibold text-amber-400 block mb-1">
                4-Digit Security PIN
              </label>
              <div className="relative">
                <input
                  id="tr-pin"
                  data-testid="transfer-pin-input"
                  type={showPin ? 'text' : 'password'}
                  maxLength={4}
                  inputMode="numeric"
                  required
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value.replace(/\D/g, '').slice(0, 4));
                    if (errorMsg) setErrorMsg(null);
                  }}
                  placeholder="••••"
                  className="w-full bg-slate-950 border border-amber-500/40 rounded-lg pl-3 pr-10 py-2 text-center font-mono tracking-[0.4em] text-sm text-amber-300"
                />
                <button
                  type="button"
                  aria-label={showPin ? 'Hide PIN' : 'Show PIN'}
                  onClick={() => setShowPin((p) => !p)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white"
                >
                  {showPin ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {twoFactorEnabled && (
              <div>
                <label
                  htmlFor="tr-totp"
                  className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1.5 mb-1"
                >
                  <Shield className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Google Authenticator (6-Digit 2FA Code)</span>
                </label>
                <input
                  id="tr-totp"
                  data-testid="transfer-totp-input"
                  type="text"
                  maxLength={6}
                  inputMode="numeric"
                  required
                  value={totpCode}
                  onChange={(e) => {
                    setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                    if (errorMsg) setErrorMsg(null);
                  }}
                  placeholder="000000"
                  className="w-full bg-slate-950 border border-emerald-500/40 rounded-lg px-3 py-2 text-center font-mono tracking-[0.35em] text-sm text-emerald-300"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={verifying || exceedsBalance}
                data-testid="transfer-review-btn"
                className="py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold transition-colors"
              >
                {verifying ? 'Verifying...' : 'Continue'}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-3" data-testid="transfer-confirm-step">
            <div className="border-t border-b border-slate-800 divide-y divide-slate-800/80 text-xs">
              <div className="py-2.5 flex items-start justify-between gap-3">
                <span className="text-slate-400">Recipient Account</span>
                <div className="text-right min-w-0">
                  <p className="font-bold text-white truncate">{verifiedRecipient?.username}</p>
                  <p className="text-[11px] font-mono text-amber-300 truncate">
                    {verifiedRecipient?.uid}
                  </p>
                  <p className="text-[10px] text-slate-400 truncate">{verifiedRecipient?.email}</p>
                </div>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-3">
                <span className="text-slate-400">Transfer Amount</span>
                <span className="text-sm font-extrabold font-mono tabular-nums text-white">
                  ${parsedAmount.toFixed(2)} USD
                </span>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-3">
                <span className="text-slate-400">Remaining Balance</span>
                <span className="font-mono tabular-nums font-bold text-emerald-400">
                  ${senderRemaining.toFixed(2)} USD
                </span>
              </div>
            </div>

            <p className="text-[11px] text-emerald-400 flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>
                {twoFactorEnabled
                  ? 'Security PIN & Google Authenticator verified. Recipient balance will be credited immediately.'
                  : 'Security PIN verified. Recipient balance will be credited immediately.'}
              </span>
            </p>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                disabled={submitting}
                onClick={() => {
                  setErrorMsg(null);
                  setStep('form');
                }}
                className="py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
              >
                Back
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleConfirmSend}
                data-testid="transfer-confirm-btn"
                className="py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold transition-colors"
              >
                {submitting ? 'Sending...' : 'Confirm & Transfer'}
              </button>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
};

/* ---------------- SECURITY PIN MODAL ---------------- */
export const PinModal: React.FC<{
  onSavePin: (pin: string) => Promise<void>;
  onClose: () => void;
}> = ({ onSavePin, onClose }) => {
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSavePin(pin.trim());
    onClose();
  };

  return (
    <ModalShell title="Update Security PIN" onClose={onClose} maxWidth="max-w-sm">
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-[11px] text-slate-400">
          Set a 4-digit PIN used to authorize withdrawals and direct P2P transfers.
        </p>
        <div className="relative">
          <input
            aria-label="New 4-digit PIN"
            type={showPin ? 'text' : 'password'}
            maxLength={4}
            pattern="[0-9]{4}"
            inputMode="numeric"
            required
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="••••"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 text-center text-xl font-mono tracking-[0.8em] text-amber-400"
          />
          <button
            type="button"
            aria-label={showPin ? 'Hide PIN' : 'Show PIN'}
            onClick={() => setShowPin((p) => !p)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
          >
            {showPin ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className="py-2 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold">
            Cancel
          </button>
          <button type="submit" className="py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold">
            Save PIN
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

/* ---------------- MEMBER PROFILE & WITHDRAW ACCOUNT MODAL (2 PAGES) ---------------- */
export const ProfileEditModal: React.FC<{
  user: UserProfile;
  onSaveProfile: (payload: MemberProfileUpdatePayload) => Promise<boolean>;
  onClose: () => void;
}> = ({ user, onSaveProfile, onClose }) => {
  const [page, setPage] = useState<'member' | 'withdraw'>('member');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.avatarUrl ?? null);
  const [username, setUsername] = useState(user.username || '');
  const [fullName, setFullName] = useState(user.fullName || '');
  const [phone, setPhone] = useState(user.phone || '');
  const [country, setCountry] = useState(user.country || '');
  const [bio, setBio] = useState(user.bio || '');
  const [withdrawMethod, setWithdrawMethod] = useState<WithdrawMethod>(
    user.withdrawMethod ?? 'kpay'
  );
  const [withdrawAccountName, setWithdrawAccountName] = useState(user.withdrawAccountName || '');
  const [withdrawAccountNumber, setWithdrawAccountNumber] = useState(
    user.withdrawAccountNumber || ''
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const initials = getAvatarInitials(fullName || username, user.email);

  const withdrawMethodDisplay =
    withdrawMethod === 'kpay'
      ? 'KBZPay'
      : withdrawMethod === 'wavepay'
      ? 'WavePay'
      : withdrawMethod === 'bank'
      ? 'Bank Transfer'
      : 'USDT TRC20';

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    try {
      const compressed = await resizeImageFileToAvatarDataUrl(file, 256);
      setAvatarUrl(compressed);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Unable to process image.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setPage('member');
      setUploadError('Display name is required.');
      return;
    }
    setSaving(true);
    setUploadError(null);
    try {
      const ok = await onSaveProfile({
        username: username.trim(),
        avatarUrl,
        fullName: fullName.trim() || null,
        phone: phone.trim() || null,
        country: country.trim() || null,
        bio: bio.trim() || null,
        withdrawMethod,
        withdrawAccountName: withdrawAccountName.trim() || null,
        withdrawAccountNumber: withdrawAccountNumber.trim() || null,
      });
      if (ok) onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Member & Withdraw Details" onClose={onClose} maxWidth="max-w-lg">
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        {/* Two-Page Step Switcher */}
        <div
          role="tablist"
          aria-label="Member details pages"
          className="grid grid-cols-2 gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800"
        >
          <button
            type="button"
            role="tab"
            aria-selected={page === 'member'}
            data-testid="profile-page-member-tab"
            onClick={() => setPage('member')}
            className={`py-2 px-2 sm:px-3 rounded-lg text-[11px] font-bold whitespace-nowrap ${
              page === 'member'
                ? 'bg-amber-500 text-slate-950 shadow-sm'
                : 'bg-transparent text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            1. Member Info
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={page === 'withdraw'}
            data-testid="profile-page-withdraw-tab"
            onClick={() => setPage('withdraw')}
            className={`py-2 px-2 sm:px-3 rounded-lg text-[11px] font-bold whitespace-nowrap ${
              page === 'withdraw'
                ? 'bg-amber-500 text-slate-950 shadow-sm'
                : 'bg-transparent text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            2. Withdraw Account
          </button>
        </div>

        {page === 'member' ? (
          <div data-testid="profile-page-member-content" className="space-y-3">
            {/* Profile Picture Upload */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-full bg-slate-800 border border-slate-700 overflow-hidden flex items-center justify-center shrink-0">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={username || 'Profile'}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-base font-extrabold text-amber-400">{initials}</span>
                  )}
                </div>
                <div>
                  <p className="font-bold text-white text-xs">Profile Picture</p>
                  <p className="text-[10px] text-slate-400">
                    Upload JPG, PNG, or WebP. Automatically sized for fast sync.
                  </p>
                  {uploadError && (
                    <p className="text-[10px] text-red-400 font-semibold mt-0.5">{uploadError}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <label className="cursor-pointer px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold flex items-center gap-1.5">
                  <Camera className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Upload Photo</span>
                  <input
                    type="file"
                    accept="image/*"
                    data-testid="profile-avatar-input"
                    onChange={handleFileChange}
                    className="sr-only"
                  />
                </label>
                {avatarUrl && (
                  <button
                    type="button"
                    onClick={() => setAvatarUrl(null)}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>

            {/* Personal Details */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Page 1 · Member Information
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label
                    htmlFor="prof-username"
                    className="text-[11px] font-semibold text-slate-300 block mb-1"
                  >
                    Display Username
                  </label>
                  <input
                    id="prof-username"
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Display name"
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label
                    htmlFor="prof-fullname"
                    className="text-[11px] font-semibold text-slate-300 block mb-1"
                  >
                    Full Legal Name
                  </label>
                  <input
                    id="prof-fullname"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Aung Kyaw Moe"
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label
                    htmlFor="prof-phone"
                    className="text-[11px] font-semibold text-slate-300 block mb-1"
                  >
                    Phone Number
                  </label>
                  <input
                    id="prof-phone"
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. +95 9789 123 456"
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-xs font-mono text-white"
                  />
                </div>
                <div>
                  <label
                    htmlFor="prof-country"
                    className="text-[11px] font-semibold text-slate-300 block mb-1"
                  >
                    Country / City
                  </label>
                  <input
                    id="prof-country"
                    type="text"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    placeholder="e.g. Myanmar (Burma)"
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white"
                  />
                </div>
              </div>
              <div>
                <label
                  htmlFor="prof-bio"
                  className="text-[11px] font-semibold text-slate-300 block mb-1"
                >
                  Address / Bio Note
                </label>
                <input
                  id="prof-bio"
                  type="text"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Optional city/township or bio note"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="profile-next-page-btn"
                onClick={() => setPage('withdraw')}
                className="py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-emerald-500/40 text-emerald-300 text-xs font-semibold"
              >
                Next: Withdraw →
              </button>
              <button
                type="submit"
                disabled={saving}
                data-testid="profile-save-btn"
                className="py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-bold"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        ) : (
          <div data-testid="profile-page-withdraw-content" className="space-y-3">
            {/* Current Saved Withdraw Summary */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1.5">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                  Saved Withdraw Account Preview
                </span>
                <span className="text-[11px] font-mono text-emerald-300">
                  {withdrawMethodDisplay}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-[11px]">
                <div>
                  <span className="text-slate-500 block">Account Name</span>
                  <span className="text-white font-semibold">
                    {withdrawAccountName.trim() || 'Not set'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Account Number</span>
                  <span className="font-mono text-amber-300 font-semibold">
                    {withdrawAccountNumber.trim() || 'Not set'}
                  </span>
                </div>
              </div>
            </div>

            {/* Editable Withdraw Account Fields */}
            <div className="bg-slate-950 border border-emerald-500/25 rounded-xl p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                  Page 2 · Edit Withdraw Account
                </p>
                <span className="text-[10px] text-slate-400">Auto-fills on Withdraw</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label
                    htmlFor="prof-wd-method"
                    className="text-[11px] font-semibold text-slate-300 block mb-1"
                  >
                    Withdraw Method
                  </label>
                  <select
                    id="prof-wd-method"
                    value={withdrawMethod}
                    onChange={(e) => setWithdrawMethod(e.target.value as WithdrawMethod)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white"
                  >
                    <option value="kpay">KBZPay (KPay)</option>
                    <option value="wavepay">WavePay</option>
                    <option value="bank">Bank Transfer</option>
                    <option value="usdt">USDT TRC20</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="prof-wd-name"
                    className="text-[11px] font-semibold text-slate-300 block mb-1"
                  >
                    Withdraw Account Name
                  </label>
                  <input
                    id="prof-wd-name"
                    type="text"
                    value={withdrawAccountName}
                    onChange={(e) => setWithdrawAccountName(e.target.value)}
                    placeholder="Registered account holder name"
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white"
                  />
                </div>
              </div>
              <div>
                <label
                  htmlFor="prof-wd-number"
                  className="text-[11px] font-semibold text-slate-300 block mb-1"
                >
                  {withdrawMethod === 'usdt'
                    ? 'TRC20 Wallet Address'
                    : 'Withdraw Account Number / Phone'}
                </label>
                <input
                  id="prof-wd-number"
                  type="text"
                  value={withdrawAccountNumber}
                  onChange={(e) => setWithdrawAccountNumber(e.target.value)}
                  placeholder={
                    withdrawMethod === 'usdt' ? 'T...' : 'e.g. 09789123456 or Bank Account No'
                  }
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-xs font-mono text-amber-300"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="profile-prev-page-btn"
                onClick={() => setPage('member')}
                className="py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
              >
                ← Member Info
              </button>
              <button
                type="submit"
                disabled={saving}
                data-testid="profile-save-btn"
                className="py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        )}
      </form>
    </ModalShell>
  );
};

/* ---------------- MODIFY PRE-ORDER MODAL ---------------- */
export const ModifyOrderModal: React.FC<{
  order: PreOrder;
  onSave: (id: string, entryPrice: number, margin: number) => Promise<void>;
  onClose: () => void;
}> = ({ order, onSave, onClose }) => {
  const [entryPrice, setEntryPrice] = useState(String(order.entryPrice));
  const [margin, setMargin] = useState(String(order.margin));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave(order.id, parseFloat(entryPrice) || order.entryPrice, parseFloat(margin) || order.margin);
    onClose();
  };

  return (
    <ModalShell title={`Modify ${order.symbol} Pre-Order`} onClose={onClose} maxWidth="max-w-sm">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor="mod-price" className="text-[11px] font-semibold text-slate-300 block mb-1">
            Target Entry Price ($ USD)
          </label>
          <input
            id="mod-price"
            type="number"
            step="any"
            required
            value={entryPrice}
            onChange={(e) => setEntryPrice(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-white"
          />
        </div>
        <div>
          <label htmlFor="mod-margin" className="text-[11px] font-semibold text-slate-300 block mb-1">
            Margin Reserved ($ USD)
          </label>
          <input
            id="mod-margin"
            type="number"
            step="any"
            required
            value={margin}
            onChange={(e) => setMargin(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-white"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className="py-2 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold">
            Cancel
          </button>
          <button type="submit" className="py-2 rounded-lg bg-amber-500 text-slate-950 text-xs font-bold">
            Save Target
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

/* ---------------- TRADE HISTORY MODAL ---------------- */
export const TradeHistoryModal: React.FC<{
  history: TradeHistoryItem[];
  onClose: () => void;
}> = ({ history, onClose }) => (
  <ModalShell title="Complete Trade History" onClose={onClose} maxWidth="max-w-4xl">
    {history.length === 0 ? (
      <p className="py-8 text-center text-xs text-slate-500">No closed trades recorded yet.</p>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[11px] sm:text-xs font-mono tabular-nums min-w-[540px]">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400">
              <th className="p-2">Symbol</th>
              <th className="p-2">Side</th>
              <th className="p-2">Mode</th>
              <th className="p-2">Entry</th>
              <th className="p-2">Close</th>
              <th className="p-2">Fees</th>
              <th className="p-2">Realized PnL</th>
              <th className="p-2 text-right">Closed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {history.map((h) => {
              const isPos = h.pnlVal >= 0;
              return (
                <tr key={h.id}>
                  <td className="p-2 font-bold text-white">
                    {h.symbol}
                    {h.isLiquidated && (
                      <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40">
                        LIQUIDATED
                      </span>
                    )}
                  </td>
                  <td className={`p-2 font-bold ${h.side === 'buy' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {h.side.toUpperCase()} {h.leverage}x
                  </td>
                  <td className="p-2 text-slate-400 uppercase">{h.accountMode}</td>
                  <td className="p-2">${formatChartPrice(h.entryPrice)}</td>
                  <td className="p-2">${formatChartPrice(h.closePrice)}</td>
                  <td className="p-2 text-red-400">${h.totalFees.toFixed(2)}</td>
                  <td className={`p-2 font-bold ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
                    {isPos ? '+' : ''}${h.pnlVal.toFixed(2)} ({isPos ? '+' : ''}
                    {h.pnlPct.toFixed(2)}%)
                  </td>
                  <td className="p-2 text-right text-slate-400">{h.closedAt}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    )}
  </ModalShell>
);

/* ---------------- WALLET TRANSACTIONS MODAL ---------------- */
export const WalletHistoryModal: React.FC<{
  transactions: WalletTransaction[];
  username: string;
  onClose: () => void;
}> = ({ transactions, username, onClose }) => {
  const handleCsvDownload = () => {
    const csv = generateWalletCsv(transactions);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Zectrade_Wallet_${username || 'User'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <ModalShell title="Wallet Transactions (90 Days)" onClose={onClose} maxWidth="max-w-3xl">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-400">{transactions.length} records</span>
        <button
          type="button"
          onClick={handleCsvDownload}
          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold flex items-center gap-1"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export CSV</span>
        </button>
      </div>
      {transactions.length === 0 ? (
        <p className="py-8 text-center text-xs text-slate-500">No wallet transactions recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px] sm:text-xs font-mono tabular-nums min-w-[460px]">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="p-2">Type</th>
                <th className="p-2">Amount</th>
                <th className="p-2">Target</th>
                <th className="p-2">Status</th>
                <th className="p-2 text-right">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {transactions.map((tx) => (
                <tr key={tx.id}>
                  <td className="p-2 font-bold text-slate-200">{sanitizeMemberNoticeText(tx.type)}</td>
                  <td className="p-2 text-amber-400 font-bold">${tx.amount.toFixed(2)}</td>
                  <td className="p-2 text-slate-300">
                    {tx.isAdjustment ? 'System Wallet' : tx.target}
                    {tx.rejectReason && (
                      <span className="block text-[10px] text-red-400">
                        Reason: {sanitizeMemberNoticeText(tx.rejectReason)}
                      </span>
                    )}
                  </td>
                  <td
                    className={`p-2 font-bold ${
                      tx.status === 'SUCCESS' || tx.status === 'APPROVED'
                        ? 'text-emerald-400'
                        : tx.status === 'FAILED' || tx.status === 'REJECTED'
                        ? 'text-red-400'
                        : 'text-amber-400'
                    }`}
                  >
                    {tx.status}
                  </td>
                  <td className="p-2 text-right text-slate-400">{tx.timestamp}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ModalShell>
  );
};

/* ---------------- STAFF CONTROL MODAL ---------------- */
export const StaffControlModal: React.FC<{
  userRole: UserRole;
  currentUserUid: string;
  brandLogoUrl?: string | null;
  onSaveBrandLogo?: (logoUrl: string | null) => Promise<boolean>;
  csrTelegramLink: string;
  platformStats: PlatformStats;
  platformDescription: string;
  faqEntries: FaqEntry[];
  depositRateMMK: number;
  withdrawRateMMK: number;
  depositAccounts: DepositAccounts;
  members: ManagedMember[];
  pendingDeposits: StaffWalletRequest[];
  pendingWithdrawals: StaffWalletRequest[];
  staffRequestsLoading: boolean;
  onRefreshStaffRequests: () => Promise<void>;
  onApproveDeposit: (req: StaffWalletRequest) => Promise<void>;
  onRejectDeposit: (req: StaffWalletRequest) => Promise<void>;
  onApproveWithdrawal: (req: StaffWalletRequest) => Promise<void>;
  onRejectWithdrawal: (req: StaffWalletRequest, reason: string) => Promise<void>;
  onExecuteBalanceAdjustByTarget: (payload: {
    identifier: string;
    wallet: 'real' | 'demo';
    action: 'add' | 'deduct';
    amount: number;
    reason: string;
  }) => Promise<boolean>;
  onAssignStaffRoleByTarget: (identifier: string, role: UserRole) => Promise<boolean>;
  onCopyText: (val: string, label: string) => void;
  onSearchMembers: (queryText: string) => Promise<void>;
  onToggleBlockMember: (uid: string, blocked: boolean) => Promise<void>;
  onToggleWithdrawBlock: (uid: string, blocked: boolean) => Promise<void>;
  onClearWithdrawLock: (uid: string) => Promise<void>;
  onAdjustMemberBalance: (
    uid: string,
    wallet: 'real' | 'demo',
    action: 'add' | 'deduct',
    amount: number
  ) => Promise<void>;
  onAssignMemberRole: (uid: string, role: UserRole) => Promise<void>;
  onAdminUpdateMemberProfile: (uid: string, payload: MemberProfileUpdatePayload) => Promise<boolean>;
  onSaveSettings: (payload: {
    csrTelegramLink: string;
    platformStats: PlatformStats;
    depositRateMMK: number;
    withdrawRateMMK: number;
    depositAccounts: DepositAccounts;
  }) => Promise<void>;
  adminCoins: AdminManagedCoin[];
  selectedCoinAnalytics: CoinTradeAnalytics | null;
  coinAnalyticsLoading: boolean;
  onRefreshAdminCoins: () => Promise<void>;
  onUpsertAdminCoin: (payload: {
    symbol: string;
    label?: string;
    initialPrice: number;
    enabled?: boolean;
  }) => Promise<AdminManagedCoin | null>;
  onUpdateCoinPriceControl: (
    symbol: string,
    payload: {
      mode?: CoinScheduleMode | 'stop' | 'pause' | 'resume';
      manualPrice?: number;
      deltaPct?: number;
      transitionSec?: number;
      upTargetPrice?: number;
      upDurationSec?: number;
      downTargetPrice?: number;
      downDurationSec?: number;
      repeatLoop?: boolean;
      enabled?: boolean;
      trendBias?: CoinTrendBias;
      volatilityLevel?: CoinVolatilityLevel;
      resetBaseline?: boolean;
    }
  ) => Promise<AdminManagedCoin | null>;
  onDeleteAdminCoin: (symbol: string) => Promise<boolean>;
  onLoadCoinAnalytics: (symbol: string) => Promise<void>;
  onClaimCoinProfit: (symbol: string) => Promise<boolean>;
  lotteryState: LotteryLiveState | null;
  onRefreshLotteryState: () => Promise<void>;
  onUpdateLotteryConfig: (payload: {
    resultMode?: LotteryResultMode;
    forcedResult?: LotteryColor | null;
    forcedNumber?: number | null;
    feePct?: number;
    payoutMultiplier?: number;
    numberMultiplier?: number;
    roundDurationSec?: number;
    isPaused?: boolean;
    settleNow?: boolean;
  }) => Promise<boolean>;
  onScheduleDigitDraw?: (payload: DigitDrawSchedulePayload) => Promise<boolean>;
  onSaveFaqAndDesc: (desc: string, faqs: FaqEntry[]) => Promise<void>;
  initialTab?: StaffTabId;
  adminNews: NewsArticle[];
  adminNewsLoading: boolean;
  onRefreshAdminNews: () => Promise<void>;
  onCreateAdminNews: (payload: {
    title: string;
    summary: string;
    content: string;
    category: NewsCategory;
    authorName: string;
    imageUrl: string | null;
    isFeatured: boolean;
    isPublished: boolean;
  }) => Promise<boolean>;
  onUpdateAdminNews: (
    id: number,
    updates: Partial<{
      title: string;
      summary: string;
      content: string;
      category: NewsCategory;
      authorName: string;
      imageUrl: string | null;
      isFeatured: boolean;
      isPublished: boolean;
    }>
  ) => Promise<boolean>;
  onDeleteAdminNews: (id: number) => Promise<boolean>;
  onClose: () => void;
}> = ({
  userRole,
  currentUserUid,
  brandLogoUrl,
  onSaveBrandLogo,
  csrTelegramLink,
  platformStats,
  platformDescription,
  faqEntries,
  depositRateMMK,
  withdrawRateMMK,
  depositAccounts,
  members,
  pendingDeposits,
  pendingWithdrawals,
  staffRequestsLoading,
  onRefreshStaffRequests,
  onApproveDeposit,
  onRejectDeposit,
  onApproveWithdrawal,
  onRejectWithdrawal,
  onExecuteBalanceAdjustByTarget,
  onAssignStaffRoleByTarget,
  onCopyText,
  onSearchMembers,
  onToggleBlockMember,
  onToggleWithdrawBlock,
  onClearWithdrawLock,
  onAdjustMemberBalance,
  onAssignMemberRole,
  onAdminUpdateMemberProfile,
  onSaveSettings,
  adminCoins,
  selectedCoinAnalytics,
  coinAnalyticsLoading,
  onRefreshAdminCoins,
  onUpsertAdminCoin,
  onUpdateCoinPriceControl,
  onDeleteAdminCoin,
  onLoadCoinAnalytics,
  onClaimCoinProfit,
  lotteryState,
  onRefreshLotteryState,
  onUpdateLotteryConfig,
  onScheduleDigitDraw,
  onSaveFaqAndDesc,
  initialTab: initialTabProp,
  adminNews,
  adminNewsLoading,
  onRefreshAdminNews,
  onCreateAdminNews,
  onUpdateAdminNews,
  onDeleteAdminNews,
  onClose,
}) => {
  const isAdmin = userRole === 'admin';
  const allowedTabs = getAllowedStaffTabs(userRole);
  const defaultInitialTab: StaffTabId =
    initialTabProp && allowedTabs.includes(initialTabProp)
      ? initialTabProp
      : userRole === 'caiwu'
      ? 'caiwu'
      : userRole === 'chukuan'
      ? 'chukuan'
      : allowedTabs[0] || 'rates';

  const [tab, setTab] = useState<StaffTabId>(defaultInitialTab);

  // Settings Tab State
  const [csr, setCsr] = useState(csrTelegramLink);
  const [membersCount, setMembersCount] = useState(String(platformStats.membersCount));
  const [totalDeposits, setTotalDeposits] = useState(platformStats.totalDeposits);
  const [totalWithdrawals, setTotalWithdrawals] = useState(platformStats.totalWithdrawals);
  const [depRate, setDepRate] = useState(String(depositRateMMK));
  const [wdRate, setWdRate] = useState(String(withdrawRateMMK));
  const [kpayName, setKpayName] = useState(depositAccounts.kpay.name);
  const [kpayNum, setKpayNum] = useState(depositAccounts.kpay.number);
  const [waveName, setWaveName] = useState(depositAccounts.wavepay.name);
  const [waveNum, setWaveNum] = useState(depositAccounts.wavepay.number);
  const [usdtAddr, setUsdtAddr] = useState(depositAccounts.usdt.number);

  // Admin Brand Logo & Favicon State
  const [logoDraft, setLogoDraft] = useState(brandLogoUrl || '');
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const logoFileInputRef = useRef<HTMLInputElement | null>(null);

  // Coin & Price Control Tab State (Admin-only)
  const [coinSymbolInput, setCoinSymbolInput] = useState('XU/USDT');
  const [coinInitPriceInput, setCoinInitPriceInput] = useState('100');
  const [selectedAdminCoinSymbol, setSelectedAdminCoinSymbol] = useState('XUUSDT');
  const [manualPriceInput, setManualPriceInput] = useState('100');
  const [transitionSecInput, setTransitionSecInput] = useState('30');
  const [upTargetInput, setUpTargetInput] = useState('112');
  const [upDurationInput, setUpDurationInput] = useState('60');
  const [downTargetInput, setDownTargetInput] = useState('80');
  const [downDurationInput, setDownDurationInput] = useState('90');
  const [durationUnit, setDurationUnit] = useState<'sec' | 'min'>('sec');
  const [confirmDeleteSymbol, setConfirmDeleteSymbol] = useState<string | null>(null);
  const [tradeFilter, setTradeFilter] = useState<'all' | 'open' | 'wins' | 'loss'>('all');
  const [tickNowMs, setTickNowMs] = useState(() => Date.now());
  const [coinBusy, setCoinBusy] = useState(false);

  // Description & Q&A Tab State
  const [descText, setDescText] = useState(platformDescription);
  const [faqs, setFaqs] = useState<FaqEntry[]>(faqEntries);

  // Deposits / Withdrawals processing State
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [rejectingWdId, setRejectingWdId] = useState<string | null>(null);
  const [rejectWdReason, setRejectWdReason] = useState('');

  // Member Adjust Tab State
  const [adjTarget, setAdjTarget] = useState('');
  const [adjAction, setAdjAction] = useState<'add' | 'deduct'>('add');
  const [adjWallet, setAdjWallet] = useState<'real' | 'demo'>('real');
  const [adjAmount, setAdjAmount] = useState('100');
  const [adjReason, setAdjReason] = useState('');
  const [adjBusy, setAdjBusy] = useState(false);

  // Search Member Tab State
  const [memberQuery, setMemberQuery] = useState('');
  const [adjustAmounts, setAdjustAmounts] = useState<Record<string, string>>({});
  const [adjustWallets, setAdjustWallets] = useState<Record<string, 'real' | 'demo'>>({});
  const [roleDrafts, setRoleDrafts] = useState<Record<string, UserRole>>({});
  const [isSearchingMembers, setIsSearchingMembers] = useState(false);
  const [editingMemberUid, setEditingMemberUid] = useState<string | null>(null);
  const [memberEditDraft, setMemberEditDraft] = useState<MemberProfileUpdatePayload>({});
  const [memberEditBusy, setMemberEditBusy] = useState(false);
  const [memberEditError, setMemberEditError] = useState<string | null>(null);

  // Manage Staff Tab State
  const [roleTargetIdentifier, setRoleTargetIdentifier] = useState('');
  const [roleTargetValue, setRoleTargetValue] = useState<UserRole>('staff');
  const [roleAssignBusy, setRoleAssignBusy] = useState(false);

  // Admin News Desk State
  const [editingNewsId, setEditingNewsId] = useState<number | null>(null);
  const [newsTitle, setNewsTitle] = useState('');
  const [newsCategory, setNewsCategory] = useState<NewsCategory>('Market Brief');
  const [newsAuthor, setNewsAuthor] = useState('Zectrade Research Desk');
  const [newsSummary, setNewsSummary] = useState('');
  const [newsContent, setNewsContent] = useState('');
  const [newsImageUrl, setNewsImageUrl] = useState('/src/assets/images/news_lead_macro_1794937556483.jpg');
  const [newsFeatured, setNewsFeatured] = useState(false);
  const [newsPublished, setNewsPublished] = useState(true);
  const [newsBusy, setNewsBusy] = useState(false);
  const [newsFormError, setNewsFormError] = useState<string | null>(null);
  const [confirmDeleteNewsId, setConfirmDeleteNewsId] = useState<number | null>(null);

  useEffect(() => {
    if (initialTabProp && allowedTabs.includes(initialTabProp)) {
      setTab(initialTabProp);
    }
  }, [initialTabProp, allowedTabs]);

  useEffect(() => {
    if (!allowedTabs.includes(tab) && allowedTabs.length > 0) {
      setTab(allowedTabs[0]);
    }
  }, [allowedTabs, tab]);

  const resetNewsEditor = () => {
    setEditingNewsId(null);
    setNewsTitle('');
    setNewsCategory('Market Brief');
    setNewsAuthor('Zectrade Research Desk');
    setNewsSummary('');
    setNewsContent('');
    setNewsImageUrl('/src/assets/images/news_lead_macro_1794937556483.jpg');
    setNewsFeatured(false);
    setNewsPublished(true);
    setNewsFormError(null);
  };

  const loadNewsArticleForEdit = (article: NewsArticle) => {
    setEditingNewsId(article.id);
    setNewsTitle(article.title);
    setNewsCategory(article.category);
    setNewsAuthor(article.authorName);
    setNewsSummary(article.summary);
    setNewsContent(article.content);
    setNewsImageUrl(article.imageUrl ?? '');
    setNewsFeatured(article.isFeatured);
    setNewsPublished(article.isPublished);
    setNewsFormError(null);
  };

  const handleNewsCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setNewsFormError(null);
    try {
      const dataUrl = await resizeImageFileToAvatarDataUrl(file, 960);
      setNewsImageUrl(dataUrl);
    } catch (err) {
      setNewsFormError(err instanceof Error ? err.message : 'Unable to process cover image.');
    }
  };

  const handleNewsFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewsFormError(null);
    const title = newsTitle.trim();
    const summary = newsSummary.trim();
    const content = newsContent.trim();
    const authorName = newsAuthor.trim() || 'Zectrade Research Desk';

    if (title.length < 4) {
      setNewsFormError('Headline title must be at least 4 characters.');
      return;
    }
    if (summary.length < 10) {
      setNewsFormError('Summary deck must be at least 10 characters.');
      return;
    }
    if (content.length < 20) {
      setNewsFormError('Article body must be at least 20 characters.');
      return;
    }

    setNewsBusy(true);
    try {
      const payload = {
        title,
        summary,
        content,
        category: newsCategory,
        authorName,
        imageUrl: newsImageUrl.trim() ? newsImageUrl.trim() : null,
        isFeatured: newsFeatured,
        isPublished: newsPublished,
      };
      const ok =
        editingNewsId !== null
          ? await onUpdateAdminNews(editingNewsId, payload)
          : await onCreateAdminNews(payload);
      if (ok) {
        resetNewsEditor();
      }
    } finally {
      setNewsBusy(false);
    }
  };

  const activeAdminCoin =
    adminCoins.find((c) => c.symbol === selectedAdminCoinSymbol) ?? adminCoins[0] ?? null;
  const activeCoinSym = activeAdminCoin?.symbol ?? selectedAdminCoinSymbol;

  const coinCallbacksRef = useRef({ onRefreshAdminCoins, onLoadCoinAnalytics });
  coinCallbacksRef.current = { onRefreshAdminCoins, onLoadCoinAnalytics };

  useEffect(() => {
    if (adminCoins.length > 0 && !adminCoins.some((c) => c.symbol === selectedAdminCoinSymbol)) {
      setSelectedAdminCoinSymbol(adminCoins[0].symbol);
    }
  }, [adminCoins, selectedAdminCoinSymbol]);

  useEffect(() => {
    if (!isAdmin || tab !== 'coins') return;
    coinCallbacksRef.current.onRefreshAdminCoins();
    if (activeCoinSym) {
      coinCallbacksRef.current.onLoadCoinAnalytics(activeCoinSym);
    }
    const timer = setInterval(() => {
      coinCallbacksRef.current.onRefreshAdminCoins();
      if (activeCoinSym) coinCallbacksRef.current.onLoadCoinAnalytics(activeCoinSym);
    }, 2000);
    const clockTimer = setInterval(() => {
      setTickNowMs(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
      clearInterval(clockTimer);
    };
  }, [isAdmin, tab, activeCoinSym]);

  const handleSaveRates = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSaveSettings({
      csrTelegramLink: csr.trim() || csrTelegramLink,
      platformStats: {
        membersCount: Number(membersCount) || platformStats.membersCount,
        totalDeposits,
        totalWithdrawals,
      },
      depositRateMMK: Number(depRate) || 4300,
      withdrawRateMMK: Number(wdRate) || 4300,
      depositAccounts: {
        ...depositAccounts,
        kpay: { name: kpayName, number: kpayNum },
        wavepay: { name: waveName, number: waveNum },
        usdt: { name: 'TRC20 Wallet', number: usdtAddr },
      },
    });
  };

  const handleMemberSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSearchingMembers(true);
    try {
      await onSearchMembers(memberQuery.trim());
    } finally {
      setIsSearchingMembers(false);
    }
  };

  const handleExecuteMemberAdjustForm = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(adjAmount);
    if (!adjTarget.trim() || !Number.isFinite(amt) || amt <= 0) return;
    setAdjBusy(true);
    try {
      const ok = await onExecuteBalanceAdjustByTarget({
        identifier: adjTarget.trim(),
        wallet: adjWallet,
        action: adjAction,
        amount: amt,
        reason: adjReason.trim() || 'System Balance Adjustment',
      });
      if (ok) {
        setAdjAmount('100');
        setAdjReason('');
      }
    } finally {
      setAdjBusy(false);
    }
  };

  const handleExecuteRoleAssignForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleTargetIdentifier.trim()) return;
    setRoleAssignBusy(true);
    try {
      const ok = await onAssignStaffRoleByTarget(roleTargetIdentifier.trim(), roleTargetValue);
      if (ok) {
        setRoleTargetIdentifier('');
      }
    } finally {
      setRoleAssignBusy(false);
    }
  };

  const filteredMembers = members.filter((m) => {
    if (!isAdmin && m.role !== 'user') return false;
    const q = memberQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      m.uid.toLowerCase().includes(q) ||
      m.email.toLowerCase().includes(q) ||
      m.username.toLowerCase().includes(q)
    );
  });

  const tabConfigs: Array<{
    id: StaffTabId;
    label: string;
    activeClass: string;
  }> = [
    { id: 'rates', label: 'Rates & Platform Stats', activeClass: 'bg-purple-600 text-white' },
    { id: 'coins', label: 'Coin & Price Control', activeClass: 'bg-amber-500 text-slate-950 font-bold' },
    { id: 'lottery', label: 'Lottery Live Control', activeClass: 'bg-emerald-600 text-white font-bold' },
    { id: 'news', label: `News Desk (${adminNews.length})`, activeClass: 'bg-blue-600 text-white font-bold' },
    { id: 'faq', label: 'Edit Description & Q&A', activeClass: 'bg-amber-500 text-slate-950 font-bold' },
    { id: 'caiwu', label: `Deposits (${pendingDeposits.length})`, activeClass: 'bg-emerald-600 text-white font-bold' },
    { id: 'chukuan', label: `Withdrawals (${pendingWithdrawals.length})`, activeClass: 'bg-sky-600 text-white font-bold' },
    { id: 'admin', label: 'Member Adjust', activeClass: 'bg-red-600 text-white font-bold' },
    { id: 'search', label: 'Search Member', activeClass: 'bg-slate-700 text-white font-bold' },
    { id: 'roles', label: 'Manage Staff', activeClass: 'bg-purple-600 text-white font-bold' },
  ];

  const visibleTabs = tabConfigs.filter((t) => allowedTabs.includes(t.id));

  return (
    <ModalShell title={`Staff Control Panel (${userRole.toUpperCase()})`} onClose={onClose} maxWidth="max-w-4xl">
      {/* Role-Scoped Horizontal Tab Strip (wraps cleanly without horizontal clipping) */}
      <div
        role="tablist"
        aria-label="Staff Control Sections"
        className="flex flex-wrap bg-slate-950 p-1 rounded-xl border border-slate-800 text-[11px] font-semibold gap-1 shrink-0"
      >
        {visibleTabs.map((item) => {
          const isActive = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setTab(item.id)}
              className={`px-2.5 py-1.5 rounded-lg transition whitespace-nowrap ${
                isActive ? item.activeClass : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {/* TAB 1: RATES & PLATFORM STATS */}
      {tab === 'rates' && (
        <div className="space-y-4">
          {isAdmin && onSaveBrandLogo && (
            <div
              data-testid="admin-brand-logo-panel"
              className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-3 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="font-bold text-white">Brand Logo &amp; Browser Tab Icon</p>
                    <p className="text-[10px] text-slate-400">
                      Updates the browser tab favicon and navigation logo across the platform.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5">
                  <img
                    src={logoDraft.trim() || DEFAULT_BRAND_LOGO_URL}
                    alt="Browser tab icon preview"
                    data-testid="admin-brand-logo-preview"
                    onError={(e) => {
                      const img = e.currentTarget;
                      if (!img.dataset.fallbackApplied) {
                        img.dataset.fallbackApplied = '1';
                        img.src = DEFAULT_BRAND_LOGO_URL;
                      }
                    }}
                    className="w-4 h-4 rounded object-cover shrink-0"
                  />
                  <span className="text-[11px] font-semibold text-slate-200 whitespace-nowrap">
                    Zectrade Pulse
                  </span>
                  <span className="text-[10px] text-slate-500">Tab Preview</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                <div className="sm:col-span-7">
                  <label htmlFor="admin-brand-logo-url" className="text-[10px] text-slate-400 block mb-1">
                    Logo / Favicon URL or Uploaded Icon Data
                  </label>
                  <input
                    id="admin-brand-logo-url"
                    type="text"
                    value={logoDraft}
                    onChange={(e) => {
                      setLogoDraft(e.target.value);
                      setLogoError(null);
                    }}
                    placeholder="/favicon.svg or https://example.com/logo.png"
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white font-mono focus:outline-none focus:border-amber-400"
                  />
                </div>
                <div className="sm:col-span-5 flex flex-wrap sm:flex-nowrap items-center gap-2">
                  <input
                    ref={logoFileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      setLogoError(null);
                      try {
                        if (
                          file.type === 'image/svg+xml' ||
                          file.type === 'image/x-icon' ||
                          file.name.toLowerCase().endsWith('.svg') ||
                          file.name.toLowerCase().endsWith('.ico')
                        ) {
                          if (file.size > 250 * 1024) {
                            setLogoError('SVG/ICO icon must be under 250 KB.');
                            return;
                          }
                          const dataUrl = await new Promise<string>((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = () => resolve(String(reader.result || ''));
                            reader.onerror = () => reject(new Error('Failed to read icon file.'));
                            reader.readAsDataURL(file);
                          });
                          setLogoDraft(dataUrl);
                        } else {
                          const dataUrl = await resizeImageFileToAvatarDataUrl(file, 256);
                          setLogoDraft(dataUrl);
                        }
                      } catch (err) {
                        setLogoError(err instanceof Error ? err.message : 'Unable to process icon.');
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => logoFileInputRef.current?.click()}
                    className="px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <Upload className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                    <span>Upload</span>
                  </button>
                  <button
                    type="button"
                    disabled={logoBusy}
                    onClick={async () => {
                      const parsed = normalizeBrandLogoUrl(logoDraft);
                      if (!parsed.ok) {
                        setLogoError(parsed.error);
                        return;
                      }
                      setLogoError(null);
                      setLogoBusy(true);
                      try {
                        await onSaveBrandLogo(parsed.url);
                      } finally {
                        setLogoBusy(false);
                      }
                    }}
                    data-testid="admin-save-brand-logo-btn"
                    className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold whitespace-nowrap shrink-0"
                  >
                    {logoBusy ? 'Saving...' : 'Save Logo'}
                  </button>
                  <button
                    type="button"
                    disabled={logoBusy}
                    onClick={async () => {
                      setLogoError(null);
                      setLogoBusy(true);
                      try {
                        setLogoDraft('');
                        await onSaveBrandLogo(null);
                      } finally {
                        setLogoBusy(false);
                      }
                    }}
                    title="Reset to default Zectrade Pulse icon"
                    className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>

              {logoError && (
                <p className="text-[11px] text-red-400 font-medium">{logoError}</p>
              )}
            </div>
          )}

        <form onSubmit={handleSaveRates} className="space-y-3 text-xs">
          <div>
            <label className="text-[10px] text-slate-400 block mb-1">CSR Telegram Support Link</label>
            <input
              type="text"
              value={csr}
              onChange={(e) => setCsr(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-sky-300 font-mono"
            />
          </div>

          <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-purple-300">
              Landing Display Totals (Social Proof)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Members Count</label>
                <input
                  type="number"
                  value={membersCount}
                  onChange={(e) => setMembersCount(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 font-mono text-white"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Total Deposits</label>
                <input
                  type="text"
                  value={totalDeposits}
                  onChange={(e) => setTotalDeposits(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 font-mono text-emerald-400"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Total Withdrawals</label>
                <input
                  type="text"
                  value={totalWithdrawals}
                  onChange={(e) => setTotalWithdrawals(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 font-mono text-amber-400"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Deposit Rate (1 USD to MMK)</label>
              <input
                type="number"
                value={depRate}
                onChange={(e) => setDepRate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 font-mono text-white"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Withdraw Rate (1 USD to MMK)</label>
              <input
                type="number"
                value={wdRate}
                onChange={(e) => setWdRate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 font-mono text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">KBZPay Account Name</label>
              <input
                type="text"
                value={kpayName}
                onChange={(e) => setKpayName(e.target.value)}
                placeholder="KPay Name"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">KBZPay Phone Number</label>
              <input
                type="text"
                value={kpayNum}
                onChange={(e) => setKpayNum(e.target.value)}
                placeholder="KPay Number"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">WavePay Account Name</label>
              <input
                type="text"
                value={waveName}
                onChange={(e) => setWaveName(e.target.value)}
                placeholder="WavePay Name"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">WavePay Phone Number</label>
              <input
                type="text"
                value={waveNum}
                onChange={(e) => setWaveNum(e.target.value)}
                placeholder="WavePay Number"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white font-mono"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] text-slate-400 block mb-1">USDT TRC20 Wallet Address</label>
            <input
              type="text"
              value={usdtAddr}
              onChange={(e) => setUsdtAddr(e.target.value)}
              placeholder="USDT TRC20 Address"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white font-mono"
            />
          </div>

          <button type="submit" className="w-full py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold">
            Save Settings
          </button>
        </form>
        </div>
      )}

      {/* TAB 1B: ADMIN CUSTOM COIN & PRICE LIQUIDATION CONTROL */}
      {tab === 'coins' && isAdmin && (
        <div className="space-y-3 text-xs" data-testid="admin-coin-control-panel">
          {/* Official Launch / Add Custom Coin */}
          <div className="bg-slate-950 border border-amber-500/35 rounded-xl p-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-1.5">
                  <Coins className="w-4 h-4 text-amber-400" />
                  <span className="font-bold text-amber-300">Official Launch Coin to Main Market (e.g., XU/USDT)</span>
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  All members can trade launched coins on Main Market. Only Admin can add, launch, or adjust prices up &amp; down.
                </p>
              </div>
              <button
                type="button"
                disabled={coinBusy}
                onClick={async () => {
                  setCoinBusy(true);
                  try {
                    const created = await onUpsertAdminCoin({
                      symbol: 'XU/USDT',
                      label: 'XU / USDT',
                      initialPrice: 100,
                      enabled: true,
                    });
                    if (created) {
                      setSelectedAdminCoinSymbol(created.symbol);
                      setManualPriceInput(String(created.currentPrice));
                      await onLoadCoinAnalytics(created.symbol);
                    }
                  } finally {
                    setCoinBusy(false);
                  }
                }}
                className="px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-[11px]"
              >
                + Official Launch XU/USDT ($100)
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const price = parseFloat(coinInitPriceInput);
                if (!coinSymbolInput.trim() || !Number.isFinite(price) || price <= 0) return;
                setCoinBusy(true);
                try {
                  const created = await onUpsertAdminCoin({
                    symbol: coinSymbolInput.trim(),
                    initialPrice: price,
                    enabled: true,
                  });
                  if (created) {
                    setSelectedAdminCoinSymbol(created.symbol);
                    setManualPriceInput(String(created.currentPrice));
                    setUpTargetInput((created.currentPrice * 1.12).toFixed(2));
                    setDownTargetInput((created.currentPrice * 0.78).toFixed(2));
                    await onLoadCoinAnalytics(created.symbol);
                  }
                } finally {
                  setCoinBusy(false);
                }
              }}
              className="grid grid-cols-1 sm:grid-cols-12 gap-2"
            >
              <div className="sm:col-span-5">
                <label htmlFor="admin-coin-sym" className="text-[10px] text-slate-400 block mb-1">
                  Coin Pair / Symbol
                </label>
                <input
                  id="admin-coin-sym"
                  type="text"
                  required
                  value={coinSymbolInput}
                  onChange={(e) => setCoinSymbolInput(e.target.value)}
                  placeholder="XU/USDT"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white font-mono uppercase"
                />
              </div>
              <div className="sm:col-span-4">
                <label htmlFor="admin-coin-price" className="text-[10px] text-slate-400 block mb-1">
                  Launch Price ($ USD)
                </label>
                <input
                  id="admin-coin-price"
                  type="number"
                  min="0.0001"
                  step="any"
                  required
                  value={coinInitPriceInput}
                  onChange={(e) => setCoinInitPriceInput(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white font-mono"
                />
              </div>
              <div className="sm:col-span-3 flex items-end">
                <button
                  type="submit"
                  disabled={coinBusy}
                  className="w-full py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold"
                >
                  {coinBusy ? 'Launching...' : 'Official Launch'}
                </button>
              </div>
            </form>

            {adminCoins.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {adminCoins.map((c) => {
                  const isSel = activeAdminCoin?.symbol === c.symbol;
                  return (
                    <button
                      key={c.symbol}
                      type="button"
                      onClick={() => {
                        setSelectedAdminCoinSymbol(c.symbol);
                        setManualPriceInput(String(c.currentPrice));
                        setUpTargetInput((c.currentPrice * 1.12).toFixed(2));
                        setDownTargetInput(
                          selectedCoinAnalytics?.recommendedLiqBottomPrice
                            ? String(selectedCoinAnalytics.recommendedLiqBottomPrice)
                            : (c.currentPrice * 0.78).toFixed(2)
                        );
                        onLoadCoinAnalytics(c.symbol);
                      }}
                      className={`px-2.5 py-1 rounded-lg border font-mono text-[11px] flex items-center gap-1.5 transition ${
                        isSel
                          ? 'bg-amber-500/20 border-amber-400 text-amber-200 font-bold'
                          : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <span>{c.shortName}</span>
                      <span className="text-white">${formatChartPrice(c.currentPrice)}</span>
                      <span className={c.enabled ? 'text-emerald-400' : 'text-red-400'}>
                        {c.enabled ? '●' : '○'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {activeAdminCoin ? (
            <>
              {/* Price Arrangement & Continuous Market Control */}
              {(() => {
                const sched = activeAdminCoin.schedule;
                const isSchedActive = Boolean(sched?.active);
                const isPaused = Boolean(sched?.paused);
                const trendBias: CoinTrendBias = sched?.trendBias ?? 'neutral';
                const volLevel: CoinVolatilityLevel = sched?.volatilityLevel ?? 'normal';
                const glideSec = Math.max(0, Math.min(3600, Math.round(parseFloat(transitionSecInput) || 0)));
                const unitMultiplier = durationUnit === 'min' ? 60 : 1;
                const scheduleEval = isSchedActive
                  ? computeScheduledCoinPrice(
                      { currentPrice: activeAdminCoin.currentPrice, schedule: sched },
                      isPaused && sched?.pausedAtMs ? sched.pausedAtMs : tickNowMs
                    )
                  : null;

                return (
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-white text-sm">{activeAdminCoin.label}</span>
                          <span className="text-xs font-mono font-bold text-amber-400">
                            Live: ${formatChartPrice(activeAdminCoin.currentPrice)}
                          </span>
                          <span
                            className={`text-[10px] font-mono font-bold ${
                              activeAdminCoin.changePct >= 0 ? 'text-emerald-400' : 'text-red-400'
                            }`}
                          >
                            {activeAdminCoin.changePct >= 0 ? '+' : ''}
                            {activeAdminCoin.changePct.toFixed(2)}%
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400 font-mono">
                          Mode:{' '}
                          {isSchedActive
                            ? isPaused
                              ? `PAUSED (${sched?.mode.toUpperCase()})`
                              : sched?.repeatLoop
                              ? 'AUTO LOOP UP ⇅ DOWN (GRADUAL)'
                              : sched?.mode === 'glide_to_target'
                              ? 'GRADUAL GLIDE TO TARGET'
                              : sched?.mode.toUpperCase()
                            : `LIVE ORGANIC MARKET (${trendBias.toUpperCase()} · ${volLevel.toUpperCase()})`}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          disabled={coinBusy}
                          onClick={async () => {
                            setCoinBusy(true);
                            try {
                              await onUpdateCoinPriceControl(activeAdminCoin.symbol, {
                                enabled: !activeAdminCoin.enabled,
                              });
                            } finally {
                              setCoinBusy(false);
                            }
                          }}
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border ${
                            activeAdminCoin.enabled
                              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                              : 'bg-red-500/15 text-red-300 border-red-500/40'
                          }`}
                        >
                          {activeAdminCoin.enabled ? 'Official Live (Main Market)' : 'Hidden from Market'}
                        </button>
                        <button
                          type="button"
                          disabled={coinBusy}
                          onClick={async () => {
                            setCoinBusy(true);
                            try {
                              await onUpdateCoinPriceControl(activeAdminCoin.symbol, {
                                resetBaseline: true,
                              });
                            } finally {
                              setCoinBusy(false);
                            }
                          }}
                          className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-[10px] font-semibold flex items-center gap-1"
                          title="Reset 24h % change baseline to current price"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Reset 24h %</span>
                        </button>
                        {confirmDeleteSymbol === activeAdminCoin.symbol ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={coinBusy}
                              onClick={async () => {
                                setCoinBusy(true);
                                try {
                                  await onDeleteAdminCoin(activeAdminCoin.symbol);
                                  setConfirmDeleteSymbol(null);
                                } finally {
                                  setCoinBusy(false);
                                }
                              }}
                              className="px-2 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white text-[10px] font-bold"
                            >
                              Confirm Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteSymbol(null)}
                              className="px-2 py-1 rounded-lg bg-slate-800 text-slate-300 text-[10px]"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={coinBusy}
                            onClick={() => setConfirmDeleteSymbol(activeAdminCoin.symbol)}
                            className="p-1.5 rounded-lg bg-slate-900 hover:bg-red-950/60 border border-slate-800 hover:border-red-500/40 text-slate-400 hover:text-red-300"
                            aria-label="Delete custom coin"
                            title="Delete custom coin"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            onRefreshAdminCoins();
                            onLoadCoinAnalytics(activeAdminCoin.symbol);
                          }}
                          className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white"
                          aria-label="Refresh coin price and analytics"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${coinAnalyticsLoading ? 'animate-spin' : ''}`} />
                        </button>
                      </div>
                    </div>

                    {/* Live Active Schedule Progress & Pause / Resume Controls */}
                    {isSchedActive && sched && (
                      <div className="bg-sky-950/30 border border-sky-500/35 rounded-lg p-2.5 space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          <div className="flex items-center gap-2 font-mono">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                isPaused
                                  ? 'bg-amber-500/20 text-amber-300'
                                  : scheduleEval?.phase === 'up'
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : 'bg-red-500/20 text-red-300'
                              }`}
                            >
                              {isPaused
                                ? 'PAUSED'
                                : scheduleEval?.phase === 'up'
                                ? '↗ GRADUAL UP'
                                : '↘ GRADUAL DOWN'}
                            </span>
                            <span className="text-slate-300">
                              ${formatChartPrice(sched.startPrice)} → $
                              {formatChartPrice(
                                sched.mode === 'glide_to_target'
                                  ? sched.upTargetPrice
                                  : sched.mode === 'down_sweep'
                                  ? sched.downTargetPrice
                                  : scheduleEval?.phase === 'up'
                                  ? sched.upTargetPrice
                                  : sched.downTargetPrice
                              )}
                            </span>
                            <span className="text-sky-300 font-bold">
                              {scheduleEval?.progressPct ?? 0}% · {scheduleEval?.remainingSec ?? 0}s left
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {isPaused ? (
                              <button
                                type="button"
                                disabled={coinBusy}
                                onClick={async () => {
                                  setCoinBusy(true);
                                  try {
                                    await onUpdateCoinPriceControl(activeAdminCoin.symbol, { mode: 'resume' });
                                  } finally {
                                    setCoinBusy(false);
                                  }
                                }}
                                className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] flex items-center gap-1"
                              >
                                <Play className="w-3 h-3" />
                                <span>Resume</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={coinBusy}
                                onClick={async () => {
                                  setCoinBusy(true);
                                  try {
                                    await onUpdateCoinPriceControl(activeAdminCoin.symbol, { mode: 'pause' });
                                  } finally {
                                    setCoinBusy(false);
                                  }
                                }}
                                className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[10px] flex items-center gap-1"
                              >
                                <Pause className="w-3 h-3" />
                                <span>Pause / Freeze</span>
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={coinBusy}
                              onClick={async () => {
                                setCoinBusy(true);
                                try {
                                  await onUpdateCoinPriceControl(activeAdminCoin.symbol, { mode: 'stop' });
                                } finally {
                                  setCoinBusy(false);
                                }
                              }}
                              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-[10px]"
                            >
                              Stop
                            </button>
                          </div>
                        </div>
                        <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-500 ${
                              isPaused ? 'bg-amber-400' : scheduleEval?.phase === 'up' ? 'bg-emerald-400' : 'bg-sky-400'
                            }`}
                            style={{ width: `${Math.max(4, scheduleEval?.progressPct ?? 0)}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Gradual Transition Speed Selector + Target Price + Sweep */}
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900/60 border border-slate-800 rounded-lg px-2.5 py-1.5">
                        <span className="text-[10px] font-bold text-amber-300">
                          Move Speed (Smooth Transition):
                        </span>
                        <div className="flex flex-wrap items-center gap-1">
                          {[
                            { label: '0s Instant', sec: '0' },
                            { label: '15s', sec: '15' },
                            { label: '30s Slow', sec: '30' },
                            { label: '1m (60s)', sec: '60' },
                            { label: '3m (180s)', sec: '180' },
                            { label: '5m (300s)', sec: '300' },
                          ].map((preset) => (
                            <button
                              key={preset.sec}
                              type="button"
                              onClick={() => setTransitionSecInput(preset.sec)}
                              className={`px-2 py-0.5 rounded text-[10px] font-mono border transition ${
                                transitionSecInput === preset.sec
                                  ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold'
                                  : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                              }`}
                            >
                              {preset.label}
                            </button>
                          ))}
                          <div className="flex items-center gap-1 ml-1">
                            <input
                              aria-label="Custom move transition seconds"
                              type="number"
                              min="0"
                              max="3600"
                              value={transitionSecInput}
                              onChange={(e) => setTransitionSecInput(e.target.value)}
                              className="w-14 bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-[10px] font-mono text-white text-center"
                            />
                            <span className="text-[10px] text-slate-400">sec</span>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                        <div className="sm:col-span-5">
                          <label htmlFor="admin-manual-price" className="text-[10px] text-slate-400 block mb-1">
                            Target Price ($ USD)
                          </label>
                          <input
                            id="admin-manual-price"
                            type="number"
                            min="0.0001"
                            step="any"
                            value={manualPriceInput}
                            onChange={(e) => setManualPriceInput(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white font-mono"
                          />
                        </div>
                        <div className="sm:col-span-3">
                          <button
                            type="button"
                            disabled={coinBusy}
                            onClick={async () => {
                              const p = parseFloat(manualPriceInput);
                              if (!Number.isFinite(p) || p <= 0) return;
                              setCoinBusy(true);
                              try {
                                await onUpdateCoinPriceControl(activeAdminCoin.symbol, {
                                  mode: glideSec > 0 ? 'glide_to_target' : 'manual',
                                  manualPrice: p,
                                  transitionSec: glideSec,
                                });
                              } finally {
                                setCoinBusy(false);
                              }
                            }}
                            className="w-full py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold"
                          >
                            {glideSec > 0 ? `Move Gradually (${glideSec}s)` : 'Set Price Instant'}
                          </button>
                        </div>
                        <div className="sm:col-span-4">
                          <button
                            type="button"
                            disabled={coinBusy}
                            onClick={async () => {
                              const targetBottom =
                                selectedCoinAnalytics?.recommendedLiqBottomPrice ??
                                Math.max(0.01, Number((activeAdminCoin.currentPrice * 0.72).toFixed(4)));
                              const dur = Math.max(
                                5,
                                glideSec > 0 ? glideSec : (parseFloat(downDurationInput) || 45) * unitMultiplier
                              );
                              setDownTargetInput(String(targetBottom));
                              setCoinBusy(true);
                              try {
                                await onUpdateCoinPriceControl(activeAdminCoin.symbol, {
                                  mode: 'down_sweep',
                                  downTargetPrice: targetBottom,
                                  downDurationSec: dur,
                                });
                              } finally {
                                setCoinBusy(false);
                              }
                            }}
                            className="w-full py-1.5 px-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold flex items-center justify-center gap-1"
                          >
                            <TrendingDown className="w-3.5 h-3.5" />
                            <span>
                              Slow Liq Sweep ({glideSec > 0 ? glideSec : Math.max(5, (parseFloat(downDurationInput) || 45) * unitMultiplier)}s)
                            </span>
                          </button>
                        </div>
                      </div>

                      {/* Quick Up & Down Price Adjustments (Smooth glide when transitionSec > 0) */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] text-slate-400 font-semibold mr-1">
                          Quick Adjust ({glideSec > 0 ? `${glideSec}s Smooth` : 'Instant'}):
                        </span>
                        {[-10, -5, -2, 2, 5, 10].map((pct) => (
                          <button
                            key={pct}
                            type="button"
                            disabled={coinBusy}
                            onClick={async () => {
                              setCoinBusy(true);
                              try {
                                const res = await onUpdateCoinPriceControl(activeAdminCoin.symbol, {
                                  deltaPct: pct,
                                  transitionSec: glideSec,
                                });
                                if (res) {
                                  setManualPriceInput(
                                    String(
                                      glideSec > 0
                                        ? Number((res.currentPrice * (1 + pct / 100)).toFixed(3))
                                        : res.currentPrice
                                    )
                                  );
                                }
                              } finally {
                                setCoinBusy(false);
                              }
                            }}
                            className={`px-2 py-1 rounded border text-[10px] font-mono font-bold transition disabled:opacity-50 ${
                              pct > 0
                                ? 'bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/40 text-emerald-300'
                                : 'bg-red-500/15 hover:bg-red-500/25 border-red-500/40 text-red-300'
                            }`}
                          >
                            {pct > 0 ? `+${pct}% Up` : `${pct}% Down`}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Ongoing Live Market Trend Bias & Volatility Control */}
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900/50 border border-slate-800 rounded-lg p-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-bold text-slate-300 flex items-center gap-1 mr-1">
                          <Activity className="w-3.5 h-3.5 text-sky-400" />
                          <span>Live Trend:</span>
                        </span>
                        {(
                          [
                            { id: 'up', label: '↗ Slow Bull', cls: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/15' },
                            { id: 'neutral', label: '↔ Sideways', cls: 'text-slate-200 border-slate-600 bg-slate-800' },
                            { id: 'down', label: '↘ Slow Bear', cls: 'text-red-300 border-red-500/40 bg-red-500/15' },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            disabled={coinBusy}
                            onClick={async () => {
                              setCoinBusy(true);
                              try {
                                await onUpdateCoinPriceControl(activeAdminCoin.symbol, { trendBias: opt.id });
                              } finally {
                                setCoinBusy(false);
                              }
                            }}
                            className={`px-2 py-0.5 rounded border text-[10px] font-bold transition ${
                              trendBias === opt.id
                                ? opt.cls
                                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-[10px] text-slate-400 mr-1">Volatility:</span>
                        {(['calm', 'normal', 'active'] as const).map((lvl) => (
                          <button
                            key={lvl}
                            type="button"
                            disabled={coinBusy}
                            onClick={async () => {
                              setCoinBusy(true);
                              try {
                                await onUpdateCoinPriceControl(activeAdminCoin.symbol, { volatilityLevel: lvl });
                              } finally {
                                setCoinBusy(false);
                              }
                            }}
                            className={`px-2 py-0.5 rounded border text-[10px] capitalize font-semibold transition ${
                              volLevel === lvl
                                ? 'bg-sky-500/20 border-sky-400 text-sky-200'
                                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                            }`}
                          >
                            {lvl}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Timed Up -> Down Schedule & Continuous Loop (Smooth Easing) */}
                    <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-2.5 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-sky-300 flex items-center gap-1">
                          <TrendingUp className="w-3.5 h-3.5" />
                          <span>Gradual Up &amp; Down Schedule (Smooth Ease · Loop or 1x)</span>
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="inline-flex rounded border border-slate-800 bg-slate-950 p-0.5 text-[10px]">
                            <button
                              type="button"
                              onClick={() => {
                                if (durationUnit === 'min') {
                                  setUpDurationInput(String(Math.round((parseFloat(upDurationInput) || 1) * 60)));
                                  setDownDurationInput(String(Math.round((parseFloat(downDurationInput) || 1.5) * 60)));
                                  setDurationUnit('sec');
                                }
                              }}
                              className={`px-2 py-0.5 rounded ${
                                durationUnit === 'sec' ? 'bg-sky-600 text-white font-bold' : 'text-slate-400'
                              }`}
                            >
                              Sec
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (durationUnit === 'sec') {
                                  setUpDurationInput(String(Number(((parseFloat(upDurationInput) || 60) / 60).toFixed(2))));
                                  setDownDurationInput(String(Number(((parseFloat(downDurationInput) || 90) / 60).toFixed(2))));
                                  setDurationUnit('min');
                                }
                              }}
                              className={`px-2 py-0.5 rounded ${
                                durationUnit === 'min' ? 'bg-sky-600 text-white font-bold' : 'text-slate-400'
                              }`}
                            >
                              Min
                            </button>
                          </div>
                          {selectedCoinAnalytics?.recommendedLiqBottomPrice && (
                            <button
                              type="button"
                              onClick={() =>
                                setDownTargetInput(String(selectedCoinAnalytics.recommendedLiqBottomPrice))
                              }
                              className="text-[10px] font-mono text-red-300 hover:text-red-200 underline"
                            >
                              Long Liq (${formatChartPrice(selectedCoinAnalytics.recommendedLiqBottomPrice)})
                            </button>
                          )}
                          {selectedCoinAnalytics?.recommendedShortSqueezePrice && (
                            <button
                              type="button"
                              onClick={() =>
                                setUpTargetInput(String(selectedCoinAnalytics.recommendedShortSqueezePrice))
                              }
                              className="text-[10px] font-mono text-emerald-300 hover:text-emerald-200 underline"
                            >
                              Short Liq (${formatChartPrice(selectedCoinAnalytics.recommendedShortSqueezePrice)})
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Speed Presets for Schedule */}
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                        <span className="text-slate-400">Speed Presets:</span>
                        {[
                          { label: 'Gentle (30s / 45s)', upSec: 30, downSec: 45 },
                          { label: 'Slow (1m / 1.5m)', upSec: 60, downSec: 90 },
                          { label: 'Gradual (3m / 5m)', upSec: 180, downSec: 300 },
                          { label: 'Deep (10m / 15m)', upSec: 600, downSec: 900 },
                        ].map((sp) => (
                          <button
                            key={sp.label}
                            type="button"
                            onClick={() => {
                              setUpDurationInput(
                                durationUnit === 'min' ? String(Number((sp.upSec / 60).toFixed(2))) : String(sp.upSec)
                              );
                              setDownDurationInput(
                                durationUnit === 'min' ? String(Number((sp.downSec / 60).toFixed(2))) : String(sp.downSec)
                              );
                            }}
                            className="px-2 py-0.5 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 font-mono"
                          >
                            {sp.label}
                          </button>
                        ))}
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div>
                          <label htmlFor="sched-up-price" className="text-[10px] text-slate-400 block mb-1">
                            Up Target ($)
                          </label>
                          <input
                            id="sched-up-price"
                            type="number"
                            step="any"
                            min="0.0001"
                            value={upTargetInput}
                            onChange={(e) => setUpTargetInput(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-emerald-300 font-mono"
                          />
                        </div>
                        <div>
                          <label htmlFor="sched-up-sec" className="text-[10px] text-slate-400 block mb-1">
                            Up Time ({durationUnit})
                          </label>
                          <input
                            id="sched-up-sec"
                            type="number"
                            min="0.1"
                            step="any"
                            max="3600"
                            value={upDurationInput}
                            onChange={(e) => setUpDurationInput(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-white font-mono"
                          />
                        </div>
                        <div>
                          <label htmlFor="sched-down-price" className="text-[10px] text-slate-400 block mb-1">
                            Down Bottom ($)
                          </label>
                          <input
                            id="sched-down-price"
                            type="number"
                            step="any"
                            min="0.0001"
                            value={downTargetInput}
                            onChange={(e) => setDownTargetInput(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-red-300 font-mono"
                          />
                        </div>
                        <div>
                          <label htmlFor="sched-down-sec" className="text-[10px] text-slate-400 block mb-1">
                            Down Time ({durationUnit})
                          </label>
                          <input
                            id="sched-down-sec"
                            type="number"
                            min="0.1"
                            step="any"
                            max="3600"
                            value={downDurationInput}
                            onChange={(e) => setDownDurationInput(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-white font-mono"
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={coinBusy}
                          onClick={async () => {
                            const upP = parseFloat(upTargetInput);
                            const upS = (parseFloat(upDurationInput) || 60) * unitMultiplier;
                            const downP = parseFloat(downTargetInput);
                            const downS = (parseFloat(downDurationInput) || 90) * unitMultiplier;
                            if (!Number.isFinite(upP) || !Number.isFinite(downP)) return;
                            setCoinBusy(true);
                            try {
                              await onUpdateCoinPriceControl(activeAdminCoin.symbol, {
                                mode: 'up_then_down',
                                upTargetPrice: upP,
                                upDurationSec: Math.max(1, Math.round(upS)),
                                downTargetPrice: downP,
                                downDurationSec: Math.max(1, Math.round(downS)),
                                repeatLoop: true,
                              });
                            } finally {
                              setCoinBusy(false);
                            }
                          }}
                          className="flex-1 min-w-[160px] py-1.5 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold flex items-center justify-center gap-1"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Auto Loop Up ⇅ Down</span>
                        </button>
                        <button
                          type="button"
                          disabled={coinBusy}
                          onClick={async () => {
                            const upP = parseFloat(upTargetInput);
                            const upS = (parseFloat(upDurationInput) || 60) * unitMultiplier;
                            const downP = parseFloat(downTargetInput);
                            const downS = (parseFloat(downDurationInput) || 90) * unitMultiplier;
                            if (!Number.isFinite(upP) || !Number.isFinite(downP)) return;
                            setCoinBusy(true);
                            try {
                              await onUpdateCoinPriceControl(activeAdminCoin.symbol, {
                                mode: 'up_then_down',
                                upTargetPrice: upP,
                                upDurationSec: Math.max(1, Math.round(upS)),
                                downTargetPrice: downP,
                                downDurationSec: Math.max(1, Math.round(downS)),
                                repeatLoop: false,
                              });
                            } finally {
                              setCoinBusy(false);
                            }
                          }}
                          className="flex-1 min-w-[150px] py-1.5 px-3 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold flex items-center justify-center gap-1"
                        >
                          <Zap className="w-3.5 h-3.5" />
                          <span>Run 1x Up → Down</span>
                        </button>
                        <button
                          type="button"
                          disabled={coinBusy}
                          onClick={async () => {
                            setCoinBusy(true);
                            try {
                              await onUpdateCoinPriceControl(activeAdminCoin.symbol, { mode: 'stop' });
                            } finally {
                              setCoinBusy(false);
                            }
                          }}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold"
                        >
                          Stop Schedule
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Analytics & Profit Claim */}
              <div className="bg-slate-950 border border-emerald-500/30 rounded-xl p-3 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="font-bold text-emerald-300">
                      {activeAdminCoin.shortName} Trade Stats, Exposure Radar &amp; Profit Claim
                    </h4>
                    <p className="text-[10px] text-slate-400">
                      Tracks all trades, open Long/Short exposure, trader wins, losses/liquidations, and Admin claimable net profit.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={
                      coinBusy ||
                      !selectedCoinAnalytics ||
                      selectedCoinAnalytics.claimableProfitUsd <= 0
                    }
                    onClick={async () => {
                      setCoinBusy(true);
                      try {
                        await onClaimCoinProfit(activeAdminCoin.symbol);
                      } finally {
                        setCoinBusy(false);
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold text-[11px]"
                  >
                    {selectedCoinAnalytics && selectedCoinAnalytics.claimableProfitUsd > 0
                      ? `Claim Profit ($${selectedCoinAnalytics.claimableProfitUsd.toFixed(2)})`
                      : 'No Claimable Profit'}
                  </button>
                </div>

                {selectedCoinAnalytics && (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono tabular-nums">
                      <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2">
                        <span className="text-[10px] font-sans text-slate-400 block">Total Trades</span>
                        <strong className="text-white text-sm">{selectedCoinAnalytics.totalTrades}</strong>
                        <span className="block text-[9px] text-slate-400">
                          Open {selectedCoinAnalytics.openTrades} · Liq {selectedCoinAnalytics.liquidatedTrades}
                        </span>
                      </div>
                      <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2">
                        <span className="text-[10px] font-sans text-slate-400 block">Trader Win Profit</span>
                        <strong className="text-red-400 text-sm">
                          ${selectedCoinAnalytics.totalUserWinProfitUsd.toFixed(2)}
                        </strong>
                        <span className="block text-[9px] text-slate-400">
                          Wins: {selectedCoinAnalytics.closedWinTrades}
                        </span>
                      </div>
                      <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2">
                        <span className="text-[10px] font-sans text-slate-400 block">Trader Loss &amp; Liq</span>
                        <strong className="text-emerald-400 text-sm">
                          +${selectedCoinAnalytics.totalUserLossUsd.toFixed(2)}
                        </strong>
                        <span className="block text-[9px] text-slate-400">
                          Fees: +${selectedCoinAnalytics.totalTradingFeesUsd.toFixed(2)}
                        </span>
                      </div>
                      <div className="bg-slate-900/80 border border-emerald-500/30 rounded-lg p-2">
                        <span className="text-[10px] font-sans text-slate-400 block">Net / Claimable Profit</span>
                        <strong className="text-amber-300 text-sm">
                          ${selectedCoinAnalytics.netAdminProfitUsd.toFixed(2)}
                        </strong>
                        <span className="block text-[9px] text-emerald-300">
                          Claimed: ${selectedCoinAnalytics.alreadyClaimedUsd.toFixed(2)}
                        </span>
                      </div>
                    </div>

                    {/* Open Long / Short Exposure Radar & Slow Target Helpers */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-[10px]">
                      <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-2 flex items-center justify-between gap-2">
                        <div>
                          <span className="text-slate-400 font-sans block">Open Long Exposure</span>
                          <strong className="text-emerald-300 text-xs">
                            ${(selectedCoinAnalytics.openLongExposureUsd ?? 0).toFixed(2)}
                          </strong>
                        </div>
                        {selectedCoinAnalytics.recommendedLiqBottomPrice ? (
                          <button
                            type="button"
                            disabled={coinBusy}
                            onClick={async () => {
                              const p = selectedCoinAnalytics.recommendedLiqBottomPrice!;
                              const dur = Math.max(15, parseFloat(transitionSecInput) || 45);
                              setCoinBusy(true);
                              try {
                                await onUpdateCoinPriceControl(activeAdminCoin.symbol, {
                                  mode: 'glide_to_target',
                                  manualPrice: p,
                                  transitionSec: dur,
                                });
                              } finally {
                                setCoinBusy(false);
                              }
                            }}
                            className="px-2 py-1 rounded bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-red-300 font-bold"
                          >
                            Slow Target Long Liq (${formatChartPrice(selectedCoinAnalytics.recommendedLiqBottomPrice)})
                          </button>
                        ) : (
                          <span className="text-slate-500">No open Long liq</span>
                        )}
                      </div>
                      <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-2 flex items-center justify-between gap-2">
                        <div>
                          <span className="text-slate-400 font-sans block">Open Short Exposure</span>
                          <strong className="text-red-300 text-xs">
                            ${(selectedCoinAnalytics.openShortExposureUsd ?? 0).toFixed(2)}
                          </strong>
                        </div>
                        {selectedCoinAnalytics.recommendedShortSqueezePrice ? (
                          <button
                            type="button"
                            disabled={coinBusy}
                            onClick={async () => {
                              const p = selectedCoinAnalytics.recommendedShortSqueezePrice!;
                              const dur = Math.max(15, parseFloat(transitionSecInput) || 45);
                              setCoinBusy(true);
                              try {
                                await onUpdateCoinPriceControl(activeAdminCoin.symbol, {
                                  mode: 'glide_to_target',
                                  manualPrice: p,
                                  transitionSec: dur,
                                });
                              } finally {
                                setCoinBusy(false);
                              }
                            }}
                            className="px-2 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 font-bold"
                          >
                            Slow Short Squeeze (${formatChartPrice(selectedCoinAnalytics.recommendedShortSqueezePrice)})
                          </button>
                        ) : (
                          <span className="text-slate-500">No open Short liq</span>
                        )}
                      </div>
                    </div>

                    {/* Trade History Filter + CSV Export */}
                    {selectedCoinAnalytics.trades.length > 0 ? (
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1 text-[10px]">
                            {(
                              [
                                { id: 'all', label: `All (${selectedCoinAnalytics.trades.length})` },
                                { id: 'open', label: `Open (${selectedCoinAnalytics.openTrades})` },
                                { id: 'wins', label: `Wins (${selectedCoinAnalytics.closedWinTrades})` },
                                {
                                  id: 'loss',
                                  label: `Loss/Liq (${selectedCoinAnalytics.closedLossTrades + selectedCoinAnalytics.liquidatedTrades})`,
                                },
                              ] as const
                            ).map((f) => (
                              <button
                                key={f.id}
                                type="button"
                                onClick={() => setTradeFilter(f.id)}
                                className={`px-2 py-0.5 rounded border font-semibold ${
                                  tradeFilter === f.id
                                    ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                                }`}
                              >
                                {f.label}
                              </button>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const header = 'TradeID,Email,Side,Leverage,MarginUSD,EntryPrice,LiqPrice,Status,PnLUSD\n';
                              const body = selectedCoinAnalytics.trades
                                .map(
                                  (t) =>
                                    `"${t.id}","${t.userEmail}",${t.side.toUpperCase()},${t.leverage},${t.margin.toFixed(2)},${t.entryPrice},${t.liqPrice ?? ''},${t.status},${t.pnlVal.toFixed(2)}`
                                )
                                .join('\n');
                              const blob = new Blob([header + body], { type: 'text/csv;charset=utf-8;' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `${activeAdminCoin.symbol}-trades.csv`;
                              document.body.appendChild(a);
                              a.click();
                              a.remove();
                              URL.revokeObjectURL(url);
                            }}
                            className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-[10px] font-semibold flex items-center gap-1"
                          >
                            <Download className="w-3 h-3" />
                            <span>Export CSV</span>
                          </button>
                        </div>

                        <div className="overflow-x-auto border border-slate-800 rounded-lg max-h-56 overflow-y-auto">
                          <table className="w-full text-left text-[10px] font-mono tabular-nums">
                            <thead>
                              <tr className="bg-slate-900 text-slate-400 border-b border-slate-800 sticky top-0">
                                <th className="p-1.5">Trader</th>
                                <th className="p-1.5">Side</th>
                                <th className="p-1.5">Margin</th>
                                <th className="p-1.5">Entry / Liq</th>
                                <th className="p-1.5">Status</th>
                                <th className="p-1.5 text-right">Trader PnL</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/70">
                              {selectedCoinAnalytics.trades
                                .filter((t) => {
                                  if (tradeFilter === 'open') return t.status === 'OPEN';
                                  if (tradeFilter === 'wins') return t.status === 'CLOSED' && t.pnlVal >= 0;
                                  if (tradeFilter === 'loss')
                                    return t.status === 'LIQUIDATED' || (t.status === 'CLOSED' && t.pnlVal < 0);
                                  return true;
                                })
                                .slice(0, 25)
                                .map((t) => (
                                  <tr key={t.id}>
                                    <td className="p-1.5 text-slate-200 truncate max-w-[110px]">{t.userEmail}</td>
                                    <td className={`p-1.5 font-bold ${t.side === 'buy' ? 'text-emerald-400' : 'text-red-400'}`}>
                                      {t.side.toUpperCase()} {t.leverage}x
                                    </td>
                                    <td className="p-1.5 text-amber-300">${t.margin.toFixed(2)}</td>
                                    <td className="p-1.5 text-slate-300">
                                      ${formatChartPrice(t.entryPrice)} / {t.liqPrice ? `$${formatChartPrice(t.liqPrice)}` : 'Spot'}
                                    </td>
                                    <td className="p-1.5">
                                      <span
                                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                          t.status === 'LIQUIDATED'
                                            ? 'bg-red-500/20 text-red-300'
                                            : t.status === 'OPEN'
                                            ? 'bg-sky-500/20 text-sky-300'
                                            : 'bg-slate-800 text-slate-200'
                                        }`}
                                      >
                                        {t.status}
                                      </span>
                                    </td>
                                    <td
                                      className={`p-1.5 text-right font-bold ${
                                        t.pnlVal >= 0 ? 'text-emerald-400' : 'text-red-400'
                                      }`}
                                    >
                                      {t.pnlVal >= 0 ? '+' : ''}${t.pnlVal.toFixed(2)}
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <p className="text-center py-3 text-slate-500 text-[11px]">
                        No trades recorded on {activeAdminCoin.shortName} yet.
                      </p>
                    )}

                    {selectedCoinAnalytics.claims.length > 0 && (
                      <div className="space-y-1 pt-1">
                        <span className="text-[10px] font-bold uppercase text-slate-400 block">
                          Recent Profit Claims ({selectedCoinAnalytics.claims.length})
                        </span>
                        <div className="space-y-1">
                          {selectedCoinAnalytics.claims.slice(0, 4).map((cl) => (
                            <div
                              key={cl.id}
                              className="flex items-center justify-between bg-slate-900/60 border border-slate-800 rounded px-2 py-1 text-[10px] font-mono"
                            >
                              <span className="text-emerald-300 font-bold">+${cl.amountUsd.toFixed(2)}</span>
                              <span className="text-slate-400">{cl.claimedByEmail}</span>
                              <span className="text-slate-500">{cl.claimedAtLabel}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="py-6 text-center text-slate-400 bg-slate-950/60 border border-slate-800 rounded-xl">
              Click <strong>+ Quick Add XU/USDT ($100)</strong> above to launch your custom coin and start controlling its price.
            </div>
          )}
        </div>
      )}

      {/* TAB 1C: LOTTERY LIVE ADMIN CONTROL */}
      {tab === 'lottery' && isAdmin && (
        <LotteryAdminConsole
          lotteryState={lotteryState}
          remainingSec={lotteryState?.currentRound.remainingSec ?? 0}
          members={members}
          currentUserUid={currentUserUid}
          currentUserEmail=""
          onUpdateConfig={onUpdateLotteryConfig}
          onScheduleDigitDraw={onScheduleDigitDraw}
          onAdjustWallet={async (payload) =>
            onExecuteBalanceAdjustByTarget({
              ...payload,
              reason: 'Lottery Live Admin Adjustment',
            })
          }
          onRefreshState={onRefreshLotteryState}
        />
      )}

      {/* TAB 1D: ADMIN NEWS DESK (PUBLISH, FEATURE, EDIT, DELETE) */}
      {tab === 'news' && isAdmin && (
        <div className="space-y-4 text-xs" data-testid="admin-news-desk">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
            <div>
              <h4 className="font-bold text-white flex items-center gap-1.5 text-sm">
                <Newspaper className="w-4 h-4 text-blue-400" aria-hidden="true" />
                <span>Editorial News Desk</span>
              </h4>
              <p className="text-[11px] text-slate-400">
                Publish market dispatches, set the Lead Story, or save drafts. Live member feed syncs immediately.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {editingNewsId !== null && (
                <button
                  type="button"
                  onClick={resetNewsEditor}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-[11px]"
                >
                  New Dispatch
                </button>
              )}
              <button
                type="button"
                onClick={() => onRefreshAdminNews()}
                disabled={adminNewsLoading}
                className="flex items-center gap-1 text-sky-400 hover:text-sky-300 font-semibold text-[11px]"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${adminNewsLoading ? 'animate-spin' : ''}`} />
                <span>{adminNewsLoading ? 'Syncing...' : 'Refresh'}</span>
              </button>
            </div>
          </div>

          {/* Publish / Edit Dispatch Form */}
          <form
            onSubmit={handleNewsFormSubmit}
            className="bg-slate-950/90 border border-slate-800 rounded-xl p-3.5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-blue-300 uppercase tracking-wider text-[10px]">
                {editingNewsId !== null ? `Editing Dispatch #${editingNewsId}` : 'Publish New Dispatch'}
              </span>
              {newsFormError && (
                <span className="text-[11px] text-red-400 font-semibold">{newsFormError}</span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="sm:col-span-2">
                <label htmlFor="admin-news-title" className="text-[10px] text-slate-400 block mb-1">
                  Headline Title
                </label>
                <input
                  id="admin-news-title"
                  type="text"
                  value={newsTitle}
                  onChange={(e) => setNewsTitle(e.target.value)}
                  placeholder="e.g. BTC Spot Liquidity Deepens Ahead of Policy Release"
                  required
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white placeholder-slate-500"
                />
              </div>
              <div>
                <label htmlFor="admin-news-category" className="text-[10px] text-slate-400 block mb-1">
                  Category
                </label>
                <select
                  id="admin-news-category"
                  value={newsCategory}
                  onChange={(e) => setNewsCategory(e.target.value as NewsCategory)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white"
                >
                  {NEWS_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label htmlFor="admin-news-author" className="text-[10px] text-slate-400 block mb-1">
                  Desk / Author Byline
                </label>
                <input
                  id="admin-news-author"
                  type="text"
                  value={newsAuthor}
                  onChange={(e) => setNewsAuthor(e.target.value)}
                  placeholder="Zectrade Research Desk"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white placeholder-slate-500"
                />
              </div>
              <div>
                <label htmlFor="admin-news-cover-preset" className="text-[10px] text-slate-400 block mb-1">
                  Editorial Cover Image
                </label>
                <div className="flex items-center gap-2">
                  <select
                    id="admin-news-cover-preset"
                    value={
                      [
                        '/src/assets/images/news_lead_macro_1794937556483.jpg',
                        '/src/assets/images/news_crypto_liquidity_1794937557683.jpg',
                        '/src/assets/images/news_commodities_desk_1794937558337.jpg',
                        '',
                      ].includes(newsImageUrl)
                        ? newsImageUrl
                        : 'custom'
                    }
                    onChange={(e) => {
                      if (e.target.value !== 'custom') setNewsImageUrl(e.target.value);
                    }}
                    className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white"
                  >
                    <option value="/src/assets/images/news_lead_macro_1794937556483.jpg">
                      Institutional Trading Desk (Preset)
                    </option>
                    <option value="/src/assets/images/news_crypto_liquidity_1794937557683.jpg">
                      Digital Assets Vault (Preset)
                    </option>
                    <option value="/src/assets/images/news_commodities_desk_1794937558337.jpg">
                      Gold &amp; Commodities Port (Preset)
                    </option>
                    <option value="">No Cover (Text Brief)</option>
                    {newsImageUrl.startsWith('data:image/') && (
                      <option value="custom">Uploaded Custom Image</option>
                    )}
                  </select>
                  <label className="cursor-pointer px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-[11px] inline-flex items-center gap-1 whitespace-nowrap">
                    <Camera className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Upload</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleNewsCoverUpload}
                      className="sr-only"
                    />
                  </label>
                </div>
              </div>
            </div>

            {resolveNewsImageSrc(newsImageUrl) && (
              <div className="flex items-center gap-3 bg-slate-900/70 border border-slate-800 rounded-lg p-2">
                <img
                  src={resolveNewsImageSrc(newsImageUrl) ?? undefined}
                  alt="Cover preview"
                  className="w-20 h-12 object-cover rounded border border-slate-700 shrink-0"
                />
                <div className="min-w-0 flex-1 text-[11px] text-slate-400">
                  Cover preview active. Displayed in Lead Story or Desk Spotlight cards.
                </div>
                <button
                  type="button"
                  onClick={() => setNewsImageUrl('')}
                  className="text-[11px] text-slate-400 hover:text-white px-2 py-1"
                >
                  Clear
                </button>
              </div>
            )}

            <div>
              <label htmlFor="admin-news-summary" className="text-[10px] text-slate-400 block mb-1">
                Executive Deck (1–2 sentences)
              </label>
              <textarea
                id="admin-news-summary"
                rows={2}
                value={newsSummary}
                onChange={(e) => setNewsSummary(e.target.value)}
                placeholder="Concise institutional takeaway displayed on cards and below the headline..."
                required
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white placeholder-slate-500"
              />
            </div>

            <div>
              <label htmlFor="admin-news-content" className="text-[10px] text-slate-400 block mb-1">
                Full Dispatch Body (separate paragraphs with a blank line)
              </label>
              <textarea
                id="admin-news-content"
                rows={4}
                value={newsContent}
                onChange={(e) => setNewsContent(e.target.value)}
                placeholder="Write complete market analysis, key price levels, and trading context..."
                required
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 placeholder-slate-500"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex flex-wrap items-center gap-4">
                <label className="inline-flex items-center gap-2 cursor-pointer text-slate-200">
                  <input
                    type="checkbox"
                    checked={newsFeatured}
                    onChange={(e) => setNewsFeatured(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-amber-400"
                  />
                  <span>Set as Lead Story</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer text-slate-200">
                  <input
                    type="checkbox"
                    checked={newsPublished}
                    onChange={(e) => setNewsPublished(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-emerald-500"
                  />
                  <span>Publish Immediately</span>
                </label>
              </div>

              <div className="flex items-center gap-2">
                {editingNewsId !== null && (
                  <button
                    type="button"
                    onClick={resetNewsEditor}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold"
                  >
                    Cancel Edit
                  </button>
                )}
                <button
                  type="submit"
                  disabled={newsBusy}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-bold flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    {newsBusy
                      ? 'Saving...'
                      : editingNewsId !== null
                      ? 'Update Dispatch'
                      : 'Publish Dispatch'}
                  </span>
                </button>
              </div>
            </div>
          </form>

          {/* Existing Dispatches List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span className="font-bold uppercase tracking-wider text-slate-300">
                All Dispatches ({adminNews.length})
              </span>
              <span>Only published articles appear in the member News tab</span>
            </div>

            {adminNews.length === 0 ? (
              <div className="py-8 text-center bg-slate-950/60 border border-slate-800 rounded-xl text-slate-400">
                No news dispatches yet. Publish your first institutional brief above.
              </div>
            ) : (
              <div className="space-y-2">
                {adminNews.map((article) => {
                  const thumbSrc = resolveNewsImageSrc(article.imageUrl);
                  return (
                    <div
                      key={article.id}
                      className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        {thumbSrc && (
                          <img
                            src={thumbSrc}
                            alt=""
                            className="w-16 h-12 rounded object-cover border border-slate-800 shrink-0"
                          />
                        )}
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold">
                            <span className="text-amber-300">{article.category}</span>
                            <span className="text-slate-600" aria-hidden="true">·</span>
                            <span className={article.isPublished ? 'text-emerald-400' : 'text-slate-400'}>
                              {article.isPublished ? 'Published' : 'Draft'}
                            </span>
                            {article.isFeatured && (
                              <>
                                <span className="text-slate-600" aria-hidden="true">·</span>
                                <span className="text-blue-400">Lead Story</span>
                              </>
                            )}
                            <span className="text-slate-600" aria-hidden="true">·</span>
                            <span className="text-slate-400 font-mono tabular-nums">
                              {formatNewsTimestamp(article.publishedAtMs)}
                            </span>
                          </div>
                          <p className="font-semibold text-white text-xs leading-snug line-clamp-1">
                            {article.title}
                          </p>
                          <p className="text-[11px] text-slate-400 line-clamp-1">{article.summary}</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => loadNewsArticleForEdit(article)}
                          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-[11px] inline-flex items-center gap-1"
                        >
                          <Pencil className="w-3 h-3" aria-hidden="true" />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          disabled={article.isFeatured}
                          onClick={() => onUpdateAdminNews(article.id, { isFeatured: true, isPublished: true })}
                          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-amber-500/20 hover:text-amber-300 disabled:opacity-40 text-slate-300 font-semibold text-[11px] inline-flex items-center gap-1"
                        >
                          <Star className="w-3 h-3" aria-hidden="true" />
                          <span>{article.isFeatured ? 'Lead' : 'Feature'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateAdminNews(article.id, { isPublished: !article.isPublished })
                          }
                          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-[11px] inline-flex items-center gap-1"
                        >
                          {article.isPublished ? (
                            <>
                              <EyeOff className="w-3 h-3" aria-hidden="true" />
                              <span>Unpublish</span>
                            </>
                          ) : (
                            <>
                              <Eye className="w-3 h-3" aria-hidden="true" />
                              <span>Publish</span>
                            </>
                          )}
                        </button>
                        {confirmDeleteNewsId === article.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={async () => {
                                await onDeleteAdminNews(article.id);
                                setConfirmDeleteNewsId(null);
                                if (editingNewsId === article.id) resetNewsEditor();
                              }}
                              className="px-2 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-[11px]"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteNewsId(null)}
                              className="px-2 py-1 rounded-lg bg-slate-800 text-slate-300 text-[11px]"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteNewsId(article.id)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-red-500/20 text-slate-400 hover:text-red-300"
                            aria-label={`Delete ${article.title}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: EDIT DESCRIPTION & Q&A */}
      {tab === 'faq' && (
        <div className="space-y-3 text-xs">
          <div>
            <label className="text-[10px] text-slate-400 block mb-1">Platform Description (Landing Page)</label>
            <textarea
              rows={3}
              value={descText}
              onChange={(e) => setDescText(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="font-bold text-amber-400">FAQ & Platform Q&A Items ({faqs.length})</span>
            <button
              type="button"
              onClick={() => setFaqs((prev) => [...prev, { q: 'New question?', a: 'Answer details.' }])}
              className="px-2.5 py-1 rounded bg-amber-500 text-slate-950 font-bold text-[10px] flex items-center gap-1"
            >
              <Plus className="w-3 h-3" />
              <span>Add Q&A</span>
            </button>
          </div>
          <div className="space-y-2">
            {faqs.map((item, idx) => (
              <div key={idx} className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-mono text-slate-400">Q&A #{idx + 1}</span>
                  <button
                    type="button"
                    onClick={() => setFaqs((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-red-400 hover:text-red-300"
                    aria-label={`Delete FAQ ${idx + 1}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <input
                  type="text"
                  value={item.q}
                  onChange={(e) =>
                    setFaqs((prev) => prev.map((f, i) => (i === idx ? { ...f, q: e.target.value } : f)))
                  }
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-white"
                />
                <textarea
                  rows={2}
                  value={item.a}
                  onChange={(e) =>
                    setFaqs((prev) => prev.map((f, i) => (i === idx ? { ...f, a: e.target.value } : f)))
                  }
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-300"
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={async () => {
              await onSaveFaqAndDesc(descText, faqs);
            }}
            className="w-full py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold"
          >
            Save All Q&A Changes
          </button>
        </div>
      )}

      {/* TAB 3: PENDING DEPOSIT REQUESTS (CAIWU) */}
      {tab === 'caiwu' && (
        <div className="space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-emerald-400 flex items-center gap-1.5">
              <span>Pending Deposit Requests (Caiwu)</span>
            </h4>
            <button
              type="button"
              onClick={() => onRefreshStaffRequests()}
              disabled={staffRequestsLoading}
              className="flex items-center gap-1 text-sky-400 hover:text-sky-300 font-semibold text-[11px]"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${staffRequestsLoading ? 'animate-spin' : ''}`} />
              <span>{staffRequestsLoading ? 'Loading...' : 'Refresh'}</span>
            </button>
          </div>

          {pendingDeposits.length === 0 ? (
            <div className="py-8 text-center text-slate-400 bg-slate-950/60 border border-slate-800 rounded-xl">
              No pending deposit requests.
            </div>
          ) : (
            <div className="space-y-2.5">
              {pendingDeposits.map((req) => {
                const isBusy = busyRequestId === req.id;
                return (
                  <div
                    key={req.id}
                    className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-emerald-400 text-[11px] uppercase">{req.type}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-white text-sm">
                          +${req.amount.toFixed(2)}
                        </span>
                        <button
                          type="button"
                          onClick={() => onCopyText(req.amount.toFixed(2), 'Deposit Amount')}
                          className="p-1 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:text-white"
                          title="Copy Amount"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900/70 border border-slate-800/80 rounded-lg px-2.5 py-1.5">
                      <span className="text-[11px] font-mono text-slate-300 break-all">
                        Target / Tx ID: <span className="text-white font-semibold">{req.target}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => onCopyText(req.target, 'Tx ID / Target')}
                        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-semibold flex items-center gap-1 shrink-0"
                      >
                        <Copy className="w-3 h-3" />
                        <span>Copy</span>
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] text-slate-400 font-mono">
                      <span>
                        Member: <span className="text-slate-200">{req.userEmail}</span> ({req.userId})
                      </span>
                      <span>{req.createdAtLabel}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={async () => {
                          setBusyRequestId(req.id);
                          try {
                            await onApproveDeposit(req);
                          } finally {
                            setBusyRequestId(null);
                          }
                        }}
                        className="py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-[11px]"
                      >
                        {isBusy ? 'Processing...' : 'Approve Deposit'}
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={async () => {
                          setBusyRequestId(req.id);
                          try {
                            await onRejectDeposit(req);
                          } finally {
                            setBusyRequestId(null);
                          }
                        }}
                        className="py-1.5 px-3 rounded-lg bg-red-600/20 hover:bg-red-600/35 text-red-300 border border-red-500/40 disabled:opacity-50 font-bold text-[11px]"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: PENDING WITHDRAWAL REQUESTS (CHUKUAN) */}
      {tab === 'chukuan' && (
        <div className="space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-sky-400 flex items-center gap-1.5">
              <span>Pending Withdrawal Requests (Chukuan)</span>
            </h4>
            <button
              type="button"
              onClick={() => onRefreshStaffRequests()}
              disabled={staffRequestsLoading}
              className="flex items-center gap-1 text-sky-400 hover:text-sky-300 font-semibold text-[11px]"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${staffRequestsLoading ? 'animate-spin' : ''}`} />
              <span>{staffRequestsLoading ? 'Loading...' : 'Refresh'}</span>
            </button>
          </div>

          {pendingWithdrawals.length === 0 ? (
            <div className="py-8 text-center text-slate-400 bg-slate-950/60 border border-slate-800 rounded-xl">
              No pending withdrawal requests.
            </div>
          ) : (
            <div className="space-y-2.5">
              {pendingWithdrawals.map((req) => {
                const isBusy = busyRequestId === req.id;
                const extractedAccount = extractAccountTargetNumber(req.target);
                const isRejectPromptOpen = rejectingWdId === req.id;

                return (
                  <div
                    key={req.id}
                    className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-sky-400 text-[11px] uppercase">{req.type}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-amber-400 text-sm">
                          -${req.amount.toFixed(2)}
                        </span>
                        <button
                          type="button"
                          onClick={() => onCopyText(req.amount.toFixed(2), 'Withdrawal Amount')}
                          className="p-1 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:text-white"
                          title="Copy Amount"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900/70 border border-slate-800/80 rounded-lg px-2.5 py-1.5">
                      <span className="text-[11px] font-mono text-slate-300 break-all">
                        Payout Target: <span className="text-white font-semibold">{req.target}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => onCopyText(extractedAccount, 'Account / Phone')}
                        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-semibold flex items-center gap-1 shrink-0"
                      >
                        <Copy className="w-3 h-3" />
                        <span>Copy Account</span>
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] text-slate-400 font-mono">
                      <span>
                        Member: <span className="text-slate-200">{req.userEmail}</span> ({req.userId})
                      </span>
                      <span>{req.createdAtLabel}</span>
                    </div>

                    {isRejectPromptOpen ? (
                      <div className="bg-red-950/30 border border-red-500/35 rounded-lg p-2.5 space-y-2">
                        <label className="text-[10px] font-bold text-red-300 block">
                          Mandatory Rejection Remark (Sent to member & refunds ${req.amount.toFixed(2)})
                        </label>
                        <input
                          type="text"
                          value={rejectWdReason}
                          onChange={(e) => setRejectWdReason(e.target.value)}
                          placeholder="e.g., Account name mismatch or invalid phone number"
                          className="w-full bg-slate-950 border border-red-500/40 rounded px-2.5 py-1.5 text-white text-[11px]"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={isBusy || !rejectWdReason.trim()}
                            onClick={async () => {
                              setBusyRequestId(req.id);
                              try {
                                await onRejectWithdrawal(req, rejectWdReason.trim());
                                setRejectingWdId(null);
                                setRejectWdReason('');
                              } finally {
                                setBusyRequestId(null);
                              }
                            }}
                            className="flex-1 py-1.5 rounded bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold text-[11px]"
                          >
                            {isBusy ? 'Refunding...' : 'Confirm Reject & Refund'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRejectingWdId(null);
                              setRejectWdReason('');
                            }}
                            className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-[11px]"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={async () => {
                            setBusyRequestId(req.id);
                            try {
                              await onApproveWithdrawal(req);
                            } finally {
                              setBusyRequestId(null);
                            }
                          }}
                          className="py-1.5 px-3 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold text-[11px]"
                        >
                          {isBusy ? 'Processing...' : 'Approve & Payout'}
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => {
                            setRejectingWdId(req.id);
                            setRejectWdReason('');
                          }}
                          className="py-1.5 px-3 rounded-lg bg-red-600/20 hover:bg-red-600/35 text-red-300 border border-red-500/40 disabled:opacity-50 font-bold text-[11px]"
                        >
                          Reject & Refund
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 5: ADMIN MEMBER MONEY ADJUSTMENT */}
      {tab === 'admin' && (
        <div className="space-y-3 text-xs">
          <div className="bg-slate-950 border border-red-500/30 rounded-xl p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-red-400 flex items-center gap-1.5">
                <Shield className="w-4 h-4" />
                <span>Admin Member Money Adjustment (Exclusive)</span>
              </h4>
              {!isAdmin && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/30">
                  Admin Exclusive
                </span>
              )}
            </div>

            {!isAdmin ? (
              <p className="text-slate-400 text-[11px]">
                Only Full Admin accounts can directly add or deduct member Real or Demo wallet funds.
              </p>
            ) : (
              <form onSubmit={handleExecuteMemberAdjustForm} className="space-y-2.5">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">Target Member UID or Email</label>
                  <input
                    type="text"
                    required
                    value={adjTarget}
                    onChange={(e) => setAdjTarget(e.target.value)}
                    placeholder="e.g., USR-4418 or sumyat@zectrade.io"
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-white font-mono"
                  />
                  {members.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {members.slice(0, 5).map((m) => (
                        <button
                          key={m.uid}
                          type="button"
                          onClick={() => setAdjTarget(m.email || m.uid)}
                          className="text-[10px] px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 font-mono"
                        >
                          {m.username} ({m.uid})
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">Action Type</label>
                    <select
                      aria-label="Adjustment Action Type"
                      value={adjAction}
                      onChange={(e) => setAdjAction(e.target.value as 'add' | 'deduct')}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-white"
                    >
                      <option value="add">Add Money (+)</option>
                      <option value="deduct">Deduct Money (-)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">Target Wallet</label>
                    <select
                      aria-label="Adjustment Target Wallet"
                      value={adjWallet}
                      onChange={(e) => setAdjWallet(e.target.value as 'real' | 'demo')}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-white"
                    >
                      <option value="real">Real Balance ($)</option>
                      <option value="demo">Demo Balance ($)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">Amount (USD)</label>
                    <input
                      type="number"
                      min="0.01"
                      step="any"
                      required
                      value={adjAmount}
                      onChange={(e) => setAdjAmount(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-white font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">Reason / Internal Note</label>
                  <input
                    type="text"
                    value={adjReason}
                    onChange={(e) => setAdjReason(e.target.value)}
                    placeholder="Optional note recorded to member ledger (e.g., VIP bonus credit)"
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-white"
                  />
                </div>

                <button
                  type="submit"
                  disabled={adjBusy}
                  className="w-full py-2.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold"
                >
                  {adjBusy ? 'Executing Adjustment...' : 'Execute Balance Adjustment'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* TAB 6: SEARCH MEMBER */}
      {tab === 'search' && (
        <div className="space-y-3 text-xs">
          <form onSubmit={handleMemberSearchSubmit} className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={memberQuery}
                onChange={(e) => setMemberQuery(e.target.value)}
                placeholder="Search member by UID, email, or name..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-2.5 py-2 text-white font-mono text-[11px] focus:border-sky-500 outline-none"
              />
            </div>
            <div className="flex gap-1.5">
              <button
                type="submit"
                disabled={isSearchingMembers}
                className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-semibold text-[11px] flex items-center gap-1"
              >
                <Search className="w-3 h-3" />
                <span>{isSearchingMembers ? 'Searching...' : 'Search'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMemberQuery('');
                  onSearchMembers('');
                }}
                aria-label="Refresh member directory"
                className="px-2.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-white"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>

          {filteredMembers.length === 0 ? (
            <div className="py-6 text-center text-slate-500 bg-slate-950/60 border border-slate-800 rounded-xl">
              No matching members found. Enter an exact UID or email and click Search.
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredMembers.map((member) => {
                const walletChoice = adjustWallets[member.uid] ?? 'real';
                const amtStr = adjustAmounts[member.uid] ?? '100';
                const draftRole = roleDrafts[member.uid] ?? member.role;
                const isSelf = member.uid === currentUserUid;
                const wdStatus = evaluateWithdrawalEligibility({
                  isBlocked: member.isBlocked,
                  isWithdrawBlocked: member.isWithdrawBlocked,
                  hasDepositedBefore: !!member.hasDepositedBefore,
                  hasTradedAfterDeposit: !!member.hasTradedAfterDeposit,
                  withdrawLockClearedByAdmin: !!member.withdrawLockClearedByAdmin,
                });

                const wdBadgeLabel = member.isBlocked
                  ? 'FULLY BLOCKED'
                  : wdStatus.lockType === 'admin_withdraw_blocked'
                  ? 'ADMIN LOCKED'
                  : wdStatus.lockType === 'no_deposit'
                  ? 'LOCKED: NO DEPOSIT'
                  : wdStatus.lockType === 'no_trade_after_deposit'
                  ? 'LOCKED: TRADE REQ'
                  : 'WITHDRAW READY';

                const isEditingMember = editingMemberUid === member.uid;
                const memberInitials = getAvatarInitials(member.fullName || member.username, member.email);

                return (
                  <div
                    key={member.uid}
                    className={`bg-slate-950 border rounded-xl p-3 space-y-2.5 ${
                      member.isBlocked
                        ? 'border-red-500/40'
                        : !wdStatus.allowed
                        ? 'border-amber-500/35'
                        : 'border-slate-800'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 overflow-hidden flex items-center justify-center shrink-0">
                          {member.avatarUrl ? (
                            <img
                              src={member.avatarUrl}
                              alt={member.username}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="text-[11px] font-bold text-amber-400">{memberInitials}</span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-bold text-white text-xs truncate">{member.username}</span>
                            <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                              {member.role}
                            </span>
                            {isSelf && (
                              <span className="text-[10px] font-semibold text-sky-400">(Current Session)</span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono truncate">
                            {member.email} · {member.uid}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isAdmin && (
                          <button
                            type="button"
                            data-testid={`admin-edit-member-${member.uid}`}
                            onClick={() => {
                              if (isEditingMember) {
                                setEditingMemberUid(null);
                                setMemberEditError(null);
                              } else {
                                setEditingMemberUid(member.uid);
                                setMemberEditError(null);
                                setMemberEditDraft({
                                  username: member.username,
                                  email: member.email,
                                  avatarUrl: member.avatarUrl ?? null,
                                  fullName: member.fullName ?? '',
                                  phone: member.phone ?? '',
                                  country: member.country ?? '',
                                  bio: member.bio ?? '',
                                  securityPin: member.securityPin || '1234',
                                  withdrawMethod: member.withdrawMethod ?? 'kpay',
                                  withdrawAccountName: member.withdrawAccountName ?? '',
                                  withdrawAccountNumber: member.withdrawAccountNumber ?? '',
                                });
                              }
                            }}
                            className={`px-2 py-1 rounded text-[10px] font-semibold border flex items-center gap-1 transition ${
                              isEditingMember
                                ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold'
                                : 'bg-slate-900 hover:bg-slate-800 text-slate-200 border-slate-700'
                            }`}
                          >
                            <Pencil className="w-3 h-3" aria-hidden="true" />
                            <span>{isEditingMember ? 'Close Edit' : 'Edit Info'}</span>
                          </button>
                        )}
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            member.isBlocked
                              ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                              : !wdStatus.allowed
                              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                              : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          }`}
                        >
                          {wdBadgeLabel}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-[11px] font-mono tabular-nums bg-slate-900/60 rounded-lg p-2 border border-slate-800/70">
                      <div>
                        <span className="text-[10px] text-slate-500 block font-sans">Real Balance</span>
                        <span className="text-amber-400 font-bold">${member.realBalance.toFixed(2)}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block font-sans">Demo Balance</span>
                        <span className="text-sky-400 font-bold">${member.demoBalance.toFixed(2)}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block font-sans">Deposited</span>
                        <span className={member.hasDepositedBefore ? 'text-emerald-400 font-bold' : 'text-slate-400'}>
                          {member.hasDepositedBefore ? 'YES' : 'NO'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block font-sans">Traded</span>
                        <span className={member.hasTradedAfterDeposit ? 'text-emerald-400 font-bold' : 'text-slate-400'}>
                          {member.hasTradedAfterDeposit ? 'YES' : 'NO'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block font-sans">Security PIN</span>
                        <span className="text-slate-200 font-bold">{member.securityPin || '1234'}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block font-sans">Invited By</span>
                        <span className="text-slate-300 truncate block">{member.invitedBy || 'Direct'}</span>
                      </div>
                    </div>

                    {/* Saved Member Personal & Withdraw Account Overview */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] bg-slate-900/40 rounded-lg p-2 border border-slate-800/60">
                      <div className="space-y-0.5 truncate">
                        <span className="text-slate-500 font-semibold uppercase tracking-wider block">
                          Profile Info
                        </span>
                        <p className="text-slate-200 truncate">
                          {member.fullName || 'No legal name'} · {member.phone || 'No phone'}
                        </p>
                        <p className="text-slate-400 truncate">
                          {member.country || 'Location not set'}
                          {member.bio ? ` · ${member.bio}` : ''}
                        </p>
                      </div>
                      <div className="space-y-0.5 truncate">
                        <span className="text-emerald-400 font-semibold uppercase tracking-wider block">
                          Withdraw Account ({(member.withdrawMethod || 'kpay').toUpperCase()})
                        </span>
                        <p className="text-slate-200 truncate">
                          Name: {member.withdrawAccountName || 'Not set'}
                        </p>
                        <p className="text-amber-300 font-mono truncate">
                          No: {member.withdrawAccountNumber || 'Not set'}
                        </p>
                      </div>
                    </div>

                    {/* Admin Inline Full Profile & Withdraw Editor */}
                    {isAdmin && isEditingMember && (
                      <div
                        className="bg-slate-900/90 border border-amber-500/35 rounded-xl p-3 space-y-2.5"
                        data-testid={`admin-edit-form-${member.uid}`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[11px] font-bold text-amber-400">
                            Edit Member Profile &amp; Withdraw Account ({member.uid})
                          </span>
                          <div className="flex items-center gap-2">
                            <label className="cursor-pointer px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-semibold flex items-center gap-1">
                              <Camera className="w-3 h-3" aria-hidden="true" />
                              <span>Change Photo</span>
                              <input
                                type="file"
                                accept="image/*"
                                onChange={async (e) => {
                                  const f = e.target.files?.[0];
                                  if (!f) return;
                                  setMemberEditError(null);
                                  try {
                                    const dataUrl = await resizeImageFileToAvatarDataUrl(f, 256);
                                    setMemberEditDraft((prev) => ({ ...prev, avatarUrl: dataUrl }));
                                  } catch (err) {
                                    setMemberEditError(
                                      err instanceof Error ? err.message : 'Invalid image file.'
                                    );
                                  }
                                }}
                                className="sr-only"
                              />
                            </label>
                            {memberEditDraft.avatarUrl && (
                              <button
                                type="button"
                                onClick={() =>
                                  setMemberEditDraft((prev) => ({ ...prev, avatarUrl: null }))
                                }
                                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-semibold"
                              >
                                Remove Photo
                              </button>
                            )}
                          </div>
                        </div>

                        {memberEditError && (
                          <p className="text-[10px] font-semibold text-red-400">{memberEditError}</p>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div>
                            <label className="text-[10px] text-slate-400 block mb-0.5">Username</label>
                            <input
                              type="text"
                              aria-label="Member Username"
                              value={memberEditDraft.username ?? ''}
                              onChange={(e) =>
                                setMemberEditDraft((p) => ({ ...p, username: e.target.value }))
                              }
                              className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-[11px] text-white"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-slate-400 block mb-0.5">Email</label>
                            <input
                              type="email"
                              aria-label="Member Email"
                              value={memberEditDraft.email ?? ''}
                              onChange={(e) =>
                                setMemberEditDraft((p) => ({ ...p, email: e.target.value }))
                              }
                              className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-[11px] text-white"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-slate-400 block mb-0.5">Security PIN (4 digits)</label>
                            <input
                              type="text"
                              maxLength={4}
                              aria-label="Member Security PIN"
                              value={memberEditDraft.securityPin ?? ''}
                              onChange={(e) =>
                                setMemberEditDraft((p) => ({ ...p, securityPin: e.target.value }))
                              }
                              className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-[11px] font-mono text-amber-300"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div>
                            <label className="text-[10px] text-slate-400 block mb-0.5">Full Legal Name</label>
                            <input
                              type="text"
                              aria-label="Member Full Name"
                              value={memberEditDraft.fullName ?? ''}
                              onChange={(e) =>
                                setMemberEditDraft((p) => ({ ...p, fullName: e.target.value }))
                              }
                              className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-[11px] text-white"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-slate-400 block mb-0.5">Phone Number</label>
                            <input
                              type="text"
                              aria-label="Member Phone"
                              value={memberEditDraft.phone ?? ''}
                              onChange={(e) =>
                                setMemberEditDraft((p) => ({ ...p, phone: e.target.value }))
                              }
                              className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-[11px] font-mono text-white"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-slate-400 block mb-0.5">Country / City</label>
                            <input
                              type="text"
                              aria-label="Member Country"
                              value={memberEditDraft.country ?? ''}
                              onChange={(e) =>
                                setMemberEditDraft((p) => ({ ...p, country: e.target.value }))
                              }
                              className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-[11px] text-white"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="text-[10px] text-slate-400 block mb-0.5">Bio / Address Note</label>
                          <input
                            type="text"
                            aria-label="Member Bio"
                            value={memberEditDraft.bio ?? ''}
                            onChange={(e) =>
                              setMemberEditDraft((p) => ({ ...p, bio: e.target.value }))
                            }
                            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-[11px] text-white"
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 border-t border-slate-800">
                          <div>
                            <label className="text-[10px] text-emerald-400 block mb-0.5">Withdraw Method</label>
                            <select
                              aria-label="Member Withdraw Method"
                              value={memberEditDraft.withdrawMethod ?? 'kpay'}
                              onChange={(e) =>
                                setMemberEditDraft((p) => ({
                                  ...p,
                                  withdrawMethod: e.target.value as WithdrawMethod,
                                }))
                              }
                              className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-[11px] text-white"
                            >
                              <option value="kpay">KBZPay (KPay)</option>
                              <option value="wavepay">WavePay</option>
                              <option value="bank">Bank Transfer</option>
                              <option value="usdt">USDT TRC20</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] text-emerald-400 block mb-0.5">Withdraw Account Name</label>
                            <input
                              type="text"
                              aria-label="Member Withdraw Account Name"
                              value={memberEditDraft.withdrawAccountName ?? ''}
                              onChange={(e) =>
                                setMemberEditDraft((p) => ({
                                  ...p,
                                  withdrawAccountName: e.target.value,
                                }))
                              }
                              className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-[11px] text-white"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-emerald-400 block mb-0.5">Withdraw Account Number</label>
                            <input
                              type="text"
                              aria-label="Member Withdraw Account Number"
                              value={memberEditDraft.withdrawAccountNumber ?? ''}
                              onChange={(e) =>
                                setMemberEditDraft((p) => ({
                                  ...p,
                                  withdrawAccountNumber: e.target.value,
                                }))
                              }
                              className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-[11px] font-mono text-amber-300"
                            />
                          </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingMemberUid(null);
                              setMemberEditError(null);
                            }}
                            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={memberEditBusy}
                            data-testid={`admin-save-member-${member.uid}`}
                            onClick={async () => {
                              setMemberEditBusy(true);
                              setMemberEditError(null);
                              try {
                                const ok = await onAdminUpdateMemberProfile(member.uid, memberEditDraft);
                                if (ok) {
                                  setEditingMemberUid(null);
                                }
                              } finally {
                                setMemberEditBusy(false);
                              }
                            }}
                            className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-[11px] font-bold"
                          >
                            {memberEditBusy ? 'Saving...' : 'Save Member Info'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Block / Unblock / Clear Withdraw Lock Actions */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => onToggleWithdrawBlock(member.uid, !member.isWithdrawBlocked)}
                        className={`py-1.5 px-2.5 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 border transition ${
                          member.isWithdrawBlocked
                            ? 'bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-300 border-emerald-500/30'
                            : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border-amber-500/30'
                        }`}
                      >
                        {member.isWithdrawBlocked ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Unblock Withdraw</span>
                          </>
                        ) : (
                          <>
                            <Ban className="w-3.5 h-3.5" />
                            <span>Block Withdraw Only</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => onToggleBlockMember(member.uid, !member.isBlocked)}
                        className={`py-1.5 px-2.5 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 border transition ${
                          member.isBlocked
                            ? 'bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border-emerald-500/40'
                            : 'bg-red-600/20 hover:bg-red-600/30 text-red-300 border-red-500/40'
                        }`}
                      >
                        {member.isBlocked ? (
                          <>
                            <UserCheck className="w-3.5 h-3.5" />
                            <span>Unblock Account</span>
                          </>
                        ) : (
                          <>
                            <Ban className="w-3.5 h-3.5" />
                            <span>Block Full Account</span>
                          </>
                        )}
                      </button>

                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => onClearWithdrawLock(member.uid)}
                          disabled={member.withdrawLockClearedByAdmin && !member.isWithdrawBlocked && wdStatus.allowed}
                          className="py-1.5 px-2.5 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 border bg-emerald-600/20 hover:bg-emerald-600/30 disabled:opacity-45 text-emerald-300 border-emerald-500/40 transition"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Clear Withdraw Lock</span>
                        </button>
                      )}
                    </div>

                    {/* Inline Role & Balance Adjustment (Admin Only) */}
                    {isAdmin && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-slate-800/80">
                        <div className="flex items-center gap-1.5">
                          <select
                            aria-label={`Role for ${member.username}`}
                            value={draftRole}
                            onChange={(e) =>
                              setRoleDrafts((prev) => ({ ...prev, [member.uid]: e.target.value as UserRole }))
                            }
                            className="flex-1 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-[10px] text-white"
                          >
                            <option value="user">User</option>
                            <option value="staff">Staff</option>
                            <option value="caiwu">Caiwu (Deposits)</option>
                            <option value="chukuan">Chukuan (Withdrawals)</option>
                            <option value="admin">Admin</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => onAssignMemberRole(member.uid, draftRole)}
                            className="px-2.5 py-1 rounded bg-purple-600/25 hover:bg-purple-600/40 text-purple-200 border border-purple-500/30 text-[10px] font-semibold"
                          >
                            Set Role
                          </button>
                        </div>

                        <div className="flex items-center gap-1">
                          <select
                            aria-label={`Wallet for ${member.username}`}
                            value={walletChoice}
                            onChange={(e) =>
                              setAdjustWallets((prev) => ({
                                ...prev,
                                [member.uid]: e.target.value as 'real' | 'demo',
                              }))
                            }
                            className="bg-slate-900 border border-slate-800 rounded px-1.5 py-1 text-[10px] text-slate-200"
                          >
                            <option value="real">Real</option>
                            <option value="demo">Demo</option>
                          </select>
                          <input
                            type="number"
                            min="1"
                            step="any"
                            value={amtStr}
                            onChange={(e) =>
                              setAdjustAmounts((prev) => ({ ...prev, [member.uid]: e.target.value }))
                            }
                            aria-label={`Adjust amount for ${member.username}`}
                            className="w-16 bg-slate-900 border border-slate-800 rounded px-1.5 py-1 text-[10px] font-mono text-white"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const n = parseFloat(amtStr);
                              if (n > 0) onAdjustMemberBalance(member.uid, walletChoice, 'add', n);
                            }}
                            className="px-2 py-1 rounded bg-emerald-600/25 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold"
                          >
                            +
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const n = parseFloat(amtStr);
                              if (n > 0) onAdjustMemberBalance(member.uid, walletChoice, 'deduct', n);
                            }}
                            className="px-2 py-1 rounded bg-red-600/25 hover:bg-red-600/40 text-red-300 border border-red-500/30 text-[10px] font-bold"
                          >
                            -
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 7: MANAGE STAFF & SYSTEM ROLES */}
      {tab === 'roles' && (
        <div className="space-y-3 text-xs">
          <div className="bg-slate-950 border border-purple-500/30 rounded-xl p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-purple-300 flex items-center gap-1.5">
                <Shield className="w-4 h-4" />
                <span>Assign Staff & System Roles</span>
              </h4>
              {!isAdmin && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30">
                  Admin Exclusive
                </span>
              )}
            </div>

            {!isAdmin ? (
              <p className="text-slate-400 text-[11px]">
                Only Full Admin accounts can promote or demote system staff roles.
              </p>
            ) : (
              <form onSubmit={handleExecuteRoleAssignForm} className="space-y-2.5">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">User UID or Email Address</label>
                  <input
                    type="text"
                    required
                    value={roleTargetIdentifier}
                    onChange={(e) => setRoleTargetIdentifier(e.target.value)}
                    placeholder="e.g., marcus.c@zectrade.io or USR-7731"
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">Assign System Role</label>
                  <select
                    aria-label="System Role Assignment"
                    value={roleTargetValue}
                    onChange={(e) => setRoleTargetValue(e.target.value as UserRole)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-white"
                  >
                    <option value="user">Standard User (No Staff Access)</option>
                    <option value="staff">Staff (Full Panel Access)</option>
                    <option value="caiwu">Caiwu Account (Deposits & Gateway Only)</option>
                    <option value="chukuan">Chukuan Account (Withdrawals & Gateway Only)</option>
                    <option value="admin">Full Admin (All Control Privileges)</option>
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={roleAssignBusy}
                  className="w-full py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold"
                >
                  {roleAssignBusy ? 'Assigning Role...' : 'Assign Role Permission'}
                </button>
              </form>
            )}
          </div>

          {isAdmin && (
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Current Staff & Directory Roles ({members.length})
              </p>
              <div className="space-y-1.5">
                {members.map((m) => (
                  <div
                    key={m.uid}
                    className="flex flex-wrap items-center justify-between gap-2 bg-slate-900/60 border border-slate-800/80 rounded-lg px-2.5 py-1.5"
                  >
                    <div className="min-w-0">
                      <span className="font-semibold text-white text-[11px]">{m.username}</span>
                      <span className="text-[10px] font-mono text-slate-400 ml-2">{m.email}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-800 text-purple-300">
                        {m.role}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setRoleTargetIdentifier(m.email || m.uid);
                          setRoleTargetValue(m.role);
                        }}
                        className="text-[10px] text-sky-400 hover:text-sky-300 font-semibold"
                      >
                        Select
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </ModalShell>
  );
};

