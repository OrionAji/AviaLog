import type {
  AircraftHoursSummary,
  AircraftMarkSummary,
  BroughtForwardBaseline,
  EngineCategory,
  FlightEntry,
  LogbookTotals,
  MonthlyFlightGroup,
  YearlyHoursSummary,
} from '../types/logbook';

/**
 * Formats an integer minute count into exact HH:MM aviation logbook notation (e.g., 13420 -> "223:40", 80 -> "1:20").
 */
export function formatHHMM(minutes: number): string {
  const safe = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
  const hrs = Math.floor(safe / 60);
  const mins = safe % 60;
  return `${hrs}:${String(mins).padStart(2, '0')}`;
}

export function minutesToDecimal(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.round((minutes / 60) * 10) / 10;
}

/**
 * Parses duration values into exact integer minutes:
 * - HH:MM or HH:MM:SS: "1:20" -> 80, "223:40" -> 13420, "0:55" -> 55
 * - Human format: "1h 20m" -> 80, "90m" -> 90
 * - Decimal hours: "1.5" -> 90, 1.25 -> 75
 */
export function parseDurationToMinutes(raw: unknown): number {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return Math.round(raw * 60);
  }
  if (typeof raw !== 'string') return 0;
  const trimmed = raw.trim();
  if (!trimmed) return 0;

  // HH:MM or HH:MM:SS (Google Sheets / AppSheet Duration)
  const colonMatch = trimmed.match(/^(\d{1,4}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (colonMatch) {
    const h = parseInt(colonMatch[1], 10);
    const m = parseInt(colonMatch[2], 10);
    const s = colonMatch[3] ? parseInt(colonMatch[3], 10) : 0;
    return Math.max(0, h * 60 + m + Math.round(s / 60));
  }

  // "1h 20m" / "2h" / "45m"
  const hmMatch = trimmed.match(
    /^(?:(\d+(?:\.\d+)?)\s*h(?:rs?|ours?)?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:ins?|inutes?)?)?$/i
  );
  if (hmMatch && (hmMatch[1] || hmMatch[2])) {
    const h = hmMatch[1] ? parseFloat(hmMatch[1]) : 0;
    const m = hmMatch[2] ? parseFloat(hmMatch[2]) : 0;
    return Math.max(0, Math.round(h * 60 + m));
  }

  // Decimal hours fallback
  const normalized = trimmed.includes('.') ? trimmed.replace(/,/g, '') : trimmed.replace(',', '.');
  const num = parseFloat(normalized.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.round(num * 60);
}

export function parseInteger(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 0;
  if (typeof raw !== 'string') return 0;
  const parsed = parseInt(raw.replace(/[^0-9-]/g, ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Computes exact minutes between HH:MM Block Out and Block In times (handles crossing midnight).
 */
export function computeBlockMinutes(outTime: string, inTime: string): number | null {
  const outMatch = outTime.trim().match(/^(\d{1,2}):(\d{2})$/);
  const inMatch = inTime.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!outMatch || !inMatch) return null;
  const outMins = parseInt(outMatch[1], 10) * 60 + parseInt(outMatch[2], 10);
  const inMins = parseInt(inMatch[1], 10) * 60 + parseInt(inMatch[2], 10);
  if (outMins > 1439 || inMins > 1439) return null;
  let diff = inMins - outMins;
  if (diff <= 0) diff += 24 * 60;
  return diff;
}

const MONTH_MAP: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL_MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function formatMonthLabel(monthKey: string): string {
  const match = monthKey.match(/^(\d{4})-(\d{2})$/);
  if (!match) return 'Undated';
  const year = match[1];
  const monthIdx = parseInt(match[2], 10) - 1;
  const monthName = FULL_MONTH_LABELS[monthIdx] ?? match[2];
  return `${monthName} ${year}`;
}

export function formatDisplayDate(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  const [y, m, d] = isoDate.split('-');
  const monthIdx = parseInt(m, 10) - 1;
  return `${d} ${MONTH_LABELS[monthIdx] ?? m} ${y}`;
}

export function formatShortSheetDate(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  const [y, m, d] = isoDate.split('-');
  const monthIdx = parseInt(m, 10) - 1;
  return `${d}-${MONTH_LABELS[monthIdx] ?? m}-${y.slice(-2)}`;
}

/**
 * Normalizes date strings including Pilot AJI's DD-MMM-YY ("14-Nov-26", "07-Oct-24"),
 * ISO YYYY-MM-DD, US MM/DD/YYYY, and DD/MM/YYYY.
 */
export function normalizeDateString(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const s = raw.trim();
  if (!s) return '';

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // DD-MMM-YY or DD MMM YYYY (e.g., "14-Nov-26", "09 Nov 2020")
  const dmyText = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{2,4})$/);
  if (dmyText) {
    const day = dmyText[1].padStart(2, '0');
    const mon = MONTH_MAP[dmyText[2].slice(0, 3).toLowerCase()];
    let year = parseInt(dmyText[3], 10);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    if (mon) return `${year}-${mon}-${day}`;
  }

  // YYYY/MM/DD
  const ymdSlash = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (ymdSlash) {
    return `${ymdSlash[1]}-${ymdSlash[2].padStart(2, '0')}-${ymdSlash[3].padStart(2, '0')}`;
  }

  // MM/DD/YYYY or DD/MM/YYYY
  const numericDate = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (numericDate) {
    let year = parseInt(numericDate[3], 10);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    const p1 = parseInt(numericDate[1], 10);
    const p2 = parseInt(numericDate[2], 10);
    const month = p1 > 12 ? p2 : p1;
    const day = p1 > 12 ? p1 : p2;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    const yyyy = parsed.getUTCFullYear();
    const mm = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  return '';
}

export function inferEngineCategory(aircraftType: string, rawEngine?: string): EngineCategory {
  const combined = `${rawEngine ?? ''} ${aircraftType}`.toUpperCase();
  if (combined.includes('FSTD') || combined.includes('SIM')) return 'SIMULATOR';
  if (
    combined.includes('JET') ||
    combined.includes('K8') ||
    combined.includes('K-8') ||
    combined.includes('L-39') ||
    combined.includes('L39') ||
    combined.includes('A-JET') ||
    combined.includes('ALPHA')
  ) {
    return 'JET ENGINE';
  }
  if (combined.includes('MULTI') || combined.includes('AMEL') || combined.includes('PA-44')) {
    return 'MULTI ENGINE';
  }
  return 'SINGLE ENGINE';
}

function parseUtcDate(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function computeDaysSince(dateIso: string | null, referenceDateIso: string): number | null {
  if (!dateIso) return null;
  const from = parseUtcDate(dateIso);
  const to = parseUtcDate(referenceDateIso);
  if (!from || !to) return null;
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86400000));
}

export function computeLogbookTotals(
  flights: FlightEntry[],
  baseline: BroughtForwardBaseline | null,
  referenceDateIso: string
): LogbookTotals {
  let flightCount = baseline?.flights ?? 0;
  let simFlights = baseline?.simulatorFlights ?? 0;
  let takeoffs = baseline?.takeoffs ?? 0;
  let simTakeoffs = baseline?.simulatorTakeoffs ?? 0;
  let landings = baseline?.landings ?? 0;
  let simLandings = baseline?.simulatorLandings ?? 0;

  let totalMinutes = baseline?.totalMinutes ?? 0;
  let dualMinutes = baseline?.dualMinutes ?? 0;
  let soloMinutes = baseline?.soloMinutes ?? 0;
  let jetMinutes = baseline?.jetMinutes ?? 0;
  let nightMinutes = baseline?.nightMinutes ?? 0;
  let instrumentMinutes = baseline?.instrumentMinutes ?? 0;
  let simulatorMinutes = baseline?.simulatorMinutes ?? 0;
  let approaches = baseline?.approaches ?? 0;

  let firstFlightDate: string | null = baseline?.firstFlightDate ?? null;
  let lastFlightDate: string | null = null;

  for (const f of flights) {
    const isSim = f.engineCategory === 'SIMULATOR' || f.flightType === 'SIMULATOR';

    if (isSim) {
      simFlights += 1;
      simTakeoffs += f.takeoffs || 0;
      simLandings += f.landings || 0;
      simulatorMinutes += f.simulatorMinutes > 0 ? f.simulatorMinutes : f.totalMinutes || 0;
    } else {
      flightCount += 1;
      takeoffs += f.takeoffs || 0;
      landings += f.landings || 0;
      totalMinutes += f.totalMinutes || 0;
      dualMinutes += f.dualMinutes || 0;
      soloMinutes += f.soloMinutes || 0;
      if (f.engineCategory === 'JET ENGINE') {
        jetMinutes += f.totalMinutes || 0;
      }
      simulatorMinutes += f.simulatorMinutes || 0;
    }

    nightMinutes += f.nightMinutes || 0;
    instrumentMinutes += f.instrumentMinutes || 0;
    approaches += f.approaches || 0;

    if (f.date) {
      if (!firstFlightDate || f.date < firstFlightDate) firstFlightDate = f.date;
      if (!lastFlightDate || f.date > lastFlightDate) lastFlightDate = f.date;
    }
  }

  return {
    flightCount,
    flightCountInclSim: flightCount + simFlights,
    takeoffs,
    takeoffsInclSim: takeoffs + simTakeoffs,
    landings,
    landingsInclSim: landings + simLandings,
    totalMinutes,
    totalMinutesInclSim: totalMinutes + simulatorMinutes,
    dualMinutes,
    soloMinutes,
    jetMinutes,
    nightMinutes,
    instrumentMinutes,
    simulatorMinutes,
    approaches,
    firstFlightDate,
    lastFlightDate,
    daysSinceLastFlight: computeDaysSince(lastFlightDate, referenceDateIso),
  };
}

const AIRCRAFT_DISPLAY_ORDER = ['SMK', 'DA-40', 'DA-40 FSTD', 'K8-E', 'L-39ZA', 'A-JET'];

export function computeAircraftBreakdown(
  flights: FlightEntry[],
  baseline: BroughtForwardBaseline | null
): AircraftHoursSummary[] {
  const map = new Map<string, AircraftHoursSummary>();

  if (baseline) {
    for (const ac of baseline.byAircraft) {
      const key = ac.aircraftType.trim().toUpperCase();
      map.set(key, {
        aircraftType: ac.aircraftType,
        engineCategory: ac.engineCategory,
        flights: ac.flights,
        takeoffs: ac.takeoffs,
        landings: ac.landings,
        totalMinutes: ac.totalMinutes,
        hoursChart: minutesToDecimal(ac.totalMinutes),
        lastFlown: null,
        marks: [],
      });
    }
  }

  for (const f of flights) {
    const key = (f.aircraftType || 'UNKNOWN').trim().toUpperCase();
    const isSim = f.engineCategory === 'SIMULATOR' || f.flightType === 'SIMULATOR';
    const dur = isSim ? (f.simulatorMinutes || f.totalMinutes) : f.totalMinutes;
    const mark = (f.aircraftMark || '').trim();
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        aircraftType: f.aircraftType || 'UNKNOWN',
        engineCategory: f.engineCategory,
        flights: 1,
        takeoffs: f.takeoffs || 0,
        landings: f.landings || 0,
        totalMinutes: dur,
        hoursChart: minutesToDecimal(dur),
        lastFlown: f.date || null,
        marks: mark ? [mark] : [],
      });
    } else {
      existing.flights += 1;
      existing.takeoffs += f.takeoffs || 0;
      existing.landings += f.landings || 0;
      existing.totalMinutes += dur;
      existing.hoursChart = minutesToDecimal(existing.totalMinutes);
      if (f.date && (!existing.lastFlown || f.date > existing.lastFlown)) {
        existing.lastFlown = f.date;
      }
      if (mark && !existing.marks.some((m) => m.toUpperCase() === mark.toUpperCase())) {
        existing.marks.push(mark);
        existing.marks.sort();
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    const idxA = AIRCRAFT_DISPLAY_ORDER.indexOf(a.aircraftType.toUpperCase());
    const idxB = AIRCRAFT_DISPLAY_ORDER.indexOf(b.aircraftType.toUpperCase());
    if (idxA >= 0 && idxB >= 0) return idxA - idxB;
    if (idxA >= 0) return -1;
    if (idxB >= 0) return 1;
    return b.totalMinutes - a.totalMinutes;
  });
}

export function computeMarkBreakdown(flights: FlightEntry[]): AircraftMarkSummary[] {
  const map = new Map<string, AircraftMarkSummary>();

  for (const f of flights) {
    const mark = (f.aircraftMark || '').trim();
    if (!mark) continue;

    const acType = (f.aircraftType || 'UNKNOWN').trim().toUpperCase();
    const key = `${mark.toUpperCase()}|${acType}`;
    const isSim = f.engineCategory === 'SIMULATOR' || f.flightType === 'SIMULATOR';
    const dur = isSim ? (f.simulatorMinutes || f.totalMinutes) : f.totalMinutes;
    const existing = map.get(key);

    if (!existing) {
      map.set(key, {
        aircraftMark: mark,
        aircraftType: acType,
        engineCategory: f.engineCategory,
        flights: 1,
        takeoffs: f.takeoffs || 0,
        landings: f.landings || 0,
        totalMinutes: dur,
        lastFlown: f.date || null,
      });
    } else {
      existing.flights += 1;
      existing.takeoffs += f.takeoffs || 0;
      existing.landings += f.landings || 0;
      existing.totalMinutes += dur;
      if (f.date && (!existing.lastFlown || f.date > existing.lastFlown)) {
        existing.lastFlown = f.date;
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    if (b.totalMinutes !== a.totalMinutes) return b.totalMinutes - a.totalMinutes;
    return a.aircraftMark.localeCompare(b.aircraftMark);
  });
}

export function computeYearlyBreakdown(
  flights: FlightEntry[],
  baseline: BroughtForwardBaseline | null
): YearlyHoursSummary[] {
  const map = new Map<number, YearlyHoursSummary>();

  if (baseline) {
    for (const yr of baseline.byYear) {
      const total = yr.dualMinutes + yr.soloMinutes;
      map.set(yr.year, {
        year: yr.year,
        flights: yr.flights,
        landings: yr.landings,
        dualMinutes: yr.dualMinutes,
        soloMinutes: yr.soloMinutes,
        totalMinutes: total,
        dualHoursChart: minutesToDecimal(yr.dualMinutes),
        soloHoursChart: minutesToDecimal(yr.soloMinutes),
        totalHoursChart: minutesToDecimal(total),
      });
    }
  }

  for (const f of flights) {
    // Sheet's Hours by Year counts live flights (excl. simulator)
    if (f.engineCategory === 'SIMULATOR' || f.flightType === 'SIMULATOR') continue;
    if (!f.date || f.date.length < 4) continue;
    const yr = parseInt(f.date.slice(0, 4), 10);
    if (!Number.isFinite(yr)) continue;

    const existing = map.get(yr);
    if (!existing) {
      const total = f.dualMinutes + f.soloMinutes || f.totalMinutes;
      map.set(yr, {
        year: yr,
        flights: 1,
        landings: f.landings || 0,
        dualMinutes: f.dualMinutes || 0,
        soloMinutes: f.soloMinutes || 0,
        totalMinutes: total,
        dualHoursChart: minutesToDecimal(f.dualMinutes || 0),
        soloHoursChart: minutesToDecimal(f.soloMinutes || 0),
        totalHoursChart: minutesToDecimal(total),
      });
    } else {
      existing.flights += 1;
      existing.landings += f.landings || 0;
      existing.dualMinutes += f.dualMinutes || 0;
      existing.soloMinutes += f.soloMinutes || 0;
      existing.totalMinutes = existing.dualMinutes + existing.soloMinutes;
      existing.dualHoursChart = minutesToDecimal(existing.dualMinutes);
      existing.soloHoursChart = minutesToDecimal(existing.soloMinutes);
      existing.totalHoursChart = minutesToDecimal(existing.totalMinutes);
    }
  }

  return Array.from(map.values()).sort((a, b) => a.year - b.year);
}

/**
 * Groups flight entries by calendar month (YYYY-MM) and calculates exact HH:MM monthly subtotals
 * while preserving the flight ordering within each month.
 */
export function computeMonthlyGroups(
  flights: FlightEntry[],
  monthSortDir: 'desc' | 'asc' = 'desc'
): MonthlyFlightGroup[] {
  const map = new Map<string, MonthlyFlightGroup>();

  for (const f of flights) {
    const monthKey = /^\d{4}-\d{2}/.test(f.date) ? f.date.slice(0, 7) : 'undated';
    let group = map.get(monthKey);
    if (!group) {
      group = {
        monthKey,
        label: formatMonthLabel(monthKey),
        flights: [],
        flightCount: 0,
        flightCountInclSim: 0,
        takeoffs: 0,
        landings: 0,
        totalMinutes: 0,
        totalMinutesInclSim: 0,
        dualMinutes: 0,
        soloMinutes: 0,
        nightMinutes: 0,
        instrumentMinutes: 0,
        simulatorMinutes: 0,
        approaches: 0,
      };
      map.set(monthKey, group);
    }

    const isSim = f.engineCategory === 'SIMULATOR' || f.flightType === 'SIMULATOR';
    group.flights.push(f);
    group.flightCountInclSim += 1;
    group.takeoffs += f.takeoffs || 0;
    group.landings += f.landings || 0;
    group.nightMinutes += f.nightMinutes || 0;
    group.instrumentMinutes += f.instrumentMinutes || 0;
    group.approaches += f.approaches || 0;

    if (isSim) {
      const simDur = f.simulatorMinutes > 0 ? f.simulatorMinutes : f.totalMinutes || 0;
      group.simulatorMinutes += simDur;
      group.totalMinutesInclSim += simDur;
    } else {
      const liveDur = f.totalMinutes || 0;
      group.flightCount += 1;
      group.totalMinutes += liveDur;
      group.dualMinutes += f.dualMinutes || 0;
      group.soloMinutes += f.soloMinutes || 0;
      group.simulatorMinutes += f.simulatorMinutes || 0;
      group.totalMinutesInclSim += liveDur + (f.simulatorMinutes || 0);
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.monthKey === 'undated') return 1;
    if (b.monthKey === 'undated') return -1;
    const cmp = a.monthKey.localeCompare(b.monthKey);
    return monthSortDir === 'desc' ? -cmp : cmp;
  });
}

export interface FlightValidationErrors {
  date?: string;
  aircraftType?: string;
  exercise?: string;
  totalMinutes?: string;
  subTimes?: string;
}

export function validateFlightEntry(entry: Partial<FlightEntry>): FlightValidationErrors {
  const errors: FlightValidationErrors = {};

  if (!entry.date || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
    errors.date = 'Enter a valid flight date (YYYY-MM-DD).';
  }
  if (!entry.aircraftType || !entry.aircraftType.trim()) {
    errors.aircraftType = 'Aircraft type (e.g., A-JET, L-39ZA, K8-E) is required.';
  }
  if (!entry.exercise || !entry.exercise.trim()) {
    errors.exercise = 'Exercise or mission type (e.g., ARMED RECCE, FORMATION, NAV) is required.';
  }

  const total = Number(entry.totalMinutes ?? 0);
  if (!Number.isFinite(total) || total <= 0) {
    errors.totalMinutes = 'Flight time must be greater than 0:00 (e.g., 1:20).';
  } else if (total > 24 * 60) {
    errors.totalMinutes = 'Single flight leg cannot exceed 24:00.';
  }

  const night = Number(entry.nightMinutes ?? 0);
  const inst = Number(entry.instrumentMinutes ?? 0);
  if (night < 0 || inst < 0) {
    errors.subTimes = 'Night or instrument time cannot be negative.';
  } else if (total > 0 && night > total) {
    errors.subTimes = `Night time (${formatHHMM(night)}) cannot exceed flight time (${formatHHMM(total)}).`;
  } else if (total > 0 && inst > total) {
    errors.subTimes = `Instrument time (${formatHHMM(inst)}) cannot exceed flight time (${formatHHMM(total)}).`;
  }

  return errors;
}
