import { getApps, initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
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

const existingApps = getApps();
const primaryApp = existingApps.find((a) => a.name === '[DEFAULT]') || initializeApp(zectradeFirebaseConfig);
const oauthApp = existingApps.find((a) => a.name === 'oauth') || initializeApp(oauthFirebaseConfig, 'oauth');

export const auth = getAuth(primaryApp);
export const db = getFirestore(primaryApp);
export const oauthAuth = getAuth(oauthApp);
export const googleAuthProvider = new GoogleAuthProvider();
export { oauthFirebaseConfig as firebaseConfig };
