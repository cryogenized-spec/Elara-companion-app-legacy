import React, { useMemo, useState } from 'react';
import { Bug, CheckCircle2, Copy, Loader2, X, XCircle } from 'lucide-react';
import type { ElaraSettings } from '../types';
import { getDbSettings } from '../lib/db';
import { runGeminiMinimalProbe, type GeminiMinimalProbeResult } from '../lib/geminiProbe';

interface GeminiConnectionTesterProps {
  settings: ElaraSettings;
  disabled?: boolean;
}

export const GeminiConnectionTester: React.FC<GeminiConnectionTesterProps> = ({ settings, disabled = false }) => {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GeminiMinimalProbeResult | null>(null);
  const [copied, setCopied] = useState(false);

  const debugPayload = useMemo(() => {
    if (!result) return '';
    return JSON.stringify({
      phase: 'GEMINI_PHASE_2_MINIMAL_PROBE',
      result: result.ok ? 'SUCCESS' : 'FAILURE',
      model: result.model,
      latency_ms: result.latencyMs,
      failure_stage: result.failureStage ?? null,
      provider_error: result.error
        ? {
            classified_code: result.error.code,
            http_status: result.error.httpStatus ?? null,
            message: result.error.message,
            raw_provider_message: result.error.rawMessage,
          }
        : null,
      request_shape: result.requestShape,
      app_context: {
        page_origin: window.location.origin,
        page_path: window.location.pathname,
        user_agent: navigator.userAgent,
        online: navigator.onLine,
        configured_model: settings.model,
        api_key_present: Boolean(settings.apiKey?.trim()),
      },
    }, null, 2);
  }, [result, settings.apiKey, settings.model]);

  const runTest = async () => {
    if (busy || disabled) return;
    setBusy(true);
    setCopied(false);
    try {
      const current = await getDbSettings();
      const selectedModel = current.model || settings.model || 'gemini-3.7-flash';
      setResult(await runGeminiMinimalProbe(current.apiKey || '', selectedModel));
    } catch (error) {
      setResult({
        ok: false,
        model: settings.model || 'gemini-3.7-flash',
        latencyMs: 0,
        failureStage: 'before-stream',
        error: {
          code: 'PROBE_EXECUTION_ERROR',
          message: error instanceof Error ? error.message : 'The probe failed before it could execute.',
          rawMessage: error instanceof Error ? error.message : String(error),
          httpStatus: undefined,
          retryable: false,
          failoverOverride: false,
        },
        requestShape: {
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
        },
      });
    } finally {
      setBusy(false);
    }
  };

  const copyDebug = async () => {
    if (!debugPayload) return;
    try {
      await navigator.clipboard.writeText(debugPayload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={busy || disabled}
        onClick={() => void runTest()}
        title="Test Gemini connection"
        aria-label="Test Gemini connection"
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-950/90 px-2.5 text-[10px] font-semibold text-zinc-400 shadow-lg transition hover:border-amber-600/60 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bug className="h-3.5 w-3.5" />}
        <span>Test</span>
      </button>

      {result && (
        <div className="fixed bottom-[5.5rem] left-3 right-3 z-[200] max-h-[70vh] overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950/98 p-4 text-zinc-200 shadow-2xl backdrop-blur-xl sm:left-auto sm:right-5 sm:w-[min(92vw,720px)]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {result.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-red-400" />}
                <h3 className="text-sm font-semibold">{result.ok ? 'Gemini minimal request succeeded' : 'Gemini minimal request failed'}</h3>
              </div>
              <p className="mt-1 text-[11px] text-zinc-500">
                model={result.model} · latency_ms={result.latencyMs} · stage={result.failureStage || 'completed'}
              </p>
            </div>
            <button type="button" onClick={() => setResult(null)} className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200" aria-label="Close Gemini test result">
              <X className="h-4 w-4" />
            </button>
          </div>

          {!result.ok && (
            <div className="mt-3 rounded-xl border border-red-900/50 bg-red-950/20 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-red-300">Provider failure</p>
              <div className="mt-2 space-y-1 font-mono text-[11px] leading-relaxed text-zinc-300">
                <div>classified_code: {result.error?.code || 'unknown'}</div>
                <div>http_status: {result.error?.httpStatus ?? 'null'}</div>
                <div>failure_stage: {result.failureStage || 'unknown'}</div>
                <div className="break-words whitespace-pre-wrap">provider_message: {result.error?.rawMessage || result.error?.message || 'none'}</div>
              </div>
            </div>
          )}

          {result.ok && <div className="mt-3 rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-3 text-[11px] text-emerald-200">The browser can reach Gemini with the current key and selected model using the minimal request. The next diagnostic target is Elara request construction.</div>}

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => void copyDebug()} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-[11px] font-semibold text-zinc-300 hover:border-zinc-600 hover:text-white">
              <Copy className="h-3.5 w-3.5" /> {copied ? 'Copied' : 'Copy full debug report'}
            </button>
          </div>

          <pre className="mt-3 max-h-[40vh] overflow-auto rounded-xl border border-zinc-800 bg-black/40 p-3 text-[10px] leading-relaxed text-zinc-300 whitespace-pre-wrap break-words">
            {debugPayload}
          </pre>
        </div>
      )}
    </>
  );
};
