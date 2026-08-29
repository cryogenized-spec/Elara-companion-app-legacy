import { GoogleGenAI } from '@google/genai';
import { classifyApiError, type ClassifiedApiError } from './apiError';
import { normalizeModel } from './chatRuntime';

export interface GeminiMinimalProbeResult {
  ok: boolean;
  model: string;
  latencyMs: number;
  responseText?: string;
  error?: ClassifiedApiError;
  failureStage?: 'before-stream' | 'after-stream';
  requestShape: {
    contentsCount: number;
    contentRole: 'user';
    messageText: 'hello';
    configKeys: string[];
    hasSystemInstruction: boolean;
    hasSafetySettings: boolean;
    hasThinkingConfig: boolean;
    hasTools: boolean;
    hasHistory: boolean;
    hasWorkspace: boolean;
    hasGoogleOAuth: boolean;
    usesResilience: false;
  };
}

export interface GeminiGenerateStreamClient {
  models: {
    generateContentStream(request: {
      model: string;
      contents: Array<{ role: 'user'; parts: Array<{ text: 'hello' }> }>;
      config?: Record<string, never>;
    }): Promise<AsyncIterable<{ text?: string }>>;
  };
}

/**
 * Phase 2 forensic probe. This deliberately bypasses Elara's routing, tools,
 * thinking configuration, workspace context, OAuth, history and retry policy.
 * It answers one question: can this browser environment make the smallest
 * possible Gemini request with the already-configured API key?
 */
export async function runGeminiMinimalProbe(
  apiKey: string,
  model: string,
  clientFactory: (key: string) => GeminiGenerateStreamClient = (key) => new GoogleGenAI({ apiKey: key }) as unknown as GeminiGenerateStreamClient,
): Promise<GeminiMinimalProbeResult> {
  const preferredModel = normalizeModel(model);
  const config: Record<string, never> = {};
  const requestShape: GeminiMinimalProbeResult['requestShape'] = {
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
  };

  const startedAt = Date.now();
  let streamStarted = false;

  try {
    if (!apiKey || !apiKey.trim()) throw new Error('No Gemini API key is configured.');
    const ai = clientFactory(apiKey.trim());
    let response: AsyncIterable<{ text?: string }>;
    try {
      response = await ai.models.generateContentStream({
        model: preferredModel,
        contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
        config,
      });
    } catch (error) {
      return {
        ok: false,
        model: preferredModel,
        latencyMs: Date.now() - startedAt,
        error: classifyApiError(error, preferredModel),
        failureStage: 'before-stream',
        requestShape,
      };
    }

    streamStarted = true;
    let text = '';
    try {
      for await (const chunk of response) {
        if (chunk.text) text += chunk.text;
      }
    } catch (error) {
      return {
        ok: false,
        model: preferredModel,
        latencyMs: Date.now() - startedAt,
        error: classifyApiError(error, preferredModel),
        failureStage: streamStarted ? 'after-stream' : 'before-stream',
        requestShape,
      };
    }

    return {
      ok: true,
      model: preferredModel,
      latencyMs: Date.now() - startedAt,
      responseText: text,
      requestShape,
    };
  } catch (error) {
    return {
      ok: false,
      model: preferredModel,
      latencyMs: Date.now() - startedAt,
      error: classifyApiError(error, preferredModel),
      failureStage: streamStarted ? 'after-stream' : 'before-stream',
      requestShape,
    };
  }
}
