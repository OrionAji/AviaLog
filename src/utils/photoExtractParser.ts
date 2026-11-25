import type { EngineCategory, FlightEntry, FlightRoleType } from '../types/logbook';
import {
  inferEngineCategory,
  normalizeDateString,
  parseDurationToMinutes,
  parseInteger,
} from './flightMath';

export type ExtractionConfidence = 'high' | 'medium' | 'low';

export interface RawPhotoFlightItem {
  date?: string;
  aircraftType?: string;
  aircraftMark?: string;
  engineCategory?: string;
  instructor?: string;
  exercise?: string;
  flightType?: string;
  sortie?: string;
  departure?: string;
  arrival?: string;
  totalTime?: string;
  dualTime?: string;
  soloTime?: string;
  nightTime?: string;
  instrumentTime?: string;
  simulatorTime?: string;
  takeoffs?: number | string;
  landings?: number | string;
  approaches?: number | string;
  remarks?: string;
  confidence?: string;
}

export interface ExtractedPhotoFlight {
  flight: FlightEntry;
  confidence: ExtractionConfidence;
  selected: boolean;
}

function normalizeFlightRole(raw: string | undefined, engine: EngineCategory): FlightRoleType {
  if (engine === 'SIMULATOR') return 'SIMULATOR';
  const upper = (raw ?? '').trim().toUpperCase();
  if (upper.includes('SIM')) return 'SIMULATOR';
  if (upper.includes('SOLO')) return 'SOLO';
  if (upper.includes('PIC') || upper === 'P1' || upper.includes('CAPTAIN')) return 'PIC';
  return 'DUAL';
}

function normalizeConfidence(raw: string | undefined): ExtractionConfidence {
  const lower = (raw ?? '').trim().toLowerCase();
  if (lower === 'high' || lower === 'medium' || lower === 'low') return lower;
  return 'medium';
}

/**
 * Converts structured raw flight items extracted from a logbook/flight-sheet photo
 * into clean, validated FlightEntry objects ready for review and cloud persistence.
 */
export function normalizeExtractedPhotoFlights(
  rawItems: RawPhotoFlightItem[],
  fallbackDateIso: string
): ExtractedPhotoFlight[] {
  if (!Array.isArray(rawItems)) return [];
  const stamp = Date.now();
  const results: ExtractedPhotoFlight[] = [];

  rawItems.forEach((item, idx) => {
    if (!item || typeof item !== 'object') return;

    const normalizedDate = normalizeDateString(item.date ?? '') || fallbackDateIso;
    const aircraftType = (item.aircraftType ?? '').trim().toUpperCase();
    const aircraftMark = (item.aircraftMark ?? '').trim().toUpperCase();
    const instructor = (item.instructor ?? '').trim().toUpperCase();
    const exercise = (item.exercise ?? '').trim().toUpperCase() || 'GENERAL FLIGHT';
    const sortie = (item.sortie ?? '').trim().toUpperCase();
    const departure = (item.departure ?? '').trim().toUpperCase();
    const arrival = (item.arrival ?? '').trim().toUpperCase();
    const remarks = (item.remarks ?? '').trim();

    let totalMinutes = parseDurationToMinutes(item.totalTime ?? '');
    let dualMinutes = parseDurationToMinutes(item.dualTime ?? '');
    let soloMinutes = parseDurationToMinutes(item.soloTime ?? '');
    const nightMinutes = parseDurationToMinutes(item.nightTime ?? '');
    const instrumentMinutes = parseDurationToMinutes(item.instrumentTime ?? '');
    let simulatorMinutes = parseDurationToMinutes(item.simulatorTime ?? '');

    const engineCategory = inferEngineCategory(aircraftType, item.engineCategory);
    const flightType = normalizeFlightRole(item.flightType, engineCategory);

    if (totalMinutes <= 0) {
      totalMinutes = dualMinutes + soloMinutes + simulatorMinutes;
    }

    // Skip completely empty rows with no aircraft and no duration
    if (!aircraftType && totalMinutes <= 0) return;

    if (engineCategory === 'SIMULATOR' || flightType === 'SIMULATOR') {
      if (simulatorMinutes <= 0) simulatorMinutes = totalMinutes;
      dualMinutes = 0;
      soloMinutes = 0;
    } else if (dualMinutes === 0 && soloMinutes === 0 && totalMinutes > 0) {
      if (flightType === 'SOLO' || flightType === 'PIC') {
        soloMinutes = totalMinutes;
      } else {
        dualMinutes = totalMinutes;
      }
    }

    const parsedTakeoffs =
      item.takeoffs !== undefined && String(item.takeoffs).trim() !== ''
        ? parseInteger(item.takeoffs)
        : 1;
    const parsedLandings =
      item.landings !== undefined && String(item.landings).trim() !== ''
        ? parseInteger(item.landings)
        : 1;
    const approaches = parseInteger(item.approaches ?? 0);

    const route = departure && arrival ? `${departure} - ${arrival}` : undefined;

    const flight: FlightEntry = {
      id: `scan-${stamp}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
      date: normalizedDate,
      aircraftType: aircraftType || 'UNSPECIFIED',
      aircraftMark,
      engineCategory,
      instructor,
      exercise,
      flightType,
      sortie: sortie || undefined,
      departure: departure || undefined,
      arrival: arrival || undefined,
      route,
      totalMinutes: Math.min(1440, totalMinutes),
      dualMinutes: Math.min(1440, dualMinutes),
      soloMinutes: Math.min(1440, soloMinutes),
      nightMinutes: Math.min(totalMinutes || 1440, nightMinutes),
      instrumentMinutes: Math.min(totalMinutes || 1440, instrumentMinutes),
      simulatorMinutes: Math.min(1440, simulatorMinutes),
      takeoffs: Math.min(200, parsedTakeoffs),
      landings: Math.min(200, parsedLandings),
      approaches: Math.min(100, approaches),
      remarks,
      source: 'photo_scan',
    };

    results.push({
      flight,
      confidence: normalizeConfidence(item.confidence),
      selected: true,
    });
  });

  return results;
}
