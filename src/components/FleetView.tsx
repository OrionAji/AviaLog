import React, { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type {
  AircraftHoursSummary,
  AircraftMarkSummary,
  AircraftRecord,
  EngineCategory,
} from '../types/logbook';
import { formatHHMM, formatShortSheetDate } from '../utils/flightMath';

interface FleetViewProps {
  aircraftList: AircraftRecord[];
  aircraftBreakdown: AircraftHoursSummary[];
  markBreakdown: AircraftMarkSummary[];
  onSaveAircraft: (record: AircraftRecord) => void;
}

const EMPTY_AIRCRAFT: AircraftRecord = {
  type: '',
  fullName: '',
  engineCategory: 'JET ENGINE',
  role: '',
  marks: [],
  notes: '',
  source: 'manual',
};

function parseMarksInput(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[,;\n]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    )
  ).sort();
}

export const FleetView: React.FC<FleetViewProps> = ({
  aircraftList,
  aircraftBreakdown,
  markBreakdown,
  onSaveAircraft,
}) => {
  const [editing, setEditing] = useState<AircraftRecord | null>(null);
  const [marksInput, setMarksInput] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const combinedFleet = useMemo(() => {
    const map = new Map<
      string,
      { record: AircraftRecord; stats?: AircraftHoursSummary }
    >();

    for (const ac of aircraftList) {
      map.set(ac.type.toUpperCase(), { record: ac });
    }

    for (const st of aircraftBreakdown) {
      const key = st.aircraftType.toUpperCase();
      const existing = map.get(key);
      if (existing) {
        existing.stats = st;
      } else {
        map.set(key, {
          record: {
            type: st.aircraftType,
            fullName: st.aircraftType,
            engineCategory: st.engineCategory,
            role: 'Imported Aircraft',
            source: 'imported_sheet',
          },
          stats: st,
        });
      }
    }

    return Array.from(map.values());
  }, [aircraftList, aircraftBreakdown]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    if (!editing.type.trim() || !editing.fullName.trim()) {
      setFormError('Aircraft code and full model name are required.');
      return;
    }
    onSaveAircraft({
      ...editing,
      type: editing.type.trim().toUpperCase(),
      fullName: editing.fullName.trim(),
      marks: parseMarksInput(marksInput),
    });
    setEditing(null);
    setMarksInput('');
    setFormError(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Aircraft Types & Fleet</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            All single-engine, jet, and simulator airframes and marks in your fleet
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditing({ ...EMPTY_AIRCRAFT });
            setMarksInput('');
            setFormError(null);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800 whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add Aircraft Type
        </button>
      </div>

      {editing && (
        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-slate-300 bg-white p-5 space-y-4 dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {editing.type ? `Aircraft Type · ${editing.type}` : 'Add Aircraft Type'}
            </h3>
            <button
              type="button"
              onClick={() => setEditing(null)}
              aria-label="Close aircraft form"
              className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {formError && <p className="text-xs font-medium text-red-700 dark:text-red-400">{formError}</p>}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div>
              <label htmlFor="ac-code" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Logbook Code *
              </label>
              <input
                id="ac-code"
                type="text"
                placeholder="A-JET"
                value={editing.type}
                onChange={(e) => setEditing({ ...editing, type: e.target.value.toUpperCase() })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm uppercase text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="ac-fullname" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Full Aircraft Name *
              </label>
              <input
                id="ac-fullname"
                type="text"
                placeholder="Dassault/Dornier Alpha Jet"
                value={editing.fullName}
                onChange={(e) => setEditing({ ...editing, fullName: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
              />
            </div>

            <div>
              <label htmlFor="ac-engine" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Engine Class
              </label>
              <select
                id="ac-engine"
                value={editing.engineCategory}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    engineCategory: e.target.value as EngineCategory,
                  })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="SINGLE ENGINE">SINGLE ENGINE</option>
                <option value="JET ENGINE">JET ENGINE</option>
                <option value="MULTI ENGINE">MULTI ENGINE</option>
                <option value="SIMULATOR">SIMULATOR</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="ac-marks" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Aircraft Marks (comma-separated)
              </label>
              <input
                id="ac-marks"
                type="text"
                placeholder="NAF 455, NAF 456"
                value={marksInput}
                onChange={(e) => setMarksInput(e.target.value.toUpperCase())}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm uppercase text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
              />
            </div>
            <div>
              <label htmlFor="ac-role" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Role
              </label>
              <input
                id="ac-role"
                type="text"
                placeholder="Advanced Jet Trainer"
                value={editing.role}
                onChange={(e) => setEditing({ ...editing, role: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
              />
            </div>
            <div>
              <label htmlFor="ac-notes" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Notes
              </label>
              <input
                id="ac-notes"
                type="text"
                placeholder="Optional airframe notes..."
                value={editing.notes ?? ''}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800"
            >
              Save Aircraft
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 whitespace-nowrap dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
                <th className="px-5 py-3">Aircraft</th>
                <th className="px-4 py-3">Model & Role</th>
                <th className="px-4 py-3">Marks</th>
                <th className="px-4 py-3">Engine</th>
                <th className="px-4 py-3 text-right">Flights</th>
                <th className="px-4 py-3 text-right">Take-offs</th>
                <th className="px-4 py-3 text-right">Landings</th>
                <th className="px-4 py-3 text-right">Hours</th>
                <th className="px-4 py-3">Last Flown</th>
                <th className="px-5 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {combinedFleet.map(({ record, stats }) => {
                const allMarks = Array.from(
                  new Set([...(record.marks ?? []), ...(stats?.marks ?? [])])
                ).sort();
                return (
                  <tr key={record.type} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/60">
                    <td className="px-5 py-3.5 font-mono text-sm font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {record.type}
                    </td>
                    <td className="px-4 py-3.5">
                      <p className="font-medium text-slate-900 dark:text-slate-100">{record.fullName}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        {record.role}
                        {record.notes ? ` · ${record.notes}` : ''}
                      </p>
                    </td>
                    <td
                      className={`px-4 py-3.5 font-mono text-xs whitespace-nowrap ${
                        allMarks.length > 0 ? 'font-medium text-slate-800 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      {allMarks.length > 0 ? allMarks.join(', ') : '—'}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-[11px] text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {record.engineCategory}
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-slate-700 dark:text-slate-300 tabular-nums">
                      {stats?.flights ?? 0}
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-slate-700 dark:text-slate-300 tabular-nums">
                      {stats?.takeoffs ?? 0}
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-slate-700 dark:text-slate-300 tabular-nums">
                      {stats?.landings ?? 0}
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                      {formatHHMM(stats?.totalMinutes ?? 0)}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-slate-600 dark:text-slate-400 tabular-nums whitespace-nowrap">
                      {stats?.lastFlown ? formatShortSheetDate(stats.lastFlown) : 'Prior'}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(record);
                          setMarksInput(allMarks.join(', '));
                          setFormError(null);
                        }}
                        className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap dark:text-blue-400"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Hours by Aircraft Mark */}
      <section
        className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
        data-testid="fleet-marks-section"
      >
        <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Hours by Aircraft Mark</h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Per-tail / aircraft mark breakdown automatically aggregated from logged and imported sorties
          </p>
        </div>

        {markBreakdown.length === 0 ? (
          <div className="px-5 py-8 text-xs text-slate-500 dark:text-slate-400">
            No individual aircraft marks were populated in the 10 recent rows of the uploaded Dashboard summary CSV. Import your full{' '}
            <span className="font-mono font-medium text-slate-700 dark:text-slate-200">Flights</span> tab from Google Sheets (mapping the{' '}
            <span className="font-mono font-medium text-slate-700 dark:text-slate-200">Mark</span> column) or enter an Aircraft Mark when logging/editing a sortie to track hours per airframe mark here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
                  <th className="px-5 py-3">Mark</th>
                  <th className="px-4 py-3">Aircraft</th>
                  <th className="px-4 py-3">Engine</th>
                  <th className="px-4 py-3 text-right">Flights</th>
                  <th className="px-4 py-3 text-right">Take-offs</th>
                  <th className="px-4 py-3 text-right">Landings</th>
                  <th className="px-4 py-3 text-right">Hours</th>
                  <th className="px-5 py-3">Last Flown</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {markBreakdown.map((item) => (
                  <tr key={`${item.aircraftMark}-${item.aircraftType}`} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/60">
                    <td className="px-5 py-3 font-mono font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {item.aircraftMark}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {item.aircraftType}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {item.engineCategory}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-700 dark:text-slate-300 tabular-nums">
                      {item.flights}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-700 dark:text-slate-300 tabular-nums">
                      {item.takeoffs}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-700 dark:text-slate-300 tabular-nums">
                      {item.landings}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                      {formatHHMM(item.totalMinutes)}
                    </td>
                    <td className="px-5 py-3 font-mono text-slate-600 dark:text-slate-400 tabular-nums whitespace-nowrap">
                      {item.lastFlown ? formatShortSheetDate(item.lastFlown) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
