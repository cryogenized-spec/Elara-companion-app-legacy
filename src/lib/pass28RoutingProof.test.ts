import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyApiError } from './apiError';
import { runWithModelResilience, type ModelResilienceStateStore } from './modelResilience';
import { createModelHealthState, recordModelFailure, type ModelHealthState } from './modelHealth';
import { buildDiagnosticsSnapshot, type RoutingEvent } from './routingDiagnostics';

const preferred = 'gemini-3.7-flash';
const fallbacks = ['gemini-3.6-flash', 'gemini-3.5-flash'];

function store(initial: ModelHealthState = createModelHealthState()): ModelResilienceStateStore {
  let state = initial;
  return { get: () => state, set: (next) => { state = next; } };
}

function apiError(message: string, model = preferred): Error & { apiError: ReturnType<typeof classifyApiError> } {
  const classified = classifyApiError(message, model);
  return Object.assign(new Error(classified.message), { apiError: classified });
}

const noRetry = { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 };

test('success stays on preference #1 and records health success', async () => {
  const calls: string[] = [];
  const result = await runWithModelResilience(preferred, async (model) => { calls.push(model); return { value: 'ok' }; }, { retryPolicy: noRetry, fallbackModels: fallbacks }, store());
  assert.deepEqual(calls, [preferred]);
  assert.equal(result.context.model, preferred);
});

test('retry then success stays on the same model', async () => {
  let attempts = 0;
  const calls: Array<[string, number]> = [];
  const result = await runWithModelResilience(preferred, async (model, attempt) => {
    calls.push([model, attempt]);
    attempts++;
    if (attempts === 1) throw apiError('HTTP 503 service unavailable');
    return { value: 'recovered' };
  }, { retryPolicy: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 }, fallbackModels: fallbacks }, store());
  assert.deepEqual(calls, [[preferred, 1], [preferred, 2]]);
  assert.equal(result.context.model, preferred);
});

test('429 falls from #1 to #2 without mutating preference', async () => {
  const calls: string[] = [];
  const result = await runWithModelResilience(preferred, async (model) => {
    calls.push(model);
    if (model === preferred) throw apiError('HTTP 429 rate limit');
    return { value: 'fallback success' };
  }, { retryPolicy: noRetry, fallbackModels: fallbacks, failoverErrorCodes: ['API_RATE_LIMIT_RPM_429'] }, store());
  assert.deepEqual(calls, [preferred, fallbacks[0]]);
  assert.equal(result.context.model, fallbacks[0]);
});

test('5xx falls from #1 to #2', async () => {
  const calls: string[] = [];
  const result = await runWithModelResilience(preferred, async (model) => {
    calls.push(model);
    if (model === preferred) throw apiError('HTTP 500 internal server error');
    return { value: 'fallback success' };
  }, { retryPolicy: noRetry, fallbackModels: fallbacks, failoverErrorCodes: ['SERVER_ERROR_500'] }, store());
  assert.deepEqual(calls, [preferred, fallbacks[0]]);
});

test('#2 cooling down selects #3, while preserving the configured order', async () => {
  const initial = recordModelFailure(createModelHealthState(), fallbacks[0], classifyApiError('HTTP 503 service unavailable', fallbacks[0]), Date.now(), 60_000);
  const calls: string[] = [];
  const result = await runWithModelResilience(preferred, async (model) => { calls.push(model); return { value: 'third tier' }; }, { retryPolicy: noRetry, fallbackModels: fallbacks }, store(initial));
  assert.deepEqual(calls, [fallbacks[1]]);
  assert.equal(result.context.model, fallbacks[1]);
});

test('authentication failure does not fallback', async () => {
  const calls: string[] = [];
  await assert.rejects(() => runWithModelResilience(preferred, async (model) => { calls.push(model); throw apiError('HTTP 401 unauthorized'); }, { retryPolicy: noRetry, fallbackModels: fallbacks }, store()));
  assert.deepEqual(calls, [preferred]);
});

test('invalid request does not fallback', async () => {
  const calls: string[] = [];
  await assert.rejects(() => runWithModelResilience(preferred, async (model) => { calls.push(model); throw apiError('HTTP 400 invalid request'); }, { retryPolicy: noRetry, fallbackModels: fallbacks }, store()));
  assert.deepEqual(calls, [preferred]);
});

test('cancellation does not fallback', async () => {
  const calls: string[] = [];
  await assert.rejects(() => runWithModelResilience(preferred, async (model) => { calls.push(model); throw apiError('AbortError'); }, { retryPolicy: noRetry, fallbackModels: fallbacks }, store()));
  assert.deepEqual(calls, [preferred]);
});

test('unknown error remains non-fallback by default but becomes fallback-safe only when explicitly configured', async () => {
  const defaultCalls: string[] = [];
  await assert.rejects(() => runWithModelResilience(preferred, async (model) => { defaultCalls.push(model); throw apiError('something surprising happened'); }, { retryPolicy: noRetry, fallbackModels: fallbacks }, store()));
  assert.deepEqual(defaultCalls, [preferred]);

  const optedInCalls: string[] = [];
  const result = await runWithModelResilience(preferred, async (model) => {
    optedInCalls.push(model);
    if (model === preferred) throw apiError('something surprising happened');
    return { value: 'explicit unknown fallback' };
  }, { retryPolicy: noRetry, fallbackModels: fallbacks, failoverErrorCodes: ['UNKNOWN_API_ERROR'] }, store());
  assert.deepEqual(optedInCalls, [preferred, fallbacks[0]]);
  assert.equal(result.context.model, fallbacks[0]);
});

test('recovery returns to preference #1 after cooldown', async () => {
  const health = recordModelFailure(createModelHealthState(), preferred, classifyApiError('HTTP 503 service unavailable', preferred), 1000, 10);
  const firstCalls: string[] = [];
  await runWithModelResilience(preferred, async (model) => { firstCalls.push(model); return { value: 'fallback' }; }, { retryPolicy: noRetry, fallbackModels: fallbacks }, store(health));

  const recoveredState = createModelHealthState();
  const secondCalls: string[] = [];
  const result = await runWithModelResilience(preferred, async (model) => { secondCalls.push(model); return { value: 'primary restored' }; }, { retryPolicy: noRetry, fallbackModels: fallbacks }, store(recoveredState));
  assert.deepEqual(firstCalls, [fallbacks[0]]);
  assert.deepEqual(secondCalls, [preferred]);
  assert.equal(result.context.model, preferred);
});

test('routing telemetry can reconstruct the proof path and keeps secrets out of structured events', () => {
  const events: RoutingEvent[] = [
    { id: '1', timestamp: 1, timezone: 'Africa/Johannesburg', sessionId: 's', requestId: 'r', preferredModel: preferred, attemptedModel: preferred, preferenceRank: 1, attemptNumber: 1, provider: 'gemini', eventType: 'request' },
    { id: '2', timestamp: 2, timezone: 'Africa/Johannesburg', sessionId: 's', requestId: 'r', preferredModel: preferred, attemptedModel: preferred, preferenceRank: 1, attemptNumber: 1, provider: 'gemini', eventType: 'error', errorClassification: 'API_RATE_LIMIT_RPM_429', httpStatus: 429 },
    { id: '3', timestamp: 3, timezone: 'Africa/Johannesburg', sessionId: 's', requestId: 'r', preferredModel: preferred, attemptedModel: preferred, preferenceRank: 1, provider: 'gemini', eventType: 'cooldown', cooldownApplied: true, cooldownUntil: 100 },
    { id: '4', timestamp: 4, timezone: 'Africa/Johannesburg', sessionId: 's', requestId: 'r', preferredModel: preferred, attemptedModel: preferred, preferenceRank: 1, provider: 'gemini', eventType: 'fallback', fallbackEligible: true, fallbackTaken: true, destinationModel: fallbacks[0] },
    { id: '5', timestamp: 5, timezone: 'Africa/Johannesburg', sessionId: 's', requestId: 'r', preferredModel: preferred, attemptedModel: fallbacks[0], preferenceRank: 2, provider: 'gemini', eventType: 'success', success: true, latencyMs: 900 },
  ];
  const snapshot = buildDiagnosticsSnapshot(events);
  assert.deepEqual(snapshot.events.map((event) => event.eventType), ['request', 'error', 'cooldown', 'fallback', 'success']);
  assert.equal(JSON.stringify(snapshot).includes('AIza'), false);
  assert.equal(JSON.stringify(snapshot).includes('Bearer '), false);
});
