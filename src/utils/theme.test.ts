import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeThemeMode, toggleThemeMode } from './theme';

test('sanitizeThemeMode normalizes valid values and safely falls back to light', () => {
  assert.equal(sanitizeThemeMode('dark'), 'dark');
  assert.equal(sanitizeThemeMode('light'), 'light');
  assert.equal(sanitizeThemeMode(undefined), 'light');
  assert.equal(sanitizeThemeMode(null), 'light');
  assert.equal(sanitizeThemeMode(''), 'light');
  assert.equal(sanitizeThemeMode('system'), 'light');
  assert.equal(sanitizeThemeMode('DARK'), 'light');
  assert.equal(sanitizeThemeMode(123), 'light');
});

test('toggleThemeMode switches cleanly between light and dark', () => {
  assert.equal(toggleThemeMode('light'), 'dark');
  assert.equal(toggleThemeMode('dark'), 'light');
  assert.equal(toggleThemeMode(toggleThemeMode('light')), 'light');
});
