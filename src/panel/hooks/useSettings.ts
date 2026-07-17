import { useState, useEffect, useRef } from 'react';
import type { ExtensionSettings, LeadFilters, StartTimerPayload } from '@/types';

const STORAGE_KEY = 'im-extension-settings';

// Owns the dashboard's persisted settings: loads them from localStorage on
// mount and writes them back on every change. Also knows how to turn the
// current settings into a START_TIMER payload, so the timer hook never has to
// reach into individual fields.
export function useSettings() {
  const [inputSeconds, setInputSeconds] = useState('3');
  const [minPrice, setMinPrice] = useState('');
  const [minQuantity, setMinQuantity] = useState('');
  const [minTimePassed, setMinTimePassed] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  // Default OFF for purchasing: `testMode` true means notify-only (no buying).
  // Buying is an explicit opt-in the user must enable each install.
  const [testMode, setTestMode] = useState(true);
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [includeKeywords, setIncludeKeywords] = useState<string[]>([]);
  const [excludeKeywords, setExcludeKeywords] = useState<string[]>([]);

  const loadedRef = useRef(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as ExtensionSettings;
      if (saved.inputSeconds !== undefined) setInputSeconds(saved.inputSeconds);
      if (saved.minPrice !== undefined) setMinPrice(saved.minPrice);
      if (saved.minQuantity !== undefined) setMinQuantity(saved.minQuantity);
      if (saved.minTimePassed !== undefined) setMinTimePassed(saved.minTimePassed);
      if (saved.selectedStates !== undefined) setSelectedStates(saved.selectedStates);
      if (saved.includeKeywords !== undefined) setIncludeKeywords(saved.includeKeywords);
      if (saved.excludeKeywords !== undefined) setExcludeKeywords(saved.excludeKeywords);
      if (saved.phoneNumber !== undefined) setPhoneNumber(saved.phoneNumber);
      if (saved.testMode !== undefined) setTestMode(saved.testMode);
    } catch {
      // ignore malformed settings
    }
    loadedRef.current = true;
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    const settings: ExtensionSettings = {
      inputSeconds,
      minPrice,
      minQuantity,
      minTimePassed,
      selectedStates,
      includeKeywords,
      excludeKeywords,
      phoneNumber,
      testMode,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [inputSeconds, minPrice, minQuantity, minTimePassed, selectedStates, includeKeywords, excludeKeywords, phoneNumber, testMode]);

  const toggleStateSelection = (state: string) => {
    setSelectedStates((current) =>
      current.includes(state) ? current.filter((value) => value !== state) : [...current, state]
    );
  };

  // Build the START_TIMER payload from the current settings, or null if the
  // interval is not a positive number.
  const buildStartPayload = (): StartTimerPayload | null => {
    const seconds = parseInt(inputSeconds, 10) || 0;
    if (seconds <= 0) return null;
    const minPriceValue = minPrice.trim() ? Number(minPrice) : null;
    const minQuantityValue = minQuantity.trim() ? Number(minQuantity) : null;
    const minTimePassedValue = minTimePassed.trim() ? Number(minTimePassed) : null;
    const filters: LeadFilters = {
      minPrice: minPriceValue != null && Number.isFinite(minPriceValue) ? minPriceValue : null,
      minQuantity: minQuantityValue != null && Number.isFinite(minQuantityValue) ? minQuantityValue : null,
      minTimePassed: minTimePassedValue != null && Number.isFinite(minTimePassedValue) ? minTimePassedValue : null,
      states: selectedStates.length ? selectedStates : null,
      includeKeywords: includeKeywords.length ? includeKeywords : null,
      excludeKeywords: excludeKeywords.length ? excludeKeywords : null,
    };
    return { seconds, filters, phoneNumber, testMode };
  };

  return {
    inputSeconds, setInputSeconds,
    minPrice, setMinPrice,
    minQuantity, setMinQuantity,
    minTimePassed, setMinTimePassed,
    phoneNumber, setPhoneNumber,
    testMode, setTestMode,
    selectedStates, setSelectedStates, toggleStateSelection,
    includeKeywords, setIncludeKeywords,
    excludeKeywords, setExcludeKeywords,
    buildStartPayload,
  };
}
