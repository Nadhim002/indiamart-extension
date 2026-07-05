import { useState, useEffect } from 'react';
import type { User } from 'firebase/auth';
import './index.css';
import { getAuth, GoogleAuthProvider, signInWithCredential, signOut, onAuthStateChanged, onIdTokenChanged } from 'firebase/auth';
import { forceWebSockets, getDatabase, ref, set } from 'firebase/database';
import { getFirebaseApp } from '@/lib/firebase';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import LockoutPage from '@/pages/LockoutPage';
import { useEntitlement } from '@/hooks/useEntitlement';
import { sanitizeEmail } from '@shared/email';

forceWebSockets();

const GOOGLE_OAUTH_CLIENT_ID =
  '797004741619-lko4nhlrpj19f5utno4f8721gfeheqto.apps.googleusercontent.com';

function getGoogleAccessToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    const redirectUri = chrome.identity.getRedirectURL();
    const params = new URLSearchParams({
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'token',
      scope: 'openid email profile',
    });
    chrome.identity.launchWebAuthFlow(
      { url: `https://accounts.google.com/o/oauth2/auth?${params}`, interactive: true },
      (responseUrl) => {
        if (chrome.runtime.lastError || !responseUrl) {
          reject(new Error(chrome.runtime.lastError?.message ?? 'Auth cancelled'));
          return;
        }
        const hash = new URLSearchParams(new URL(responseUrl).hash.slice(1));
        const token = hash.get('access_token');
        token ? resolve(token) : reject(new Error('No access token in response'));
      }
    );
  });
}

function LoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-muted-foreground">Checking subscription…</p>
    </main>
  );
}

export default function App() {
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState('');

  const entitlement = useEntitlement(googleUser);

  useEffect(() => {
    const app = getFirebaseApp();
    const auth = getAuth(app);

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setGoogleUser(user);
      if (!user) {
        chrome.storage.local.remove([
          'googleUID',
          'googleIdToken',
          'registeredFcmTokens',
          'registeredDevices',
          'googleEmail',
          'sanitizedEmail',
          'entitlementCache',
        ]);
      }
    });

    const unsubToken = onIdTokenChanged(auth, async (user) => {
      if (!user) return;
      const idToken = await user.getIdToken();
      const patch: Record<string, string> = { googleUID: user.uid, googleIdToken: idToken };
      if (user.email) {
        patch.googleEmail = user.email;
        patch.sanitizedEmail = sanitizeEmail(user.email);
      }
      chrome.storage.local.set(patch);
    });

    return () => {
      unsubAuth();
      unsubToken();
    };
  }, []);

  // Stamp profile.uid so the account links to leads/phones. Only when the
  // account actually exists (not for un-onboarded, locked-out users).
  useEffect(() => {
    if (!googleUser?.email || !entitlement || entitlement.reason === 'no-account') return;
    const db = getDatabase(getFirebaseApp());
    void set(ref(db, `accounts/${sanitizeEmail(googleUser.email)}/profile/uid`), googleUser.uid);
  }, [googleUser, entitlement]);

  const handleSignIn = async () => {
    setSignInError('');
    setSigningIn(true);
    try {
      const accessToken = await getGoogleAccessToken();
      const app = getFirebaseApp();
      const auth = getAuth(app);
      const credential = GoogleAuthProvider.credential(null, accessToken);
      await signInWithCredential(auth, credential);
    } catch (e) {
      setSignInError(e instanceof Error ? e.message : 'Sign in failed');
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    const app = getFirebaseApp();
    const auth = getAuth(app);
    await signOut(auth);
  };

  if (!googleUser) {
    return (
      <LoginPage
        onSignIn={handleSignIn}
        signingIn={signingIn}
        signInError={signInError}
      />
    );
  }

  if (!entitlement) {
    return <LoadingScreen />;
  }

  if (!entitlement.valid) {
    return <LockoutPage reason={entitlement.reason} email={googleUser.email} onSignOut={handleSignOut} />;
  }

  return <DashboardPage googleUser={googleUser} entitlement={entitlement} onSignOut={handleSignOut} />;
}
