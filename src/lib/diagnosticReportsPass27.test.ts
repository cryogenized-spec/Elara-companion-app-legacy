import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS } from './storage';
import { createDiagnosticReportId, createDiagnosticSourceSnapshot, type DiagnosticReportRecord } from './diagnosticReports';

test('Pass 27 report metadata separates author model from analysed models', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    model: 'gemini-3.6-flash',
    reliabilitySettings: {
      ...DEFAULT_SETTINGS.reliabilitySettings!,
      fallbackModels: ['gemini-3.7-flash', 'gemini-3.5-flash'],
    },
  };
  const analysis = {
    period: { start: 100, end: 200, label: 'Test period', timezone: 'Africa/Johannesburg' },
    observed: ['One request was recorded.'], inferred: ['No strong inference.'], externalEvidence: [], recommendations: ['No change.'], eventCount: 1, modelHealth: [],
  };
  const snapshot = createDiagnosticSourceSnapshot({ analysis, events: [], settings, fallbackRules: ['Automatic failover: ON.'], capturedAt: 500 });
  const report: DiagnosticReportRecord = {
    reportId: createDiagnosticReportId(600), title: 'Model Routing Analysis — Test period', reportMarkdown: 'Observed\n- One request was recorded.',
    writtenByModelId: settings.model, writtenByDisplayName: 'Gemini 3.6 Flash', generatedAt: 600, timezone: 'Africa/Johannesburg',
    analysisPeriod: analysis.period, modelsAnalysed: snapshot.preferenceOrder, reportType: 'model-routing-analysis', sourceSnapshotId: snapshot.snapshotId,
    onlineResearchPerformed: false, sourceSnapshot: snapshot, archived: true,
  };
  assert.equal(report.writtenByModelId, 'gemini-3.6-flash');
  assert.deepEqual(report.modelsAnalysed, ['gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.5-flash']);
  assert.notEqual(report.writtenByModelId, report.modelsAnalysed[1]);
  assert.equal(report.sourceSnapshotId, snapshot.snapshotId);
  assert.equal(report.sourceSnapshot.events.length, 0);
});

test('source snapshot is immutable data captured alongside the report', () => {
  const settings = { ...DEFAULT_SETTINGS, model: 'gemini-3.7-flash' };
  const analysis = { period: { start: 10, end: 20, label: 'Test period', timezone: 'Africa/Johannesburg' }, observed: [], inferred: [], externalEvidence: [], recommendations: [], eventCount: 0, modelHealth: [] };
  const snapshot = createDiagnosticSourceSnapshot({ analysis, events: [], settings, fallbackRules: [] });
  assert.ok(snapshot.snapshotId.startsWith('diag_snapshot_'));
  assert.equal(snapshot.schemaVersion, 1);
  assert.ok(Array.isArray(snapshot.events));
  assert.ok(Array.isArray(snapshot.preferenceOrder));
});
