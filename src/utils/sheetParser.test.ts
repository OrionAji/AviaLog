import test from 'node:test';
import assert from 'node:assert/strict';
import {
  autoDetectColumnMapping,
  backfillMarksFromCustomFields,
  detectHeaderRowIndex,
  exportFlightsToCsv,
  extractHeadersAndDataRows,
  extractSpreadsheetId,
  isDashboardSummaryCsv,
  mapRowsToFlights,
  parseAppSheetSchemaText,
  parseDelimitedText,
  serializeFlightToSheetRow,
  splitCombinedRoute,
  upgradeConnectedSheetMapping,
} from './sheetParser';
import {
  PILOT_AJI_RECENT_FLIGHTS,
  SAMPLE_APPSHEET_SCHEMA,
  SAMPLE_FLIGHTS_TAB_CSV,
} from '../data/seedLogbook';

test('extractSpreadsheetId parses full Google Sheets URLs and raw IDs', () => {
  assert.equal(
    extractSpreadsheetId(
      'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0'
    ),
    '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'
  );
  assert.equal(extractSpreadsheetId('invalid'), null);
});

test('autoDetectColumnMapping and mapRowsToFlights parse Pilot AJI Flights sheet format', () => {
  const rows = parseDelimitedText(SAMPLE_FLIGHTS_TAB_CSV);
  assert.equal(isDashboardSummaryCsv(rows), false);
  const headers = rows[0];
  const dataRows = rows.slice(1);

  const mapping = autoDetectColumnMapping(headers);
  assert.equal(mapping[0], 'date');
  assert.equal(mapping[1], 'aircraftType');
  assert.equal(mapping[2], 'engineCategory');
  assert.equal(mapping[4], 'instructor');
  assert.equal(mapping[5], 'exercise');
  assert.equal(mapping[6], 'flightType');
  assert.equal(mapping[9], 'totalTime');

  const res = mapRowsToFlights(headers, dataRows, mapping, 'appsheet_csv');
  assert.equal(res.flights.length, 4);
  assert.equal(res.skippedRows, 0);
  assert.equal(res.flights[0].date, '2026-11-14');
  assert.equal(res.flights[0].aircraftType, 'A-JET');
  assert.equal(res.flights[0].instructor, 'ZINGZHI');
  assert.equal(res.flights[0].exercise, 'ARMED RECCE');
  assert.equal(res.flights[0].totalMinutes, 80);
  assert.equal(res.flights[0].dualMinutes, 80);
  assert.equal(res.flights[1].totalMinutes, 95);
  assert.equal(res.flights[1].instrumentMinutes, 20);
  assert.equal(res.flights[1].approaches, 1);
});

test('isDashboardSummaryCsv recognizes Pilot AJI Dashboard summary CSV export', () => {
  const sampleDashboard = `,PILOT FLIGHT LOGBOOK,,,\n,TOTAL FLIGHT HOURS,,DUAL RECEIVED,\n,223:40,,196:10,`;
  assert.equal(isDashboardSummaryCsv(parseDelimitedText(sampleDashboard)), true);
});

test('serializeFlightToSheetRow and exportFlightsToCsv emit HH:MM durations cleanly', () => {
  const headers = ['Date', 'Aircraft', 'Instructor', 'Exercise', 'Type', 'Landings', 'Time'];
  const mapping = autoDetectColumnMapping(headers);
  const row = serializeFlightToSheetRow(PILOT_AJI_RECENT_FLIGHTS[0], headers, mapping);
  assert.equal(row[0], '14-Nov-26');
  assert.equal(row[1], 'A-JET');
  assert.equal(row[2], 'ZINGZHI');
  assert.equal(row[6], '1:20');

  const csv = exportFlightsToCsv(PILOT_AJI_RECENT_FLIGHTS.slice(0, 2));
  const parsed = parseDelimitedText(csv);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0][1], 'Aircraft');
  assert.equal(parsed[0][4], 'From');
  assert.equal(parsed[0][5], 'To');
  assert.equal(parsed[0][7], 'Sortie Ref');
  assert.equal(parsed[0][8], 'Exercise');
  assert.equal(parsed[1][1], 'A-JET');
});

test('parseAppSheetSchemaText parses Pilot AJI AppSheet column schema', () => {
  const fields = parseAppSheetSchemaText(SAMPLE_APPSHEET_SCHEMA);
  assert.ok(fields.length >= 10);
  const timeField = fields.find((f) => f.name === 'Time');
  assert.equal(timeField?.mappedTo, 'totalTime');
  const exerciseField = fields.find((f) => f.name === 'Exercise');
  assert.equal(exerciseField?.mappedTo, 'exercise');
});

test('autoDetectColumnMapping and mapRowsToFlights preserve Aircraft Mark variants', () => {
  const csv = `Date,Aircraft,Aircraft Mark,Instructor,Exercise,Type,Landings,Time
14-Nov-26,A-JET,NAF 455,ZINGZHI,ARMED RECCE,DUAL,1,1:20
19-Dec-24,L-39ZA,NAF 357,RAJI,FORMATION,DUAL,1,1:10`;
  const rows = parseDelimitedText(csv);
  const mapping = autoDetectColumnMapping(rows[0]);
  assert.equal(mapping[1], 'aircraftType');
  assert.equal(mapping[2], 'aircraftMark');

  const res = mapRowsToFlights(rows[0], rows.slice(1), mapping, 'google_sheets');
  assert.equal(res.flights[0].aircraftMark, 'NAF 455');
  assert.equal(res.flights[1].aircraftMark, 'NAF 357');

  const altMapping = autoDetectColumnMapping(['Date', 'Aircraft', 'A/C Mark', 'Time']);
  assert.equal(altMapping[2], 'aircraftMark');

  // Serial / S/N row counter before Aircraft Mark must NOT steal aircraftMark
  const withSerial = autoDetectColumnMapping([
    'Serial No',
    'Date',
    'Aircraft',
    'Aircraft Mark',
    'Instructor',
    'Exercise',
    'Type',
    'Time',
  ]);
  assert.equal(withSerial[0], 'ignore');
  assert.equal(withSerial[2], 'aircraftType');
  assert.equal(withSerial[3], 'aircraftMark');
});

test('detectHeaderRowIndex skips title banners and backfillMarksFromCustomFields promotes Aircraft Mark', () => {
  const sheetWithBanner = [
    ['', 'PILOT AJI FLIGHTS LOG'],
    ['', ''],
    ['S/N', 'Date', 'Aircraft', 'Aircraft Mark', 'Instructor', 'Exercise', 'Type', 'Time'],
    ['1', '14-Nov-26', 'A-JET', 'Mk 2', 'ZINGZHI', 'ARMED RECCE', 'DUAL', '1:20'],
  ];
  const headerIdx = detectHeaderRowIndex(sheetWithBanner);
  assert.equal(headerIdx, 2);

  const mapping = autoDetectColumnMapping(sheetWithBanner[headerIdx]);
  const res = mapRowsToFlights(
    sheetWithBanner[headerIdx],
    sheetWithBanner.slice(headerIdx + 1),
    mapping,
    'google_sheets',
    headerIdx + 2
  );
  assert.equal(res.flights[0].aircraftMark, 'Mk 2');
  assert.equal(res.flights[0].sheetRowNumber, 4);

  const legacyFlight = {
    ...PILOT_AJI_RECENT_FLIGHTS[0],
    aircraftMark: '',
    customFields: { 'Aircraft Mark': 'NAF 455', Notes: 'Range sortie' },
  };
  const backfilled = backfillMarksFromCustomFields([legacyFlight]);
  assert.equal(backfilled.updatedCount, 1);
  assert.equal(backfilled.flights[0].aircraftMark, 'NAF 455');
  assert.equal(backfilled.flights[0].customFields?.['Aircraft Mark'], undefined);
  assert.equal(backfilled.flights[0].customFields?.['Notes'], 'Range sortie');
});

test('autoDetectColumnMapping and mapRowsToFlights map From, To, Sortie, and Exercise without collision', () => {
  const csv = `Date,Sortie,Aircraft,Aircraft Mark,From,To,Instructor,Exercise,Type,Landings,Time
14-Nov-26,S-01,A-JET,NAF 455,DNKA,DNAA,ZINGZHI,ARMED RECCE,DUAL,1,1:20
19-Dec-24,2,L-39ZA,NAF 357,DNKN,DNKN,RAJI,FORMATION,DUAL,1,1:10`;
  const rows = parseDelimitedText(csv);
  const headers = rows[0];
  const mapping = autoDetectColumnMapping(headers);

  assert.equal(mapping[0], 'date');
  assert.equal(mapping[1], 'sortie');
  assert.equal(mapping[2], 'aircraftType');
  assert.equal(mapping[3], 'aircraftMark');
  assert.equal(mapping[4], 'departure');
  assert.equal(mapping[5], 'arrival');
  assert.equal(mapping[6], 'instructor');
  assert.equal(mapping[7], 'exercise');

  const res = mapRowsToFlights(headers, rows.slice(1), mapping, 'google_sheets');
  assert.equal(res.flights.length, 2);
  assert.equal(res.flights[0].sortie, 'S-01');
  assert.equal(res.flights[0].departure, 'DNKA');
  assert.equal(res.flights[0].arrival, 'DNAA');
  assert.equal(res.flights[0].exercise, 'ARMED RECCE');
  assert.equal(res.flights[1].sortie, '2');
  assert.equal(res.flights[1].departure, 'DNKN');
  assert.equal(res.flights[1].arrival, 'DNKN');

  // Round-trip serialization back to Google Sheets row preserves Sortie, From, To
  const serialized = serializeFlightToSheetRow(res.flights[0], headers, mapping);
  assert.equal(serialized[1], 'S-01');
  assert.equal(serialized[4], 'DNKA');
  assert.equal(serialized[5], 'DNAA');
  assert.equal(serialized[7], 'ARMED RECCE');

  // Backfill promotes legacy customFields for Sortie, From, and To
  const legacyFlight = {
    ...PILOT_AJI_RECENT_FLIGHTS[0],
    customFields: { Sortie: '42', From: 'dnka', To: 'dnaa', Extra: 'Keep' },
  };
  const backfilled = backfillMarksFromCustomFields([legacyFlight]);
  assert.equal(backfilled.updatedCount, 1);
  assert.equal(backfilled.flights[0].sortie, '42');
  assert.equal(backfilled.flights[0].departure, 'DNKA');
  assert.equal(backfilled.flights[0].arrival, 'DNAA');
  assert.equal(backfilled.flights[0].customFields?.Sortie, undefined);
  assert.equal(backfilled.flights[0].customFields?.From, undefined);
  assert.equal(backfilled.flights[0].customFields?.To, undefined);
  assert.equal(backfilled.flights[0].customFields?.Extra, 'Keep');

  // upgradeConnectedSheetMapping upgrades saved configs where Sortie was custom or collided with exercise
  const upgraded = upgradeConnectedSheetMapping({
    spreadsheetId: 'sheet-123',
    spreadsheetTitle: 'Pilot Logbook',
    sheetName: 'Flights',
    headers: ['Date', 'Sortie', 'Aircraft', 'Aircraft Mark', 'From', 'To', 'Exercise', 'Time'],
    mapping: {
      0: 'date',
      1: 'exercise',
      2: 'aircraftType',
      3: 'custom',
      4: 'custom',
      5: 'custom',
      6: 'custom',
      7: 'totalTime',
    },
    lastSyncedAt: '2026-11-23T00:00:00Z',
    rowCount: 10,
    appSheetDetected: true,
  });
  assert.equal(upgraded?.mapping[1], 'sortie');
  assert.equal(upgraded?.mapping[3], 'aircraftMark');
  assert.equal(upgraded?.mapping[4], 'departure');
  assert.equal(upgraded?.mapping[5], 'arrival');
  assert.equal(upgraded?.mapping[6], 'exercise');
});

test('Sortie Ref column takes priority over generic Sortie and backfills accurately', () => {
  const csv = `Date,Sortie,Aircraft,Aircraft Mark,From,To,Instructor,Sortie Ref,Exercise,Type,Time
14-Nov-26,1,A-JET,NAF 455,DNKA,DNAA,ZINGZHI,AJ-216,ARMED RECCE,DUAL,1:20
19-Dec-24,2,L-39ZA,NAF 357,DNKN,DNKN,RAJI,L39-017,FORMATION,DUAL,1:10`;
  const rows = parseDelimitedText(csv);
  const headers = rows[0];
  const mapping = autoDetectColumnMapping(headers);

  // Sortie Ref (index 7) MUST win 'sortie', even though generic 'Sortie' appears earlier at index 1
  assert.equal(mapping[7], 'sortie');
  assert.equal(mapping[1], 'custom');
  assert.equal(mapping[8], 'exercise');

  const res = mapRowsToFlights(headers, rows.slice(1), mapping, 'google_sheets');
  assert.equal(res.flights[0].sortie, 'AJ-216');
  assert.equal(res.flights[1].sortie, 'L39-017');

  // Backfill prefers 'Sortie Ref' in customFields even if sortie previously held another value
  const legacyWithRef = {
    ...PILOT_AJI_RECENT_FLIGHTS[0],
    sortie: '1',
    customFields: { 'Sortie Ref': 'AJ-216', Notes: 'keep' },
  };
  const backfilled = backfillMarksFromCustomFields([legacyWithRef]);
  assert.equal(backfilled.updatedCount, 1);
  assert.equal(backfilled.flights[0].sortie, 'AJ-216');
  assert.equal(backfilled.flights[0].customFields?.['Sortie Ref'], undefined);
  assert.equal(backfilled.flights[0].customFields?.Notes, 'keep');

  // Saved connected sheet config upgrades 'sortie' from generic Sortie to 'Sortie Ref'
  const upgraded = upgradeConnectedSheetMapping({
    spreadsheetId: 'sheet-ref',
    spreadsheetTitle: 'Pilot Logbook',
    sheetName: 'Flights',
    headers: ['Date', 'Sortie', 'Aircraft', 'Sortie Ref', 'Exercise', 'Time'],
    mapping: {
      0: 'date',
      1: 'sortie',
      2: 'aircraftType',
      3: 'custom',
      4: 'exercise',
      5: 'totalTime',
    },
    lastSyncedAt: '2026-11-23T00:00:00Z',
    rowCount: 10,
    appSheetDetected: true,
  });
  assert.equal(upgraded?.mapping[3], 'sortie');
  assert.equal(upgraded?.mapping[1], 'custom');
});

test('autoDetectColumnMapping recognizes real-world Mark, From, To, and Sortie header variants without collisions', () => {
  const variantHeaders = [
    '#',
    'Date:',
    'Aircraft',
    'Mk.',
    'From (ICAO)',
    'To (ICAO)',
    'Instructor',
    'Sortie #',
    'Exercise',
    'Type',
    'T/O',
    'Landings',
    'Time',
    'Remarks',
  ];
  const mapping = autoDetectColumnMapping(variantHeaders);
  assert.equal(mapping[0], 'ignore');
  assert.equal(mapping[1], 'date');
  assert.equal(mapping[2], 'aircraftType');
  assert.equal(mapping[3], 'aircraftMark');
  assert.equal(mapping[4], 'departure');
  assert.equal(mapping[5], 'arrival');
  assert.equal(mapping[6], 'instructor');
  assert.equal(mapping[7], 'sortie');
  assert.equal(mapping[8], 'exercise');
  assert.equal(mapping[9], 'flightType');
  assert.equal(mapping[10], 'takeoffs');
  assert.equal(mapping[11], 'landings');
  assert.equal(mapping[12], 'totalTime');
  assert.equal(mapping[13], 'remarks');

  const altHeaders = [
    'Date',
    'Aircraft',
    'Aircraft #',
    'Place From',
    'To Base',
    'Flight Number',
    'Exercise',
    'Time',
  ];
  const altMap = autoDetectColumnMapping(altHeaders);
  assert.equal(altMap[2], 'aircraftMark');
  assert.equal(altMap[3], 'departure');
  assert.equal(altMap[4], 'arrival');
  assert.equal(altMap[5], 'sortie');
});

test('combined Route / From-To columns split cleanly into From and To', () => {
  assert.deepEqual(splitCombinedRoute('DNKA - DNAA'), { departure: 'DNKA', arrival: 'DNAA' });
  assert.deepEqual(splitCombinedRoute('dnkn/dnka'), { departure: 'DNKN', arrival: 'DNKA' });
  assert.deepEqual(splitCombinedRoute('DNKA -> DNAA'), { departure: 'DNKA', arrival: 'DNAA' });
  assert.deepEqual(splitCombinedRoute('DNKA-DNAA'), { departure: 'DNKA', arrival: 'DNAA' });

  const csv = `Date,Aircraft,A/C No.,From/To,Sorties,Instructor,Exercise,Type,Time
14-Nov-26,A-JET,NAF 455,DNKA - DNAA,SR-216,ZINGZHI,ARMED RECCE,DUAL,1:20`;
  const rows = parseDelimitedText(csv);
  const extracted = extractHeadersAndDataRows(rows);
  const mapping = autoDetectColumnMapping(extracted.headers, extracted.dataRows);
  assert.equal(mapping[2], 'aircraftMark');
  assert.equal(mapping[4], 'sortie');

  const res = mapRowsToFlights(extracted.headers, extracted.dataRows, mapping, 'google_sheets');
  assert.equal(res.flights.length, 1);
  assert.equal(res.flights[0].aircraftMark, 'NAF 455');
  assert.equal(res.flights[0].departure, 'DNKA');
  assert.equal(res.flights[0].arrival, 'DNAA');
  assert.equal(res.flights[0].sortie, 'SR-216');
});

test('extractHeadersAndDataRows merges 2-row grouped headers for Mark, From, To, and Sortie', () => {
  const sheet = [
    ['Date', 'Aircraft', '', 'Route', '', 'Instructor', 'Sortie', 'Exercise', 'Type', 'Time'],
    ['', 'Type', 'Mark', 'From', 'To', '', '', '', '', ''],
    ['14-Nov-26', 'A-JET', 'NAF 455', 'DNKA', 'DNAA', 'ZINGZHI', '216', 'ARMED RECCE', 'DUAL', '1:20'],
  ];
  const extracted = extractHeadersAndDataRows(sheet);
  assert.equal(extracted.startingSheetRow, 3);
  assert.equal(extracted.dataRows.length, 1);

  const mapping = autoDetectColumnMapping(extracted.headers, extracted.dataRows);
  const res = mapRowsToFlights(
    extracted.headers,
    extracted.dataRows,
    mapping,
    'google_sheets',
    extracted.startingSheetRow
  );
  assert.equal(res.flights.length, 1);
  assert.equal(res.flights[0].aircraftType, 'A-JET');
  assert.equal(res.flights[0].aircraftMark, 'NAF 455');
  assert.equal(res.flights[0].departure, 'DNKA');
  assert.equal(res.flights[0].arrival, 'DNAA');
  assert.equal(res.flights[0].sortie, '216');
});

test('data-aware mapping prefers populated Sortie / Mark column when higher-priority header is empty', () => {
  const headers = ['Date', 'Sortie', 'Aircraft', 'Mark', 'Tail No', 'Sortie Ref', 'From', 'To', 'Time'];
  const dataRows = [
    ['14-Nov-26', 'S-216', 'A-JET', '', 'NAF 455', '', 'DNKA', 'DNAA', '1:20'],
    ['04-Nov-26', 'S-214', 'A-JET', '', 'NAF 457', '', 'DNAA', 'DNKA', '1:35'],
  ];

  const mapping = autoDetectColumnMapping(headers, dataRows);
  assert.equal(mapping[1], 'sortie');
  assert.equal(mapping[4], 'aircraftMark');
  assert.equal(mapping[6], 'departure');
  assert.equal(mapping[7], 'arrival');

  const res = mapRowsToFlights(headers, dataRows, mapping, 'google_sheets');
  assert.equal(res.flights[0].sortie, 'S-216');
  assert.equal(res.flights[0].aircraftMark, 'NAF 455');
  assert.equal(res.flights[0].departure, 'DNKA');
  assert.equal(res.flights[0].arrival, 'DNAA');
});

test('backfillMarksFromCustomFields promotes variant Mark, Route, and Sortie keys from legacy flights', () => {
  const legacy = {
    ...PILOT_AJI_RECENT_FLIGHTS[0],
    aircraftMark: '',
    customFields: {
      'Mk.': 'NAF 455',
      Route: 'dnka -> dnaa',
      'Flight #': 'FLT-216',
      Extra: 'keep-me',
    },
  };
  const backfilled = backfillMarksFromCustomFields([legacy]);
  assert.equal(backfilled.updatedCount, 1);
  assert.equal(backfilled.flights[0].aircraftMark, 'NAF 455');
  assert.equal(backfilled.flights[0].departure, 'DNKA');
  assert.equal(backfilled.flights[0].arrival, 'DNAA');
  assert.equal(backfilled.flights[0].sortie, 'FLT-216');
  assert.equal(backfilled.flights[0].customFields?.Extra, 'keep-me');
});

test('never displays literal "Sortie" placeholder and always maps real sortie names from "Sortie Ref" across all rows', () => {
  const headers = [
    'Date',
    'Aircraft',
    'Mark',
    'From',
    'To',
    'Instructor',
    'Sortie',
    'Sortie Ref',
    'Exercise',
    'Type',
    'Time',
  ];

  // Simulate 260 rows where early rows have literal 'Sortie' in "Sortie" and blank "Sortie Ref",
  // while rows past index 250 have populated "Sortie Ref" values.
  const dataRows: string[][] = [];
  for (let i = 0; i < 255; i++) {
    dataRows.push([
      '10-Dec-24',
      'L-39ZA',
      'NAF 357',
      'DNKN',
      'DNKN',
      'OBIAHU',
      'Sortie',
      '',
      'FORMATION',
      'DUAL',
      '1:10',
    ]);
  }
  dataRows.push([
    '14-Nov-26',
    'A-JET',
    'NAF 455',
    'DNKA',
    'DNKA',
    'ZINGZHI',
    'Sortie',
    'A/G HOT 1',
    'ARMED RECCE',
    'DUAL',
    '1:20',
  ]);
  dataRows.push([
    '04-Nov-26',
    'A-JET',
    'NAF 455',
    'DNKA',
    'DNAA',
    'USMAN',
    'Sortie',
    'Sortie 214',
    'NAVIGATION/ARMED RECCE',
    'DUAL',
    '1:35',
  ]);

  const mapping = autoDetectColumnMapping(headers, dataRows);
  // Sortie Ref (index 7) must remain mapped even when populated only after row 250
  assert.equal(mapping[7], 'sortie');
  assert.equal(mapping[6], 'custom');

  const res = mapRowsToFlights(headers, dataRows, mapping, 'google_sheets');
  assert.equal(res.flights.length, 257);
  // Rows with blank "Sortie Ref" and literal "Sortie" in "Sortie" must NOT get sortie = 'Sortie'
  assert.equal(res.flights[0].sortie, undefined);
  // Rows with populated "Sortie Ref" get the exact sortie name (including legitimate names like "Sortie 214")
  assert.equal(res.flights[255].sortie, 'A/G HOT 1');
  assert.equal(res.flights[256].sortie, 'Sortie 214');

  // Even if an old mapping mapped "Sortie" -> 'sortie' and "Sortie Ref" -> 'custom', mapRowsToFlights still picks "Sortie Ref"
  const staleMapping = { ...mapping, 6: 'sortie' as const, 7: 'custom' as const };
  const resStale = mapRowsToFlights(headers, dataRows.slice(254), staleMapping, 'google_sheets');
  assert.equal(resStale.flights[0].sortie, undefined);
  assert.equal(resStale.flights[1].sortie, 'A/G HOT 1');
  assert.equal(resStale.flights[2].sortie, 'Sortie 214');

  // Backfill replaces stored literal 'Sortie' with 'Sortie Ref' from customFields, or clears it when no Sortie Ref exists
  const storedWithRef = {
    ...PILOT_AJI_RECENT_FLIGHTS[0],
    sortie: 'Sortie',
    customFields: { 'Sortie Ref': 'CAS HOT 2' },
  };
  const storedPlaceholderOnly = {
    ...PILOT_AJI_RECENT_FLIGHTS[1],
    sortie: 'Sortie',
    customFields: undefined,
  };
  const backfilled = backfillMarksFromCustomFields([storedWithRef, storedPlaceholderOnly]);
  assert.equal(backfilled.updatedCount, 2);
  assert.equal(backfilled.flights[0].sortie, 'CAS HOT 2');
  assert.equal(backfilled.flights[1].sortie, undefined);
});

test('Flight ID and AppSheet record ID columns never map or backfill into flight.sortie', () => {
  const headers = [
    'Flight ID',
    'Date',
    'Aircraft',
    'Mark',
    'From',
    'To',
    'Instructor',
    'Sortie',
    'Sortie Ref',
    'Exercise',
    'Type',
    'Time',
  ];
  const dataRows = [
    ['FLT-001', '14-Nov-26', 'A-JET', 'NAF 455', 'DNKA', 'DNKA', 'ZINGZHI', 'Sortie', 'A/G HOT 1', 'ARMED RECCE', 'DUAL', '1:20'],
    ['FLT-002', '04-Nov-26', 'A-JET', 'NAF 455', 'DNKA', 'DNAA', 'USMAN', 'Sortie', '', 'NAVIGATION', 'DUAL', '1:35'],
    ['a3f9c2b1', '19-Dec-24', 'L-39ZA', 'NAF 357', 'DNKN', 'DNKN', 'RAJI', 'FORM-04', '', 'FORMATION', 'DUAL', '1:10'],
  ];

  const mapping = autoDetectColumnMapping(headers, dataRows);
  assert.equal(mapping[0], 'ignore');
  assert.equal(mapping[8], 'sortie');
  assert.equal(mapping[7], 'custom');

  const res = mapRowsToFlights(headers, dataRows, mapping, 'google_sheets');
  assert.equal(res.flights[0].sortie, 'A/G HOT 1');
  // Blank Sortie Ref + literal 'Sortie' must NOT fall back to Flight ID ('FLT-002')
  assert.equal(res.flights[1].sortie, undefined);
  // Blank Sortie Ref + real Sortie name ('FORM-04') uses 'FORM-04', never 'a3f9c2b1'
  assert.equal(res.flights[2].sortie, 'FORM-04');

  // Even when a spreadsheet has Flight ID before Sortie (and no Sortie Ref), Flight ID must be ignored
  const noRefHeaders = ['Flight_ID', 'Date', 'Aircraft', 'Sortie', 'Exercise', 'Time'];
  const noRefMapping = autoDetectColumnMapping(noRefHeaders);
  assert.equal(noRefMapping[0], 'ignore');
  assert.equal(noRefMapping[3], 'sortie');

  // Backfill on existing Firestore flights never promotes customFields['Flight ID'] when Sortie is cleared
  const storedWithFlightId = {
    ...PILOT_AJI_RECENT_FLIGHTS[0],
    sortie: 'Sortie',
    customFields: { 'Flight ID': 'FLT-216', Notes: 'keep' },
  };
  const storedLeakedFlightId = {
    ...PILOT_AJI_RECENT_FLIGHTS[1],
    sortie: 'FLT-215',
    customFields: { 'Flight ID': 'FLT-215', 'Sortie Ref': 'NAV 3' },
  };
  const storedUniqueId = {
    ...PILOT_AJI_RECENT_FLIGHTS[2],
    sortie: '8c4d9e2a',
    customFields: undefined,
  };
  const backfilled = backfillMarksFromCustomFields([
    storedWithFlightId,
    storedLeakedFlightId,
    storedUniqueId,
  ]);
  assert.equal(backfilled.updatedCount, 3);
  assert.equal(backfilled.flights[0].sortie, undefined);
  assert.equal(backfilled.flights[1].sortie, 'NAV 3');
  assert.equal(backfilled.flights[2].sortie, undefined);

  // Saved connected sheet config unmaps Flight ID from 'sortie' and binds 'Sortie Ref'
  const upgraded = upgradeConnectedSheetMapping({
    spreadsheetId: 'sheet-fid',
    spreadsheetTitle: 'Pilot Logbook',
    sheetName: 'Flights',
    headers: ['Flight ID', 'Date', 'Aircraft', 'Sortie Ref', 'Exercise', 'Time'],
    mapping: {
      0: 'sortie',
      1: 'date',
      2: 'aircraftType',
      3: 'custom',
      4: 'exercise',
      5: 'totalTime',
    },
    lastSyncedAt: '2026-11-23T00:00:00Z',
    rowCount: 10,
    appSheetDetected: true,
  });
  assert.equal(upgraded?.mapping[0], 'ignore');
  assert.equal(upgraded?.mapping[3], 'sortie');
});



