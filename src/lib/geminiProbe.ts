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

/**
 * Phase 2 forensic probe. This deliberately bypasses Elara's routing, tools,
 * thinking configuration, workspace context, and history. It is intended to
 * answer one question: can this API key successfully make the smallest
 * possible Gemini request from the browser environment?
 */
export async function runGeminiMinimalProbe(apiKey: string, model: string): Promise<GeminiMinimalProbeResult> {
  const preferredModel = normalizeModel(model);
  const config = {};
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
    const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
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
