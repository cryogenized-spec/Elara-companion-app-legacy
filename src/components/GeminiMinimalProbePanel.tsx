import React, { useState } from 'react';
import { CheckCircle2, ChevronDown, Loader2, ShieldAlert, X } from 'lucide-react';
import { getDbSettings } from '../lib/db';
import { runGeminiMinimalProbe, type GeminiMinimalProbeResult } from '../lib/geminiProbe';
import { AVAILABLE_MODELS } from '../types';

const labelForModel = (id: string) => AVAILABLE_MODELS.find((model) => model.id === id)?.name || id;

export const GeminiMinimalProbePanel: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GeminiMinimalProbeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runProbe = async () => {
    setBusy(true);
    setError(null);
    try {
      const settings = await getDbSettings();
      setResult(await runGeminiMinimalProbe(settings.apiKey || '', settings.model || 'gemini-3.7-flash'));
      setOpen(true);
    } catch (probeError) {
      setError(probeError instanceof Error ? probeError.message : 'Unable to run the Gemini connection test.');
      setOpen(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); void runProbe(); }}
        disabled={busy}
        className="fixed bottom-4 right-4 z-[160] inline-flex min-h-9 items-center gap-2 rounded-full border border-amber-700/50 bg-zinc-950/95 px-3.5 text-[11px] font-semibold text-zinc-200 shadow-2xl backdrop-blur-xl hover:border-amber-500/60 hover:text-white disabled:opacity-60"
        title="Test the Gemini connection using your saved API key"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" /> : <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />}
        Test Gemini Connection
      </button>

      {open && (
        <div className="fixed inset-0 z-[170] flex items-end justify-center bg-black/55 p-3 sm:items-center sm:p-6">
          <section className="w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-700 bg-[#111113] shadow-2xl">
            <header className="flex items-start justify-between gap-4 border-b border-zinc-800 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Gemini connection test</h2>
                <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">This sends one minimal “hello” request using the API key already saved in Elara. Nothing else from the chat is sent.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Close Gemini connection test"><X className="h-4 w-4" /></button>
            </header>

            <div className="p-4">
              {error && <div className="rounded-xl border border-red-900/70 bg-red-950/30 p-3 text-xs text-red-200">{error}</div>}

              {!result && !error && !busy && <button type="button" onClick={() => void runProbe()} className="w-full rounded-lg bg-amber-600 px-3 py-2.5 text-xs font-semibold text-white hover:bg-amber-500">Test Gemini Connection</button>}

              {busy && <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" />Running the minimal request…</div>}

              {result && (
                <div className="space-y-3 text-[11px]">
                  <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
                    <div className="flex items-center gap-2">
                      {result.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <ShieldAlert className="h-4 w-4 text-red-400" />}
                      <span className={result.ok ? 'font-semibold text-emerald-300' : 'font-semibold text-red-300'}>{result.ok ? 'PASS' : 'FAIL'}</span>
                    </div>
                    <span className="text-zinc-500">{result.latencyMs} ms</span>
                  </div>

                  <div className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
                    <span className="text-zinc-600">Model</span><span className="font-medium text-zinc-200">{labelForModel(result.model)}</span>
                    <span className="text-zinc-600">Request</span><span className="text-zinc-300">1 user message: hello</span>
                    <span className="text-zinc-600">Config</span><span className="text-zinc-300">No system prompt · no tools · no thinking · no safety overrides</span>
                    <span className="text-zinc-600">Stage</span><span className="text-zinc-300">{result.ok ? 'stream completed' : result.failureStage || 'unknown'}</span>
                  </div>

                  {result.ok ? (
                    <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-3 text-zinc-200">Gemini responded: <span className="font-medium">{result.responseText || '(empty response)'}</span></div>
                  ) : (
                    <div className="space-y-2 rounded-xl border border-red-900/60 bg-red-950/20 p-3 text-zinc-300">
                      <div className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2">
                        <span className="text-zinc-600">Error code</span><span className="font-mono">{result.error?.code || 'unknown'}</span>
                        <span className="text-zinc-600">HTTP status</span><span className="font-mono">{result.error?.httpStatus ?? 'unknown'}</span>
                        <span className="text-zinc-600">Provider message</span><span className="break-words">{result.error?.rawMessage || '(none returned)'}</span>
                      </div>
                    </div>
                  )}

                  <p className="text-[10px] leading-relaxed text-zinc-600">The test does not modify model preference, fallback policy, Google authorization, or conversation data.</p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
};
