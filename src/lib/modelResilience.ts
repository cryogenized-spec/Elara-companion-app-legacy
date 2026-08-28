import { ClassifiedApiError, classifyApiError } from './apiError';
import { DEFAULT_RETRY_POLICY, RetryPolicy, runWithRetry } from './retryPolicy';
import type { ReliabilitySettings } from './reliabilitySettings';
import {
  DEFAULT_MODEL_COOLDOWN_MS,
  ModelHealthState,
  createModelHealthState,
  recordModelFailure,
  recordModelSuccess,
  selectRuntimeModel,
} from './modelHealth';
import { recordRoutingEvent, type RoutingEvent } from './routingDiagnostics';

export const DEFAULT_FALLBACK_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
] as const;

export interface ModelResiliencePolicy {
  retryPolicy?: Partial<RetryPolicy>;
  fallbackModels?: string[];
  failoverEnabled?: boolean;
  cooldownMs?: number;
  autoRestorePreferredModel?: boolean;
  retryableErrorCodes?: string[];
  failoverErrorCodes?: string[];
  telemetry?: (event: Omit<RoutingEvent, 'id' | 'timestamp' | 'timezone' | 'sessionId'>) => void;
}

export interface ModelResilienceContext {
  model: string;
  usedFallback: boolean;
  probingPreferred: boolean;
  attempts: number;
}

export interface ModelTurn<T> {
  value: T;
  emittedOutput?: boolean;
}

export interface ModelResilienceStateStore {
  get(): ModelHealthState;
  set(state: ModelHealthState): void;
}

let defaultModelHealthState: ModelHealthState = createModelHealthState();

const defaultStateStore: ModelResilienceStateStore = {
  get() {
    return defaultModelHealthState;
  },
  set(next) {
    defaultModelHealthState = next;
  },
};

const DEFAULT_FAILOVER_CODES = new Set([
  'API_RATE_LIMIT_RPM_429',
  'API_QUOTA_DAILY_429',
  'MODEL_NOT_FOUND_404',
  'SERVER_ERROR_500',
  'BAD_GATEWAY_502',
  'SERVICE_UNAVAILABLE_503',
  'GATEWAY_TIMEOUT_504',
]);

function shouldFailOver(error: ClassifiedApiError, configuredCodes?: string[]): boolean {
  if ((error as any).failoverOverride === false) return false;
  const allowed = configuredCodes ? new Set(configuredCodes) : DEFAULT_FAILOVER_CODES;
  return allowed.has(error.code);
}

function getErrorFromThrown(error: unknown, modelId: string): ClassifiedApiError {
  const attached = (error as any)?.apiError;
  return attached || classifyApiError(error, modelId);
}

function newRequestId(): string {
  return `request_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function preferenceRank(model: string, preferredModel: string, fallbackModels: string[]): number | undefined {
  const order = [preferredModel, ...fallbackModels]
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
  const index = order.indexOf(model.trim().toLowerCase());
  return index >= 0 ? index + 1 : undefined;
}

export function buildModelResiliencePolicy(settings?: ReliabilitySettings): ModelResiliencePolicy {
  if (!settings) {
    return {
      retryPolicy: DEFAULT_RETRY_POLICY,
      fallbackModels: [...DEFAULT_FALLBACK_MODELS],
      failoverEnabled: true,
      cooldownMs: DEFAULT_MODEL_COOLDOWN_MS,
      autoRestorePreferredModel: true,
    };
  }

  return {
    retryPolicy: {
      maxAttempts: settings.autoRetryEnabled ? settings.maxAttempts : 1,
      baseDelayMs: settings.baseDelayMs,
      maxDelayMs: settings.maxDelayMs,
      jitterRatio: settings.jitterRatio,
      honorRetryAfter: settings.honorRetryAfter,
    },
    fallbackModels: settings.fallbackModels,
    failoverEnabled: settings.autoFailoverEnabled,
    cooldownMs: settings.cooldownMs,
    autoRestorePreferredModel: settings.autoRestorePreferredModel,
    retryableErrorCodes: settings.retryableErrorCodes,
    failoverErrorCodes: settings.failoverErrorCodes,
  };
}

export async function runWithModelResilience<T>(
  preferredModel: string,
  executeTurn: (model: string, attempt: number) => Promise<ModelTurn<T>>,
  options: ModelResiliencePolicy = {},
  stateStore: ModelResilienceStateStore = defaultStateStore,
): Promise<{ value: T; context: ModelResilienceContext }> {
  const fallbackModels = options.fallbackModels || [...DEFAULT_FALLBACK_MODELS];
  const failoverEnabled = options.failoverEnabled !== false;
  const cooldownMs = options.cooldownMs ?? DEFAULT_MODEL_COOLDOWN_MS;
  const attemptedModels = new Set<string>();
  const requestId = newRequestId();
  let state = stateStore.get();
  const retryableCodes = options.retryableErrorCodes ? new Set(options.retryableErrorCodes) : undefined;
  const telemetry = options.telemetry || ((event: Omit<RoutingEvent, 'id' | 'timestamp' | 'timezone' | 'sessionId'>) => recordRoutingEvent(event));

  while (true) {
    const selection = selectRuntimeModel({
      preferredModel,
      fallbackModels,
      state,
      now: Date.now(),
      autoRestorePreferredModel: options.autoRestorePreferredModel,
    });

    const selectedModel = selection.model;
    const normalized = selectedModel.trim().toLowerCase();
    if (attemptedModels.has(normalized)) {
      throw new Error(`Model resilience exhausted its available model path after attempting [${selectedModel}].`);
    }
    attemptedModels.add(normalized);

    const selectedRank = preferenceRank(selectedModel, preferredModel, fallbackModels);
    const selectedStartedAt = Date.now();
    telemetry({
      requestId,
      preferredModel,
      attemptedModel: selectedModel,
      preferenceRank: selectedRank,
      attemptNumber: 1,
      provider: 'gemini',
      eventType: 'request',
    });

    try {
      const result = await runWithRetry(
        async (attempt) => {
          try {
            if (attempt > 1) {
              telemetry({
                requestId,
                preferredModel,
                attemptedModel: selectedModel,
                preferenceRank: selectedRank,
                attemptNumber: attempt,
                provider: 'gemini',
                eventType: 'retry',
              });
            }
            const turn = await executeTurn(selectedModel, attempt);
            state = recordModelSuccess(state, selectedModel);
            stateStore.set(state);
            const latencyMs = Date.now() - selectedStartedAt;
            telemetry({
              requestId,
              preferredModel,
              attemptedModel: selectedModel,
              preferenceRank: selectedRank,
              attemptNumber: attempt,
              provider: 'gemini',
              eventType: 'success',
              latencyMs,
              success: true,
            });
            if (selection.probingPreferred) {
              telemetry({
                requestId,
                preferredModel,
                attemptedModel: selectedModel,
                preferenceRank: selectedRank,
                provider: 'gemini',
                eventType: 'recovery',
                success: true,
              });
            }
            return turn;
          } catch (error) {
            const classified = getErrorFromThrown(error, selectedModel);
            telemetry({
              requestId,
              preferredModel,
              attemptedModel: selectedModel,
              preferenceRank: selectedRank,
              attemptNumber: attempt,
              provider: 'gemini',
              eventType: 'error',
              errorClassification: classified.code,
              httpStatus: classified.httpStatus,
              retryAfterMs: classified.retryAfterMs,
              latencyMs: Date.now() - selectedStartedAt,
            });
            if (retryableCodes && !retryableCodes.has(classified.code)) {
              throw Object.assign(new Error(classified.message), {
                apiError: { ...classified, retryable: false },
              });
            }
            throw error;
          }
        },
        {
          policy: options.retryPolicy || DEFAULT_RETRY_POLICY,
          modelId: selectedModel,
        },
      );

      return {
        value: result.value.value,
        context: {
          model: selectedModel,
          usedFallback: selection.usedFallback,
          probingPreferred: selection.probingPreferred,
          attempts: result.attempts,
        },
      };
    } catch (error) {
      const classified = getErrorFromThrown(error, selectedModel);
      state = recordModelFailure(state, selectedModel, classified, Date.now(), cooldownMs);
      stateStore.set(state);

      telemetry({
        requestId,
        preferredModel,
        attemptedModel: selectedModel,
        preferenceRank: selectedRank,
        provider: 'gemini',
        eventType: 'cooldown',
        errorClassification: classified.code,
        cooldownApplied: true,
        cooldownUntil: Date.now() + Math.max(0, cooldownMs),
        success: false,
      });

      if (!failoverEnabled || !shouldFailOver(classified, options.failoverErrorCodes)) {
        throw error;
      }

      const nextSelection = selectRuntimeModel({
        preferredModel,
        fallbackModels,
        state,
        now: Date.now(),
        autoRestorePreferredModel: options.autoRestorePreferredModel,
      });
      if (nextSelection.model.trim().toLowerCase() === normalized) {
        throw error;
      }

      telemetry({
        requestId,
        preferredModel,
        attemptedModel: selectedModel,
        preferenceRank: selectedRank,
        provider: 'gemini',
        eventType: 'fallback',
        errorClassification: classified.code,
        fallbackEligible: true,
        fallbackTaken: true,
        destinationModel: nextSelection.model,
      });
    }
  }
}

export function resetModelResilienceState(stateStore: ModelResilienceStateStore = defaultStateStore): void {
  stateStore.set(createModelHealthState());
}

export { defaultStateStore };
