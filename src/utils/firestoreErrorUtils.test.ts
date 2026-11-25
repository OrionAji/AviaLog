import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFirestoreErrorForDisplay } from './firestoreErrorUtils.ts';

test('parseFirestoreErrorForDisplay classifies permission errors from structured JSON', () => {
  const err = new Error(
    JSON.stringify({
      error: 'Missing or insufficient permissions.',
      operationType: 'get',
      path: 'users/uid123',
    })
  );
  const res = parseFirestoreErrorForDisplay(err);
  assert.equal(res.category, 'permission');
  assert.match(res.message, /security rules/i);
  assert.equal(res.details, 'get on users/uid123: Missing or insufficient permissions.');
});

test('parseFirestoreErrorForDisplay builds upgrade URL for free daily read quota errors', () => {
  const err = new Error(
    JSON.stringify({
      error:
        "Quota exceeded for quota metric 'Free daily read units per project (free tier database)'",
      operationType: 'list',
      path: 'users/uid123/flights',
    })
  );
  const res = parseFirestoreErrorForDisplay(err, 'Fallback', {
    projectId: 'aerolog-d507d',
    databaseId: 'ai-studio-avialog-test',
  });
  assert.equal(res.category, 'quota_free_read');
  assert.equal(
    res.upgradeUrl,
    'https://console.firebase.google.com/project/aerolog-d507d/firestore/databases/ai-studio-avialog-test/data?openUpgradeDialog=true'
  );
});

test('parseFirestoreErrorForDisplay classifies offline / network errors', () => {
  const err = new Error('Failed to get document because the client is offline.');
  const res = parseFirestoreErrorForDisplay(err);
  assert.equal(res.category, 'offline');
  assert.match(res.message, /cloud logbook database/i);
});

test('parseFirestoreErrorForDisplay falls back cleanly for unknown errors', () => {
  const res = parseFirestoreErrorForDisplay(new Error('Unexpected crash'), 'Custom fallback');
  assert.equal(res.category, 'unknown');
  assert.equal(res.message, 'Custom fallback');
  assert.equal(res.details, 'Unexpected crash');
});
