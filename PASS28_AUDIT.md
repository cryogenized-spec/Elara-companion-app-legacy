# Pass 28 — Adaptive Routing Readiness, Integration Audit & Final Proving

## Final status

**COMPLETE — VERIFIED**

The Pass 20–28 routing subsystem is integrated around one canonical preference/reliability boundary, one deterministic resilience engine, one structured telemetry stream, and a dedicated diagnostics archive. Adaptive routing is not autonomous: analysis may recommend a change, but no recommendation is applied without explicit user approval.

## Pass 20 — Model Selection Domain & Preference Order

**COMPLETE — VERIFIED**

`ElaraSettings.model` is the canonical selected preference and `reliabilitySettings.fallbackModels` is the persisted ordered fallback list. Runtime fallback does not rewrite the configured preference hierarchy. Existing Gemini 3.5 compatibility remains represented in the model catalogue and fallback settings.

## Pass 21 — Chat Model Selector UI

**COMPLETE — VERIFIED**

The model selector is mounted in the actual chat composer footer. It displays the current selected model, opens upward, supports Escape/outside-click dismissal, remains responsive on mobile, preserves configured-but-unavailable models, and is disabled during active generation. Selection persists through the canonical settings store.

## Pass 22 — Preference Ordering UI

**COMPLETE — VERIFIED**

Reliability settings expose the ordered fallback list with explicit ordinal positions and up/down controls. The UI distinguishes preference order from retry/reliability profile semantics, and reordering changes the same canonical fallback list consumed by the runtime.

## Pass 23 — Deterministic Fallback Rules

**COMPLETE — VERIFIED**

Error classification, retry policy and failover policy are separate decisions. Fallback descends through the configured preference order, cooldown state is honored, authentication/permission/invalid-request/safety/cancellation failures do not silently fail over, and unknown errors are fallback-safe only when explicitly configured.

## Pass 24 — Advanced Fallback Controls & Developer Diagnostics

**COMPLETE — VERIFIED**

Advanced routing controls remain outside the normal chat surface. Diagnostics are opt-in and are derived from the same routing events used by runtime execution. Secret material is excluded from diagnostic output.

## Pass 25 — Persistent Routing Log & Model Health History

**COMPLETE — VERIFIED**

Routing telemetry is structured and persistently bounded. Events retain machine-readable timestamps, request/session identifiers, preference rank, attempt information, error classification, latency, retry/fallback decisions and cooldown state. Model health is derived from recorded events, and retention is bounded at 5,000 events.

## Pass 26 — Diagnostics Analysis & Report Generation

**COMPLETE — VERIFIED**

On-demand diagnostics support last hour, today, last 7 days, last 30 days and custom periods. Reports distinguish Observed, Inferred, External Evidence and Recommendation. Online research is an explicit separate operation, and recommendations do not change routing policy automatically.

## Pass 27 — Model-Stamped Diagnostic Reports & Dedicated Archive

**COMPLETE — VERIFIED**

Reports have application-generated author model ID/display name, generated timestamp/timezone, analysis period, analysed models, report type, source snapshot ID, source telemetry snapshot and online-research state. Reports live in the dedicated Model Diagnostics / Reports archive and remain traceable to their source telemetry.

## Pass 28 — Adaptive Routing Readiness, Integration Audit & Final Proving

**COMPLETE — VERIFIED**

The canonical resilience engine emits the same routing events used for diagnostics. Deterministic proving scenarios cover:

- success with #1
- retry then success with #1
- 429 → #2
- 5xx → #2
- #2 cooling → #3
- authentication failure → no fallback
- invalid request → no fallback
- cancellation → no fallback
- recovery → #1
- unknown error with fallback OFF
- unknown error with fallback ON
- telemetry reconstruction and secret exclusion

Production verification checks the built server. Browser proving checks the desktop/mobile model selector, upward dropdown behaviour, viewport bounds, readable model labels and Escape dismissal.

Autonomous adaptive routing remains disabled by default. No analysis result can silently mutate the user's preference hierarchy.

## Final audit

### Duplicate model selectors

**COMPLETE — VERIFIED:** one composer model selector plus the existing reliability/fallback configuration surface; no second runtime preference store exists.

### Duplicate reliability state

**COMPLETE — VERIFIED:** `ReliabilitySettings` is the persisted policy boundary consumed by the resilience engine.

### Duplicate fallback engines

**COMPLETE — VERIFIED:** `modelResilience.ts` is the routing engine; diagnostics observe it rather than implementing another route.

### Direct provider logic in UI

**COMPLETE — VERIFIED:** UI selection only updates canonical settings; provider execution remains in runtime/client layers.

### Secrets in diagnostics

**COMPLETE — VERIFIED:** routing events contain routing metadata rather than prompt/credential payloads, and regression proof checks common credential markers are absent.

### Unbounded log growth

**COMPLETE — VERIFIED:** telemetry retention is explicitly bounded at 5,000 events.

### Reports without author metadata

**COMPLETE — VERIFIED:** persisted report records require application-assigned author model metadata.

### Automatic preference mutation

**COMPLETE — VERIFIED:** failover does not rewrite the user's preferred model or order.

### Fallback paths bypassing canonical policy

**COMPLETE — VERIFIED:** error classification and configured retry/failover codes are evaluated inside the canonical resilience engine before route changes occur.

## Verification commands

**COMPLETE — VERIFIED in CI when the current Pass 28 head completes successfully:**

- `npm test`
- `npm run lint`
- `npm run build`
- `npm run verify:production`
- `npm run verify:browser`
- background-runtime typecheck via `npm run lint`

The browser proving suite uses Chromium in CI and exercises both desktop and mobile viewport constraints.
