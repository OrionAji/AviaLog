import React, { useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Camera,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FolderPlus,
  Layers,
  Loader2,
  Lock,
  LogOut,
  RefreshCw,
  Table2,
  Upload,
} from 'lucide-react';
import type {
  AppSheetSchemaField,
  BroughtForwardBaseline,
  CanonicalFlightField,
  ColumnMapping,
  ConnectedSheetConfig,
  FlightEntry,
} from '../types/logbook';
import {
  autoDetectColumnMapping,
  CANONICAL_FIELDS,
  detectAppSheetHeaders,
  extractHeadersAndDataRows,
  extractSpreadsheetId,
  isDashboardSummaryCsv,
  mapRowsToFlights,
  parseAppSheetSchemaText,
  parseDelimitedText,
} from '../utils/sheetParser';
import {
  fetchSpreadsheetMetadata,
  fetchSheetValues,
  GoogleSheetsAuthExpiredError,
  type SpreadsheetMetadata,
} from '../services/googleSheetsApi';
import { SAMPLE_APPSHEET_SCHEMA, SAMPLE_FLIGHTS_TAB_CSV } from '../data/seedLogbook';
import { GoogleSignInButton } from './GoogleSignInButton';
import { PhotoScanPanel } from './PhotoScanPanel';
import { formatHHMM, formatShortSheetDate } from '../utils/flightMath';

interface ImportSyncViewProps {
  user: User | null;
  accessToken: string | null;
  isSigningIn: boolean;
  authError: string | null;
  connectedSheet: ConnectedSheetConfig | null;
  baseline: BroughtForwardBaseline | null;
  totalFlightsCount: number;
  knownAircraft: string[];
  knownMarks: string[];
  onGoogleSignIn: () => Promise<void>;
  onGoogleSignOut: () => Promise<void>;
  onImportFlights: (
    flights: FlightEntry[],
    mode: 'merge' | 'replace',
    sheetConfig?: ConnectedSheetConfig,
    onProgress?: (saved: number, total: number) => void
  ) => Promise<number>;
  onRequestPushFullLogbook: () => void;
  onRequestCreateNewSheet: () => void;
  onExportCsv: () => void;
  onExportJson: () => void;
  onDisconnectSheet: () => void;
  onSheetsAuthExpired?: () => void;
}

type ImportTab = 'sheets' | 'photo' | 'appsheet';

export const ImportSyncView: React.FC<ImportSyncViewProps> = ({
  user,
  accessToken,
  isSigningIn,
  authError,
  connectedSheet,
  baseline,
  totalFlightsCount,
  knownAircraft,
  knownMarks,
  onGoogleSignIn,
  onGoogleSignOut,
  onImportFlights,
  onRequestPushFullLogbook,
  onRequestCreateNewSheet,
  onExportCsv,
  onExportJson,
  onDisconnectSheet,
  onSheetsAuthExpired,
}) => {
  const [activeTab, setActiveTab] = useState<ImportTab>('sheets');

  const [sheetUrlInput, setSheetUrlInput] = useState(connectedSheet?.spreadsheetId ?? '');
  const [sheetMeta, setSheetMeta] = useState<SpreadsheetMetadata | null>(null);
  const [selectedTabName, setSelectedTabName] = useState<string>(connectedSheet?.sheetName ?? '');
  const [isLoadingSheet, setIsLoadingSheet] = useState(false);
  const [isSavingImport, setIsSavingImport] = useState(false);
  const [saveProgress, setSaveProgress] = useState<{ saved: number; total: number } | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const [previewSource, setPreviewSource] = useState<'google_sheets' | 'appsheet_csv' | null>(null);
  const [previewTitle, setPreviewTitle] = useState<string>('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [startingSheetRow, setStartingSheetRow] = useState<number>(2);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('replace');
  const [importNotice, setImportNotice] = useState<string | null>(null);

  const [rawCsvInput, setRawCsvInput] = useState('');
  const [schemaInput, setSchemaInput] = useState('');
  const [parsedSchema, setParsedSchema] = useState<AppSheetSchemaField[]>([]);

  const appSheetDetected = useMemo(() => detectAppSheetHeaders(headers), [headers]);

  const mappedPreview = useMemo(() => {
    if (headers.length === 0 || dataRows.length === 0 || !previewSource) {
      return null;
    }
    return mapRowsToFlights(headers, dataRows, mapping, previewSource, startingSheetRow);
  }, [headers, dataRows, mapping, previewSource, startingSheetRow]);

  const previewFieldCounts = useMemo(() => {
    if (!mappedPreview) return { mark: 0, route: 0, sortie: 0 };
    let mark = 0;
    let route = 0;
    let sortie = 0;
    for (const f of mappedPreview.flights) {
      if (f.aircraftMark?.trim()) mark++;
      if (f.departure?.trim() || f.arrival?.trim()) route++;
      if (f.sortie?.trim()) sortie++;
    }
    return { mark, route, sortie };
  }, [mappedPreview]);

  const firstSampleValues = useMemo(() => {
    return headers.map((_, idx) => {
      for (let r = 0; r < dataRows.length; r++) {
        const val = String(dataRows[r]?.[idx] ?? '').trim();
        if (val) return val;
      }
      return '';
    });
  }, [headers, dataRows]);

  const handleLoadSpreadsheetMetadata = async () => {
    setSheetError(null);
    setImportNotice(null);
    const id = extractSpreadsheetId(sheetUrlInput);
    if (!id) {
      setSheetError(
        'Paste a valid Google Sheets URL (https://docs.google.com/spreadsheets/d/...) or Spreadsheet ID.'
      );
      return;
    }
    if (!accessToken) {
      setSheetError('Sign in with Google first to read your spreadsheet.');
      return;
    }
    setIsLoadingSheet(true);
    try {
      const meta = await fetchSpreadsheetMetadata(id, accessToken);
      setSheetMeta(meta);
      // Automatically prefer a tab named "Flights" if present in Pilot AJI's spreadsheet
      const flightsTab =
        meta.tabs.find((t) => t.title.trim().toLowerCase() === 'flights') ??
        meta.tabs.find((t) => /flight|logbook/i.test(t.title)) ??
        meta.tabs[0];
      const defaultTab = flightsTab?.title ?? '';
      setSelectedTabName(defaultTab);
      if (defaultTab) {
        await loadRowsFromTab(meta.spreadsheetId, meta.title, defaultTab, accessToken);
      }
    } catch (err: unknown) {
      if (err instanceof GoogleSheetsAuthExpiredError) {
        onSheetsAuthExpired?.();
      }
      setSheetError(
        err instanceof Error ? err.message : 'Unable to load Google Sheet metadata.'
      );
    } finally {
      setIsLoadingSheet(false);
    }
  };

  const loadRowsFromTab = async (
    spreadsheetId: string,
    title: string,
    tabName: string,
    token: string
  ) => {
    setIsLoadingSheet(true);
    setSheetError(null);
    try {
      const values = await fetchSheetValues(spreadsheetId, tabName, token);
      if (values.length < 2) {
        setSheetError(`Tab "${tabName}" has fewer than 2 rows.`);
        setHeaders([]);
        setDataRows([]);
        return;
      }
      if (isDashboardSummaryCsv(values)) {
        setSheetError(
          `Tab "${tabName}" looks like your Dashboard summary tab. Select the "Flights" tab from the dropdown above to import all individual flight rows.`
        );
        setHeaders([]);
        setDataRows([]);
        return;
      }
      const extracted = extractHeadersAndDataRows(values);
      setHeaders(extracted.headers);
      setDataRows(extracted.dataRows);
      setStartingSheetRow(extracted.startingSheetRow);
      setMapping(autoDetectColumnMapping(extracted.headers, extracted.dataRows));
      setPreviewSource('google_sheets');
      setPreviewTitle(`${title} — ${tabName}`);
    } catch (err: unknown) {
      if (err instanceof GoogleSheetsAuthExpiredError) {
        onSheetsAuthExpired?.();
      }
      setSheetError(
        err instanceof Error ? err.message : 'Unable to read rows from selected sheet tab.'
      );
    } finally {
      setIsLoadingSheet(false);
    }
  };

  const handlePullConnectedSheet = async () => {
    if (!connectedSheet) return;
    if (!accessToken) {
      setSheetError('Sign in with Google to pull the latest rows from your connected sheet.');
      return;
    }
    setSheetUrlInput(connectedSheet.spreadsheetId);
    setSelectedTabName(connectedSheet.sheetName);
    await loadRowsFromTab(
      connectedSheet.spreadsheetId,
      connectedSheet.spreadsheetTitle,
      connectedSheet.sheetName,
      accessToken
    );
  };

  const loadDelimitedContent = (text: string, label: string) => {
    setSheetError(null);
    setImportNotice(null);
    const trimmed = text.trim();
    if (!trimmed) {
      setSheetError('Paste CSV/TSV rows or upload a file first.');
      return;
    }

    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
          const keys = Array.from(
            new Set(parsed.flatMap((obj: Record<string, unknown>) => Object.keys(obj)))
          );
          const rows = parsed.map((obj: Record<string, unknown>) =>
            keys.map((k) => (obj[k] === undefined || obj[k] === null ? '' : String(obj[k])))
          );
          setHeaders(keys);
          setDataRows(rows);
          setMapping(autoDetectColumnMapping(keys, rows));
          setPreviewSource('appsheet_csv');
          setPreviewTitle(label);
          return;
        }
      } catch {
        // fall through
      }
    }

    const parsed = parseDelimitedText(trimmed);
    if (parsed.length < 2) {
      setSheetError('Could not detect a header row and at least one flight row.');
      return;
    }
    if (isDashboardSummaryCsv(parsed)) {
      setSheetError(
        'This file is the Dashboard summary tab (already loaded as your career totals!). To import all 216 individual rows, export the "Flights" tab as CSV or connect your live Google Sheet.'
      );
      setHeaders([]);
      setDataRows([]);
      return;
    }

    const extracted = extractHeadersAndDataRows(parsed);
    setHeaders(extracted.headers);
    setDataRows(extracted.dataRows);
    setStartingSheetRow(extracted.startingSheetRow);
    setMapping(autoDetectColumnMapping(extracted.headers, extracted.dataRows));
    setPreviewSource('appsheet_csv');
    setPreviewTitle(label);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result ?? '');
      setRawCsvInput(content);
      loadDelimitedContent(content, file.name);
    };
    reader.readAsText(file);
  };

  const handleLoadSampleFlightsCsv = () => {
    setActiveTab('appsheet');
    setImportMode('merge');
    setRawCsvInput(SAMPLE_FLIGHTS_TAB_CSV);
    loadDelimitedContent(SAMPLE_FLIGHTS_TAB_CSV, 'Sample Flights Tab CSV');
  };

  const handleAnalyzeSchema = (textToParse?: string) => {
    const source = textToParse ?? schemaInput;
    setParsedSchema(parseAppSheetSchemaText(source));
  };

  const handleLoadSampleSchema = () => {
    setSchemaInput(SAMPLE_APPSHEET_SCHEMA);
    handleAnalyzeSchema(SAMPLE_APPSHEET_SCHEMA);
  };

  const handleConfirmImport = async () => {
    if (!mappedPreview || mappedPreview.flights.length === 0 || isSavingImport) return;

    let sheetConfig: ConnectedSheetConfig | undefined;
    if (previewSource === 'google_sheets') {
      const spId =
        sheetMeta?.spreadsheetId ??
        connectedSheet?.spreadsheetId ??
        extractSpreadsheetId(sheetUrlInput);
      const spTitle = sheetMeta?.title ?? connectedSheet?.spreadsheetTitle ?? 'Pilot Flight Logbook';
      const tab = selectedTabName || connectedSheet?.sheetName || 'Flights';
      if (spId) {
        sheetConfig = {
          spreadsheetId: spId,
          spreadsheetTitle: spTitle,
          sheetName: tab,
          headers,
          mapping,
          lastSyncedAt: new Date().toISOString(),
          rowCount: mappedPreview.flights.length,
          appSheetDetected,
        };
      }
    }

    setIsSavingImport(true);
    setSheetError(null);
    setImportNotice(null);
    setSaveProgress({ saved: 0, total: mappedPreview.flights.length });

    try {
      const savedCount = await onImportFlights(
        mappedPreview.flights,
        importMode,
        sheetConfig,
        (saved, total) => setSaveProgress({ saved, total })
      );
      setImportNotice(
        `Synced & locked ${savedCount} flight${
          savedCount === 1 ? '' : 's'
        } into your private cloud logbook (${
          importMode === 'replace'
            ? 'full Flights tab saved — stays locked in even after you sign out'
            : 'merged & permanently saved to your account'
        }).`
      );
      setHeaders([]);
      setDataRows([]);
      setPreviewSource(null);
    } catch (err) {
      setSheetError(
        err instanceof Error
          ? err.message
          : 'Could not save synced flights to your private cloud logbook. Please try again.'
      );
    } finally {
      setIsSavingImport(false);
      setSaveProgress(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Google Sheets & AppSheet Import Hub
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              {baseline ? (
                <>
                  Your carried-forward Dashboard totals and recent sorties are loaded. Connect your
                  live Google Sheet and select the{' '}
                  <span className="font-mono font-medium text-slate-800 dark:text-slate-200">Flights</span> tab to pull
                  all rows and enable two-way sync with AppSheet.
                </>
              ) : (
                <>
                  Connect your private Google Sheet or upload an AppSheet CSV export to import your
                  flight history, map aircraft marks, and enable two-way sync.
                </>
              )}
            </p>
          </div>

          <div
            className="inline-flex flex-wrap rounded-lg bg-slate-100 p-1 self-start lg:self-auto shrink-0 dark:bg-slate-800"
            role="tablist"
            aria-label="Import source"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'sheets'}
              onClick={() => setActiveTab('sheets')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
                activeTab === 'sheets'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
              Google Sheets Sync
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'photo'}
              onClick={() => setActiveTab('photo')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
                activeTab === 'photo'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              <Camera className="h-3.5 w-3.5" aria-hidden="true" />
              Camera &amp; Photo Scan
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'appsheet'}
              onClick={() => setActiveTab('appsheet')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
                activeTab === 'appsheet'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              <Layers className="h-3.5 w-3.5" aria-hidden="true" />
              Flights CSV &amp; Schema
            </button>
          </div>
        </div>

        {(connectedSheet || (totalFlightsCount > 0 && !baseline)) && (
          <div className="flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-xs text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-200">
            <Lock className="h-4 w-4 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <span className="font-semibold">
                {totalFlightsCount} flight{totalFlightsCount === 1 ? '' : 's'} locked in your private cloud logbook.
              </span>{' '}
              Your synced flights, sorties, routes, and aircraft marks stay permanently saved across sign-outs — you only need to reconnect Google Sheets when pulling new rows or pushing updates.
            </div>
          </div>
        )}

        {baseline && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
            <span className="font-semibold text-slate-900 dark:text-slate-100">Currently loaded:</span> {baseline.label} plus your 10 most recent flights. Importing your full <span className="font-mono">Flights</span> tab in <span className="font-semibold">Replace (Full Flights Tab)</span> mode will permanently save every individual row into your private cloud logbook.
          </div>
        )}

        {importNotice && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/60 dark:text-emerald-200"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{importNotice}</span>
          </div>
        )}

        {authError && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-800 dark:border-red-900/60 dark:bg-red-950/60 dark:text-red-200"
          >
            {authError}
          </div>
        )}

        {sheetError && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-800 dark:border-red-900/60 dark:bg-red-950/60 dark:text-red-200"
          >
            {sheetError}
          </div>
        )}

        {/* TAB 1: Google Sheets Live Sync */}
        {activeTab === 'sheets' && (
          <div className="space-y-5 border-t border-slate-100 pt-5 dark:border-slate-800">
            <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-slate-50/70 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-700 dark:bg-slate-800/60">
              <div>
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  1. Google Sheets Account Connection
                </p>
                {user && accessToken ? (
                  <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                    Authorized as <span className="font-medium text-slate-900 dark:text-slate-100">{user.email}</span> · Google Sheets access active for this session
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                    Authorize Google Sheets access to read your <span className="font-mono">Flights</span> tab directly and append new sorties back with your confirmation.
                  </p>
                )}
              </div>

              <div className="flex items-center gap-3 shrink-0">
                {user && accessToken ? (
                  <button
                    type="button"
                    onClick={onGoogleSignOut}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                    Disconnect Sheets
                  </button>
                ) : (
                  <GoogleSignInButton
                    onClick={onGoogleSignIn}
                    disabled={isSigningIn}
                    label={isSigningIn ? 'Authorizing...' : 'Connect Google Sheets'}
                  />
                )}
              </div>
            </div>

            {connectedSheet && (
              <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-900/60 dark:bg-blue-950/40">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      Connected Spreadsheet: {connectedSheet.spreadsheetTitle}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                      Tab: {connectedSheet.sheetName} · {connectedSheet.rowCount} imported rows
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handlePullConnectedSheet}
                      disabled={isLoadingSheet || !accessToken}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                      Pull Latest
                    </button>
                    <button
                      type="button"
                      onClick={onRequestPushFullLogbook}
                      disabled={!accessToken}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      Sync All ({totalFlightsCount}) to Sheet
                    </button>
                    <button
                      type="button"
                      onClick={onDisconnectSheet}
                      className="text-xs font-medium text-slate-500 hover:text-red-700 px-2 py-1 whitespace-nowrap shrink-0 dark:text-slate-400 dark:hover:text-red-400"
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <label
                htmlFor="sheet-url-input"
                className="block text-xs font-semibold text-slate-900 dark:text-slate-100"
              >
                2. Paste your Pilot_Logbook_AppSheet Google Sheets URL or Spreadsheet ID
              </label>
              <div className="flex flex-col gap-2.5 sm:flex-row">
                <input
                  id="sheet-url-input"
                  type="text"
                  value={sheetUrlInput}
                  onChange={(e) => setSheetUrlInput(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
                <button
                  type="button"
                  onClick={handleLoadSpreadsheetMetadata}
                  disabled={isLoadingSheet}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 dark:bg-blue-700 dark:hover:bg-blue-800"
                >
                  <Table2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {isLoadingSheet ? 'Loading...' : 'Load Tabs'}
                </button>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                When tabs load, AviaLog automatically picks your <span className="font-mono font-medium text-slate-700 dark:text-slate-200">Flights</span> tab (skipping the Dashboard summary tab).
              </p>
            </div>

            {sheetMeta && (
              <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-700 dark:bg-slate-800/60">
                <div>
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{sheetMeta.title}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {sheetMeta.tabs.length} worksheet tab{sheetMeta.tabs.length === 1 ? '' : 's'} found
                  </p>
                </div>
                <select
                  value={selectedTabName}
                  onChange={(e) => {
                    const nextTab = e.target.value;
                    setSelectedTabName(nextTab);
                    if (accessToken) {
                      loadRowsFromTab(sheetMeta.spreadsheetId, sheetMeta.title, nextTab, accessToken);
                    }
                  }}
                  aria-label="Select spreadsheet tab"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  {sheetMeta.tabs.map((t) => (
                    <option key={t.sheetId} value={t.title}>
                      {t.title} ({t.rowCount} rows)
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={onRequestCreateNewSheet}
                  disabled={!accessToken}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
                  Create New Logbook Sheet
                </button>
                <button
                  type="button"
                  onClick={handleLoadSampleFlightsCsv}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-medium text-blue-800 hover:bg-blue-100 whitespace-nowrap shrink-0 dark:border-blue-900/60 dark:bg-blue-950/60 dark:text-blue-300 dark:hover:bg-blue-900/50"
                >
                  Test Flights Tab Column Mapper
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onExportCsv}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  CSV Backup
                </button>
                <button
                  type="button"
                  onClick={onExportJson}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  JSON Backup
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Camera & Photo Scan */}
        {activeTab === 'photo' && (
          <PhotoScanPanel
            knownAircraft={knownAircraft}
            knownMarks={knownMarks}
            onSaveExtractedFlights={(extracted, onProgress) =>
              onImportFlights(extracted, 'merge', undefined, onProgress)
            }
          />
        )}

        {/* TAB 3: Flights CSV / TSV / Schema */}
        {activeTab === 'appsheet' && (
          <div className="space-y-6 border-t border-slate-100 pt-5 dark:border-slate-800">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="appsheet-csv-textarea"
                    className="text-xs font-semibold text-slate-900 dark:text-slate-100"
                  >
                    Upload or Paste Your Flights Tab CSV / TSV
                  </label>
                  <button
                    type="button"
                    onClick={handleLoadSampleFlightsCsv}
                    className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap shrink-0 dark:text-blue-400"
                  >
                    Load Sample Flights CSV
                  </button>
                </div>
                <textarea
                  id="appsheet-csv-textarea"
                  rows={6}
                  value={rawCsvInput}
                  onChange={(e) => setRawCsvInput(e.target.value)}
                  placeholder="In Google Sheets, click the 'Flights' tab -> File -> Download -> CSV, then upload or paste it here..."
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus:bg-slate-800"
                />
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => loadDelimitedContent(rawCsvInput, 'Pasted Flights Table')}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap shrink-0 dark:bg-blue-700 dark:hover:bg-blue-800"
                  >
                    Parse & Map Columns
                  </button>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
                    <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                    Upload Flights .csv / .tsv
                    <input
                      type="file"
                      accept=".csv,.tsv,.txt,.json"
                      onChange={handleFileUpload}
                      className="sr-only"
                    />
                  </label>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="appsheet-schema-textarea"
                    className="text-xs font-semibold text-slate-900 dark:text-slate-100"
                  >
                    AppSheet Column & Virtual Field Analyzer
                  </label>
                  <button
                    type="button"
                    onClick={handleLoadSampleSchema}
                    className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap shrink-0 dark:text-blue-400"
                  >
                    Load AJI Schema Example
                  </button>
                </div>
                <textarea
                  id="appsheet-schema-textarea"
                  rows={6}
                  value={schemaInput}
                  onChange={(e) => setSchemaInput(e.target.value)}
                  placeholder="Paste your AppSheet Flights table column list to verify mappings..."
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus:bg-slate-800"
                />
                <button
                  type="button"
                  onClick={() => handleAnalyzeSchema()}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  Analyze AppSheet Structure
                </button>
              </div>
            </div>

            {parsedSchema.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Detected AppSheet Schema ({parsedSchema.length} columns)
                </p>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {parsedSchema.map((field, idx) => (
                    <div
                      key={`${field.name}-${idx}`}
                      className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                    >
                      <div className="truncate">
                        <span className="font-mono font-medium text-slate-900 dark:text-slate-100">{field.name}</span>
                        <span className="ml-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                          {field.appSheetType}
                        </span>
                      </div>
                      <span className="ml-2 font-mono text-[11px] text-blue-700 dark:text-blue-400 shrink-0">
                        → {field.mappedTo}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Column Mapping & Row Preview */}
      {headers.length > 0 && mappedPreview && (
        <section
          aria-label="Column mapping and import preview"
          className="rounded-xl border border-slate-200 bg-white p-6 space-y-5 dark:border-slate-800 dark:bg-slate-900"
          data-testid="column-mapper-panel"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Column Mapping · {previewTitle}
              </h3>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                {dataRows.length} rows detected · {mappedPreview.flights.length} valid flights ready
                {previewFieldCounts.mark > 0 ? ` · ${previewFieldCounts.mark} Mark` : ''}
                {previewFieldCounts.route > 0 ? ` · ${previewFieldCounts.route} From/To` : ''}
                {previewFieldCounts.sortie > 0 ? ` · ${previewFieldCounts.sortie} Sortie` : ''}
                {appSheetDetected ? ' · AppSheet metadata recognized' : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => setImportMode('replace')}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 ${
                    importMode === 'replace'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  Replace (Full Flights Tab)
                </button>
                <button
                  type="button"
                  onClick={() => setImportMode('merge')}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 ${
                    importMode === 'merge'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  Merge New Rows
                </button>
              </div>
              <button
                type="button"
                onClick={() => void handleConfirmImport()}
                disabled={mappedPreview.flights.length === 0 || isSavingImport}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {isSavingImport ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    {saveProgress
                      ? `Locking in ${saveProgress.saved}/${saveProgress.total}...`
                      : 'Saving to Cloud...'}
                  </>
                ) : (
                  <>
                    Import &amp; Lock {mappedPreview.flights.length} Flight
                    {mappedPreview.flights.length === 1 ? '' : 's'}
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {headers.map((hdr, idx) => (
              <div
                key={`${hdr}-${idx}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/60"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs font-semibold text-slate-900 dark:text-slate-100" title={hdr}>
                    {hdr || `Column ${idx + 1}`}
                  </p>
                  <p className="truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    e.g. {firstSampleValues[idx] || '—'}
                  </p>
                </div>
                <select
                  aria-label={`Map column ${hdr || idx + 1}`}
                  value={mapping[idx] ?? 'ignore'}
                  onChange={(e) =>
                    setMapping((prev) => ({
                      ...prev,
                      [idx]: e.target.value as CanonicalFlightField | 'custom' | 'ignore',
                    }))
                  }
                  className="w-40 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-blue-600 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                >
                  <option value="ignore">Ignore column</option>
                  <option value="custom">Keep as Custom Field</option>
                  <optgroup label="Logbook Fields">
                    {CANONICAL_FIELDS.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>
            ))}
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
              Preview (first {Math.min(5, mappedPreview.flights.length)} parsed flights)
            </p>
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Aircraft</th>
                    <th className="px-3 py-2">Mark</th>
                    <th className="px-3 py-2">From</th>
                    <th className="px-3 py-2">To</th>
                    <th className="px-3 py-2">Instructor</th>
                    <th className="px-3 py-2">Sortie</th>
                    <th className="px-3 py-2">Exercise</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2 text-right">Ldg</th>
                    <th className="px-3 py-2 text-right">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {mappedPreview.flights.slice(0, 5).map((f) => (
                    <tr key={f.id}>
                      <td className="px-3 py-2 font-mono tabular-nums whitespace-nowrap text-slate-700 dark:text-slate-300">
                        {formatShortSheetDate(f.date)}
                      </td>
                      <td className="px-3 py-2 font-mono font-semibold whitespace-nowrap text-slate-900 dark:text-slate-100">
                        {f.aircraftType}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {f.aircraftMark || '—'}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {f.departure || '—'}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {f.arrival || '—'}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-700 dark:text-slate-300">{f.instructor || '—'}</td>
                      <td className="px-3 py-2 font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {f.sortie || '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-800 dark:text-slate-200">{f.exercise}</td>
                      <td className="px-3 py-2 font-mono text-[11px] whitespace-nowrap text-slate-600 dark:text-slate-400">
                        {f.flightType}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">{f.landings}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                        {formatHHMM(f.totalMinutes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
