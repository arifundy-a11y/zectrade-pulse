import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  DEFAULT_DEPOSIT_ACCOUNTS,
  DEFAULT_DESCRIPTION,
  DEFAULT_FAQ,
  SEED_MANAGED_MEMBERS,
} from '../data/defaults';
import type {
  AccountMode,
  DepositAccounts,
  FaqEntry,
  ManagedMember,
  PlatformStats,
  StaffWalletRequest,
  UserRole,
  WalletTransaction,
  WithdrawMethod,
} from '../types';
import { deduplicateFirestoreAgainstSql } from '../utils/depositHistory';
import { FIRST_REGISTER_REAL_BONUS_USD } from '../utils/tradingEngine';
import { calculatePostTransferBalances, roundUsd2 } from '../utils/transferEngine';
import { db, isFirebaseConfigured } from './firebaseClient';
import { randomHexId, readStorageJson, writeStorageJson } from './storageHelper';

const MEMBERS_STORAGE_KEY = 'zectrade_members_v1';
const REQUESTS_STORAGE_KEY = 'zectrade_wallet_requests_v1';
const BRAND_LOGO_STORAGE_KEY = 'zectrade_brand_logo_v1';
const PLATFORM_SETTINGS_KEY = 'zectrade_platform_settings_v1';
const MEMBER_ACTIVITY_PREFIX = 'zectrade_member_tx_v1_';

interface StoredMembersPayload {
  initialized: boolean;
  members: ManagedMember[];
}

export interface StoredWalletRequest {
  id: string;
  userUid: string;
  userEmail: string;
  requestKind: 'deposit' | 'withdrawal';
  typeLabel: string;
  method: string;
  amountUsd: number;
  target: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  rejectReason?: string | null;
  createdAtMs: number;
  processedAtMs?: number | null;
  firestorePath?: string;
}

export interface PublicPlatformSettings {
  csrTelegramLink: string;
  platformStats: PlatformStats;
  platformDescription: string;
  faqEntries: FaqEntry[];
  depositRateMMK: number;
  withdrawRateMMK: number;
  depositAccounts: DepositAccounts;
  brandLogoUrl: string | null;
}

function readStoredMembers(): ManagedMember[] {
  const saved = readStorageJson<StoredMembersPayload | ManagedMember[]>(MEMBERS_STORAGE_KEY);
  if (Array.isArray(saved)) {
    writeStorageJson(MEMBERS_STORAGE_KEY, { initialized: true, members: saved });
    return saved;
  }
  if (saved && saved.initialized && Array.isArray(saved.members)) {
    return saved.members;
  }
  writeStorageJson(MEMBERS_STORAGE_KEY, {
    initialized: true,
    members: SEED_MANAGED_MEMBERS,
  });
  return [...SEED_MANAGED_MEMBERS];
}

function saveStoredMembers(members: ManagedMember[]): void {
  writeStorageJson(MEMBERS_STORAGE_KEY, { initialized: true, members });
}

function readStoredRequests(): StoredWalletRequest[] {
  return readStorageJson<StoredWalletRequest[]>(REQUESTS_STORAGE_KEY) ?? [];
}

function saveStoredRequests(list: StoredWalletRequest[]): void {
  writeStorageJson(REQUESTS_STORAGE_KEY, list.slice(0, 300));
}

function appendMemberActivity(uid: string, tx: WalletTransaction): void {
  const key = `${MEMBER_ACTIVITY_PREFIX}${uid}`;
  const existing = readStorageJson<WalletTransaction[]>(key) ?? [];
  const next = [tx, ...existing.filter((item) => item.id !== tx.id)].slice(0, 120);
  writeStorageJson(key, next);
}

export function getMemberActivitySync(uid: string): WalletTransaction[] {
  return readStorageJson<WalletTransaction[]>(`${MEMBER_ACTIVITY_PREFIX}${uid}`) ?? [];
}

function normalizeMemberDoc(id: string, d: Record<string, unknown>): ManagedMember {
  const parsedReal = Number(d.realBalance);
  const parsedDemo = Number(d.demoBalance);
  return {
    uid: String(id || d.uid || ''),
    username: String(d.username || 'Trader'),
    email: String(d.email || ''),
    role: (d.role as UserRole) || 'user',
    isBlocked: Boolean(d.isBlocked),
    isWithdrawBlocked: Boolean(d.isWithdrawBlocked),
    hasDepositedBefore: Boolean(d.hasDepositedBefore),
    hasTradedAfterDeposit: Boolean(d.hasTradedAfterDeposit),
    withdrawLockClearedByAdmin: Boolean(d.withdrawLockClearedByAdmin),
    realBalance: Number.isFinite(parsedReal) ? parsedReal : 0,
    demoBalance: Number.isFinite(parsedDemo) ? parsedDemo : 100000,
    securityPin: d.securityPin ? String(d.securityPin) : '1234',
    invitedBy: d.invitedBy ? String(d.invitedBy) : null,
    avatarUrl: d.avatarUrl ? String(d.avatarUrl) : null,
    fullName: d.fullName ? String(d.fullName) : null,
    phone: d.phone ? String(d.phone) : null,
    country: d.country ? String(d.country) : null,
    bio: d.bio ? String(d.bio) : null,
    withdrawMethod: (d.withdrawMethod as WithdrawMethod | undefined) || 'kpay',
    withdrawAccountName: d.withdrawAccountName ? String(d.withdrawAccountName) : null,
    withdrawAccountNumber: d.withdrawAccountNumber ? String(d.withdrawAccountNumber) : null,
  };
}

function upsertMemberInLocalCache(member: ManagedMember): void {
  const members = readStoredMembers();
  const next = members.some((m) => m.uid === member.uid)
    ? members.map((m) => (m.uid === member.uid ? member : m))
    : [member, ...members];
  saveStoredMembers(next);
}

function findMemberInList(list: ManagedMember[], identifier: string): ManagedMember | undefined {
  const q = identifier.trim().toLowerCase();
  if (!q) return undefined;
  return list.find(
    (m) => m.uid.trim().toLowerCase() === q || m.email.trim().toLowerCase() === q
  );
}

async function getUserDocFromFirestore(uid: string) {
  if (!isFirebaseConfigured || !db) return null;
  const ref = doc(db, 'users', uid);
  try {
    return await getDocFromServer(ref);
  } catch {
    return await getDoc(ref);
  }
}

async function getQueryFromFirestore<T>(qRef: Parameters<typeof getDocs>[0]) {
  try {
    return await getDocsFromServer(qRef as never);
  } catch {
    return await getDocs(qRef as never);
  }
}

async function findMemberDocInFirestore(identifier: string): Promise<ManagedMember | null> {
  if (!isFirebaseConfigured || !db) return null;
  const trimmed = identifier.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();

  // 1. Direct document ID lookup (UID == docSnap.id)
  try {
    const directSnap = await getUserDocFromFirestore(trimmed);
    if (directSnap && directSnap.exists()) {
      const parsed = normalizeMemberDoc(directSnap.id, directSnap.data());
      upsertMemberInLocalCache(parsed);
      return parsed;
    }
  } catch {
    // Continue to query strategies
  }

  // 2. Indexed email queries (lowercase and exact input casing)
  const emailCandidates = Array.from(new Set([lower, trimmed]));
  for (const candidate of emailCandidates) {
    try {
      const snap = await getQueryFromFirestore(
        query(collection(db, 'users'), where('email', '==', candidate))
      );
      if (!snap.empty) {
        const firstDoc = snap.docs[0];
        const parsed = normalizeMemberDoc(firstDoc.id, firstDoc.data() as Record<string, unknown>);
        upsertMemberInLocalCache(parsed);
        return parsed;
      }
    } catch {
      // Continue
    }
  }

  // 3. Indexed uid field query
  try {
    const uidSnap = await getQueryFromFirestore(
      query(collection(db, 'users'), where('uid', '==', trimmed))
    );
    if (!uidSnap.empty) {
      const firstDoc = uidSnap.docs[0];
      const parsed = normalizeMemberDoc(firstDoc.id, firstDoc.data() as Record<string, unknown>);
      upsertMemberInLocalCache(parsed);
      return parsed;
    }
  } catch {
    // Continue
  }

  // 4. Case-insensitive scan across users collection (handles mixed-case stored emails/UIDs)
  try {
    const allSnap = await getQueryFromFirestore(collection(db, 'users'));
    for (const docSnap of allSnap.docs) {
      const raw = docSnap.data() as Record<string, unknown>;
      const docIdLower = docSnap.id.trim().toLowerCase();
      const fieldUidLower = String(raw.uid || '').trim().toLowerCase();
      const fieldEmailLower = String(raw.email || '').trim().toLowerCase();
      if (docIdLower === lower || fieldUidLower === lower || fieldEmailLower === lower) {
        const parsed = normalizeMemberDoc(docSnap.id, raw);
        upsertMemberInLocalCache(parsed);
        return parsed;
      }
    }
  } catch {
    // Rules may restrict full collection scan cleanly
  }

  return null;
}

async function mirrorMemberToFirestore(member: ManagedMember): Promise<void> {
  if (!isFirebaseConfigured || !db) return;
  try {
    await setDoc(doc(db, 'users', member.uid), member, { merge: true });
  } catch {
    // Graceful fallback if offline or Firestore rules disallow cross-user writes
  }
}

export async function authenticateStaticAdmin(
  email: string,
  password: string
): Promise<{ ok: true; token: string; user: ManagedMember } | { ok: false; error: string }> {
  const cleanEmail = email.trim().toLowerCase();
  if (cleanEmail !== 'admin@zectrade.io' || password !== 'Admin@2026') {
    return { ok: false, error: 'Invalid email or password.' };
  }

  const members = readStoredMembers();
  let adminMember =
    members.find((m) => m.uid === 'ADMIN-ZEC-0001' || m.email.toLowerCase() === 'admin@zectrade.io') ??
    SEED_MANAGED_MEMBERS[0];

  if (!members.some((m) => m.uid === adminMember.uid)) {
    saveStoredMembers([adminMember, ...members]);
  }

  if (isFirebaseConfigured && db) {
    try {
      const snap = await getUserDocFromFirestore(adminMember.uid);
      if (snap && snap.exists()) {
        adminMember = normalizeMemberDoc(snap.id, snap.data());
        upsertMemberInLocalCache(adminMember);
      } else {
        await mirrorMemberToFirestore(adminMember);
      }
    } catch {
      // Keep local admin record cleanly
    }
  }

  return {
    ok: true,
    token: 'static-admin-session',
    user: adminMember,
  };
}

export async function syncMemberOnAuthStatic(params: {
  uid: string;
  email: string;
  username?: string;
}): Promise<ManagedMember> {
  const cleanEmail = params.email.trim().toLowerCase();
  const adminEmails = new Set(['admin@zectrade.io', 'admin2@gmail.com', 'arifundy@gmail.com']);
  const defaultRole: UserRole = adminEmails.has(cleanEmail) ? 'admin' : 'user';

  let members = readStoredMembers();
  let member = members.find((m) => m.uid === params.uid);

  if (isFirebaseConfigured && db) {
    try {
      const snap = await getUserDocFromFirestore(params.uid);
      if (snap && snap.exists()) {
        member = normalizeMemberDoc(snap.id, snap.data());
      }
    } catch {
      // Fallback to local
    }
  }

  if (!member) {
    member = {
      uid: params.uid,
      email: cleanEmail,
      username: params.username?.trim() || cleanEmail.split('@')[0] || 'Trader',
      role: defaultRole,
      isBlocked: false,
      isWithdrawBlocked: false,
      hasDepositedBefore: false,
      hasTradedAfterDeposit: false,
      withdrawLockClearedByAdmin: false,
      realBalance: FIRST_REGISTER_REAL_BONUS_USD,
      demoBalance: 100000,
      securityPin: '1234',
      invitedBy: null,
      withdrawMethod: 'kpay',
    };
    upsertMemberInLocalCache(member);
    await mirrorMemberToFirestore(member);
  } else {
    const updated: ManagedMember = {
      ...member,
      uid: params.uid,
      email: cleanEmail || member.email,
      role: member.role === 'admin' || defaultRole === 'admin' ? 'admin' : member.role,
    };
    upsertMemberInLocalCache(updated);
    member = updated;
  }

  return member;
}

export async function listMembersStatic(search = ''): Promise<ManagedMember[]> {
  const map = new Map<string, ManagedMember>(
    readStoredMembers().map((m) => [m.uid, m])
  );

  if (isFirebaseConfigured && db) {
    try {
      const snap = await getDocs(collection(db, 'users'));
      snap.forEach((docSnap) => {
        const parsed = normalizeMemberDoc(docSnap.id, docSnap.data());
        map.set(parsed.uid, parsed);
      });
      saveStoredMembers(Array.from(map.values()));
    } catch {
      // Keep local + seed member directory cleanly if rules restrict listing users
    }
  }

  const all = Array.from(map.values());
  const q = search.trim().toLowerCase();
  if (!q) return all;
  return all.filter(
    (m) =>
      m.uid.toLowerCase().includes(q) ||
      m.email.toLowerCase().includes(q) ||
      m.username.toLowerCase().includes(q) ||
      (m.fullName?.toLowerCase().includes(q) ?? false) ||
      (m.phone?.toLowerCase().includes(q) ?? false) ||
      (m.withdrawAccountName?.toLowerCase().includes(q) ?? false) ||
      (m.withdrawAccountNumber?.toLowerCase().includes(q) ?? false)
  );
}

export async function getMemberWalletSyncStatic(uid: string): Promise<{
  member: ManagedMember | null;
  activity: WalletTransaction[];
}> {
  let member = readStoredMembers().find((m) => m.uid === uid) ?? null;
  let firestoreTx: WalletTransaction[] = [];

  if (isFirebaseConfigured && db) {
    try {
      const snap = await getUserDocFromFirestore(uid);
      if (snap && snap.exists()) {
        member = normalizeMemberDoc(snap.id, snap.data());
        upsertMemberInLocalCache(member);
      }
    } catch {
      // Fallback to local
    }

    try {
      const txSnap = await getQueryFromFirestore(collection(db, 'users', uid, 'transactions'));
      firestoreTx = txSnap.docs.map((txDoc) => {
        const raw = txDoc.data() as Record<string, unknown>;
        const createdAtField = raw.createdAt as { toDate?: () => Date } | undefined;
        const createdAtMs =
          typeof raw.createdAtMs === 'number' && Number.isFinite(raw.createdAtMs)
            ? raw.createdAtMs
            : createdAtField?.toDate
              ? createdAtField.toDate().getTime()
              : Date.now();
        return {
          id: String(raw.id || txDoc.id),
          userId: raw.userId ? String(raw.userId) : uid,
          userEmail: raw.userEmail ? String(raw.userEmail) : member?.email,
          type: String(raw.type || 'TX'),
          amount: Number(raw.amount || 0),
          target: String(raw.target || 'System Wallet'),
          isAdjustment: Boolean(raw.isAdjustment),
          status: (raw.status as WalletTransaction['status']) || 'PENDING',
          rejectReason: raw.rejectReason ? String(raw.rejectReason) : null,
          rawTime: createdAtMs,
          timestamp: new Date(createdAtMs).toLocaleString(),
        };
      });
    } catch {
      // Fallback to local activity cleanly
    }
  }

  const localActivity = getMemberActivitySync(uid);
  const mergedActivity = deduplicateFirestoreAgainstSql(firestoreTx, localActivity);
  return {
    member,
    activity: mergedActivity,
  };
}

export async function applyWalletDeltaStatic(params: {
  uid: string;
  email?: string;
  wallet: AccountMode;
  delta: number;
  markTradedAfterDeposit?: boolean;
}): Promise<ManagedMember | null> {
  if (!Number.isFinite(params.delta)) return null;
  const members = readStoredMembers();
  let target = members.find((m) => m.uid === params.uid);
  if (isFirebaseConfigured && db) {
    try {
      const snap = await getUserDocFromFirestore(params.uid);
      if (snap && snap.exists()) {
        target = normalizeMemberDoc(snap.id, snap.data());
        upsertMemberInLocalCache(target);
      }
    } catch {
      // Fall back to local target
    }
  }
  if (!target && params.email) {
    target = await syncMemberOnAuthStatic({ uid: params.uid, email: params.email });
  }
  if (!target) return null;

  const nextReal =
    params.wallet === 'real'
      ? Math.max(0, Number((target.realBalance + params.delta).toFixed(4)))
      : target.realBalance;
  const nextDemo =
    params.wallet === 'demo'
      ? Math.max(0, Number((target.demoBalance + params.delta).toFixed(4)))
      : target.demoBalance;

  const updated: ManagedMember = {
    ...target,
    realBalance: nextReal,
    demoBalance: nextDemo,
    hasTradedAfterDeposit: params.markTradedAfterDeposit
      ? true
      : target.hasTradedAfterDeposit,
  };

  upsertMemberInLocalCache(updated);

  if (isFirebaseConfigured && db) {
    try {
      await updateDoc(doc(db, 'users', updated.uid), {
        realBalance: updated.realBalance,
        demoBalance: updated.demoBalance,
        ...(params.markTradedAfterDeposit ? { hasTradedAfterDeposit: true } : {}),
      });
    } catch {
      // Graceful fallback
    }
  }
  return updated;
}

export async function updateMemberFieldsStatic(
  uid: string,
  updates: Partial<ManagedMember>
): Promise<ManagedMember | null> {
  const members = readStoredMembers();
  const idx = members.findIndex((m) => m.uid === uid);
  if (idx < 0) return null;
  const updated: ManagedMember = { ...members[idx], ...updates };
  members[idx] = updated;
  saveStoredMembers(members);

  if (isFirebaseConfigured && db) {
    try {
      await updateDoc(doc(db, 'users', uid), updates as Record<string, unknown>);
    } catch {
      // Graceful fallback
    }
  }
  return updated;
}

export async function adjustMemberBalanceStatic(params: {
  identifier: string;
  wallet: AccountMode;
  action: 'add' | 'deduct';
  amount: number;
  reason?: string;
}): Promise<ManagedMember | null> {
  if (!Number.isFinite(params.amount) || params.amount <= 0) return null;
  await listMembersStatic();
  const members = readStoredMembers();
  const target = findMemberInList(members, params.identifier);
  if (!target) return null;

  const currentVal = params.wallet === 'real' ? target.realBalance : target.demoBalance;
  const nextVal =
    params.action === 'add'
      ? roundUsd2(currentVal + params.amount)
      : Math.max(0, roundUsd2(currentVal - params.amount));

  const updated: ManagedMember = {
    ...target,
    realBalance: params.wallet === 'real' ? nextVal : target.realBalance,
    demoBalance: params.wallet === 'demo' ? nextVal : target.demoBalance,
  };
  saveStoredMembers(members.map((m) => (m.uid === updated.uid ? updated : m)));

  const nowMs = Date.now();
  appendMemberActivity(updated.uid, {
    id: `adj-${nowMs}-${randomHexId(2)}`,
    userId: updated.uid,
    userEmail: updated.email,
    type: params.action === 'add' ? 'SYSTEM CREDIT' : 'SYSTEM ADJUSTMENT',
    amount: params.amount,
    target: params.wallet === 'real' ? 'Real Account' : 'Demo Account',
    isAdjustment: true,
    status: 'SUCCESS',
    timestamp: new Date(nowMs).toLocaleString(),
    rawTime: nowMs,
  });

  if (isFirebaseConfigured && db) {
    try {
      await updateDoc(
        doc(db, 'users', updated.uid),
        params.wallet === 'real' ? { realBalance: nextVal } : { demoBalance: nextVal }
      );
      await addDoc(collection(db, 'users', updated.uid, 'transactions'), {
        userId: updated.uid,
        type: params.action === 'add' ? 'SYSTEM CREDIT' : 'SYSTEM ADJUSTMENT',
        amount: params.amount,
        target: params.wallet === 'real' ? 'Real Account' : 'Demo Account',
        isAdjustment: true,
        adminReason: params.reason || 'Admin Balance Adjustment',
        status: 'SUCCESS',
        createdAt: serverTimestamp(),
      });
    } catch {
      // Graceful fallback
    }
  }

  return updated;
}

export async function assignMemberRoleStatic(
  identifier: string,
  role: UserRole
): Promise<ManagedMember | null> {
  await listMembersStatic();
  const members = readStoredMembers();
  const target = findMemberInList(members, identifier);
  if (!target) return null;
  const updated: ManagedMember = { ...target, role };
  saveStoredMembers(members.map((m) => (m.uid === updated.uid ? updated : m)));

  if (isFirebaseConfigured && db) {
    try {
      await updateDoc(doc(db, 'users', updated.uid), { role });
    } catch {
      // Graceful fallback
    }
  }
  return updated;
}

export async function createWalletRequestStatic(params: {
  userUid: string;
  userEmail: string;
  requestKind: 'deposit' | 'withdrawal';
  typeLabel: string;
  method: string;
  amountUsd: number;
  target: string;
}): Promise<StoredWalletRequest> {
  const nowMs = Date.now();
  const req: StoredWalletRequest = {
    id: `WR-${nowMs}-${randomHexId(3)}`,
    userUid: params.userUid,
    userEmail: params.userEmail.toLowerCase(),
    requestKind: params.requestKind,
    typeLabel: params.typeLabel,
    method: params.method,
    amountUsd: roundUsd2(params.amountUsd),
    target: params.target,
    status: 'PENDING',
    rejectReason: null,
    createdAtMs: nowMs,
    processedAtMs: null,
  };

  const list = [req, ...readStoredRequests()];
  saveStoredRequests(list);

  if (isFirebaseConfigured && db) {
    try {
      await setDoc(doc(db, 'walletRequests', req.id), req);
    } catch {
      // Graceful fallback
    }
  }

  return req;
}

export async function listStaffRequestsStatic(role: UserRole): Promise<{
  deposits: StaffWalletRequest[];
  withdrawals: StaffWalletRequest[];
}> {
  const canSeeDeposits = role === 'admin' || role === 'staff' || role === 'caiwu';
  const canSeeWithdrawals = role === 'admin' || role === 'staff' || role === 'chukuan';
  const deposits: StaffWalletRequest[] = [];
  const withdrawals: StaffWalletRequest[] = [];
  const seenKeys = new Set<string>();

  const requestMap = new Map<string, StoredWalletRequest>(
    readStoredRequests().map((r) => [r.id, r])
  );

  if (isFirebaseConfigured && db) {
    try {
      const reqSnap = await getDocs(
        query(collection(db, 'walletRequests'), where('status', '==', 'PENDING'))
      );
      reqSnap.forEach((d) => {
        const raw = d.data() as StoredWalletRequest;
        if (raw?.id) {
          requestMap.set(raw.id, raw);
        }
      });
    } catch {
      // Ignore cross-user collection rule limits
    }
  }

  for (const r of requestMap.values()) {
    if (r.status !== 'PENDING') continue;
    const item: StaffWalletRequest = {
      id: r.id,
      source: r.firestorePath ? 'firestore' : 'local',
      firestorePath: r.firestorePath,
      userId: r.userUid,
      userEmail: r.userEmail,
      kind: r.requestKind,
      type: r.typeLabel,
      method: r.method,
      amount: r.amountUsd,
      target: r.target,
      status: r.status,
      rejectReason: r.rejectReason ?? null,
      createdAtLabel: new Date(r.createdAtMs).toLocaleString(),
    };
    const dedup = `${r.requestKind === 'deposit' ? 'dep' : 'wd'}|${r.userUid}|${r.amountUsd}|${r.target}`;
    if (canSeeDeposits && r.requestKind === 'deposit' && !seenKeys.has(dedup)) {
      seenKeys.add(dedup);
      deposits.push(item);
    } else if (canSeeWithdrawals && r.requestKind === 'withdrawal' && !seenKeys.has(dedup)) {
      seenKeys.add(dedup);
      withdrawals.push(item);
    }
  }

  if (isFirebaseConfigured && db) {
    try {
      const usersSnap = await getDocs(collection(db, 'users'));
      for (const userDoc of usersSnap.docs) {
        try {
          const txSnap = await getDocs(
            query(
              collection(db, 'users', userDoc.id, 'transactions'),
              where('status', '==', 'PENDING')
            )
          );
          txSnap.forEach((txDoc) => {
            const raw = txDoc.data();
            const txType = String(raw.type || '');
            const amount = Number(raw.amount || 0);
            const target = String(raw.target || '');
            const dt = raw.createdAt?.toDate ? raw.createdAt.toDate() : new Date();
            const uid = String(raw.userId || userDoc.id);
            const email = String(raw.userEmail || userDoc.data().email || 'Unknown');

            if (canSeeDeposits && txType.includes('DEPOSIT')) {
              const dedup = `dep|${uid}|${amount}|${target}`;
              if (!seenKeys.has(dedup)) {
                seenKeys.add(dedup);
                deposits.push({
                  id: `fs-${txDoc.id}`,
                  source: 'firestore',
                  firestorePath: txDoc.ref.path,
                  userId: uid,
                  userEmail: email,
                  kind: 'deposit',
                  type: txType,
                  method: txType,
                  amount,
                  target,
                  status: 'PENDING',
                  createdAtLabel: dt.toLocaleString(),
                });
              }
            } else if (canSeeWithdrawals && txType.includes('WITHDRAWAL')) {
              const dedup = `wd|${uid}|${amount}|${target}`;
              if (!seenKeys.has(dedup)) {
                seenKeys.add(dedup);
                withdrawals.push({
                  id: `fs-${txDoc.id}`,
                  source: 'firestore',
                  firestorePath: txDoc.ref.path,
                  userId: uid,
                  userEmail: email,
                  kind: 'withdrawal',
                  type: txType,
                  method: txType,
                  amount,
                  target,
                  status: 'PENDING',
                  createdAtLabel: dt.toLocaleString(),
                });
              }
            }
          });
        } catch {
          // Skip restricted subcollections silently
        }
      }
    } catch {
      // Ignore cross-user directory rule limits cleanly
    }
  }

  return { deposits, withdrawals };
}

export async function approveDepositRequestStatic(req: StaffWalletRequest): Promise<{
  updatedMember: ManagedMember | null;
}> {
  const nowMs = Date.now();
  const requests = readStoredRequests();
  const nextReqs = requests.map((r) =>
    r.id === req.id ? { ...r, status: 'SUCCESS' as const, processedAtMs: nowMs } : r
  );
  saveStoredRequests(nextReqs);

  const members = readStoredMembers();
  const target = findMemberInList(members, req.userId) ?? findMemberInList(members, req.userEmail);
  let updatedMember: ManagedMember | null = null;

  if (target) {
    const isFirstDeposit = !target.hasDepositedBefore;
    const nextReal = roundUsd2(target.realBalance + req.amount);
    updatedMember = {
      ...target,
      realBalance: nextReal,
      hasDepositedBefore: true,
    };
    let nextMembers = members.map((m) => (m.uid === target.uid ? updatedMember! : m));

    if (isFirstDeposit && target.invitedBy && target.invitedBy !== target.uid) {
      const inviter = findMemberInList(nextMembers, target.invitedBy);
      if (inviter) {
        const bonus = roundUsd2(req.amount * 0.02);
        const updatedInviter: ManagedMember = {
          ...inviter,
          realBalance: roundUsd2(inviter.realBalance + bonus),
        };
        nextMembers = nextMembers.map((m) => (m.uid === inviter.uid ? updatedInviter : m));
        appendMemberActivity(inviter.uid, {
          id: `ref-${nowMs}-${randomHexId(2)}`,
          userId: inviter.uid,
          userEmail: inviter.email,
          type: 'REFERRAL BONUS (2% 1ST DEPOSIT REWARD)',
          amount: bonus,
          target: 'Real Account',
          isAdjustment: true,
          status: 'SUCCESS',
          timestamp: new Date(nowMs).toLocaleString(),
          rawTime: nowMs,
        });
      }
    }
    saveStoredMembers(nextMembers);
  }

  if (isFirebaseConfigured && db) {
    try {
      await updateDoc(doc(db, 'walletRequests', req.id), {
        status: 'SUCCESS',
        processedAtMs: nowMs,
      });
    } catch {
      // Ignore if request only lived in subcollection/local
    }
    if (req.firestorePath) {
      try {
        const segments = req.firestorePath.split('/');
        await updateDoc(doc(db, segments[0], ...segments.slice(1)), { status: 'SUCCESS' });
      } catch {
        // Ignore rule limits
      }
    }
    if (updatedMember) {
      try {
        await updateDoc(doc(db, 'users', updatedMember.uid), {
          realBalance: updatedMember.realBalance,
          hasDepositedBefore: true,
        });
      } catch {
        // Ignore rule limits
      }
    }
  }

  return { updatedMember };
}

export async function rejectDepositRequestStatic(
  req: StaffWalletRequest,
  reason = 'Verification declined. Please check details or contact support.'
): Promise<void> {
  const nowMs = Date.now();
  const requests = readStoredRequests();
  saveStoredRequests(
    requests.map((r) =>
      r.id === req.id
        ? { ...r, status: 'FAILED' as const, rejectReason: reason, processedAtMs: nowMs }
        : r
    )
  );

  if (isFirebaseConfigured && db) {
    try {
      await updateDoc(doc(db, 'walletRequests', req.id), {
        status: 'FAILED',
        rejectReason: reason,
        processedAtMs: nowMs,
      });
    } catch {
      // Ignore cleanly
    }
    if (req.firestorePath) {
      try {
        const segments = req.firestorePath.split('/');
        await updateDoc(doc(db, segments[0], ...segments.slice(1)), {
          status: 'FAILED',
          rejectReason: reason,
        });
      } catch {
        // Ignore cleanly
      }
    }
  }
}

export async function approveWithdrawalRequestStatic(req: StaffWalletRequest): Promise<void> {
  const nowMs = Date.now();
  const requests = readStoredRequests();
  saveStoredRequests(
    requests.map((r) =>
      r.id === req.id ? { ...r, status: 'SUCCESS' as const, processedAtMs: nowMs } : r
    )
  );

  if (isFirebaseConfigured && db) {
    try {
      await updateDoc(doc(db, 'walletRequests', req.id), {
        status: 'SUCCESS',
        processedAtMs: nowMs,
      });
    } catch {
      // Ignore cleanly
    }
    if (req.firestorePath) {
      try {
        const segments = req.firestorePath.split('/');
        await updateDoc(doc(db, segments[0], ...segments.slice(1)), { status: 'SUCCESS' });
      } catch {
        // Ignore cleanly
      }
    }
  }
}

export async function rejectWithdrawalRequestStatic(
  req: StaffWalletRequest,
  reason: string
): Promise<{ updatedMember: ManagedMember | null }> {
  const nowMs = Date.now();
  const requests = readStoredRequests();
  saveStoredRequests(
    requests.map((r) =>
      r.id === req.id
        ? { ...r, status: 'FAILED' as const, rejectReason: reason, processedAtMs: nowMs }
        : r
    )
  );

  const members = readStoredMembers();
  const target = findMemberInList(members, req.userId) ?? findMemberInList(members, req.userEmail);
  let updatedMember: ManagedMember | null = null;
  if (target) {
    updatedMember = {
      ...target,
      realBalance: roundUsd2(target.realBalance + req.amount),
    };
    saveStoredMembers(members.map((m) => (m.uid === target.uid ? updatedMember! : m)));
  }

  if (isFirebaseConfigured && db) {
    try {
      await updateDoc(doc(db, 'walletRequests', req.id), {
        status: 'FAILED',
        rejectReason: reason,
        processedAtMs: nowMs,
      });
    } catch {
      // Ignore cleanly
    }
    if (req.firestorePath) {
      try {
        const segments = req.firestorePath.split('/');
        await updateDoc(doc(db, segments[0], ...segments.slice(1)), {
          status: 'FAILED',
          rejectReason: reason,
        });
      } catch {
        // Ignore cleanly
      }
    }
    if (updatedMember) {
      try {
        await updateDoc(doc(db, 'users', updatedMember.uid), {
          realBalance: updatedMember.realBalance,
        });
      } catch {
        // Ignore cleanly
      }
    }
  }

  return { updatedMember };
}

export async function lookupTransferRecipientStatic(
  identifier: string
): Promise<{ uid: string; username: string; email: string } | null> {
  const trimmed = identifier.trim();
  if (!trimmed) return null;

  if (isFirebaseConfigured && db) {
    const fsMatch = await findMemberDocInFirestore(trimmed);
    if (fsMatch) {
      return {
        uid: fsMatch.uid,
        username: fsMatch.username,
        email: fsMatch.email,
      };
    }
  }

  const members = await listMembersStatic();
  const match = findMemberInList(members, trimmed);
  if (!match) return null;
  return {
    uid: match.uid,
    username: match.username,
    email: match.email,
  };
}

export async function executeP2PTransferStatic(params: {
  senderUid: string;
  senderEmail?: string;
  senderUsername?: string;
  recipientIdentifier: string;
  accountMode: AccountMode;
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
      sentTransaction: WalletTransaction;
      recipient: { uid: string; username: string; email: string; newBalance: number };
    }
  | { ok: false; error: string }
> {
  const amount = roundUsd2(params.amount);
  if (!Number.isFinite(params.amount) || amount < 1) {
    return { ok: false, error: 'Minimum transfer amount is $1.00.' };
  }

  const cleanRecipient = params.recipientIdentifier.trim();
  if (!cleanRecipient) {
    return { ok: false, error: 'Enter recipient UID or email.' };
  }

  let recipient: ManagedMember | undefined;
  let recipientInFirestore = false;
  if (isFirebaseConfigured && db) {
    const fsRecipient = await findMemberDocInFirestore(cleanRecipient);
    if (fsRecipient) {
      recipient = fsRecipient;
      recipientInFirestore = true;
    }
  }

  if (!recipient) {
    await listMembersStatic();
    recipient = findMemberInList(readStoredMembers(), cleanRecipient);
  }

  if (!recipient) {
    return { ok: false, error: "Account doesn't exist." };
  }

  if (
    recipient.uid.trim().toLowerCase() === params.senderUid.trim().toLowerCase() ||
    (params.senderEmail &&
      recipient.email.trim().toLowerCase() === params.senderEmail.trim().toLowerCase())
  ) {
    return { ok: false, error: 'Cannot transfer to your own account.' };
  }

  const nowMs = Date.now();
  const nowStr = new Date(nowMs).toLocaleString();
  const walletField = params.accountMode === 'demo' ? 'demoBalance' : 'realBalance';
  const currentRecBal =
    params.accountMode === 'demo' ? recipient.demoBalance : recipient.realBalance;
  const sentTxId = `p2p-out-${nowMs}-${randomHexId(3)}`;
  const recTxId = `p2p-in-${nowMs}-${randomHexId(3)}`;

  if (params.isLocalDemoSession) {
    if (params.expectedLocalPin && params.pin !== params.expectedLocalPin) {
      return { ok: false, error: 'Incorrect 4-digit Security PIN.' };
    }
    const localBal = roundUsd2(params.localSenderBalance ?? 0);
    if (amount > localBal) {
      return { ok: false, error: 'Insufficient available balance.' };
    }
    const { senderRemaining, recipientNewBalance } = calculatePostTransferBalances({
      senderBalance: localBal,
      recipientBalance: currentRecBal,
      amount,
    });
    const updatedRecipient: ManagedMember = {
      ...recipient,
      realBalance:
        params.accountMode === 'real' ? recipientNewBalance : recipient.realBalance,
      demoBalance:
        params.accountMode === 'demo' ? recipientNewBalance : recipient.demoBalance,
    };
    upsertMemberInLocalCache(updatedRecipient);
    const sentTx: WalletTransaction = {
      id: sentTxId,
      userId: params.senderUid,
      userEmail: params.senderEmail,
      type: `P2P TRANSFER SENT (${params.accountMode.toUpperCase()})`,
      amount,
      target: `${recipient.username} (${recipient.uid})`,
      status: 'SUCCESS',
      timestamp: nowStr,
      rawTime: nowMs,
    };
    appendMemberActivity(recipient.uid, {
      id: recTxId,
      userId: recipient.uid,
      userEmail: recipient.email,
      type: `P2P TRANSFER RECEIVED (${params.accountMode.toUpperCase()})`,
      amount,
      target: `From ${params.senderUid}`,
      status: 'SUCCESS',
      timestamp: nowStr,
      rawTime: nowMs,
    });
    return {
      ok: true,
      amount,
      senderRemainingBalance: senderRemaining,
      sentTransaction: sentTx,
      recipient: {
        uid: recipient.uid,
        username: recipient.username,
        email: recipient.email,
        newBalance: recipientNewBalance,
      },
    };
  }

  // Fetch authoritative sender from Firestore when available
  let sender = findMemberInList(readStoredMembers(), params.senderUid);
  if (isFirebaseConfigured && db) {
    try {
      const senderSnap = await getUserDocFromFirestore(params.senderUid);
      if (senderSnap && senderSnap.exists()) {
        sender = normalizeMemberDoc(senderSnap.id, senderSnap.data());
        upsertMemberInLocalCache(sender);
      }
    } catch {
      // Use local sender record if offline
    }
  }

  const senderPin = sender?.securityPin ?? params.expectedLocalPin ?? '1234';
  if (sender?.isBlocked) {
    return { ok: false, error: 'Your account is restricted.' };
  }
  if (senderPin !== params.pin) {
    return { ok: false, error: 'Incorrect 4-digit Security PIN.' };
  }

  const senderName =
    params.senderUsername?.trim() ||
    sender?.username ||
    params.senderEmail?.split('@')[0] ||
    params.senderUid;
  const senderEmail = (params.senderEmail || sender?.email || '').trim().toLowerCase();

  let senderRemaining = 0;
  let recipientNewBalance = 0;

  if (isFirebaseConfigured && db && recipientInFirestore) {
    const firestoreDb = db;
    const senderRef = doc(firestoreDb, 'users', params.senderUid);
    const recipientRef = doc(firestoreDb, 'users', recipient.uid);

    try {
      const txResult = await runTransaction(firestoreDb, async (tx) => {
        const [senderSnap, recSnap] = await Promise.all([
          tx.get(senderRef),
          tx.get(recipientRef),
        ]);

        if (!recSnap.exists()) {
          throw new Error("BUSINESS:Account doesn't exist.");
        }

        const senderData = senderSnap.exists()
          ? (senderSnap.data() as Record<string, unknown>)
          : null;
        const recData = recSnap.data() as Record<string, unknown>;

        if (senderData?.isBlocked) {
          throw new Error('BUSINESS:Your account is restricted.');
        }

        const freshSenderBal = senderData
          ? Number(senderData[walletField] ?? params.localSenderBalance ?? 0)
          : sender
            ? params.accountMode === 'demo'
              ? sender.demoBalance
              : sender.realBalance
            : roundUsd2(params.localSenderBalance ?? 0);

        const freshRecBal = Number(recData[walletField] ?? 0);

        if (amount > roundUsd2(freshSenderBal)) {
          throw new Error('BUSINESS:Insufficient available balance.');
        }

        const computed = calculatePostTransferBalances({
          senderBalance: freshSenderBal,
          recipientBalance: freshRecBal,
          amount,
        });

        if (senderSnap.exists()) {
          tx.update(senderRef, { [walletField]: computed.senderRemaining });
        } else if (sender) {
          tx.set(
            senderRef,
            {
              ...sender,
              [walletField]: computed.senderRemaining,
            },
            { merge: true }
          );
        }

        tx.update(recipientRef, { [walletField]: computed.recipientNewBalance });
        return computed;
      });

      senderRemaining = txResult.senderRemaining;
      recipientNewBalance = txResult.recipientNewBalance;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.startsWith('BUSINESS:')) {
        return { ok: false, error: msg.slice('BUSINESS:'.length) };
      }

      const fbErr = err as { code?: string };
      if (fbErr?.code === 'permission-denied') {
        return {
          ok: false,
          error: 'Firestore security rules blocked this transfer. Please update rules or sign in again.',
        };
      }

      // Fallback to direct sequential updates if transaction encountered transient offline state
      const currentSenderBal = sender
        ? params.accountMode === 'demo'
          ? sender.demoBalance
          : sender.realBalance
        : roundUsd2(params.localSenderBalance ?? 0);
      if (amount > roundUsd2(currentSenderBal)) {
        return { ok: false, error: 'Insufficient available balance.' };
      }
      const computed = calculatePostTransferBalances({
        senderBalance: currentSenderBal,
        recipientBalance: currentRecBal,
        amount,
      });
      senderRemaining = computed.senderRemaining;
      recipientNewBalance = computed.recipientNewBalance;

      await Promise.all([
        updateDoc(senderRef, { [walletField]: senderRemaining }).catch(() => {}),
        updateDoc(recipientRef, { [walletField]: recipientNewBalance }).catch(() => {}),
      ]);
    }

    // Write transaction records to BOTH sender and recipient Firestore wallet history
    await Promise.all([
      setDoc(doc(firestoreDb, 'users', params.senderUid, 'transactions', sentTxId), {
        id: sentTxId,
        userId: params.senderUid,
        userEmail: senderEmail,
        type: `P2P TRANSFER SENT (${params.accountMode.toUpperCase()})`,
        amount,
        target: `${recipient.username} (${recipient.uid})`,
        counterpartyUid: recipient.uid,
        counterpartyEmail: recipient.email,
        status: 'SUCCESS',
        createdAtMs: nowMs,
        createdAt: serverTimestamp(),
      }).catch(() => {}),
      setDoc(doc(firestoreDb, 'users', recipient.uid, 'transactions', recTxId), {
        id: recTxId,
        userId: recipient.uid,
        userEmail: recipient.email,
        type: `P2P TRANSFER RECEIVED (${params.accountMode.toUpperCase()})`,
        amount,
        target: `${senderName} (${params.senderUid})`,
        counterpartyUid: params.senderUid,
        counterpartyEmail: senderEmail,
        status: 'SUCCESS',
        createdAtMs: nowMs,
        createdAt: serverTimestamp(),
      }).catch(() => {}),
    ]);
  } else {
    const currentSenderBal = sender
      ? params.accountMode === 'demo'
        ? sender.demoBalance
        : sender.realBalance
      : roundUsd2(params.localSenderBalance ?? 0);

    if (amount > roundUsd2(currentSenderBal)) {
      return { ok: false, error: 'Insufficient available balance.' };
    }

    const computed = calculatePostTransferBalances({
      senderBalance: currentSenderBal,
      recipientBalance: currentRecBal,
      amount,
    });
    senderRemaining = computed.senderRemaining;
    recipientNewBalance = computed.recipientNewBalance;

    if (isFirebaseConfigured && db) {
      await Promise.all([
        updateDoc(doc(db, 'users', params.senderUid), {
          [walletField]: senderRemaining,
        }).catch(() => {}),
        setDoc(doc(db, 'users', params.senderUid, 'transactions', sentTxId), {
          id: sentTxId,
          userId: params.senderUid,
          userEmail: senderEmail,
          type: `P2P TRANSFER SENT (${params.accountMode.toUpperCase()})`,
          amount,
          target: `${recipient.username} (${recipient.uid})`,
          status: 'SUCCESS',
          createdAtMs: nowMs,
          createdAt: serverTimestamp(),
        }).catch(() => {}),
      ]);
    }
  }

  // Update local cache for both sender and recipient
  if (sender) {
    upsertMemberInLocalCache({
      ...sender,
      realBalance: params.accountMode === 'real' ? senderRemaining : sender.realBalance,
      demoBalance: params.accountMode === 'demo' ? senderRemaining : sender.demoBalance,
    });
  }
  upsertMemberInLocalCache({
    ...recipient,
    realBalance: params.accountMode === 'real' ? recipientNewBalance : recipient.realBalance,
    demoBalance: params.accountMode === 'demo' ? recipientNewBalance : recipient.demoBalance,
  });

  const sentTransaction: WalletTransaction = {
    id: sentTxId,
    userId: params.senderUid,
    userEmail: senderEmail,
    type: `P2P TRANSFER SENT (${params.accountMode.toUpperCase()})`,
    amount,
    target: `${recipient.username} (${recipient.uid})`,
    status: 'SUCCESS',
    timestamp: nowStr,
    rawTime: nowMs,
  };
  const receivedTransaction: WalletTransaction = {
    id: recTxId,
    userId: recipient.uid,
    userEmail: recipient.email,
    type: `P2P TRANSFER RECEIVED (${params.accountMode.toUpperCase()})`,
    amount,
    target: `${senderName} (${params.senderUid})`,
    status: 'SUCCESS',
    timestamp: nowStr,
    rawTime: nowMs,
  };

  appendMemberActivity(params.senderUid, sentTransaction);
  appendMemberActivity(recipient.uid, receivedTransaction);

  return {
    ok: true,
    amount,
    senderRemainingBalance: senderRemaining,
    sentTransaction,
    recipient: {
      uid: recipient.uid,
      username: recipient.username,
      email: recipient.email,
      newBalance: recipientNewBalance,
    },
  };
}

export function getInitialPlatformSettingsSync(): PublicPlatformSettings {
  const saved = readStorageJson<Partial<PublicPlatformSettings>>(PLATFORM_SETTINGS_KEY);
  const logoRaw = readStorageJson<string>(BRAND_LOGO_STORAGE_KEY);
  let brandLogoUrl: string | null = null;
  if (typeof logoRaw === 'string' && logoRaw.trim()) {
    brandLogoUrl = logoRaw.trim();
  } else {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(BRAND_LOGO_STORAGE_KEY);
        if (raw && raw.trim() && !raw.startsWith('"')) brandLogoUrl = raw.trim();
      }
    } catch {
      // ignore
    }
  }

  return {
    csrTelegramLink: saved?.csrTelegramLink || 'https://t.me/zectrade_csr',
    platformStats: saved?.platformStats || {
      membersCount: 23909,
      totalDeposits: '$42,850,910',
      totalWithdrawals: '$15,240,600',
    },
    platformDescription: saved?.platformDescription || DEFAULT_DESCRIPTION,
    faqEntries:
      Array.isArray(saved?.faqEntries) && saved.faqEntries.length > 0
        ? saved.faqEntries
        : DEFAULT_FAQ,
    depositRateMMK: saved?.depositRateMMK || 4300,
    withdrawRateMMK: saved?.withdrawRateMMK || 4300,
    depositAccounts: saved?.depositAccounts || DEFAULT_DEPOSIT_ACCOUNTS,
    brandLogoUrl: saved?.brandLogoUrl ?? brandLogoUrl,
  };
}

export async function loadPublicPlatformSettingsStatic(): Promise<PublicPlatformSettings> {
  const current = getInitialPlatformSettingsSync();
  if (!isFirebaseConfigured || !db) return current;

  try {
    const [faqSnap, csrSnap, statsSnap, accSnap, rateSnap, brandSnap] = await Promise.all([
      getDoc(doc(db, 'settings', 'faqConfig')),
      getDoc(doc(db, 'settings', 'csrConfig')),
      getDoc(doc(db, 'settings', 'landingStats')),
      getDoc(doc(db, 'settings', 'depositAccounts')),
      getDoc(doc(db, 'settings', 'exchangeRates')),
      getDoc(doc(db, 'settings', 'brandConfig')),
    ]);

    const next: PublicPlatformSettings = { ...current };
    if (faqSnap.exists()) {
      const d = faqSnap.data();
      if (Array.isArray(d.faqList) && d.faqList.length > 0) next.faqEntries = d.faqList;
      if (d.platformDesc) next.platformDescription = d.platformDesc;
    }
    if (csrSnap.exists() && csrSnap.data().telegramLink) {
      next.csrTelegramLink = csrSnap.data().telegramLink;
    }
    if (statsSnap.exists()) {
      const d = statsSnap.data();
      next.platformStats = {
        membersCount: d.membersCount ?? next.platformStats.membersCount,
        totalDeposits: d.totalDeposits ?? next.platformStats.totalDeposits,
        totalWithdrawals: d.totalWithdrawals ?? next.platformStats.totalWithdrawals,
      };
    }
    if (accSnap.exists()) next.depositAccounts = accSnap.data() as DepositAccounts;
    if (rateSnap.exists()) {
      const d = rateSnap.data();
      if (d.depositMMK) next.depositRateMMK = Number(d.depositMMK);
      if (d.withdrawMMK) next.withdrawRateMMK = Number(d.withdrawMMK);
    }
    if (brandSnap.exists()) {
      const d = brandSnap.data();
      if (typeof d.logoUrl === 'string' && d.logoUrl.trim()) {
        next.brandLogoUrl = d.logoUrl.trim();
      }
    }
    writeStorageJson(PLATFORM_SETTINGS_KEY, next);
    return next;
  } catch {
    return current;
  }
}

export async function saveBrandLogoStatic(logoUrl: string | null): Promise<void> {
  const current = getInitialPlatformSettingsSync();
  writeStorageJson(PLATFORM_SETTINGS_KEY, { ...current, brandLogoUrl: logoUrl });
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (logoUrl) {
        window.localStorage.setItem(BRAND_LOGO_STORAGE_KEY, logoUrl);
      } else {
        window.localStorage.removeItem(BRAND_LOGO_STORAGE_KEY);
      }
    }
  } catch {
    // Ignore storage quota
  }

  if (isFirebaseConfigured && db) {
    try {
      await setDoc(doc(db, 'settings', 'brandConfig'), {
        logoUrl: logoUrl ?? null,
        updatedAtMs: Date.now(),
      });
    } catch {
      // Graceful fallback
    }
  }
}

export async function savePlatformSettingsStatic(payload: {
  csrTelegramLink: string;
  platformStats: PlatformStats;
  depositRateMMK: number;
  withdrawRateMMK: number;
  depositAccounts: DepositAccounts;
}): Promise<void> {
  const current = getInitialPlatformSettingsSync();
  writeStorageJson(PLATFORM_SETTINGS_KEY, {
    ...current,
    csrTelegramLink: payload.csrTelegramLink,
    platformStats: payload.platformStats,
    depositRateMMK: payload.depositRateMMK,
    withdrawRateMMK: payload.withdrawRateMMK,
    depositAccounts: payload.depositAccounts,
  });

  if (isFirebaseConfigured && db) {
    try {
      await Promise.all([
        setDoc(doc(db, 'settings', 'csrConfig'), { telegramLink: payload.csrTelegramLink }),
        setDoc(doc(db, 'settings', 'landingStats'), payload.platformStats),
        setDoc(doc(db, 'settings', 'exchangeRates'), {
          depositMMK: payload.depositRateMMK,
          withdrawMMK: payload.withdrawRateMMK,
        }),
        setDoc(doc(db, 'settings', 'depositAccounts'), payload.depositAccounts),
      ]);
    } catch {
      // Graceful fallback
    }
  }
}

export async function saveFaqAndDescStatic(
  platformDescription: string,
  faqEntries: FaqEntry[]
): Promise<void> {
  const current = getInitialPlatformSettingsSync();
  writeStorageJson(PLATFORM_SETTINGS_KEY, {
    ...current,
    platformDescription,
    faqEntries,
  });

  if (isFirebaseConfigured && db) {
    try {
      await setDoc(doc(db, 'settings', 'faqConfig'), {
        platformDesc: platformDescription,
        faqList: faqEntries,
      });
    } catch {
      // Graceful fallback
    }
  }
}

