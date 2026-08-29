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
    contentRole: 'user',
    messageText: 'hello',
    configKeys: [],
    hasSystemInstruction: false,
    hasSafetySettings: false,
    hasThinkingConfig: false,
    hasTools: false,
    hasHistory: false,
    hasWorkspace: false,
    hasGoogleOAuth: false,
    usesResilience: false,
  });
});

test('Gemini minimal probe classifies a pre-stream provider failure without losing status or message', async () => {
  const result = await runGeminiMinimalProbe('test-key', 'gemini-3.7-flash', () => ({
    models: {
      async generateContentStream() {
        throw Object.assign(new Error('Request failed: HTTP 403 permission denied'), { status: 403 });
      },
    },
  }));

  assert.equal(result.ok, false);
  assert.equal(result.failureStage, 'before-stream');
  assert.equal(result.error?.httpStatus, 403);
  assert.equal(result.error?.code, 'API_FORBIDDEN_403');
  assert.match(result.error?.rawMessage || '', /permission denied/i);
});

test('Gemini minimal probe identifies a stream-time failure separately', async () => {
  const result = await runGeminiMinimalProbe('test-key', 'gemini-3.7-flash', () => ({
    models: {
      async generateContentStream() {
        return (async function* () {
          yield { text: 'partial' };
          throw new Error('HTTP 500 stream broke');
        })();
      },
    },
  }));

  assert.equal(result.ok, false);
  assert.equal(result.failureStage, 'after-stream');
  assert.equal(result.error?.httpStatus, 500);
  assert.equal(result.error?.code, 'SERVER_ERROR_500');
});
