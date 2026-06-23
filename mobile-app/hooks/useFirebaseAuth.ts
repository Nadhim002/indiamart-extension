import { useState, useEffect } from 'react';
import { signInAnonymously, onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '../firebase';

export function useFirebaseAuth(): { uid: string | null; loading: boolean } {
  const [uid, setUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user: User | null) => {
      if (user) {
        setUid(user.uid);
        setLoading(false);
      } else {
        try {
          const credential = await signInAnonymously(auth);
          setUid(credential.user.uid);
        } catch (e) {
          console.error('Anonymous sign-in failed', e);
        } finally {
          setLoading(false);
        }
      }
    });
    return unsubscribe;
  }, []);

  return { uid, loading };
}
