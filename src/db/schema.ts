import { relations } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  username: text('username').notNull(),
  role: text('role').notNull().default('user'),
  securityPin: text('security_pin').notNull().default('1234'),
  avatarUrl: text('avatar_url'),
  fullName: text('full_name'),
  phone: text('phone'),
  country: text('country'),
  bio: text('bio'),
  withdrawMethod: text('withdraw_method').notNull().default('kpay'),
  withdrawAccountName: text('withdraw_account_name'),
  withdrawAccountNumber: text('withdraw_account_number'),
  isBlocked: boolean('is_blocked').notNull().default(false),
  isWithdrawBlocked: boolean('is_withdraw_blocked').notNull().default(false),
  hasDepositedBefore: boolean('has_deposited_before').notNull().default(false),
  hasTradedAfterDeposit: boolean('has_traded_after_deposit').notNull().default(false),
  withdrawLockClearedByAdmin: boolean('withdraw_lock_cleared_by_admin').notNull().default(false),
  realBalance: doublePrecision('real_balance').notNull().default(2),
  demoBalance: doublePrecision('demo_balance').notNull().default(100000),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const fitnessMetrics = pgTable('fitness_metrics', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  dayDate: text('day_date').notNull(), // YYYY-MM-DD
  dayLabel: text('day_label').notNull(),
  discipline: text('discipline').notNull(),
  intensityScore: integer('intensity_score').notNull(), // 0 - 100
  recoveryScore: integer('recovery_score').notNull(), // 0 - 100
  avgBpm: integer('avg_bpm').notNull(),
  strainScore: doublePrecision('strain_score').notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  fitnessMetrics: many(fitnessMetrics),
}));

export const fitnessMetricsRelations = relations(fitnessMetrics, ({ one }) => ({
  member: one(users, {
    fields: [fitnessMetrics.userId],
    references: [users.id],
  }),
}));

export const walletRequests = pgTable('wallet_requests', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid').notNull(),
  userEmail: text('user_email').notNull(),
  requestKind: text('request_kind').notNull(), // 'deposit' | 'withdrawal'
  typeLabel: text('type_label').notNull(),
  method: text('method').notNull(),
  amountUsd: doublePrecision('amount_usd').notNull(),
  target: text('target').notNull(),
  status: text('status').notNull().default('PENDING'), // 'PENDING' | 'SUCCESS' | 'FAILED'
  rejectReason: text('reject_reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  processedAt: timestamp('processed_at'),
});

export const customCoins = pgTable('custom_coins', {
  id: serial('id').primaryKey(),
  symbol: text('symbol').notNull().unique(), // e.g. 'XUUSDT'
  label: text('label').notNull(), // e.g. 'XU / USDT'
  shortName: text('short_name').notNull(), // e.g. 'XU/USDT'
  currentPrice: doublePrecision('current_price').notNull().default(100),
  openPrice24h: doublePrecision('open_price_24h').notNull().default(100),
  high24h: doublePrecision('high_24h').notNull().default(100),
  low24h: doublePrecision('low_24h').notNull().default(100),
  enabled: boolean('enabled').notNull().default(true),
  scheduleJson: text('schedule_json'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const customCoinCandles = pgTable(
  'custom_coin_candles',
  {
    id: serial('id').primaryKey(),
    symbol: text('symbol').notNull(),
    bucketTimeMs: doublePrecision('bucket_time_ms').notNull(),
    open: doublePrecision('open').notNull(),
    high: doublePrecision('high').notNull(),
    low: doublePrecision('low').notNull(),
    close: doublePrecision('close').notNull(),
    volume: doublePrecision('volume').notNull().default(0),
  },
  (t) => [uniqueIndex('custom_coin_candles_sym_bucket_idx').on(t.symbol, t.bucketTimeMs)]
);

export const coinTrades = pgTable('coin_trades', {
  id: serial('id').primaryKey(),
  tradeUid: text('trade_uid').notNull().unique(),
  symbol: text('symbol').notNull(),
  userUid: text('user_uid').notNull(),
  userEmail: text('user_email').notNull(),
  side: text('side').notNull(), // 'buy' | 'sell'
  leverage: integer('leverage').notNull().default(1),
  margin: doublePrecision('margin').notNull(),
  entryPrice: doublePrecision('entry_price').notNull(),
  closePrice: doublePrecision('close_price'),
  liqPrice: doublePrecision('liq_price'),
  tradingFee: doublePrecision('trading_fee').notNull().default(0),
  pnlVal: doublePrecision('pnl_val').notNull().default(0),
  status: text('status').notNull().default('OPEN'), // 'OPEN' | 'CLOSED' | 'LIQUIDATED'
  accountMode: text('account_mode').notNull().default('demo'), // 'demo' | 'real'
  openedAt: timestamp('opened_at').defaultNow().notNull(),
  closedAt: timestamp('closed_at'),
});

export const adminProfitClaims = pgTable('admin_profit_claims', {
  id: serial('id').primaryKey(),
  symbol: text('symbol').notNull(),
  amountUsd: doublePrecision('amount_usd').notNull(),
  claimedByUid: text('claimed_by_uid').notNull(),
  claimedByEmail: text('claimed_by_email').notNull(),
  claimedAt: timestamp('claimed_at').defaultNow().notNull(),
});

export const lotteryConfig = pgTable('lottery_config', {
  id: integer('id').primaryKey(),
  roundDurationSec: integer('round_duration_sec').notNull().default(60),
  lockSeconds: integer('lock_seconds').notNull().default(5),
  feePct: doublePrecision('fee_pct').notNull().default(0.12),
  payoutMultiplier: doublePrecision('payout_multiplier').notNull().default(2),
  numberMultiplier: doublePrecision('number_multiplier').notNull().default(9),
  resultMode: text('result_mode').notNull().default('auto_balance'), // 'auto_balance' | 'manual' | 'random'
  forcedResult: text('forced_result'), // 'green' | 'red' | null
  forcedNumber: integer('forced_number'), // 0..9 | null
  isPaused: boolean('is_paused').notNull().default(false),
  accumulatedProfit: doublePrecision('accumulated_profit').notNull().default(0),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const lotteryRounds = pgTable('lottery_rounds', {
  id: serial('id').primaryKey(),
  roundNumber: integer('round_number').notNull().unique(),
  roundCode: text('round_code').notNull().unique(),
  durationSec: integer('duration_sec').notNull().default(60),
  startedAtMs: doublePrecision('started_at_ms').notNull(),
  endsAtMs: doublePrecision('ends_at_ms').notNull(),
  pausedRemainingMs: doublePrecision('paused_remaining_ms'),
  status: text('status').notNull().default('OPEN'), // 'OPEN' | 'SETTLED'
  resultMode: text('result_mode').notNull().default('auto_balance'),
  forcedResult: text('forced_result'),
  forcedNumber: integer('forced_number'),
  winningColor: text('winning_color'), // 'green' | 'red' | null
  winningNumber: integer('winning_number'), // 0..9 | null
  greenTotal: doublePrecision('green_total').notNull().default(0),
  redTotal: doublePrecision('red_total').notNull().default(0),
  greenCount: integer('green_count').notNull().default(0),
  redCount: integer('red_count').notNull().default(0),
  totalFees: doublePrecision('total_fees').notNull().default(0),
  totalPayouts: doublePrecision('total_payouts').notNull().default(0),
  houseProfit: doublePrecision('house_profit').notNull().default(0),
  settledAt: timestamp('settled_at'),
});

export const lotteryBets = pgTable('lottery_bets', {
  id: serial('id').primaryKey(),
  betUid: text('bet_uid').notNull().unique(),
  roundCode: text('round_code').notNull(),
  userUid: text('user_uid').notNull(),
  userEmail: text('user_email').notNull(),
  accountMode: text('account_mode').notNull().default('demo'), // 'demo' | 'real'
  betType: text('bet_type').notNull().default('color'), // 'color' | 'number'
  color: text('color').notNull(), // 'green' | 'red'
  pickedNumber: integer('picked_number'), // 0..9 | null
  stake: doublePrecision('stake').notNull(),
  feePct: doublePrecision('fee_pct').notNull(),
  feeAmount: doublePrecision('fee_amount').notNull(),
  netStake: doublePrecision('net_stake').notNull(),
  multiplier: doublePrecision('multiplier').notNull().default(2),
  potentialPayout: doublePrecision('potential_payout').notNull(),
  outcome: text('outcome').notNull().default('PENDING'), // 'PENDING' | 'WIN' | 'LOSS'
  payoutAmount: doublePrecision('payout_amount').notNull().default(0),
  netProfit: doublePrecision('net_profit').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  settledAt: timestamp('settled_at'),
});

export const digitLotteryDraws = pgTable('digit_lottery_draws', {
  id: serial('id').primaryKey(),
  drawUid: text('draw_uid').notNull().unique(),
  gameType: text('game_type').notNull(), // '2D' | '3D' | '6D'
  drawLabel: text('draw_label').notNull(),
  scheduledReleaseAtMs: doublePrecision('scheduled_release_at_ms').notNull(),
  lockBeforeSec: integer('lock_before_sec').notNull().default(10),
  payoutMultiplier: doublePrecision('payout_multiplier').notNull().default(80),
  feePct: doublePrecision('fee_pct').notNull().default(0.12),
  manualResult: text('manual_result'),
  winningNumber: text('winning_number'),
  status: text('status').notNull().default('SCHEDULED'), // 'SCHEDULED' | 'RELEASED'
  totalStake: doublePrecision('total_stake').notNull().default(0),
  totalPayouts: doublePrecision('total_payouts').notNull().default(0),
  betCount: integer('bet_count').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  releasedAt: timestamp('released_at'),
});

export const digitLotteryBets = pgTable('digit_lottery_bets', {
  id: serial('id').primaryKey(),
  betUid: text('bet_uid').notNull().unique(),
  drawUid: text('draw_uid').notNull(),
  gameType: text('game_type').notNull(), // '2D' | '3D' | '6D'
  userUid: text('user_uid').notNull(),
  userEmail: text('user_email').notNull(),
  accountMode: text('account_mode').notNull().default('demo'),
  pickedNumber: text('picked_number').notNull(),
  stake: doublePrecision('stake').notNull(),
  feePct: doublePrecision('fee_pct').notNull(),
  feeAmount: doublePrecision('fee_amount').notNull(),
  netStake: doublePrecision('net_stake').notNull(),
  multiplier: doublePrecision('multiplier').notNull().default(80),
  potentialPayout: doublePrecision('potential_payout').notNull(),
  outcome: text('outcome').notNull().default('PENDING'), // 'PENDING' | 'WIN' | 'LOSS'
  payoutAmount: doublePrecision('payout_amount').notNull().default(0),
  netProfit: doublePrecision('net_profit').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  settledAt: timestamp('settled_at'),
});

export const newsArticles = pgTable('news_articles', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  content: text('content').notNull(),
  category: text('category').notNull().default('Market Brief'),
  authorName: text('author_name').notNull().default('Zectrade Research Desk'),
  imageUrl: text('image_url'),
  isFeatured: boolean('is_featured').notNull().default(false),
  isPublished: boolean('is_published').notNull().default(true),
  readTimeMin: integer('read_time_min').notNull().default(3),
  publishedAtMs: doublePrecision('published_at_ms').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});




