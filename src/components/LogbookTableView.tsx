import React, { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Calendar,
  ChevronDown,
  ChevronRight,
  Download,
  FileSpreadsheet,
  List,
  Search,
  X,
} from 'lucide-react';
import type { BroughtForwardBaseline, FlightEntry, LogbookTotals } from '../types/logbook';
import {
  computeMonthlyGroups,
  formatHHMM,
  formatMonthLabel,
  formatShortSheetDate,
} from '../utils/flightMath';

type RoleFilter = 'all' | 'DUAL' | 'SOLO' | 'JET' | 'NIGHT_IFR';
type SortField = 'date' | 'totalMinutes';
type ViewMode = 'monthly' | 'flat';

interface LogbookTableViewProps {
  flights: FlightEntry[];
  baseline: BroughtForwardBaseline | null;
  careerTotals: LogbookTotals;
  onSelectFlight: (flight: FlightEntry) => void;
  onOpenNewFlight: () => void;
  onNavigateToImport: () => void;
  onExportCsv: () => void;
}

const SOURCE_LABELS: Record<FlightEntry['source'], string> = {
  manual: 'Logged here',
  google_sheets: 'Google Sheets',
  appsheet_csv: 'AppSheet CSV',
  imported_sheet: 'Attached Sheet',
  photo_scan: 'Photo Scan',
};

export const LogbookTableView: React.FC<LogbookTableViewProps> = ({
  flights,
  baseline,
  careerTotals,
  onSelectFlight,
  onOpenNewFlight,
  onNavigateToImport,
  onExportCsv,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('monthly');
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [aircraftFilter, setAircraftFilter] = useState<string>('all');
  const [markFilter, setMarkFilter] = useState<string>('all');
  const [monthFilter, setMonthFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [collapsedMonths, setCollapsedMonths] = useState<Record<string, boolean>>({});

  const aircraftOptions = useMemo(() => {
    const set = new Set<string>();
    for (const f of flights) {
      if (f.aircraftType) set.add(f.aircraftType.toUpperCase());
    }
    return Array.from(set).sort();
  }, [flights]);

  const markOptions = useMemo(() => {
    const set = new Set<string>();
    for (const f of flights) {
      const m = (f.aircraftMark || '').trim().toUpperCase();
      if (m) set.add(m);
    }
    return Array.from(set).sort();
  }, [flights]);

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    for (const f of flights) {
      if (/^\d{4}-\d{2}/.test(f.date)) {
        set.add(f.date.slice(0, 7));
      }
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [flights]);

  const filteredFlights = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return flights
      .filter((f) => {
        if (monthFilter !== 'all' && !f.date.startsWith(monthFilter)) {
          return false;
        }
        if (aircraftFilter !== 'all' && f.aircraftType.toUpperCase() !== aircraftFilter) {
          return false;
        }
        if (markFilter !== 'all' && (f.aircraftMark || '').trim().toUpperCase() !== markFilter) {
          return false;
        }
        if (roleFilter === 'DUAL' && f.dualMinutes <= 0) return false;
        if (roleFilter === 'SOLO' && f.soloMinutes <= 0) return false;
        if (roleFilter === 'JET' && f.engineCategory !== 'JET ENGINE') return false;
        if (
          roleFilter === 'NIGHT_IFR' &&
          f.nightMinutes <= 0 &&
          f.instrumentMinutes <= 0 &&
          f.approaches <= 0
        ) {
          return false;
        }
        if (q) {
          const hay = [
            f.date,
            formatShortSheetDate(f.date),
            f.sortie,
            f.aircraftType,
            f.aircraftMark,
            f.departure,
            f.arrival,
            f.instructor,
            f.exercise,
            f.flightType,
            f.remarks,
          ]
            .join(' ')
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const cmp =
          sortField === 'date'
            ? a.date.localeCompare(b.date)
            : a.totalMinutes - b.totalMinutes;
        return sortDir === 'desc' ? -cmp : cmp;
      });
  }, [flights, searchQuery, roleFilter, aircraftFilter, markFilter, monthFilter, sortField, sortDir]);

  const monthlyGroups = useMemo(
    () => computeMonthlyGroups(filteredFlights, sortDir),
    [filteredFlights, sortDir]
  );

  const ledgerTotals = useMemo(() => {
    let totalMinutes = 0;
    let simulatorMinutes = 0;
    let dualMinutes = 0;
    let soloMinutes = 0;
    let nightMinutes = 0;
    let instrumentMinutes = 0;
    let takeoffs = 0;
    let landings = 0;
    for (const f of filteredFlights) {
      const isSim = f.engineCategory === 'SIMULATOR' || f.flightType === 'SIMULATOR';
      if (isSim) {
        simulatorMinutes += f.simulatorMinutes > 0 ? f.simulatorMinutes : f.totalMinutes;
      } else {
        totalMinutes += f.totalMinutes;
        dualMinutes += f.dualMinutes;
        soloMinutes += f.soloMinutes;
        simulatorMinutes += f.simulatorMinutes;
      }
      nightMinutes += f.nightMinutes;
      instrumentMinutes += f.instrumentMinutes;
      takeoffs += f.takeoffs;
      landings += f.landings;
    }
    return {
      totalMinutes,
      totalMinutesInclSim: totalMinutes + simulatorMinutes,
      simulatorMinutes,
      dualMinutes,
      soloMinutes,
      nightMinutes,
      instrumentMinutes,
      takeoffs,
      landings,
    };
  }, [filteredFlights]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const toggleMonthCollapsed = (monthKey: string) => {
    setCollapsedMonths((prev) => ({ ...prev, [monthKey]: !prev[monthKey] }));
  };

  const allCollapsed =
    monthlyGroups.length > 0 && monthlyGroups.every((g) => Boolean(collapsedMonths[g.monthKey]));

  const toggleAllMonths = () => {
    if (allCollapsed) {
      setCollapsedMonths({});
    } else {
      const next: Record<string, boolean> = {};
      for (const g of monthlyGroups) {
        next[g.monthKey] = true;
      }
      setCollapsedMonths(next);
    }
  };

  const resetFilters = () => {
    setSearchQuery('');
    setRoleFilter('all');
    setAircraftFilter('all');
    setMarkFilter('all');
    setMonthFilter('all');
  };

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    roleFilter !== 'all' ||
    aircraftFilter !== 'all' ||
    markFilter !== 'all' ||
    monthFilter !== 'all';

  const renderTableHead = () => (
    <thead>
      <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
        <th className="px-4 py-3 whitespace-nowrap">
          <button
            type="button"
            onClick={() => toggleSort('date')}
            className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100"
          >
            Date
            {sortField === 'date' &&
              (sortDir === 'desc' ? (
                <ArrowDown className="h-3 w-3" />
              ) : (
                <ArrowUp className="h-3 w-3" />
              ))}
          </button>
        </th>
        <th className="px-3 py-3 whitespace-nowrap">Aircraft</th>
        <th className="px-3 py-3 whitespace-nowrap">Mark</th>
        <th className="px-3 py-3 whitespace-nowrap">From</th>
        <th className="px-3 py-3 whitespace-nowrap">To</th>
        <th className="px-3 py-3 whitespace-nowrap">Instructor</th>
        <th className="px-3 py-3 whitespace-nowrap">Sortie</th>
        <th className="px-3 py-3 whitespace-nowrap">Exercise</th>
        <th className="px-3 py-3 whitespace-nowrap">Type</th>
        <th className="px-3 py-3 text-right whitespace-nowrap">T/O</th>
        <th className="px-3 py-3 text-right whitespace-nowrap">Ldg</th>
        <th className="px-3 py-3 text-right whitespace-nowrap">
          <button
            type="button"
            onClick={() => toggleSort('totalMinutes')}
            className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100"
          >
            Time
            {sortField === 'totalMinutes' &&
              (sortDir === 'desc' ? (
                <ArrowDown className="h-3 w-3" />
              ) : (
                <ArrowUp className="h-3 w-3" />
              ))}
          </button>
        </th>
        <th className="px-3 py-3 text-right whitespace-nowrap">Night</th>
        <th className="px-3 py-3 text-right whitespace-nowrap">Inst</th>
        <th className="px-4 py-3 whitespace-nowrap">Source / Notes</th>
      </tr>
    </thead>
  );

  const renderFlightRow = (f: FlightEntry) => (
    <tr
      key={f.id}
      onClick={() => onSelectFlight(f)}
      className="cursor-pointer transition-colors hover:bg-blue-50/40 dark:hover:bg-blue-950/30"
    >
      <td className="px-4 py-2.5 font-mono text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">
        {formatShortSheetDate(f.date)}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{f.aircraftType}</span>
        <span className="ml-1.5 text-[11px] text-slate-400 dark:text-slate-500">
          {f.engineCategory === 'JET ENGINE'
            ? 'JET'
            : f.engineCategory === 'SIMULATOR'
              ? 'SIM'
              : 'SE'}
        </span>
      </td>
      <td
        className={`px-3 py-2.5 font-mono whitespace-nowrap ${
          f.aircraftMark ? 'font-medium text-slate-800 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'
        }`}
      >
        {f.aircraftMark || '—'}
      </td>
      <td
        className={`px-3 py-2.5 font-mono whitespace-nowrap ${
          f.departure ? 'font-medium text-slate-800 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'
        }`}
      >
        {f.departure || '—'}
      </td>
      <td
        className={`px-3 py-2.5 font-mono whitespace-nowrap ${
          f.arrival ? 'font-medium text-slate-800 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'
        }`}
      >
        {f.arrival || '—'}
      </td>
      <td className="px-3 py-2.5 font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap">
        {f.instructor || '—'}
      </td>
      <td
        className={`px-3 py-2.5 font-mono whitespace-nowrap ${
          f.sortie ? 'font-medium text-slate-800 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'
        }`}
      >
        {f.sortie || '—'}
      </td>
      <td className="px-3 py-2.5 text-slate-800 dark:text-slate-200">{f.exercise}</td>
      <td className="px-3 py-2.5 font-mono text-[11px] text-slate-600 dark:text-slate-400 whitespace-nowrap">
        {f.flightType}
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-slate-600 dark:text-slate-400 tabular-nums">{f.takeoffs}</td>
      <td className="px-3 py-2.5 text-right font-mono text-slate-600 dark:text-slate-400 tabular-nums">{f.landings}</td>
      <td className="px-3 py-2.5 text-right font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
        {formatHHMM(f.totalMinutes)}
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-slate-600 dark:text-slate-400 tabular-nums">
        {f.nightMinutes > 0 ? formatHHMM(f.nightMinutes) : '—'}
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-slate-600 dark:text-slate-400 tabular-nums">
        {f.instrumentMinutes > 0 ? formatHHMM(f.instrumentMinutes) : '—'}
      </td>
      <td className="px-4 py-2.5 max-w-[200px]">
        <div className="truncate text-slate-700 dark:text-slate-300" title={f.remarks}>
          {f.remarks || SOURCE_LABELS[f.source]}
        </div>
        {f.sheetRowNumber && (
          <div className="text-[11px] text-slate-400 dark:text-slate-500">
            {SOURCE_LABELS[f.source]} · Row {f.sheetRowNumber}
          </div>
        )}
      </td>
    </tr>
  );

  return (
    <div className="space-y-4">
      {/* Brought-forward notice when Dashboard summary + recent flights are loaded */}
      {baseline && (
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-600 dark:text-slate-400">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {baseline.flights + baseline.simulatorFlights} earlier sorties (
              {formatHHMM(baseline.totalMinutes + baseline.simulatorMinutes)} incl. sim)
            </span>{' '}
            are included in your Cumulative Career Total below. Connect or upload your full{' '}
            <span className="font-mono font-medium text-slate-800 dark:text-slate-200">Flights</span> tab to view
            monthly breakdowns for every historical sortie.
          </div>
          <button
            type="button"
            onClick={onNavigateToImport}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 self-start sm:self-auto dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
            Import Full Flights Tab
          </button>
        </div>
      )}

      {/* Filter, View Switcher & Search Toolbar */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-3">
            <div className="relative min-w-[210px] flex-1 max-w-sm">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search sortie, aircraft, mark, from/to, instructor..."
                aria-label="Search flights"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-8 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500 dark:focus:bg-slate-800"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div
              className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800"
              role="group"
              aria-label="Filter by flight type"
            >
              {(
                [
                  ['all', 'All'],
                  ['DUAL', 'Dual'],
                  ['SOLO', 'Solo / PIC'],
                  ['JET', 'Jet'],
                  ['NIGHT_IFR', 'Night / IFR'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setRoleFilter(key)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 ${
                    roleFilter === key
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Monthly vs Flat View Switcher */}
            <div
              className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800"
              role="group"
              aria-label="Logbook grouping mode"
            >
              <button
                type="button"
                onClick={() => setViewMode('monthly')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap ${
                  viewMode === 'monthly'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                Monthly View
              </button>
              <button
                type="button"
                onClick={() => setViewMode('flat')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap ${
                  viewMode === 'flat'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                <List className="h-3.5 w-3.5" aria-hidden="true" />
                All Rows
              </button>
            </div>

            <button
              type="button"
              onClick={onExportCsv}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Export CSV
            </button>
          </div>
        </div>

        {/* Secondary Filter Row: Month, Aircraft, Mark, Expand/Collapse */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-2">
            {monthOptions.length > 0 && (
              <select
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                aria-label="Filter by month"
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <option value="all">All Months ({monthOptions.length})</option>
                {monthOptions.map((mk) => (
                  <option key={mk} value={mk}>
                    {formatMonthLabel(mk)}
                  </option>
                ))}
              </select>
            )}

            <select
              value={aircraftFilter}
              onChange={(e) => setAircraftFilter(e.target.value)}
              aria-label="Filter by aircraft type"
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <option value="all">All Aircraft ({aircraftOptions.length})</option>
              {aircraftOptions.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>

            {markOptions.length > 0 && (
              <select
                value={markFilter}
                onChange={(e) => setMarkFilter(e.target.value)}
                aria-label="Filter by aircraft mark"
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <option value="all">All Marks ({markOptions.length})</option>
                {markOptions.map((mark) => (
                  <option key={mark} value={mark}>
                    {mark}
                  </option>
                ))}
              </select>
            )}

            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="px-2 text-xs font-medium text-blue-700 hover:underline whitespace-nowrap shrink-0 dark:text-blue-400"
              >
                Reset Filters
              </button>
            )}
          </div>

          {viewMode === 'monthly' && monthlyGroups.length > 1 && (
            <button
              type="button"
              onClick={toggleAllMonths}
              className="text-xs font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap dark:text-slate-400 dark:hover:text-slate-100"
            >
              {allCollapsed ? 'Expand All Months' : 'Collapse All Months'}
            </button>
          )}
        </div>
      </div>

      {/* Empty State */}
      {filteredFlights.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {flights.length === 0 ? 'No flight rows logged yet' : 'No matching flight entries'}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {flights.length === 0
              ? 'Log your first sortie or import your Flights tab from Google Sheets.'
              : 'Try adjusting your search keywords, month, role filter, or aircraft type.'}
          </p>
          <div className="mt-4 flex items-center justify-center gap-3">
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={resetFilters}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Clear Filters
              </button>
            ) : (
              <button
                type="button"
                onClick={onOpenNewFlight}
                className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800"
              >
                Log Flight
              </button>
            )}
          </div>
        </div>
      ) : viewMode === 'monthly' ? (
        /* Monthly Grouped Ledger Sections */
        <div className="space-y-4" data-testid="monthly-logbook-view">
          {monthlyGroups.map((group) => {
            const isCollapsed = Boolean(collapsedMonths[group.monthKey]);
            return (
              <section
                key={group.monthKey}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                aria-label={`${group.label} flight log`}
              >
                <button
                  type="button"
                  onClick={() => toggleMonthCollapsed(group.monthKey)}
                  aria-expanded={!isCollapsed}
                  className="flex w-full flex-col gap-2 border-b border-slate-200 bg-slate-50/90 px-4 py-3 text-left transition-colors hover:bg-slate-100/80 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-800/70 dark:hover:bg-slate-800"
                >
                  <div className="flex items-center gap-2.5">
                    {isCollapsed ? (
                      <ChevronRight className="h-4 w-4 text-slate-500 dark:text-slate-400 shrink-0" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-slate-500 dark:text-slate-400 shrink-0" aria-hidden="true" />
                    )}
                    <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {group.label}
                    </h3>
                    <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      {group.flightCountInclSim} sortie{group.flightCountInclSim === 1 ? '' : 's'}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-6 sm:pl-0 font-mono text-xs tabular-nums">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      Month Total: {formatHHMM(group.totalMinutes)}
                      {group.simulatorMinutes > 0 && (
                        <span className="ml-1 font-normal text-slate-500 dark:text-slate-400">
                          (+{formatHHMM(group.simulatorMinutes)} sim)
                        </span>
                      )}
                    </span>
                    <span className="text-slate-600 dark:text-slate-300">
                      Dual {formatHHMM(group.dualMinutes)} · Solo {formatHHMM(group.soloMinutes)}
                    </span>
                    <span className="text-slate-500 dark:text-slate-400">
                      {group.takeoffs} T/O · {group.landings} Ldg
                    </span>
                  </div>
                </button>

                {!isCollapsed && (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1160px] border-collapse text-left text-xs">
                      {renderTableHead()}
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                        {group.flights.map(renderFlightRow)}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-slate-200 bg-slate-50/80 font-mono text-xs font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100">
                          <td colSpan={9} className="px-4 py-2.5 font-sans text-xs text-slate-700 dark:text-slate-300">
                            Monthly Total · {group.label} ({group.flightCountInclSim}{' '}
                            {group.flightCountInclSim === 1 ? 'flight' : 'flights'})
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{group.takeoffs}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{group.landings}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            {formatHHMM(group.totalMinutes)}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            {group.nightMinutes > 0 ? formatHHMM(group.nightMinutes) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            {group.instrumentMinutes > 0
                              ? formatHHMM(group.instrumentMinutes)
                              : '—'}
                          </td>
                          <td className="px-4 py-2.5 font-sans text-[11px] font-normal text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            Dual {formatHHMM(group.dualMinutes)} · Solo{' '}
                            {formatHHMM(group.soloMinutes)}
                            {group.simulatorMinutes > 0
                              ? ` · Sim ${formatHHMM(group.simulatorMinutes)}`
                              : ''}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        /* Flat Chronological Ledger Table */
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table
              className="w-full min-w-[1160px] border-collapse text-left text-xs"
              data-testid="logbook-table"
            >
              {renderTableHead()}
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {filteredFlights.map(renderFlightRow)}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-mono text-xs font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100">
                  <td colSpan={9} className="px-4 py-3 font-sans text-xs text-slate-600 dark:text-slate-400">
                    Showing {filteredFlights.length} logged row
                    {filteredFlights.length === 1 ? '' : 's'}
                    {baseline && !hasActiveFilters
                      ? ` (+ ${baseline.flights + baseline.simulatorFlights} brought-forward)`
                      : ''}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{ledgerTotals.takeoffs}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{ledgerTotals.landings}</td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {formatHHMM(ledgerTotals.totalMinutes)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {formatHHMM(ledgerTotals.nightMinutes)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {formatHHMM(ledgerTotals.instrumentMinutes)}
                  </td>
                  <td className="px-4 py-3 font-sans text-[11px] font-normal text-slate-500 dark:text-slate-400">
                    Dual {formatHHMM(ledgerTotals.dualMinutes)} · Solo{' '}
                    {formatHHMM(ledgerTotals.soloMinutes)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Cumulative Totals Summary Bar (Always visible alongside Monthly Totals) */}
      <section
        className="overflow-hidden rounded-xl border border-slate-800 bg-[#0F1B2D] text-slate-100"
        aria-label="Cumulative logbook totals"
        data-testid="cumulative-totals-bar"
      >
        <div className="flex flex-col gap-2 border-b border-slate-800 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-display text-sm font-semibold text-white">
              Cumulative Logbook Total
            </h3>
            <p className="text-[11px] text-slate-400">
              {baseline
                ? `Includes ${baseline.flights + baseline.simulatorFlights} brought-forward sorties + ${flights.length} logged rows`
                : `Across all ${careerTotals.flightCountInclSim} logged sorties in your private ledger`}
            </p>
          </div>
          {hasActiveFilters && (
            <div className="rounded-lg bg-slate-800/80 px-3 py-1.5 font-mono text-xs text-slate-200 tabular-nums">
              Filtered View: {filteredFlights.length} flights ·{' '}
              {formatHHMM(ledgerTotals.totalMinutes)} hrs · {ledgerTotals.takeoffs} T/O ·{' '}
              {ledgerTotals.landings} Ldg
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-px bg-slate-800 sm:grid-cols-4 lg:grid-cols-8">
          <div className="bg-[#0F1B2D] px-4 py-3">
            <p className="text-[11px] text-slate-400">Total Flight</p>
            <p className="mt-1 font-mono text-base font-bold text-white tabular-nums">
              {formatHHMM(careerTotals.totalMinutes)}
            </p>
          </div>
          <div className="bg-[#0F1B2D] px-4 py-3">
            <p className="text-[11px] text-slate-400">Incl. Sim</p>
            <p className="mt-1 font-mono text-base font-semibold text-slate-100 tabular-nums">
              {formatHHMM(careerTotals.totalMinutesInclSim)}
            </p>
          </div>
          <div className="bg-[#0F1B2D] px-4 py-3">
            <p className="text-[11px] text-slate-400">Dual</p>
            <p className="mt-1 font-mono text-base font-semibold text-slate-100 tabular-nums">
              {formatHHMM(careerTotals.dualMinutes)}
            </p>
          </div>
          <div className="bg-[#0F1B2D] px-4 py-3">
            <p className="text-[11px] text-slate-400">Solo / PIC</p>
            <p className="mt-1 font-mono text-base font-semibold text-slate-100 tabular-nums">
              {formatHHMM(careerTotals.soloMinutes)}
            </p>
          </div>
          <div className="bg-[#0F1B2D] px-4 py-3">
            <p className="text-[11px] text-slate-400">Jet</p>
            <p className="mt-1 font-mono text-base font-semibold text-slate-100 tabular-nums">
              {formatHHMM(careerTotals.jetMinutes)}
            </p>
          </div>
          <div className="bg-[#0F1B2D] px-4 py-3">
            <p className="text-[11px] text-slate-400">Night / Inst</p>
            <p className="mt-1 font-mono text-sm font-semibold text-slate-100 tabular-nums">
              {formatHHMM(careerTotals.nightMinutes)} / {formatHHMM(careerTotals.instrumentMinutes)}
            </p>
          </div>
          <div className="bg-[#0F1B2D] px-4 py-3">
            <p className="text-[11px] text-slate-400">Flights</p>
            <p className="mt-1 font-mono text-base font-semibold text-slate-100 tabular-nums">
              {careerTotals.flightCount}
            </p>
          </div>
          <div className="bg-[#0F1B2D] px-4 py-3">
            <p className="text-[11px] text-slate-400">T/O · Ldg</p>
            <p className="mt-1 font-mono text-base font-semibold text-slate-100 tabular-nums">
              {careerTotals.takeoffs} · {careerTotals.landings}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
