import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { firebaseProjectId, verifyAnyFirebaseIdToken } from '../lib/firebase-admin.ts';
import { getUserByUid } from '../db/users.ts';

export interface AuthUserContext {
  uid: string;
  email: string;
  role: string;
  isAdminSession?: boolean;
  firebaseToken?: DecodedIdToken;
}

export interface AuthRequest extends Request {
  user?: AuthUserContext;
}

const ADMIN_SESSION_PREFIX = 'zac_';

function getSigningSecret(): string {
  return (
    process.env.ADMIN_SESSION_SECRET ||
    crypto.createHash('sha256').update(`${firebaseProjectId}:zectrade-admin-session`).digest('hex')
  );
}

export function createAdminSessionToken(uid: string, email: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      uid,
      email,
      role: 'admin',
      exp: Date.now() + 1000 * 60 * 60 * 12,
    })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', getSigningSecret()).update(payload).digest('base64url');
  return `${ADMIN_SESSION_PREFIX}${payload}.${sig}`;
}

export function verifyAdminSessionToken(token: string): AuthUserContext | null {
  if (!token.startsWith(ADMIN_SESSION_PREFIX)) return null;
  const body = token.slice(ADMIN_SESSION_PREFIX.length);
  const parts = body.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(payload)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed?.uid || !parsed?.email || parsed?.role !== 'admin') return null;
    if (typeof parsed.exp !== 'number' || parsed.exp < Date.now()) return null;
    return {
      uid: String(parsed.uid),
      email: String(parsed.email),
      role: 'admin',
      isAdminSession: true,
    };
  } catch {
    return null;
  }
}

export async function resolveAuthUserFromRequest(
  req: Request
): Promise<{ user: AuthUserContext | null; error?: string }> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { user: null };
  }

  const token = authHeader.split('Bearer ')[1]?.trim();
  if (!token) {
    return { user: null, error: 'Unauthorized: Empty token' };
  }

  const adminSession = verifyAdminSessionToken(token);
  if (adminSession) {
    return { user: adminSession };
  }

  try {
    const decodedToken = await verifyAnyFirebaseIdToken(token);
    const dbUser = await getUserByUid(decodedToken.uid).catch(() => null);
    return {
      user: {
        uid: decodedToken.uid,
        email: decodedToken.email || '',
        role: dbUser?.role || 'user',
        firebaseToken: decodedToken,
      },
    };
  } catch (error) {
    console.error('Error verifying token:', error);
    return { user: null, error: 'Unauthorized: Invalid token' };
  }
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const resolved = await resolveAuthUserFromRequest(req);
  if (!resolved.user) {
    return res.status(401).json({ error: resolved.error || 'Unauthorized: Missing token' });
  }
  req.user = resolved.user;
  return next();
};

export const requireRoles = (allowedRoles: string[]) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    await requireAuth(req, res, async () => {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      if (allowedRoles.includes(req.user.role)) {
        return next();
      }
      try {
        const dbUser = await getUserByUid(req.user.uid);
        if (dbUser && allowedRoles.includes(dbUser.role)) {
          req.user.role = dbUser.role;
          return next();
        }
      } catch {
        // fall through to 403
      }
      return res.status(403).json({ error: 'Forbidden: Insufficient staff permissions' });
    });
  };
};

export const requireAdmin = requireRoles(['admin']);

