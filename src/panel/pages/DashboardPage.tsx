import { useState, useEffect, useRef, useCallback } from 'react';
import type { User } from 'firebase/auth';
import type { Unsubscribe } from 'firebase/database';
import { getDatabase, ref, onValue } from 'firebase/database';
import { getFirebaseApp } from '@/lib/firebase';
import PageHeader from '@/components/PageHeader';
import TimerHero from '@/components/TimerHero';
import TimerControls from '@/components/TimerControls';
import LeadFilters from '@/components/LeadFilters';
import StatusFooter from '@/components/StatusFooter';
import DevicesSection from '@/components/DevicesSection';
import type {
  BackgroundCommandType,
  DeviceRecord,
  ExtensionSettings,
  LeadRecord,
  StartTimerPayload,
  TimerState,
} from '@/types';
import PageShell from '@/components/PageShell';

const STATE_OPTIONS = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra',
  'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim',
  'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
] as const;

interface DashboardPageProps {
  googleUser: User;
  onSignOut: () => void;
}

export default function DashboardPage({ googleUser, onSignOut }: DashboardPageProps) {
  const [inputSeconds, setInputSeconds] = useState('3');
  const [minPrice, setMinPrice] = useState('');
  const [minQuantity, setMinQuantity] = useState('');
  const [minTimePassed, setMinTimePassed] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [cycleCount, setCycleCount] = useState(0);
  const [activeUrl, setActiveUrl] = useState('');
  const [nextFireTime, setNextFireTime] = useState<number | null>(null);
  const [registeredDeviceCount, setRegisteredDeviceCount] = useState(0);

  const settingsLoadedRef = useRef(false);
  const devicesUnsubRef = useRef<Unsubscribe | null>(null);

  const toggleStateSelection = (state: string) => {
    setSelectedStates((current) =>
      current.includes(state)
        ? current.filter((value) => value !== state)
        : [...current, state]
    );
  };

  const refreshBackgroundState = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'GET_TIMER_STATE' }, (state: TimerState | undefined) => {
      if (!state) return;
      setIsRunning(state.running);
      setCycleCount(state.cycleCount || 0);
      setActiveUrl(state.url || '');
      if (state.nextFireTime) {
        const remaining = Math.max(0, Math.ceil((state.nextFireTime - Date.now()) / 1000));
        setTimeLeft(remaining);
        setNextFireTime(state.nextFireTime);
      } else {
        setTimeLeft(0);
        setNextFireTime(null);
      }
    });
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem('im-extension-settings') || '{}'
      ) as ExtensionSettings;
      if (saved.inputSeconds !== undefined) setInputSeconds(saved.inputSeconds);
      if (saved.minPrice !== undefined) setMinPrice(saved.minPrice);
      if (saved.minQuantity !== undefined) setMinQuantity(saved.minQuantity);
      if (saved.minTimePassed !== undefined) setMinTimePassed(saved.minTimePassed);
      if (saved.selectedStates !== undefined) setSelectedStates(saved.selectedStates);
      if (saved.phoneNumber !== undefined) setPhoneNumber(saved.phoneNumber);
    } catch {
      // ignore malformed settings
    }
    settingsLoadedRef.current = true;

    const interval = setInterval(() => refreshBackgroundState(), 1000);
    return () => clearInterval(interval);
  }, [refreshBackgroundState]);

  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    const settings: ExtensionSettings = {
      inputSeconds,
      minPrice,
      minQuantity,
      minTimePassed,
      selectedStates,
      phoneNumber,
    };
    localStorage.setItem('im-extension-settings', JSON.stringify(settings));
  }, [inputSeconds, minPrice, minQuantity, minTimePassed, selectedStates, phoneNumber]);

  useEffect(() => {
    const app = getFirebaseApp();
    const db = getDatabase(app);
    const devicesRef = ref(db, `devices/${googleUser.uid}`);

    devicesUnsubRef.current = onValue(devicesRef, (snap) => {
      const devices = (snap.val() || {}) as Record<string, DeviceRecord>;
      const registeredDevices = Object.values(devices)
        .filter((d): d is DeviceRecord & { fcmToken: string } => Boolean(d.fcmToken))
        .map((d) => ({ token: d.fcmToken, notificationStyle: d.notificationStyle ?? 'headsup' }));
      chrome.storage.local.set({ registeredDevices });
      setRegisteredDeviceCount(registeredDevices.length);
    });

    return () => {
      if (devicesUnsubRef.current) {
        devicesUnsubRef.current();
        devicesUnsubRef.current = null;
      }
    };
  }, [googleUser]);

  const formatTime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const handleStart = () => {
    const seconds = parseInt(inputSeconds, 10) || 0;
    if (seconds > 0) {
      const minPriceValue = minPrice.trim() ? Number(minPrice) : null;
      const minQuantityValue = minQuantity.trim() ? Number(minQuantity) : null;
      const minTimePassedValue = minTimePassed.trim() ? Number(minTimePassed) : null;
      const filters = {
        minPrice: Number.isFinite(minPriceValue) ? minPriceValue : null,
        minQuantity: Number.isFinite(minQuantityValue) ? minQuantityValue : null,
        minTimePassed: Number.isFinite(minTimePassedValue) ? minTimePassedValue : null,
        states: selectedStates.length ? selectedStates : null,
      };
      setTimeLeft(seconds);
      setIsRunning(true);
      setCycleCount(0);
      sendBackgroundCommand('START_TIMER', { seconds, filters, phoneNumber });
    }
  };

  const handleStop = () => {
    setIsRunning(false);
    setTimeLeft(0);
    sendBackgroundCommand('STOP_TIMER');
  };

  const handleReset = () => {
    setIsRunning(false);
    setTimeLeft(0);
    setCycleCount(0);
    sendBackgroundCommand('STOP_TIMER');
  };

  const handleTestNotification = async () => {
    chrome.storage.local.get(['registeredDevices'], async (result) => {
      const registeredDevices = (result.registeredDevices as Array<{ token: string; notificationStyle: string }> | undefined) ?? [];
      if (registeredDevices.length === 0) {
        console.warn('[Test] No registered phones');
        return;
      }
      await Promise.all(
        registeredDevices.map(async ({ token, notificationStyle }) => {
          const channelId = notificationStyle === 'phonecall' ? 'lead-alerts-phonecall' : 'lead-alerts-v2';
          const res = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: token,
              title: 'Test Lead — Mock Purchase',
              body: 'Buyer: Test User — Mumbai, Maharashtra',
              channelId,
              priority: 'high',
              sound: 'default',
              data: {
                title: 'Test Lead — Mock Purchase',
                buyerName: 'Test User',
                buyerMobile: '9000000000',
                quantity: '100',
                city: 'Mumbai',
                state: 'Maharashtra',
              },
            }),
          });
          const data = await res.json();
          console.log('[Test] Expo response:', data, 'channel:', channelId);
        })
      );
    });
  };

  const handleExportCSV = () => {
    chrome.runtime.sendMessage({ type: 'GET_ALL_LEADS' }, (response: { leads?: LeadRecord[] } = {}) => {
      const { leads } = response;
      if (!leads || leads.length === 0) {
        alert('No leads recorded yet.');
        return;
      }
      const escape = (v: unknown): string => {
        if (v == null) return '';
        const s = String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      };
      const headers = [
        'Lead ID', 'Title', 'Price (₹)', 'Quantity', 'Age (min)', 'City', 'State',
        'Category ID', 'First Seen Date', 'First Seen Time', 'Reason',
        'Filter Min Price', 'Filter Min Qty', 'Filter Max Age (min)', 'Filter States',
      ];
      const rows = leads.map((l) =>
        [
          l.ETO_OFR_ID,
          l.ETO_OFR_TITLE,
          l.ETO_OFR_APPROX_ORDER_VALUE,
          l.quantity,
          l.BLDATETIME,
          l.GLUSR_CITY,
          l.GLUSR_STATE,
          l.FK_GLCAT_MCAT_ID,
          l.firstSeenDate,
          l.firstSeenTime,
          l.reasons,
          l.filtersAtFirstSeen?.minPrice,
          l.filtersAtFirstSeen?.minQuantity,
          l.filtersAtFirstSeen?.minTimePassed,
          l.filtersAtFirstSeen?.states?.join(' | '),
        ]
          .map(escape)
          .join(',')
      );
      const csv = [headers.join(','), ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `indiamart-leads-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  const sendBackgroundCommand = (
    type: BackgroundCommandType,
    payload: Partial<StartTimerPayload> = {}
  ) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) return;
      const tab = tabs[0];
      chrome.runtime.sendMessage({ type, tabId: tab.id, url: tab.url, ...payload });
    });
  };

  return (
    <PageShell>
      <PageHeader
        email={googleUser.email}
        deviceCount={registeredDeviceCount}
        onExportCSV={handleExportCSV}
        onSignOut={onSignOut}
      />

      <TimerHero timeLeft={timeLeft} isRunning={isRunning} formatTime={formatTime} />

      <TimerControls
        inputSeconds={inputSeconds}
        setInputSeconds={setInputSeconds}
        phoneNumber={phoneNumber}
        setPhoneNumber={setPhoneNumber}
        isRunning={isRunning}
        onStart={handleStart}
        onStop={handleStop}
        onReset={handleReset}
      />

      <LeadFilters
        minPrice={minPrice}
        setMinPrice={setMinPrice}
        minQuantity={minQuantity}
        setMinQuantity={setMinQuantity}
        minTimePassed={minTimePassed}
        setMinTimePassed={setMinTimePassed}
        selectedStates={selectedStates}
        toggleStateSelection={toggleStateSelection}
        stateOptions={STATE_OPTIONS}
        isRunning={isRunning}
      />

      <StatusFooter
        cycleCount={cycleCount}
        isRunning={isRunning}
        activeUrl={activeUrl}
        nextFireTime={nextFireTime}
      />

      {registeredDeviceCount > 0 && (
        <DevicesSection onTestNotification={handleTestNotification} />
      )}
    </PageShell>
  );
}
