import test from 'node:test';
import assert from 'node:assert/strict';
import type { FlightEntry } from '../types/logbook';
import { PILOT_AJI_RECENT_FLIGHTS } from '../data/seedLogbook';
import {
  addDaysToIsoDate,
  computeMissionCurrencyReport,
  formatCurrencyCountdown,
  MISSION_CURRENCY_RULES,
} from './missionCurrency';

function makeFlight(overrides: Partial<FlightEntry>): FlightEntry {
  return {
    id: 'f-1',
    date: '2026-11-15',
    aircraftType: 'A-JET',
    aircraftMark: '',
    engineCategory: 'JET ENGINE',
    instructor: 'ZINGZHI',
    exercise: 'ARMED RECCE',
    flightType: 'DUAL',
    totalMinutes: 60,
    dualMinutes: 60,
    soloMinutes: 0,
    nightMinutes: 0,
    instrumentMinutes: 0,
    simulatorMinutes: 0,
    takeoffs: 1,
    landings: 1,
    approaches: 0,
    remarks: '',
    source: 'manual',
    ...overrides,
  };
}

test('addDaysToIsoDate shifts calendar dates accurately across month boundaries', () => {
  assert.equal(addDaysToIsoDate('2026-11-04', 30), '2026-12-04');
  assert.equal(addDaysToIsoDate('2026-11-14', 90), '2027-02-12');
});

test('returns overallStatus "none" when there are no flights and no fallback date', () => {
  const report = computeMissionCurrencyReport([], '2026-11-24');
  assert.equal(report.overallStatus, 'none');
  assert.equal(report.items.length, 0);
  assert.equal(report.flaggedItems.length, 0);
});

test('MISSION_CURRENCY_RULES defines the exact 7 criteria and validity windows', () => {
  const byId = Object.fromEntries(MISSION_CURRENCY_RULES.map((r) => [r.id, r.validityDays]));
  assert.deepEqual(byId, {
    instrument: 30,
    night_flying: 60,
    contact_gh: 90,
    simulated_air_ground: 90,
    live_air_ground: 180,
    formation: 90,
    navigation: 90,
  });
});

test('flags expiring mission currency when within warning threshold and marks healthy missions current', () => {
  const flights: FlightEntry[] = [
    makeFlight({
      id: 'f-if',
      date: '2026-11-01', // 23 days before 2026-11-24 -> 7 days remaining on 30-day window (warn <= 10d)
      exercise: 'INSTRUMENT',
    }),
    makeFlight({
      id: 'f-nav',
      date: '2026-11-20', // 4 days before 2026-11-24 -> 86 days remaining on 90-day window
      exercise: 'NAVIGATION',
    }),
  ];

  const report = computeMissionCurrencyReport(flights, '2026-11-24');
  assert.equal(report.overallStatus, 'expiring');
  assert.equal(report.expiringCount, 1);
  assert.equal(report.expiredCount, 0);
  assert.equal(report.flaggedItems.length, 1);
  assert.equal(report.flaggedItems[0].id, 'instrument');
  assert.equal(report.flaggedItems[0].daysRemaining, 7);
  assert.equal(report.flaggedItems[0].expiresOn, '2026-12-01');
  assert.equal(formatCurrencyCountdown(report.flaggedItems[0]), '7 days left');
});

test('evaluates Pilot AJI seed flights accurately against 2026-11-24 with updated windows', () => {
  const report = computeMissionCurrencyReport(PILOT_AJI_RECENT_FLIGHTS, '2026-11-24');

  assert.equal(report.overallStatus, 'expired');
  const nav = report.items.find((i) => i.id === 'navigation');
  const simAg = report.items.find((i) => i.id === 'simulated_air_ground');
  const form = report.items.find((i) => i.id === 'formation');

  assert.ok(nav);
  assert.equal(nav.lastFlightDate, '2026-11-04');
  assert.equal(nav.validityDays, 90);
  assert.equal(nav.status, 'current');
  assert.equal(nav.daysRemaining, 70);

  assert.ok(simAg);
  assert.equal(simAg.lastFlightDate, '2026-11-14');
  assert.equal(simAg.validityDays, 90);
  assert.equal(simAg.status, 'current');
  assert.equal(simAg.daysRemaining, 80);

  assert.ok(form);
  assert.equal(form.lastFlightDate, '2024-12-19');
  assert.equal(form.validityDays, 90);
  assert.equal(form.status, 'expired');
  assert.ok(form.daysRemaining < 0);

  assert.ok(report.generalFlightItem);
  assert.equal(report.generalFlightItem.status, 'current');
  assert.equal(report.generalFlightItem.daysRemaining, 80);

  // Unlogged mission categories should not generate false alerts
  assert.equal(report.items.find((i) => i.id === 'night_flying'), undefined);
  assert.equal(report.items.find((i) => i.id === 'instrument'), undefined);
  assert.equal(report.items.find((i) => i.id === 'live_air_ground'), undefined);
});

test('simulator flights count toward 30-day Instrument Flying currency but not live flight currency', () => {
  const flights: FlightEntry[] = [
    makeFlight({
      id: 'sim-1',
      date: '2026-11-20',
      aircraftType: 'DA-40 FSTD',
      engineCategory: 'SIMULATOR',
      flightType: 'SIMULATOR',
      exercise: 'ILS APPROACHES',
      totalMinutes: 60,
      simulatorMinutes: 60,
      instrumentMinutes: 60,
      approaches: 3,
    }),
  ];

  const report = computeMissionCurrencyReport(flights, '2026-11-24');
  assert.equal(report.generalFlightItem, null);
  const ifr = report.items.find((i) => i.id === 'instrument');
  assert.ok(ifr);
  assert.equal(ifr.validityDays, 30);
  assert.equal(ifr.status, 'current');
  assert.equal(ifr.daysRemaining, 26);
});

test('Night Flying (60d), Contact/GH (90d), Simulated Air-Ground (90d), and Live Air-Ground (180d) classify accurately', () => {
  const flights: FlightEntry[] = [
    makeFlight({
      id: 'night-1',
      date: '2026-10-01', // 54 days before 2026-11-24 -> 6 days left on 60-day window (expiring)
      exercise: 'CIRCUITS',
      nightMinutes: 45,
    }),
    makeFlight({
      id: 'gh-1',
      date: '2026-11-10', // 14 days ago -> 76 days left on 90-day Contact/GH window (current)
      exercise: 'GH',
    }),
    makeFlight({
      id: 'sim-ag-1',
      date: '2026-09-01', // 84 days ago -> 6 days left on 90-day Sim A/G window (expiring)
      exercise: 'SIMULATED AIR-GROUND',
    }),
    makeFlight({
      id: 'live-ag-1',
      date: '2026-06-10', // 167 days ago -> 13 days left on 180-day Live A/G window (expiring <= 21d)
      exercise: 'LIVE AIR-GROUND',
    }),
  ];

  const report = computeMissionCurrencyReport(flights, '2026-11-24');

  const night = report.items.find((i) => i.id === 'night_flying');
  assert.ok(night);
  assert.equal(night.validityDays, 60);
  assert.equal(night.status, 'expiring');
  assert.equal(night.daysRemaining, 6);

  const gh = report.items.find((i) => i.id === 'contact_gh');
  assert.ok(gh);
  assert.equal(gh.validityDays, 90);
  assert.equal(gh.status, 'current');
  assert.equal(gh.daysRemaining, 76);

  const simAg = report.items.find((i) => i.id === 'simulated_air_ground');
  assert.ok(simAg);
  assert.equal(simAg.validityDays, 90);
  assert.equal(simAg.status, 'expiring');
  assert.equal(simAg.daysRemaining, 6);

  const liveAg = report.items.find((i) => i.id === 'live_air_ground');
  assert.ok(liveAg);
  assert.equal(liveAg.validityDays, 180);
  assert.equal(liveAg.status, 'expiring');
  assert.equal(liveAg.daysRemaining, 13);
});

test('formatCurrencyCountdown formats expiring today, singular day, and overdue cleanly', () => {
  assert.equal(formatCurrencyCountdown({ status: 'expiring', daysRemaining: 0 }), 'Expires today');
  assert.equal(formatCurrencyCountdown({ status: 'expiring', daysRemaining: 1 }), '1 day left');
  assert.equal(formatCurrencyCountdown({ status: 'expired', daysRemaining: -1 }), '1 day overdue');
  assert.equal(formatCurrencyCountdown({ status: 'expired', daysRemaining: -12 }), '12 days overdue');
});

test('any sortie saying "hot" is classified as Live Air-Ground (180d) and excluded from Simulated Air-Ground', () => {
  const flights: FlightEntry[] = [
    makeFlight({
      id: 'hot-sortie-ref',
      date: '2026-10-20', // 35 days before 2026-11-24 -> 145 days left on 180-day Live Air-Ground window
      sortie: 'A/G HOT 1',
      exercise: 'ARMED RECCE',
    }),
    makeFlight({
      id: 'dry-ag',
      date: '2026-09-10', // 75 days before 2026-11-24 -> 15 days left on 90-day Simulated Air-Ground window
      sortie: 'A/G DRY 2',
      exercise: 'ARMED RECCE',
    }),
    makeFlight({
      id: 'non-ordnance-hot',
      date: '2026-11-20',
      sortie: 'NAV 5',
      exercise: 'NAVIGATION',
      remarks: 'Hot weather and hot start delay, photo pass',
    }),
  ];

  const report = computeMissionCurrencyReport(flights, '2026-11-24');

  const liveAg = report.items.find((i) => i.id === 'live_air_ground');
  assert.ok(liveAg);
  assert.equal(liveAg.lastFlightDate, '2026-10-20');
  assert.equal(liveAg.validityDays, 180);
  assert.equal(liveAg.daysRemaining, 145);
  assert.equal(liveAg.status, 'current');

  // The hot sortie on 2026-10-20 must NOT refresh Simulated Air-Ground; Simulated stays anchored to 2026-09-10
  const simAg = report.items.find((i) => i.id === 'simulated_air_ground');
  assert.ok(simAg);
  assert.equal(simAg.lastFlightDate, '2026-09-10');
  assert.equal(simAg.validityDays, 90);
  assert.equal(simAg.daysRemaining, 15);
  assert.equal(simAg.status, 'current');

  // A sortie whose name is simply "HOT" (even with generic exercise) counts for Live Air-Ground
  const hotOnlyReport = computeMissionCurrencyReport(
    [
      makeFlight({
        id: 'hot-2',
        date: '2026-11-10',
        sortie: 'HOT',
        exercise: 'TACTICAL',
      }),
    ],
    '2026-11-24'
  );
  const liveFromSortie = hotOnlyReport.items.find((i) => i.id === 'live_air_ground');
  assert.ok(liveFromSortie);
  assert.equal(liveFromSortie.lastFlightDate, '2026-11-10');
  assert.equal(liveFromSortie.daysRemaining, 166);
  assert.equal(hotOnlyReport.items.find((i) => i.id === 'simulated_air_ground'), undefined);
});

