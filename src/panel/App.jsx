import { useState, useEffect, useRef } from 'react';
import './global.css';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithCredential, signOut, onAuthStateChanged, onIdTokenChanged } from 'firebase/auth';
import { getDatabase, ref, onValue, forceWebSockets } from 'firebase/database';

// Chrome extension CSP blocks long-polling script injection — WebSocket only
forceWebSockets();
import { FIREBASE_CONFIG } from './firebaseConfig';

// ─────────────────────────────────────────────────────────────────────────────
// SETUP: Go to Google Cloud Console → APIs & Services → Credentials
// Create an OAuth 2.0 Client ID of type "Web application".
// Add this redirect URI: (paste chrome.identity.getRedirectURL() output)
// Then paste the client_id here.
// ─────────────────────────────────────────────────────────────────────────────
const GOOGLE_OAUTH_CLIENT_ID = '797004741619-lko4nhlrpj19f5utno4f8721gfeheqto.apps.googleusercontent.com';


const DB_URL = FIREBASE_CONFIG.databaseURL;

function getFirebaseApp() {
  return getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
}

function getGoogleAccessToken() {
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
  const [googleUser, setGoogleUser] = useState(null);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState('');

  const [inputSeconds, setInputSeconds] = useState('3');
  const [minPrice, setMinPrice] = useState('');
  const [minQuantity, setMinQuantity] = useState('');
  const [minTimePassed, setMinTimePassed] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [selectedStates, setSelectedStates] = useState([]);
  const [statesDropdownOpen, setStatesDropdownOpen] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [cycleCount, setCycleCount] = useState(0);
  const [activeUrl, setActiveUrl] = useState('');
  const [nextFireTime, setNextFireTime] = useState(null);
  const [registeredDeviceCount, setRegisteredDeviceCount] = useState(0);

  const timerRef = useRef(null);
  const stateDropdownRef = useRef(null);
  const settingsLoadedRef = useRef(false);
  const devicesUnsubRef = useRef(null);

  const stateOptions = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];

  const toggleStateSelection = (state) => {
    setSelectedStates((current) =>
      current.includes(state)
        ? current.filter((value) => value !== state)
        : [...current, state]
    );
  };

  const closeStateDropdown = () => setStatesDropdownOpen(false);

  // ── Load persisted settings ──────────────────────────────────────────────
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('im-extension-settings') || '{}');
      if (saved.inputSeconds !== undefined) setInputSeconds(saved.inputSeconds);
      if (saved.minPrice !== undefined) setMinPrice(saved.minPrice);
      if (saved.minQuantity !== undefined) setMinQuantity(saved.minQuantity);
      if (saved.minTimePassed !== undefined) setMinTimePassed(saved.minTimePassed);
      if (saved.selectedStates !== undefined) setSelectedStates(saved.selectedStates);
      if (saved.phoneNumber !== undefined) setPhoneNumber(saved.phoneNumber);
    } catch {}
    settingsLoadedRef.current = true;

    const interval = setInterval(() => refreshBackgroundState(), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    localStorage.setItem('im-extension-settings', JSON.stringify({ inputSeconds, minPrice, minQuantity, minTimePassed, selectedStates, phoneNumber }));
  }, [inputSeconds, minPrice, minQuantity, minTimePassed, selectedStates, phoneNumber]);

  useEffect(() => {
    const handler = (event) => {
      if (stateDropdownRef.current && !stateDropdownRef.current.contains(event.target)) {
        closeStateDropdown();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Firebase auth state ──────────────────────────────────────────────────
  useEffect(() => {
    const app = getFirebaseApp();
    const auth = getAuth(app);

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setGoogleUser(user);
      if (!user) {
        chrome.storage.local.remove(['googleUID', 'googleIdToken', 'registeredFcmTokens']);
        setRegisteredDeviceCount(0);
        if (devicesUnsubRef.current) { devicesUnsubRef.current(); devicesUnsubRef.current = null; }
      }
    });

    const unsubToken = onIdTokenChanged(auth, async (user) => {
      if (!user) return;
      const idToken = await user.getIdToken();
      chrome.storage.local.set({ googleUID: user.uid, googleIdToken: idToken });
    });

    return () => { unsubAuth(); unsubToken(); };
  }, []);

  // ── Subscribe to registered devices for this Google account ─────────────
  useEffect(() => {
    if (!googleUser) return;
    const app = getFirebaseApp();
    const db = getDatabase(app);
    const devicesRef = ref(db, `devices/${googleUser.uid}`);

    devicesUnsubRef.current = onValue(devicesRef, (snap) => {
      const devices = snap.val() || {};
      const tokens = Object.values(devices)
        .map((d) => d.fcmToken)
        .filter(Boolean);
      chrome.storage.local.set({ registeredFcmTokens: tokens });
      setRegisteredDeviceCount(tokens.length);
    });

    return () => { if (devicesUnsubRef.current) { devicesUnsubRef.current(); devicesUnsubRef.current = null; } };
  }, [googleUser]);

  // ── Auth actions ─────────────────────────────────────────────────────────
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
      setSignInError(e.message);
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    const app = getFirebaseApp();
    const auth = getAuth(app);
    await signOut(auth);
  };

  // ── Timer controls ───────────────────────────────────────────────────────
  const formatTime = (seconds) => {
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
    chrome.storage.local.get(['registeredFcmTokens'], async ({ registeredFcmTokens = [] }) => {
      if (registeredFcmTokens.length === 0) {
        console.warn('[Test] No registered phones');
        return;
      }
      await Promise.all(
        registeredFcmTokens.map(async (token) => {
          const res = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: token,
              title: 'Test Lead — Mock Purchase',
              body: 'Buyer: Test User — Mumbai, Maharashtra',
              channelId: 'lead-alerts',
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
          console.log('[Test] Expo response:', data);
        })
      );
    });
  };

  const handleExportCSV = () => {
    chrome.runtime.sendMessage({ type: 'GET_ALL_LEADS' }, ({ leads } = {}) => {
      if (!leads || leads.length === 0) { alert('No leads recorded yet.'); return; }
      const escape = (v) => {
        if (v == null) return '';
        const s = String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const headers = ['Lead ID', 'Title', 'Price (₹)', 'Quantity', 'Age (min)', 'City', 'State', 'Category ID', 'First Seen Date', 'First Seen Time', 'Reason', 'Filter Min Price', 'Filter Min Qty', 'Filter Max Age (min)', 'Filter States'];
      const rows = leads.map((l) => [l.ETO_OFR_ID, l.ETO_OFR_TITLE, l.ETO_OFR_APPROX_ORDER_VALUE, l.quantity, l.BLDATETIME, l.GLUSR_CITY, l.GLUSR_STATE, l.FK_GLCAT_MCAT_ID, l.firstSeenDate, l.firstSeenTime, l.reasons, l.filtersAtFirstSeen?.minPrice, l.filtersAtFirstSeen?.minQuantity, l.filtersAtFirstSeen?.minTimePassed, l.filtersAtFirstSeen?.states?.join(' | ')].map(escape).join(','));
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

  const sendBackgroundCommand = (type, payload = {}) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) return;
      const tab = tabs[0];
      chrome.runtime.sendMessage({ type, tabId: tab.id, url: tab.url, ...payload });
    });
  };

  const refreshBackgroundState = () => {
    chrome.runtime.sendMessage({ type: 'GET_TIMER_STATE' }, (state) => {
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
  };

  // ── Sign-in gate ─────────────────────────────────────────────────────────
  if (!googleUser) {
    return (
      <main className="panel-root">
        <div className="sign-in-container">
          <h1>Indiamart Lead Notifier</h1>
          <p className="sign-in-subtitle">Sign in with Google to start receiving lead alerts on your phone.</p>
          <button
            className="btn btn-google-signin"
            onClick={handleSignIn}
            disabled={signingIn}
          >
            {signingIn ? 'Signing in…' : 'Sign in with Google'}
          </button>
          {signInError && <p className="pair-error">{signInError}</p>}
        </div>
      </main>
    );
  }

  // ── Main UI ──────────────────────────────────────────────────────────────
  return (
    <main className="panel-root">
      <div className="panel-header">
        <h1>Timer</h1>
        <div className="header-actions">
          <button onClick={handleExportCSV} className="btn btn-export">Export CSV</button>
          <button onClick={handleSignOut} className="btn btn-signout">Sign Out</button>
        </div>
      </div>

      <div className="account-bar">
        <span className="account-email">{googleUser.email}</span>
        <span className="device-count">{registeredDeviceCount} phone{registeredDeviceCount !== 1 ? 's' : ''} subscribed</span>
      </div>

      <div className="timer-container">
        <div className="timer-display">{formatTime(timeLeft)}</div>

        <div className="input-group">
          <label htmlFor="seconds">Seconds:</label>
          <input
            id="seconds"
            type="number"
            min="1"
            value={inputSeconds}
            onChange={(e) => setInputSeconds(e.target.value)}
            disabled={isRunning}
            className="time-input"
          />
        </div>

        <div className="input-group">
          <label htmlFor="phoneNumber">Your mobile number</label>
          <input
            id="phoneNumber"
            type="tel"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            disabled={isRunning}
            className="time-input"
            placeholder="e.g. 9842142030"
          />
        </div>

        <div className="filter-grid">
          <div className="input-group">
            <label htmlFor="minPrice">Min price for good lead</label>
            <input id="minPrice" type="number" min="0" step="1" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} disabled={isRunning} className="time-input" />
          </div>
          <div className="input-group">
            <label htmlFor="minQuantity">Min quantity for good lead</label>
            <input id="minQuantity" type="number" min="0" step="1" value={minQuantity} onChange={(e) => setMinQuantity(e.target.value)} disabled={isRunning} className="time-input" />
          </div>
          <div className="input-group">
            <label htmlFor="minTimePassed">Min time passed for good lead (minutes)</label>
            <input id="minTimePassed" type="number" min="0" step="1" value={minTimePassed} onChange={(e) => setMinTimePassed(e.target.value)} disabled={isRunning} className="time-input" />
          </div>
          <div className="input-group multi-select-group" ref={stateDropdownRef}>
            <label>Filter by state (optional)</label>
            <button type="button" className="dropdown-button" onClick={() => setStatesDropdownOpen((open) => !open)} disabled={isRunning} aria-expanded={statesDropdownOpen}>
              {selectedStates.length > 0 ? `${selectedStates.length} selected` : 'Any state'}
            </button>
            {statesDropdownOpen && (
              <div className="dropdown-menu">
                {stateOptions.map((state) => (
                  <label className="dropdown-option" key={state}>
                    <input type="checkbox" checked={selectedStates.includes(state)} onChange={() => toggleStateSelection(state)} />
                    <span>{state}</span>
                  </label>
                ))}
              </div>
            )}
            <small>If no states are selected, state filtering is disabled.</small>
          </div>
        </div>

        <div className="button-group">
          <button onClick={handleStart} disabled={isRunning} className="btn btn-start">Start</button>
          <button onClick={handleStop} disabled={!isRunning} className="btn btn-stop">Stop</button>
          <button onClick={handleReset} className="btn btn-reset">Reset</button>
        </div>

        <div className="cycle-info">
          <p>Cycles completed: <strong>{cycleCount}</strong></p>
          <p>Status: <strong>{isRunning ? 'Running' : 'Stopped'}</strong></p>
          {activeUrl && <p>Target tab: <strong>{activeUrl}</strong></p>}
          {nextFireTime && <p>Next update in: <strong>{Math.max(0, Math.ceil((nextFireTime - Date.now()) / 1000))}s</strong></p>}
        </div>

        {registeredDeviceCount > 0 && (
          <div className="devices-section">
            <p>{registeredDeviceCount} phone{registeredDeviceCount !== 1 ? 's' : ''} will receive lead alerts.</p>
            <button className="btn btn-test" onClick={handleTestNotification}>
              Send Test Notification
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
