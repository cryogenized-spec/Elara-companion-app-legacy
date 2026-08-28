import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { classifyApiError } from "../../src/lib/apiError";
import { serverLockbox } from "./lockbox";

export { HarmCategory, HarmBlockThreshold };

export function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) return null;
  return { mimeType: matches[1], data: matches[2] };
}

export function getGeminiClient() {
  const apiKey = serverLockbox.requiredSecret('GEMINI_API_KEY');
  return new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
}

export function formatApiErrorDetails(err: any, modelId: string): {
  code?: number | string;
  status?: string;
  message: string;
  modelId: string;
  errorId?: string;
  retryable?: boolean;
  retryAfterMs?: number;
} {
  const classified = classifyApiError(err, modelId);
  return {
    code: classified.httpStatus || classified.code,
    status: classified.code,
    modelId,
    message: `⚠️ ${classified.message} [${classified.code}]`,
    errorId: classified.code,
    retryable: classified.retryable,
    retryAfterMs: classified.retryAfterMs,
  };
}

export function normalizeModelName(rawModel?: string): string {
  const configuredModel = serverLockbox.config('GEMINI_MODEL', 'gemini-3.7-flash');
  if (!rawModel || typeof rawModel !== 'string') rawModel = configuredModel;
  let clean = rawModel.trim().replace(/^["'`]|["'`]$/g, '').trim();
  clean = clean.replace(/^(\/?models\/)+/gi, '').trim();

  const aliasMap: Record<string, string> = {
    'gemini-3.1-pro': 'gemini-3.1-pro-preview',
    'gemini-3-flash': 'gemini-3-flash-preview',
    'gemini-pro-latest': 'gemini-3.1-pro-preview',
    'gemini-flash-latest': 'gemini-3.7-flash',
    'gemini-flash-lite-latest': 'gemini-3.5-flash-lite',
  };

  clean = aliasMap[clean] || clean;
  clean = clean.replace(/[^a-zA-Z0-9.\-_]/g, '');
  return clean || 'gemini-3.7-flash';
}
