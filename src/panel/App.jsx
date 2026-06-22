import { useState, useEffect, useRef } from 'react';
import './global.css';

export default function App() {
  const [inputSeconds, setInputSeconds] = useState('3');
  const [minPrice, setMinPrice] = useState('');
  const [minQuantity, setMinQuantity] = useState('');
  const [minTimePassed, setMinTimePassed] = useState('');
  const [selectedStates, setSelectedStates] = useState([]);
  const [statesDropdownOpen, setStatesDropdownOpen] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [cycleCount, setCycleCount] = useState(0);
  const [activeUrl, setActiveUrl] = useState('');
  const [nextFireTime, setNextFireTime] = useState(null);
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
    } catch {}
    settingsLoadedRef.current = true;
  }, []);

  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    localStorage.setItem('im-extension-settings', JSON.stringify({ inputSeconds, minPrice, minQuantity, minTimePassed, selectedStates }));
  }, [inputSeconds, minPrice, minQuantity, minTimePassed, selectedStates]);

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
      sendBackgroundCommand('START_TIMER', { seconds, filters });
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
      <h1>Timer</h1>

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
      </div>
    </main>
  );
}
