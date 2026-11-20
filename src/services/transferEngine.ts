import {
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
import { SEED_MANAGED_MEMBERS } from '../data/defaults';
import type {
  AccountMode,
  ManagedMember,
  UserRole,
  WalletTransaction,
  WithdrawMethod,
} from '../types';
import { calculatePostTransferBalances, roundUsd2, validateP2PTransferInput } from '../utils/transferEngine';
import { verifyTotpCode } from '../utils/twoFactor';
import { db, isFirebaseConfigured } from './firebaseClient';
import { randomHexId, readStorageJson, writeStorageJson } from './storageHelper';

export { calculatePostTransferBalances, roundUsd2, validateP2PTransferInput };

const MEMBERS_STORAGE_KEY = 'zectrade_members_v1';
const MEMBER_ACTIVITY_PREFIX = 'zectrade_member_tx_v1_';

interface StoredMembersPayload {
  initialized: boolean;
  members: ManagedMember[];
}

function readCachedMembers(): ManagedMember[] {
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

function saveCachedMembers(members: ManagedMember[]): void {
  writeStorageJson(MEMBERS_STORAGE_KEY, { initialized: true, members });
}

function upsertCachedMember(member: ManagedMember): void {
  const members = readCachedMembers();
  const next = members.some((m) => m.uid === member.uid)
    ? members.map((m) => (m.uid === member.uid ? member : m))
    : [member, ...members];
  saveCachedMembers(next);
}

function findCachedMember(list: ManagedMember[], identifier: string): ManagedMember | undefined {
  const q = identifier.trim().toLowerCase();
  if (!q) return undefined;
  return list.find(
    (m) => m.uid.trim().toLowerCase() === q || m.email.trim().toLowerCase() === q
  );
}

function appendCachedActivity(uid: string, tx: WalletTransaction): void {
  const key = `${MEMBER_ACTIVITY_PREFIX}${uid}`;
  const existing = readStorageJson<WalletTransaction[]>(key) ?? [];
  const next = [tx, ...existing.filter((item) => item.id !== tx.id)].slice(0, 120);
  writeStorageJson(key, next);
}

function normalizeUserDoc(id: string, d: Record<string, unknown>): ManagedMember {
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

async function fetchUserDocFresh(uid: string) {
  if (!isFirebaseConfigured || !db) return null;
  const ref = doc(db, 'users', uid);
  try {
    return await getDocFromServer(ref);
  } catch {
    return await getDoc(ref);
  }
}

async function fetchQueryFresh(qRef: Parameters<typeof getDocs>[0]) {
  try {
    return await getDocsFromServer(qRef as never);
  } catch {
    return await getDocs(qRef as never);
  }
}

/**
 * Queries Firebase Firestore "users" collection directly by exact UID or case-insensitive email,
 * with zero /api backend calls.
 */
export async function findFirestoreUserByEmailOrUid(
  identifier: string
): Promise<ManagedMember | null> {
  if (!isFirebaseConfigured || !db) return null;
  const trimmed = identifier.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();

  // 1. Direct document ID lookup (exact UID == users doc id)
  try {
    const directSnap = await fetchUserDocFresh(trimmed);
    if (directSnap && directSnap.exists()) {
      const parsed = normalizeUserDoc(directSnap.id, directSnap.data());
      upsertCachedMember(parsed);
      return parsed;
    }
  } catch {
    // Continue to query fallbacks
  }

  // 2. Indexed email queries (lowercase and exact input casing)
  const emailCandidates = Array.from(new Set([lower, trimmed]));
  for (const candidate of emailCandidates) {
    try {
      const emailSnap = await fetchQueryFresh(
        query(collection(db, 'users'), where('email', '==', candidate))
      );
      if (!emailSnap.empty) {
        const firstDoc = emailSnap.docs[0];
        const parsed = normalizeUserDoc(firstDoc.id, firstDoc.data() as Record<string, unknown>);
        upsertCachedMember(parsed);
        return parsed;
      }
    } catch {
      // Continue
    }
  }

  // 3. Indexed uid field query
  try {
    const uidSnap = await fetchQueryFresh(
      query(collection(db, 'users'), where('uid', '==', trimmed))
    );
    if (!uidSnap.empty) {
      const firstDoc = uidSnap.docs[0];
      const parsed = normalizeUserDoc(firstDoc.id, firstDoc.data() as Record<string, unknown>);
      upsertCachedMember(parsed);
      return parsed;
    }
  } catch {
    // Continue
  }

  // 4. Case-insensitive scan across "users" collection (handles mixed-case emails/UIDs)
  try {
    const allSnap = await fetchQueryFresh(collection(db, 'users'));
    for (const docSnap of allSnap.docs) {
      const raw = docSnap.data() as Record<string, unknown>;
      const docIdLower = docSnap.id.trim().toLowerCase();
      const fieldUidLower = String(raw.uid || '').trim().toLowerCase();
      const fieldEmailLower = String(raw.email || '').trim().toLowerCase();
      if (docIdLower === lower || fieldUidLower === lower || fieldEmailLower === lower) {
        const parsed = normalizeUserDoc(docSnap.id, raw);
        upsertCachedMember(parsed);
        return parsed;
      }
    }
  } catch {
    // Ignore permission errors cleanly
  }

  return null;
}

export async function lookupTransferRecipientDirect(
  identifier: string
): Promise<{ uid: string; username: string; email: string } | null> {
  const trimmed = identifier.trim();
  if (!trimmed) return null;

  const fsMatch = await findFirestoreUserByEmailOrUid(trimmed);
  if (fsMatch) {
    return {
      uid: fsMatch.uid,
      username: fsMatch.username,
      email: fsMatch.email,
    };
  }

  const cachedMatch = findCachedMember(readCachedMembers(), trimmed);
  if (!cachedMatch) return null;
  return {
    uid: cachedMatch.uid,
    username: cachedMatch.username,
    email: cachedMatch.email,
  };
}

export async function executeDirectP2PTransfer(params: {
  senderUid: string;
  senderEmail?: string;
  senderUsername?: string;
  recipientIdentifier: string;
  accountMode?: AccountMode;
  amount: number;
  pin: string;
  isLocalDemoSession?: boolean;
  localSenderBalance?: number;
  expectedLocalPin?: string;
  totpCode?: string;
  expectedLocalTwoFactorEnabled?: boolean;
  expectedLocalTwoFactorSecret?: string | null;
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
  const walletMode: AccountMode = params.accountMode === 'demo' ? 'demo' : 'real';
  const walletField = walletMode === 'demo' ? 'demoBalance' : 'realBalance';
  const amount = roundUsd2(params.amount);

  if (!Number.isFinite(params.amount) || amount < 1) {
    return { ok: false, error: 'Minimum transfer amount is $1.00.' };
  }

  const cleanRecipient = params.recipientIdentifier.trim();
  if (!cleanRecipient) {
    return { ok: false, error: 'Enter recipient UID or email.' };
  }

  if (!/^\d{4}$/.test(params.pin.trim())) {
    return { ok: false, error: 'Enter your 4-digit Security PIN.' };
  }

  // 1. Resolve recipient directly from Firestore "users" collection (with static fallback)
  let recipient: ManagedMember | undefined;
  let recipientInFirestore = false;
  const fsRecipient = await findFirestoreUserByEmailOrUid(cleanRecipient);
  if (fsRecipient) {
    recipient = fsRecipient;
    recipientInFirestore = true;
  } else {
    recipient = findCachedMember(readCachedMembers(), cleanRecipient);
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
  const currentRecBal = walletMode === 'demo' ? recipient.demoBalance : recipient.realBalance;
  const sentTxId = `p2p-out-${nowMs}-${randomHexId(3)}`;
  const recTxId = `p2p-in-${nowMs}-${randomHexId(3)}`;

  if (params.isLocalDemoSession) {
    if (params.expectedLocalPin && params.pin !== params.expectedLocalPin) {
      return { ok: false, error: 'Incorrect 4-digit Security PIN.' };
    }
    if (params.expectedLocalTwoFactorEnabled && params.expectedLocalTwoFactorSecret) {
      if (!verifyTotpCode(params.expectedLocalTwoFactorSecret, params.totpCode || '')) {
        return { ok: false, error: 'Invalid 6-digit Google Authenticator code.' };
      }
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
    upsertCachedMember({
      ...recipient,
      realBalance: walletMode === 'real' ? recipientNewBalance : recipient.realBalance,
      demoBalance: walletMode === 'demo' ? recipientNewBalance : recipient.demoBalance,
    });
    const sentTx: WalletTransaction = {
      id: sentTxId,
      userId: params.senderUid,
      userEmail: params.senderEmail,
      type: `P2P TRANSFER SENT (${walletMode.toUpperCase()})`,
      amount,
      target: `${recipient.username} (${recipient.uid})`,
      status: 'SUCCESS',
      timestamp: nowStr,
      rawTime: nowMs,
    };
    appendCachedActivity(recipient.uid, {
      id: recTxId,
      userId: recipient.uid,
      userEmail: recipient.email,
      type: `P2P TRANSFER RECEIVED (${walletMode.toUpperCase()})`,
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

  // 2. Fetch authoritative sender directly from Firestore "users" to verify Security PIN & real balance
  let sender = findCachedMember(readCachedMembers(), params.senderUid);
  let senderTwoFactorEnabled = Boolean(params.expectedLocalTwoFactorEnabled);
  let senderTwoFactorSecret = params.expectedLocalTwoFactorSecret || null;
  if (isFirebaseConfigured && db) {
    try {
      const senderSnap = await fetchUserDocFresh(params.senderUid);
      if (senderSnap && senderSnap.exists()) {
        const rawSender = senderSnap.data() as Record<string, unknown>;
        sender = normalizeUserDoc(senderSnap.id, rawSender);
        upsertCachedMember(sender);
        if (typeof rawSender.twoFactorEnabled === 'boolean') {
          senderTwoFactorEnabled = rawSender.twoFactorEnabled;
        }
        if (typeof rawSender.twoFactorSecret === 'string') {
          senderTwoFactorSecret = rawSender.twoFactorSecret;
        }
      }
    } catch {
      // Offline / rule fallback
    }
  }

  const senderPin = sender?.securityPin ?? params.expectedLocalPin ?? '1234';
  if (sender?.isBlocked) {
    return { ok: false, error: 'Your account is restricted.' };
  }
  if (senderPin !== params.pin) {
    return { ok: false, error: 'Incorrect 4-digit Security PIN.' };
  }
  if (senderTwoFactorEnabled && senderTwoFactorSecret) {
    if (!verifyTotpCode(senderTwoFactorSecret, params.totpCode || '')) {
      return { ok: false, error: 'Invalid 6-digit Google Authenticator code.' };
    }
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

        if (senderData?.securityPin && String(senderData.securityPin) !== params.pin) {
          throw new Error('BUSINESS:Incorrect 4-digit Security PIN.');
        }

        if (senderData?.twoFactorEnabled && senderData?.twoFactorSecret) {
          if (!verifyTotpCode(String(senderData.twoFactorSecret), params.totpCode || '')) {
            throw new Error('BUSINESS:Invalid 6-digit Google Authenticator code.');
          }
        }

        const freshSenderBal = senderData
          ? Number(senderData[walletField] ?? params.localSenderBalance ?? 0)
          : sender
            ? walletMode === 'demo'
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

      const currentSenderBal = sender
        ? walletMode === 'demo'
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
        type: `P2P TRANSFER SENT (${walletMode.toUpperCase()})`,
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
        type: `P2P TRANSFER RECEIVED (${walletMode.toUpperCase()})`,
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
      ? walletMode === 'demo'
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
  }

  // Update local cache for both sender & recipient
  if (sender) {
    upsertCachedMember({
      ...sender,
      realBalance: walletMode === 'real' ? senderRemaining : sender.realBalance,
      demoBalance: walletMode === 'demo' ? senderRemaining : sender.demoBalance,
    });
  }
  upsertCachedMember({
    ...recipient,
    realBalance: walletMode === 'real' ? recipientNewBalance : recipient.realBalance,
    demoBalance: walletMode === 'demo' ? recipientNewBalance : recipient.demoBalance,
  });

  const sentTransaction: WalletTransaction = {
    id: sentTxId,
    userId: params.senderUid,
    userEmail: senderEmail,
    type: `P2P TRANSFER SENT (${walletMode.toUpperCase()})`,
    amount,
    target: `${recipient.username} (${recipient.uid})`,
    status: 'SUCCESS',
    timestamp: nowStr,
    rawTime: nowMs,
  };

  appendCachedActivity(params.senderUid, sentTransaction);
  appendCachedActivity(recipient.uid, {
    id: recTxId,
    userId: recipient.uid,
    userEmail: recipient.email,
    type: `P2P TRANSFER RECEIVED (${walletMode.toUpperCase()})`,
    amount,
    target: `${senderName} (${params.senderUid})`,
    status: 'SUCCESS',
    timestamp: nowStr,
    rawTime: nowMs,
  });

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
