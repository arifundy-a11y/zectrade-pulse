import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';

export const firebaseProjectId = 'zectrade-357ff';

const apps = getApps();
const defaultApp =
  apps.find((a) => a.name === '[DEFAULT]') ||
  initializeApp({
    projectId: firebaseProjectId,
  });

export const adminAuth = getAuth(defaultApp);
export const zectradeAdminAuth = adminAuth;

export async function verifyAnyFirebaseIdToken(token: string): Promise<DecodedIdToken> {
  return await adminAuth.verifyIdToken(token);
}
