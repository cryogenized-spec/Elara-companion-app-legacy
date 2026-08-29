import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bug, CheckCircle2, Copy, Loader2, X, XCircle } from 'lucide-react';
import type { ElaraSettings } from '../types';
import { getDbSettings, setDbSettings } from '../lib/db';
import { ModelSelector } from './ModelSelector';
import { runGeminiMinimalProbe, type GeminiMinimalProbeResult } from '../lib/geminiProbe';

export const ComposerModelSelectorBridge: React.FC = () => {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [settings, setSettings] = useState<ElaraSettings | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [probeBusy, setProbeBusy] = useState(false);
  const [probeResult, setProbeResult] = useState<GeminiMinimalProbeResult | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    let observer: MutationObserver | null = null;
    let mount: HTMLDivElement | null = null;
    const attach = () => {
      if (cancelled) return;
      const textarea = document.querySelector<HTMLTextAreaElement>('textarea[placeholder="Message Elara..."]');
      const footer = textarea?.closest('footer');
      if (!footer) { retryTimer = window.setTimeout(attach, 250); return; }
      mount = document.createElement('div');
      mount.className = 'absolute bottom-[max(1rem,env(safe-area-inset-bottom))] right-[7.75rem] z-20';
      mount.dataset.elaraModelSelectorMount = 'true';
      footer.appendChild(mount);
      setTarget(mount);
      const refresh = () => { if (!cancelled) setStreaming(Boolean(footer.querySelector('button[title="Stop generation"]'))); };
      refresh();
      observer = new MutationObserver(refresh);
      observer.observe(footer, { childList: true, subtree: true, attributes: true, attributeFilter: ['title', 'disabled'] });
    };
    attach();
    getDbSettings().then((loaded) => { if (!cancelled) setSettings(loaded); }).catch((error) => console.warn('Model selector settings load deferred:', error));
    return () => { cancelled = true; if (retryTimer) window.clearTimeout(retryTimer); observer?.disconnect(); if (mount?.parentNode) mount.parentNode.removeChild(mount); mount = null; setTarget(null); };
  }, []);

  const debugPayload = useMemo(() => probeResult ? JSON.stringify({
    phase: 'GEMINI_PHASE_2_MINIMAL_PROBE',
    result: probeResult.ok ? 'SUCCESS' : 'FAILURE',
    model: probeResult.model,
    latency_ms: probeResult.latencyMs,
    failure_stage: probeResult.failureStage ?? null,
    provider_error: probeResult.error ? { classified_code: probeResult.error.code, http_status: probeResult.error.httpStatus ?? null, message: probeResult.error.message, raw_provider_message: probeResult.error.rawMessage } : null,
    request_shape: probeResult.requestShape,
  }, null, 2) : '', [probeResult]);

  if (!target || !settings) return null;

  const runProbe = async () => {
    if (probeBusy || streaming) return;
    setProbeBusy(true); setProbeResult(null); setCopied(false);
    try {
      const current = await getDbSettings();
      const result = await runGeminiMinimalProbe(current.apiKey || '', current.model || settings.model || 'gemini-3.7-flash');
      setSettings(current); setProbeResult(result); setShowDetails(!result.ok);
    } finally { setProbeBusy(false); }
  };

  const copyDebug = async () => {
    if (!debugPayload) return;
    try { await navigator.clipboard.writeText(debugPayload); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); }
  };

  return createPortal(
    <>
      <div className="flex items-center gap-1.5">
        <ModelSelector settings={settings} disabled={streaming || probeBusy} onUpdateSettings={(patch) => {
          if (streaming || probeBusy) return;
          const next = { ...settings, ...patch };
          setSettings(next);
          void setDbSettings(next).then(() => window.location.reload());
        }} />
        <button type="button" disabled={streaming || probeBusy} onClick={() => void runProbe()} title="Test Gemini Connection" aria-label="Test Gemini Connection" className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-950/90 px-2.5 text-[10px] font-semibold text-zinc-400 shadow-lg backdrop-blur-sm transition hover:border-amber-600/60 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50">
          {probeBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bug className="h-3.5 w-3.5" />}
          <span>Test</span>
        </button>
      </div>
      {probeResult && <div className="fixed bottom-[5.25rem] right-3 z-[180] w-[min(94vw,620px)] rounded-2xl border border-zinc-700 bg-zinc-950/98 p-4 text-zinc-200 shadow-2xl backdrop-blur-xl sm:right-5">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2">{probeResult.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-red-400" />}<h3 className="text-sm font-semibold">{probeResult.ok ? 'Gemini connection OK' : 'Gemini connection failed'}</h3></div><p className="mt-1 text-[11px] text-zinc-500">Minimal Phase 2 probe · {probeResult.model} · {probeResult.latencyMs} ms · {probeResult.failureStage || 'stream completed'}</p></div><button type="button" onClick={() => setProbeResult(null)} className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200" aria-label="Close result"><X className="h-4 w-4" /></button></div>
        {!probeResult.ok && <div className="mt-3 rounded-xl border border-red-900/50 bg-red-950/20 p-3 text-[11px]"><p className="font-semibold text-red-300">Provider error</p><p className="mt-1 text-zinc-300">Code: <span className="font-mono">{probeResult.error?.code || 'unknown'}</span></p><p className="text-zinc-300">HTTP: <span className="font-mono">{probeResult.error?.httpStatus ?? 'unknown'}</span></p><p className="mt-1 break-words text-zinc-400">{probeResult.error?.rawMessage || probeResult.error?.message || 'No provider error message returned.'}</p></div>}
        {probeResult.ok && <p className="mt-3 rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-3 text-[11px] text-emerald-200">The minimal browser-side Gemini request succeeded. The next investigation should focus on the Elara request envelope.</p>}
        <div className="mt-3 flex gap-2"><button type="button" onClick={() => setShowDetails((open) => !open)} className="rounded-lg border border-zinc-700 px-3 py-2 text-[11px] font-semibold text-zinc-300 hover:border-zinc-600 hover:text-white">{showDetails ? 'Hide debug report' : 'Show full debug report'}</button>{debugPayload && <button type="button" onClick={() => void copyDebug()} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-[11px] font-semibold text-zinc-300 hover:border-zinc-600 hover:text-white"><Copy className="h-3.5 w-3.5" />{copied ? 'Copied' : 'Copy debug report'}</button>}</div>
        {showDetails && <pre className="mt-3 max-h-80 overflow-auto rounded-xl border border-zinc-800 bg-black/40 p-3 text-[10px] leading-relaxed text-zinc-300 whitespace-pre-wrap break-words">{debugPayload}</pre>}
      </div>}
    </>, target);
};
