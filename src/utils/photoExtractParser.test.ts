import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExtractedPhotoFlights } from './photoExtractParser';
import { formatHHMM } from './flightMath';

test('normalizeExtractedPhotoFlights parses handwritten/printed logbook rows accurately', () => {
  const results = normalizeExtractedPhotoFlights(
    [
      {
        date: '18-Nov-26',
        aircraftType: 'a-jet',
        aircraftMark: 'naf 455',
        instructor: 'zingzhi',
        exercise: 'armed recce',
        flightType: 'DUAL',
        sortie: 's-04',
        departure: 'dnka',
        arrival: 'dnaa',
        totalTime: '1:25',
        nightTime: '0:20',
        instrumentTime: '0:15',
        takeoffs: 1,
        landings: 2,
        approaches: 1,
        remarks: 'Low level tactical nav',
        confidence: 'high',
      },
      {
        date: '2026-11-19',
        aircraftType: 'DA-40 FSTD',
        aircraftMark: '',
        exercise: 'ILS APPROACHES',
        flightType: 'SIMULATOR',
        totalTime: '1:00',
        approaches: 3,
        confidence: 'medium',
      },
      {
        // Completely blank ghost row should be filtered out
        aircraftType: '',
        totalTime: '',
      },
    ],
    '2026-11-23'
  );

  assert.equal(results.length, 2);

  const first = results[0];
  assert.equal(first.confidence, 'high');
  assert.equal(first.selected, true);
  assert.equal(first.flight.source, 'photo_scan');
  assert.equal(first.flight.date, '2026-11-18');
  assert.equal(first.flight.aircraftType, 'A-JET');
  assert.equal(first.flight.aircraftMark, 'NAF 455');
  assert.equal(first.flight.sortie, 'S-04');
  assert.equal(first.flight.departure, 'DNKA');
  assert.equal(first.flight.arrival, 'DNAA');
  assert.equal(first.flight.engineCategory, 'JET ENGINE');
  assert.equal(formatHHMM(first.flight.totalMinutes), '1:25');
  assert.equal(formatHHMM(first.flight.dualMinutes), '1:25');
  assert.equal(first.flight.soloMinutes, 0);
  assert.equal(formatHHMM(first.flight.nightMinutes), '0:20');
  assert.equal(formatHHMM(first.flight.instrumentMinutes), '0:15');
  assert.equal(first.flight.takeoffs, 1);
  assert.equal(first.flight.landings, 2);
  assert.equal(first.flight.approaches, 1);

  const sim = results[1];
  assert.equal(sim.flight.engineCategory, 'SIMULATOR');
  assert.equal(sim.flight.flightType, 'SIMULATOR');
  assert.equal(formatHHMM(sim.flight.simulatorMinutes), '1:00');
  assert.equal(sim.flight.dualMinutes, 0);
  assert.equal(sim.flight.approaches, 3);
});
