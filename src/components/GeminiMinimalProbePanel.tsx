import React, { useEffect, useState } from 'react';
import { getDbSettings } from '../lib/db';
import { runGeminiMinimalProbe, type GeminiMinimalProbeResult } from '../lib/geminiProbe';

export const GeminiMinimalProbePanel: React.FC = () => {
  const [enabled, setEnabled] = useState(false);
  const [model, setModel] = useState('gemini-3.7-flash');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GeminiMinimalProbeResult | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setEnabled(params.get('geminiProbe') === '1');
  }, []);

  if (!enabled) return null;

  const probe = async () => {
    setBusy(true);
    try {
      const settings = await getDbSettings();
      const selectedModel = settings.model || model;
      setModel(selectedModel);
      setResult(await runGeminiMinimalProbe(settings.apiKey || '', selectedModel));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="fixed bottom-4 right-4 z-[160] w-[min(92vw,420px)] rounded-2xl border border-amber-700/50 bg-zinc-950/95 p-4 text-zinc-200 shadow-2xl backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Gemini Phase 2 Probe</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">Minimal browser request: one “hello”, no history, tools, thinking, system prompt, or safety overrides.</p>
        </div>
        <button type="button" onClick={() => setEnabled(false)} className="text-xs text-zinc-500 hover:text-zinc-200" aria-label="Close Gemini probe">×</button>
      </div>
      <div className="mt-3 flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-xs">
        <span className="text-zinc-500">Model</span>
        <span className="font-medium text-zinc-200">{model}</span>
      </div>
      <button type="button" disabled={busy} onClick={() => void probe()} className="mt-3 w-full rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50">
        {busy ? 'Probing Gemini…' : 'Run minimal Gemini request'}
      </button>
      {result && (
        <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-[11px]">
          <div className="flex items-center justify-between"><span className="text-zinc-500">Result</span><span className={result.ok ? 'text-emerald-400' : 'text-red-400'}>{result.ok ? 'SUCCESS' : 'FAILED'}</span></div>
          <p className="mt-1 text-zinc-400">Latency: {result.latencyMs} ms</p>
          {result.ok ? (
            <p className="mt-2 break-words text-zinc-200">Response: {result.responseText || '(empty response)'}</p>
          ) : (
            <div className="mt-2 space-y-1 text-zinc-300">
              <p>Code: <span className="font-mono">{result.error?.code}</span></p>
              <p>HTTP: <span className="font-mono">{result.error?.httpStatus ?? 'unknown'}</span></p>
              <p className="break-words">Provider: {result.error?.rawMessage || '(no provider message)'}</p>
            </div>
          )}
        </div>
      )}
    </aside>
  );
};
