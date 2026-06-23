import { useState, useEffect, useRef } from 'react';
import './global.css';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getDatabase, ref, get, set } from 'firebase/database';
import { FIREBASE_CONFIG } from './firebaseConfig';

export default function App() {
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
  const [pairedPhones, setPairedPhones] = useState([]);
  const [pairUsername, setPairUsername] = useState('');
  const [pairCode, setPairCode] = useState('');
  const [pairError, setPairError] = useState('');
  const [isPairing, setIsPairing] = useState(false);
  const timerRef = useRef(null);
  const stateDropdownRef = useRef(null);
  const settingsLoadedRef = useRef(false);

  const stateOptions = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal']

  const toggleStateSelection = (state) => {
    setSelectedStates((current) =>
      current.includes(state)
        ? current.filter((value) => value !== state)
        : [...current, state]
    );
  };

  const closeStateDropdown = () => setStatesDropdownOpen(false);

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

    chrome.storage.local.get(['pairedPhones'], (result) => {
      if (result.pairedPhones) {
        setPairedPhones(result.pairedPhones);
      }
    });
  }, []);

  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    localStorage.setItem('im-extension-settings', JSON.stringify({ inputSeconds, minPrice, minQuantity, minTimePassed, selectedStates, phoneNumber }));
  }, [inputSeconds, minPrice, minQuantity, minTimePassed, selectedStates, phoneNumber]);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (stateDropdownRef.current && !stateDropdownRef.current.contains(event.target)) {
        closeStateDropdown();
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  useEffect(() => {
    refreshBackgroundState();

    const interval = setInterval(() => {
      refreshBackgroundState();
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const formatTime = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const runFunctionAndRestart = () => {
    setCycleCount((prev) => prev + 1);
    // Auto-restart timer
    const seconds = parseInt(inputSeconds) || 0;
    if (seconds > 0) {
      setTimeLeft(seconds);
    }
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

  const handlePair = async () => {
    const username = pairUsername.trim();
    const code = pairCode.trim();
    setPairError('');

    if (!username) {
      setPairError('Enter a phone name.');
      return;
    }
    if (code.length !== 6) {
      setPairError('Enter the 6-character code from your phone.');
      return;
    }

    setIsPairing(true);
    try {
      const app = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
      const auth = getAuth(app);
      const db = getDatabase(app);

      const credential = await signInAnonymously(auth);
      const uid = credential.user.uid;

      const pairingRef = ref(db, 'pairings/' + code.toUpperCase());
      const snapshot = await get(pairingRef);

      if (!snapshot.exists() || snapshot.val().expiresAt <= Date.now()) {
        setPairError('Pairing failed. Code not found or expired.');
        setIsPairing(false);
        return;
      }

      await set(ref(db, 'leads/' + uid + '/paired'), true);

      const updated = [...pairedPhones, { uid, username }];
      setPairedPhones(updated);
      chrome.storage.local.set({ pairedPhones: updated });
      setPairUsername('');
      setPairCode('');
    } catch (e) {
      setPairError('Pairing failed: ' + e.message);
    }
    setIsPairing(false);
  };

  const handleRemovePhone = (uid) => {
    const updated = pairedPhones.filter((p) => p.uid !== uid);
    setPairedPhones(updated);
    chrome.storage.local.set({ pairedPhones: updated });
  };

  const handleExportCSV = () => {
    chrome.runtime.sendMessage({ type: 'GET_ALL_LEADS' }, ({ leads } = {}) => {
      if (!leads || leads.length === 0) {
        alert('No leads recorded yet.');
        return;
      }

      const escape = (v) => {
        if (v == null) return '';
        const s = String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      };

      const headers = [
        'Lead ID', 'Title', 'Price (₹)', 'Quantity', 'Age (min)',
        'City', 'State', 'Category ID',
        'First Seen Date', 'First Seen Time', 'Reason',
        'Filter Min Price', 'Filter Min Qty', 'Filter Max Age (min)', 'Filter States'
      ];

      const rows = leads.map((l) => [
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
      ].map(escape).join(','));

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

  return (
    <main className="panel-root">
      <div className="panel-header">
        <h1>Timer</h1>
        <button onClick={handleExportCSV} className="btn btn-export">Export CSV</button>
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
            <input
              id="minPrice"
              type="number"
              min="0"
              step="1"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              disabled={isRunning}
              className="time-input"
            />
          </div>

          <div className="input-group">
            <label htmlFor="minQuantity">Min quantity for good lead</label>
            <input
              id="minQuantity"
              type="number"
              min="0"
              step="1"
              value={minQuantity}
              onChange={(e) => setMinQuantity(e.target.value)}
              disabled={isRunning}
              className="time-input"
            />
          </div>

          <div className="input-group">
            <label htmlFor="minTimePassed">Min time passed for good lead (minutes)</label>
            <input
              id="minTimePassed"
              type="number"
              min="0"
              step="1"
              value={minTimePassed}
              onChange={(e) => setMinTimePassed(e.target.value)}
              disabled={isRunning}
              className="time-input"
            />
          </div>

          <div className="input-group multi-select-group" ref={stateDropdownRef}>
            <label htmlFor="states">Filter by state (optional)</label>
            <button
              type="button"
              className="dropdown-button"
              onClick={() => setStatesDropdownOpen((open) => !open)}
              disabled={isRunning}
              aria-expanded={statesDropdownOpen}
            >
              {selectedStates.length > 0
                ? `${selectedStates.length} selected`
                : 'Any state'}
            </button>
            {statesDropdownOpen && (
              <div className="dropdown-menu">
                {stateOptions.map((state) => (
                  <label className="dropdown-option" key={state}>
                    <input
                      type="checkbox"
                      checked={selectedStates.includes(state)}
                      onChange={() => toggleStateSelection(state)}
                    />
                    <span>{state}</span>
                  </label>
                ))}
              </div>
            )}
            <small>If no states are selected, state filtering is disabled.</small>
          </div>
        </div>

        <div className="button-group">
          <button onClick={handleStart} disabled={isRunning} className="btn btn-start">
            Start
          </button>
          <button onClick={handleStop} disabled={!isRunning} className="btn btn-stop">
            Stop
          </button>
          <button onClick={handleReset} className="btn btn-reset">
            Reset
          </button>
        </div>

        <div className="cycle-info">
          <p>Cycles completed: <strong>{cycleCount}</strong></p>
          <p>Status: <strong>{isRunning ? 'Running' : 'Stopped'}</strong></p>
          {activeUrl && <p>Target tab: <strong>{activeUrl}</strong></p>}
          {nextFireTime && <p>Next update in: <strong>{Math.max(0, Math.ceil((nextFireTime - Date.now()) / 1000))}s</strong></p>}
        </div>

        <div className="paired-section">
          <h3>Paired Phones</h3>
          <div className="pair-form">
            <input
              type="text"
              placeholder="Phone name"
              value={pairUsername}
              onChange={(e) => setPairUsername(e.target.value)}
              disabled={isPairing}
            />
            <input
              type="text"
              placeholder="6-char code"
              maxLength={6}
              value={pairCode}
              onChange={(e) => setPairCode(e.target.value)}
              disabled={isPairing}
            />
            <button
              className="btn btn-pair"
              onClick={handlePair}
              disabled={isPairing}
            >
              {isPairing ? 'Pairing...' : 'Pair'}
            </button>
          </div>
          {pairError && <p className="pair-error">{pairError}</p>}
          {pairedPhones.length > 0 && (
            <div className="phone-list">
              {pairedPhones.map((phone) => (
                <div className="phone-item" key={phone.uid}>
                  <span>{phone.username}</span>
                  <button
                    className="btn btn-remove"
                    onClick={() => handleRemovePhone(phone.uid)}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <p className="paired-count">{pairedPhones.length} phone(s) paired</p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
