import { useState, useEffect } from 'react';
import type { User } from 'firebase/auth';
import './index.css';
import { getAuth, GoogleAuthProvider, signInWithCredential, signOut, onAuthStateChanged, onIdTokenChanged } from 'firebase/auth';
import { forceWebSockets } from 'firebase/database';
import { getFirebaseApp } from '@/lib/firebase';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';

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

export default function App() {
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState('');

  useEffect(() => {
    const app = getFirebaseApp();
    const auth = getAuth(app);

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setGoogleUser(user);
      if (!user) {
        chrome.storage.local.remove(['googleUID', 'googleIdToken', 'registeredFcmTokens']);
      }
    });

    const unsubToken = onIdTokenChanged(auth, async (user) => {
      if (!user) return;
      const idToken = await user.getIdToken();
      chrome.storage.local.set({ googleUID: user.uid, googleIdToken: idToken });
    });

    return () => {
      unsubAuth();
      unsubToken();
    };
  }, []);

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

  return <DashboardPage googleUser={googleUser} onSignOut={handleSignOut} />;
}
