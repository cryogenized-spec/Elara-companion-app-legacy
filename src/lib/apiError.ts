export type ElaraApiErrorCode =
  | 'API_RATE_LIMIT_RPM_429'
  | 'API_QUOTA_DAILY_429'
  | 'API_AUTH_401'
  | 'API_FORBIDDEN_403'
  | 'MODEL_NOT_FOUND_404'
  | 'CONTEXT_LIMIT_400'
  | 'INVALID_REQUEST_400'
  | 'CONTENT_SAFETY_400'
  | 'REQUEST_TIMEOUT_408'
  | 'SERVER_ERROR_500'
  | 'BAD_GATEWAY_502'
  | 'SERVICE_UNAVAILABLE_503'
  | 'GATEWAY_TIMEOUT_504'
  | 'NETWORK_ERROR'
  | 'CLIENT_RUNTIME_ERROR'
  | 'UNKNOWN_API_ERROR';

export interface ClassifiedApiError {
  code: ElaraApiErrorCode;
  httpStatus?: number;
  modelId?: string;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
  rawMessage: string;
}

function extractHttpStatus(error: any): number | undefined {
  const candidates = [
    error?.status,
    error?.statusCode,
    error?.code,
    error?.response?.status,
    error?.response?.statusCode,
    error?.error?.code,
    error?.error?.status,
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value >= 100 && value <= 599) return value;
  }

  const message = String(error?.message || error || '');
  const match = message.match(/(?:HTTP\\s*)?(4\\d\\d|5\\d\\d)/i);
  return match ? Number(match[1]) : undefined;
}

function extractRawMessage(error: any): string {
  let raw = String(error?.message || error || 'Unknown API error');
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      const inner = parsed?.error || parsed;
      if (inner?.message) raw = String(inner.message);
    }
  } catch (_) {
    // Keep original message when it is not JSON.
  }
  return raw.replace(/\\s+/g, ' ').trim();
}

function retryAfterMs(error: any): number | undefined {
  const headerValue = error?.headers?.get?.('retry-after') || error?.response?.headers?.get?.('retry-after');
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 120000);
  return undefined;
}

export function classifyApiError(error: any, modelId?: string): ClassifiedApiError {
  const rawMessage = extractRawMessage(error);
  const lower = rawMessage.toLowerCase();
  const status = extractHttpStatus(error);

  if (error?.name === 'AbortError' || lower.includes('aborted by user') || lower.includes('aborterror')) {
    return { code: 'CLIENT_RUNTIME_ERROR', httpStatus: status, modelId, message: 'The request was cancelled.', retryable: false, rawMessage };
  }

  if (lower.includes('safety') || lower.includes('blocked by safety') || lower.includes('content policy')) {
    return { code: 'CONTENT_SAFETY_400', httpStatus: status || 400, modelId, message: 'The model stopped this response because of its content-safety controls. Nothing was lost; you can revise the request and try again.', retryable: false, rawMessage };
  }

  if (status === 401 || lower.includes('api key') && (lower.includes('invalid') || lower.includes('unauthorized'))) {
    return { code: 'API_AUTH_401', httpStatus: 401, modelId, message: 'Gemini rejected the API key. Check the key in Settings and try again.', retryable: false, rawMessage };
  }

  if (status === 403 || lower.includes('permission denied') || lower.includes('forbidden')) {
    return { code: 'API_FORBIDDEN_403', httpStatus: 403, modelId, message: `Gemini denied access to ${modelId ? `[${modelId}]` : 'this model'}. Check project permissions, billing, or model availability.`, retryable: false, rawMessage };
  }

  if (status === 404 || lower.includes('not found') || lower.includes('not_found') || lower.includes('model does not exist')) {
    return { code: 'MODEL_NOT_FOUND_404', httpStatus: 404, modelId, message: `The requested Gemini model ${modelId ? `[${modelId}] ` : ''}was not found or is not available to this project. Choose another active model in Settings.`, retryable: false, rawMessage };
  }

  if (status === 429 || lower.includes('resource_exhausted') || lower.includes('quota exceeded') || lower.includes('rate limit')) {
    const daily = /daily|per day|day quota|quota.*reset|limit.*reset/i.test(lower);
    return {
      code: daily ? 'API_QUOTA_DAILY_429' : 'API_RATE_LIMIT_RPM_429',
      httpStatus: 429,
      modelId,
      message: daily
        ? `Daily Gemini quota has been reached for ${modelId ? `[${modelId}]` : 'this model'}. This is a soft failure: your chat is intact; switch models or wait for the quota reset.`
        : `Gemini is rate-limiting requests for ${modelId ? `[${modelId}]` : 'this model'}. This is a soft failure; retrying after a short pause is safe.`,
      retryable: !daily,
      retryAfterMs: retryAfterMs(error) || 3000,
      rawMessage,
    };
  }

  if (status === 408 || lower.includes('request timeout') || lower.includes('timed out')) {
    return { code: 'REQUEST_TIMEOUT_408', httpStatus: 408, modelId, message: `Gemini did not complete the request in time${modelId ? ` for [${modelId}]` : ''}. Your conversation is safe; retry shortly.`, retryable: true, retryAfterMs: retryAfterMs(error) || 1000, rawMessage };
  }

  if (status === 503 || lower.includes('unavailable') || lower.includes('overloaded')) {
    return { code: 'SERVICE_UNAVAILABLE_503', httpStatus: 503, modelId, message: `Gemini is temporarily unavailable or overloaded for ${modelId ? `[${modelId}]` : 'this request'}. Your conversation is safe; retry shortly.`, retryable: true, retryAfterMs: retryAfterMs(error) || 5000, rawMessage };
  }

  if (status === 504 || lower.includes('deadline exceeded') || lower.includes('gateway timeout')) {
    return { code: 'GATEWAY_TIMEOUT_504', httpStatus: 504, modelId, message: 'Gemini took too long to respond. Your conversation is safe; retry when ready.', retryable: true, retryAfterMs: retryAfterMs(error) || 3000, rawMessage };
  }

  if (status === 502 || lower.includes('bad gateway')) {
    return { code: 'BAD_GATEWAY_502', httpStatus: 502, modelId, message: 'The gateway to Gemini failed temporarily. Your conversation is safe; retry shortly.', retryable: true, retryAfterMs: retryAfterMs(error) || 2000, rawMessage };
  }

  if (status === 500 || lower.includes('internal server error') || lower.includes('internal error')) {
    return { code: 'SERVER_ERROR_500', httpStatus: 500, modelId, message: 'Gemini returned a temporary server error. Your conversation is safe; retry shortly.', retryable: true, retryAfterMs: retryAfterMs(error) || 2000, rawMessage };
  }

  if (lower.includes('context') || lower.includes('token count') || lower.includes('maximum number of tokens') || lower.includes('too many tokens')) {
    return { code: 'CONTEXT_LIMIT_400', httpStatus: status || 400, modelId, message: `The request is too large for ${modelId ? `[${modelId}]` : 'the selected model'}. Reduce conversation history or document context, or choose a model with a larger supported context.`, retryable: false, rawMessage };
  }

  if (status === 400) {
    return { code: 'INVALID_REQUEST_400', httpStatus: 400, modelId, message: `Gemini rejected the request as invalid${modelId ? ` for [${modelId}]` : ''}. Check the selected model and its generation settings.`, retryable: false, rawMessage };
  }

  if (lower.includes('failed to fetch') || lower.includes('network') || lower.includes('connection')) {
    return { code: 'NETWORK_ERROR', modelId, message: 'The connection to Gemini failed. Your conversation is intact; check the network connection and retry.', retryable: true, retryAfterMs: 2000, rawMessage };
  }

  return { code: 'UNKNOWN_API_ERROR', httpStatus: status, modelId, message: `Gemini returned an unexpected error${modelId ? ` for [${modelId}]` : ''}. Your conversation is safe; retry or select another model.`, retryable: true, retryAfterMs: 2000, rawMessage };
}
