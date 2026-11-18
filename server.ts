import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import {
  adjustMemberBalanceByIdentifier,
  applyWalletBalanceDelta,
  approveDepositRequest,
  approveWithdrawalRequest,
  assignMemberRoleByIdentifier,
  createWalletRequest,
  executeP2PTransferInDb,
  getOrCreateUser,
  getSevenDayFitnessHeatmap,
  getUserByUid,
  listManagedMembers,
  listMemberWalletActivity,
  listPendingWalletRequests,
  lookupTransferRecipient,
  recordFitnessSessionMetric,
  rejectDepositRequest,
  rejectWithdrawalRequest,
  seedBaselineDirectoryAndMetrics,
  updateMemberAdminControl,
  updateMemberPinByUid,
  updateUserProfileByUid,
} from './src/db/users.ts';
import {
  claimAdminCoinProfit,
  deleteCustomCoin,
  getCoinTradeAnalytics,
  getCustomCoinKlines,
  listCustomCoins,
  recordCoinTrade,
  updateCoinPriceControl,
  upsertCustomCoin,
} from './src/db/coins.ts';
import {
  adminUpsertOrScheduleDigitDraw,
  getLotteryLiveState,
  placeDigitLotteryBet,
  placeLotteryBet,
  tickLotteryEngine,
  updateLotteryAdminConfig,
} from './src/db/lottery.ts';
import {
  createNewsArticle,
  deleteNewsArticle,
  listNewsArticles,
  updateNewsArticle,
} from './src/db/news.ts';
import type { ChartTimeframe } from './src/utils/chartEngine.ts';
import { normalizeNewsArticleInput } from './src/utils/newsUtils.ts';
import { normalizeMemberProfileInput } from './src/utils/tradingEngine.ts';
import {
  createAdminSessionToken,
  requireAdmin,
  requireAuth,
  requireRoles,
  resolveAuthUserFromRequest,
  verifyAdminSessionToken,
  type AuthRequest,
} from './src/middleware/auth.ts';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

function timingSafeEqualString(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Sync Firebase-authenticated user profile to Cloud SQL PostgreSQL
  app.post('/api/auth/session', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const requestedUsername =
        typeof req.body?.username === 'string' ? req.body.username : undefined;
      const dbUser = await getOrCreateUser({
        uid: req.user.uid,
        email: req.user.email,
        username: requestedUsername,
      });
      return res.json({ user: dbUser });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Session synchronization failed.';
      return res.status(500).json({ error: msg });
    }
  });

  // Member updates own profile picture, personal details, & saved withdraw account
  app.patch('/api/profile', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const normalized = normalizeMemberProfileInput(req.body ?? {}, { allowEmailAndPin: false });
      if (!normalized.ok) {
        return res.status(400).json({ error: normalized.error });
      }
      await getOrCreateUser({
        uid: req.user.uid,
        email: req.user.email,
      });
      const updated = await updateUserProfileByUid(req.user.uid, normalized.data);
      if (!updated) {
        return res.status(404).json({ error: 'User profile not found.' });
      }
      return res.json({ user: updated });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to update profile.';
      return res.status(500).json({ error: msg });
    }
  });

  // Member updates own 4-digit Security PIN in Cloud SQL
  app.patch('/api/profile/pin', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
      if (!/^\d{4}$/.test(pin)) {
        return res.status(400).json({ error: 'Security PIN must be exactly 4 digits.' });
      }
      await getOrCreateUser({ uid: req.user.uid, email: req.user.email });
      const updated = await updateMemberPinByUid(req.user.uid, pin);
      if (!updated) return res.status(404).json({ error: 'User profile not found.' });
      return res.json({ ok: true, user: updated });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to update Security PIN.';
      return res.status(500).json({ error: msg });
    }
  });

  // Dedicated Admin Portal Login returning signed Admin session token
  app.post('/api/admin/login', async (req, res) => {
    try {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';

      const expectedEmail = (process.env.ADMIN_PORTAL_EMAIL || 'admin@zectrade.io').toLowerCase();
      const expectedPassword = process.env.ADMIN_PORTAL_PASSCODE || 'Admin@2026';

      if (
        !email ||
        !password ||
        !timingSafeEqualString(email, expectedEmail) ||
        !timingSafeEqualString(password, expectedPassword)
      ) {
        return res.status(401).json({ error: 'Invalid Admin email or passcode.' });
      }

      await seedBaselineDirectoryAndMetrics();

      const adminUser = await getOrCreateUser({
        uid: 'ADMIN-ZEC-0001',
        email: expectedEmail,
        username: 'Lead Admin',
        role: 'admin',
      });

      const token = createAdminSessionToken(adminUser.uid, adminUser.email);
      return res.json({ token, user: adminUser });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Admin authentication failed.';
      return res.status(500).json({ error: msg });
    }
  });

  // Authenticated member deposit/withdrawal request logging
  app.post('/api/wallet/requests', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const body = req.body ?? {};
      const requestKind = body.requestKind === 'withdrawal' ? 'withdrawal' : 'deposit';
      const amountUsd = Number(body.amountUsd);
      if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
        return res.status(400).json({ error: 'Valid positive USD amount is required.' });
      }
      const created = await createWalletRequest({
        userUid: req.user.uid,
        userEmail: req.user.email,
        requestKind,
        typeLabel:
          typeof body.typeLabel === 'string' && body.typeLabel.trim()
            ? body.typeLabel.trim()
            : requestKind === 'deposit'
            ? 'DEPOSIT SUBMITTED'
            : 'WITHDRAWAL',
        method: typeof body.method === 'string' ? body.method : 'kpay',
        amountUsd,
        target: typeof body.target === 'string' ? body.target : 'Wallet',
      });
      return res.status(201).json({ request: created });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to create wallet request.';
      return res.status(500).json({ error: msg });
    }
  });

  // Sync latest authoritative wallet balances & transfer logs for authenticated member
  app.get('/api/wallet/sync', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const dbUser =
        (await getUserByUid(req.user.uid)) ??
        (await getOrCreateUser({ uid: req.user.uid, email: req.user.email }));
      const activity = await listMemberWalletActivity(req.user.uid);
      return res.json({
        realBalance: dbUser.realBalance,
        demoBalance: dbUser.demoBalance,
        securityPin: dbUser.securityPin,
        hasDepositedBefore: dbUser.hasDepositedBefore,
        hasTradedAfterDeposit: dbUser.hasTradedAfterDeposit,
        withdrawLockClearedByAdmin: dbUser.withdrawLockClearedByAdmin,
        isWithdrawBlocked: dbUser.isWithdrawBlocked,
        isBlocked: dbUser.isBlocked,
        activity,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to sync wallet.';
      return res.status(500).json({ error: msg });
    }
  });

  // Apply atomic balance delta for trades, swaps, withdrawals, and lottery settlements
  app.post('/api/wallet/delta', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const body = req.body ?? {};
      const wallet = body.wallet === 'demo' ? 'demo' : 'real';
      const delta = Number(body.delta);
      const markTradedAfterDeposit = Boolean(body.markTradedAfterDeposit);

      if (!Number.isFinite(delta) || Math.abs(delta) > 100_000_000) {
        return res.status(400).json({ error: 'Valid balance delta is required.' });
      }

      const updated = await applyWalletBalanceDelta({
        uid: req.user.uid,
        email: req.user.email,
        wallet,
        delta,
        markTradedAfterDeposit,
      });
      if (!updated) {
        return res.status(404).json({ error: 'Account not found.' });
      }
      return res.json({
        realBalance: updated.realBalance,
        demoBalance: updated.demoBalance,
        hasDepositedBefore: updated.hasDepositedBefore,
        hasTradedAfterDeposit: updated.hasTradedAfterDeposit,
        withdrawLockClearedByAdmin: updated.withdrawLockClearedByAdmin,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to apply wallet balance update.';
      return res.status(500).json({ error: msg });
    }
  });

  // Verify recipient account existence by UID or Email before P2P confirmation
  app.get('/api/wallet/transfer/lookup', async (req, res) => {
    try {
      const identifier = typeof req.query.identifier === 'string' ? req.query.identifier.trim() : '';
      if (!identifier) {
        return res.status(400).json({ error: 'Enter recipient UID or email.' });
      }
      const recipient = await lookupTransferRecipient(identifier);
      if (!recipient) {
        return res.status(404).json({ error: "Account doesn't exist." });
      }
      return res.json({ recipient });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to look up recipient account.';
      return res.status(500).json({ error: msg });
    }
  });

  // Atomic Direct P2P Transfer: verifies PIN, deducts sender, and credits recipient account
  app.post('/api/wallet/transfer', async (req, res) => {
    try {
      const resolved = await resolveAuthUserFromRequest(req);
      if (resolved.error) {
        return res.status(401).json({ error: resolved.error });
      }

      const body = req.body ?? {};
      const recipientIdentifier =
        typeof body.recipientIdentifier === 'string' ? body.recipientIdentifier.trim() : '';
      const accountMode = body.accountMode === 'demo' ? 'demo' : 'real';
      const amount = Number(body.amount);
      const pin = typeof body.pin === 'string' ? body.pin.trim() : '';

      if (!/^\d{4}$/.test(pin)) {
        return res.status(400).json({ error: 'Enter your 4-digit Security PIN.' });
      }

      const isAuthed = Boolean(resolved.user);
      const senderUid = resolved.user?.uid ?? (typeof body.senderUid === 'string' ? body.senderUid.trim() : '');
      const senderEmail = resolved.user?.email ?? (typeof body.senderEmail === 'string' ? body.senderEmail.trim() : '');

      if (!isAuthed && senderUid !== 'DEMO-ZEC-8841') {
        return res.status(401).json({ error: 'Authentication required for P2P transfer.' });
      }

      if (isAuthed && resolved.user) {
        await getOrCreateUser({ uid: resolved.user.uid, email: resolved.user.email });
      }

      const result = await executeP2PTransferInDb({
        senderUid,
        senderEmail,
        recipientIdentifier,
        accountMode,
        amount,
        pin,
        isLocalDemoSession: !isAuthed,
        localSenderBalance: !isAuthed ? Number(body.localSenderBalance ?? 0) : undefined,
        expectedLocalPin: !isAuthed && typeof body.expectedPin === 'string' ? body.expectedPin : undefined,
      });

      if (!result.ok) {
        return res.status(result.status).json({ error: result.error });
      }
      return res.json(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Direct P2P transfer failed.';
      return res.status(500).json({ error: msg });
    }
  });

  // Staff-accessible pending deposits & withdrawals (scoped by role)
  app.get(
    '/api/staff/requests',
    requireRoles(['admin', 'staff', 'caiwu', 'chukuan']),
    async (req: AuthRequest, res) => {
      try {
        const role = req.user?.role || 'user';
        const includeDeposits = role === 'admin' || role === 'staff' || role === 'caiwu';
        const includeWithdrawals = role === 'admin' || role === 'staff' || role === 'chukuan';
        const [deposits, withdrawals] = await Promise.all([
          includeDeposits ? listPendingWalletRequests('deposit') : Promise.resolve([]),
          includeWithdrawals ? listPendingWalletRequests('withdrawal') : Promise.resolve([]),
        ]);
        return res.json({ deposits, withdrawals });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Failed to load staff requests.';
        return res.status(500).json({ error: msg });
      }
    }
  );

  app.post(
    '/api/staff/deposits/:id/approve',
    requireRoles(['admin', 'staff', 'caiwu']),
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid request ID.' });
        const result = await approveDepositRequest(id);
        if (!result) return res.status(404).json({ error: 'Pending deposit not found.' });
        return res.json(result);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Failed to approve deposit.';
        return res.status(500).json({ error: msg });
      }
    }
  );

  app.post(
    '/api/staff/deposits/:id/reject',
    requireRoles(['admin', 'staff', 'caiwu']),
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid request ID.' });
        const reason =
          typeof req.body?.reason === 'string' && req.body.reason.trim()
            ? req.body.reason.trim()
            : 'Verification declined. Please check details or contact support.';
        const updated = await rejectDepositRequest(id, reason);
        if (!updated) return res.status(404).json({ error: 'Pending deposit not found.' });
        return res.json({ request: updated });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Failed to reject deposit.';
        return res.status(500).json({ error: msg });
      }
    }
  );

  app.post(
    '/api/staff/withdrawals/:id/approve',
    requireRoles(['admin', 'staff', 'chukuan']),
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid request ID.' });
        const updated = await approveWithdrawalRequest(id);
        if (!updated) return res.status(404).json({ error: 'Pending withdrawal not found.' });
        return res.json({ request: updated });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Failed to approve withdrawal.';
        return res.status(500).json({ error: msg });
      }
    }
  );

  app.post(
    '/api/staff/withdrawals/:id/reject',
    requireRoles(['admin', 'staff', 'chukuan']),
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid request ID.' });
        const reason =
          typeof req.body?.reason === 'string' && req.body.reason.trim()
            ? req.body.reason.trim()
            : '';
        if (!reason) return res.status(400).json({ error: 'Rejection reason is required.' });
        const result = await rejectWithdrawalRequest(id, reason);
        if (!result) return res.status(404).json({ error: 'Pending withdrawal not found.' });
        return res.json(result);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Failed to reject withdrawal.';
        return res.status(500).json({ error: msg });
      }
    }
  );

  // Staff-accessible Member Directory (Admin, Staff, Caiwu)
  app.get(
    '/api/admin/members',
    requireRoles(['admin', 'staff', 'caiwu']),
    async (req: AuthRequest, res) => {
      try {
        const search = typeof req.query.q === 'string' ? req.query.q : undefined;
        const allMembers = await listManagedMembers(search);
        const members =
          req.user?.role === 'admin'
            ? allMembers
            : allMembers.filter((m) => m.role === 'user');
        return res.json({ members });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Failed to load members.';
        return res.status(500).json({ error: msg });
      }
    }
  );

  // Admin/Staff Member Block/Unblock, Withdraw Lock Clearance, Profile, Balance & Role Updates
  app.patch(
    '/api/admin/members/:uid',
    requireRoles(['admin', 'staff', 'caiwu']),
    async (req: AuthRequest, res) => {
      try {
        const uid = req.params.uid;
        const body = req.body ?? {};
        const callerRole = req.user?.role || 'user';
        const updates: Parameters<typeof updateMemberAdminControl>[1] = {};

        if (typeof body.isBlocked === 'boolean') updates.isBlocked = body.isBlocked;
        if (typeof body.isWithdrawBlocked === 'boolean') {
          updates.isWithdrawBlocked = body.isWithdrawBlocked;
        }
        if (callerRole === 'admin') {
          if (typeof body.withdrawLockClearedByAdmin === 'boolean') {
            updates.withdrawLockClearedByAdmin = body.withdrawLockClearedByAdmin;
          }
          if (typeof body.hasDepositedBefore === 'boolean') {
            updates.hasDepositedBefore = body.hasDepositedBefore;
          }
          if (typeof body.hasTradedAfterDeposit === 'boolean') {
            updates.hasTradedAfterDeposit = body.hasTradedAfterDeposit;
          }
          if (typeof body.role === 'string') updates.role = body.role;
          if (typeof body.realBalance === 'number' && Number.isFinite(body.realBalance)) {
            updates.realBalance = Math.max(0, body.realBalance);
          }
          if (typeof body.demoBalance === 'number' && Number.isFinite(body.demoBalance)) {
            updates.demoBalance = Math.max(0, body.demoBalance);
          }

          const profileCheck = normalizeMemberProfileInput(body, { allowEmailAndPin: true });
          if (!profileCheck.ok) {
            return res.status(400).json({ error: profileCheck.error });
          }
          Object.assign(updates, profileCheck.data);
        }

        const updated = await updateMemberAdminControl(uid, updates);
        if (!updated) {
          return res.status(404).json({ error: 'Member not found.' });
        }
        return res.json({ member: updated });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Failed to update member.';
        return res.status(500).json({ error: msg });
      }
    }
  );

  // Admin-only Balance Adjust by UID or Email
  app.post('/api/admin/adjust-balance', requireAdmin, async (req, res) => {
    try {
      const body = req.body ?? {};
      const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : '';
      const wallet = body.wallet === 'demo' ? 'demo' : 'real';
      const action = body.action === 'deduct' ? 'deduct' : 'add';
      const amount = Number(body.amount);
      if (!identifier || !Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: 'Valid UID/Email and positive amount are required.' });
      }
      const updated = await adjustMemberBalanceByIdentifier({
        identifier,
        wallet,
        action,
        amount,
      });
      if (!updated) return res.status(404).json({ error: 'Member not found.' });
      return res.json({ member: updated });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Balance adjustment failed.';
      return res.status(500).json({ error: msg });
    }
  });

  // Admin-only Role Assign by UID or Email
  app.post('/api/admin/assign-role', requireAdmin, async (req, res) => {
    try {
      const body = req.body ?? {};
      const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : '';
      const role = typeof body.role === 'string' ? body.role.trim().toLowerCase() : '';
      const allowed = new Set(['user', 'staff', 'caiwu', 'chukuan', 'admin']);
      if (!identifier || !allowed.has(role)) {
        return res.status(400).json({ error: 'Valid UID/Email and role are required.' });
      }
      const updated = await assignMemberRoleByIdentifier(identifier, role);
      if (!updated) return res.status(404).json({ error: 'User account not found.' });
      return res.json({ member: updated });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Role assignment failed.';
      return res.status(500).json({ error: msg });
    }
  });

  // Admin-only 7-day Workout Intensity & Biometric Recovery Heatmap Dataset
  app.get('/api/fitness/heatmap', requireAdmin, async (_req, res) => {
    try {
      const records = await getSevenDayFitnessHeatmap();
      return res.json({ records });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to load heatmap telemetry.';
      return res.status(500).json({ error: msg });
    }
  });

  // Authenticated Workout Telemetry Recording
  app.post('/api/fitness/log', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const body = req.body ?? {};
      const saved = await recordFitnessSessionMetric({
        uid: req.user.uid,
        email: req.user.email,
        discipline: typeof body.discipline === 'string' ? body.discipline : 'Running',
        intensityScore: Number(body.intensityScore ?? 70),
        recoveryScore: Number(body.recoveryScore ?? 75),
        avgBpm: Number(body.avgBpm ?? 140),
        strainScore: Number(body.strainScore ?? 10.5),
        durationMinutes: Number(body.durationMinutes ?? 30),
      });
      return res.status(201).json({ metric: saved });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to record training metric.';
      return res.status(500).json({ error: msg });
    }
  });

  // Public active custom coins feed (syncs Admin-arranged prices & XU/USDT live to all traders)
  app.get('/api/coins', async (_req, res) => {
    try {
      const coins = await listCustomCoins(false);
      return res.json({ coins });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to load custom coins.';
      return res.status(500).json({ error: msg });
    }
  });

  // Public persistent OHLCV klines for custom coins across 1m..1mo timeframes
  app.get('/api/coins/:symbol/klines', async (req, res) => {
    try {
      const rawInterval = typeof req.query.interval === 'string' ? req.query.interval.trim() : '15m';
      const normalizedInterval = rawInterval === '1M' ? '1mo' : rawInterval;
      const allowedIntervals = new Set<ChartTimeframe>([
        '1m',
        '5m',
        '15m',
        '1h',
        '4h',
        '1d',
        '1w',
        '1mo',
      ]);
      const interval: ChartTimeframe = allowedIntervals.has(normalizedInterval as ChartTimeframe)
        ? (normalizedInterval as ChartTimeframe)
        : '15m';
      const rawLimit = Number(req.query.limit ?? 360);
      const limit = Number.isFinite(rawLimit) ? Math.min(500, Math.max(60, Math.round(rawLimit))) : 360;
      const candles = await getCustomCoinKlines(req.params.symbol, interval, limit);
      return res.json({ symbol: req.params.symbol, interval, candles });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to load custom coin klines.';
      return res.status(500).json({ error: msg });
    }
  });

  // Record trade open / close / liquidation for accurate Admin coin profit & loss analytics
  app.post('/api/trades/record', async (req, res) => {
    try {
      const body = req.body ?? {};
      const tradeUid = typeof body.tradeUid === 'string' ? body.tradeUid.trim() : '';
      const symbol = typeof body.symbol === 'string' ? body.symbol.trim() : '';
      if (!tradeUid || !symbol) {
        return res.status(400).json({ error: 'tradeUid and symbol are required.' });
      }
      const saved = await recordCoinTrade({
        tradeUid,
        symbol,
        userUid: typeof body.userUid === 'string' && body.userUid.trim() ? body.userUid.trim() : 'DEMO-TRADER',
        userEmail: typeof body.userEmail === 'string' && body.userEmail.trim() ? body.userEmail.trim() : 'demo@zectrade.local',
        side: body.side === 'sell' ? 'sell' : 'buy',
        leverage: Number(body.leverage ?? 1),
        margin: Math.max(0, Number(body.margin ?? 0)),
        entryPrice: Math.max(0, Number(body.entryPrice ?? 0)),
        closePrice: body.closePrice !== undefined && body.closePrice !== null ? Number(body.closePrice) : null,
        liqPrice: body.liqPrice !== undefined && body.liqPrice !== null ? Number(body.liqPrice) : null,
        tradingFee: Math.max(0, Number(body.tradingFee ?? 0)),
        pnlVal: Number(body.pnlVal ?? 0),
        status:
          body.status === 'LIQUIDATED'
            ? 'LIQUIDATED'
            : body.status === 'CLOSED'
            ? 'CLOSED'
            : 'OPEN',
        accountMode: body.accountMode === 'real' ? 'real' : 'demo',
      });
      return res.status(201).json({ trade: saved });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to record trade.';
      return res.status(500).json({ error: msg });
    }
  });

  // Admin: list all custom coins (enabled + disabled)
  app.get('/api/admin/coins', requireAdmin, async (_req, res) => {
    try {
      const coins = await listCustomCoins(true);
      return res.json({ coins });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to load admin coins.';
      return res.status(500).json({ error: msg });
    }
  });

  // Admin: add or update custom coin (e.g., XU/USDT)
  app.post('/api/admin/coins', requireAdmin, async (req, res) => {
    try {
      const body = req.body ?? {};
      const symbol = typeof body.symbol === 'string' ? body.symbol.trim() : '';
      const initialPrice = Number(body.initialPrice);
      if (!symbol || !Number.isFinite(initialPrice) || initialPrice <= 0) {
        return res.status(400).json({ error: 'Valid coin symbol and positive initial price are required.' });
      }
      const coin = await upsertCustomCoin({
        symbol,
        label: typeof body.label === 'string' ? body.label : undefined,
        initialPrice,
        enabled: body.enabled !== false,
      });
      return res.status(201).json({ coin });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to save custom coin.';
      return res.status(500).json({ error: msg });
    }
  });

  // Admin: delete custom coin
  app.delete('/api/admin/coins/:symbol', requireAdmin, async (req, res) => {
    try {
      const removed = await deleteCustomCoin(req.params.symbol);
      if (!removed) return res.status(404).json({ error: 'Custom coin not found.' });
      return res.json({ deleted: true, symbol: req.params.symbol });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to delete custom coin.';
      return res.status(500).json({ error: msg });
    }
  });

  // Admin: set manual/gradual price or arrange timed Up -> Down-to-Bottom liquidation schedule
  app.patch('/api/admin/coins/:symbol/price-control', requireAdmin, async (req, res) => {
    try {
      const symbol = req.params.symbol;
      const body = req.body ?? {};
      const coin = await updateCoinPriceControl(symbol, {
        mode: body.mode,
        manualPrice: body.manualPrice !== undefined ? Number(body.manualPrice) : undefined,
        deltaPct: body.deltaPct !== undefined ? Number(body.deltaPct) : undefined,
        transitionSec: body.transitionSec !== undefined ? Number(body.transitionSec) : undefined,
        upTargetPrice: body.upTargetPrice !== undefined ? Number(body.upTargetPrice) : undefined,
        upDurationSec: body.upDurationSec !== undefined ? Number(body.upDurationSec) : undefined,
        downTargetPrice: body.downTargetPrice !== undefined ? Number(body.downTargetPrice) : undefined,
        downDurationSec: body.downDurationSec !== undefined ? Number(body.downDurationSec) : undefined,
        repeatLoop: typeof body.repeatLoop === 'boolean' ? body.repeatLoop : undefined,
        enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
        trendBias:
          body.trendBias === 'up' || body.trendBias === 'down' || body.trendBias === 'neutral'
            ? body.trendBias
            : undefined,
        volatilityLevel:
          body.volatilityLevel === 'calm' ||
          body.volatilityLevel === 'normal' ||
          body.volatilityLevel === 'active'
            ? body.volatilityLevel
            : undefined,
        resetBaseline: typeof body.resetBaseline === 'boolean' ? body.resetBaseline : undefined,
      });
      if (!coin) return res.status(404).json({ error: 'Custom coin not found.' });
      return res.json({ coin });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to update coin price schedule.';
      return res.status(500).json({ error: msg });
    }
  });

  // Admin: per-coin trade count, win profit, loss/liquidation, net profit & claim history
  app.get('/api/admin/coins/:symbol/analytics', requireAdmin, async (req, res) => {
    try {
      const analytics = await getCoinTradeAnalytics(req.params.symbol);
      return res.json({ analytics });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to load coin trade analytics.';
      return res.status(500).json({ error: msg });
    }
  });

  // Admin: claim unclaimed profit for a coin and credit Admin Real balance
  app.post('/api/admin/coins/:symbol/claim-profit', requireAdmin, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const result = await claimAdminCoinProfit({
        symbol: req.params.symbol,
        adminUid: req.user.uid,
        adminEmail: req.user.email,
      });
      return res.json(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to claim coin profit.';
      return res.status(500).json({ error: msg });
    }
  });

  async function isOptionalAdminRequest(req: express.Request): Promise<boolean> {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
    const token = authHeader.split('Bearer ')[1]?.trim();
    if (!token) return false;
    if (verifyAdminSessionToken(token)) return true;
    return false;
  }

  // Lottery Live: public current round, history strip, fee/payout config, 2D/3D/6D draws, and user bets (admin fields redacted unless authorized)
  app.get('/api/lottery/state', async (req, res) => {
    try {
      const userUid = typeof req.query.userUid === 'string' ? req.query.userUid.trim() : undefined;
      const isAdmin = await isOptionalAdminRequest(req);
      const state = await getLotteryLiveState(userUid, isAdmin);
      return res.json(state);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to load Lottery Live state.';
      return res.status(500).json({ error: msg });
    }
  });

  // Lottery Live: place Red/Green color prediction OR Exact Number (0-9) trade
  app.post('/api/lottery/bet', async (req, res) => {
    try {
      const body = req.body ?? {};
      const betType = body.betType === 'number' ? 'number' : 'color';
      const color = body.color === 'red' ? 'red' : body.color === 'green' ? 'green' : undefined;
      const pickedNumber =
        body.pickedNumber !== undefined && body.pickedNumber !== null
          ? Number(body.pickedNumber)
          : null;
      const stake = Number(body.stake);

      if (betType === 'color' && !color) {
        return res.status(400).json({ error: 'Valid prediction color (green or red) is required.' });
      }
      if (
        betType === 'number' &&
        (pickedNumber === null || !Number.isInteger(pickedNumber) || pickedNumber < 0 || pickedNumber > 9)
      ) {
        return res.status(400).json({ error: 'Valid number between 0 and 9 is required.' });
      }
      if (!Number.isFinite(stake) || stake < 1) {
        return res.status(400).json({ error: 'Minimum trade stake is $1.00.' });
      }
      const userUid =
        typeof body.userUid === 'string' && body.userUid.trim()
          ? body.userUid.trim()
          : 'DEMO-ZEC-8841';
      const userEmail =
        typeof body.userEmail === 'string' && body.userEmail.trim()
          ? body.userEmail.trim()
          : 'demo@zectrade.local';
      const accountMode = body.accountMode === 'real' ? 'real' : 'demo';
      const isAdmin = await isOptionalAdminRequest(req);

      const result = await placeLotteryBet({
        userUid,
        userEmail,
        accountMode,
        betType,
        color,
        pickedNumber,
        stake,
        isAdmin,
      });
      return res.status(201).json(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to place Lottery Live trade.';
      const status =
        msg.includes('locked') || msg.includes('paused') || msg.includes('Single-side')
          ? 409
          : 400;
      return res.status(status).json({ error: msg });
    }
  });

  // 2D / 3D / 6D Lottery: place scheduled number ticket
  app.post('/api/lottery/digit-bet', async (req, res) => {
    try {
      const body = req.body ?? {};
      const drawUid = typeof body.drawUid === 'string' ? body.drawUid.trim() : '';
      const pickedNumber = typeof body.pickedNumber === 'string' ? body.pickedNumber.trim() : '';
      const stake = Number(body.stake);

      if (!drawUid || !pickedNumber) {
        return res.status(400).json({ error: 'drawUid and pickedNumber are required.' });
      }
      if (!Number.isFinite(stake) || stake < 1) {
        return res.status(400).json({ error: 'Minimum ticket stake is $1.00.' });
      }

      const userUid =
        typeof body.userUid === 'string' && body.userUid.trim()
          ? body.userUid.trim()
          : 'DEMO-ZEC-8841';
      const userEmail =
        typeof body.userEmail === 'string' && body.userEmail.trim()
          ? body.userEmail.trim()
          : 'demo@zectrade.local';
      const accountMode = body.accountMode === 'real' ? 'real' : 'demo';
      const isAdmin = await isOptionalAdminRequest(req);

      const result = await placeDigitLotteryBet({
        userUid,
        userEmail,
        accountMode,
        drawUid,
        pickedNumber,
        stake,
        isAdmin,
      });
      return res.status(201).json(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to place 2D/3D/6D ticket.';
      const status = msg.includes('closed') || msg.includes('released') ? 409 : 400;
      return res.status(status).json({ error: msg });
    }
  });

  // Lottery Live Admin Controls: mode, forced color/number, fee %, payout multipliers, duration, pause/resume
  app.patch('/api/admin/lottery/config', requireAdmin, async (req, res) => {
    try {
      const body = req.body ?? {};
      const state = await updateLotteryAdminConfig({
        resultMode:
          body.resultMode === 'auto_balance' ||
          body.resultMode === 'manual' ||
          body.resultMode === 'random'
            ? body.resultMode
            : undefined,
        forcedResult:
          body.forcedResult === 'green' || body.forcedResult === 'red'
            ? body.forcedResult
            : body.forcedResult === null
            ? null
            : undefined,
        forcedNumber:
          body.forcedNumber === null
            ? null
            : body.forcedNumber !== undefined
            ? Number(body.forcedNumber)
            : undefined,
        feePct: body.feePct !== undefined ? Number(body.feePct) : undefined,
        payoutMultiplier:
          body.payoutMultiplier !== undefined ? Number(body.payoutMultiplier) : undefined,
        numberMultiplier:
          body.numberMultiplier !== undefined ? Number(body.numberMultiplier) : undefined,
        roundDurationSec:
          body.roundDurationSec !== undefined ? Number(body.roundDurationSec) : undefined,
        isPaused: typeof body.isPaused === 'boolean' ? body.isPaused : undefined,
        settleNow: typeof body.settleNow === 'boolean' ? body.settleNow : undefined,
      });
      return res.json(state);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to update Lottery Live settings.';
      return res.status(500).json({ error: msg });
    }
  });

  // Admin: create/update 2D, 3D, or 6D scheduled draw, manual result, and release schedule timestamp
  app.post('/api/admin/lottery/digit-draw', requireAdmin, async (req, res) => {
    try {
      const body = req.body ?? {};
      const gameType = body.gameType === '3D' ? '3D' : body.gameType === '6D' ? '6D' : '2D';
      const state = await adminUpsertOrScheduleDigitDraw({
        drawUid: typeof body.drawUid === 'string' ? body.drawUid.trim() : undefined,
        gameType,
        drawLabel: typeof body.drawLabel === 'string' ? body.drawLabel : undefined,
        scheduledReleaseAtMs:
          body.scheduledReleaseAtMs !== undefined ? Number(body.scheduledReleaseAtMs) : undefined,
        lockBeforeSec:
          body.lockBeforeSec !== undefined ? Number(body.lockBeforeSec) : undefined,
        payoutMultiplier:
          body.payoutMultiplier !== undefined ? Number(body.payoutMultiplier) : undefined,
        feePct: body.feePct !== undefined ? Number(body.feePct) : undefined,
        manualResult:
          body.manualResult === null
            ? null
            : typeof body.manualResult === 'string'
            ? body.manualResult
            : undefined,
        releaseNow: typeof body.releaseNow === 'boolean' ? body.releaseNow : undefined,
        createNew: typeof body.createNew === 'boolean' ? body.createNew : undefined,
      });
      return res.json(state);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to update 2D/3D/6D draw schedule.';
      return res.status(400).json({ error: msg });
    }
  });

  // Public News Desk feed (published dispatches curated by Admin)
  app.get('/api/news', async (_req, res) => {
    try {
      const articles = await listNewsArticles(false);
      return res.json({ articles });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to load market news.';
      return res.status(500).json({ error: msg });
    }
  });

  // Admin News Desk: list all published + draft dispatches
  app.get('/api/admin/news', requireAdmin, async (_req, res) => {
    try {
      const articles = await listNewsArticles(true);
      return res.json({ articles });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to load admin news articles.';
      return res.status(500).json({ error: msg });
    }
  });

  // Admin News Desk: publish or draft a new news dispatch
  app.post('/api/admin/news', requireAdmin, async (req, res) => {
    try {
      const parsed = normalizeNewsArticleInput(req.body ?? {});
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error });
      }
      const article = await createNewsArticle(parsed.value);
      return res.status(201).json({ article });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to create news article.';
      return res.status(500).json({ error: msg });
    }
  });

  // Admin News Desk: edit an existing news article
  app.patch('/api/admin/news/:id', requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid article ID.' });
      const body = req.body ?? {};
      // Support either full editorial update or quick flag toggle (isFeatured / isPublished)
      const isQuickToggleOnly =
        body.title === undefined &&
        body.summary === undefined &&
        body.content === undefined &&
        (typeof body.isFeatured === 'boolean' || typeof body.isPublished === 'boolean');

      if (isQuickToggleOnly) {
        const updated = await updateNewsArticle(id, {
          ...(typeof body.isFeatured === 'boolean' ? { isFeatured: body.isFeatured } : {}),
          ...(typeof body.isPublished === 'boolean' ? { isPublished: body.isPublished } : {}),
        });
        if (!updated) return res.status(404).json({ error: 'News article not found.' });
        return res.json({ article: updated });
      }

      const parsed = normalizeNewsArticleInput(body);
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error });
      }
      const updated = await updateNewsArticle(id, parsed.value);
      if (!updated) return res.status(404).json({ error: 'News article not found.' });
      return res.json({ article: updated });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to update news article.';
      return res.status(500).json({ error: msg });
    }
  });

  // Admin News Desk: delete an article
  app.delete('/api/admin/news/:id', requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid article ID.' });
      const deleted = await deleteNewsArticle(id);
      if (!deleted) return res.status(404).json({ error: 'News article not found.' });
      return res.json({ deleted: true, id });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to delete news article.';
      return res.status(500).json({ error: msg });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });

  // Continuously tick enabled custom coins every 2s so 1m OHLCV candles record & liquidations settle persistently
  setInterval(() => {
    listCustomCoins(false).catch(() => {});
  }, 2000);

  // Tick Lottery Live engine every 1s so countdowns & auto-settlement run authoritatively on server
  setInterval(() => {
    tickLotteryEngine().catch(() => {});
  }, 1000);
}

startServer();
