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
  // Opt-in: the cap only applies while `maxLeadsPerDayEnabled` is on. Off by
  // default so existing installs keep unlimited buying until the user
  // explicitly turns it on. The number itself is preserved when toggled off,
  // so re-enabling restores the previous value.
  const [maxLeadsPerDayEnabled, setMaxLeadsPerDayEnabled] = useState(false);
  // Blank means unlimited. Once set, callers clamp it to >= 1 (see
  // TimerControls' stepper and buildStartPayload below).
  const [maxLeadsPerDay, setMaxLeadsPerDay] = useState('');
  // Default OFF for purchasing: `testMode` true means notify-only (no buying).
  // Buying is an explicit opt-in the user must enable each install.
  const [testMode, setTestMode] = useState(true);
  // Selected states -> cities ticked under each. Empty array = whole state.
  // Replaces the old independent selectedStates/selectedCities arrays, which
  // allowed picking a city under a state that wasn't selected — a combination
  // that matched no leads. See migration in the load effect below.
  const [stateCities, setStateCitiesState] = useState<Record<string, string[]>>({});
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
      if (saved.stateCities !== undefined) {
        setStateCitiesState(saved.stateCities);
      } else if (saved.selectedStates !== undefined) {
        // Migrate silently from the old flat shape. selectedCities is
        // discarded — it carried no state, so there's no safe way to know
        // which state(s) it belonged to. Each previously selected state
        // becomes a whole-state match until the user re-picks cities.
        setStateCitiesState(Object.fromEntries(saved.selectedStates.map((state) => [state, []])));
      }
      if (saved.includeKeywords !== undefined) setIncludeKeywords(saved.includeKeywords);
      if (saved.excludeKeywords !== undefined) setExcludeKeywords(saved.excludeKeywords);
      if (saved.phoneNumber !== undefined) setPhoneNumber(saved.phoneNumber);
      if (saved.testMode !== undefined) setTestMode(saved.testMode);
      if (saved.maxLeadsPerDayEnabled !== undefined) setMaxLeadsPerDayEnabled(saved.maxLeadsPerDayEnabled);
      if (saved.maxLeadsPerDay !== undefined) setMaxLeadsPerDay(saved.maxLeadsPerDay);
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
      stateCities,
      includeKeywords,
      excludeKeywords,
      phoneNumber,
      testMode,
      maxLeadsPerDayEnabled,
      maxLeadsPerDay,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [inputSeconds, minPrice, minQuantity, minTimePassed, stateCities, includeKeywords, excludeKeywords, phoneNumber, testMode, maxLeadsPerDayEnabled, maxLeadsPerDay]);

  // Mirror the start payload into chrome.storage.local so the service worker
  // (no localStorage access) has an up-to-date copy to use for auto-start,
  // even when the panel isn't open.
  useEffect(() => {
    if (!loadedRef.current) return;
    chrome.storage.local.set({ autoStartPayload: buildStartPayload() });
  }, [inputSeconds, minPrice, minQuantity, minTimePassed, stateCities, includeKeywords, excludeKeywords, phoneNumber, testMode, maxLeadsPerDayEnabled, maxLeadsPerDay]);

  const toggleStateSelection = (state: string) => {
    setStateCitiesState((current) => {
      if (state in current) {
        // Deselecting a state forgets its city picks immediately — there is
        // nowhere for a city to be stored without its state, which is what
        // keeps an orphan city selection structurally impossible.
        const { [state]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [state]: [] };
    });
  };

  const toggleCitySelection = (state: string, city: string) => {
    setStateCitiesState((current) => {
      const cities = current[state] ?? [];
      const nextCities = cities.includes(city) ? cities.filter((value) => value !== city) : [...cities, city];
      return { ...current, [state]: nextCities };
    });
  };

  // Backs the "All" / "None" links in the nested city list.
  const setStateCities = (state: string, cities: string[]) => {
    setStateCitiesState((current) => ({ ...current, [state]: cities }));
  };

  // Build the START_TIMER payload from the current settings, or null if the
  // interval is not a positive number.
  const buildStartPayload = (): StartTimerPayload | null => {
    const seconds = parseInt(inputSeconds, 10) || 0;
    if (seconds <= 0) return null;
    const minPriceValue = minPrice.trim() ? Number(minPrice) : null;
    const minQuantityValue = minQuantity.trim() ? Number(minQuantity) : null;
    const minTimePassedValue = minTimePassed.trim() ? Number(minTimePassed) : null;
    // 0 (or blank) means "no minimum" — otherwise a 0 threshold would reject
    // every lead whose price/quantity is unknown (null), since null fails the
    // `>= 0` check. Mirrors the Min-age filter, which is only active when > 0.
    const filters: LeadFilters = {
      minPrice: minPriceValue != null && Number.isFinite(minPriceValue) && minPriceValue > 0 ? minPriceValue : null,
      minQuantity: minQuantityValue != null && Number.isFinite(minQuantityValue) && minQuantityValue > 0 ? minQuantityValue : null,
      minTimePassed: minTimePassedValue != null && Number.isFinite(minTimePassedValue) ? minTimePassedValue : null,
      stateCities: Object.keys(stateCities).length ? stateCities : null,
      includeKeywords: includeKeywords.length ? includeKeywords : null,
      excludeKeywords: excludeKeywords.length ? excludeKeywords : null,
    };
    // Only apply the cap when the user has opted in; the number itself stays
    // clamped to >= 1 so a stray "0" never silently blocks all purchases.
    const maxLeadsPerDayValue = maxLeadsPerDayEnabled && maxLeadsPerDay.trim()
      ? Math.max(1, parseInt(maxLeadsPerDay, 10))
      : null;
    return { seconds, filters, phoneNumber, testMode, maxLeadsPerDay: maxLeadsPerDayValue };
  };

  return {
    inputSeconds, setInputSeconds,
    minPrice, setMinPrice,
    minQuantity, setMinQuantity,
    minTimePassed, setMinTimePassed,
    phoneNumber, setPhoneNumber,
    testMode, setTestMode,
    maxLeadsPerDayEnabled, setMaxLeadsPerDayEnabled,
    maxLeadsPerDay, setMaxLeadsPerDay,
    stateCities, toggleStateSelection, toggleCitySelection, setStateCities,
    includeKeywords, setIncludeKeywords,
    excludeKeywords, setExcludeKeywords,
    buildStartPayload,
  };
}
