import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import oauthFirebaseConfig from '../../firebase-applet-config.json';

// Primary Zectrade Firebase project hosting existing member/admin accounts and Firestore collections
export const zectradeFirebaseConfig = {
  apiKey: 'AIzaSyDZETBSCx35a_syK069_WUvw6wEOMYCKyc',
  authDomain: 'zectrade-357ff.firebaseapp.com',
  projectId: 'zectrade-357ff',
  storageBucket: 'zectrade-357ff.firebasestorage.app',
  messagingSenderId: '1079525755073',
  appId: '1:1079525755073:web:fbbca0e3521a5709af6c40',
  measurementId: 'G-P4EQE872T5',
};

function hasValidConfig(cfg: Record<string, unknown> | null | undefined): boolean {
  if (!cfg) return false;
  return (
    typeof cfg.apiKey === 'string' &&
    cfg.apiKey.trim().length > 0 &&
    typeof cfg.projectId === 'string' &&
    cfg.projectId.trim().length > 0 &&
    typeof cfg.appId === 'string' &&
    cfg.appId.trim().length > 0
  );
}

const isBrowserRuntime = typeof window !== 'undefined';

export const isFirebaseConfigured =
  isBrowserRuntime && hasValidConfig(zectradeFirebaseConfig);
export const isOAuthFirebaseConfigured =
  isBrowserRuntime && hasValidConfig(oauthFirebaseConfig as unknown as Record<string, unknown>);

const existingApps = isBrowserRuntime ? getApps() : [];

let primaryApp: FirebaseApp | null = null;
let oauthApp: FirebaseApp | null = null;

try {
  if (isFirebaseConfigured) {
    primaryApp =
      existingApps.find((a) => a.name === '[DEFAULT]') ||
      initializeApp(zectradeFirebaseConfig);
  }
} catch {
  primaryApp = null;
}

try {
  if (isOAuthFirebaseConfigured) {
    oauthApp =
      existingApps.find((a) => a.name === 'oauth') ||
      initializeApp(oauthFirebaseConfig, 'oauth');
  }
} catch {
  oauthApp = null;
}

export const auth = (primaryApp ? getAuth(primaryApp) : null) as Auth;
export const db = (primaryApp ? getFirestore(primaryApp) : null) as Firestore;
export const oauthAuth = (oauthApp ? getAuth(oauthApp) : auth) as Auth;
export const googleAuthProvider = new GoogleAuthProvider();
export { oauthFirebaseConfig as firebaseConfig };
