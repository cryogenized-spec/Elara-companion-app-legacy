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

function fingerprintConfig(config: any): Record<string, unknown> {
  return {
    configKeys: config && typeof config === 'object' ? Object.keys(config).sort() : [],
    hasSystemInstruction: Boolean(config?.systemInstruction),
    systemInstructionLength: typeof config?.systemInstruction === 'string' ? config.systemInstruction.length : 0,
    safetySettingsCount: Array.isArray(config?.safetySettings) ? config.safetySettings.length : 0,
    hasThinkingConfig: Boolean(config?.thinkingConfig),
    thinkingConfigKeys: config?.thinkingConfig && typeof config.thinkingConfig === 'object' ? Object.keys(config.thinkingConfig).sort() : [],
    hasTools: Array.isArray(config?.tools),
    toolDeclarationCount: Array.isArray(config?.tools)
      ? config.tools.reduce((total: number, tool: any) => total + (Array.isArray(tool?.functionDeclarations) ? tool.functionDeclarations.length : 0), 0)
      : 0,
    maxOutputTokens: typeof config?.maxOutputTokens === 'number' ? config.maxOutputTokens : null,
    hasTemperature: typeof config?.temperature === 'number',
    hasTopP: typeof config?.topP === 'number',
    hasTopK: typeof config?.topK === 'number',
  };
}

function emitGeminiForensics(stage: string, model: string, contents: any[], config: any, error?: unknown): void {
  const classified = error ? classifyApiError(error, model) : undefined;
  console.error(`[Gemini forensic] ${stage}`, {
    model,
    contentCount: Array.isArray(contents) ? contents.length : 0,
    contentRoles: Array.isArray(contents) ? contents.map((item: any) => item?.role || 'unknown') : [],
    ...fingerprintConfig(config),
    ...(classified
      ? {
          errorCode: classified.code,
          httpStatus: classified.httpStatus ?? null,
          rawMessage: classified.rawMessage,
        }
      : {}),
  });
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
      const requestConfig = options.buildConfig(model);

      emitGeminiForensics('request', model, options.contents, requestConfig);

      let responseStream: any;
      try {
        responseStream = await options.ai.models.generateContentStream({
          model,
          contents: options.contents,
          config: requestConfig,
        });
      } catch (error) {
        emitGeminiForensics('request-failed-before-stream', model, options.contents, requestConfig, error);
        throw error;
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
        emitGeminiForensics('stream-failed-after-start', model, options.contents, requestConfig, error);
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