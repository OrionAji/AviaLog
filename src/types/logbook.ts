export type FlightSource = 'manual' | 'google_sheets' | 'appsheet_csv' | 'imported_sheet' | 'photo_scan';

export type EngineCategory = 'SINGLE ENGINE' | 'JET ENGINE' | 'MULTI ENGINE' | 'SIMULATOR';

export type FlightRoleType = 'DUAL' | 'SOLO' | 'PIC' | 'SIMULATOR';

export interface FlightEntry {
  id: string;
  date: string; // YYYY-MM-DD
  aircraftType: string; // e.g., A-JET, L-39ZA, K8-E, SMK, DA-40, DA-40 FSTD
  aircraftMark: string; // Optional tail / mark / registration
  engineCategory: EngineCategory;
  instructor: string;
  exercise: string; // e.g., ARMED RECCE, FORMATION, NAVIGATION
  flightType: FlightRoleType; // DUAL | SOLO | PIC | SIMULATOR
  sortie?: string; // Optional sortie number / identifier from Flights tab
  departure?: string;
  arrival?: string;
  route?: string;
  totalMinutes: number; // Exact flight duration in minutes (e.g., 1:20 = 80)
  dualMinutes: number;
  soloMinutes: number; // PIC / Solo
  nightMinutes: number;
  instrumentMinutes: number;
  simulatorMinutes: number;
  takeoffs: number;
  landings: number;
  approaches: number;
  remarks: string;
  source: FlightSource;
  sheetRowNumber?: number;
  customFields?: Record<string, string>;
}

export interface AircraftRecord {
  type: string; // e.g., A-JET, K8-E, L-39ZA, SMK, DA-40, DA-40 FSTD
  fullName: string;
  engineCategory: EngineCategory;
  role: string;
  marks?: string[]; // Known airframe marks / tail numbers for this type
  notes?: string;
  source: FlightSource;
}

export interface BroughtForwardAircraft {
  aircraftType: string;
  engineCategory: EngineCategory;
  flights: number;
  takeoffs: number;
  landings: number;
  totalMinutes: number;
}

export interface BroughtForwardYear {
  year: number;
  flights: number;
  landings: number;
  dualMinutes: number;
  soloMinutes: number;
}

/**
 * Preserves exact historical summary totals brought forward from Pilot AJI's Dashboard sheet
 * (representing the earlier rows on the Flights tab not shown in the 10-row Recent Flights view).
 * Automatically cleared to null when the user imports the complete Flights tab in Replace mode.
 */
export interface BroughtForwardBaseline {
  pilotName: string;
  firstFlightDate: string; // YYYY-MM-DD
  label: string;
  flights: number; // excl. simulator
  takeoffs: number; // excl. simulator
  landings: number; // excl. simulator
  totalMinutes: number; // excl. simulator
  dualMinutes: number;
  soloMinutes: number;
  jetMinutes: number;
  nightMinutes: number;
  instrumentMinutes: number;
  approaches: number;
  simulatorMinutes: number;
  simulatorFlights: number;
  simulatorTakeoffs: number;
  simulatorLandings: number;
  byAircraft: BroughtForwardAircraft[];
  byYear: BroughtForwardYear[];
}

export type CanonicalFlightField =
  | 'date'
  | 'aircraftType'
  | 'aircraftMark'
  | 'engineCategory'
  | 'instructor'
  | 'exercise'
  | 'flightType'
  | 'sortie'
  | 'departure'
  | 'arrival'
  | 'totalTime'
  | 'dualTime'
  | 'soloTime'
  | 'nightTime'
  | 'instrumentTime'
  | 'simulatorTime'
  | 'takeoffs'
  | 'landings'
  | 'approaches'
  | 'remarks';

export type ColumnMapping = Record<number, CanonicalFlightField | 'custom' | 'ignore'>;

export interface ConnectedSheetConfig {
  spreadsheetId: string;
  spreadsheetTitle: string;
  sheetName: string;
  headers: string[];
  mapping: ColumnMapping;
  lastSyncedAt: string;
  rowCount: number;
  appSheetDetected: boolean;
}

export interface LogbookTotals {
  flightCount: number; // excl. simulator
  flightCountInclSim: number;
  takeoffs: number; // excl. simulator
  takeoffsInclSim: number;
  landings: number; // excl. simulator
  landingsInclSim: number;
  totalMinutes: number; // excl. simulator
  totalMinutesInclSim: number;
  dualMinutes: number;
  soloMinutes: number;
  jetMinutes: number;
  nightMinutes: number;
  instrumentMinutes: number;
  simulatorMinutes: number;
  approaches: number;
  firstFlightDate: string | null;
  lastFlightDate: string | null;
  daysSinceLastFlight: number | null;
}

export interface YearlyHoursSummary {
  year: number;
  flights: number;
  landings: number;
  dualMinutes: number;
  soloMinutes: number;
  totalMinutes: number;
  dualHoursChart: number;
  soloHoursChart: number;
  totalHoursChart: number;
}

export interface AircraftHoursSummary {
  aircraftType: string;
  engineCategory: EngineCategory;
  flights: number;
  takeoffs: number;
  landings: number;
  totalMinutes: number;
  hoursChart: number;
  lastFlown: string | null;
  marks: string[];
}

export interface AircraftMarkSummary {
  aircraftMark: string;
  aircraftType: string;
  engineCategory: EngineCategory;
  flights: number;
  takeoffs: number;
  landings: number;
  totalMinutes: number;
  lastFlown: string | null;
}

export interface MonthlyFlightGroup {
  monthKey: string; // YYYY-MM or 'undated'
  label: string; // e.g., "November 2026"
  flights: FlightEntry[];
  flightCount: number; // live flights excl. simulator
  flightCountInclSim: number;
  takeoffs: number;
  landings: number;
  totalMinutes: number; // live flight minutes excl. simulator
  totalMinutesInclSim: number;
  dualMinutes: number;
  soloMinutes: number;
  nightMinutes: number;
  instrumentMinutes: number;
  simulatorMinutes: number;
  approaches: number;
}

export interface AppSheetSchemaField {
  name: string;
  appSheetType: string;
  mappedTo: CanonicalFlightField | 'custom' | 'ignore';
  isVirtual: boolean;
}

export type ActiveNavSection = 'overview' | 'logbook' | 'import' | 'fleet';
