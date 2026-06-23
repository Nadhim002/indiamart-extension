import { initializeApp, getApps } from 'firebase/app';
import { getDatabase } from 'firebase/database';
import { getAuth } from 'firebase/auth';

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyB1ynT9OknXikIviuXNL-6xU_u3NbFd1R0",
  authDomain: "indiamart-extension-notifier.firebaseapp.com",
  databaseURL: "https://indiamart-extension-notifier-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "indiamart-extension-notifier",
  storageBucket: "indiamart-extension-notifier.firebasestorage.app",
  messagingSenderId: "797004741619",
  appId: "1:797004741619:web:9733864b41beafb10e3086"
};

const app = getApps().length === 0 ? initializeApp(FIREBASE_CONFIG) : getApps()[0];

export const db = getDatabase(app);
export const auth = getAuth(app);
