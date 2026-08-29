import { GoogleGenAI } from '@google/genai';
import { classifyApiError, type ClassifiedApiError } from './apiError';
import { normalizeModel } from './chatRuntime';

export interface GeminiMinimalProbeResult {
  ok: boolean;
  model: string;
  latencyMs: number;
  responseText?: string;
  error?: ClassifiedApiError;
  requestShape: {
    contentsCount: number;
    configKeys: string[];
    hasSystemInstruction: boolean;
    hasSafetySettings: boolean;
    hasThinkingConfig: boolean;
    hasTools: boolean;
  };
}

export interface GeminiGenerateStreamClient {
  models: {
    generateContentStream(request: {
      model: string;
      contents: Array<{ role: 'user'; parts: Array<{ text: string }> }>;
      config: Record<string, never>;
    }): Promise<AsyncIterable<{ text?: string }>>;
  };
}

/**
 * Phase 2 forensic probe. This deliberately bypasses Elara's routing, tools,
 * thinking configuration, workspace context, and history. It answers one
 * question: can this API key make the smallest possible Gemini request from
 * the browser environment?
 */
export async function runGeminiMinimalProbe(
  apiKey: string,
  model: string,
  clientFactory: (key: string) => GeminiGenerateStreamClient = (key) => new GoogleGenAI({ apiKey: key }) as unknown as GeminiGenerateStreamClient,
): Promise<GeminiMinimalProbeResult> {
  const preferredModel = normalizeModel(model);
  const config: Record<string, never> = {};
  const requestShape = {
    contentsCount: 1,
    configKeys: [],
    hasSystemInstruction: false,
    hasSafetySettings: false,
    hasThinkingConfig: false,
    hasTools: false,
  } as const;

  const startedAt = Date.now();
  try {
    if (!apiKey || !apiKey.trim()) throw new Error('No Gemini API key is configured.');
    const ai = clientFactory(apiKey.trim());
    const response = await ai.models.generateContentStream({
      model: preferredModel,
      contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
      config,
    });

    let text = '';
    for await (const chunk of response) {
      if (chunk.text) text += chunk.text;
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
      requestShape,
    };
  }
}
