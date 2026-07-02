import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { FIREBASE_CONFIG } from '@shared/firebaseConfig';

export function getFirebaseApp(): FirebaseApp {
  return getApps().length ? getApps()[0]! : initializeApp(FIREBASE_CONFIG);
}
