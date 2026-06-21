import { useState, useEffect, useRef } from 'react';
import './global.css';
import { formatTime } from '../Utils.js';

export default function App() {
  const [inputSeconds, setInputSeconds] = useState('5');
  const [timeLeft, setTimeLeft] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [cycleCount, setCycleCount] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!isRunning) return;

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          // Timer expired, restart
          runFunctionAndRestart();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timerRef.current);
  }, [isRunning]);

  const runFunctionAndRestart = () => {
    setCycleCount((prev) => prev + 1);
    executeFunction();
    // Auto-restart timer
    const seconds = parseInt(inputSeconds) || 0;
    if (seconds > 0) {
      setTimeLeft(seconds);
    }
  };

  const executeFunction = () => {
    // Inject and execute function directly in the page's main world
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: injectAndRunFunction,
          world: 'MAIN'
        });
      }
    });
  };

  const injectAndRunFunction = () => {
    try {
      if (typeof fetchGlidScriptJSFile === 'function') {
        const result = fetchGlidScriptJSFile();
        const tableToLog = {result , time : new Date().toLocaleString() , stae : document.visibilityState};
        console.table(tableToLog);
        
      } else {
        console.warn('[Timer Extension] fetchGlidScriptJSFile not found');
      }
    } catch (error) {
      console.error('[Timer Extension] Error:', error.message);
    }
  };

  const handleStart = () => {
    const seconds = parseInt(inputSeconds) || 0;
    if (seconds > 0) {
      setTimeLeft(seconds);
      setIsRunning(true);
      setCycleCount(0);
    }
  };

  const handleStop = () => {
    setIsRunning(false);
    setTimeLeft(0);
  };

  const handleReset = () => {
    setIsRunning(false);
    setTimeLeft(0);
    setCycleCount(0);
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
        </div>
      </div>
    </main>
  );
}
