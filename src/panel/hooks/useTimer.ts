import { useState, useEffect, useCallback } from 'react';
import type { BackgroundCommandType, StartTimerPayload, TimerState } from '@/types';

interface StartResponse {
  ok: boolean;
  reason?: string;
  nextFireTime?: number;
}

// Sends a command to the service worker, tagged with the active tab. START_TIMER
// carries the timer payload; STOP_TIMER carries nothing extra.
function sendBackgroundCommand(
  type: BackgroundCommandType,
  payload: Partial<StartTimerPayload> = {},
  onResponse?: (res: StartResponse | undefined) => void
) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id) return;
    const msg = { type, tabId: tab.id, url: tab.url, ...payload };
    if (onResponse) {
      chrome.runtime.sendMessage(msg, onResponse);
    } else {
      chrome.runtime.sendMessage(msg);
    }
  });
}

const REASON_MESSAGE: Record<string, string> = {
  'no-account': 'No active subscription. Contact the admin for access.',
  expired: 'Your subscription has expired. Contact the admin to renew.',
  'device-limit': 'This device isn’t registered. Open the panel to free a device seat.',
};

// Owns the live timer view: polls the service worker once a second for the
// authoritative timer state and exposes start/stop/reset commands. The caller
// supplies the START_TIMER payload (built from settings).
export function useTimer() {
  const [timeLeft, setTimeLeft] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [cycleCount, setCycleCount] = useState(0);
  const [activeUrl, setActiveUrl] = useState('');
  const [nextFireTime, setNextFireTime] = useState<number | null>(null);

  const refresh = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'GET_TIMER_STATE' }, (state: TimerState | undefined) => {
      if (!state) return;
      setIsRunning(state.running);
      setCycleCount(state.cycleCount || 0);
      setActiveUrl(state.url || '');
      if (state.nextFireTime) {
        setTimeLeft(Math.max(0, Math.ceil((state.nextFireTime - Date.now()) / 1000)));
        setNextFireTime(state.nextFireTime);
      } else {
        setTimeLeft(0);
        setNextFireTime(null);
      }
    });
  }, []);

  useEffect(() => {
    const interval = setInterval(refresh, 1000);
    return () => clearInterval(interval);
  }, [refresh]);

  const start = (payload: StartTimerPayload) => {
    setTimeLeft(payload.seconds);
    setIsRunning(true);
    setCycleCount(0);
    sendBackgroundCommand('START_TIMER', payload, (res) => {
      if (res && !res.ok) {
        // Worker refused (subscription/device gate) — revert optimistic state.
        setIsRunning(false);
        setTimeLeft(0);
        alert(REASON_MESSAGE[res.reason ?? ''] ?? 'Cannot start — subscription or device check failed.');
      }
    });
  };

  const stop = () => {
    setIsRunning(false);
    setTimeLeft(0);
    sendBackgroundCommand('STOP_TIMER');
  };

  const reset = () => {
    setIsRunning(false);
    setTimeLeft(0);
    setCycleCount(0);
    sendBackgroundCommand('STOP_TIMER');
  };

  return { timeLeft, isRunning, cycleCount, activeUrl, nextFireTime, start, stop, reset };
}
