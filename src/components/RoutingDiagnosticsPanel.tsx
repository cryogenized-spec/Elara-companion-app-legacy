import React, { useMemo, useState } from 'react';
import { Activity, Archive, BarChart3, CalendarRange, ChevronDown, ExternalLink, RefreshCw, X } from 'lucide-react';
import { AVAILABLE_MODELS, type ElaraSettings } from '../types';
import { analyzeSavedRoutingDiagnostics, buildDiagnosticsSnapshot, buildRoutingPreference, describeFallbackRules, loadRoutingDiagnostics, resolveAnalysisPeriod, type AnalysisWindow, type ExternalEvidence, type RoutingAnalysisReport } from '../lib/routingDiagnostics';
import { createDiagnosticReportId, createDiagnosticSourceSnapshot, saveDiagnosticReport } from '../lib/diagnosticReports';
import { getDbSettings } from '../lib/db';

const MODEL_LABELS = Object.fromEntries(AVAILABLE_MODELS.map((model) => [model.id, model.name]));
const label = (model: string) => MODEL_LABELS[model] || model;
const formatTimestamp = (timestamp: number, timezone: string) => { try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium', timeZone: timezone }).format(new Date(timestamp)); } catch { return new Date(timestamp).toLocaleString(); } };

export const RoutingDiagnosticsPanel: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [windowName, setWindowName] = useState<AnalysisWindow>('last-hour');
  const [report, setReport] = useState<RoutingAnalysisReport | null>(null);
  const [settings, setSettings] = useState<ElaraSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(false);
  const [onlineEvidence, setOnlineEvidence] = useState<ExternalEvidence[]>([]);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const preference = useMemo(() => (settings ? buildRoutingPreference(settings) : []), [settings]);

  const runAnalysis = async () => {
    setBusy(true); setError(null); setSavedNotice(null);
    try {
      const nextSettings = await getDbSettings();
      let evidence = onlineEvidence;
      if (online) {
        try { const response = await fetch('/api/model-diagnostics/online'); const payload = await response.json(); evidence = [{ checkedAt: Date.now(), source: payload.source || 'Google Cloud status', ok: Boolean(payload.ok), summary: String(payload.summary || 'External provider status could not be summarized.') }]; setOnlineEvidence(evidence); }
        catch (onlineError) { evidence = [{ checkedAt: Date.now(), source: 'Google Cloud status', ok: false, summary: `Online status check failed: ${onlineError instanceof Error ? onlineError.message : 'unknown error'}` }]; setOnlineEvidence(evidence); }
      }
      const custom = windowName === 'custom' && customStart && customEnd ? { start: new Date(customStart).getTime(), end: new Date(customEnd).getTime() } : undefined;
      if (windowName === 'custom' && (!custom || !Number.isFinite(custom.start) || !Number.isFinite(custom.end) || custom.end < custom.start)) throw new Error('Choose a valid custom start and end time.');
      const nextReport = await analyzeSavedRoutingDiagnostics(nextSettings, windowName, custom, evidence);
      setSettings(nextSettings); setReport(nextReport);
    } catch (analysisError) { setError(analysisError instanceof Error ? analysisError.message : 'Unable to analyse model behaviour.'); }
    finally { setBusy(false); }
  };

  const archiveReport = async () => {
    if (!report || !settings) return;
    setSaveBusy(true); setSavedNotice(null); setError(null);
    try {
      const diagnostics = await loadRoutingDiagnostics();
      const custom = windowName === 'custom' && customStart && customEnd ? { start: new Date(customStart).getTime(), end: new Date(customEnd).getTime() } : undefined;
      const period = resolveAnalysisPeriod(windowName, report.period.timezone, Date.now(), custom);
      const filteredEvents = diagnostics.events.filter((event) => event.timestamp >= period.start && event.timestamp <= period.end).sort((a, b) => a.timestamp - b.timestamp);
      const sourceSnapshot = createDiagnosticSourceSnapshot({ analysis: report, events: filteredEvents, settings, fallbackRules: describeFallbackRules(settings.reliabilitySettings) });
      const writtenByModelId = settings.model;
      await saveDiagnosticReport({
        reportId: createDiagnosticReportId(),
        title: `Model Routing Analysis — ${report.period.label}`,
        reportMarkdown: [
          `## Model routing analysis`,
          ``,
          `Observed`,
          ...report.observed.map((item) => `- ${item}`),
          ``,
          `Inferred`,
          ...report.inferred.map((item) => `- ${item}`),
          ``,
          `External evidence`,
          ...(report.externalEvidence.length ? report.externalEvidence.map((item) => `- ${item.source}: ${item.summary}`) : ['- No online/provider-status research was selected.']),
          ``,
          `Recommendation`,
          ...report.recommendations.map((item) => `- ${item}`),
        ].join('\n'),
        writtenByModelId,
        writtenByDisplayName: label(writtenByModelId),
        generatedAt: Date.now(),
        timezone: report.period.timezone,
        analysisPeriod: report.period,
        modelsAnalysed: buildRoutingPreference(settings),
        reportType: 'model-routing-analysis',
        sourceSnapshotId: sourceSnapshot.snapshotId,
        onlineResearchPerformed: report.externalEvidence.length > 0,
        sourceSnapshot,
        archived: true,
      });
      setSavedNotice(`Saved to Model Diagnostics / Reports · Written by ${label(writtenByModelId)} ✦`);
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to archive this report.'); }
    finally { setSaveBusy(false); }
  };

  const openPanel = () => { setOpen(true); void runAnalysis(); };

  return <>
    <button type="button" onClick={openPanel} className="fixed bottom-4 left-4 z-[80] inline-flex min-h-9 items-center gap-2 rounded-full border border-zinc-700 bg-zinc-950/95 px-3.5 text-[11px] font-semibold text-zinc-300 shadow-2xl backdrop-blur-xl hover:border-sky-500/40 hover:text-white" title="Analyse recent model behaviour"><BarChart3 className="h-3.5 w-3.5 text-sky-400" /> Analyse</button>
    {open && <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/50 p-2 sm:items-center sm:p-6"><section className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-[#111113] shadow-2xl">
      <header className="flex items-start justify-between gap-4 border-b border-zinc-800 px-4 py-3 sm:px-5"><div><div className="flex items-center gap-2"><Activity className="h-4 w-4 text-sky-400" /><h2 className="text-sm font-semibold text-zinc-100">Model behaviour analysis</h2></div><p className="mt-1 text-[11px] leading-relaxed text-zinc-500">Analysis uses saved structured routing telemetry. Archiving assigns authorship from the application-selected model; the model does not self-report its identity.</p></div><button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Close diagnostics"><X className="h-4 w-4" /></button></header>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <aside className="shrink-0 overflow-y-auto border-b border-zinc-800 p-4 lg:w-72 lg:border-b-0 lg:border-r"><label className="block text-[11px] font-semibold text-zinc-300">Analysis period<span className="relative mt-1 block"><select value={windowName} onChange={(e) => setWindowName(e.target.value as AnalysisWindow)} className="w-full appearance-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 pr-8 text-xs text-zinc-200"><option value="last-hour">Last hour</option><option value="today">Today</option><option value="last-7-days">Last 7 days</option><option value="last-30-days">Last 30 days</option><option value="custom">Custom period</option></select><ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 h-3.5 w-3.5 text-zinc-500" /></span></label>
        {windowName === 'custom' && <div className="mt-3 space-y-2"><label className="block text-[10px] text-zinc-500">Start<input type="datetime-local" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-2 text-[11px] text-zinc-200" /></label><label className="block text-[10px] text-zinc-500">End<input type="datetime-local" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-2 text-[11px] text-zinc-200" /></label></div>}
        <label className="mt-4 flex items-start gap-2 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 cursor-pointer"><input type="checkbox" checked={online} onChange={(e) => setOnline(e.target.checked)} className="mt-0.5 accent-sky-500" /><span><span className="block text-[11px] font-medium text-zinc-200">Check online</span><span className="mt-0.5 block text-[10px] leading-relaxed text-zinc-600">Separately check provider-status information.</span></span></label>
        <button type="button" disabled={busy} onClick={() => void runAnalysis()} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />{busy ? 'Analysing…' : 'Analyse recent model behaviour'}</button>
        {report && <button type="button" disabled={saveBusy} onClick={() => void archiveReport()} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-200 hover:border-sky-500/50 disabled:opacity-50"><Archive className="h-3.5 w-3.5" />{saveBusy ? 'Saving…' : 'Save to Model Diagnostics / Reports'}</button>}
        {savedNotice && <p className="mt-2 text-[10px] leading-relaxed text-emerald-400">{savedNotice}</p>}
        {settings && <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3"><p className="text-[10px] uppercase tracking-wider text-zinc-600">Preference order</p><div className="mt-2 space-y-1.5">{preference.map((model, index) => <div key={`${model}-${index}`} className="flex items-center gap-2 text-[11px]"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 font-mono text-[10px] text-zinc-500">{index + 1}</span><span className="text-zinc-300">{label(model)}</span></div>)}</div><div className="mt-3 border-t border-zinc-800 pt-3"><p className="text-[10px] uppercase tracking-wider text-zinc-600">Active routing policy</p><div className="mt-2 space-y-1 text-[10px] text-zinc-500">{describeFallbackRules(settings.reliabilitySettings).map((item) => <p key={item}>{item}</p>)}</div></div></div>}
        </aside>
        <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">{error && <div className="mb-4 rounded-xl border border-amber-900/60 bg-amber-950/20 p-3 text-xs text-amber-200">{error}</div>}{report ? <><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3"><p className="text-[10px] uppercase tracking-wider text-zinc-600">Period</p><p className="mt-1 text-xs text-zinc-200">{report.period.label}</p><p className="mt-1 text-[10px] text-zinc-600">{report.period.timezone}</p></div><div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3"><p className="text-[10px] uppercase tracking-wider text-zinc-600">Events</p><p className="mt-1 text-lg font-semibold text-zinc-100">{report.eventCount}</p></div><div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3"><p className="text-[10px] uppercase tracking-wider text-zinc-600">External evidence</p><p className="mt-1 text-xs text-zinc-200">{report.externalEvidence.length ? 'Checked' : 'Not checked'}</p></div></div><section className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/30 p-4"><h3 className="text-xs font-semibold text-zinc-100">Observed</h3><div className="mt-2 space-y-2">{report.observed.map((item) => <p key={item} className="text-[12px] leading-relaxed text-zinc-300">{item}</p>)}</div></section><section className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/30 p-4"><h3 className="text-xs font-semibold text-zinc-100">Inferred</h3><div className="mt-2 space-y-2">{report.inferred.map((item) => <p key={item} className="text-[12px] leading-relaxed text-zinc-400">{item}</p>)}</div></section><section className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/30 p-4"><h3 className="text-xs font-semibold text-zinc-100">Model health</h3><div className="mt-3 overflow-x-auto"><table className="min-w-full text-left text-[11px]"><thead className="text-zinc-600"><tr><th className="pb-2 pr-4">Model</th><th className="pb-2 pr-4">State</th><th className="pb-2 pr-4">Successes</th><th className="pb-2 pr-4">Failures</th><th className="pb-2 pr-4">Fallbacks</th><th className="pb-2 pr-4">Avg latency</th></tr></thead><tbody>{report.modelHealth.map((item) => <tr key={item.model} className="border-t border-zinc-900"><td className="py-2 pr-4 text-zinc-300">{label(item.model)}</td><td className="py-2 pr-4 text-zinc-400">{item.state}</td><td className="py-2 pr-4 text-zinc-400">{item.successes}</td><td className="py-2 pr-4 text-zinc-400">{item.failures}</td><td className="py-2 pr-4 text-zinc-400">{item.fallbackCount}</td><td className="py-2 pr-4 text-zinc-400">{item.averageLatencyMs !== undefined ? `${item.averageLatencyMs} ms` : '—'}</td></tr>)}</tbody></table></div></section><section className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/30 p-4"><h3 className="text-xs font-semibold text-zinc-100">External evidence</h3><div className="mt-2 space-y-2">{report.externalEvidence.length ? report.externalEvidence.map((item) => <div key={`${item.source}-${item.checkedAt}`} className="rounded-lg border border-zinc-900 bg-zinc-950/40 p-2.5"><p className="text-[10px] text-zinc-500">{item.source} · {formatTimestamp(item.checkedAt, report.period.timezone)}</p><p className="mt-1 text-[11px] text-zinc-300">{item.summary}</p></div>) : <p className="text-[11px] text-zinc-600">No online/provider-status research was selected.</p>}</div></section><section className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/30 p-4"><h3 className="text-xs font-semibold text-zinc-100">Recommendation</h3><div className="mt-2 space-y-2">{report.recommendations.map((item) => <p key={item} className="text-[12px] leading-relaxed text-sky-200">{item}</p>)}</div><p className="mt-3 text-[10px] text-zinc-600">Recommendations are informational only. No routing configuration is changed.</p></section><div className="mt-4 inline-flex items-center gap-1 rounded-lg border border-zinc-900 px-2 py-1 text-[10px] text-zinc-600"><CalendarRange className="h-3 w-3" />{formatTimestamp(report.period.start, report.period.timezone)} → {formatTimestamp(report.period.end, report.period.timezone)}</div></> : <div className="flex min-h-64 items-center justify-center text-sm text-zinc-600">No report yet.</div>}</main>
      </div>
    </section></div>}
  </>;
};
