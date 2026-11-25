import type { FlightEntry } from '../types/logbook';

export type CurrencyStatus = 'current' | 'expiring' | 'expired';

export interface MissionCurrencyRule {
  id: string;
  label: string;
  shortWindowLabel: string;
  validityDays: number;
  warningDays: number;
  allowSimulator?: boolean;
  requirementNote: string;
  matches: (flight: FlightEntry) => boolean;
}

export interface MissionCurrencyItem {
  id: string;
  label: string;
  shortWindowLabel: string;
  validityDays: number;
  warningDays: number;
  requirementNote: string;
  status: CurrencyStatus;
  lastFlightDate: string;
  lastAircraftType: string | null;
  lastExercise: string | null;
  expiresOn: string;
  daysSinceLastFlight: number;
  daysRemaining: number;
}

export interface MissionCurrencyReport {
  overallStatus: 'none' | 'current' | 'expiring' | 'expired';
  items: MissionCurrencyItem[];
  flaggedItems: MissionCurrencyItem[];
  expiringCount: number;
  expiredCount: number;
  currentCount: number;
  nextDueItem: MissionCurrencyItem | null;
  generalFlightItem: MissionCurrencyItem | null;
}

function isSimulatorFlight(flight: FlightEntry): boolean {
  return flight.engineCategory === 'SIMULATOR' || flight.flightType === 'SIMULATOR';
}

function parseUtcDate(isoDate: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function addDaysToIsoDate(isoDate: string, days: number): string {
  const parsed = parseUtcDate(isoDate);
  if (!parsed) return isoDate;
  const shifted = new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate() + days)
  );
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function computeElapsedDays(fromIso: string, toIso: string): number | null {
  const from = parseUtcDate(fromIso);
  const to = parseUtcDate(toIso);
  if (!from || !to) return null;
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86400000));
}

const AIR_GROUND_EXERCISE_PATTERN =
  /\b(AIR[\s/-]*(?:TO[\s/-]*)?GROUND|A[\s/-]*G|AG|ARMED\s*RECCE|RECCE|RECON|STRIKE|CAS|CLOSE\s*AIR\s*SUPPORT|ATTACK|WEAPONS|BOMB(S|ING)?|STRAF(E|ING)|ROCKET(S|ING)?|GUNNERY|RANGE|ORDNANCE)\b/i;

const LIVE_AIR_GROUND_EXPLICIT_PATTERN =
  /\b(LIVE\s*(?:AIR[\s/-]*(?:TO[\s/-]*)?GROUND|A[\s/-]*G|AG|FIRE|FIRING|ORDNANCE|BOMB(S|ING)?|ROCKET(S|ING)?|STRAF(E|ING)|GUNNERY|DROP|ATTACK|STRIKE|CAS|WEAPONS|RANGE|EXPEND|RECCE)|HOT\s*RANGE|L[\s/-]*A[\s/-]*G)\b/i;

const SIM_AIR_GROUND_EXPLICIT_PATTERN =
  /\b(SIM(?:ULATED)?\s*(?:AIR[\s/-]*(?:TO[\s/-]*)?GROUND|A[\s/-]*G|AG|STRIKE|ATTACK|BOMB(S|ING)?|STRAF(E|ING)|ROCKET(S|ING)?|CAS|WEAPONS|RANGE|GUNNERY)|DRY\s*(?:PASS|RUN|ATTACK|BOMB(S|ING)?|STRAF(E|ING)|A[\s/-]*G|AG|AIR[\s/-]*(?:TO[\s/-]*)?GROUND|RANGE)|S[\s/-]*A[\s/-]*G)\b/i;

const HOT_MISSION_PATTERN = /\bHOT(?:\d+|\b)/i;
const HOT_NON_ORDNANCE_PATTERN =
  /\bHOT\s*(?:WEATHER|DAY|TEMP(?:ERATURE)?|START|BRAKE(?:S)?|REFUEL(?:L?ING)?|PIT|MIC|MIKE|SEAT|OIL|EGT|ITT|ENGINE)\b/gi;

function containsHotMissionKeyword(text: string): boolean {
  if (!text) return false;
  const cleaned = text.replace(HOT_NON_ORDNANCE_PATTERN, ' ');
  return HOT_MISSION_PATTERN.test(cleaned);
}

function isLiveAirGroundFlight(flight: FlightEntry): boolean {
  if (isSimulatorFlight(flight)) return false;
  const sortie = flight.sortie || '';
  const exercise = flight.exercise || '';
  const remarks = flight.remarks || '';
  const combined = `${sortie} ${exercise} ${remarks}`;

  // Any sortie, exercise, or remarks indicating 'hot' is a live firing (Live Air-Ground) mission
  if (
    containsHotMissionKeyword(sortie) ||
    containsHotMissionKeyword(exercise) ||
    containsHotMissionKeyword(remarks)
  ) {
    return true;
  }

  if (
    SIM_AIR_GROUND_EXPLICIT_PATTERN.test(exercise) ||
    SIM_AIR_GROUND_EXPLICIT_PATTERN.test(sortie)
  ) {
    return false;
  }
  if (LIVE_AIR_GROUND_EXPLICIT_PATTERN.test(combined)) return true;
  if (
    (AIR_GROUND_EXERCISE_PATTERN.test(exercise) || AIR_GROUND_EXERCISE_PATTERN.test(sortie)) &&
    /\bLIVE\b/i.test(combined)
  ) {
    return true;
  }
  return false;
}

function isSimulatedAirGroundFlight(flight: FlightEntry): boolean {
  if (isSimulatorFlight(flight)) return false;
  if (isLiveAirGroundFlight(flight)) return false;
  const sortie = flight.sortie || '';
  const exercise = flight.exercise || '';
  const remarks = flight.remarks || '';
  if (SIM_AIR_GROUND_EXPLICIT_PATTERN.test(`${sortie} ${exercise} ${remarks}`)) return true;
  return AIR_GROUND_EXERCISE_PATTERN.test(exercise) || AIR_GROUND_EXERCISE_PATTERN.test(sortie);
}

export const MISSION_CURRENCY_RULES: MissionCurrencyRule[] = [
  {
    id: 'instrument',
    label: 'Instrument Flying',
    shortWindowLabel: '30-day',
    validityDays: 30,
    warningDays: 10,
    allowSimulator: true,
    requirementNote: 'Instrument flying and approach currency (aircraft or FSTD)',
    matches: (f) =>
      (f.instrumentMinutes || 0) > 0 ||
      (f.approaches || 0) > 0 ||
      /\b(INSTRUMENT|IF|IFR|ILS|APPROACH|IMC|HOOD|VOR|TACAN|NDB|IRT)\b/i.test(f.exercise || ''),
  },
  {
    id: 'night_flying',
    label: 'Night Flying',
    shortWindowLabel: '60-day',
    validityDays: 60,
    warningDays: 14,
    allowSimulator: false,
    requirementNote: 'Night flying and night landing currency',
    matches: (f) =>
      !isSimulatorFlight(f) &&
      ((f.nightMinutes || 0) > 0 || /\b(NIGHT|NVG|NITE)\b/i.test(f.exercise || '')),
  },
  {
    id: 'contact_gh',
    label: 'Contact Flying / GH',
    shortWindowLabel: '90-day',
    validityDays: 90,
    warningDays: 14,
    allowSimulator: false,
    requirementNote: 'Contact flying and general handling (GH) sortie currency',
    matches: (f) =>
      !isSimulatorFlight(f) &&
      /\b(CONTACT|GH|G[\s/.-]*H|GENERAL\s*HANDLING|HANDLING|CIRCUIT(S)?|CCT(S)?|AEROBATIC(S)?|AERO|STALL(S)?|SPIN(S)?|PFL|FAM(ILIARISATION|ILIARIZATION)?|CONVERSION|LOCAL|CHECK\s*(FLIGHT|RIDE)?|AIR\s*TEST|TEST\s*FLIGHT)\b/i.test(
        f.exercise || ''
      ),
  },
  {
    id: 'simulated_air_ground',
    label: 'Simulated Air-Ground',
    shortWindowLabel: '90-day',
    validityDays: 90,
    warningDays: 14,
    allowSimulator: false,
    requirementNote: 'Simulated air-to-ground attack and dry weapons delivery currency',
    matches: isSimulatedAirGroundFlight,
  },
  {
    id: 'live_air_ground',
    label: 'Live Air-Ground',
    shortWindowLabel: '180-day',
    validityDays: 180,
    warningDays: 21,
    allowSimulator: false,
    requirementNote: 'Live air-to-ground ordnance and hot firing mission currency',
    matches: isLiveAirGroundFlight,
  },
  {
    id: 'formation',
    label: 'Formation',
    shortWindowLabel: '90-day',
    validityDays: 90,
    warningDays: 14,
    allowSimulator: false,
    requirementNote: 'Multi-ship formation flying currency',
    matches: (f) =>
      !isSimulatorFlight(f) &&
      /\b(FORMATION|FORM|WINGMAN|LEAD|2[\s-]*SHIP|4[\s-]*SHIP)\b/i.test(f.exercise || ''),
  },
  {
    id: 'navigation',
    label: 'Navigation',
    shortWindowLabel: '90-day',
    validityDays: 90,
    warningDays: 14,
    allowSimulator: false,
    requirementNote: 'Low-level or cross-country navigation sortie currency',
    matches: (f) =>
      !isSimulatorFlight(f) &&
      /\b(NAV|NAVIGATION|CROSS[\s-]*COUNTRY|X[\s-]*COUNTRY|LLN|LOW[\s-]*LEVEL[\s-]*NAV)\b/i.test(
        f.exercise || ''
      ),
  },
];

const STATUS_SEVERITY_ORDER: Record<CurrencyStatus, number> = {
  expired: 0,
  expiring: 1,
  current: 2,
};

export function classifyCurrencyStatus(
  daysRemaining: number,
  warningDays: number
): CurrencyStatus {
  if (daysRemaining < 0) return 'expired';
  if (daysRemaining <= warningDays) return 'expiring';
  return 'current';
}

export function computeMissionCurrencyReport(
  flights: FlightEntry[],
  referenceDateIso: string,
  fallbackLastFlightDate: string | null = null,
  rules: MissionCurrencyRule[] = MISSION_CURRENCY_RULES
): MissionCurrencyReport {
  const items: MissionCurrencyItem[] = [];

  for (const rule of rules) {
    let latestFlight: FlightEntry | null = null;

    for (const f of flights) {
      if (!f.date || !parseUtcDate(f.date)) continue;
      if (!rule.allowSimulator && isSimulatorFlight(f)) continue;
      if (!rule.matches(f)) continue;

      if (!latestFlight || f.date > latestFlight.date) {
        latestFlight = f;
      }
    }

    const lastDate = latestFlight?.date ?? null;
    if (!lastDate) continue;

    const elapsed = computeElapsedDays(lastDate, referenceDateIso);
    if (elapsed === null) continue;

    const daysRemaining = rule.validityDays - elapsed;
    const status = classifyCurrencyStatus(daysRemaining, rule.warningDays);

    items.push({
      id: rule.id,
      label: rule.label,
      shortWindowLabel: rule.shortWindowLabel,
      validityDays: rule.validityDays,
      warningDays: rule.warningDays,
      requirementNote: rule.requirementNote,
      status,
      lastFlightDate: lastDate,
      lastAircraftType: latestFlight?.aircraftType || null,
      lastExercise: latestFlight?.exercise || null,
      expiresOn: addDaysToIsoDate(lastDate, rule.validityDays),
      daysSinceLastFlight: elapsed,
      daysRemaining,
    });
  }

  items.sort((a, b) => {
    const severityDiff = STATUS_SEVERITY_ORDER[a.status] - STATUS_SEVERITY_ORDER[b.status];
    if (severityDiff !== 0) return severityDiff;
    if (a.daysRemaining !== b.daysRemaining) return a.daysRemaining - b.daysRemaining;
    return a.label.localeCompare(b.label);
  });

  const flaggedItems = items.filter((item) => item.status !== 'current');
  const expiredCount = items.filter((item) => item.status === 'expired').length;
  const expiringCount = items.filter((item) => item.status === 'expiring').length;
  const currentCount = items.filter((item) => item.status === 'current').length;

  const overallStatus: MissionCurrencyReport['overallStatus'] =
    items.length === 0
      ? 'none'
      : expiredCount > 0
        ? 'expired'
        : expiringCount > 0
          ? 'expiring'
          : 'current';

  const nonExpired = items
    .filter((item) => item.status !== 'expired')
    .sort((a, b) => a.daysRemaining - b.daysRemaining);

  // Compute general 90-day live flight currency indicator for the Days Since Last Flight KPI card
  let latestLiveFlight: FlightEntry | null = null;
  for (const f of flights) {
    if (!f.date || !parseUtcDate(f.date) || isSimulatorFlight(f)) continue;
    if (f.landings <= 0 && f.totalMinutes <= 0) continue;
    if (!latestLiveFlight || f.date > latestLiveFlight.date) {
      latestLiveFlight = f;
    }
  }
  const latestLiveDate = latestLiveFlight?.date ?? fallbackLastFlightDate;
  let generalFlightItem: MissionCurrencyItem | null = null;
  if (latestLiveDate) {
    const liveElapsed = computeElapsedDays(latestLiveDate, referenceDateIso);
    if (liveElapsed !== null) {
      const liveDaysRemaining = 90 - liveElapsed;
      generalFlightItem = {
        id: 'general_flight',
        label: 'Live Flight Currency',
        shortWindowLabel: '90-day',
        validityDays: 90,
        warningDays: 14,
        requirementNote: 'Recent live flight and landing currency',
        status: classifyCurrencyStatus(liveDaysRemaining, 14),
        lastFlightDate: latestLiveDate,
        lastAircraftType: latestLiveFlight?.aircraftType || null,
        lastExercise: latestLiveFlight?.exercise || null,
        expiresOn: addDaysToIsoDate(latestLiveDate, 90),
        daysSinceLastFlight: liveElapsed,
        daysRemaining: liveDaysRemaining,
      };
    }
  }

  return {
    overallStatus,
    items,
    flaggedItems,
    expiringCount,
    expiredCount,
    currentCount,
    nextDueItem: nonExpired[0] ?? null,
    generalFlightItem,
  };
}

export function formatCurrencyCountdown(item: Pick<MissionCurrencyItem, 'status' | 'daysRemaining'>): string {
  if (item.status === 'expired') {
    const overdue = Math.abs(item.daysRemaining);
    return overdue === 1 ? '1 day overdue' : `${overdue} days overdue`;
  }
  if (item.daysRemaining === 0) {
    return 'Expires today';
  }
  if (item.daysRemaining === 1) {
    return '1 day left';
  }
  return `${item.daysRemaining} days left`;
}
