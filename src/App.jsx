import { useEffect, useMemo, useState } from 'react';
import ControlPanel from './components/ControlPanel.jsx';
import StatsPanel from './components/StatsPanel.jsx';
import LogsPanel from './components/LogsPanel.jsx';

const DEFAULT_INTERVAL = 5;

function App() {

  const [intervalSeconds, setIntervalSeconds] = useState(DEFAULT_INTERVAL);
  const [state, setState] = useState({
    active: false,
    call_count: 0,
    success_count: 0,
    error_count: 0,
    last_call_time: null,
    last_error: null
  });
  const [logs, setLogs] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');

  const hasLogs = logs.length > 0;

  const statusText = useMemo(() => (state.active ? '[●] ACTIVE' : '[●] IDLE'), [state.active]);

  useEffect(() => {
    async function fetchInitialState() {
      try {
        const response = await chrome.runtime.sendMessage({ action: 'get_status' });
        setState(response.state);
        setLogs(response.logs || []);
      } catch (error) {
        console.error(error);
      }
    }

    fetchInitialState();

    const listener = (request) => {
      if (request.action === 'polling_status_update') {
        setState(request.state);
        setLogs(request.logs || []);
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const response = await chrome.runtime.sendMessage({ action: 'get_status' });
        setState(response.state);
        setLogs(response.logs || []);
      } catch (error) {
        // ignore
      }
    }, 500);

    return () => clearInterval(interval);
  }, []);

  const handleStart = async () => {
    if (!intervalSeconds || intervalSeconds < 1 || intervalSeconds > 300) {
      setErrorMessage('Interval must be between 1 and 300 seconds');
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'start_polling',
        interval_seconds: intervalSeconds
      });

      if (!response.ok) {
        setErrorMessage(response.error || 'Unable to start polling');
      } else {
        setErrorMessage('');
      }
    } catch (error) {
      setErrorMessage(`Failed to start polling: ${error.message}`);
    }
  };

  const handleStop = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'stop_polling' });
      if (!response.ok) {
        setErrorMessage(response.error || 'Unable to stop polling');
      } else {
        setErrorMessage('');
      }
    } catch (error) {
      setErrorMessage(`Failed to stop polling: ${error.message}`);
    }
  };

  const handleClearLogs = () => {
    setLogs([]);
  };

  return (
    <div className="container">
      <header>
        <h1>Buy Leads Automation</h1>
      </header>

      <ControlPanel
        intervalSeconds={intervalSeconds}
        setIntervalSeconds={setIntervalSeconds}
        onStart={handleStart}
        onStop={handleStop}
        active={state.active}
      />

      <section className="status-section">
        <p className="status">
          Status: <span className={state.active ? 'badge active' : 'badge idle'}>{statusText}</span>
        </p>
        <StatsPanel state={state} />
      </section>

      {errorMessage && (
        <section className="section error-box">
          <p>{errorMessage}</p>
        </section>
      )}

      <LogsPanel logs={logs} onClear={handleClearLogs} hasLogs={hasLogs} />
    </div>
  );
}

export default App;
