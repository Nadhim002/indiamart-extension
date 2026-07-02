import { useState, useEffect } from 'react';
import type { User } from 'firebase/auth';
import { getDatabase, ref, onValue } from 'firebase/database';
import { getFirebaseApp } from '@/lib/firebase';
import type { DeviceRecord } from '@/types';

// Subscribes to the signed-in user's registered devices in Firebase and mirrors
// the token/style list into chrome.storage.local so the service worker can read
// it. Returns the current device count for the UI.
export function useDevices(googleUser: User) {
  const [registeredDeviceCount, setRegisteredDeviceCount] = useState(0);

  useEffect(() => {
    const app = getFirebaseApp();
    const db = getDatabase(app);
    const devicesRef = ref(db, `devices/${googleUser.uid}`);

    const unsubscribe = onValue(devicesRef, (snap) => {
      const devices = (snap.val() || {}) as Record<string, DeviceRecord>;
      const registeredDevices = Object.values(devices)
        .filter((d): d is DeviceRecord & { fcmToken: string } => Boolean(d.fcmToken))
        .map((d) => ({ token: d.fcmToken, notificationStyle: d.notificationStyle ?? 'headsup' }));
      chrome.storage.local.set({ registeredDevices });
      setRegisteredDeviceCount(registeredDevices.length);
    });

    return () => unsubscribe();
  }, [googleUser]);

  return { registeredDeviceCount };
}
