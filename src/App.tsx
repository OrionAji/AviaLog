import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  BookOpen,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  Menu,
  Plane,
  Plus,
  X,
} from 'lucide-react';
import type {
  ActiveNavSection,
  AircraftRecord,
  ConnectedSheetConfig,
  FlightEntry,
} from './types/logbook';
import {
  computeAircraftBreakdown,
  computeLogbookTotals,
  computeMarkBreakdown,
  computeYearlyBreakdown,
  formatHHMM,
  formatShortSheetDate,
} from './utils/flightMath';
import {
  autoDetectColumnMapping,
  exportFlightsToCsv,
  serializeFlightToSheetRow,
  STANDARD_SHEET_HEADERS,
} from './utils/sheetParser';
import {
  clearAccessToken,
  connectGoogleSheetsAccess,
  formatAuthErrorMessage,
  onAuthSessionChanged,
  refreshCurrentUserVerification,
  resendVerificationEmail,
  signOutAccount,
} from './services/googleAuth';
import {
  deleteFlightRecord,
  ensureUserWorkspace,
  importFlightsBatch,
  saveAircraftRecord,
  saveFlightRecord,
  subscribeUserAircraft,
  subscribeUserFlights,
  subscribeUserProfile,
  updateConnectedSheetConfig,
  updateUserTheme,
  type UserWorkspaceProfile,
} from './services/logbookStore';
import {
  applyThemeToDocument,
  toggleThemeMode,
  type ThemeMode,
} from './utils/theme';
import {
  appendSheetRows,
  createLogbookSpreadsheet,
  GoogleSheetsAuthExpiredError,
  overwriteSheetValues,
  updateSheetRow,
} from './services/googleSheetsApi';
import { firebaseProjectId, firestoreDatabaseId } from './services/firebase';
import { parseFirestoreErrorForDisplay } from './utils/firestoreErrorUtils';
import { AuthGate } from './components/AuthGate';
import { OverviewView } from './components/OverviewView';
import { LogbookTableView } from './components/LogbookTableView';
import { ImportSyncView } from './components/ImportSyncView';
import { FleetView } from './components/FleetView';
import { FlightFormModal } from './components/FlightFormModal';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ThemeToggle } from './components/ThemeToggle';

interface PendingConfirmAction {
  title: string;
  description: string;
  details: string[];
  confirmLabel: string;
  variant: 'primary' | 'danger';
  execute: () => Promise<void>;
}

const NAV_ITEMS: Array<{
  id: ActiveNavSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'logbook', label: 'Flight Logbook', icon: BookOpen },
  { id: 'import', label: 'Import & Sync', icon: FileSpreadsheet },
  { id: 'fleet', label: 'Aircraft Fleet', icon: Plane },
];

export default function App() {
  const [activeNav, setActiveNav] = useState<ActiveNavSection>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Firebase Auth & strictly in-memory Google Sheets OAuth access token
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isConnectingSheets, setIsConnectingSheets] = useState(false);
  const [sheetsAuthError, setSheetsAuthError] = useState<string | null>(null);

  // Strict per-user Firestore state (zero shared localStorage persistence)
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [fatalError, setFatalError] = useState<Error | null>(null);
  const [profile, setProfile] = useState<UserWorkspaceProfile | null>(null);
  const [flights, setFlights] = useState<FlightEntry[]>([]);
  const [aircraft, setAircraft] = useState<AircraftRecord[]>([]);

  const [flightModalOpen, setFlightModalOpen] = useState(false);
  const [editingFlight, setEditingFlight] = useState<FlightEntry | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmAction | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [theme, setTheme] = useState<ThemeMode>('light');
  const themeRef = useRef<ThemeMode>(theme);

  useEffect(() => {
    themeRef.current = theme;
    applyThemeToDocument(theme);
  }, [theme]);

  // Clean up any legacy shared localStorage keys from earlier single-user builds
  useEffect(() => {
    try {
      window.localStorage.removeItem('aerolog_aji_flights_v2');
      window.localStorage.removeItem('aerolog_aji_aircraft_v2');
      window.localStorage.removeItem('aerolog_aji_baseline_v2');
      window.localStorage.removeItem('aerolog_aji_sheet_config_v2');
    } catch {
      // ignore storage errors
    }
  }, []);

  // Auth state observer
  useEffect(() => {
    const unsubscribe = onAuthSessionChanged((nextUser) => {
      setUser(nextUser);
      setEmailVerified(Boolean(nextUser?.emailVerified));
      if (!nextUser) {
        setAccessToken(null);
        setProfile(null);
        setFlights([]);
        setAircraft([]);
        setWorkspaceLoading(false);
        setFatalError(null);
      }
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Per-user Firestore workspace bootstrap & real-time subscriptions (ONLY when authenticated & verified)
  useEffect(() => {
    if (!user || !emailVerified) return;

    let cancelled = false;
    let unsubProfile: (() => void) | null = null;
    let unsubFlights: (() => void) | null = null;
    let unsubAircraft: (() => void) | null = null;

    setWorkspaceLoading(true);
    setFatalError(null);

    const startWorkspace = async () => {
      try {
        try {
          await user.getIdToken(true);
        } catch {
          // Best-effort refresh so Firestore receives a fresh JWT with email_verified: true
        }
        if (cancelled) return;
        await ensureUserWorkspace(user, themeRef.current);
        if (cancelled) return;

        unsubProfile = subscribeUserProfile(
          user.uid,
          (nextProfile) => {
            setProfile(nextProfile);
            if (nextProfile) {
              setTheme(nextProfile.theme);
            }
            setWorkspaceLoading(false);
          },
          (err) => {
            if (!cancelled) setFatalError(err);
          }
        );

        unsubFlights = subscribeUserFlights(
          user.uid,
          (nextFlights) => {
            setFlights(nextFlights);
          },
          (err) => {
            if (!cancelled) setFatalError(err);
          }
        );

        unsubAircraft = subscribeUserAircraft(
          user.uid,
          (nextAircraft) => {
            setAircraft(nextAircraft);
          },
          (err) => {
            if (!cancelled) setFatalError(err);
          }
        );
      } catch (err) {
        if (!cancelled) {
          setWorkspaceLoading(false);
          setFatalError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    };

    void startWorkspace();

    return () => {
      cancelled = true;
      unsubProfile?.();
      unsubFlights?.();
      unsubAircraft?.();
    };
  }, [user, emailVerified]);

  if (fatalError) {
    throw fatalError;
  }

  const baseline = profile?.baseline ?? null;
  const connectedSheet = profile?.connectedSheet ?? null;
  const pilotName =
    profile?.pilotName || user?.displayName || user?.email?.split('@')[0] || 'Pilot';

  const showBanner = (kind: 'success' | 'error', text: string) => {
    setBanner({ kind, text });
  };

  const formatCloudError = (err: unknown, fallback: string) =>
    parseFirestoreErrorForDisplay(err, fallback, {
      projectId: firebaseProjectId,
      databaseId: firestoreDatabaseId,
    }).message;

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const sortedFlights = useMemo(
    () =>
      [...flights].sort((a, b) => {
        const cmp = b.date.localeCompare(a.date);
        if (cmp !== 0) return cmp;
        return (b.sheetRowNumber ?? 0) - (a.sheetRowNumber ?? 0);
      }),
    [flights]
  );

  const totals = useMemo(
    () => computeLogbookTotals(flights, baseline, todayIso),
    [flights, baseline, todayIso]
  );
  const aircraftBreakdown = useMemo(
    () => computeAircraftBreakdown(flights, baseline),
    [flights, baseline]
  );
  const markBreakdown = useMemo(() => computeMarkBreakdown(flights), [flights]);
  const yearlyBreakdown = useMemo(
    () => computeYearlyBreakdown(flights, baseline),
    [flights, baseline]
  );

  const knownMarks = useMemo(() => {
    const set = new Set<string>();
    for (const ac of aircraft) {
      for (const mk of ac.marks ?? []) {
        if (mk.trim()) set.add(mk.trim().toUpperCase());
      }
    }
    for (const f of flights) {
      if (f.aircraftMark?.trim()) set.add(f.aircraftMark.trim().toUpperCase());
    }
    return Array.from(set).sort();
  }, [aircraft, flights]);

  const knownInstructors = useMemo(() => {
    const set = new Set<string>();
    for (const f of flights) {
      if (f.instructor?.trim()) set.add(f.instructor.trim().toUpperCase());
    }
    return Array.from(set).sort();
  }, [flights]);

  const knownExercises = useMemo(() => {
    const set = new Set<string>([
      'ARMED RECCE',
      'NAVIGATION/ARMED RECCE',
      'NAVIGATION',
      'FORMATION',
      'NAV',
      'INSTRUMENT',
      'NIGHT FLYING',
    ]);
    for (const f of flights) {
      if (f.exercise?.trim()) set.add(f.exercise.trim().toUpperCase());
    }
    return Array.from(set).sort();
  }, [flights]);

  const knownAirfields = useMemo(() => {
    const set = new Set<string>();
    for (const f of flights) {
      if (f.departure?.trim()) set.add(f.departure.trim().toUpperCase());
      if (f.arrival?.trim()) set.add(f.arrival.trim().toUpperCase());
    }
    return Array.from(set).sort();
  }, [flights]);

  const handleRefreshVerification = async () => {
    const refreshed = await refreshCurrentUserVerification();
    if (refreshed) {
      setUser(refreshed);
      setEmailVerified(Boolean(refreshed.emailVerified));
    }
  };

  const handleSignOut = async () => {
    await signOutAccount();
    setUser(null);
    setEmailVerified(false);
    setAccessToken(null);
    setProfile(null);
    setFlights([]);
    setAircraft([]);
    setBanner(null);
    setTheme('light');
    setActiveNav('overview');
  };

  const handleToggleTheme = () => {
    const previous = theme;
    const next = toggleThemeMode(previous);
    setTheme(next);

    if (user && emailVerified && profile) {
      void updateUserTheme(user.uid, next).catch((err) => {
        setTheme(previous);
        showBanner('error', formatCloudError(err, 'Could not save theme preference to your profile.'));
      });
    }
  };

  const handleConnectGoogleSheets = async () => {
    setIsConnectingSheets(true);
    setSheetsAuthError(null);
    try {
      const res = await connectGoogleSheetsAccess();
      setUser(res.user);
      setAccessToken(res.accessToken);
      showBanner('success', `Connected Google Sheets access (${res.user.email}).`);
    } catch (err) {
      setSheetsAuthError(formatAuthErrorMessage(err));
    } finally {
      setIsConnectingSheets(false);
    }
  };

  const handleDisconnectGoogleSheetsAccess = async () => {
    clearAccessToken();
    setAccessToken(null);
    showBanner('success', 'Disconnected Google Sheets session token. You remain signed in to AviaLog.');
  };

  const openNewFlight = () => {
    setEditingFlight(null);
    setFlightModalOpen(true);
  };

  const openEditFlight = (flight: FlightEntry) => {
    setEditingFlight(flight);
    setFlightModalOpen(true);
  };

  const handleSaveFlight = async (flight: FlightEntry, syncToSheet: boolean) => {
    if (!user) return;
    setFlightModalOpen(false);
    setEditingFlight(null);

    try {
      const savedFlight = await saveFlightRecord(user.uid, flight, aircraft);

      if (syncToSheet && connectedSheet && accessToken) {
        const isUpdate = Boolean(savedFlight.sheetRowNumber);
        setPendingConfirm({
          title: isUpdate
            ? `Update row ${savedFlight.sheetRowNumber} in Google Sheets?`
            : 'Append flight entry to Google Sheets?',
          description: isUpdate
            ? 'This will overwrite the existing row in your connected Google Sheet with your edited flight values.'
            : 'This will append a new row to the bottom of your connected Flights tab in Google Sheets.',
          details: [
            `Spreadsheet: ${connectedSheet.spreadsheetTitle}`,
            `Tab: ${connectedSheet.sheetName}`,
            `Sortie: ${formatShortSheetDate(savedFlight.date)}${
              savedFlight.sortie ? ` · #${savedFlight.sortie}` : ''
            } · ${savedFlight.aircraftType}${
              savedFlight.aircraftMark ? ` (${savedFlight.aircraftMark})` : ''
            }${
              savedFlight.departure || savedFlight.arrival
                ? ` · ${savedFlight.departure || '—'} → ${savedFlight.arrival || '—'}`
                : ''
            } · ${savedFlight.exercise} (${formatHHMM(savedFlight.totalMinutes)})`,
          ],
          confirmLabel: isUpdate ? 'Confirm Update' : 'Append to Sheet',
          variant: 'primary',
          execute: async () => {
            const rowValues = serializeFlightToSheetRow(
              savedFlight,
              connectedSheet.headers,
              connectedSheet.mapping
            );
            if (isUpdate && savedFlight.sheetRowNumber) {
              await updateSheetRow(
                connectedSheet.spreadsheetId,
                connectedSheet.sheetName,
                savedFlight.sheetRowNumber,
                rowValues,
                accessToken
              );
              showBanner(
                'success',
                `Updated row ${savedFlight.sheetRowNumber} in "${connectedSheet.spreadsheetTitle}".`
              );
            } else {
              await appendSheetRows(
                connectedSheet.spreadsheetId,
                connectedSheet.sheetName,
                [rowValues],
                accessToken
              );
              await updateConnectedSheetConfig(user.uid, {
                ...connectedSheet,
                lastSyncedAt: new Date().toISOString(),
                rowCount: connectedSheet.rowCount + 1,
              });
              showBanner(
                'success',
                `Appended ${savedFlight.aircraftType} (${savedFlight.exercise}, ${formatHHMM(savedFlight.totalMinutes)}) to "${connectedSheet.spreadsheetTitle}".`
              );
            }
          },
        });
      } else {
        showBanner(
          'success',
          `Saved sortie: ${savedFlight.aircraftType} · ${savedFlight.exercise} (${formatHHMM(savedFlight.totalMinutes)}).`
        );
      }
    } catch (err) {
      showBanner(
        'error',
        formatCloudError(err, 'Could not save flight to your private logbook.')
      );
    }
  };

  const handleRequestDeleteFlight = (flight: FlightEntry) => {
    if (!user) return;
    setFlightModalOpen(false);
    setPendingConfirm({
      title: 'Delete flight entry?',
      description:
        'This permanently removes the flight from your private AviaLog ledger. (Existing rows in Google Sheets are untouched unless you run a full sync.)',
      details: [
        `${formatShortSheetDate(flight.date)} · ${flight.aircraftType} · ${flight.instructor || 'Solo'}`,
        `Exercise: ${flight.exercise} · ${formatHHMM(flight.totalMinutes)}`,
      ],
      confirmLabel: 'Delete Entry',
      variant: 'danger',
      execute: async () => {
        await deleteFlightRecord(user.uid, flight.id);
        showBanner(
          'success',
          `Deleted flight ${flight.aircraftType} (${formatShortSheetDate(flight.date)}).`
        );
      },
    });
  };

  const handleImportFlights = async (
    imported: FlightEntry[],
    mode: 'merge' | 'replace',
    sheetConfig?: ConnectedSheetConfig,
    onProgress?: (saved: number, total: number) => void
  ): Promise<number> => {
    if (!user) throw new Error('Please sign in before importing flights.');
    try {
      const count = await importFlightsBatch(
        user.uid,
        imported,
        mode,
        flights,
        aircraft,
        sheetConfig,
        onProgress
      );
      showBanner(
        'success',
        `Saved & locked ${count} flight${count === 1 ? '' : 's'} into your private cloud logbook.`
      );
      return count;
    } catch (err) {
      const msg = formatCloudError(
        err,
        'Failed to save imported flights to your private cloud logbook. Please try again.'
      );
      showBanner('error', msg);
      throw new Error(msg);
    }
  };

  const handleRequestPushFullLogbook = () => {
    if (!user || !connectedSheet || !accessToken) return;
    setPendingConfirm({
      title: `Sync all ${flights.length} logged rows to Google Sheets?`,
      description: `This will clear and rewrite tab "${connectedSheet.sheetName}" in "${connectedSheet.spreadsheetTitle}" with all ${flights.length} flight rows currently in your private AviaLog ledger.`,
      details: [
        `Spreadsheet: ${connectedSheet.spreadsheetTitle}`,
        `Tab: ${connectedSheet.sheetName}`,
        `Rows to write: 1 header row + ${flights.length} flight rows`,
      ],
      confirmLabel: 'Overwrite & Sync Sheet',
      variant: 'danger',
      execute: async () => {
        const rows = sortedFlights.map((f) =>
          serializeFlightToSheetRow(f, connectedSheet.headers, connectedSheet.mapping)
        );
        await overwriteSheetValues(
          connectedSheet.spreadsheetId,
          connectedSheet.sheetName,
          [connectedSheet.headers, ...rows],
          accessToken
        );
        await updateConnectedSheetConfig(user.uid, {
          ...connectedSheet,
          lastSyncedAt: new Date().toISOString(),
          rowCount: rows.length,
        });
        showBanner(
          'success',
          `Synced ${rows.length} flights to "${connectedSheet.spreadsheetTitle}" (${connectedSheet.sheetName}).`
        );
      },
    });
  };

  const handleRequestCreateNewSheet = () => {
    if (!user || !accessToken) return;
    const title = `${pilotName} Flight Logbook (${new Date().toISOString().slice(0, 10)})`;
    setPendingConfirm({
      title: 'Create new Google Sheets logbook?',
      description:
        'This will create a new formatted Google Spreadsheet in your account populated with your current logged flights and connect it for two-way sync.',
      details: [
        `New Spreadsheet Title: ${title}`,
        `Tab: Flight Logbook`,
        `Rows to export: ${flights.length} flights`,
      ],
      confirmLabel: 'Create Google Sheet',
      variant: 'primary',
      execute: async () => {
        const standardMapping = autoDetectColumnMapping(STANDARD_SHEET_HEADERS);
        const rows = sortedFlights.map((f) =>
          serializeFlightToSheetRow(f, STANDARD_SHEET_HEADERS, standardMapping)
        );
        const created = await createLogbookSpreadsheet(
          title,
          STANDARD_SHEET_HEADERS,
          rows,
          accessToken
        );
        await updateConnectedSheetConfig(user.uid, {
          spreadsheetId: created.spreadsheetId,
          spreadsheetTitle: title,
          sheetName: created.sheetName,
          headers: STANDARD_SHEET_HEADERS,
          mapping: standardMapping,
          lastSyncedAt: new Date().toISOString(),
          rowCount: rows.length,
          appSheetDetected: false,
        });
        showBanner('success', `Created and connected "${title}" with ${rows.length} flights.`);
      },
    });
  };

  const executeConfirmedAction = async () => {
    if (!pendingConfirm) return;
    setConfirmBusy(true);
    try {
      await pendingConfirm.execute();
      setPendingConfirm(null);
    } catch (err: unknown) {
      if (err instanceof GoogleSheetsAuthExpiredError) {
        clearAccessToken();
        setAccessToken(null);
        showBanner('error', err.message);
      } else {
        showBanner(
          'error',
          formatCloudError(
            err,
            err instanceof Error ? err.message : 'Operation failed. Please try again.'
          )
        );
      }
      setPendingConfirm(null);
    } finally {
      setConfirmBusy(false);
    }
  };

  const triggerDownload = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleExportCsv = () => {
    const csv = exportFlightsToCsv(sortedFlights);
    const slug = pilotName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'pilot';
    triggerDownload(
      csv,
      `${slug}-logbook-${new Date().toISOString().slice(0, 10)}.csv`,
      'text/csv;charset=utf-8;'
    );
    showBanner('success', `Exported ${sortedFlights.length} flights to CSV.`);
  };

  const handleExportJson = () => {
    const json = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        pilot: pilotName,
        baseline,
        flights: sortedFlights,
        aircraft,
      },
      null,
      2
    );
    const slug = pilotName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'pilot';
    triggerDownload(
      json,
      `${slug}-logbook-${new Date().toISOString().slice(0, 10)}.json`,
      'application/json'
    );
    showBanner('success', 'Exported logbook backup to JSON.');
  };

  const handleSaveAircraft = (record: AircraftRecord) => {
    if (!user) return;
    void (async () => {
      try {
        await saveAircraftRecord(user.uid, record);
        showBanner('success', `Saved aircraft type ${record.type}.`);
      } catch (err) {
        showBanner('error', formatCloudError(err, `Could not save aircraft type ${record.type}.`));
      }
    })();
  };

  // Gate 1: Initializing Firebase Auth
  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#F7F8FA] dark:bg-slate-950 flex items-center justify-center p-6">
        <div className="text-center">
          <p className="font-display text-lg font-bold text-[#0F1B2D] dark:text-slate-100">AviaLog</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Checking account session...</p>
        </div>
      </div>
    );
  }

  // Gate 2: Unauthenticated OR unverified email -> Show AuthGate (zero data fetched or shown)
  if (!user || !emailVerified) {
    return (
      <AuthGate
        pendingVerificationUser={user && !emailVerified ? user : null}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        onRefreshVerification={handleRefreshVerification}
        onResendVerification={resendVerificationEmail}
        onSignOut={handleSignOut}
      />
    );
  }

  const activeNavTitle = NAV_ITEMS.find((n) => n.id === activeNav)?.label ?? 'Overview';
  const navigateTo = (section: ActiveNavSection) => {
    setActiveNav(section);
    setMobileNavOpen(false);
  };

  return (
    <div className="min-h-screen bg-[#F7F8FA] text-slate-900 dark:bg-slate-950 dark:text-slate-100 flex">
      {/* Desktop Sidebar Rail */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-[#0F1B2D] text-slate-100 border-r border-slate-800">
        <div className="flex h-16 items-center px-6 border-b border-slate-800/80">
          <span className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap">
            AviaLog
          </span>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateTo(item.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium whitespace-nowrap ${
                  active
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                }`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-800/80 p-4 space-y-3">
          <div className="rounded-lg bg-slate-900/70 px-3.5 py-3">
            <p className="text-[11px] font-medium text-slate-400 truncate">
              {pilotName} · Flight Hours
            </p>
            <p className="mt-1 font-mono text-lg font-semibold text-white tabular-nums">
              {formatHHMM(totals.totalMinutes)}
              <span className="ml-1.5 text-xs font-normal text-slate-400">
                ({formatHHMM(totals.jetMinutes)} jet)
              </span>
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400 truncate">
              {connectedSheet
                ? `Sheet: ${connectedSheet.spreadsheetTitle}`
                : `${totals.flightCount} flights · ${totals.landings} ldg`}
            </p>
          </div>

          <div className="flex items-center justify-between gap-2 px-1">
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-200 truncate">{pilotName}</p>
              <p className="text-[11px] text-slate-400 truncate" title={user.email ?? ''}>
                {user.email}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              aria-label="Sign out"
              title="Sign out"
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white shrink-0"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-50 flex lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile navigation"
        >
          <div
            className="fixed inset-0 bg-slate-950/50"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="relative flex w-64 max-w-[80vw] flex-col bg-[#0F1B2D] text-slate-100 shadow-2xl">
            <div className="flex h-14 items-center justify-between border-b border-slate-800 px-5">
              <span className="font-display text-lg font-bold tracking-tight text-white">
                AviaLog
              </span>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close navigation menu"
                className="rounded-md p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeNav === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigateTo(item.id)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium whitespace-nowrap ${
                      active
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="border-t border-slate-800 p-4">
              <p className="text-xs font-medium text-white truncate">{pilotName}</p>
              <p className="text-[11px] text-slate-400 truncate">{user.email}</p>
              <button
                type="button"
                onClick={() => {
                  setMobileNavOpen(false);
                  void handleSignOut();
                }}
                className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex flex-1 flex-col lg:pl-64 min-w-0">
        <header className="sticky top-0 z-20 flex h-14 lg:h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-6 lg:px-8 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="font-display font-bold text-slate-900 dark:text-slate-100 lg:hidden">AviaLog</span>
              <span className="text-slate-300 dark:text-slate-600 lg:hidden">/</span>
              <span className="hidden text-slate-400 dark:text-slate-500 lg:inline">AviaLog</span>
              <span className="hidden text-slate-300 dark:text-slate-600 lg:inline">/</span>
              <h1 className="truncate font-display text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100">
                {activeNavTitle}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <ThemeToggle theme={theme} onToggle={handleToggleTheme} />
            <button
              type="button"
              onClick={openNewFlight}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-xs sm:text-sm font-medium text-white transition-colors hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-blue-600 whitespace-nowrap shrink-0"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Log Flight
            </button>
          </div>
        </header>

        {banner && (
          <div
            role="status"
            className={`mx-4 mt-4 sm:mx-6 lg:mx-8 flex items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-xs font-medium ${
              banner.kind === 'error'
                ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/60 dark:text-red-200'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/60 dark:text-emerald-200'
            }`}
          >
            <span>{banner.text}</span>
            <button
              type="button"
              onClick={() => setBanner(null)}
              aria-label="Dismiss message"
              className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/10"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 max-w-[1320px] w-full mx-auto">
          {workspaceLoading ? (
            <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center dark:border-slate-800 dark:bg-slate-900">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Loading your private logbook...</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Syncing your personal flight records and aircraft marks.
              </p>
            </div>
          ) : (
            <>
              {activeNav === 'overview' && (
                <OverviewView
                  pilotName={pilotName}
                  totals={totals}
                  aircraftList={aircraft}
                  aircraftBreakdown={aircraftBreakdown}
                  yearlyBreakdown={yearlyBreakdown}
                  recentFlights={sortedFlights}
                  baseline={baseline}
                  connectedSheet={connectedSheet}
                  referenceDateIso={todayIso}
                  theme={theme}
                  onNavigate={navigateTo}
                  onOpenNewFlight={openNewFlight}
                  onSelectFlight={openEditFlight}
                />
              )}

              {activeNav === 'logbook' && (
                <LogbookTableView
                  flights={sortedFlights}
                  baseline={baseline}
                  careerTotals={totals}
                  onSelectFlight={openEditFlight}
                  onOpenNewFlight={openNewFlight}
                  onNavigateToImport={() => navigateTo('import')}
                  onExportCsv={handleExportCsv}
                />
              )}

              {activeNav === 'import' && (
                <ImportSyncView
                  user={user}
                  accessToken={accessToken}
                  isSigningIn={isConnectingSheets}
                  authError={sheetsAuthError}
                  connectedSheet={connectedSheet}
                  baseline={baseline}
                  totalFlightsCount={flights.length}
                  knownAircraft={aircraft.map((a) => a.type)}
                  knownMarks={knownMarks}
                  onGoogleSignIn={handleConnectGoogleSheets}
                  onGoogleSignOut={handleDisconnectGoogleSheetsAccess}
                  onImportFlights={handleImportFlights}
                  onRequestPushFullLogbook={handleRequestPushFullLogbook}
                  onRequestCreateNewSheet={handleRequestCreateNewSheet}
                  onExportCsv={handleExportCsv}
                  onExportJson={handleExportJson}
                  onSheetsAuthExpired={() => {
                    clearAccessToken();
                    setAccessToken(null);
                  }}
                  onDisconnectSheet={() => {
                    void updateConnectedSheetConfig(user.uid, null)
                      .then(() => {
                        showBanner(
                          'success',
                          'Disconnected Google Sheet link. Your logged flights were kept.'
                        );
                      })
                      .catch((err) => {
                        showBanner(
                          'error',
                          formatCloudError(err, 'Could not disconnect Google Sheet link.')
                        );
                      });
                  }}
                />
              )}

              {activeNav === 'fleet' && (
                <FleetView
                  aircraftList={aircraft}
                  aircraftBreakdown={aircraftBreakdown}
                  markBreakdown={markBreakdown}
                  onSaveAircraft={handleSaveAircraft}
                />
              )}
            </>
          )}
        </main>
      </div>

      <FlightFormModal
        open={flightModalOpen}
        initialFlight={editingFlight}
        aircraftList={aircraft}
        knownMarks={knownMarks}
        knownInstructors={knownInstructors}
        knownExercises={knownExercises}
        knownAirfields={knownAirfields}
        connectedSheet={connectedSheet}
        isGoogleSignedIn={Boolean(user && accessToken)}
        onClose={() => {
          setFlightModalOpen(false);
          setEditingFlight(null);
        }}
        onSave={handleSaveFlight}
        onDelete={handleRequestDeleteFlight}
      />

      <ConfirmDialog
        open={Boolean(pendingConfirm)}
        title={pendingConfirm?.title ?? ''}
        description={pendingConfirm?.description ?? ''}
        details={pendingConfirm?.details}
        confirmLabel={pendingConfirm?.confirmLabel ?? 'Confirm'}
        variant={pendingConfirm?.variant ?? 'primary'}
        busy={confirmBusy}
        onConfirm={executeConfirmedAction}
        onCancel={() => {
          if (!confirmBusy) setPendingConfirm(null);
        }}
      />
    </div>
  );
}
