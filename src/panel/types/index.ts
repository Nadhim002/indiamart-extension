// LeadFilters is defined once in the shared seam and re-exported here so the
// panel's existing `@/types` imports keep working.
import type { LeadFilters } from '@shared/types';
export type { LeadFilters };

export interface ExtensionSettings {
  inputSeconds?: string;
  minPrice?: string;
  minQuantity?: string;
  minTimePassed?: string;
  selectedStates?: string[];
  selectedCities?: string[];
  includeKeywords?: string[];
  excludeKeywords?: string[];
  phoneNumber?: string;
  testMode?: boolean;
  maxLeadsPerDayEnabled?: boolean;
  maxLeadsPerDay?: string;
}

export interface TimerState {
  running: boolean;
  cycleCount?: number;
  url?: string;
  nextFireTime?: number;
}

export interface DeviceRecord {
  fcmToken?: string;
  notificationStyle?: string;
}

export interface LeadFiltersAtFirstSeen {
  minPrice?: number | null;
  minQuantity?: number | null;
  minTimePassed?: number | null;
  states?: string[];
  cities?: string[];
  includeKeywords?: string[];
  excludeKeywords?: string[];
}

export interface LeadRecord {
  ETO_OFR_ID: string | number;
  ETO_OFR_TITLE?: string;
  ETO_OFR_APPROX_ORDER_VALUE?: string | number;
  quantity?: string | number;
  BLDATETIME?: string | number;
  GLUSR_CITY?: string;
  GLUSR_STATE?: string;
  FK_GLCAT_MCAT_ID?: string | number;
  firstSeenDate?: string;
  firstSeenTime?: string;
  // Epoch ms — added in IndexedDB v2. Absent on pre-migration rows that
  // haven't been backfilled yet.
  firstSeenAtMs?: number;
  reasons?: string;
  filtersAtFirstSeen?: LeadFiltersAtFirstSeen;
  // 0 = not yet synced to the Drive history sheet; otherwise the epoch ms of
  // the sync that wrote this row. See DriveSyncState below.
  syncedAt?: number;
}

export type DriveSyncStatus = 'idle' | 'syncing' | 'error';

export interface DriveSyncState {
  status: DriveSyncStatus;
  lastDriveSyncAt: number | null;
  unsyncedCount: number | null;
  historySpreadsheetId: string | null;
  historySpreadsheetUrl: string | null;
  // Null until the first sync creates the sheet — "not connected yet" is a
  // normal state, not an error, and the panel says so explicitly.
  historySpreadsheetName: string | null;
  error: string | null;
}

export type BackgroundCommandType = 'START_TIMER' | 'STOP_TIMER';

export interface StartTimerPayload {
  seconds: number;
  filters: LeadFilters;
  phoneNumber: string;
  testMode: boolean;
  maxLeadsPerDay: number | null;
}
