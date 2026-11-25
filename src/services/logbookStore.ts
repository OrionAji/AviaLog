import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import type {
  AircraftRecord,
  BroughtForwardBaseline,
  ConnectedSheetConfig,
  EngineCategory,
  FlightEntry,
  FlightRoleType,
  FlightSource,
} from '../types/logbook';
import {
  PILOT_AJI_AIRCRAFT,
  PILOT_AJI_BASELINE,
  PILOT_AJI_RECENT_FLIGHTS,
} from '../data/seedLogbook';
import {
  backfillMarksFromCustomFields,
  upgradeConnectedSheetMapping,
} from '../utils/sheetParser';
import { sanitizeThemeMode, type ThemeMode } from '../utils/theme';
import { db, handleFirestoreError, OperationType } from './firebase';

const OWNER_SEED_EMAIL = 'ajigamaliel30@gmail.com';
const VALID_ENGINE_CATEGORIES: EngineCategory[] = [
  'SINGLE ENGINE',
  'JET ENGINE',
  'MULTI ENGINE',
  'SIMULATOR',
];
const VALID_FLIGHT_ROLES: FlightRoleType[] = ['DUAL', 'SOLO', 'PIC', 'SIMULATOR'];
const VALID_SOURCES: FlightSource[] = [
  'manual',
  'google_sheets',
  'appsheet_csv',
  'imported_sheet',
  'photo_scan',
];

export interface UserWorkspaceProfile {
  uid: string;
  email: string;
  pilotName: string;
  baseline: BroughtForwardBaseline | null;
  connectedSheet: ConnectedSheetConfig | null;
  theme: ThemeMode;
}

export function toSafeDocId(raw: string, prefix = 'doc'): string {
  const cleaned = raw
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  if (cleaned.length >= 1) return cleaned;
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function clampString(val: unknown, maxLen: number): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

function clampInt(val: unknown, maxVal: number): number {
  const num = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.min(maxVal, Math.round(num));
}

function sanitizeEngineCategory(val: unknown): EngineCategory {
  return VALID_ENGINE_CATEGORIES.includes(val as EngineCategory)
    ? (val as EngineCategory)
    : 'SINGLE ENGINE';
}

function sanitizeFlightRole(val: unknown): FlightRoleType {
  return VALID_FLIGHT_ROLES.includes(val as FlightRoleType) ? (val as FlightRoleType) : 'DUAL';
}

function sanitizeSource(val: unknown): FlightSource {
  return VALID_SOURCES.includes(val as FlightSource) ? (val as FlightSource) : 'manual';
}

function sanitizeDate(val: unknown): string {
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val.trim())) {
    return val.trim();
  }
  return new Date().toISOString().slice(0, 10);
}

function serializeFlightFields(uid: string, flight: FlightEntry, safeId: string): DocumentData {
  const payload: DocumentData = {
    ownerId: uid,
    id: safeId,
    date: sanitizeDate(flight.date),
    aircraftType: clampString(flight.aircraftType, 64) || 'UNSPECIFIED',
    aircraftMark: clampString(flight.aircraftMark, 64),
    engineCategory: sanitizeEngineCategory(flight.engineCategory),
    instructor: clampString(flight.instructor, 80),
    exercise: clampString(flight.exercise, 160) || 'GENERAL FLIGHT',
    flightType: sanitizeFlightRole(flight.flightType),
    totalMinutes: clampInt(flight.totalMinutes, 1440),
    dualMinutes: clampInt(flight.dualMinutes, 1440),
    soloMinutes: clampInt(flight.soloMinutes, 1440),
    nightMinutes: clampInt(flight.nightMinutes, 1440),
    instrumentMinutes: clampInt(flight.instrumentMinutes, 1440),
    simulatorMinutes: clampInt(flight.simulatorMinutes, 1440),
    takeoffs: clampInt(flight.takeoffs, 200),
    landings: clampInt(flight.landings, 200),
    approaches: clampInt(flight.approaches, 100),
    remarks: clampString(flight.remarks, 1000),
    source: sanitizeSource(flight.source),
  };

  const sortie = clampString(flight.sortie, 64);
  if (sortie) payload.sortie = sortie;
  const dep = clampString(flight.departure, 32);
  if (dep) payload.departure = dep;
  const arr = clampString(flight.arrival, 32);
  if (arr) payload.arrival = arr;
  const route = clampString(flight.route, 160);
  if (route) payload.route = route;
  if (typeof flight.sheetRowNumber === 'number' && Number.isFinite(flight.sheetRowNumber)) {
    payload.sheetRowNumber = clampInt(flight.sheetRowNumber, 1000000);
  }
  if (flight.customFields && Object.keys(flight.customFields).length > 0) {
    const serialized = JSON.stringify(flight.customFields);
    if (serialized.length <= 8000) {
      payload.customFieldsJson = serialized;
    }
  }
  return payload;
}

function buildFlightUpdatePayload(fields: DocumentData): DocumentData {
  const updatePayload: DocumentData = {
    date: fields.date,
    aircraftType: fields.aircraftType,
    aircraftMark: fields.aircraftMark,
    engineCategory: fields.engineCategory,
    instructor: fields.instructor,
    exercise: fields.exercise,
    flightType: fields.flightType,
    totalMinutes: fields.totalMinutes,
    dualMinutes: fields.dualMinutes,
    soloMinutes: fields.soloMinutes,
    nightMinutes: fields.nightMinutes,
    instrumentMinutes: fields.instrumentMinutes,
    simulatorMinutes: fields.simulatorMinutes,
    takeoffs: fields.takeoffs,
    landings: fields.landings,
    approaches: fields.approaches,
    remarks: fields.remarks,
    source: fields.source,
    sortie: fields.sortie ?? '',
    departure: fields.departure ?? '',
    arrival: fields.arrival ?? '',
    route: fields.route ?? '',
    updatedAt: serverTimestamp(),
  };
  if (fields.sheetRowNumber !== undefined) updatePayload.sheetRowNumber = fields.sheetRowNumber;
  if (fields.customFieldsJson !== undefined) {
    updatePayload.customFieldsJson = fields.customFieldsJson;
  }
  return updatePayload;
}

function deserializeFlight(docId: string, data: DocumentData): FlightEntry {
  let customFields: Record<string, string> | undefined;
  if (typeof data.customFieldsJson === 'string' && data.customFieldsJson.trim()) {
    try {
      const parsed = JSON.parse(data.customFieldsJson);
      if (parsed && typeof parsed === 'object') {
        customFields = parsed as Record<string, string>;
      }
    } catch {
      customFields = undefined;
    }
  }

  return {
    id: typeof data.id === 'string' && data.id ? data.id : docId,
    date: typeof data.date === 'string' ? data.date : '',
    aircraftType: typeof data.aircraftType === 'string' ? data.aircraftType : 'UNSPECIFIED',
    aircraftMark: typeof data.aircraftMark === 'string' ? data.aircraftMark : '',
    engineCategory: sanitizeEngineCategory(data.engineCategory),
    instructor: typeof data.instructor === 'string' ? data.instructor : '',
    exercise: typeof data.exercise === 'string' ? data.exercise : '',
    flightType: sanitizeFlightRole(data.flightType),
    sortie: typeof data.sortie === 'string' && data.sortie.trim() ? data.sortie.trim() : undefined,
    departure:
      typeof data.departure === 'string' && data.departure.trim() ? data.departure.trim() : undefined,
    arrival:
      typeof data.arrival === 'string' && data.arrival.trim() ? data.arrival.trim() : undefined,
    route: typeof data.route === 'string' && data.route.trim() ? data.route.trim() : undefined,
    totalMinutes: Number(data.totalMinutes) || 0,
    dualMinutes: Number(data.dualMinutes) || 0,
    soloMinutes: Number(data.soloMinutes) || 0,
    nightMinutes: Number(data.nightMinutes) || 0,
    instrumentMinutes: Number(data.instrumentMinutes) || 0,
    simulatorMinutes: Number(data.simulatorMinutes) || 0,
    takeoffs: Number(data.takeoffs) || 0,
    landings: Number(data.landings) || 0,
    approaches: Number(data.approaches) || 0,
    remarks: typeof data.remarks === 'string' ? data.remarks : '',
    source: sanitizeSource(data.source),
    sheetRowNumber:
      typeof data.sheetRowNumber === 'number' && data.sheetRowNumber > 0
        ? data.sheetRowNumber
        : undefined,
    customFields,
  };
}

function serializeAircraftFields(uid: string, record: AircraftRecord): DocumentData {
  const cleanMarks = Array.from(
    new Set(
      (record.marks ?? [])
        .map((m) => clampString(m, 64))
        .filter((m) => m.length > 0)
    )
  )
    .sort()
    .slice(0, 50);

  const payload: DocumentData = {
    ownerId: uid,
    type: clampString(record.type, 64).toUpperCase() || 'UNKNOWN',
    fullName: clampString(record.fullName, 120) || clampString(record.type, 64) || 'Unknown Aircraft',
    engineCategory: sanitizeEngineCategory(record.engineCategory),
    role: clampString(record.role, 120),
    marks: cleanMarks,
    source: sanitizeSource(record.source),
  };

  const notes = clampString(record.notes, 500);
  if (notes) payload.notes = notes;
  return payload;
}

function deserializeAircraft(data: DocumentData): AircraftRecord {
  return {
    type: typeof data.type === 'string' ? data.type : 'UNKNOWN',
    fullName: typeof data.fullName === 'string' ? data.fullName : 'Unknown Aircraft',
    engineCategory: sanitizeEngineCategory(data.engineCategory),
    role: typeof data.role === 'string' ? data.role : '',
    marks: Array.isArray(data.marks)
      ? data.marks.filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
      : [],
    notes: typeof data.notes === 'string' ? data.notes : undefined,
    source: sanitizeSource(data.source),
  };
}

/**
 * Ensures the signed-in user has their own isolated `/users/{uid}` document.
 * Pilot AJI's historical sheet baseline & recent flights are seeded ONLY for `ajigamaliel30@gmail.com`.
 * Every other account starts with a completely blank, private logbook.
 */
export async function ensureUserWorkspace(
  user: User,
  preferredTheme: ThemeMode = 'light'
): Promise<void> {
  const userPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);

  let exists = false;
  try {
    const snap = await getDoc(userRef);
    exists = snap.exists();
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, userPath);
  }
  if (exists) return;

  const email = (user.email || '').trim();
  const isPilotAjiOwner = email.toLowerCase() === OWNER_SEED_EMAIL;
  const defaultName = isPilotAjiOwner
    ? 'AJI'
    : clampString(user.displayName, 80) || clampString(email.split('@')[0], 80) || 'Pilot';

  const profileDoc: DocumentData = {
    uid: user.uid,
    email,
    pilotName: defaultName,
    baselineJson: isPilotAjiOwner ? JSON.stringify(PILOT_AJI_BASELINE) : '',
    connectedSheetJson: '',
    theme: sanitizeThemeMode(preferredTheme),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(userRef, profileDoc);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, userPath);
  }

  if (isPilotAjiOwner) {
    // Commit flights and aircraft in separate <=10-write batches to stay well below
    // Firestore security-rule get() limits per multi-document batch.
    try {
      const flightsBatch = writeBatch(db);
      for (const flight of PILOT_AJI_RECENT_FLIGHTS) {
        const safeId = toSafeDocId(flight.id, 'flt');
        const fRef = doc(db, 'users', user.uid, 'flights', safeId);
        flightsBatch.set(fRef, {
          ...serializeFlightFields(user.uid, flight, safeId),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      await flightsBatch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `${userPath}/flights`);
    }

    try {
      const aircraftBatch = writeBatch(db);
      for (const ac of PILOT_AJI_AIRCRAFT) {
        const acId = toSafeDocId(ac.type.toUpperCase(), 'ac');
        const aRef = doc(db, 'users', user.uid, 'aircraft', acId);
        aircraftBatch.set(aRef, {
          ...serializeAircraftFields(user.uid, ac),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      await aircraftBatch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `${userPath}/aircraft`);
    }
  }
}

export function subscribeUserProfile(
  uid: string,
  onData: (profile: UserWorkspaceProfile | null) => void,
  onError: (error: Error) => void
) {
  const userPath = `users/${uid}`;
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const data = snap.data();
      let baseline: BroughtForwardBaseline | null = null;
      if (typeof data.baselineJson === 'string' && data.baselineJson.trim()) {
        try {
          baseline = JSON.parse(data.baselineJson) as BroughtForwardBaseline;
        } catch {
          baseline = null;
        }
      }
      let connectedSheet: ConnectedSheetConfig | null = null;
      if (typeof data.connectedSheetJson === 'string' && data.connectedSheetJson.trim()) {
        try {
          connectedSheet = upgradeConnectedSheetMapping(
            JSON.parse(data.connectedSheetJson) as ConnectedSheetConfig
          );
        } catch {
          connectedSheet = null;
        }
      }
      onData({
        uid: typeof data.uid === 'string' ? data.uid : uid,
        email: typeof data.email === 'string' ? data.email : '',
        pilotName: typeof data.pilotName === 'string' ? data.pilotName : 'Pilot',
        baseline,
        connectedSheet,
        theme: sanitizeThemeMode(data.theme),
      });
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.GET, userPath);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}

export function subscribeUserFlights(
  uid: string,
  onData: (flights: FlightEntry[]) => void,
  onError: (error: Error) => void
) {
  const flightsPath = `users/${uid}/flights`;
  const q = query(collection(db, 'users', uid, 'flights'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => deserializeFlight(d.id, d.data()));
      onData(backfillMarksFromCustomFields(list).flights);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, flightsPath);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}

export function subscribeUserAircraft(
  uid: string,
  onData: (aircraft: AircraftRecord[]) => void,
  onError: (error: Error) => void
) {
  const aircraftPath = `users/${uid}/aircraft`;
  const q = query(collection(db, 'users', uid, 'aircraft'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => deserializeAircraft(d.data())));
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, aircraftPath);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}

export async function saveFlightRecord(
  uid: string,
  flight: FlightEntry,
  existingAircraft: AircraftRecord[]
): Promise<FlightEntry> {
  const safeId = toSafeDocId(flight.id, 'flt');
  const flightPath = `users/${uid}/flights/${safeId}`;
  const fRef = doc(db, 'users', uid, 'flights', safeId);

  try {
    const existingSnap = await getDoc(fRef);
    const fields = serializeFlightFields(uid, flight, safeId);

    if (existingSnap.exists()) {
      await updateDoc(fRef, buildFlightUpdatePayload(fields));
    } else {
      await setDoc(fRef, {
        ...fields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    // Ensure the aircraft type & mark are reflected in the user's private fleet collection
    await syncAircraftFromFlights(uid, [flight], existingAircraft);

    return { ...flight, id: safeId };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, flightPath);
  }
}

export async function deleteFlightRecord(uid: string, flightId: string): Promise<void> {
  const safeId = toSafeDocId(flightId, 'flt');
  const flightPath = `users/${uid}/flights/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'flights', safeId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, flightPath);
  }
}

export async function saveAircraftRecord(uid: string, record: AircraftRecord): Promise<void> {
  const normalizedType = clampString(record.type, 64).toUpperCase() || 'UNKNOWN';
  const acId = toSafeDocId(normalizedType, 'ac');
  const aircraftPath = `users/${uid}/aircraft/${acId}`;
  const aRef = doc(db, 'users', uid, 'aircraft', acId);

  try {
    const snap = await getDoc(aRef);
    const fields = serializeAircraftFields(uid, { ...record, type: normalizedType });

    if (snap.exists()) {
      const updatePayload: DocumentData = {
        type: fields.type,
        fullName: fields.fullName,
        engineCategory: fields.engineCategory,
        role: fields.role,
        marks: fields.marks,
        notes: fields.notes ?? '',
        source: fields.source,
        updatedAt: serverTimestamp(),
      };
      await updateDoc(aRef, updatePayload);
    } else {
      await setDoc(aRef, {
        ...fields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, aircraftPath);
  }
}

async function syncAircraftFromFlights(
  uid: string,
  flights: FlightEntry[],
  existingAircraft: AircraftRecord[]
): Promise<void> {
  const byType = new Map<string, AircraftRecord>(
    existingAircraft.map((a) => [a.type.toUpperCase(), { ...a, marks: [...(a.marks ?? [])] }])
  );
  const dirtyTypes = new Set<string>();

  for (const f of flights) {
    const key = clampString(f.aircraftType, 64).toUpperCase();
    if (!key || key === 'UNSPECIFIED') continue;
    const mark = clampString(f.aircraftMark, 64);
    const existing = byType.get(key);
    if (!existing) {
      byType.set(key, {
        type: key,
        fullName: key,
        engineCategory: f.engineCategory,
        role: 'Logged Aircraft',
        marks: mark ? [mark] : [],
        source: f.source,
      });
      dirtyTypes.add(key);
    } else if (mark && !existing.marks?.some((m) => m.toUpperCase() === mark.toUpperCase())) {
      existing.marks = [...(existing.marks ?? []), mark].sort().slice(0, 50);
      dirtyTypes.add(key);
    }
  }

  for (const key of dirtyTypes) {
    const rec = byType.get(key);
    if (rec) {
      await saveAircraftRecord(uid, rec);
    }
  }
}

export async function updateConnectedSheetConfig(
  uid: string,
  sheetConfig: ConnectedSheetConfig | null
): Promise<void> {
  const userPath = `users/${uid}`;
  const serialized = sheetConfig ? JSON.stringify(sheetConfig) : '';
  if (serialized.length > 32000) {
    throw new Error('Sheet metadata exceeds the maximum allowed size.');
  }
  try {
    await updateDoc(doc(db, 'users', uid), {
      connectedSheetJson: serialized,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, userPath);
  }
}

export async function updateUserTheme(uid: string, theme: ThemeMode): Promise<void> {
  const userPath = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      theme: sanitizeThemeMode(theme),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, userPath);
  }
}

export async function importFlightsBatch(
  uid: string,
  imported: FlightEntry[],
  mode: 'merge' | 'replace',
  existingFlights: FlightEntry[],
  existingAircraft: AircraftRecord[],
  sheetConfig?: ConnectedSheetConfig,
  onProgress?: (saved: number, total: number) => void
): Promise<number> {
  const flightsPath = `users/${uid}/flights`;
  // Keep each batch <= 10 writes so every batched write stays well below
  // Firestore security-rule get() limits per multi-document batch.
  const CHUNK_SIZE = 10;

  try {
    // Query live document IDs from Firestore so batch.update vs batch.set and stale deletes
    // never fail due to out-of-sync local state or immutable createdAt constraints.
    const liveSnap = await getDocs(
      query(collection(db, 'users', uid, 'flights'), where('ownerId', '==', uid))
    );
    const liveIdSet = new Set(liveSnap.docs.map((d) => d.id));

    let flightsToWrite: FlightEntry[] = imported;

    if (mode === 'merge') {
      const existingKeys = new Set(
        existingFlights.map(
          (f) =>
            `${f.date}|${f.sortie ?? ''}|${f.aircraftType}|${f.instructor}|${f.exercise}|${f.totalMinutes}|${f.sheetRowNumber ?? ''}`
        )
      );
      flightsToWrite = imported.filter(
        (f) =>
          !existingKeys.has(
            `${f.date}|${f.sortie ?? ''}|${f.aircraftType}|${f.instructor}|${f.exercise}|${f.totalMinutes}|${f.sheetRowNumber ?? ''}`
          )
      );
    }

    // Write all new/updated flights FIRST in safe chunks of 10 so existing data is never lost mid-sync.
    const writtenIds = new Set<string>();
    const totalToWrite = flightsToWrite.length;
    let savedSoFar = 0;
    onProgress?.(0, totalToWrite);

    for (let i = 0; i < flightsToWrite.length; i += CHUNK_SIZE) {
      const chunk = flightsToWrite.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      for (let j = 0; j < chunk.length; j += 1) {
        const flight = chunk[j];
        let safeId = toSafeDocId(flight.id || `imp_${Date.now()}_${i + j}`, 'flt');
        if (writtenIds.has(safeId)) {
          safeId = toSafeDocId(`${safeId}_${i + j}`, 'flt');
        }
        writtenIds.add(safeId);
        const fRef = doc(db, 'users', uid, 'flights', safeId);
        const fields = serializeFlightFields(uid, flight, safeId);
        if (liveIdSet.has(safeId)) {
          batch.update(fRef, buildFlightUpdatePayload(fields));
        } else {
          batch.set(fRef, {
            ...fields,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
      await batch.commit();
      savedSoFar += chunk.length;
      onProgress?.(savedSoFar, totalToWrite);
    }

    if (mode === 'replace') {
      // Remove stale previous flight rows that are not part of the newly committed import
      const staleIds = Array.from(liveIdSet).filter((oldId) => !writtenIds.has(oldId));
      for (let i = 0; i < staleIds.length; i += CHUNK_SIZE) {
        const chunk = staleIds.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(db);
        for (const oldId of chunk) {
          batch.delete(doc(db, 'users', uid, 'flights', oldId));
        }
        await batch.commit();
      }

      // Clear brought-forward baseline and lock in connected sheet metadata
      const profileUpdate: DocumentData = {
        baselineJson: '',
        updatedAt: serverTimestamp(),
      };
      if (sheetConfig) {
        const serialized = JSON.stringify(sheetConfig);
        if (serialized.length <= 32000) {
          profileUpdate.connectedSheetJson = serialized;
        }
      }
      await updateDoc(doc(db, 'users', uid), profileUpdate);
    } else if (sheetConfig) {
      await updateConnectedSheetConfig(uid, sheetConfig);
    }

    await syncAircraftFromFlights(uid, flightsToWrite, existingAircraft);
    return flightsToWrite.length;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, flightsPath);
  }
}
