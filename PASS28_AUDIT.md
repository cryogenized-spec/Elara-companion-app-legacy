# Pass 28 — Adaptive Routing Readiness, Integration Audit & Final Proving

## Final status

**BLOCKED — EXPLICIT REASONS**

The routing subsystem is not declared fully complete because the current `main` branch still lacks the required composer-integrated model selector, and the repository does not contain a browser-level proving suite that can satisfy the final UI inspection requirement. The runtime routing/diagnostics integration itself has been hardened and covered by deterministic tests in this pass.

## Pass 20 — Model Selection Domain & Preference Order

**COMPLETE — VERIFIED** for the canonical persisted preference boundary used by the current settings/reliability architecture.

Evidence: `ElaraSettings.model` remains the selected preference and `reliabilitySettings.fallbackModels` remains the shared ordered fallback list; runtime does not mutate those settings during failover. Existing Gemini 3.5 models remain in `AVAILABLE_MODELS` for compatibility.

## Pass 21 — Chat Model Selector UI

**BLOCKED — EXPLICIT REASON**

The current composer source on `main` contains attachment, microphone and send controls but no model selector control. The Pass 28 branch contains a new `ModelSelector` component, but the component has not been safely integrated into the composer yet, so this requirement is not claimed as verified.

## Pass 22 — Preference Ordering UI

**COMPLETE — VERIFIED** at the reliability settings boundary: fallback models are shown with ordinal position and can be enabled/disabled and moved with explicit up/down controls. The panel explicitly says failover does not overwrite the preferred model.

## Pass 23 — Deterministic Fallback Rules

**COMPLETE — VERIFIED** at the routing-engine/test level after the Pass 28 telemetry integration. Routing remains based on classified error codes, retry policy and the ordered fallback list. Unknown errors are not fallback-safe unless explicitly configured.

## Pass 24 — Advanced Fallback Controls & Developer Diagnostics

**COMPLETE — VERIFIED** at the policy/settings level used by the current runtime. The normal chat surface is not responsible for routing decisions; policy and diagnostics are separated from execution.

## Pass 25 — Persistent Routing Log & Model Health History

**COMPLETE — VERIFIED** structurally. Routing telemetry uses a bounded IndexedDB-backed store with structured events and derived model-health summaries. Retention is explicitly capped at 5,000 events and diagnostic writes are non-critical to chat execution.

## Pass 26 — Diagnostics Analysis & Report Generation

**COMPLETE — VERIFIED** structurally and by regression coverage. Analysis supports last hour, today, last 7 days, last 30 days and custom periods; Observed, Inferred, External Evidence and Recommendation remain separate; online checking is explicit.

## Pass 27 — Model-Stamped Diagnostic Reports & Dedicated Archive

**COMPLETE — VERIFIED** structurally and by regression coverage. Reports have application-stamped author model metadata, separate analysed-model metadata, generated timestamp/timezone, source snapshot ID, source telemetry snapshot, report type and online-research state. Reports have a dedicated Model Diagnostics / Reports surface.

## Pass 28 — Adaptive Routing Readiness, Integration Audit & Final Proving

**BLOCKED — EXPLICIT REASONS**

1. The canonical runtime path now emits request/error/retry/cooldown/fallback/success/recovery telemetry from the same resilience engine used for execution.
2. Deterministic synthetic proving scenarios cover success, retry-then-success, 429 fallback, 5xx fallback, #2 cooling down to #3, authentication/invalid-request/cancellation no-fallback, unknown-error opt-in/opt-out, recovery to #1, telemetry reconstruction and secret exclusion.
3. Autonomous adaptive routing is **not enabled** by the architecture in this pass. No recommendation is applied automatically.
4. `npm run verify:production` has been added for production build-output/server smoke verification.
5. **BLOCKER:** the composer still needs the new selector integrated so the final UI requirement can be verified rather than inferred.
6. **BLOCKER:** no repository browser proving suite was found; static source inspection cannot truthfully satisfy “the final user-facing layout has actually been inspected.”

## Final audit checks

### Duplicate model selectors

**BLOCKED — EXPLICIT REASON:** a settings model control exists, but the required composer selector is not yet integrated on the audit branch.

### Duplicate reliability state

**COMPLETE — VERIFIED:** the runtime consumes the canonical `ReliabilitySettings` object; no second persisted policy store was introduced.

### Duplicate fallback engines

**COMPLETE — VERIFIED:** `modelResilience.ts` remains the routing engine and now feeds telemetry; diagnostics observe the engine rather than replacing it.

### Direct provider logic in UI

**COMPLETE — VERIFIED:** composer-level model selection, where present, changes settings only; provider execution remains in runtime/client layers.

### Secrets in diagnostics

**COMPLETE — VERIFIED:** routing event schema contains model/routing metadata only, and proof tests assert common credential-bearing strings are absent from snapshots.

### Unbounded log growth

**COMPLETE — VERIFIED:** diagnostic retention is bounded at 5,000 events.

### Reports without author metadata

**COMPLETE — VERIFIED:** report records require application-generated author model ID/display name fields.

### Automatic preference mutation

**COMPLETE — VERIFIED:** fallback operates against the preferred model plus fallback list without rewriting persisted preference order.

### Fallback paths bypassing canonical policy

**COMPLETE — VERIFIED:** the resilience engine classifies errors and checks configured failover codes before moving down the preference order.

## Required commands / environment-gated verification

`npm test`: must pass on CI for final green status.

`npm run lint`: must pass on CI, including Lockbox checks and background-runtime typecheck.

`npm run build`: must pass on CI.

`npm run verify:production`: must pass on CI.

Browser/application proving suite: **BLOCKED — no browser suite is present in the repository; production server smoke verification is available but does not substitute for browser layout inspection.**
