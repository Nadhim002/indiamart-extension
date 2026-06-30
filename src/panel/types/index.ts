export interface LeadFilters {
  minPrice: number | null;
  minQuantity: number | null;
  minTimePassed: number | null;
  states: string[] | null;
  includeKeywords: string[] | null;
  excludeKeywords: string[] | null;
}

export interface ExtensionSettings {
  inputSeconds?: string;
  minPrice?: string;
  minQuantity?: string;
  minTimePassed?: string;
  selectedStates?: string[];
  includeKeywords?: string[];
  excludeKeywords?: string[];
  phoneNumber?: string;
  testMode?: boolean;
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
  reasons?: string;
  filtersAtFirstSeen?: LeadFiltersAtFirstSeen;
}

export type BackgroundCommandType = 'START_TIMER' | 'STOP_TIMER';

export interface StartTimerPayload {
  seconds: number;
  filters: LeadFilters;
  phoneNumber: string;
  testMode: boolean;
}
