import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from './index.ts';
import { fitnessMetrics, users, walletRequests } from './schema.ts';
import { calculatePostTransferBalances, roundUsd2 } from '../utils/transferEngine.ts';

export type DbUser = typeof users.$inferSelect;
export type DbFitnessMetric = typeof fitnessMetrics.$inferSelect;
export type DbWalletRequest = typeof walletRequests.$inferSelect;

function buildIsoDay(daysAgo: number): { dayDate: string; dayLabel: string } {
  const dt = new Date(Date.now() - daysAgo * 86400_000);
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  const weekday = dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  return {
    dayDate: `${yyyy}-${mm}-${dd}`,
    dayLabel: `${weekday} ${mm}/${dd}`,
  };
}

export async function getUserByUid(uid: string): Promise<DbUser | null> {
  try {
    const rows = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.error('Database query failed (getUserByUid):', error);
    throw new Error('Unable to load user profile.', { cause: error });
  }
}

export async function findUserByIdentifier(identifier: string): Promise<DbUser | null> {
  const trimmed = identifier.trim();
  if (!trimmed) return null;
  try {
    const byUid = await db.select().from(users).where(eq(users.uid, trimmed)).limit(1);
    if (byUid[0]) return byUid[0];
    const byEmail = await db
      .select()
      .from(users)
      .where(ilike(users.email, trimmed))
      .limit(1);
    return byEmail[0] ?? null;
  } catch (error) {
    console.error('Database query failed (findUserByIdentifier):', error);
    throw new Error('Failed to look up user.', { cause: error });
  }
}

export async function getOrCreateUser(params: {
  uid: string;
  email: string;
  username?: string;
  role?: string;
}): Promise<DbUser> {
  const normalizedEmail = params.email.toLowerCase();
  const fallbackUsername = params.username?.trim() || normalizedEmail.split('@')[0] || 'Trader';
  const adminEmails = new Set(
    [
      'admin@zectrade.io',
      'admin2@gmail.com',
      'arifundy@gmail.com',
      ...(process.env.ADMIN_EMAILS?.split(',') || []),
    ]
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
  const resolvedRole = params.role || (adminEmails.has(normalizedEmail) ? 'admin' : undefined);

  try {
    const result = await db
      .insert(users)
      .values({
        uid: params.uid,
        email: normalizedEmail,
        username: fallbackUsername,
        role: resolvedRole || 'user',
        realBalance: 2,
        demoBalance: 100000,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: normalizedEmail,
          ...(params.username ? { username: fallbackUsername } : {}),
          ...(resolvedRole ? { role: resolvedRole } : {}),
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database query failed (getOrCreateUser):', error);
    throw new Error('Unable to synchronize user profile.', { cause: error });
  }
}

export async function seedBaselineDirectoryAndMetrics(): Promise<void> {
  try {
    const seedMembers = [
      {
        uid: 'ADMIN-ZEC-0001',
        email: 'admin@zectrade.io',
        username: 'Lead Admin',
        role: 'admin',
        securityPin: '8888',
        fullName: 'Lead Platform Administrator',
        phone: '+95 9789 000 001',
        country: 'Singapore',
        bio: 'Zectrade Pulse Operations Lead',
        withdrawMethod: 'kpay',
        withdrawAccountName: 'Zectrade Treasury',
        withdrawAccountNumber: '09789123456',
        isBlocked: false,
        isWithdrawBlocked: false,
        hasDepositedBefore: true,
        hasTradedAfterDeposit: true,
        withdrawLockClearedByAdmin: true,
        realBalance: 25000,
        demoBalance: 100000,
      },
      {
        uid: 'USR-9012',
        email: 'aung.kyaw@zectrade.io',
        username: 'Aung Kyaw',
        role: 'user',
        securityPin: '1234',
        fullName: 'Aung Kyaw Moe',
        phone: '09789445566',
        country: 'Yangon, Myanmar',
        bio: 'Spot & Futures Trader',
        withdrawMethod: 'kpay',
        withdrawAccountName: 'Aung Kyaw Moe',
        withdrawAccountNumber: '09789445566',
        isBlocked: false,
        isWithdrawBlocked: false,
        hasDepositedBefore: false,
        hasTradedAfterDeposit: false,
        withdrawLockClearedByAdmin: false,
        realBalance: 2,
        demoBalance: 98500,
      },
      {
        uid: 'USR-4418',
        email: 'sumyat@zectrade.io',
        username: 'Su Myat',
        role: 'user',
        securityPin: '4321',
        fullName: 'Su Myat Noe',
        phone: '09988223344',
        country: 'Mandalay, Myanmar',
        bio: 'Gold & Crypto Trader',
        withdrawMethod: 'wavepay',
        withdrawAccountName: 'Su Myat Noe',
        withdrawAccountNumber: '09988223344',
        isBlocked: false,
        isWithdrawBlocked: false,
        hasDepositedBefore: true,
        hasTradedAfterDeposit: false,
        withdrawLockClearedByAdmin: false,
        realBalance: 1120,
        demoBalance: 100000,
      },
      {
        uid: 'USR-7731',
        email: 'marcus.c@zectrade.io',
        username: 'Marcus Chen',
        role: 'staff',
        securityPin: '7777',
        fullName: 'Marcus Chen',
        phone: '+65 8123 4567',
        country: 'Singapore',
        bio: 'Senior Desk Operator',
        withdrawMethod: 'usdt',
        withdrawAccountName: 'Marcus Chen',
        withdrawAccountNumber: 'TX982353835ks839209485732',
        isBlocked: false,
        isWithdrawBlocked: false,
        hasDepositedBefore: true,
        hasTradedAfterDeposit: true,
        withdrawLockClearedByAdmin: false,
        realBalance: 8900,
        demoBalance: 120000,
      },
    ];

    for (const member of seedMembers) {
      await db
        .insert(users)
        .values(member)
        .onConflictDoNothing({ target: users.uid });
    }

    const existingMetrics = await db.select({ id: fitnessMetrics.id }).from(fitnessMetrics).limit(1);
    if (existingMetrics.length > 0) return;

    const allUsers = await db.select().from(users).orderBy(asc(users.id));
    const disciplines = ['Running', 'HIIT', 'Cycling', 'Strength', 'Rowing'];
    const patterns = [
      [
        { intensity: 64, recovery: 86, bpm: 142, strain: 10.4, mins: 42 },
        { intensity: 88, recovery: 68, bpm: 168, strain: 16.2, mins: 50 },
        { intensity: 46, recovery: 74, bpm: 126, strain: 7.5, mins: 30 },
        { intensity: 92, recovery: 58, bpm: 174, strain: 17.8, mins: 55 },
        { intensity: 52, recovery: 79, bpm: 132, strain: 8.6, mins: 35 },
        { intensity: 78, recovery: 72, bpm: 158, strain: 13.9, mins: 48 },
        { intensity: 84, recovery: 82, bpm: 162, strain: 14.7, mins: 52 },
      ],
      [
        { intensity: 72, recovery: 78, bpm: 151, strain: 12.1, mins: 40 },
        { intensity: 60, recovery: 84, bpm: 138, strain: 9.8, mins: 36 },
        { intensity: 94, recovery: 54, bpm: 177, strain: 18.4, mins: 58 },
        { intensity: 38, recovery: 71, bpm: 118, strain: 5.9, mins: 25 },
        { intensity: 81, recovery: 76, bpm: 160, strain: 14.2, mins: 45 },
        { intensity: 67, recovery: 81, bpm: 146, strain: 11.3, mins: 38 },
        { intensity: 76, recovery: 85, bpm: 154, strain: 13.0, mins: 44 },
      ],
      [
        { intensity: 54, recovery: 91, bpm: 134, strain: 8.8, mins: 32 },
        { intensity: 79, recovery: 79, bpm: 159, strain: 13.7, mins: 46 },
        { intensity: 85, recovery: 66, bpm: 165, strain: 15.6, mins: 51 },
        { intensity: 90, recovery: 59, bpm: 171, strain: 17.0, mins: 54 },
        { intensity: 42, recovery: 76, bpm: 121, strain: 6.4, mins: 28 },
        { intensity: 74, recovery: 83, bpm: 153, strain: 12.5, mins: 41 },
        { intensity: 89, recovery: 74, bpm: 169, strain: 16.5, mins: 53 },
      ],
    ];

    const rowsToInsert: Array<typeof fitnessMetrics.$inferInsert> = [];
    allUsers.forEach((member, mIdx) => {
      const pattern = patterns[mIdx % patterns.length];
      for (let offset = 6; offset >= 0; offset--) {
        const day = buildIsoDay(offset);
        const slot = pattern[6 - offset];
        rowsToInsert.push({
          userId: member.id,
          dayDate: day.dayDate,
          dayLabel: day.dayLabel,
          discipline: disciplines[(mIdx + offset) % disciplines.length],
          intensityScore: slot.intensity,
          recoveryScore: slot.recovery,
          avgBpm: slot.bpm,
          strainScore: slot.strain,
          durationMinutes: slot.mins,
        });
      }
    });

    if (rowsToInsert.length > 0) {
      await db.insert(fitnessMetrics).values(rowsToInsert);
    }
  } catch (error) {
    console.error('Database seed failed:', error);
    throw new Error('Unable to initialize baseline metrics.', { cause: error });
  }
}

export async function listManagedMembers(search?: string): Promise<DbUser[]> {
  try {
    await seedBaselineDirectoryAndMetrics();
    const q = search?.trim();
    if (q) {
      return await db
        .select()
        .from(users)
        .where(
          or(
            ilike(users.uid, `%${q}%`),
            ilike(users.email, `%${q}%`),
            ilike(users.username, `%${q}%`),
            ilike(users.fullName, `%${q}%`),
            ilike(users.phone, `%${q}%`),
            ilike(users.withdrawAccountName, `%${q}%`),
            ilike(users.withdrawAccountNumber, `%${q}%`)
          )
        )
        .orderBy(desc(users.createdAt));
    }
    return await db.select().from(users).orderBy(asc(users.id));
  } catch (error) {
    console.error('Database query failed (listManagedMembers):', error);
    throw new Error('Failed to load member directory.', { cause: error });
  }
}

export async function updateUserProfileByUid(
  uid: string,
  updates: Partial<{
    username: string;
    avatarUrl: string | null;
    fullName: string | null;
    phone: string | null;
    country: string | null;
    bio: string | null;
    withdrawMethod: string;
    withdrawAccountName: string | null;
    withdrawAccountNumber: string | null;
    securityPin: string;
  }>
): Promise<DbUser | null> {
  try {
    if (Object.keys(updates).length === 0) {
      return getUserByUid(uid);
    }
    const result = await db
      .update(users)
      .set(updates)
      .where(eq(users.uid, uid))
      .returning();
    return result[0] ?? null;
  } catch (error) {
    console.error('Database update failed (updateUserProfileByUid):', error);
    throw new Error('Failed to update user profile.', { cause: error });
  }
}

export async function updateMemberAdminControl(
  uid: string,
  updates: Partial<{
    username: string;
    email: string;
    securityPin: string;
    avatarUrl: string | null;
    fullName: string | null;
    phone: string | null;
    country: string | null;
    bio: string | null;
    withdrawMethod: string;
    withdrawAccountName: string | null;
    withdrawAccountNumber: string | null;
    isBlocked: boolean;
    isWithdrawBlocked: boolean;
    withdrawLockClearedByAdmin: boolean;
    hasDepositedBefore: boolean;
    hasTradedAfterDeposit: boolean;
    role: string;
    realBalance: number;
    demoBalance: number;
  }>
): Promise<DbUser | null> {
  try {
    if (Object.keys(updates).length === 0) {
      return getUserByUid(uid);
    }
    const result = await db
      .update(users)
      .set(updates)
      .where(eq(users.uid, uid))
      .returning();
    return result[0] ?? null;
  } catch (error) {
    console.error('Database update failed (updateMemberAdminControl):', error);
    throw new Error('Failed to update member status.', { cause: error });
  }
}

export async function createWalletRequest(params: {
  userUid: string;
  userEmail: string;
  requestKind: 'deposit' | 'withdrawal';
  typeLabel: string;
  method: string;
  amountUsd: number;
  target: string;
}): Promise<DbWalletRequest> {
  const inserted = await db
    .insert(walletRequests)
    .values({
      userUid: params.userUid,
      userEmail: params.userEmail.toLowerCase(),
      requestKind: params.requestKind,
      typeLabel: params.typeLabel,
      method: params.method,
      amountUsd: params.amountUsd,
      target: params.target,
      status: 'PENDING',
    })
    .returning();
  return inserted[0];
}

export async function listPendingWalletRequests(
  requestKind?: 'deposit' | 'withdrawal'
): Promise<DbWalletRequest[]> {
  const whereClause = requestKind
    ? and(eq(walletRequests.status, 'PENDING'), eq(walletRequests.requestKind, requestKind))
    : eq(walletRequests.status, 'PENDING');
  return db
    .select()
    .from(walletRequests)
    .where(whereClause)
    .orderBy(desc(walletRequests.createdAt));
}

export async function approveDepositRequest(requestId: number): Promise<{
  request: DbWalletRequest;
  member: DbUser | null;
} | null> {
  const rows = await db
    .select()
    .from(walletRequests)
    .where(and(eq(walletRequests.id, requestId), eq(walletRequests.requestKind, 'deposit')))
    .limit(1);
  const existing = rows[0];
  if (!existing || existing.status !== 'PENDING') return null;

  const [updatedReq] = await db
    .update(walletRequests)
    .set({ status: 'SUCCESS', processedAt: new Date() })
    .where(eq(walletRequests.id, requestId))
    .returning();

  const member = await findUserByIdentifier(existing.userUid);
  let updatedMember: DbUser | null = null;
  if (member) {
    const [m] = await db
      .update(users)
      .set({
        realBalance: sql`ROUND(GREATEST(0, COALESCE(${users.realBalance}, 0) + ${existing.amountUsd})::numeric, 4)::double precision`,
        hasDepositedBefore: true,
      })
      .where(eq(users.uid, member.uid))
      .returning();
    updatedMember = m ?? null;
  }
  return { request: updatedReq, member: updatedMember };
}

export async function rejectDepositRequest(
  requestId: number,
  reason = 'Verification declined. Please check details or contact support.'
): Promise<DbWalletRequest | null> {
  const [updatedReq] = await db
    .update(walletRequests)
    .set({ status: 'FAILED', rejectReason: reason, processedAt: new Date() })
    .where(and(eq(walletRequests.id, requestId), eq(walletRequests.requestKind, 'deposit')))
    .returning();
  return updatedReq ?? null;
}

export async function approveWithdrawalRequest(requestId: number): Promise<DbWalletRequest | null> {
  const [updatedReq] = await db
    .update(walletRequests)
    .set({ status: 'SUCCESS', processedAt: new Date() })
    .where(and(eq(walletRequests.id, requestId), eq(walletRequests.requestKind, 'withdrawal')))
    .returning();
  return updatedReq ?? null;
}

export async function rejectWithdrawalRequest(
  requestId: number,
  reason: string
): Promise<{
  request: DbWalletRequest;
  member: DbUser | null;
} | null> {
  const rows = await db
    .select()
    .from(walletRequests)
    .where(and(eq(walletRequests.id, requestId), eq(walletRequests.requestKind, 'withdrawal')))
    .limit(1);
  const existing = rows[0];
  if (!existing || existing.status !== 'PENDING') return null;

  const [updatedReq] = await db
    .update(walletRequests)
    .set({ status: 'FAILED', rejectReason: reason, processedAt: new Date() })
    .where(eq(walletRequests.id, requestId))
    .returning();

  const member = await findUserByIdentifier(existing.userUid);
  let updatedMember: DbUser | null = null;
  if (member) {
    const [m] = await db
      .update(users)
      .set({
        realBalance: sql`ROUND(GREATEST(0, COALESCE(${users.realBalance}, 0) + ${existing.amountUsd})::numeric, 4)::double precision`,
      })
      .where(eq(users.uid, member.uid))
      .returning();
    updatedMember = m ?? null;
  }
  return { request: updatedReq, member: updatedMember };
}

export async function adjustMemberBalanceByIdentifier(params: {
  identifier: string;
  wallet: 'real' | 'demo';
  action: 'add' | 'deduct';
  amount: number;
}): Promise<DbUser | null> {
  const member = await findUserByIdentifier(params.identifier);
  if (!member) return null;

  const currentVal = params.wallet === 'real' ? member.realBalance : member.demoBalance;
  const nextVal =
    params.action === 'add' ? currentVal + params.amount : Math.max(0, currentVal - params.amount);

  const [updated] = await db
    .update(users)
    .set(params.wallet === 'real' ? { realBalance: nextVal } : { demoBalance: nextVal })
    .where(eq(users.uid, member.uid))
    .returning();
  return updated ?? null;
}

export async function assignMemberRoleByIdentifier(
  identifier: string,
  role: string
): Promise<DbUser | null> {
  const member = await findUserByIdentifier(identifier);
  if (!member) return null;
  const [updated] = await db
    .update(users)
    .set({ role })
    .where(eq(users.uid, member.uid))
    .returning();
  return updated ?? null;
}

export interface SevenDayMetricRow {
  id: number;
  memberUid: string;
  memberName: string;
  memberEmail: string;
  dayDate: string;
  dayLabel: string;
  discipline: string;
  intensityScore: number;
  recoveryScore: number;
  avgBpm: number;
  strainScore: number;
  durationMinutes: number;
}

export async function getSevenDayFitnessHeatmap(): Promise<SevenDayMetricRow[]> {
  try {
    await seedBaselineDirectoryAndMetrics();
    const rows = await db
      .select({
        id: fitnessMetrics.id,
        memberUid: users.uid,
        memberName: users.username,
        memberEmail: users.email,
        dayDate: fitnessMetrics.dayDate,
        dayLabel: fitnessMetrics.dayLabel,
        discipline: fitnessMetrics.discipline,
        intensityScore: fitnessMetrics.intensityScore,
        recoveryScore: fitnessMetrics.recoveryScore,
        avgBpm: fitnessMetrics.avgBpm,
        strainScore: fitnessMetrics.strainScore,
        durationMinutes: fitnessMetrics.durationMinutes,
      })
      .from(fitnessMetrics)
      .innerJoin(users, eq(fitnessMetrics.userId, users.id))
      .orderBy(asc(users.id), asc(fitnessMetrics.dayDate));

    // Keep latest 7 distinct dates
    const uniqueDates = Array.from(new Set(rows.map((r) => r.dayDate))).sort();
    const last7Dates = new Set(uniqueDates.slice(-7));
    return rows.filter((r) => last7Dates.has(r.dayDate));
  } catch (error) {
    console.error('Database query failed (getSevenDayFitnessHeatmap):', error);
    throw new Error('Failed to fetch 7-day fitness heatmap.', { cause: error });
  }
}

export async function recordFitnessSessionMetric(params: {
  uid: string;
  email: string;
  username?: string;
  discipline: string;
  intensityScore: number;
  recoveryScore: number;
  avgBpm: number;
  strainScore: number;
  durationMinutes: number;
}): Promise<DbFitnessMetric> {
  try {
    const dbUser = await getOrCreateUser({
      uid: params.uid,
      email: params.email,
      username: params.username,
    });
    const today = buildIsoDay(0);
    const inserted = await db
      .insert(fitnessMetrics)
      .values({
        userId: dbUser.id,
        dayDate: today.dayDate,
        dayLabel: today.dayLabel,
        discipline: params.discipline,
        intensityScore: Math.max(0, Math.min(100, Math.round(params.intensityScore))),
        recoveryScore: Math.max(0, Math.min(100, Math.round(params.recoveryScore))),
        avgBpm: Math.max(45, Math.min(220, Math.round(params.avgBpm))),
        strainScore: Number(params.strainScore.toFixed(1)),
        durationMinutes: Math.max(1, Math.round(params.durationMinutes)),
      })
      .returning();

    return inserted[0];
  } catch (error) {
    console.error('Database insert failed (recordFitnessSessionMetric):', error);
    throw new Error('Failed to record workout session.', { cause: error });
  }
}

export interface TransferRecipientSummary {
  uid: string;
  username: string;
  email: string;
}

export async function lookupTransferRecipient(
  identifier: string
): Promise<TransferRecipientSummary | null> {
  const trimmed = identifier.trim();
  if (!trimmed) return null;
  await seedBaselineDirectoryAndMetrics();
  const matched = await findUserByIdentifier(trimmed);
  if (!matched) return null;
  return {
    uid: matched.uid,
    username: matched.username,
    email: matched.email,
  };
}

export async function updateMemberPinByUid(uid: string, pin: string): Promise<DbUser | null> {
  const [updated] = await db
    .update(users)
    .set({ securityPin: pin })
    .where(eq(users.uid, uid))
    .returning();
  return updated ?? null;
}

export async function listMemberWalletActivity(uid: string): Promise<DbWalletRequest[]> {
  return db
    .select()
    .from(walletRequests)
    .where(eq(walletRequests.userUid, uid))
    .orderBy(desc(walletRequests.createdAt))
    .limit(60);
}

export async function applyWalletBalanceDelta(params: {
  uid: string;
  email?: string;
  wallet: 'real' | 'demo';
  delta: number;
  markTradedAfterDeposit?: boolean;
}): Promise<DbUser | null> {
  if (!Number.isFinite(params.delta)) {
    throw new Error('Invalid balance delta.');
  }
  const safeDelta = Number(params.delta.toFixed(4));
  const existing = await getUserByUid(params.uid);
  if (!existing && params.email) {
    await getOrCreateUser({ uid: params.uid, email: params.email });
  }

  const updateFields: Record<string, unknown> =
    params.wallet === 'demo'
      ? {
          demoBalance: sql`ROUND(GREATEST(0, COALESCE(${users.demoBalance}, 0) + ${safeDelta})::numeric, 4)::double precision`,
        }
      : {
          realBalance: sql`ROUND(GREATEST(0, COALESCE(${users.realBalance}, 0) + ${safeDelta})::numeric, 4)::double precision`,
        };

  if (params.markTradedAfterDeposit) {
    updateFields.hasTradedAfterDeposit = true;
  }

  const [updated] = await db
    .update(users)
    .set(updateFields)
    .where(eq(users.uid, params.uid))
    .returning();

  return updated ?? null;
}

export async function executeP2PTransferInDb(params: {
  senderUid: string;
  senderEmail?: string;
  recipientIdentifier: string;
  accountMode: 'real' | 'demo';
  amount: number;
  pin: string;
  isLocalDemoSession?: boolean;
  localSenderBalance?: number;
  expectedLocalPin?: string;
}): Promise<
  | {
      ok: true;
      amount: number;
      senderRemainingBalance: number;
      recipient: TransferRecipientSummary & { newBalance: number };
    }
  | {
      ok: false;
      status: number;
      error: string;
    }
> {
  await seedBaselineDirectoryAndMetrics();

  const amount = roundUsd2(params.amount);
  if (!Number.isFinite(params.amount) || amount < 1) {
    return { ok: false, status: 400, error: 'Minimum transfer amount is $1.00.' };
  }

  const cleanRecipient = params.recipientIdentifier.trim();
  if (!cleanRecipient) {
    return { ok: false, status: 400, error: 'Enter recipient UID or email.' };
  }

  const recipientRow = await findUserByIdentifier(cleanRecipient);
  if (!recipientRow) {
    return { ok: false, status: 404, error: "Account doesn't exist." };
  }

  if (
    recipientRow.uid === params.senderUid ||
    (params.senderEmail &&
      recipientRow.email.toLowerCase() === params.senderEmail.trim().toLowerCase())
  ) {
    return { ok: false, status: 400, error: 'Cannot transfer to your own account.' };
  }

  return db.transaction(async (tx) => {
    const freshRecRows = await tx
      .select()
      .from(users)
      .where(eq(users.uid, recipientRow.uid))
      .limit(1);
    const freshRec = freshRecRows[0];
    if (!freshRec) {
      return { ok: false, status: 404, error: "Account doesn't exist." };
    }

    const walletField = params.accountMode === 'demo' ? 'demoBalance' : 'realBalance';
    const currentRecBal =
      params.accountMode === 'demo' ? freshRec.demoBalance : freshRec.realBalance;

    if (params.isLocalDemoSession) {
      if (params.expectedLocalPin && params.pin !== params.expectedLocalPin) {
        return { ok: false, status: 403, error: 'Incorrect 4-digit Security PIN.' };
      }
      const localBal = roundUsd2(params.localSenderBalance ?? 0);
      if (amount > localBal) {
        return { ok: false, status: 400, error: 'Insufficient available balance.' };
      }
      const { senderRemaining, recipientNewBalance } = calculatePostTransferBalances({
        senderBalance: localBal,
        recipientBalance: currentRecBal,
        amount,
      });

      await tx
        .update(users)
        .set({ [walletField]: recipientNewBalance })
        .where(eq(users.uid, freshRec.uid));

      await tx.insert(walletRequests).values({
        userUid: freshRec.uid,
        userEmail: freshRec.email.toLowerCase(),
        requestKind: 'transfer_in',
        typeLabel: `P2P TRANSFER RECEIVED (${params.accountMode.toUpperCase()})`,
        method: 'p2p',
        amountUsd: amount,
        target: `From ${params.senderUid}`,
        status: 'SUCCESS',
        processedAt: new Date(),
      });

      return {
        ok: true,
        amount,
        senderRemainingBalance: senderRemaining,
        recipient: {
          uid: freshRec.uid,
          username: freshRec.username,
          email: freshRec.email,
          newBalance: recipientNewBalance,
        },
      };
    }

    const senderRows = await tx
      .select()
      .from(users)
      .where(eq(users.uid, params.senderUid))
      .limit(1);
    const senderRow = senderRows[0];
    if (!senderRow) {
      return { ok: false, status: 404, error: 'Sender account not found.' };
    }
    if (senderRow.isBlocked) {
      return { ok: false, status: 403, error: 'Your account is restricted.' };
    }
    if (senderRow.securityPin !== params.pin) {
      return { ok: false, status: 403, error: 'Incorrect 4-digit Security PIN.' };
    }

    const currentSenderBal =
      params.accountMode === 'demo' ? senderRow.demoBalance : senderRow.realBalance;
    if (amount > roundUsd2(currentSenderBal)) {
      return { ok: false, status: 400, error: 'Insufficient available balance.' };
    }

    const { senderRemaining, recipientNewBalance } = calculatePostTransferBalances({
      senderBalance: currentSenderBal,
      recipientBalance: currentRecBal,
      amount,
    });

    await tx
      .update(users)
      .set({ [walletField]: senderRemaining })
      .where(eq(users.uid, senderRow.uid));

    await tx
      .update(users)
      .set({ [walletField]: recipientNewBalance })
      .where(eq(users.uid, freshRec.uid));

    const now = new Date();
    await tx.insert(walletRequests).values([
      {
        userUid: senderRow.uid,
        userEmail: senderRow.email.toLowerCase(),
        requestKind: 'transfer_out',
        typeLabel: `P2P TRANSFER SENT (${params.accountMode.toUpperCase()})`,
        method: 'p2p',
        amountUsd: amount,
        target: `${freshRec.username} (${freshRec.uid})`,
        status: 'SUCCESS',
        processedAt: now,
      },
      {
        userUid: freshRec.uid,
        userEmail: freshRec.email.toLowerCase(),
        requestKind: 'transfer_in',
        typeLabel: `P2P TRANSFER RECEIVED (${params.accountMode.toUpperCase()})`,
        method: 'p2p',
        amountUsd: amount,
        target: `${senderRow.username} (${senderRow.uid})`,
        status: 'SUCCESS',
        processedAt: now,
      },
    ]);

    return {
      ok: true,
      amount,
      senderRemainingBalance: senderRemaining,
      recipient: {
        uid: freshRec.uid,
        username: freshRec.username,
        email: freshRec.email,
        newBalance: recipientNewBalance,
      },
    };
  });
}

