import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateLockboxStatus, summarizeLockboxStatus } from '../../../config/lockbox-status';

const entries = [
  { key: 'SECRET_A', namespace: 'app', classification: 'secret', requiredBy: ['server'] as const, exposures: ['server'] as const },
  { key: 'CONFIG_B', namespace: 'app', classification: 'config', requiredBy: ['server'] as const, exposures: ['server'] as const },
] as const;

test('Lockbox status reports only presence, never values', () => {
  const rows = evaluateLockboxStatus(entries, { SECRET_A: 'super-secret', CONFIG_B: '' }, ['server']);
  assert.equal(rows[0]?.status, 'configured');
  assert.equal(rows[1]?.status, 'missing');
  assert.equal(JSON.stringify(rows).includes('super-secret'), false);
  assert.deepEqual(summarizeLockboxStatus(rows), { total: 2, configured: 1, missing: 1 });
});
