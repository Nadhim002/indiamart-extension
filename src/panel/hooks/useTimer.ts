import { useState, useEffect, useCallback } from 'react';
import type { BackgroundCommandType, StartTimerPayload, TimerState } from '@/types';

// Sends a command to the service worker, tagged with the active tab. START_TIMER
// carries the timer payload; STOP_TIMER carries nothing extra.
function sendBackgroundCommand(type: BackgroundCommandType, payload: Partial<StartTimerPayload> = {}) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id) return;
    chrome.runtime.sendMessage({ type, tabId: tab.id, url: tab.url, ...payload });
  });
}

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
    sendBackgroundCommand('START_TIMER', payload);
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
