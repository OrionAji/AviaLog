import type {
  AppSheetSchemaField,
  CanonicalFlightField,
  ColumnMapping,
  ConnectedSheetConfig,
  EngineCategory,
  FlightEntry,
  FlightRoleType,
  FlightSource,
} from '../types/logbook';
import {
  formatHHMM,
  formatShortSheetDate,
  inferEngineCategory,
  normalizeDateString,
  parseDurationToMinutes,
  parseInteger,
} from './flightMath';

export interface FieldMeta {
  key: CanonicalFlightField;
  label: string;
  group: 'Core' | 'Hours (HH:MM)' | 'Ops & IFR';
}

export const CANONICAL_FIELDS: FieldMeta[] = [
  { key: 'date', label: 'Flight Date', group: 'Core' },
  { key: 'aircraftType', label: 'Aircraft Type (A-JET, K8-E...)', group: 'Core' },
  { key: 'aircraftMark', label: 'Mark (Aircraft Mark)', group: 'Core' },
  { key: 'engineCategory', label: 'Engine Class', group: 'Core' },
  { key: 'departure', label: 'From (Departure)', group: 'Core' },
  { key: 'arrival', label: 'To (Arrival)', group: 'Core' },
  { key: 'instructor', label: 'Instructor / Captain', group: 'Core' },
  { key: 'sortie', label: 'Sortie (Sortie Ref)', group: 'Core' },
  { key: 'exercise', label: 'Exercise / Mission', group: 'Core' },
  { key: 'flightType', label: 'Type (DUAL / SOLO / SIM)', group: 'Core' },
  { key: 'totalTime', label: 'Time / Total Duration', group: 'Hours (HH:MM)' },
  { key: 'dualTime', label: 'Dual Time', group: 'Hours (HH:MM)' },
  { key: 'soloTime', label: 'PIC / Solo Time', group: 'Hours (HH:MM)' },
  { key: 'nightTime', label: 'Night Time', group: 'Hours (HH:MM)' },
  { key: 'instrumentTime', label: 'Instrument Time', group: 'Hours (HH:MM)' },
  { key: 'simulatorTime', label: 'Simulator Time', group: 'Hours (HH:MM)' },
  { key: 'takeoffs', label: 'Take-offs', group: 'Ops & IFR' },
  { key: 'landings', label: 'Landings', group: 'Ops & IFR' },
  { key: 'approaches', label: 'Inst. Approaches', group: 'Ops & IFR' },
  { key: 'remarks', label: 'Remarks / Notes', group: 'Ops & IFR' },
];

export function extractSpreadsheetId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]{15,})/);
  if (urlMatch) return urlMatch[1];

  const keyParamMatch = trimmed.match(/[?&](?:id|key)=([a-zA-Z0-9-_]{15,})/);
  if (keyParamMatch) return keyParamMatch[1];

  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export function parseDelimitedText(text: string): string[][] {
  const cleaned = text.replace(/^\uFEFF/, '').trim();
  if (!cleaned) return [];

  const firstLine = cleaned.split(/\r?\n/)[0] ?? '';
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;

  let delimiter = ',';
  if (tabCount > commaCount && tabCount >= semiCount) {
    delimiter = '\t';
  } else if (semiCount > commaCount && commaCount === 0) {
    delimiter = ';';
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    const next = cleaned[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\r' && next === '\n') {
      row.push(cell.trim());
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
      cell = '';
      i++;
    } else if (ch === '\n' || ch === '\r') {
      row.push(cell.trim());
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  row.push(cell.trim());
  if (row.some((v) => v !== '')) rows.push(row);

  return rows;
}

/**
 * Detects whether a pasted/uploaded CSV is the Dashboard summary tab (like Pilot_Logbook_AppSheet)
 * rather than the raw Flights table tab.
 */
export function isDashboardSummaryCsv(rows: string[][]): boolean {
  const joined = rows
    .slice(0, 12)
    .map((r) => r.join(' '))
    .join('\n')
    .toUpperCase();
  return (
    joined.includes('PILOT FLIGHT LOGBOOK') &&
    (joined.includes('TOTAL FLIGHT HOURS') || joined.includes('HOURS BY AIRCRAFT TYPE'))
  );
}

function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/#/g, ' no ')
    .replace(/[_\-/.():*,&[\]'"–—→;?+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const COMBINED_ROUTE_HEADER_PATTERN =
  /^(route|routing|sector|from\s+to|dep(arture)?\s+arr(ival)?|origin\s+dest(ination)?|airfields)$/;

export function splitCombinedRoute(raw: string): { departure?: string; arrival?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  const parts = trimmed
    .split(/\s*(?:->|→|=>|\/|\bto\b)\s*|\s+[–—-]\s+/i)
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean);
  if (parts.length >= 2) {
    return {
      departure: parts[0],
      arrival: parts[parts.length - 1],
    };
  }
  const compactMatch = trimmed.match(/^([A-Za-z0-9]{2,6})\s*[-–—]\s*([A-Za-z0-9]{2,6})$/);
  if (compactMatch) {
    return {
      departure: compactMatch[1].toUpperCase(),
      arrival: compactMatch[2].toUpperCase(),
    };
  }
  return {};
}

const PRIMARY_HEADER_RULES: Array<{ field: CanonicalFlightField; patterns: RegExp[] }> = [
  { field: 'date', patterns: [/^date$/, /^flight date$/, /^flt date$/, /^log date$/] },
  {
    field: 'aircraftType',
    patterns: [/^aircraft$/, /^aircraft type$/, /^acft type$/, /^make.*model$/, /^model$/],
  },
  {
    field: 'aircraftMark',
    patterns: [
      /^aircraft\s*mark(s)?$/,
      /^a\s*c\s*mark(s)?$/,
      /^acft\s*mark(s)?$/,
      /^mark(s)?$/,
      /^mk(s)?$/,
      /^aircraft\s*mk(s)?$/,
      /^a\s*c\s*mk(s)?$/,
      /^acft\s*mk(s)?$/,
      /^mark\s*(no|num|number|id|reg|tail)$/,
      /\baircraft\s*mark(s)?\b/,
      /\bmark(s)?\b/,
    ],
  },
  { field: 'engineCategory', patterns: [/^engine$/, /^engine type$/, /^engine class$/] },
  {
    field: 'sortie',
    patterns: [
      /^sortie\s*ref(erence)?(\s*(no|num|number|id|name|code|label|title))?$/,
      /\bsortie\s*ref(erence)?\b/,
    ],
  },
  { field: 'instructor', patterns: [/^instructor$/, /^captain$/, /instructor/, /captain/, /cfi/] },
  { field: 'exercise', patterns: [/^exercise$/, /^mission$/, /exercise/] },
  { field: 'flightType', patterns: [/^type$/, /^flight type$/, /^duty$/, /^role$/] },
  {
    field: 'departure',
    patterns: [
      /^from$/,
      /^from\s*(airfield|airport|base|icao|iata|loc(ation)?|place|station|point|dep(arture)?)$/,
      /^(airfield|airport|base|place|station|point|dep(arture)?|origin)\s*(of\s*)?from$/,
      /^dep(t|art|arture)?$/,
      /^dep(arture)?\s*(airfield|airport|base|icao|iata|loc(ation)?|place|station|point|from)$/,
      /^(place|point|airfield|airport|base)\s*(of\s*)?dep(arture)?$/,
      /^origin(\s*(airfield|airport|base|icao|iata|loc(ation)?|place|station|point))?$/,
    ],
  },
  {
    field: 'arrival',
    patterns: [
      /^to$/,
      /^to\s*(airfield|airport|base|icao|iata|loc(ation)?|place|station|point|arr(ival)?|dest(ination)?)$/,
      /^(airfield|airport|base|place|station|point|fly|arr(ival)?|dest(ination)?)\s+to$/,
      /^arr(ive|ival)?$/,
      /^arr(ival)?\s*(airfield|airport|base|icao|iata|loc(ation)?|place|station|point|to)$/,
      /^(place|point|airfield|airport|base)\s*(of\s*)?arr(ival)?$/,
      /^dest(ination)?(\s*(airfield|airport|base|icao|iata|loc(ation)?|place|station|point))?$/,
    ],
  },
  {
    field: 'totalTime',
    patterns: [/^time$/, /^total time$/, /^flight time$/, /^block time$/, /^duration$/, /^hours$/, /^hrs$/],
  },
  { field: 'dualTime', patterns: [/^dual$/, /dual/, /instruction/] },
  { field: 'soloTime', patterns: [/^solo$/, /^pic$/, /pilot in command/, /^p1$/] },
  { field: 'nightTime', patterns: [/^night$/, /night time/, /night hrs/] },
  { field: 'instrumentTime', patterns: [/^instrument$/, /instrument/, /^ifr$/, /^imc$/, /hood/] },
  { field: 'simulatorTime', patterns: [/^sim(ulator)?$/, /fstd/] },
  { field: 'takeoffs', patterns: [/take ?off/, /^t o$/, /^to count$/] },
  { field: 'landings', patterns: [/landing/, /^ldg/] },
  { field: 'approaches', patterns: [/approach/, /^inst app/, /^app$/] },
  { field: 'remarks', patterns: [/remark/, /comment/, /note/, /description/] },
];

const FALLBACK_HEADER_RULES: Array<{ field: CanonicalFlightField; patterns: RegExp[] }> = [
  { field: 'date', patterns: [/^day$/, /date/] },
  {
    field: 'aircraftMark',
    patterns: [
      /aircraft\s*(no|num|number|id|reg|serial)/,
      /a\s*c\s*(no|num|number|id|reg|serial|mk)/,
      /acft\s*(no|num|number|id|reg|serial|mk)/,
      /tail/,
      /reg(istration)?/,
      /airframe/,
      /\bnaf\s*(no|num|number)?\b/,
      /\bside\s*(no|num|number)\b/,
      /callsign/,
      /^ident$/,
      /^variant$/,
      /\bmk(s)?\b/,
    ],
  },
  { field: 'engineCategory', patterns: [/engine/] },
  {
    field: 'sortie',
    patterns: [
      /^sortie\s*(name|code|no|num|number|type|count|seq)$/,
      /^sortie(s)?$/,
      /^(no|num|number)\s*(of\s*)?sortie(s)?$/,
      /^flt\s*(no|num|number|ref)$/,
      /^flight\s*(no|num|number|ref)$/,
      /^mission\s*(no|num|number|ref)$/,
      /\bsortie(s)?\b/,
    ],
  },
  { field: 'instructor', patterns: [/pilot in charge/, /crew/] },
  { field: 'exercise', patterns: [/mission/, /detail/, /maneuver/] },
  { field: 'flightType', patterns: [/dual.*solo/] },
  { field: 'departure', patterns: [/^from\b/, /^dep(t|art)?\b/, /\borigin\b/] },
  { field: 'arrival', patterns: [/^to\b/, /^arr(ive|ival)?\b/, /\bdest(ination)?\b/] },
  { field: 'totalTime', patterns: [/total.*hrs/, /flight.*hrs/] },
];

const APPSHEET_SYSTEM_HEADERS = new Set([
  '_rownumber',
  'row id',
  'rowid',
  'row key',
  'uniqueid',
  '_computedkey',
]);

const ROW_INDEX_HEADER_PATTERN = /^(s\s*n|s\s*no|sr\s*no|serial(\s*no|\s*number)?|no|index|row(\s*no|\s*num|\s*number)?)$/;

const IGNORED_ID_HEADER_PATTERN =
  /^(id|key|uuid|guid|row\s*(id|key)|flight\s*(id|key)|flt\s*(id|key)|log\s*(id|key)|entry\s*(id|key)|record\s*(id|key)|unique\s*id)$/;

const UUID_VALUE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isLikelyAppSheetUniqueId(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (UUID_VALUE_PATTERN.test(trimmed)) return true;
  // AppSheet UNIQUEID() generates 8-char lowercase hex hashes containing both digits and a-f
  return /^[0-9a-f]{8}$/.test(trimmed) && /[0-9]/.test(trimmed) && /[a-f]/.test(trimmed);
}

export function detectAppSheetHeaders(headers: string[]): boolean {
  return headers.some((h) => {
    const clean = h.trim().toLowerCase();
    return (
      APPSHEET_SYSTEM_HEADERS.has(clean) ||
      IGNORED_ID_HEADER_PATTERN.test(normalizeHeader(h)) ||
      clean.startsWith('_computed') ||
      clean.includes('_id') ||
      clean.startsWith('related ')
    );
  });
}

function headerMatchesField(normHeader: string, field: CanonicalFlightField): boolean {
  if (
    !normHeader ||
    IGNORED_ID_HEADER_PATTERN.test(normHeader) ||
    COMBINED_ROUTE_HEADER_PATTERN.test(normHeader)
  ) {
    return false;
  }
  const primary = PRIMARY_HEADER_RULES.find((r) => r.field === field);
  if (primary?.patterns.some((re) => re.test(normHeader))) return true;
  const fallback = FALLBACK_HEADER_RULES.find((r) => r.field === field);
  return Boolean(fallback?.patterns.some((re) => re.test(normHeader)));
}

const PLACEHOLDER_SORTIE_PATTERN =
  /^(sortie(s)?|sortie\s*ref(erence)?|n\/?a|none|-+|—+)$/i;

export function isPlaceholderSortieValue(value: string | undefined | null): boolean {
  const cleaned = String(value ?? '').trim();
  if (!cleaned) return true;
  return PLACEHOLDER_SORTIE_PATTERN.test(cleaned);
}

function columnHasData(
  rows: string[][],
  colIdx: number,
  field?: CanonicalFlightField
): boolean {
  for (let i = 0; i < rows.length; i++) {
    const val = String(rows[i]?.[colIdx] ?? '').trim();
    if (!val) continue;
    if (field === 'sortie' && isPlaceholderSortieValue(val)) continue;
    return true;
  }
  return false;
}

export function autoDetectColumnMapping(
  headers: string[],
  sampleRows?: string[][]
): ColumnMapping {
  const mapping: ColumnMapping = {};
  const usedFields = new Set<CanonicalFlightField>();
  const normalizedHeaders = headers.map((h) => normalizeHeader(h));

  // Pre-mark empty, AppSheet system/ID, and row-counter columns as ignored
  headers.forEach((rawHeader, idx) => {
    const rawLower = rawHeader.trim().toLowerCase();
    const norm = normalizedHeaders[idx];
    if (
      !rawLower ||
      APPSHEET_SYSTEM_HEADERS.has(rawLower) ||
      IGNORED_ID_HEADER_PATTERN.test(norm) ||
      rawLower.startsWith('related ') ||
      ROW_INDEX_HEADER_PATTERN.test(norm)
    ) {
      mapping[idx] = 'ignore';
    } else if (COMBINED_ROUTE_HEADER_PATTERN.test(norm)) {
      // Keep combined Route / From-To columns as custom so mapRowsToFlights splits them into From & To
      mapping[idx] = 'custom';
    }
  });

  // Pass 1: High-confidence / exact headers (so "Aircraft Mark" / "Mark" and "Sortie Ref" always win)
  headers.forEach((_, idx) => {
    if (mapping[idx] !== undefined) return;
    const norm = normalizedHeaders[idx];
    for (const rule of PRIMARY_HEADER_RULES) {
      if (usedFields.has(rule.field)) continue;
      if (rule.patterns.some((re) => re.test(norm))) {
        mapping[idx] = rule.field;
        usedFields.add(rule.field);
        break;
      }
    }
  });

  // Pass 2: Secondary fallback headers for any unmapped canonical fields
  headers.forEach((_, idx) => {
    if (mapping[idx] !== undefined) return;
    const norm = normalizedHeaders[idx];
    for (const rule of FALLBACK_HEADER_RULES) {
      if (usedFields.has(rule.field)) continue;
      if (rule.patterns.some((re) => re.test(norm))) {
        mapping[idx] = rule.field;
        usedFields.add(rule.field);
        break;
      }
    }
    if (mapping[idx] === undefined) {
      mapping[idx] = 'custom';
    }
  });

  // Pass 3 (data-aware): If a mapped Mark, From, To, or Sortie column is completely empty in the
  // spreadsheet while another matching column actually has data (e.g. blank "Sortie Ref" + populated "Sortie"),
  // prefer the populated column so real spreadsheet values are always loaded.
  if (sampleRows && sampleRows.length > 0) {
    const preferredFields: CanonicalFlightField[] = [
      'aircraftMark',
      'departure',
      'arrival',
      'sortie',
    ];
    for (const field of preferredFields) {
      const currentEntry = Object.entries(mapping).find(([, f]) => f === field);
      if (!currentEntry) continue;
      const currentIdx = Number(currentEntry[0]);
      if (columnHasData(sampleRows, currentIdx, field)) continue;

      const populatedAltIdx = headers.findIndex(
        (_, idx) =>
          idx !== currentIdx &&
          mapping[idx] === 'custom' &&
          headerMatchesField(normalizedHeaders[idx], field) &&
          columnHasData(sampleRows, idx, field)
      );
      if (populatedAltIdx >= 0) {
        mapping[currentIdx] = 'custom';
        mapping[populatedAltIdx] = field;
      }
    }
  }

  return mapping;
}

/**
 * Finds the most likely column header row in the first 10 rows of a sheet/CSV
 * (handles sheets that have a title banner or blank row above the column headers).
 */
export function detectHeaderRowIndex(rows: string[][]): number {
  const scanLimit = Math.min(rows.length, 10);
  let bestIdx = 0;
  let bestScore = -1;

  for (let i = 0; i < scanLimit; i++) {
    const row = rows[i] ?? [];
    const cleaned = row.map((c) => String(c ?? '').trim());
    if (cleaned.every((c) => !c)) continue;
    const map = autoDetectColumnMapping(cleaned);
    const canonicalHits = Object.values(map).filter(
      (v) => v !== 'ignore' && v !== 'custom'
    ).length;
    if (canonicalHits > bestScore) {
      bestScore = canonicalHits;
      bestIdx = i;
    }
  }

  return bestScore >= 2 ? bestIdx : 0;
}

/**
 * Extracts column headers and data rows, also merging a 2-row grouped header
 * (e.g. Row 1: "Route", Row 2: "From" | "To" or Row 1: "Aircraft", Row 2: "Type" | "Mark").
 */
export function extractHeadersAndDataRows(rows: string[][]): {
  headers: string[];
  dataRows: string[][];
  startingSheetRow: number;
} {
  if (rows.length === 0) {
    return { headers: [], dataRows: [], startingSheetRow: 2 };
  }

  const headerIdx = detectHeaderRowIndex(rows);
  const primaryRow = (rows[headerIdx] ?? []).map((h) => String(h ?? '').trim());
  const nextRowRaw = rows[headerIdx + 1];

  if (nextRowRaw && rows.length > headerIdx + 2) {
    const nextRow = nextRowRaw.map((c) => String(c ?? '').trim());
    const primaryMap = autoDetectColumnMapping(primaryRow);
    const dateColIdx = Number(
      Object.entries(primaryMap).find(([, f]) => f === 'date')?.[0] ?? -1
    );
    const nextDateVal = dateColIdx >= 0 ? normalizeDateString(nextRow[dateColIdx] ?? '') : '';
    const hasDurationCell = nextRow.some((cell) => /^\d{1,3}:\d{2}(:\d{2})?$/.test(cell));
    const hasNumericOnlyCells = nextRow.some((cell) => /^\d+(\.\d+)?$/.test(cell));

    if (!nextDateVal && !hasDurationCell && !hasNumericOnlyCells) {
      const nextMap = autoDetectColumnMapping(nextRow);
      const nextCanonicalHits = Object.values(nextMap).filter(
        (v) => v !== 'ignore' && v !== 'custom'
      ).length;

      if (nextCanonicalHits >= 1) {
        const width = Math.max(primaryRow.length, nextRow.length);
        const mergedHeaders: string[] = [];
        for (let i = 0; i < width; i++) {
          const top = primaryRow[i] ?? '';
          const sub = nextRow[i] ?? '';
          if (!sub) {
            mergedHeaders.push(top);
          } else if (!top || COMBINED_ROUTE_HEADER_PATTERN.test(normalizeHeader(top))) {
            mergedHeaders.push(sub);
          } else {
            mergedHeaders.push(`${top} ${sub}`.trim());
          }
        }

        const primaryCanonicalCount = Object.values(primaryMap).filter(
          (v) => v !== 'ignore' && v !== 'custom'
        ).length;
        const mergedMap = autoDetectColumnMapping(mergedHeaders);
        const mergedCanonicalCount = Object.values(mergedMap).filter(
          (v) => v !== 'ignore' && v !== 'custom'
        ).length;

        if (mergedCanonicalCount > primaryCanonicalCount) {
          return {
            headers: mergedHeaders,
            dataRows: rows.slice(headerIdx + 2),
            startingSheetRow: headerIdx + 3,
          };
        }
      }
    }
  }

  return {
    headers: primaryRow,
    dataRows: rows.slice(headerIdx + 1),
    startingSheetRow: headerIdx + 2,
  };
}

const SORTIE_REF_CUSTOM_KEY_PATTERN =
  /^sortie\s*ref(erence)?(\s*(no|num|number|id|name|code|label|title))?$|\bsortie\s*ref(erence)?\b/i;

/**
 * Promotes any "Aircraft Mark" / "Mark" / "Mk" / "Tail No", "Sortie Ref" / "Sortie",
 * "From", "To", or combined "Route" values previously captured under customFields
 * into their canonical FlightEntry fields.
 * "Sortie Ref" always takes precedence over generic "Sortie" if present, and
 * literal placeholder values such as "Sortie" are never kept as a sortie name.
 */
export function backfillMarksFromCustomFields(flights: FlightEntry[]): {
  flights: FlightEntry[];
  updatedCount: number;
} {
  let updatedCount = 0;
  const next = flights.map((flight) => {
    const rawSortie = flight.sortie?.trim() || '';
    const customIdValues = new Set<string>();
    if (flight.customFields) {
      for (const [key, val] of Object.entries(flight.customFields)) {
        const cleaned = String(val ?? '').trim();
        if (!cleaned) continue;
        if (IGNORED_ID_HEADER_PATTERN.test(normalizeHeader(key))) {
          customIdValues.add(cleaned);
        }
      }
    }

    const hasInvalidSortie =
      Boolean(rawSortie) &&
      (isPlaceholderSortieValue(rawSortie) ||
        rawSortie === flight.id ||
        customIdValues.has(rawSortie) ||
        isLikelyAppSheetUniqueId(rawSortie));

    if (!flight.customFields && !hasInvalidSortie) return flight;

    let aircraftMark = flight.aircraftMark?.trim() || '';
    let sortie = hasInvalidSortie ? '' : rawSortie;
    let sortieFromRef = false;
    let departure = flight.departure?.trim() || '';
    let arrival = flight.arrival?.trim() || '';
    const keysToRemove: string[] = [];

    if (flight.customFields) {
      // Pass 1: Prioritize explicit "Sortie Ref" over any generic sortie value
      for (const [key, val] of Object.entries(flight.customFields)) {
        const cleaned = String(val ?? '').trim();
        if (!cleaned || isPlaceholderSortieValue(cleaned)) continue;
        const normKey = normalizeHeader(key);
        if (SORTIE_REF_CUSTOM_KEY_PATTERN.test(normKey)) {
          sortie = cleaned;
          sortieFromRef = true;
          keysToRemove.push(key);
          break;
        }
      }

      // Pass 2: Backfill remaining canonical fields when empty (never promoting Flight ID / system IDs)
      for (const [key, val] of Object.entries(flight.customFields)) {
        if (keysToRemove.includes(key)) continue;
        const cleaned = String(val ?? '').trim();
        if (!cleaned) continue;
        const normKey = normalizeHeader(key);
        if (IGNORED_ID_HEADER_PATTERN.test(normKey)) continue;
        if (!aircraftMark && headerMatchesField(normKey, 'aircraftMark')) {
          aircraftMark = cleaned;
          keysToRemove.push(key);
        } else if (
          !sortie &&
          !sortieFromRef &&
          headerMatchesField(normKey, 'sortie') &&
          !isPlaceholderSortieValue(cleaned) &&
          !customIdValues.has(cleaned) &&
          !isLikelyAppSheetUniqueId(cleaned)
        ) {
          sortie = cleaned;
          keysToRemove.push(key);
        } else if (!departure && headerMatchesField(normKey, 'departure')) {
          departure = cleaned.toUpperCase();
          keysToRemove.push(key);
        } else if (!arrival && headerMatchesField(normKey, 'arrival')) {
          arrival = cleaned.toUpperCase();
          keysToRemove.push(key);
        } else if ((!departure || !arrival) && COMBINED_ROUTE_HEADER_PATTERN.test(normKey)) {
          const split = splitCombinedRoute(cleaned);
          if (split.departure || split.arrival) {
            if (!departure && split.departure) departure = split.departure;
            if (!arrival && split.arrival) arrival = split.arrival;
            keysToRemove.push(key);
          }
        }
      }
    }

    if (keysToRemove.length === 0 && !hasInvalidSortie) return flight;
    updatedCount += 1;
    const remainingCustom = flight.customFields ? { ...flight.customFields } : undefined;
    if (remainingCustom) {
      for (const k of keysToRemove) {
        delete remainingCustom[k];
      }
    }
    return {
      ...flight,
      aircraftMark,
      sortie: sortie && !isPlaceholderSortieValue(sortie) ? sortie : undefined,
      departure: departure || undefined,
      arrival: arrival || undefined,
      customFields:
        remainingCustom && Object.keys(remainingCustom).length > 0 ? remainingCustom : undefined,
    };
  });

  return { flights: next, updatedCount };
}

export function upgradeConnectedSheetMapping(
  config: ConnectedSheetConfig | null
): ConnectedSheetConfig | null {
  if (!config || !config.headers?.length) return config;

  const auto = autoDetectColumnMapping(config.headers);
  const nextMapping: ColumnMapping = { ...config.mapping };
  let changed = false;

  // Unmap any AppSheet system/record ID column (e.g. "Flight ID") previously bound to 'sortie'
  for (const [idxStr, field] of Object.entries(nextMapping)) {
    if (field === 'sortie') {
      const norm = normalizeHeader(config.headers[Number(idxStr)] ?? '');
      if (IGNORED_ID_HEADER_PATTERN.test(norm)) {
        nextMapping[Number(idxStr)] = 'ignore';
        changed = true;
      }
    }
  }

  // Ensure an explicit "Sortie Ref" column always owns the canonical 'sortie' field
  const autoSortieEntry = Object.entries(auto).find(([, field]) => field === 'sortie');
  if (autoSortieEntry) {
    const refColIdx = Number(autoSortieEntry[0]);
    const refHeaderNorm = normalizeHeader(config.headers[refColIdx] ?? '');
    if (
      SORTIE_REF_CUSTOM_KEY_PATTERN.test(refHeaderNorm) &&
      nextMapping[refColIdx] !== 'sortie'
    ) {
      for (const [idxStr, field] of Object.entries(nextMapping)) {
        if (field === 'sortie') {
          nextMapping[Number(idxStr)] = 'custom';
        }
      }
      const prevVal = nextMapping[refColIdx];
      nextMapping[refColIdx] = 'sortie';
      changed = true;
      if (prevVal === 'exercise') {
        const exEntry = Object.entries(auto).find(([, field]) => field === 'exercise');
        if (exEntry) {
          nextMapping[Number(exEntry[0])] = 'exercise';
        }
      }
    }
  }

  const targetFields: CanonicalFlightField[] = [
    'aircraftMark',
    'sortie',
    'departure',
    'arrival',
  ];

  for (const targetField of targetFields) {
    const alreadyMapped = Object.values(nextMapping).includes(targetField);
    if (alreadyMapped) continue;

    const autoEntry = Object.entries(auto).find(([, field]) => field === targetField);
    if (!autoEntry) continue;

    const colIdx = Number(autoEntry[0]);
    const prevVal = nextMapping[colIdx];
    // Safely upgrade columns that were previously custom/ignore/unmapped, or where 'Sortie' previously mapped to 'exercise'
    if (
      prevVal === undefined ||
      prevVal === 'custom' ||
      prevVal === 'ignore' ||
      (targetField === 'sortie' && prevVal === 'exercise')
    ) {
      nextMapping[colIdx] = targetField;
      changed = true;
      // If 'sortie' freed up 'exercise', also bind the real 'Exercise' column if present
      if (targetField === 'sortie' && prevVal === 'exercise') {
        const exEntry = Object.entries(auto).find(([, field]) => field === 'exercise');
        if (exEntry) {
          nextMapping[Number(exEntry[0])] = 'exercise';
        }
      }
    }
  }

  return changed ? { ...config, mapping: nextMapping } : config;
}

function normalizeRoleType(raw: string, engineCategory: EngineCategory): FlightRoleType {
  if (engineCategory === 'SIMULATOR') return 'SIMULATOR';
  const upper = raw.trim().toUpperCase();
  if (upper.includes('SIM')) return 'SIMULATOR';
  if (upper.includes('SOLO')) return 'SOLO';
  if (upper.includes('PIC') || upper === 'P1' || upper.includes('CAPTAIN')) return 'PIC';
  return 'DUAL';
}

export interface MappedImportResult {
  flights: FlightEntry[];
  skippedRows: number;
  warnings: string[];
}

export function mapRowsToFlights(
  headers: string[],
  dataRows: string[][],
  mapping: ColumnMapping,
  source: FlightSource,
  startingSheetRow = 2
): MappedImportResult {
  const flights: FlightEntry[] = [];
  const warnings: string[] = [];
  let skippedRows = 0;

  dataRows.forEach((row, rIdx) => {
    if (!row || row.every((c) => !String(c ?? '').trim())) return;

    let date = '';
    let aircraftType = '';
    let aircraftMark = '';
    let rawEngine = '';
    let instructor = '';
    let exercise = '';
    let rawFlightType = '';
    let sortie = '';
    let departure = '';
    let arrival = '';
    let totalMinutes = 0;
    let dualMinutes = 0;
    let soloMinutes = 0;
    let nightMinutes = 0;
    let instrumentMinutes = 0;
    let simulatorMinutes = 0;
    let takeoffs = -1;
    let landings = -1;
    let approaches = 0;
    let remarks = '';
    const customFields: Record<string, string> = {};

    headers.forEach((headerName, colIdx) => {
      const target = mapping[colIdx];
      const rawVal = String(row[colIdx] ?? '').trim();
      if (!target || target === 'ignore' || !rawVal) return;

      if (target === 'custom') {
        customFields[headerName || `Column_${colIdx + 1}`] = rawVal;
        return;
      }

      switch (target) {
        case 'date':
          date = normalizeDateString(rawVal);
          break;
        case 'aircraftType':
          aircraftType = rawVal.toUpperCase();
          break;
        case 'aircraftMark':
          aircraftMark = rawVal.trim();
          break;
        case 'engineCategory':
          rawEngine = rawVal;
          break;
        case 'instructor':
          instructor = rawVal.toUpperCase();
          break;
        case 'exercise':
          exercise = rawVal.toUpperCase();
          break;
        case 'flightType':
          rawFlightType = rawVal;
          break;
        case 'sortie':
          sortie = rawVal.trim();
          break;
        case 'departure':
          departure = rawVal.toUpperCase();
          break;
        case 'arrival':
          arrival = rawVal.toUpperCase();
          break;
        case 'totalTime':
          totalMinutes = parseDurationToMinutes(rawVal);
          break;
        case 'dualTime':
          dualMinutes = parseDurationToMinutes(rawVal);
          break;
        case 'soloTime':
          soloMinutes = parseDurationToMinutes(rawVal);
          break;
        case 'nightTime':
          nightMinutes = parseDurationToMinutes(rawVal);
          break;
        case 'instrumentTime':
          instrumentMinutes = parseDurationToMinutes(rawVal);
          break;
        case 'simulatorTime':
          simulatorMinutes = parseDurationToMinutes(rawVal);
          break;
        case 'takeoffs':
          takeoffs = parseInteger(rawVal);
          break;
        case 'landings':
          landings = parseInteger(rawVal);
          break;
        case 'approaches':
          approaches = parseInteger(rawVal);
          break;
        case 'remarks':
          remarks = rawVal;
          break;
      }
    });

    // Clear literal placeholder values (e.g. "Sortie") so they never overwrite or masquerade as a Sortie Ref name
    if (sortie && isPlaceholderSortieValue(sortie)) {
      sortie = '';
    }

    // Promote Mark, From, To, Route, or Sortie Ref / Sortie from customFields when the primary mapped
    // column is absent or blank on this row. Explicit "Sortie Ref" always takes priority, and literal
    // placeholder values like "Sortie" are never promoted.
    if (Object.keys(customFields).length > 0) {
      const promotedKeys: string[] = [];

      // Pass 1: Explicit "Sortie Ref" always wins over any generic/placeholder sortie
      for (const [key, val] of Object.entries(customFields)) {
        const cleaned = val.trim();
        if (!cleaned || isPlaceholderSortieValue(cleaned)) continue;
        const normKey = normalizeHeader(key);
        if (SORTIE_REF_CUSTOM_KEY_PATTERN.test(normKey)) {
          sortie = cleaned;
          promotedKeys.push(key);
          break;
        }
      }

      // Pass 2: Promote remaining fields only when missing and non-placeholder
      for (const [key, val] of Object.entries(customFields)) {
        if (promotedKeys.includes(key)) continue;
        const cleaned = val.trim();
        if (!cleaned) continue;
        const normKey = normalizeHeader(key);
        if (!aircraftMark && headerMatchesField(normKey, 'aircraftMark')) {
          aircraftMark = cleaned;
          promotedKeys.push(key);
        } else if (
          !sortie &&
          headerMatchesField(normKey, 'sortie') &&
          !isPlaceholderSortieValue(cleaned)
        ) {
          sortie = cleaned;
          promotedKeys.push(key);
        } else if (!departure && headerMatchesField(normKey, 'departure')) {
          departure = cleaned.toUpperCase();
          promotedKeys.push(key);
        } else if (!arrival && headerMatchesField(normKey, 'arrival')) {
          arrival = cleaned.toUpperCase();
          promotedKeys.push(key);
        } else if ((!departure || !arrival) && COMBINED_ROUTE_HEADER_PATTERN.test(normKey)) {
          const split = splitCombinedRoute(cleaned);
          if (split.departure || split.arrival) {
            if (!departure && split.departure) departure = split.departure;
            if (!arrival && split.arrival) arrival = split.arrival;
            promotedKeys.push(key);
          }
        }
      }
      for (const key of promotedKeys) {
        delete customFields[key];
      }
    }

    if (departure && !arrival) {
      const split = splitCombinedRoute(departure);
      if (split.departure && split.arrival) {
        departure = split.departure;
        arrival = split.arrival;
      }
    }

    if (!date && !aircraftType && totalMinutes === 0) {
      skippedRows++;
      return;
    }

    if (!date) {
      warnings.push(`Row ${startingSheetRow + rIdx}: Missing valid date, skipped.`);
      skippedRows++;
      return;
    }

    const engineCategory = inferEngineCategory(aircraftType, rawEngine);
    const flightType = normalizeRoleType(rawFlightType, engineCategory);

    // Derive totalMinutes if only dual/solo/sim columns were mapped
    if (totalMinutes <= 0) {
      totalMinutes = dualMinutes + soloMinutes + simulatorMinutes;
    }

    // Derive dual/solo/simulator split from flightType if only a single Time column was present
    if (engineCategory === 'SIMULATOR' || flightType === 'SIMULATOR') {
      if (simulatorMinutes <= 0) simulatorMinutes = totalMinutes;
    } else if (dualMinutes === 0 && soloMinutes === 0 && totalMinutes > 0) {
      if (flightType === 'SOLO' || flightType === 'PIC') {
        soloMinutes = totalMinutes;
      } else {
        dualMinutes = totalMinutes;
      }
    }

    flights.push({
      id: `imp-${Date.now()}-${rIdx}-${Math.random().toString(36).slice(2, 7)}`,
      date,
      aircraftType: aircraftType || 'UNSPECIFIED',
      aircraftMark,
      engineCategory,
      instructor,
      exercise: exercise || 'SORTIE',
      flightType,
      sortie: sortie || undefined,
      departure: departure || undefined,
      arrival: arrival || undefined,
      totalMinutes,
      dualMinutes,
      soloMinutes,
      nightMinutes,
      instrumentMinutes,
      simulatorMinutes,
      takeoffs: takeoffs >= 0 ? takeoffs : 1,
      landings: landings >= 0 ? landings : 1,
      approaches,
      remarks,
      source,
      sheetRowNumber: startingSheetRow + rIdx,
      customFields: Object.keys(customFields).length > 0 ? customFields : undefined,
    });
  });

  return { flights, skippedRows, warnings };
}

export function serializeFlightToSheetRow(
  flight: FlightEntry,
  headers: string[],
  mapping: ColumnMapping
): (string | number)[] {
  return headers.map((header, idx) => {
    const field = mapping[idx];
    if (!field || field === 'ignore') return '';
    if (field === 'custom') {
      return flight.customFields?.[header] ?? '';
    }
    switch (field) {
      case 'date':
        return formatShortSheetDate(flight.date);
      case 'aircraftType':
        return flight.aircraftType;
      case 'aircraftMark':
        return flight.aircraftMark;
      case 'engineCategory':
        return flight.engineCategory;
      case 'instructor':
        return flight.instructor;
      case 'exercise':
        return flight.exercise;
      case 'flightType':
        return flight.flightType;
      case 'sortie':
        return flight.sortie ?? '';
      case 'departure':
        return flight.departure ?? '';
      case 'arrival':
        return flight.arrival ?? '';
      case 'totalTime':
        return formatHHMM(flight.totalMinutes);
      case 'dualTime':
        return flight.dualMinutes > 0 ? formatHHMM(flight.dualMinutes) : '';
      case 'soloTime':
        return flight.soloMinutes > 0 ? formatHHMM(flight.soloMinutes) : '';
      case 'nightTime':
        return flight.nightMinutes > 0 ? formatHHMM(flight.nightMinutes) : '';
      case 'instrumentTime':
        return flight.instrumentMinutes > 0 ? formatHHMM(flight.instrumentMinutes) : '';
      case 'simulatorTime':
        return flight.simulatorMinutes > 0 ? formatHHMM(flight.simulatorMinutes) : '';
      case 'takeoffs':
        return flight.takeoffs;
      case 'landings':
        return flight.landings;
      case 'approaches':
        return flight.approaches;
      case 'remarks':
        return flight.remarks;
      default:
        return '';
    }
  });
}

export const STANDARD_SHEET_HEADERS = [
  'Date',
  'Aircraft',
  'Engine',
  'Mark',
  'From',
  'To',
  'Instructor',
  'Sortie Ref',
  'Exercise',
  'Type',
  'Take-offs',
  'Landings',
  'Time',
  'Dual',
  'Solo',
  'Night',
  'Instrument',
  'Inst. Approaches',
  'Remarks',
];

function csvEscape(val: string | number | boolean | undefined): string {
  const s = val === undefined || val === null ? '' : String(val);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function exportFlightsToCsv(flights: FlightEntry[]): string {
  const mapping = autoDetectColumnMapping(STANDARD_SHEET_HEADERS);
  const lines = [STANDARD_SHEET_HEADERS.map(csvEscape).join(',')];
  for (const flight of flights) {
    const row = serializeFlightToSheetRow(flight, STANDARD_SHEET_HEADERS, mapping);
    lines.push(row.map(csvEscape).join(','));
  }
  return lines.join('\n');
}

export function parseAppSheetSchemaText(text: string): AppSheetSchemaField[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.columns)
          ? parsed.columns
          : Array.isArray(parsed.Columns)
            ? parsed.Columns
            : [];
      if (list.length > 0) {
        const names = list.map((item: any) =>
          typeof item === 'string' ? item : String(item.name || item.Name || item.column || '')
        );
        const mapping = autoDetectColumnMapping(names);
        return list.map((item: any, idx: number) => ({
          name: names[idx] || `Field_${idx + 1}`,
          appSheetType: typeof item === 'object' ? String(item.type || item.Type || 'Text') : 'Text',
          mappedTo: mapping[idx] ?? 'custom',
          isVirtual: Boolean(typeof item === 'object' && (item.isVirtual || item.virtual || item.AppFormula)),
        }));
      }
    } catch {
      // fall through
    }
  }

  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const entries =
    lines.length === 1 && lines[0].includes(',')
      ? lines[0].split(',').map((s) => s.trim()).filter(Boolean)
      : lines;

  const parsedEntries = entries.map((line) => {
    const parenMatch = line.match(/^([^(\t:]+)(?:\s*\(([^)]+)\)|\s*[:\t]\s*(.+))?$/);
    const name = (parenMatch?.[1] ?? line).trim();
    const rawType = (parenMatch?.[2] ?? parenMatch?.[3] ?? 'Text').trim();
    const isVirtual = /virtual|formula|related /i.test(line);
    return { name, appSheetType: rawType, isVirtual };
  });

  const mapping = autoDetectColumnMapping(parsedEntries.map((e) => e.name));
  return parsedEntries.map((e, idx) => ({
    ...e,
    mappedTo: mapping[idx] ?? 'custom',
  }));
}
