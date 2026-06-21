import { useState, useEffect, useRef } from 'react';
import './global.css';
import { formatTime } from '../Utils.js';

export default function App() {
  const [inputSeconds, setInputSeconds] = useState('3');
  const [timeLeft, setTimeLeft] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [cycleCount, setCycleCount] = useState(0);
  const [activeUrl, setActiveUrl] = useState('');
  const [nextFireTime, setNextFireTime] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    refreshBackgroundState();

    const interval = setInterval(() => {
      refreshBackgroundState();
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const runFunctionAndRestart = () => {
    setCycleCount((prev) => prev + 1);
    // Auto-restart timer
    const seconds = parseInt(inputSeconds) || 0;
    if (seconds > 0) {
      setTimeLeft(seconds);
    }
  };

  const handleStart = () => {
    const seconds = parseInt(inputSeconds) || 0;
    if (seconds > 0) {
      setTimeLeft(seconds);
      setIsRunning(true);
      setCycleCount(0);
      sendBackgroundCommand('START_TIMER', { seconds });
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
