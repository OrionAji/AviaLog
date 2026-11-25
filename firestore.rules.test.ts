import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const blueprintPath = path.resolve(process.cwd(), 'firebase-blueprint.json');

test('firestore.rules enforces Eight Pillars and strict per-user privacy invariants', () => {
  assert.ok(fs.existsSync(rulesPath), 'firestore.rules must exist');
  const rules = fs.readFileSync(rulesPath, 'utf8');

  // Pillar: Default deny catch-all
  assert.match(rules, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/);

  // Pillar: Verified owner identity gate (no unauthenticated or unverified access)
  assert.match(rules, /request\.auth != null/);
  assert.match(rules, /request\.auth\.token\.email_verified == true/);
  assert.match(rules, /request\.auth\.uid == userId/);

  // Pillar: PII isolation — user listing is strictly forbidden
  assert.match(rules, /match \/users\/\{userId\}[\s\S]*?allow list: if false;/);

  // Pillar 1: Master Gate get() check on subcollections
  assert.match(
    rules,
    /get\(\/databases\/\$\(database\)\/documents\/users\/\$\(userId\)\)\.data\.uid == request\.auth\.uid/
  );

  // Pillar 2: Standalone validation blueprints called on BOTH create and update
  assert.match(rules, /function isValidUserProfile\(data, userId\)/);
  assert.match(rules, /function isValidFlight\(data, flightId\)/);
  assert.match(rules, /function isValidAircraft\(data\)/);
  assert.ok((rules.match(/isValidUserProfile\(incoming\(\), userId\)/g) ?? []).length >= 2);
  assert.ok((rules.match(/isValidFlight\(incoming\(\), flightId\)/g) ?? []).length >= 2);
  assert.ok((rules.match(/isValidAircraft\(incoming\(\)\)/g) ?? []).length >= 2);

  // Pillar 3: Path variable ID poisoning guard
  assert.match(rules, /function isValidId\(id\)/);
  assert.match(rules, /id\.matches\('\^\[a-zA-Z0-9_\\\\-\]\+\$'\)/);

  // Pillar 4 & Anti-update-gap: strict affectedKeys() allowlists and immutable fields
  assert.match(rules, /incoming\(\)\.diff\(existing\(\)\)\.affectedKeys\(\)\.hasOnly/);
  assert.match(rules, /incoming\(\)\.ownerId == existing\(\)\.ownerId/);
  assert.match(rules, /incoming\(\)\.createdAt == existing\(\)\.createdAt/);
  assert.match(rules, /incoming\(\)\.updatedAt == request\.time/);

  // Pillar 5: Bounded array guard for aircraft marks
  assert.match(rules, /data\.marks is list/);
  assert.match(rules, /data\.marks\.size\(\) <= 50/);
  assert.match(rules, /data\.marks\[0\] is string/);

  // Pillar 8: Secure list queries enforce existing().ownerId == request.auth.uid
  const listMatches = rules.match(/allow list: if isVerifiedOwner\(userId\)[\s\S]*?existing\(\)\.ownerId == request\.auth\.uid;/g) ?? [];
  assert.equal(listMatches.length, 2, 'Both flights and aircraft subcollections must enforce ownerId on list');

  // Existence checks on new documents must safely handle resource == null for the verified owner
  assert.match(rules, /\(resource == null \|\| existing\(\)\.uid == request\.auth\.uid\)/);
  const subGetNullGuards = rules.match(/\(resource == null \|\| existing\(\)\.ownerId == request\.auth\.uid\)/g) ?? [];
  assert.equal(subGetNullGuards.length, 2, 'Both flights and aircraft allow get must guard resource == null');
});

test('firebase-blueprint.json aligns with firestore.rules collections and entities', () => {
  assert.ok(fs.existsSync(blueprintPath), 'firebase-blueprint.json must exist');
  const bp = JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));

  assert.ok(bp.entities.UserProfile);
  assert.deepEqual(bp.entities.UserProfile.properties.theme?.enum, ['light', 'dark']);
  assert.ok(bp.entities.Flight);
  assert.ok(bp.entities.Flight.properties.sortie);
  assert.ok(bp.entities.Flight.properties.departure);
  assert.ok(bp.entities.Flight.properties.arrival);
  assert.ok(bp.entities.Aircraft);

  assert.ok(bp.firestore['/users/{userId}']);
  assert.ok(bp.firestore['/users/{userId}/flights/{flightId}']);
  assert.ok(bp.firestore['/users/{userId}/aircraft/{aircraftId}']);

  const rules = fs.readFileSync(rulesPath, 'utf8');
  assert.match(rules, /function isValidTheme\(val\)/);
  assert.match(rules, /\(!\('theme' in data\) \|\| isValidTheme\(data\.theme\)\)/);
  assert.match(rules, /isOptionalString\(data, 'sortie', 64\)/);
  assert.match(rules, /isOptionalString\(data, 'departure', 32\)/);
  assert.match(rules, /isOptionalString\(data, 'arrival', 32\)/);
});
