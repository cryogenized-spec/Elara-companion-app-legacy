import assert from 'node:assert/strict';
import test from 'node:test';
import { getModelProfile } from '../modelRegistry';
import { buildRuntimeConfig } from '../chatRuntime';
import { normalizeModelName } from '../../../server/services/gemini';

test('Gemini 3.7 Flash uses only supported thinking levels', () => {
  const profile = getModelProfile('gemini-3.7-flash');
  assert.deepEqual(profile.thinkingLevels, ['low', 'medium', 'high']);
});

test('Gemini 3.7 Flash never sends unsupported minimal thinking level', () => {
  const config = buildRuntimeConfig({ model: 'gemini-3.7-flash', thinkingLevel: 'minimal' });
  assert.equal(config.thinkingConfig?.thinkingLevel, 'low');
});

test('Gemini 3.7 Flash preserves its real provider model id', () => {
  assert.equal(normalizeModelName('gemini-3.7-flash'), 'gemini-3.7-flash');
});
