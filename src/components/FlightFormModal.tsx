import React, { useEffect, useRef, useState } from 'react';
import { Calculator, Camera, ImagePlus, Loader2, Trash2, X } from 'lucide-react';
import type {
  AircraftRecord,
  ConnectedSheetConfig,
  EngineCategory,
  FlightEntry,
  FlightRoleType,
} from '../types/logbook';
import {
  computeBlockMinutes,
  formatHHMM,
  inferEngineCategory,
  parseDurationToMinutes,
  validateFlightEntry,
  type FlightValidationErrors,
} from '../utils/flightMath';
import { extractFlightsFromPhoto, prepareImageForUpload } from '../services/photoScanApi';

interface FlightFormModalProps {
  open: boolean;
  initialFlight: FlightEntry | null;
  aircraftList: AircraftRecord[];
  knownMarks: string[];
  knownInstructors: string[];
  knownExercises: string[];
  knownAirfields?: string[];
  connectedSheet: ConnectedSheetConfig | null;
  isGoogleSignedIn: boolean;
  onClose: () => void;
  onSave: (flight: FlightEntry, syncToSheet: boolean) => void;
  onDelete?: (flight: FlightEntry) => void;
}

const DEFAULT_FORM = {
  date: '2026-11-22',
  sortie: '',
  aircraftType: '',
  aircraftMark: '',
  engineCategory: 'JET ENGINE' as EngineCategory,
  instructor: '',
  exercise: '',
  flightType: 'DUAL' as FlightRoleType,
  totalTimeStr: '',
  nightTimeStr: '',
  instrumentTimeStr: '',
  takeoffs: '1',
  landings: '1',
  approaches: '0',
  blockOut: '',
  blockIn: '',
  departure: '',
  arrival: '',
  remarks: '',
};

export const FlightFormModal: React.FC<FlightFormModalProps> = ({
  open,
  initialFlight,
  aircraftList,
  knownMarks,
  knownInstructors,
  knownExercises,
  knownAirfields = [],
  connectedSheet,
  isGoogleSignedIn,
  onClose,
  onSave,
  onDelete,
}) => {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [errors, setErrors] = useState<FlightValidationErrors>({});
  const [syncToSheet, setSyncToSheet] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanMsg, setScanMsg] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [scannedFromPhoto, setScannedFromPhoto] = useState(false);
  const modalPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const modalCameraInputRef = useRef<HTMLInputElement | null>(null);

  const isEditingExisting = Boolean(initialFlight);

  useEffect(() => {
    if (!open) return;
    if (initialFlight) {
      setForm({
        date: initialFlight.date,
        sortie: initialFlight.sortie ?? '',
        aircraftType: initialFlight.aircraftType,
        aircraftMark: initialFlight.aircraftMark ?? '',
        engineCategory: initialFlight.engineCategory,
        instructor: initialFlight.instructor ?? '',
        exercise: initialFlight.exercise ?? '',
        flightType: initialFlight.flightType,
        totalTimeStr: initialFlight.totalMinutes > 0 ? formatHHMM(initialFlight.totalMinutes) : '',
        nightTimeStr: initialFlight.nightMinutes > 0 ? formatHHMM(initialFlight.nightMinutes) : '',
        instrumentTimeStr:
          initialFlight.instrumentMinutes > 0 ? formatHHMM(initialFlight.instrumentMinutes) : '',
        takeoffs: String(initialFlight.takeoffs),
        landings: String(initialFlight.landings),
        approaches: String(initialFlight.approaches),
        blockOut: '',
        blockIn: '',
        departure: initialFlight.departure ?? '',
        arrival: initialFlight.arrival ?? '',
        remarks: initialFlight.remarks ?? '',
      });
    } else {
      setForm({
        ...DEFAULT_FORM,
        date: new Date().toISOString().slice(0, 10),
      });
    }
    setErrors({});
    setScanMsg(null);
    setScannedFromPhoto(false);
    setSyncToSheet(Boolean(connectedSheet && isGoogleSignedIn));
  }, [open, initialFlight, connectedSheet, isGoogleSignedIn]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const setField = <K extends keyof typeof DEFAULT_FORM>(
    key: K,
    value: (typeof DEFAULT_FORM)[K]
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const applyExtractedFlightToForm = (first: FlightEntry) => {
    setForm((prev) => ({
      ...prev,
      date: first.date || prev.date,
      sortie: first.sortie ?? prev.sortie,
      aircraftType: first.aircraftType || prev.aircraftType,
      aircraftMark: first.aircraftMark || prev.aircraftMark,
      engineCategory: first.engineCategory,
      instructor: first.instructor || prev.instructor,
      exercise: first.exercise || prev.exercise,
      flightType: first.flightType,
      totalTimeStr: first.totalMinutes > 0 ? formatHHMM(first.totalMinutes) : prev.totalTimeStr,
      nightTimeStr: first.nightMinutes > 0 ? formatHHMM(first.nightMinutes) : '',
      instrumentTimeStr: first.instrumentMinutes > 0 ? formatHHMM(first.instrumentMinutes) : '',
      takeoffs: String(first.takeoffs),
      landings: String(first.landings),
      approaches: String(first.approaches),
      departure: first.departure ?? prev.departure,
      arrival: first.arrival ?? prev.arrival,
      remarks: first.remarks || prev.remarks,
    }));
  };

  const handleQuickPhotoFill = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setScanBusy(true);
    setScanMsg(null);
    try {
      const prepared = await prepareImageForUpload(file);
      const res = await extractFlightsFromPhoto(prepared.base64, prepared.mimeType, {
        knownAircraft: aircraftList.map((a) => a.type),
        knownMarks,
      });
      if (res.flights.length === 0) {
        setScanMsg({
          kind: 'error',
          text:
            res.summaryNotes ||
            'No flight details were detected in that photo. Try a clearer picture.',
        });
        return;
      }

      applyExtractedFlightToForm(res.flights[0].flight);
      setScannedFromPhoto(true);
      setScanMsg({
        kind: 'info',
        text:
          res.flights.length > 1
            ? `Filled sortie 1 of ${res.flights.length} from photo. Use Import & Sync -> Camera & Photo Scan to bulk-import all ${res.flights.length} rows at once.`
            : 'Flight fields filled from photo. Review and click Save Flight to lock it in.',
      });
    } catch (err) {
      setScanMsg({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Could not read flight details from photo.',
      });
    } finally {
      setScanBusy(false);
    }
  };

  const handleAircraftChange = (val: string) => {
    const upper = val.toUpperCase();
    const matched = aircraftList.find((a) => a.type.toUpperCase() === upper);
    const engine = matched ? matched.engineCategory : inferEngineCategory(upper);
    setForm((prev) => ({
      ...prev,
      aircraftType: upper,
      engineCategory: engine,
      flightType: engine === 'SIMULATOR' ? 'SIMULATOR' : prev.flightType === 'SIMULATOR' ? 'DUAL' : prev.flightType,
    }));
  };

  const applyBlockCalc = () => {
    const mins = computeBlockMinutes(form.blockOut, form.blockIn);
    if (mins !== null) {
      setField('totalTimeStr', formatHHMM(mins));
    }
  };

  const parseIntSafe = (v: string) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const totalMinutes = parseDurationToMinutes(form.totalTimeStr);
    const nightMinutes = parseDurationToMinutes(form.nightTimeStr);
    const instrumentMinutes = parseDurationToMinutes(form.instrumentTimeStr);
    const isSim = form.engineCategory === 'SIMULATOR' || form.flightType === 'SIMULATOR';

    const dualMinutes = !isSim && form.flightType === 'DUAL' ? totalMinutes : 0;
    const soloMinutes =
      !isSim && (form.flightType === 'SOLO' || form.flightType === 'PIC') ? totalMinutes : 0;
    const simulatorMinutes = isSim ? totalMinutes : 0;

    const candidate: FlightEntry = {
      id: isEditingExisting && initialFlight
        ? initialFlight.id
        : `flt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      date: form.date.trim(),
      aircraftType: form.aircraftType.trim().toUpperCase(),
      aircraftMark: form.aircraftMark.trim().toUpperCase(),
      engineCategory: form.engineCategory,
      instructor: form.instructor.trim().toUpperCase(),
      exercise: form.exercise.trim().toUpperCase(),
      flightType: isSim ? 'SIMULATOR' : form.flightType,
      sortie: form.sortie.trim() || undefined,
      departure: form.departure.trim().toUpperCase() || undefined,
      arrival: form.arrival.trim().toUpperCase() || undefined,
      totalMinutes,
      dualMinutes,
      soloMinutes,
      nightMinutes,
      instrumentMinutes,
      simulatorMinutes,
      takeoffs: parseIntSafe(form.takeoffs),
      landings: parseIntSafe(form.landings),
      approaches: parseIntSafe(form.approaches),
      remarks: form.remarks.trim(),
      source: isEditingExisting && initialFlight
        ? initialFlight.source
        : scannedFromPhoto
          ? 'photo_scan'
          : 'manual',
      sheetRowNumber: isEditingExisting ? initialFlight?.sheetRowNumber : undefined,
      customFields: isEditingExisting ? initialFlight?.customFields : undefined,
    };

    const validationErrors = validateFlightEntry(candidate);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    onSave(candidate, syncToSheet && Boolean(connectedSheet && isGoogleSignedIn));
  };

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-slate-950/45 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="flight-modal-title"
    >
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 id="flight-modal-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {isEditingExisting ? 'Edit Flight Entry' : 'Log New Flight'}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Enter times in HH:MM (e.g., 1:20) or decimal hours (e.g., 1.5)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close flight form"
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-6" noValidate>
          {!isEditingExisting && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 space-y-2.5 dark:border-slate-700 dark:bg-slate-800/60">
              <input
                ref={modalCameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleQuickPhotoFill}
                className="hidden"
              />
              <input
                ref={modalPhotoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/*"
                onChange={handleQuickPhotoFill}
                className="hidden"
              />
              <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-slate-600 dark:text-slate-400">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">Quick-fill from photo:</span> snap
                  or upload a logbook page or flight slip.
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={scanBusy}
                    onClick={() => modalCameraInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    {scanBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-700 dark:text-blue-400" aria-hidden="true" />
                    ) : (
                      <Camera className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                    )}
                    Camera
                  </button>
                  <button
                    type="button"
                    disabled={scanBusy}
                    onClick={() => modalPhotoInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <ImagePlus className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                    Upload Photo
                  </button>
                </div>
              </div>

              {scanMsg && (
                <p
                  className={`text-xs font-medium ${
                    scanMsg.kind === 'error' ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'
                  }`}
                >
                  {scanMsg.text}
                </p>
              )}
            </div>
          )}

          {errors.subTimes && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-800 dark:border-red-900/60 dark:bg-red-950/60 dark:text-red-200"
            >
              {errors.subTimes}
            </div>
          )}

          {/* Sortie & Aircraft */}
          <fieldset className="space-y-4">
            <legend className="text-xs font-semibold text-slate-500 dark:text-slate-400">Sortie & Aircraft</legend>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="flt-date" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Date *
                </label>
                <input
                  id="flt-date"
                  type="date"
                  value={form.date}
                  onChange={(e) => setField('date', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
                {errors.date && <p className="mt-1 text-xs text-red-700 dark:text-red-400">{errors.date}</p>}
              </div>

              <div>
                <label htmlFor="flt-aircraft" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Aircraft *
                </label>
                <input
                  id="flt-aircraft"
                  type="text"
                  list="aji-aircraft-list"
                  placeholder="A-JET"
                  value={form.aircraftType}
                  onChange={(e) => handleAircraftChange(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm uppercase text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
                <datalist id="aji-aircraft-list">
                  {aircraftList.map((a) => (
                    <option key={a.type} value={a.type}>
                      {a.fullName}
                    </option>
                  ))}
                </datalist>
                {errors.aircraftType && (
                  <p className="mt-1 text-xs text-red-700 dark:text-red-400">{errors.aircraftType}</p>
                )}
              </div>

              <div>
                <label htmlFor="flt-engine" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Engine Class
                </label>
                <select
                  id="flt-engine"
                  value={form.engineCategory}
                  onChange={(e) => setField('engineCategory', e.target.value as EngineCategory)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="JET ENGINE">JET ENGINE</option>
                  <option value="SINGLE ENGINE">SINGLE ENGINE</option>
                  <option value="MULTI ENGINE">MULTI ENGINE</option>
                  <option value="SIMULATOR">SIMULATOR</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="flt-mark" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Aircraft Mark
                </label>
                <input
                  id="flt-mark"
                  type="text"
                  list="aji-mark-list"
                  placeholder="e.g., NAF 455"
                  value={form.aircraftMark}
                  onChange={(e) => setField('aircraftMark', e.target.value.toUpperCase())}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm uppercase text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
                <datalist id="aji-mark-list">
                  {Array.from(
                    new Set([
                      ...(aircraftList.find(
                        (a) => a.type.toUpperCase() === form.aircraftType.trim().toUpperCase()
                      )?.marks ?? []),
                      ...knownMarks,
                    ])
                  ).map((mk) => (
                    <option key={mk} value={mk} />
                  ))}
                </datalist>
              </div>

              <div>
                <label htmlFor="flt-instructor" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Instructor / Captain
                </label>
                <input
                  id="flt-instructor"
                  type="text"
                  list="aji-instructor-list"
                  placeholder="ZINGZHI"
                  value={form.instructor}
                  onChange={(e) => setField('instructor', e.target.value.toUpperCase())}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm uppercase text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
                <datalist id="aji-instructor-list">
                  {knownInstructors.map((inst) => (
                    <option key={inst} value={inst} />
                  ))}
                </datalist>
              </div>

              <div>
                <label htmlFor="flt-type" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Type
                </label>
                <select
                  id="flt-type"
                  value={form.flightType}
                  onChange={(e) => setField('flightType', e.target.value as FlightRoleType)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="DUAL">DUAL</option>
                  <option value="SOLO">SOLO</option>
                  <option value="PIC">PIC</option>
                  <option value="SIMULATOR">SIMULATOR</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="flt-sortie" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Sortie
                </label>
                <input
                  id="flt-sortie"
                  type="text"
                  maxLength={64}
                  placeholder="e.g., SR-001"
                  value={form.sortie}
                  onChange={(e) => setField('sortie', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
              </div>

              <div>
                <label htmlFor="flt-from" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  From
                </label>
                <input
                  id="flt-from"
                  type="text"
                  list="aji-airfield-list"
                  maxLength={32}
                  placeholder="e.g., DNKA"
                  value={form.departure}
                  onChange={(e) => setField('departure', e.target.value.toUpperCase())}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm uppercase text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
              </div>

              <div>
                <label htmlFor="flt-to" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  To
                </label>
                <input
                  id="flt-to"
                  type="text"
                  list="aji-airfield-list"
                  maxLength={32}
                  placeholder="e.g., DNAA"
                  value={form.arrival}
                  onChange={(e) => setField('arrival', e.target.value.toUpperCase())}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm uppercase text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
                <datalist id="aji-airfield-list">
                  {knownAirfields.map((af) => (
                    <option key={af} value={af} />
                  ))}
                </datalist>
              </div>
            </div>

            <div>
              <label htmlFor="flt-exercise" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Exercise / Mission *
              </label>
              <input
                id="flt-exercise"
                type="text"
                list="aji-exercise-list"
                placeholder="ARMED RECCE, FORMATION, NAVIGATION..."
                value={form.exercise}
                onChange={(e) => setField('exercise', e.target.value.toUpperCase())}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm uppercase text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
              />
              <datalist id="aji-exercise-list">
                {knownExercises.map((ex) => (
                  <option key={ex} value={ex} />
                ))}
              </datalist>
              {errors.exercise && <p className="mt-1 text-xs text-red-700 dark:text-red-400">{errors.exercise}</p>}
            </div>
          </fieldset>

          {/* Block Time Calculator */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2.5 dark:border-slate-700 dark:bg-slate-800/60">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <Calculator className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" aria-hidden="true" />
              Block Time Calculator (Optional)
            </div>
            <div className="flex flex-wrap items-end gap-2.5">
              <div className="w-32">
                <label htmlFor="block-out" className="block text-[11px] text-slate-500 dark:text-slate-400">
                  Off Chocks (HH:MM)
                </label>
                <input
                  id="block-out"
                  type="text"
                  placeholder="08:15"
                  value={form.blockOut}
                  onChange={(e) => setField('blockOut', e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
              </div>
              <div className="w-32">
                <label htmlFor="block-in" className="block text-[11px] text-slate-500 dark:text-slate-400">
                  On Chocks (HH:MM)
                </label>
                <input
                  id="block-in"
                  type="text"
                  placeholder="09:35"
                  value={form.blockIn}
                  onChange={(e) => setField('blockIn', e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
              </div>
              <button
                type="button"
                onClick={applyBlockCalc}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Calculate Time
              </button>
            </div>
          </div>

          {/* Flight Duration & Counters */}
          <fieldset className="space-y-4">
            <legend className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Duration (HH:MM) & Operations
            </legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="flt-time" className="block text-xs font-medium text-slate-900 dark:text-slate-100">
                  Time (HH:MM) *
                </label>
                <input
                  id="flt-time"
                  type="text"
                  placeholder="1:20"
                  value={form.totalTimeStr}
                  onChange={(e) => setField('totalTimeStr', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-400 bg-white px-3 py-2 font-mono text-sm font-semibold text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
                {errors.totalMinutes && (
                  <p className="mt-1 text-xs text-red-700 dark:text-red-400">{errors.totalMinutes}</p>
                )}
              </div>

              <div>
                <label htmlFor="flt-night" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Night (HH:MM)
                </label>
                <input
                  id="flt-night"
                  type="text"
                  placeholder="0:00"
                  value={form.nightTimeStr}
                  onChange={(e) => setField('nightTimeStr', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
              </div>

              <div>
                <label htmlFor="flt-inst" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Instrument (HH:MM)
                </label>
                <input
                  id="flt-inst"
                  type="text"
                  placeholder="0:00"
                  value={form.instrumentTimeStr}
                  onChange={(e) => setField('instrumentTimeStr', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
              </div>

              <div>
                <label htmlFor="flt-takeoffs" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Take-offs
                </label>
                <input
                  id="flt-takeoffs"
                  type="number"
                  min="0"
                  value={form.takeoffs}
                  onChange={(e) => setField('takeoffs', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label htmlFor="flt-landings" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Landings
                </label>
                <input
                  id="flt-landings"
                  type="number"
                  min="0"
                  value={form.landings}
                  onChange={(e) => setField('landings', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label htmlFor="flt-approaches" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Inst. Approaches
                </label>
                <input
                  id="flt-approaches"
                  type="number"
                  min="0"
                  value={form.approaches}
                  onChange={(e) => setField('approaches', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            </div>
          </fieldset>

          {/* Remarks */}
          <div>
            <label htmlFor="flt-remarks" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Remarks / Debrief Notes (Optional)
            </label>
            <textarea
              id="flt-remarks"
              rows={3}
              placeholder="Sortie notes, range results, weather, or endorsements..."
              value={form.remarks}
              onChange={(e) => setField('remarks', e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>

          {connectedSheet && isGoogleSignedIn && (
            <div className="rounded-lg border border-blue-200 bg-blue-50/60 px-4 py-3 dark:border-blue-900/60 dark:bg-blue-950/40">
              <label className="flex cursor-pointer items-start gap-2.5 text-xs text-slate-800 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={syncToSheet}
                  onChange={(e) => setSyncToSheet(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-600 dark:border-slate-600"
                />
                <span>
                  <span className="font-semibold">
                    {isEditingExisting && initialFlight?.sheetRowNumber
                      ? `Also update Row ${initialFlight.sheetRowNumber}`
                      : 'Also append this sortie'}
                  </span>{' '}
                  in Google Sheet <span className="font-mono">{connectedSheet.spreadsheetTitle}</span> (tab{' '}
                  <span className="font-mono">{connectedSheet.sheetName}</span>). Confirmation required before writing.
                </span>
              </label>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-slate-200 pt-4 dark:border-slate-800">
            <div>
              {isEditingExisting && initialFlight && onDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(initialFlight)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3.5 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 whitespace-nowrap shrink-0 dark:border-red-900/60 dark:bg-slate-900 dark:text-red-400 dark:hover:bg-red-950/50"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Delete Entry
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-blue-700 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-blue-600 whitespace-nowrap shrink-0"
              >
                {isEditingExisting ? 'Save Changes' : 'Save Flight'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
