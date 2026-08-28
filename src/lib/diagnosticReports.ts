import { del, get, set } from 'idb-keyval';
import type { ElaraSettings } from '../types';
import { buildDiagnosticsSnapshot, type RoutingEvent, type RoutingAnalysisReport } from './routingDiagnostics';

export const DIAGNOSTIC_REPORTS_KEY = 'elara_model_diagnostic_reports_v1';
export const DIAGNOSTIC_REPORTS_SCHEMA_VERSION = 1;
export const DIAGNOSTIC_REPORT_TYPE = 'model-routing-analysis';

export interface DiagnosticSourceSnapshot {
  snapshotId: string;
  schemaVersion: number;
  capturedAt: number;
  period: RoutingAnalysisReport['period'];
  events: RoutingEvent[];
  modelHealth: ReturnType<typeof buildDiagnosticsSnapshot>['modelHealth'];
  preferenceOrder: string[];
  fallbackRules: string[];
}

export interface DiagnosticReportRecord {
  reportId: string;
  title: string;
  reportMarkdown: string;
  writtenByModelId: string;
  writtenByDisplayName: string;
  generatedAt: number;
  timezone: string;
  analysisPeriod: RoutingAnalysisReport['period'];
  modelsAnalysed: string[];
  reportType: string;
  sourceSnapshotId: string;
  onlineResearchPerformed: boolean;
  sourceSnapshot: DiagnosticSourceSnapshot;
  archived: boolean;
}

function normalizeReport(value: unknown): DiagnosticReportRecord | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<DiagnosticReportRecord>;
  if (typeof raw.reportId !== 'string' || typeof raw.title !== 'string' || typeof raw.reportMarkdown !== 'string') return null;
  if (typeof raw.writtenByModelId !== 'string' || typeof raw.writtenByDisplayName !== 'string') return null;
  if (typeof raw.generatedAt !== 'number' || typeof raw.timezone !== 'string') return null;
  if (!raw.analysisPeriod || typeof raw.analysisPeriod !== 'object') return null;
  if (!Array.isArray(raw.modelsAnalysed) || !raw.sourceSnapshot || typeof raw.sourceSnapshot !== 'object') return null;
  return {
    reportId: raw.reportId,
    title: raw.title,
    reportMarkdown: raw.reportMarkdown,
    writtenByModelId: raw.writtenByModelId,
    writtenByDisplayName: raw.writtenByDisplayName,
    generatedAt: raw.generatedAt,
    timezone: raw.timezone,
    analysisPeriod: raw.analysisPeriod,
    modelsAnalysed: raw.modelsAnalysed,
    reportType: raw.reportType || DIAGNOSTIC_REPORT_TYPE,
    sourceSnapshotId: raw.sourceSnapshotId || '',
    onlineResearchPerformed: Boolean(raw.onlineResearchPerformed),
    sourceSnapshot: raw.sourceSnapshot as DiagnosticSourceSnapshot,
    archived: raw.archived !== false,
  };
}

export async function loadDiagnosticReports(): Promise<DiagnosticReportRecord[]> {
  try {
    const raw = await get(DIAGNOSTIC_REPORTS_KEY);
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeReport).filter(Boolean) as DiagnosticReportRecord[];
  } catch {
    return [];
  }
}

async function persistReports(reports: DiagnosticReportRecord[]): Promise<void> {
  await set(DIAGNOSTIC_REPORTS_KEY, reports);
}

export async function saveDiagnosticReport(report: DiagnosticReportRecord): Promise<void> {
  const existing = await loadDiagnosticReports();
  const deduped = existing.filter((item) => item.reportId !== report.reportId);
  await persistReports([report, ...deduped]);
}

export async function archiveDiagnosticReport(reportId: string): Promise<void> {
  const reports = await loadDiagnosticReports();
  const target = reports.find((report) => report.reportId === reportId);
  if (!target) return;
  target.archived = true;
  await persistReports(reports);
}

export async function deleteDiagnosticReport(reportId: string): Promise<void> {
  const reports = await loadDiagnosticReports();
  await persistReports(reports.filter((report) => report.reportId !== reportId));
}

export async function clearDiagnosticReports(): Promise<void> {
  await del(DIAGNOSTIC_REPORTS_KEY);
}

export function createDiagnosticSourceSnapshot(args: {
  analysis: RoutingAnalysisReport;
  events: RoutingEvent[];
  settings: ElaraSettings;
  fallbackRules: string[];
  capturedAt?: number;
}): DiagnosticSourceSnapshot {
  const capturedAt = args.capturedAt ?? Date.now();
  const snapshotId = `diag_snapshot_${capturedAt}_${Math.random().toString(36).slice(2, 8)}`;
  const snapshot = buildDiagnosticsSnapshot(args.events);
  const preferenceOrder = [args.settings.model, ...(args.settings.reliabilitySettings?.fallbackModels || [])]
    .map((model) => model.trim())
    .filter(Boolean)
    .filter((model, index, list) => list.findIndex((item) => item.toLowerCase() === model.toLowerCase()) === index);
  return {
    snapshotId,
    schemaVersion: DIAGNOSTIC_REPORTS_SCHEMA_VERSION,
    capturedAt,
    period: args.analysis.period,
    events: snapshot.events,
    modelHealth: snapshot.modelHealth,
    preferenceOrder,
    fallbackRules: args.fallbackRules,
  };
}

export function createDiagnosticReportId(now = Date.now()): string {
  return `diag_report_${now}_${Math.random().toString(36).slice(2, 8)}`;
}
