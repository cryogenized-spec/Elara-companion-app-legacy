import { GoogleGenAI } from '@google/genai';
import { classifyApiError } from './apiError';
import { ModelResiliencePolicy, ModelResilienceStateStore, runWithModelResilience } from './modelResilience';
import type { ReliabilitySettings } from './reliabilitySettings';
import { buildModelResiliencePolicy } from './modelResilience';
import { emitResilienceStatus } from './resilienceStatus';

export interface ResilientStreamTurnResult {
  model: string;
  usedFallback: boolean;
  probingPreferred: boolean;
  attempts: number;
  functionCalls: any[];
  modelParts: any[];
}

export interface ResilientStreamTurnOptions {
  ai: GoogleGenAI;
  preferredModel: string;
  buildConfig: (model: string) => any;
  contents: any[];
  onChunk: (chunk: { text?: string; thoughtText?: string; thoughtType?: 'summary'; finishReason?: string; safetyRatings?: any; functionCall?: any }) => void;
  signal?: AbortSignal;
  policy?: ModelResiliencePolicy;
  reliabilitySettings?: ReliabilitySettings;
  stateStore?: ModelResilienceStateStore;
}

type StreamChunk = {
  text?: string;
  thoughtText?: string;
  thoughtType?: 'summary';
  finishReason?: string;
  safetyRatings?: any;
};

const STREAM_UI_BATCH_WINDOW_MS = 16;

function createChunkBatcher(onChunk: (chunk: StreamChunk) => void) {
  let pending: StreamChunk | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flush = () => {
    clearTimer();
    if (!pending) return;
    const next = pending;
    pending = null;
    onChunk(next);
  };

  const enqueue = (chunk: StreamChunk) => {
    const kind = chunk.thoughtText !== undefined ? 'thought' : chunk.text !== undefined ? 'text' : 'other';
    const pendingKind = pending
      ? pending.thoughtText !== undefined
        ? 'thought'
        : pending.text !== undefined
          ? 'text'
          : 'other'
      : null;

    if (!pending || pendingKind !== kind || kind === 'other') {
      flush();
      pending = { ...chunk };
    } else if (kind === 'thought') {
      pending.thoughtText = `${pending.thoughtText || ''}${chunk.thoughtText || ''}`;
      pending.thoughtType = chunk.thoughtType || pending.thoughtType;
      pending.finishReason = chunk.finishReason || pending.finishReason;
      pending.safetyRatings = chunk.safetyRatings || pending.safetyRatings;
    } else {
      pending.text = `${pending.text || ''}${chunk.text || ''}`;
      pending.finishReason = chunk.finishReason || pending.finishReason;
      pending.safetyRatings = chunk.safetyRatings || pending.safetyRatings;
    }

    if (kind === 'other') flush();
    else if (timer === null) timer = setTimeout(flush, STREAM_UI_BATCH_WINDOW_MS);
  };

  return { enqueue, flush };
}

function buildCompatibilityConfig(config: any): any {
  if (!config || typeof config !== 'object') return config;
  const compatibility = { ...config };
  delete compatibility.tools;
  delete compatibility.thinkingConfig;
  return compatibility;
}

export async function runResilientGeminiStreamTurn(
  options: ResilientStreamTurnOptions,
): Promise<ResilientStreamTurnResult> {
  const policy = options.policy || (options.reliabilitySettings ? buildModelResiliencePolicy(options.reliabilitySettings) : undefined);
  const result = await runWithModelResilience(
    options.preferredModel,
    async (model) => {
      let emittedOutput = false;
      const functionCalls: any[] = [];
      const modelParts: any[] = [];
      let responseStream: any;

      try {
        responseStream = await options.ai.models.generateContentStream({
          model,
          contents: options.contents,
          config: options.buildConfig(model),
        });
      } catch (error) {
        const classified = classifyApiError(error, model);
        const originalConfig = options.buildConfig(model);
        const compatibilityConfig = buildCompatibilityConfig(originalConfig);

        try {
          responseStream = await options.ai.models.generateContentStream({
            model,
            contents: options.contents,
            config: compatibilityConfig,
          });
          console.warn('Gemini request used compatibility envelope after initial request failure.', {
            model,
            code: classified.code,
            status: classified.httpStatus,
          });
        } catch (compatibilityError) {
          const fallback = classifyApiError(compatibilityError, model);
          throw Object.assign(new Error(fallback.message), {
            apiError: {
              ...fallback,
              rawMessage: `Initial request: ${classified.rawMessage} | Compatibility request: ${fallback.rawMessage}`,
            },
          });
        }
      }

      const batcher = createChunkBatcher(options.onChunk);

      try {
        for await (const chunk of responseStream) {
          if (options.signal?.aborted) break;

          const candidate = chunk.candidates?.[0];
          const finishReason = candidate?.finishReason;
          const safetyRatings = candidate?.safetyRatings;
          const parts = candidate?.content?.parts;

          if (parts && parts.length > 0) {
            for (const part of parts) {
              if ((part as any).thought && part.text) {
                emittedOutput = true;
                batcher.enqueue({ thoughtText: part.text, thoughtType: 'summary' });
                modelParts.push(part);
              } else if ((part as any).functionCall) {
                emittedOutput = true;
                batcher.flush();
                const fc = (part as any).functionCall;
                functionCalls.push(fc);
                modelParts.push(part);
              } else if (part.text) {
                emittedOutput = true;
                batcher.enqueue({ text: part.text, finishReason, safetyRatings });
                modelParts.push(part);
              }
            }
          } else if (chunk.text) {
            emittedOutput = true;
            batcher.enqueue({ text: chunk.text, finishReason, safetyRatings });
          } else if (finishReason) {
            batcher.flush();
            options.onChunk({ finishReason, safetyRatings });
          }
        }
      } catch (error) {
        batcher.flush();
        if (emittedOutput) {
          const classified = classifyApiError(error, model);
          throw Object.assign(new Error(classified.message), {
            apiError: { ...classified, retryable: false, failoverOverride: false },
          });
        }
        throw error;
      } finally {
        batcher.flush();
      }

      return {
        value: { functionCalls, modelParts },
        emittedOutput,
      };
    },
    policy,
    options.stateStore,
  );

  const statusKind = result.context.probingPreferred || result.context.attempts > 1
    ? 'recovered'
    : result.context.usedFallback
      ? 'fallback'
      : null;

  if (statusKind) {
    emitResilienceStatus({
      kind: statusKind,
      model: result.context.model,
      preferredModel: options.preferredModel,
      attempts: result.context.attempts,
      usedFallback: result.context.usedFallback,
      probingPreferred: result.context.probingPreferred,
    });
  }

  return {
    model: result.context.model,
    usedFallback: result.context.usedFallback,
    probingPreferred: result.context.probingPreferred,
    attempts: result.context.attempts,
    functionCalls: result.value.functionCalls,
    modelParts: result.value.modelParts,
  };
}
