import { get, set } from 'idb-keyval';
import { AVAILABLE_MODELS, type ElaraSettings } from '../types';
import type { ElaraApiErrorCode, ClassifiedApiError } from './apiError';
import type { ReliabilitySettings } from './reliabilitySettings';

export const ROUTING_DIAGNOSTICS_KEY = 'elara_routing_diagnostics_v1';
export const ROUTING_DIAGNOSTICS_SCHEMA_VERSION = 1;
export const ROUTING_DIAGNOSTICS_MAX_EVENTS = 5000;

export type RoutingEventType =
  | 'request'
  | 'retry'
  | 'error'
  | 'fallback'
  | 'success'
  | 'cooldown'
  | 'recovery';

export interface RoutingEvent {
  id: string;
  timestamp: number;
  timezone: string;
  sessionId: string;
  requestId: string;
  conversationId?: string;
  preferredModel: string;
  attemptedModel: string;
  preferenceRank?: number;
  attemptNumber?: number;
  provider: 'gemini';
  eventType: RoutingEventType;
  errorClassification?: ElaraApiErrorCode;
  httpStatus?: number;
  retryAfterMs?: number;
  latencyMs?: number;
  fallbackEligible?: boolean;
  fallbackTaken?: boolean;
  destinationModel?: string;
  cooldownApplied?: boolean;
  cooldownUntil?: number;
  success?: boolean;
}

export interface RoutingDiagnosticsState {
  schemaVersion: number;
  events: RoutingEvent[];
}

export interface RoutingDiagnosticsSnapshot {
  events: RoutingEvent[];
  modelHealth: Record<string, ModelHealthSummary>;
}

export interface ModelHealthSummary {
  model: string;
  totalRequests: number;
  successes: number;
  failures: number;
  fallbackCount: number;
  retryCount: number;
  averageLatencyMs?: number;
  lastFailureAt?: number;
  lastFailureClass?: ElaraApiErrorCode;
  state: 'healthy' | 'degraded' | 'cooling down' | 'unavailable';
}

export interface ExternalEvidence {
  checkedAt: number;
  source: string;
  ok: boolean;
  summary: string;
}

export interface RoutingAnalysisReport {
  period: { start: number; end: number; label: string; timezone: string };
  observed: string[];
  inferred: string[];
  externalEvidence: ExternalEvidence[];
  recommendations: string[];
  eventCount: number;
  modelHealth: ModelHealthSummary[];
}

let writeQueue = Promise.resolve();
let sessionId: string | null = null;

function getSessionId(): string {
  if (sessionId) return sessionId;
  sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return sessionId;
}

function safeTimezone(timezone?: string): string {
  if (timezone) {
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format();
      return timezone;
    } catch {
      // fall through to runtime zone
    }
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function normalizeState(value: unknown): RoutingDiagnosticsState {
  if (!value || typeof value !== 'object') return { schemaVersion: ROUTING_DIAGNOSTICS_SCHEMA_VERSION, events: [] };
  const raw = value as Partial<RoutingDiagnosticsState>;
  const events = Array.isArray(raw.events)
    ? raw.events.filter((event): event is RoutingEvent => Boolean(event && typeof event === 'object' && typeof (event as any).id === 'string' && typeof (event as any).timestamp === 'number'))
    : [];
  return { schemaVersion: ROUTING_DIAGNOSTICS_SCHEMA_VERSION, events: events.slice(-ROUTING_DIAGNOSTICS_MAX_EVENTS) };
}

export async function loadRoutingDiagnostics(): Promise<RoutingDiagnosticsState> {
  try {
    return normalizeState(await get(ROUTING_DIAGNOSTICS_KEY));
  } catch {
    return { schemaVersion: ROUTING_DIAGNOSTICS_SCHEMA_VERSION, events: [] };
  }
}

async function persistState(state: RoutingDiagnosticsState): Promise<void> {
  try {
    await set(ROUTING_DIAGNOSTICS_KEY, normalizeState(state));
  } catch {
    // Diagnostics are non-critical and must never disrupt chat execution.
  }
}

export function recordRoutingEvent(
  event: Omit<RoutingEvent, 'id' | 'timestamp' | 'timezone' | 'sessionId'> & Partial<Pick<RoutingEvent, 'timezone' | 'sessionId'>>,
): void {
  if (typeof window === 'undefined') return;
  const completed: RoutingEvent = {
    ...event,
    id: `route_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    timezone: event.timezone || safeTimezone(),
    sessionId: event.sessionId || getSessionId(),
  };
  writeQueue = writeQueue.then(async () => {
    const current = await loadRoutingDiagnostics();
    await persistState({ events: [...current.events, completed], schemaVersion: ROUTING_DIAGNOSTICS_SCHEMA_VERSION });
  });
}

export async function clearRoutingDiagnostics(): Promise<void> {
  writeQueue = writeQueue.then(() => persistState({ schemaVersion: ROUTING_DIAGNOSTICS_SCHEMA_VERSION, events: [] }));
  await writeQueue;
}

function getPreferredOrder(settings: ElaraSettings): string[] {
  const preferred = settings.model?.trim().toLowerCase();
  const fallback = settings.reliabilitySettings?.fallbackModels || [];
  return [...new Set([preferred, ...fallback].filter(Boolean))];
}

function preferenceRank(model: string, order: string[]): number | undefined {
  const index = order.findIndex((item) => item.toLowerCase() === model.toLowerCase());
  return index >= 0 ? index + 1 : undefined;
}

function formatModel(model: string): string {
  return AVAILABLE_MODELS.find((item) => item.id === model)?.name || model;
}

function dateKey(timestamp: number, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toISOString().slice(0, 10);
  }
}

function average(values: number[]): number | undefined {
  if (!values.length) return undefined;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function deriveModelHealth(events: RoutingEvent[], now = Date.now()): Record<string, ModelHealthSummary> {
  const grouped = new Map<string, RoutingEvent[]>();
  for (const event of events) {
    const key = event.attemptedModel.toLowerCase();
    const list = grouped.get(key) || [];
    list.push(event);
    grouped.set(key, list);
  }

  const result: Record<string, ModelHealthSummary> = {};
  for (const [key, list] of grouped) {
    const failures = list.filter((event) => event.eventType === 'error');
    const successes = list.filter((event) => event.eventType === 'success' || event.success === true);
    const retries = list.filter((event) => event.eventType === 'retry');
    const fallbackCount = list.filter((event) => event.eventType === 'fallback' || event.fallbackTaken === true).length;
    const lastFailure = [...failures].sort((a, b) => b.timestamp - a.timestamp)[0];
    const cooling = [...list].sort((a, b) => (b.cooldownUntil || 0) - (a.cooldownUntil || 0))[0];
    const lastLatency = average(list.filter((event) => typeof event.latencyMs === 'number').map((event) => event.latencyMs as number));
    const recentFailures = failures.filter((event) => now - event.timestamp < 15 * 60_000).length;
    const state: ModelHealthSummary['state'] = cooling?.cooldownUntil && cooling.cooldownUntil > now
      ? 'cooling down'
      : lastFailure && recentFailures >= 3 && successes.length === 0
        ? 'unavailable'
        : recentFailures > 0
          ? 'degraded'
          : 'healthy';

    result[key] = {
      model: list[0].attemptedModel,
      totalRequests: list.filter((event) => event.eventType === 'request').length,
      successes: successes.length,
      failures: failures.length,
      fallbackCount,
      retryCount: retries.length,
      averageLatencyMs: lastLatency,
      lastFailureAt: lastFailure?.timestamp,
      lastFailureClass: lastFailure?.errorClassification,
      state,
    };
  }
  return result;
}

export function buildDiagnosticsSnapshot(events: RoutingEvent[]): RoutingDiagnosticsSnapshot {
  return { events: [...events].sort((a, b) => a.timestamp - b.timestamp), modelHealth: deriveModelHealth(events) };
}

export type AnalysisWindow = 'last-hour' | 'today' | 'last-7-days' | 'last-30-days' | 'custom';

export function resolveAnalysisPeriod(
  window: AnalysisWindow,
  timezone: string,
  now = Date.now(),
  custom?: { start: number; end: number },
): { start: number; end: number; label: string } {
  if (window === 'custom' && custom) return { start: custom.start, end: custom.end, label: 'Custom period' };
  if (window === 'last-hour') return { start: now - 60 * 60_000, end: now, label: 'Last hour' };
  if (window === 'last-7-days') return { start: now - 7 * 24 * 60 * 60_000, end: now, label: 'Last 7 days' };
  if (window === 'last-30-days') return { start: now - 30 * 24 * 60 * 60_000, end: now, label: 'Last 30 days' };

  const today = dateKey(now, timezone);
  const start = Date.parse(`${today}T00:00:00`);
  const end = start + 24 * 60 * 60_000;
  return { start, end, label: 'Today' };
}

export function analyzeRoutingDiagnostics(
  events: RoutingEvent[],
  settings: ElaraSettings,
  period: { start: number; end: number; label: string },
  externalEvidence: ExternalEvidence[] = [],
): RoutingAnalysisReport {
  const filtered = events.filter((event) => event.timestamp >= period.start && event.timestamp <= period.end).sort((a, b) => a.timestamp - b.timestamp);
  const order = getPreferredOrder(settings);
  const observed: string[] = [];
  const inferred: string[] = [];
  const recommendations: string[] = [];

  const requestEvents = filtered.filter((event) => event.eventType === 'request');
  const failures = filtered.filter((event) => event.eventType === 'error');
  const fallbacks = filtered.filter((event) => event.eventType === 'fallback' || event.fallbackTaken === true);
  const retries = filtered.filter((event) => event.eventType === 'retry');
  const health = Object.values(deriveModelHealth(filtered));

  if (!filtered.length) {
    observed.push('No routing telemetry was recorded in the selected period.');
  } else {
    observed.push(`${filtered.length} routing events were recorded across ${requestEvents.length} model requests.`);
    if (failures.length) observed.push(`${failures.length} failure events were recorded; the most common classification was ${mostCommonFailure(failures)}.`);
    if (retries.length) observed.push(`${retries.length} retry events were recorded before or alongside model routing decisions.`);
    if (fallbacks.length) observed.push(`${fallbacks.length} fallback events were recorded while the configured preference order remained ${order.map(formatModel).join(' → ')}.`);

    const rankOneFailures = failures.filter((event) => (preferenceRank(event.attemptedModel, order) || 0) === 1).length;
    if (rankOneFailures && fallbackEventsWithin(filtered, 5 * 60_000) > 0) {
      inferred.push(`The preferred model experienced ${rankOneFailures} recorded failures followed by fallback activity in the selected period.`);
    }

    for (const item of health.filter((entry) => entry.averageLatencyMs !== undefined)) {
      if ((item.averageLatencyMs || 0) > 5000) inferred.push(`${formatModel(item.model)} showed elevated recorded latency (about ${item.averageLatencyMs} ms average across diagnostic events).`);
    }

    const rateLimited = failures.filter((event) => event.errorClassification === 'API_RATE_LIMIT_RPM_429').length;
    if (rateLimited >= 3) recommendations.push('Consider allowing rate-limit / 429 fallback during periods where this pattern recurs, without changing the saved preference order.');
    if (fallbacks.length === 0 && failures.length >= 3) recommendations.push('Review fallback eligibility for the observed failure classes; the current period contains failures without recorded fallback activity.');
    if (health.some((entry) => entry.state === 'cooling down')) recommendations.push('Keep cooldown-based recovery enabled so unhealthy models are retried after their configured recovery window.');
  }

  return {
    period: { ...period, timezone: safeTimezone(settings.timezone) },
    observed,
    inferred: inferred.length ? inferred : ['No strong temporal or statistical inference was supported by the selected telemetry.'],
    externalEvidence,
    recommendations: recommendations.length ? recommendations : ['No configuration change is recommended from the selected evidence alone.'],
    eventCount: filtered.length,
    modelHealth: health.sort((a, b) => (a.model > b.model ? 1 : -1)),
  };
}

function fallbackEventsWithin(events: RoutingEvent[], windowMs: number): number {
  const errors = events.filter((event) => event.eventType === 'error');
  const fallbacks = events.filter((event) => event.eventType === 'fallback');
  let count = 0;
  for (const fallback of fallbacks) {
    if (errors.some((error) => error.timestamp <= fallback.timestamp && fallback.timestamp - error.timestamp <= windowMs)) count += 1;
  }
  return count;
}

function mostCommonFailure(events: RoutingEvent[]): string {
  const counts = new Map<string, number>();
  for (const event of events) {
    const key = event.errorClassification || 'UNKNOWN_API_ERROR';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';
}

export function describeFallbackRules(settings: ReliabilitySettings | undefined): string[] {
  if (!settings) return ['No reliability policy snapshot is available.'];
  return [
    `Automatic retry: ${settings.autoRetryEnabled ? 'ON' : 'OFF'}; maximum same-model attempts: ${settings.maxAttempts}.`,
    `Automatic failover: ${settings.autoFailoverEnabled ? 'ON' : 'OFF'}.`,
    `Failover classes: ${(settings.failoverErrorCodes || []).join(', ') || 'none configured'}.`,
    `Preferred-model recovery: ${settings.autoRestorePreferredModel ? 'ON' : 'OFF'}.`,
  ];
}

export function buildRoutingPreference(settings: ElaraSettings): string[] {
  return getPreferredOrder(settings);
}

export async function analyzeSavedRoutingDiagnostics(
  settings: ElaraSettings,
  window: AnalysisWindow,
  custom?: { start: number; end: number },
  externalEvidence: ExternalEvidence[] = [],
  now = Date.now(),
): Promise<RoutingAnalysisReport> {
  const state = await loadRoutingDiagnostics();
  const timezone = safeTimezone(settings.timezone);
  const period = resolveAnalysisPeriod(window, timezone, now, custom);
  return analyzeRoutingDiagnostics(state.events, settings, period, externalEvidence);
}

export function createRoutingEventDefaults(
  preferredModel: string,
  attemptedModel: string,
  type: RoutingEventType,
): Pick<RoutingEvent, 'preferredModel' | 'attemptedModel' | 'provider' | 'eventType'> {
  return { preferredModel, attemptedModel, provider: 'gemini', eventType: type };
}

export type ClassifiedFailureForTelemetry = Pick<ClassifiedApiError, 'code' | 'httpStatus' | 'retryAfterMs'>;
