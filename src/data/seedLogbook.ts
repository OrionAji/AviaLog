import type {
  AircraftRecord,
  BroughtForwardBaseline,
  FlightEntry,
} from '../types/logbook';

/**
 * Pilot AJI's 10 real recent flights directly from the attached Pilot_Logbook_AppSheet sheet
 * (rows 42–51: 07-Oct-24 through 14-Nov-26).
 */
export const PILOT_AJI_RECENT_FLIGHTS: FlightEntry[] = [
  {
    id: 'aji-216',
    date: '2026-11-14',
    aircraftType: 'A-JET',
    aircraftMark: '',
    engineCategory: 'JET ENGINE',
    instructor: 'ZINGZHI',
    exercise: 'ARMED RECCE',
    flightType: 'DUAL',
    totalMinutes: 80, // 1:20
    dualMinutes: 80,
    soloMinutes: 0,
    nightMinutes: 0,
    instrumentMinutes: 0,
    simulatorMinutes: 0,
    takeoffs: 1,
    landings: 1,
    approaches: 0,
    remarks: '',
    source: 'imported_sheet',
    sheetRowNumber: 217,
  },
  {
    id: 'aji-215',
    date: '2026-11-14',
    aircraftType: 'A-JET',
    aircraftMark: '',
    engineCategory: 'JET ENGINE',
    instructor: 'ZINGZHI',
    exercise: 'ARMED RECCE',
    flightType: 'DUAL',
    totalMinutes: 80, // 1:20
    dualMinutes: 80,
    soloMinutes: 0,
    nightMinutes: 0,
    instrumentMinutes: 0,
    simulatorMinutes: 0,
    takeoffs: 1,
    landings: 1,
    approaches: 0,
    remarks: '',
    source: 'imported_sheet',
    sheetRowNumber: 216,
  },
  {
    id: 'aji-214',
    date: '2026-11-04',
    aircraftType: 'A-JET',
    aircraftMark: '',
    engineCategory: 'JET ENGINE',
    instructor: 'USMAN',
    exercise: 'NAVIGATION/ARMED RECCE',
    flightType: 'DUAL',
    totalMinutes: 95, // 1:35
    dualMinutes: 95,
    soloMinutes: 0,
    nightMinutes: 0,
    instrumentMinutes: 0,
    simulatorMinutes: 0,
    takeoffs: 1,
    landings: 1,
    approaches: 0,
    remarks: '',
    source: 'imported_sheet',
    sheetRowNumber: 215,
  },
  {
    id: 'aji-213',
    date: '2026-09-09',
    aircraftType: 'A-JET',
    aircraftMark: '',
    engineCategory: 'JET ENGINE',
    instructor: 'ZINGZHI',
    exercise: 'ARMED RECCE',
    flightType: 'DUAL',
    totalMinutes: 65, // 1:05
    dualMinutes: 65,
    soloMinutes: 0,
    nightMinutes: 0,
    instrumentMinutes: 0,
    simulatorMinutes: 0,
    takeoffs: 1,
    landings: 1,
    approaches: 0,
    remarks: '',
    source: 'imported_sheet',
    sheetRowNumber: 214,
  },
  {
    id: 'aji-212',
    date: '2025-02-22',
    aircraftType: 'A-JET',
    aircraftMark: '',
    engineCategory: 'JET ENGINE',
    instructor: 'OGUNEWU',
    exercise: 'NAVIGATION',
    flightType: 'DUAL',
    totalMinutes: 60, // 1:00
    dualMinutes: 60,
    soloMinutes: 0,
    nightMinutes: 0,
    instrumentMinutes: 0,
    simulatorMinutes: 0,
    takeoffs: 1,
    landings: 1,
    approaches: 0,
    remarks: '',
    source: 'imported_sheet',
    sheetRowNumber: 213,
  },
  {
    id: 'aji-211',
    date: '2024-12-19',
    aircraftType: 'L-39ZA',
    aircraftMark: '',
    engineCategory: 'JET ENGINE',
    instructor: 'RAJI',
    exercise: 'FORMATION',
    flightType: 'DUAL',
    totalMinutes: 70, // 1:10
    dualMinutes: 70,
    soloMinutes: 0,
    nightMinutes: 0,
    instrumentMinutes: 0,
    simulatorMinutes: 0,
    takeoffs: 1,
    landings: 1,
    approaches: 0,
    remarks: '',
    source: 'imported_sheet',
    sheetRowNumber: 212,
  },
  {
    id: 'aji-210',
    date: '2024-12-17',
    aircraftType: 'L-39ZA',
    aircraftMark: '',
    engineCategory: 'JET ENGINE',
    instructor: 'OBIAHU',
    exercise: 'FORMATION',
    flightType: 'DUAL',
    totalMinutes: 75, // 1:15
    dualMinutes: 75,
    soloMinutes: 0,
    nightMinutes: 0,
    instrumentMinutes: 0,
    simulatorMinutes: 0,
    takeoffs: 1,
    landings: 1,
    approaches: 0,
    remarks: '',
    source: 'imported_sheet',
    sheetRowNumber: 211,
  },
  {
    id: 'aji-209',
    date: '2024-12-11',
    aircraftType: 'L-39ZA',
    aircraftMark: '',
    engineCategory: 'JET ENGINE',
    instructor: 'ONALAJA',
    exercise: 'FORMATION',
    flightType: 'DUAL',
    totalMinutes: 80, // 1:20
    dualMinutes: 80,
    soloMinutes: 0,
    nightMinutes: 0,
    instrumentMinutes: 0,
    simulatorMinutes: 0,
    takeoffs: 1,
    landings: 1,
    approaches: 0,
    remarks: '',
    source: 'imported_sheet',
    sheetRowNumber: 210,
  },
  {
    id: 'aji-208',
    date: '2024-12-10',
    aircraftType: 'L-39ZA',
    aircraftMark: '',
    engineCategory: 'JET ENGINE',
    instructor: 'OBIAHU',
    exercise: 'FORMATION',
    flightType: 'DUAL',
    totalMinutes: 75, // 1:15
    dualMinutes: 75,
    soloMinutes: 0,
    nightMinutes: 0,
    instrumentMinutes: 0,
    simulatorMinutes: 0,
    takeoffs: 1,
    landings: 1,
    approaches: 0,
    remarks: '',
    source: 'imported_sheet',
    sheetRowNumber: 209,
  },
  {
    id: 'aji-207',
    date: '2024-10-07',
    aircraftType: 'L-39ZA',
    aircraftMark: '',
    engineCategory: 'JET ENGINE',
    instructor: 'OBIAHU',
    exercise: 'NAV',
    flightType: 'DUAL',
    totalMinutes: 55, // 0:55
    dualMinutes: 55,
    soloMinutes: 0,
    nightMinutes: 0,
    instrumentMinutes: 0,
    simulatorMinutes: 0,
    takeoffs: 1,
    landings: 1,
    approaches: 0,
    remarks: '',
    source: 'imported_sheet',
    sheetRowNumber: 208,
  },
];

/**
 * Exact historical brought-forward figures from Pilot AJI's attached Dashboard sheet
 * (covering rows 1–206 from 09 Nov 2020 to early Oct 2024 so that Baseline + 10 Recent Flights
 * equals every single sheet figure to the exact minute).
 */
export const PILOT_AJI_BASELINE: BroughtForwardBaseline = {
  pilotName: 'AJI',
  firstFlightDate: '2020-11-09',
  label: 'Brought forward from Pilot_Logbook_AppSheet (206 prior entries, 09 Nov 2020 – Oct 2024)',
  flights: 203, // 213 total - 10 recent
  takeoffs: 203, // 213 total - 10 recent
  landings: 505, // 515 total - 10 recent
  totalMinutes: 12685, // 223:40 (13420m) - 12:15 (735m) = 211:25
  dualMinutes: 11035, // 196:10 (11770m) - 12:15 (735m) = 183:55
  soloMinutes: 1650, // 27:30
  jetMinutes: 8325, // 151:00 (9060m) - 12:15 (735m) = 138:45
  nightMinutes: 490, // 8:10
  instrumentMinutes: 1205, // 20:05
  approaches: 44,
  simulatorMinutes: 180, // 3:00
  simulatorFlights: 3,
  simulatorTakeoffs: 3,
  simulatorLandings: 3,
  byAircraft: [
    {
      aircraftType: 'SMK',
      engineCategory: 'SINGLE ENGINE',
      flights: 67,
      takeoffs: 67,
      landings: 246,
      totalMinutes: 4205, // 70:05
    },
    {
      aircraftType: 'DA-40',
      engineCategory: 'SINGLE ENGINE',
      flights: 3,
      takeoffs: 3,
      landings: 4,
      totalMinutes: 155, // 2:35
    },
    {
      aircraftType: 'DA-40 FSTD',
      engineCategory: 'SIMULATOR',
      flights: 3,
      takeoffs: 3,
      landings: 3,
      totalMinutes: 180, // 3:00
    },
    {
      aircraftType: 'K8-E',
      engineCategory: 'JET ENGINE',
      flights: 121,
      takeoffs: 121,
      landings: 232,
      totalMinutes: 7470, // 124:30
    },
    {
      // 17 total L-39ZA flights (28 landings, 20:10 = 1210m) minus 5 recent (5 landings, 5:55 = 355m)
      aircraftType: 'L-39ZA',
      engineCategory: 'JET ENGINE',
      flights: 12,
      takeoffs: 12,
      landings: 23,
      totalMinutes: 855, // 14:15
    },
  ],
  byYear: [
    { year: 2020, flights: 27, landings: 133, dualMinutes: 1465, soloMinutes: 130 }, // 24:25 + 2:10
    { year: 2021, flights: 43, landings: 117, dualMinutes: 2390, soloMinutes: 375 }, // 39:50 + 6:15
    { year: 2022, flights: 7, landings: 28, dualMinutes: 470, soloMinutes: 0 }, // 7:50
    { year: 2023, flights: 114, landings: 204, dualMinutes: 5855, soloMinutes: 1145 }, // 97:35 + 19:05
    // 2024: 17 total flights (28 landings, 20:10 = 1210m) minus 5 recent (5 landings, 5:55 = 355m)
    { year: 2024, flights: 12, landings: 23, dualMinutes: 855, soloMinutes: 0 },
  ],
};

export const PILOT_AJI_AIRCRAFT: AircraftRecord[] = [
  {
    type: 'SMK',
    fullName: 'PAC MFI-17 Super Mushshak',
    engineCategory: 'SINGLE ENGINE',
    role: 'Primary Trainer',
    notes: 'Ab-initio primary flight training.',
    source: 'imported_sheet',
  },
  {
    type: 'DA-40',
    fullName: 'Diamond DA40 Diamond Star',
    engineCategory: 'SINGLE ENGINE',
    role: 'Basic / Instrument Trainer',
    notes: 'Glass cockpit single-engine piston.',
    source: 'imported_sheet',
  },
  {
    type: 'DA-40 FSTD',
    fullName: 'Diamond DA40 Flight Simulation Training Device',
    engineCategory: 'SIMULATOR',
    role: 'Instrument Procedure Simulator',
    notes: 'Logged under Simulator hours (excluded from live flight hours).',
    source: 'imported_sheet',
  },
  {
    type: 'K8-E',
    fullName: 'Hongdu K-8E Karakorum',
    engineCategory: 'JET ENGINE',
    role: 'Intermediate Jet Trainer',
    notes: 'Jet transition, aerobatics, formation, instrument & night.',
    source: 'imported_sheet',
  },
  {
    type: 'L-39ZA',
    fullName: 'Aero L-39ZA Albatros',
    engineCategory: 'JET ENGINE',
    role: 'Advanced Jet / Weapons Trainer',
    notes: 'Tactical navigation and formation sorties.',
    source: 'imported_sheet',
  },
  {
    type: 'A-JET',
    fullName: 'Dassault/Dornier Alpha Jet',
    engineCategory: 'JET ENGINE',
    role: 'Light Attack / Advanced Jet',
    notes: 'Armed reconnaissance and tactical navigation sorties.',
    source: 'imported_sheet',
  },
];

export const SAMPLE_FLIGHTS_TAB_CSV = `Date,Aircraft,Engine,Aircraft Mark,Instructor,Exercise,Type,Take-offs,Landings,Time,Night,Instrument,Inst. Approaches
14-Nov-26,A-JET,JET ENGINE,,ZINGZHI,ARMED RECCE,DUAL,1,1,1:20,0:00,0:00,0
04-Nov-26,A-JET,JET ENGINE,,USMAN,NAVIGATION/ARMED RECCE,DUAL,1,1,1:35,0:00,0:20,1
19-Dec-24,L-39ZA,JET ENGINE,,RAJI,FORMATION,DUAL,1,1,1:10,0:00,0:00,0
10-Dec-24,L-39ZA,JET ENGINE,,OBIAHU,FORMATION,DUAL,1,1,1:15,0:00,0:15,1`;

export const SAMPLE_APPSHEET_SCHEMA = `_RowNumber (Number)
Date (Date)
Aircraft (Ref -> Aircraft)
Engine (Text)
Aircraft Mark (Text)
Instructor (Text)
Exercise (Text)
Type (Enum - DUAL / SOLO / SIMULATOR)
Take-offs (Number)
Landings (Number)
Time (Duration - HH:MM)
Night (Duration)
Instrument (Duration)
Inst. Approaches (Number)`;
