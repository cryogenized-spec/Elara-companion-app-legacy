import assert from 'node:assert/strict';
import test from 'node:test';
import { LOCKBOX_MANIFEST, assertLockboxEntry } from '../../../config/lockbox';
import { createServerLockbox } from '../../../server/services/lockbox';

test('Lockbox identifies browser-safe and server-only entries correctly', () => {
  assert.equal(assertLockboxEntry('VITE_GOOGLE_CLIENT_ID', { exposures: ['browser'] }).classification, 'public');
  assert.equal(assertLockboxEntry('GEMINI_API_KEY', { exposures: ['server'] }).classification, 'secret');
  assert.equal(assertLockboxEntry('CLOUDFLARE_API_TOKEN', { exposures: ['ci'] }).classification, 'critical');
});

test('server Lockbox requires secrets and supports non-secret configuration', () => {
  const lockbox = createServerLockbox({ GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'gemini-test' });

  assert.equal(lockbox.requiredSecret('GEMINI_API_KEY'), 'test-key');
  assert.equal(lockbox.config('GEMINI_MODEL'), 'gemini-test');
  assert.equal(lockbox.config('APP_URL', 'http://localhost:3000'), 'http://localhost:3000');
  assert.equal(lockbox.optionalSecret('GEMINI_API_KEY'), 'test-key');
});

test('server Lockbox fails closed for missing required secrets', () => {
  const lockbox = createServerLockbox({});
  assert.throws(() => lockbox.requiredSecret('GEMINI_API_KEY'), /not configured/);
});

test('server Lockbox rejects non-server entries', () => {
  const lockbox = createServerLockbox({ VITE_GOOGLE_CLIENT_ID: 'public-id' });
  assert.throws(() => lockbox.optionalSecret('VITE_GOOGLE_CLIENT_ID'), /exposure mismatch/);
});

test('Lockbox manifest contains only registered keys', () => {
  assert.ok(LOCKBOX_MANIFEST.length >= 10);
  assert.equal(new Set(LOCKBOX_MANIFEST.map((entry) => entry.key)).size, LOCKBOX_MANIFEST.length);
});
