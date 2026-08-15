import { useState, useEffect } from 'react';
import type { User } from 'firebase/auth/web-extension';
import './index.css';
import { getAuth, GoogleAuthProvider, signInWithCredential, signOut, onAuthStateChanged, onIdTokenChanged } from 'firebase/auth/web-extension';
import { forceWebSockets, getDatabase, ref, set } from 'firebase/database';
import { getFirebaseApp } from '@/lib/firebase';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import LockoutPage from '@/pages/LockoutPage';
import { useEntitlement } from '@/hooks/useEntitlement';
import { sanitizeEmail } from '@shared/email';

forceWebSockets();

// Sign-in deliberately uses chrome.identity.getAuthToken — the same call the
// Sheets/Drive code paths use — rather than launchWebAuthFlow with an account
// chooser. getAuthToken can only ever mint a token for the Chrome profile's
// signed-in account, so a chooser here produced two unrelated Google
// identities: the app was "logged in" as whoever the user picked, while every
// drive.file grant (and the Picker's account) belonged to the Chrome profile.
// The sheet pointer was then filed under one email while the grant lived on
// another, which is why a sheet picked on one computer 403'd on the next.
//
// Consequence, by design: the account is the Chrome profile's. To use a
// different Google account, the user switches Chrome profile.
//
// The manifest's oauth2.scopes carry openid/email/profile alongside
// drive.file, so this one token satisfies both Firebase sign-in and the Sheets
// API. It also means consent is granted at login — every other call site uses
// { interactive: false }, so without this a second computer that auto-adopts a
// shared sheet would never obtain a grant and would fail silently forever.
function getGoogleAccessToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (result) => {
      // @types/chrome declares this callback as GetAuthTokenResult, but Chrome
      // still hands back a bare token string — which is what every other
      // getAuthToken call site here depends on. Accept either shape rather
      // than betting on one.
      const raw = result as unknown as string | { token?: string } | undefined;
      const token = typeof raw === 'string' ? raw : raw?.token;
      if (chrome.runtime.lastError || !token) {
        reject(
          new Error(
            chrome.runtime.lastError?.message ??
              'No Google account in this Chrome profile — sign in to Chrome first.'
          )
        );
        return;
      }
      resolve(token);
    });
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
    // Chrome caches the getAuthToken result per profile+client+scopes. Without
    // dropping it, the next sign-in silently reuses a stale token instead of
    // re-minting one — and a token revoked in the Google account settings
    // would keep being handed out until it expired.
    await new Promise<void>((resolve) => chrome.identity.clearAllCachedAuthTokens(() => resolve()));
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
