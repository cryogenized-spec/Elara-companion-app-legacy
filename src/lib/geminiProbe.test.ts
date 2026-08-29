import test from 'node:test';
import assert from 'node:assert/strict';
import { runGeminiMinimalProbe } from './geminiProbe';

test('Gemini minimal probe sends only model, hello content, and empty config', async () => {
  let captured: any = null;
  const result = await runGeminiMinimalProbe('test-key', 'models/gemini-3.7-flash', () => ({
    models: {
      async generateContentStream(request) {
        captured = request;
        return (async function* () { yield { text: 'hello back' }; })();
      },
    },
  }));

  assert.equal(result.ok, true);
  assert.equal(result.model, 'gemini-3.7-flash');
  assert.equal(result.responseText, 'hello back');
  assert.deepEqual(captured, {
    model: 'gemini-3.7-flash',
    contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
    config: {},
  });
  assert.deepEqual(result.requestShape, {
    contentsCount: 1,
    configKeys: [],
    hasSystemInstruction: false,
    hasSafetySettings: false,
    hasThinkingConfig: false,
    hasTools: false,
  });
});

test('Gemini minimal probe preserves the raw provider failure classification', async () => {
  const result = await runGeminiMinimalProbe('test-key', 'gemini-3.7-flash', () => ({
    models: {
      async generateContentStream() {
        throw Object.assign(new Error('Request failed: HTTP 403 permission denied'), { status: 403 });
      },
    },
  }));

  assert.equal(result.ok, false);
  assert.equal(result.error?.httpStatus, 403);
  assert.equal(result.error?.code, 'API_FORBIDDEN_403');
  assert.match(result.error?.rawMessage || '', /permission denied/i);
});
