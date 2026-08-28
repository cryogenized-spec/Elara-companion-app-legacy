# Pass 28 — Adaptive Routing Readiness & Final Proving

**COMPLETE — VERIFIED**

Passes 20–27 are integrated around one canonical model preference/reliability boundary, one deterministic resilience engine, structured routing telemetry, and a dedicated diagnostics report archive.

Pass 20 — **COMPLETE — VERIFIED**: canonical selected model and persisted ordered fallback list; fallback does not rewrite user preference; Gemini 3.5 compatibility retained.

Pass 21 — **COMPLETE — VERIFIED**: model selector is mounted in the real chat composer, uses the canonical settings state, opens upward, supports Escape/outside-click, preserves unavailable configured models, and disables during active generation.

Pass 22 — **COMPLETE — VERIFIED**: fallback order is explicit and reorderable with ordinal positions; the runtime consumes the same persisted order.

Pass 23 — **COMPLETE — VERIFIED**: classification, retry and failover are separate; route changes descend the configured order; auth, permission, invalid request, safety and cancellation do not silently fail over; unknown errors require explicit opt-in.

Pass 24 — **COMPLETE — VERIFIED**: advanced fallback controls and developer diagnostics are opt-in and observe canonical routing events.

Pass 25 — **COMPLETE — VERIFIED**: structured persistent telemetry, bounded retention at 5,000 events, derived model health, machine-readable timestamps and request/session identity.

Pass 26 — **COMPLETE — VERIFIED**: on-demand analysis supports standard and custom periods and separates Observed, Inferred, External Evidence and Recommendation; online research is explicit.

Pass 27 — **COMPLETE — VERIFIED**: application-generated report authorship metadata, separate analysed-model metadata, retained source snapshots and dedicated Model Diagnostics / Reports archive.

Pass 28 — **COMPLETE — VERIFIED**: canonical resilience emits request/retry/error/success/cooldown/fallback/recovery events; deterministic proof covers success, retry, 429/5xx fallback, third-tier routing, no-fallback classes, unknown-error policy, recovery, telemetry reconstruction and secret exclusion; browser proving covers desktop/mobile model-selector geometry and upward-menu behaviour; production verification is present.

## Adaptive routing safety

**COMPLETE — VERIFIED**: no autonomous adaptive routing is enabled. Diagnostics may recommend a routing change, but no recommendation is applied without explicit user approval and no preference hierarchy is silently rewritten.

## Final audit

Duplicate model selectors — **COMPLETE — VERIFIED**

Duplicate reliability state — **COMPLETE — VERIFIED**

Duplicate fallback engines — **COMPLETE — VERIFIED**

Direct provider logic in UI — **COMPLETE — VERIFIED**

Secrets in diagnostics — **COMPLETE — VERIFIED**

Unbounded telemetry growth — **COMPLETE — VERIFIED**

Reports without author metadata — **COMPLETE — VERIFIED**

Automatic preference mutation — **COMPLETE — VERIFIED**

Fallback paths bypassing canonical policy — **COMPLETE — VERIFIED**

## Verification surface

The repository contains explicit `npm test`, `npm run lint`, `npm run build`, `npm run verify:production`, `npm run verify:browser`, and background-runtime typecheck coverage. Browser proving uses Chromium against a production build.
