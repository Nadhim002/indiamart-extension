import { useState, useEffect, useCallback } from 'react';
import type { User } from 'firebase/auth/web-extension';
import { getDatabase, ref, onValue, set, update, remove } from 'firebase/database';
import { getFirebaseApp } from '@/lib/firebase';
import { sanitizeEmail } from '@shared/email';
import { getOrCreateInstallId, defaultComputerName } from '@/lib/installId';
import type { ComputerRecord, PhoneRecord, Entitlement } from '@shared/types';

export interface DeviceView {
  id: string;
  name: string;
  lastSeen?: number;
  kind: 'computer' | 'phone';
  isThisDevice: boolean;
}

// Owns the account's device roster (computers + phones) under
// accounts/{email}/{computers|phones}. Responsibilities:
//  - register/heartbeat THIS computer's installId (only when entitled and a
//    seat is free — never before the roster has loaded, or we could exceed the
//    limit),
//  - mirror phones into chrome.storage.local for the worker's Expo push,
//  - expose lists + rename/remove for the "My Devices" UI and the limit gate.
export function useAccountDevices(user: User, entitlement: Entitlement | null) {
  const [computers, setComputers] = useState<Record<string, ComputerRecord>>({});
  const [phones, setPhones] = useState<Record<string, PhoneRecord>>({});
  const [installId, setInstallId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const email = user.email;
  const key = email ? sanitizeEmail(email) : null;

  useEffect(() => {
    getOrCreateInstallId().then(setInstallId);
  }, []);

  useEffect(() => {
    if (!key) return;
    const db = getDatabase(getFirebaseApp());
    let gotComputers = false;
    const u1 = onValue(ref(db, `accounts/${key}/computers`), (s) => {
      setComputers((s.val() ?? {}) as Record<string, ComputerRecord>);
      gotComputers = true;
      setLoaded(true);
    });
    const u2 = onValue(ref(db, `accounts/${key}/phones`), (s) => {
      setPhones((s.val() ?? {}) as Record<string, PhoneRecord>);
      if (gotComputers) setLoaded(true);
    });
    return () => {
      u1();
      u2();
    };
  }, [key]);

  // Mirror registered phones for the service worker's Expo push path.
  useEffect(() => {
    const registeredDevices = Object.values(phones)
      .filter((d): d is PhoneRecord & { fcmToken: string } => Boolean(d.fcmToken))
      .map((d) => ({ token: d.fcmToken, notificationStyle: d.notificationStyle ?? 'headsup' }));
    chrome.storage.local.set({ registeredDevices });
  }, [phones]);

  const maxComputers = entitlement?.maxComputers ?? 0;
  const computerCount = Object.keys(computers).length;
  const thisRegistered = installId ? Boolean(computers[installId]) : false;
  // A seat is available if this device already holds one, or the roster has room.
  const seatAvailable = thisRegistered || computerCount < maxComputers;

  // Register or heartbeat this computer once the roster is known and we're sure
  // there is room (or we already hold a seat).
  useEffect(() => {
    if (!key || !installId || !loaded || !entitlement?.valid) return;
    const db = getDatabase(getFirebaseApp());
    const myRef = ref(db, `accounts/${key}/computers/${installId}`);
    if (thisRegistered) {
      void update(myRef, { lastSeen: Date.now() });
    } else if (computerCount < maxComputers) {
      const record: ComputerRecord = {
        name: defaultComputerName(),
        registeredAt: Date.now(),
        lastSeen: Date.now(),
      };
      void set(myRef, record);
    }
  }, [key, installId, loaded, entitlement?.valid, thisRegistered, computerCount, maxComputers]);

  const renameDevice = useCallback(
    (kind: 'computer' | 'phone', id: string, name: string) => {
      if (!key) return Promise.resolve();
      const db = getDatabase(getFirebaseApp());
      const node = kind === 'computer' ? 'computers' : 'phones';
      return update(ref(db, `accounts/${key}/${node}/${id}`), { name });
    },
    [key]
  );

  const removeDevice = useCallback(
    (kind: 'computer' | 'phone', id: string) => {
      if (!key) return Promise.resolve();
      const db = getDatabase(getFirebaseApp());
      const node = kind === 'computer' ? 'computers' : 'phones';
      return remove(ref(db, `accounts/${key}/${node}/${id}`));
    },
    [key]
  );

  const computerViews: DeviceView[] = Object.entries(computers).map(([id, c]) => ({
    id,
    name: c.name || 'Computer',
    lastSeen: c.lastSeen,
    kind: 'computer',
    isThisDevice: id === installId,
  }));
  const phoneViews: DeviceView[] = Object.entries(phones).map(([id, p]) => ({
    id,
    name: p.name || 'Phone',
    lastSeen: p.lastSeen,
    kind: 'phone',
    isThisDevice: false,
  }));

  return {
    loaded,
    computers: computerViews,
    phones: phoneViews,
    computerCount,
    phoneCount: phoneViews.length,
    maxComputers,
    maxPhones: entitlement?.maxPhones ?? 0,
    seatAvailable,
    thisRegistered,
    installId,
    renameDevice,
    removeDevice,
  };
}
