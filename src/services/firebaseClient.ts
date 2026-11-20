import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

export const firebaseConfig = {
  apiKey: 'AIzaSyDZETBSCx35a_syK069_WUvw6wEOMYCKyc',
  authDomain: 'zectrade-357ff.firebaseapp.com',
  projectId: 'zectrade-357ff',
  storageBucket: 'zectrade-357ff.firebasestorage.app',
  messagingSenderId: '1079525755073',
  appId: '1:1079525755073:web:fbbca0e3521a5709af6c40',
  measurementId: 'G-P4EQE872T5',
};

export const zectradeFirebaseConfig = firebaseConfig;

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
  isBrowserRuntime && hasValidConfig(firebaseConfig);
export const isOAuthFirebaseConfigured = isFirebaseConfigured;

const existingApps = isBrowserRuntime ? getApps() : [];

let primaryApp: FirebaseApp | null = null;

try {
  if (isFirebaseConfigured) {
    primaryApp =
      existingApps.find((a) => a.name === '[DEFAULT]') ||
      initializeApp(firebaseConfig);
  }
} catch {
  primaryApp = null;
}

export const auth = (primaryApp ? getAuth(primaryApp) : null) as Auth;
export const db = (primaryApp ? getFirestore(primaryApp) : null) as Firestore;
export const oauthAuth = auth;
export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.setCustomParameters({ prompt: 'select_account' });
