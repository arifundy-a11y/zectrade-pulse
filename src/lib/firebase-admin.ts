import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const apps = getApps();
const defaultApp =
  apps.find((a) => a.name === '[DEFAULT]') ||
  initializeApp({
    projectId: firebaseConfig.projectId,
  });

const zectradeApp =
  apps.find((a) => a.name === 'zectrade') ||
  initializeApp(
    {
      projectId: 'zectrade-357ff',
    },
    'zectrade'
  );

export const adminAuth = getAuth(defaultApp);
export const zectradeAdminAuth = getAuth(zectradeApp);
export const firebaseProjectId = firebaseConfig.projectId;

export async function verifyAnyFirebaseIdToken(token: string): Promise<DecodedIdToken> {
  try {
    return await zectradeAdminAuth.verifyIdToken(token);
  } catch {
    return await adminAuth.verifyIdToken(token);
  }
}
