import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAircraftBreakdown,
  computeBlockMinutes,
  computeLogbookTotals,
  computeMarkBreakdown,
  computeYearlyBreakdown,
  formatHHMM,
  normalizeDateString,
  parseDurationToMinutes,
  validateFlightEntry,
} from './flightMath';
import { PILOT_AJI_BASELINE, PILOT_AJI_RECENT_FLIGHTS } from '../data/seedLogbook';
import type { FlightEntry } from '../types/logbook';

test('parseDurationToMinutes and formatHHMM preserve exact HH:MM precision', () => {
  assert.equal(parseDurationToMinutes('1:20'), 80);
  assert.equal(parseDurationToMinutes('0:55'), 55);
  assert.equal(parseDurationToMinutes('223:40'), 13420);
  assert.equal(parseDurationToMinutes('1:35:00'), 95);
  assert.equal(parseDurationToMinutes('1.5'), 90);
  assert.equal(formatHHMM(13420), '223:40');
  assert.equal(formatHHMM(11770), '196:10');
  assert.equal(formatHHMM(55), '0:55');
  assert.equal(computeBlockMinutes('09:15', '10:35'), 80);
  assert.equal(computeBlockMinutes('23:20', '00:40'), 80);
});

test('normalizeDateString handles Pilot AJI DD-MMM-YY sheet dates accurately', () => {
  assert.equal(normalizeDateString('14-Nov-26'), '2026-11-14');
  assert.equal(normalizeDateString('04-Nov-26'), '2026-11-04');
  assert.equal(normalizeDateString('22-Feb-25'), '2025-02-22');
  assert.equal(normalizeDateString('07-Oct-24'), '2024-10-07');
  assert.equal(normalizeDateString('09 Nov 2020'), '2020-11-09');
  assert.equal(normalizeDateString('11/19/2026'), '2026-11-19');
});

test('Pilot AJI baseline + 10 recent flights match every Dashboard figure to the exact minute', () => {
  const totals = computeLogbookTotals(PILOT_AJI_RECENT_FLIGHTS, PILOT_AJI_BASELINE, '2026-11-23');
  assert.equal(formatHHMM(totals.totalMinutes), '223:40');
  assert.equal(formatHHMM(totals.dualMinutes), '196:10');
  assert.equal(formatHHMM(totals.soloMinutes), '27:30');
  assert.equal(formatHHMM(totals.jetMinutes), '151:00');
  assert.equal(formatHHMM(totals.nightMinutes), '8:10');
  assert.equal(formatHHMM(totals.simulatorMinutes), '3:00');
  assert.equal(formatHHMM(totals.totalMinutesInclSim), '226:40');
  assert.equal(formatHHMM(totals.instrumentMinutes), '20:05');

  assert.equal(totals.flightCount, 213);
  assert.equal(totals.flightCountInclSim, 216);
  assert.equal(totals.takeoffs, 213);
  assert.equal(totals.takeoffsInclSim, 216);
  assert.equal(totals.landings, 515);
  assert.equal(totals.landingsInclSim, 518);
  assert.equal(totals.approaches, 44);
  assert.equal(totals.daysSinceLastFlight, 9);
  assert.equal(totals.firstFlightDate, '2020-11-09');
  assert.equal(totals.lastFlightDate, '2026-11-14');
});

test('Hours by Aircraft Type matches all 6 aircraft rows from Pilot AJI sheet', () => {
  const breakdown = computeAircraftBreakdown(PILOT_AJI_RECENT_FLIGHTS, PILOT_AJI_BASELINE);
  const byType = Object.fromEntries(breakdown.map((a) => [a.aircraftType, a]));

  assert.equal(formatHHMM(byType['SMK'].totalMinutes), '70:05');
  assert.equal(byType['SMK'].flights, 67);
  assert.equal(byType['SMK'].landings, 246);

  assert.equal(formatHHMM(byType['DA-40'].totalMinutes), '2:35');
  assert.equal(formatHHMM(byType['DA-40 FSTD'].totalMinutes), '3:00');

  assert.equal(formatHHMM(byType['K8-E'].totalMinutes), '124:30');
  assert.equal(byType['K8-E'].flights, 121);
  assert.equal(byType['K8-E'].landings, 232);

  assert.equal(formatHHMM(byType['L-39ZA'].totalMinutes), '20:10');
  assert.equal(byType['L-39ZA'].flights, 17);
  assert.equal(byType['L-39ZA'].landings, 28);

  assert.equal(formatHHMM(byType['A-JET'].totalMinutes), '6:20');
  assert.equal(byType['A-JET'].flights, 5);
  assert.equal(byType['A-JET'].landings, 5);
});

test('Hours by Year (2020–2026) matches Pilot AJI sheet and updates live on new flight', () => {
  const yearly = computeYearlyBreakdown(PILOT_AJI_RECENT_FLIGHTS, PILOT_AJI_BASELINE);
  const byYear = Object.fromEntries(yearly.map((y) => [y.year, y]));

  assert.equal(byYear[2020].flights, 27);
  assert.equal(formatHHMM(byYear[2020].dualMinutes), '24:25');
  assert.equal(formatHHMM(byYear[2020].soloMinutes), '2:10');

  assert.equal(byYear[2023].flights, 114);
  assert.equal(formatHHMM(byYear[2023].dualMinutes), '97:35');
  assert.equal(formatHHMM(byYear[2023].soloMinutes), '19:05');

  assert.equal(byYear[2024].flights, 17);
  assert.equal(formatHHMM(byYear[2024].dualMinutes), '20:10');

  assert.equal(byYear[2025].flights, 1);
  assert.equal(formatHHMM(byYear[2025].dualMinutes), '1:00');

  assert.equal(byYear[2026].flights, 4);
  assert.equal(formatHHMM(byYear[2026].dualMinutes), '5:20');

  // Add a new 1:15 A-JET Dual flight on 2026-11-22
  const newFlight: FlightEntry = {
    id: 'test-new',
    date: '2026-11-22',
    aircraftType: 'A-JET',
    aircraftMark: '',
    engineCategory: 'JET ENGINE',
    instructor: 'ZINGZHI',
    exercise: 'ARMED RECCE',
    flightType: 'DUAL',
    totalMinutes: 75,
    dualMinutes: 75,
    soloMinutes: 0,
    nightMinutes: 0,
    instrumentMinutes: 0,
    simulatorMinutes: 0,
    takeoffs: 1,
    landings: 1,
    approaches: 0,
    remarks: '',
    source: 'manual',
  };

  const nextTotals = computeLogbookTotals(
    [newFlight, ...PILOT_AJI_RECENT_FLIGHTS],
    PILOT_AJI_BASELINE,
    '2026-11-22'
  );
  assert.equal(formatHHMM(nextTotals.totalMinutes), '224:55');
  assert.equal(formatHHMM(nextTotals.dualMinutes), '197:25');
  assert.equal(formatHHMM(nextTotals.jetMinutes), '152:15');
  assert.equal(nextTotals.flightCount, 214);
  assert.equal(nextTotals.daysSinceLastFlight, 0);
});

test('validateFlightEntry catches missing required fields and invalid sub-durations', () => {
  const emptyErrs = validateFlightEntry({});
  assert.ok(emptyErrs.date);
  assert.ok(emptyErrs.aircraftType);
  assert.ok(emptyErrs.exercise);
  assert.ok(emptyErrs.totalMinutes);

  const subErrs = validateFlightEntry({
    date: '2026-11-22',
    aircraftType: 'A-JET',
    exercise: 'ARMED RECCE',
    totalMinutes: 60,
    nightMinutes: 75,
  });
  assert.ok(subErrs.subTimes);

  const okErrs = validateFlightEntry({
    date: '2026-11-22',
    aircraftType: 'A-JET',
    exercise: 'ARMED RECCE',
    totalMinutes: 80,
    nightMinutes: 20,
    instrumentMinutes: 15,
  });
  assert.equal(Object.keys(okErrs).length, 0);
});

test('computeMarkBreakdown and computeAircraftBreakdown aggregate aircraft marks accurately', () => {
  const markedFlights: FlightEntry[] = [
    {
      ...PILOT_AJI_RECENT_FLIGHTS[0],
      id: 'm-1',
      aircraftType: 'A-JET',
      aircraftMark: 'NAF 455',
      totalMinutes: 80,
      dualMinutes: 80,
    },
    {
      ...PILOT_AJI_RECENT_FLIGHTS[1],
      id: 'm-2',
      aircraftType: 'A-JET',
      aircraftMark: 'NAF 455',
      totalMinutes: 60,
      dualMinutes: 60,
    },
    {
      ...PILOT_AJI_RECENT_FLIGHTS[5],
      id: 'm-3',
      aircraftType: 'L-39ZA',
      aircraftMark: 'NAF 357',
      totalMinutes: 70,
      dualMinutes: 70,
    },
  ];

  const markSummary = computeMarkBreakdown(markedFlights);
  assert.equal(markSummary.length, 2);
  assert.equal(markSummary[0].aircraftMark, 'NAF 455');
  assert.equal(markSummary[0].flights, 2);
  assert.equal(formatHHMM(markSummary[0].totalMinutes), '2:20');
  assert.equal(markSummary[1].aircraftMark, 'NAF 357');
  assert.equal(formatHHMM(markSummary[1].totalMinutes), '1:10');

  const acBreakdown = computeAircraftBreakdown(markedFlights, null);
  const aJet = acBreakdown.find((a) => a.aircraftType === 'A-JET');
  assert.deepEqual(aJet?.marks, ['NAF 455']);
});

test('computeMonthlyGroups breaks flights into monthly buckets with exact HH:MM monthly totals', async () => {
  const { computeMonthlyGroups, formatMonthLabel } = await import('./flightMath');

  assert.equal(formatMonthLabel('2026-11'), 'November 2026');
  assert.equal(formatMonthLabel('2024-10'), 'October 2024');
  assert.equal(formatMonthLabel('undated'), 'Undated');

  const groups = computeMonthlyGroups(PILOT_AJI_RECENT_FLIGHTS, 'desc');
  // Recent flights span 2026-11 (3), 2026-08 (1), 2025-02 (1), 2024-11 (2), 2024-10 (3)
  assert.equal(groups.length, 5);
  assert.equal(groups[0].monthKey, '2026-11');
  assert.equal(groups[0].label, 'November 2026');
  assert.equal(groups[0].flightCount, 3);
  assert.equal(formatHHMM(groups[0].totalMinutes), '4:15');
  assert.equal(groups[0].takeoffs, 3);
  assert.equal(groups[0].landings, 3);

  assert.equal(groups[1].monthKey, '2026-09');
  assert.equal(groups[1].label, 'September 2026');
  assert.equal(groups[1].flightCount, 1);
  assert.equal(formatHHMM(groups[1].totalMinutes), '1:05');

  assert.equal(groups[3].monthKey, '2024-12');
  assert.equal(groups[3].label, 'December 2024');
  assert.equal(groups[3].flightCount, 4);
  assert.equal(formatHHMM(groups[3].totalMinutes), '5:00');

  assert.equal(groups[4].monthKey, '2024-10');
  assert.equal(groups[4].label, 'October 2024');
  assert.equal(groups[4].flightCount, 1);
  assert.equal(formatHHMM(groups[4].totalMinutes), '0:55');

  // Verify sum of all monthly totals equals the sum of all input flights
  const sumMonthlyMinutes = groups.reduce((acc, g) => acc + g.totalMinutes, 0);
  const sumFlightMinutes = PILOT_AJI_RECENT_FLIGHTS.reduce((acc, f) => acc + f.totalMinutes, 0);
  assert.equal(sumMonthlyMinutes, sumFlightMinutes);

  // Ascending order check
  const ascGroups = computeMonthlyGroups(PILOT_AJI_RECENT_FLIGHTS, 'asc');
  assert.equal(ascGroups[0].monthKey, '2024-10');
  assert.equal(ascGroups[ascGroups.length - 1].monthKey, '2026-11');
});

