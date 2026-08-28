import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ROUTING_DIAGNOSTICS_MAX_EVENTS,
  analyzeRoutingDiagnostics,
  buildDiagnosticsSnapshot,
  deriveModelHealth,
  resolveAnalysisPeriod,
  type RoutingEvent,
} from './routingDiagnostics';
import { DEFAULT_SETTINGS } from './storage';

const baseEvent = (patch: Partial<RoutingEvent>): RoutingEvent => ({
  id: patch.id || `e_${Math.random()}`,
  timestamp: patch.timestamp ?? 1_000_000,
  timezone: 'Africa/Johannesburg',
  sessionId: 'session_1',
  requestId: patch.requestId || 'request_1',
  preferredModel: 'gemini-3.7-flash',
  attemptedModel: patch.attemptedModel || 'gemini-3.7-flash',
  preferenceRank: patch.preferenceRank || 1,
  attemptNumber: patch.attemptNumber || 1,
  provider: 'gemini',
  eventType: patch.eventType || 'request',
  ...patch,
});

test('snapshot is chronologically ordered and model health is derived from the same events', () => {
  const events = [
    baseEvent({ id: '2', timestamp: 200, eventType: 'error', errorClassification: 'API_RATE_LIMIT_RPM_429', attemptedModel: 'gemini-3.7-flash' }),
    baseEvent({ id: '1', timestamp: 100, eventType: 'request' }),
    baseEvent({ id: '3', timestamp: 300, eventType: 'fallback', fallbackTaken: true, destinationModel: 'gemini-3.6-flash' }),
    baseEvent({ id: '4', timestamp: 400, eventType: 'success', success: true, latencyMs: 1200 }),
  ];

  const snapshot = buildDiagnosticsSnapshot(events);
  assert.deepEqual(snapshot.events.map((event) => event.id), ['1', '2', '3', '4']);
  assert.equal(snapshot.modelHealth['gemini-3.7-flash'].failures, 1);
  assert.equal(snapshot.modelHealth['gemini-3.7-flash'].fallbackCount, 1);
  assert.equal(snapshot.modelHealth['gemini-3.7-flash'].successes, 1);
});

test('analysis cleanly separates observed facts, inference, external evidence and recommendation', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    model: 'gemini-3.7-flash',
    timezone: 'Africa/Johannesburg',
    reliabilitySettings: {
      ...DEFAULT_SETTINGS.reliabilitySettings!,
      failoverErrorCodes: ['API_RATE_LIMIT_RPM_429'],
    },
  };
  const events = [
    baseEvent({ id: '1', timestamp: 100, eventType: 'request' }),
    baseEvent({ id: '2', timestamp: 200, eventType: 'error', errorClassification: 'API_RATE_LIMIT_RPM_429' }),
    baseEvent({ id: '3', timestamp: 300, eventType: 'fallback', fallbackTaken: true, destinationModel: 'gemini-3.6-flash' }),
    baseEvent({ id: '4', timestamp: 400, eventType: 'success', success: true }),
  ];

  const report = analyzeRoutingDiagnostics(
    events,
    settings,
    { start: 0, end: 1000, label: 'Test period' },
    [{ checkedAt: 500, source: 'Google Cloud status', ok: true, summary: 'Provider page reachable.' }],
  );

  assert.match(report.observed.join(' '), /routing events were recorded/);
  assert.match(report.observed.join(' '), /failure events were recorded/);
  assert.ok(report.inferred.length >= 1);
  assert.equal(report.externalEvidence.length, 1);
  assert.ok(report.recommendations.length >= 1);
});

test('analysis preference order comes from canonical settings, not a second store', () => {
  const settings = { ...DEFAULT_SETTINGS, model: 'gemini-3.7-flash', reliabilitySettings: { ...DEFAULT_SETTINGS.reliabilitySettings!, fallbackModels: ['gemini-3.6-flash', 'gemini-3.5-flash'] } };
  const events = [baseEvent({ timestamp: 100, eventType: 'request' })];
  const report = analyzeRoutingDiagnostics(events, settings, { start: 0, end: 1000, label: 'Test period' });
  assert.match(report.observed.join(' '), /Gemini 3.7 Flash → Gemini 3.6 Flash → Gemini 3.5 Flash/);
});

test('health state becomes unavailable only from repeated recent failures without success', () => {
  const now = 10_000;
  const events = [
    baseEvent({ timestamp: now - 1000, eventType: 'error', errorClassification: 'SERVICE_UNAVAILABLE_503' }),
    baseEvent({ timestamp: now - 2000, eventType: 'error', errorClassification: 'SERVICE_UNAVAILABLE_503' }),
    baseEvent({ timestamp: now - 3000, eventType: 'error', errorClassification: 'SERVICE_UNAVAILABLE_503' }),
  ];
  const health = deriveModelHealth(events, now);
  assert.equal(health['gemini-3.7-flash'].state, 'unavailable');
});

test('diagnostics retention keeps an explicit bounded maximum', () => {
  const events = Array.from({ length: ROUTING_DIAGNOSTICS_MAX_EVENTS + 100 }, (_, index) => baseEvent({ id: String(index), timestamp: index }));
  const bounded = events.slice(-ROUTING_DIAGNOSTICS_MAX_EVENTS);
  assert.equal(bounded.length, ROUTING_DIAGNOSTICS_MAX_EVENTS);
  assert.equal(bounded[0].id, '100');
  assert.equal(bounded.at(-1)?.id, String(ROUTING_DIAGNOSTICS_MAX_EVENTS + 99));
});

test('custom period remains deterministic for reports', () => {
  assert.deepEqual(resolveAnalysisPeriod('custom', 'Africa/Johannesburg', 1000, { start: 200, end: 900 }), {
    start: 200,
    end: 900,
    label: 'Custom period',
  });
});
