import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  ImagePlus,
  Loader2,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { FlightEntry, FlightRoleType } from '../types/logbook';
import {
  formatHHMM,
  inferEngineCategory,
  parseDurationToMinutes,
} from '../utils/flightMath';
import type { ExtractedPhotoFlight } from '../utils/photoExtractParser';
import { extractFlightsFromPhoto, prepareImageForUpload } from '../services/photoScanApi';

interface PhotoScanPanelProps {
  knownAircraft: string[];
  knownMarks: string[];
  onSaveExtractedFlights: (
    flights: FlightEntry[],
    onProgress?: (saved: number, total: number) => void
  ) => Promise<number>;
}

export const PhotoScanPanel: React.FC<PhotoScanPanelProps> = ({
  knownAircraft,
  knownMarks,
  onSaveExtractedFlights,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraFallbackInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [summaryNotes, setSummaryNotes] = useState<string>('');
  const [rows, setRows] = useState<ExtractedPhotoFlight[]>([]);
  const [timeInputs, setTimeInputs] = useState<
    Record<string, { total: string; night: string; inst: string }>
  >({});
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const stopCameraStream = () => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    setCameraOpen(false);
  };

  useEffect(() => {
    return () => {
      stopCameraStream();
    };
  }, []);

  useEffect(() => {
    if (cameraOpen && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      void videoRef.current.play().catch(() => {
        // autoplay may need user gesture; video element has muted + playsInline
      });
    }
  }, [cameraOpen]);

  const runExtractionOnBlob = async (blob: Blob) => {
    setScanError(null);
    setSaveNotice(null);
    setScanning(true);
    setRows([]);
    setSummaryNotes('');

    try {
      const prepared = await prepareImageForUpload(blob);
      setPreviewUrl(prepared.previewUrl);

      const res = await extractFlightsFromPhoto(prepared.base64, prepared.mimeType, {
        knownAircraft,
        knownMarks,
      });

      setSummaryNotes(res.summaryNotes);
      setRows(res.flights);
      const nextInputs: Record<string, { total: string; night: string; inst: string }> = {};
      for (const item of res.flights) {
        nextInputs[item.flight.id] = {
          total: formatHHMM(item.flight.totalMinutes),
          night: item.flight.nightMinutes > 0 ? formatHHMM(item.flight.nightMinutes) : '',
          inst: item.flight.instrumentMinutes > 0 ? formatHHMM(item.flight.instrumentMinutes) : '',
        };
      }
      setTimeInputs(nextInputs);

      if (res.flights.length === 0) {
        setScanError(
          res.summaryNotes ||
            'No flight entries were detected in this photo. Try a closer, well-lit picture of your logbook page or flight sheet.'
        );
      }
    } catch (err) {
      setScanError(
        err instanceof Error ? err.message : 'Failed to extract flight details from picture.'
      );
    } finally {
      setScanning(false);
    }
  };

  const handleOpenCamera = async () => {
    setCameraError(null);
    setScanError(null);
    setSaveNotice(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      cameraFallbackInputRef.current?.click();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
    } catch {
      // Fallback cleanly to native mobile camera capture input if getUserMedia is unavailable/denied
      setCameraError(
        'Live camera preview was unavailable in this browser. Opening device photo/camera picker instead.'
      );
      cameraFallbackInputRef.current?.click();
    }
  };

  const handleCaptureFrame = async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    stopCameraStream();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9)
    );
    if (blob) {
      await runExtractionOnBlob(blob);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await runExtractionOnBlob(file);
  };

  const updateRowField = <K extends keyof FlightEntry>(
    id: string,
    key: K,
    value: FlightEntry[K]
  ) => {
    setRows((prev) =>
      prev.map((item) => {
        if (item.flight.id !== id) return item;
        const updated: FlightEntry = { ...item.flight, [key]: value };
        if (key === 'aircraftType') {
          updated.aircraftType = String(value ?? '').toUpperCase();
          updated.engineCategory = inferEngineCategory(updated.aircraftType);
        }
        if (key === 'flightType') {
          const role = value as FlightRoleType;
          const dur = updated.totalMinutes;
          if (role === 'SIMULATOR') {
            updated.engineCategory = 'SIMULATOR';
            updated.simulatorMinutes = dur;
            updated.dualMinutes = 0;
            updated.soloMinutes = 0;
          } else if (role === 'SOLO' || role === 'PIC') {
            updated.soloMinutes = dur;
            updated.dualMinutes = 0;
            updated.simulatorMinutes = 0;
          } else {
            updated.dualMinutes = dur;
            updated.soloMinutes = 0;
            updated.simulatorMinutes = 0;
          }
        }
        return { ...item, flight: updated };
      })
    );
  };

  const updateRowTime = (id: string, field: 'total' | 'night' | 'inst', rawVal: string) => {
    setTimeInputs((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { total: '', night: '', inst: '' }), [field]: rawVal },
    }));

    const mins = parseDurationToMinutes(rawVal);
    setRows((prev) =>
      prev.map((item) => {
        if (item.flight.id !== id) return item;
        const f = { ...item.flight };
        if (field === 'total') {
          f.totalMinutes = mins;
          if (f.flightType === 'SIMULATOR' || f.engineCategory === 'SIMULATOR') {
            f.simulatorMinutes = mins;
            f.dualMinutes = 0;
            f.soloMinutes = 0;
          } else if (f.flightType === 'SOLO' || f.flightType === 'PIC') {
            f.soloMinutes = mins;
            f.dualMinutes = 0;
          } else {
            f.dualMinutes = mins;
            f.soloMinutes = 0;
          }
        } else if (field === 'night') {
          f.nightMinutes = mins;
        } else {
          f.instrumentMinutes = mins;
        }
        return { ...item, flight: f };
      })
    );
  };

  const toggleRowSelected = (id: string) => {
    setRows((prev) =>
      prev.map((item) =>
        item.flight.id === id ? { ...item, selected: !item.selected } : item
      )
    );
  };

  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((item) => item.flight.id !== id));
  };

  const selectedFlights = rows.filter((r) => r.selected).map((r) => r.flight);

  const handleSaveSelected = async () => {
    if (selectedFlights.length === 0) return;
    setSaving(true);
    setScanError(null);
    setSaveNotice(null);
    try {
      const savedCount = await onSaveExtractedFlights(selectedFlights);
      setSaveNotice(
        `Saved & locked ${savedCount} scanned flight${savedCount === 1 ? '' : 's'} into your private cloud logbook.`
      );
      setRows([]);
      setPreviewUrl(null);
      setSummaryNotes('');
    } catch (err) {
      setScanError(
        err instanceof Error
          ? err.message
          : 'Could not save scanned flights to your cloud logbook.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    stopCameraStream();
    setPreviewUrl(null);
    setRows([]);
    setScanError(null);
    setSaveNotice(null);
    setSummaryNotes('');
  };

  return (
    <div className="space-y-5 border-t border-slate-100 pt-5 dark:border-slate-800">
      {/* Hidden inputs for Upload Picture and Mobile Camera Fallback */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/*"
        onChange={handleFileChange}
        className="hidden"
      />
      <input
        ref={cameraFallbackInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />

      {saveNotice && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/60 dark:text-emerald-200"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{saveNotice}</span>
        </div>
      )}

      {cameraError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/60 dark:text-amber-200">
          {cameraError}
        </div>
      )}

      {scanError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-800 dark:border-red-900/60 dark:bg-red-950/60 dark:text-red-200"
        >
          {scanError}
        </div>
      )}

      {/* Capture / Upload Controls */}
      {!cameraOpen && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-5 flex flex-col justify-between gap-4 dark:border-slate-700 dark:bg-slate-800/60">
            <div>
              <div className="flex items-center gap-2">
                <Camera className="h-4 w-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Capture with Camera
                </h3>
              </div>
              <p className="mt-1.5 text-xs text-slate-600 leading-relaxed dark:text-slate-400">
                Point your camera at a paper logbook page, flight authorization card, or sortie
                sheet. AviaLog extracts dates, aircraft types, marks, exercises, and exact{' '}
                <span className="font-mono">HH:MM</span> times for review.
              </p>
            </div>
            <div>
              <button
                type="button"
                onClick={handleOpenCamera}
                disabled={scanning || saving}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap"
              >
                <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                Open Camera
              </button>
            </div>
          </div>

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const dropped = e.dataTransfer.files?.[0];
              if (dropped && dropped.type.startsWith('image/')) {
                void runExtractionOnBlob(dropped);
              }
            }}
            className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-5 flex flex-col justify-between gap-4 dark:border-slate-700 dark:bg-slate-800/60"
          >
            <div>
              <div className="flex items-center gap-2">
                <ImagePlus className="h-4 w-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Upload Logbook Picture
                </h3>
              </div>
              <p className="mt-1.5 text-xs text-slate-600 leading-relaxed dark:text-slate-400">
                Drop a photo here or pick an image from your gallery (JPEG, PNG, WebP, or HEIC).
                Works for single sorties or multi-row logbook pages.
              </p>
            </div>
            <div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={scanning || saving}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                Choose Picture
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live Camera Viewfinder */}
      {cameraOpen && (
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5 text-xs text-slate-200">
            <span className="font-medium">Align your logbook page or sortie sheet in frame</span>
            <button
              type="button"
              onClick={stopCameraStream}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </button>
          </div>
          <div className="relative bg-black flex items-center justify-center max-h-[420px] overflow-hidden">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full max-h-[420px] object-contain"
            />
          </div>
          <div className="flex items-center justify-center gap-3 bg-slate-900 px-4 py-3">
            <button
              type="button"
              onClick={handleCaptureFrame}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-blue-700"
            >
              <Camera className="h-4 w-4" aria-hidden="true" />
              Capture &amp; Extract Flights
            </button>
          </div>
        </div>
      )}

      {/* Scanning Indicator */}
      {scanning && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-8 text-center dark:border-slate-700 dark:bg-slate-800/60">
          <Loader2 className="h-6 w-6 animate-spin text-blue-700 dark:text-blue-400" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Reading flight entries from picture...
            </p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Extracting dates, aircraft types, airframe marks, exercises, and exact HH:MM hours.
            </p>
          </div>
        </div>
      )}

      {/* Extracted Review Table + Side Thumbnail */}
      {!scanning && (rows.length > 0 || previewUrl) && (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              {previewUrl && (
                <img
                  src={previewUrl}
                  alt="Scanned logbook source"
                  className="h-14 w-20 rounded-lg border border-slate-200 object-cover shrink-0 dark:border-slate-700"
                />
              )}
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {rows.length > 0
                    ? `Review Extracted Flights (${rows.length} detected)`
                    : 'Scanned Picture'}
                </h3>
                {summaryNotes && (
                  <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{summaryNotes}</p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleReset}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Scan Another
              </button>
              {rows.length > 0 && (
                <button
                  type="button"
                  onClick={handleSaveSelected}
                  disabled={saving || selectedFlights.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      Saving to Cloud...
                    </>
                  ) : (
                    <>
                      Save {selectedFlights.length} Flight
                      {selectedFlights.length === 1 ? '' : 's'} to Logbook
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {rows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full min-w-[1160px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
                    <th className="px-2.5 py-2.5 text-center">Use</th>
                    <th className="px-2.5 py-2.5">Date</th>
                    <th className="px-2.5 py-2.5">Aircraft</th>
                    <th className="px-2.5 py-2.5">Mark</th>
                    <th className="px-2.5 py-2.5">From</th>
                    <th className="px-2.5 py-2.5">To</th>
                    <th className="px-2.5 py-2.5">Instructor</th>
                    <th className="px-2.5 py-2.5">Sortie</th>
                    <th className="px-2.5 py-2.5">Exercise</th>
                    <th className="px-2.5 py-2.5">Type</th>
                    <th className="px-2.5 py-2.5">Time</th>
                    <th className="px-2.5 py-2.5">T/O</th>
                    <th className="px-2.5 py-2.5">Ldg</th>
                    <th className="px-2.5 py-2.5">Night</th>
                    <th className="px-2.5 py-2.5">Inst</th>
                    <th className="px-2.5 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {rows.map(({ flight: f, confidence, selected }) => {
                    const t = timeInputs[f.id] ?? {
                      total: formatHHMM(f.totalMinutes),
                      night: f.nightMinutes > 0 ? formatHHMM(f.nightMinutes) : '',
                      inst: f.instrumentMinutes > 0 ? formatHHMM(f.instrumentMinutes) : '',
                    };
                    return (
                      <tr key={f.id} className={selected ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/70 opacity-60 dark:bg-slate-800/40'}>
                        <td className="px-2.5 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleRowSelected(f.id)}
                            aria-label={`Select flight ${f.date} ${f.aircraftType}`}
                            className="h-3.5 w-3.5 rounded border-slate-300 text-blue-700 dark:border-slate-600"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="date"
                            value={f.date}
                            onChange={(e) => updateRowField(f.id, 'date', e.target.value)}
                            className="w-[122px] rounded border border-slate-200 bg-white px-1.5 py-1 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={f.aircraftType}
                            onChange={(e) => updateRowField(f.id, 'aircraftType', e.target.value)}
                            className="w-20 rounded border border-slate-200 bg-white px-1.5 py-1 font-mono text-xs font-semibold uppercase text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={f.aircraftMark}
                            placeholder="Mark"
                            onChange={(e) => updateRowField(f.id, 'aircraftMark', e.target.value)}
                            className="w-20 rounded border border-slate-200 bg-white px-1.5 py-1 font-mono text-xs uppercase text-slate-800 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={f.departure ?? ''}
                            placeholder="From"
                            maxLength={32}
                            onChange={(e) =>
                              updateRowField(
                                f.id,
                                'departure',
                                e.target.value.toUpperCase() || undefined
                              )
                            }
                            className="w-16 rounded border border-slate-200 bg-white px-1.5 py-1 font-mono text-xs uppercase text-slate-800 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={f.arrival ?? ''}
                            placeholder="To"
                            maxLength={32}
                            onChange={(e) =>
                              updateRowField(
                                f.id,
                                'arrival',
                                e.target.value.toUpperCase() || undefined
                              )
                            }
                            className="w-16 rounded border border-slate-200 bg-white px-1.5 py-1 font-mono text-xs uppercase text-slate-800 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={f.instructor}
                            placeholder="—"
                            onChange={(e) =>
                              updateRowField(f.id, 'instructor', e.target.value.toUpperCase())
                            }
                            className="w-24 rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-800 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={f.sortie ?? ''}
                            placeholder="Sortie Ref"
                            maxLength={64}
                            onChange={(e) =>
                              updateRowField(
                                f.id,
                                'sortie',
                                e.target.value || undefined
                              )
                            }
                            className="w-20 rounded border border-slate-200 bg-white px-1.5 py-1 font-mono text-xs text-slate-800 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={f.exercise}
                            onChange={(e) =>
                              updateRowField(f.id, 'exercise', e.target.value.toUpperCase())
                            }
                            className="w-36 rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-800 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <select
                            value={f.flightType}
                            onChange={(e) =>
                              updateRowField(f.id, 'flightType', e.target.value as FlightRoleType)
                            }
                            className="rounded border border-slate-200 bg-white px-1.5 py-1 font-mono text-[11px] text-slate-800 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                          >
                            <option value="DUAL">DUAL</option>
                            <option value="SOLO">SOLO</option>
                            <option value="PIC">PIC</option>
                            <option value="SIMULATOR">SIM</option>
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={t.total}
                            placeholder="1:20"
                            onChange={(e) => updateRowTime(f.id, 'total', e.target.value)}
                            className="w-16 rounded border border-slate-200 bg-white px-1.5 py-1 text-right font-mono text-xs font-semibold text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min={0}
                            max={200}
                            value={f.takeoffs}
                            onChange={(e) =>
                              updateRowField(f.id, 'takeoffs', Math.max(0, Number(e.target.value) || 0))
                            }
                            className="w-12 rounded border border-slate-200 bg-white px-1.5 py-1 text-right font-mono text-xs text-slate-800 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min={0}
                            max={200}
                            value={f.landings}
                            onChange={(e) =>
                              updateRowField(f.id, 'landings', Math.max(0, Number(e.target.value) || 0))
                            }
                            className="w-12 rounded border border-slate-200 bg-white px-1.5 py-1 text-right font-mono text-xs text-slate-800 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={t.night}
                            placeholder="0:00"
                            onChange={(e) => updateRowTime(f.id, 'night', e.target.value)}
                            className="w-14 rounded border border-slate-200 bg-white px-1.5 py-1 text-right font-mono text-xs text-slate-700 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={t.inst}
                            placeholder="0:00"
                            onChange={(e) => updateRowTime(f.id, 'inst', e.target.value)}
                            className="w-14 rounded border border-slate-200 bg-white px-1.5 py-1 text-right font-mono text-xs text-slate-700 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          />
                        </td>
                        <td className="px-2.5 py-2 text-right whitespace-nowrap">
                          <span
                            className={`mr-2 text-[10px] font-medium ${
                              confidence === 'low' ? 'text-amber-700 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500'
                            }`}
                          >
                            {confidence === 'low' ? 'Check' : ''}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeRow(f.id)}
                            aria-label="Remove extracted row"
                            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/60 dark:hover:text-red-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
