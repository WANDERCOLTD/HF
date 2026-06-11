# ADR — Chat-mode collapse spike (#1504 Slice 1)

**Status:** Spike findings — proceed to Slice 2 (refine prompt before backend collapse).
**Date:** 2026-06-11
**Author:** developer (background agent)
**Related:** epic [#1504](https://github.com/humanfirstfoundation/HF/issues/1504), shipped under DEMO mode [#1485](https://github.com/humanfirstfoundation/HF/issues/1485)

---

## Context

Today the chat surface exposes **4 user-facing ChatModes** (`DATA`, `TUNING`, `COURSE_MANAGE`, `DEMO`) plus 4 route-only modes (`CALL`, `BUG`, `WIZARD`, `COURSE_REF`). The operator (PM) flagged that splitting DATA + TUNING + COURSE_MANAGE into three tabs is friction without benefit — each tab has slightly different tool palettes and slightly different system prompts, but the operator's intent (course-scoped help vs learner-scoped help vs general data lookup) is determined by the page they're on and the entity they have in scope, not by which tab they remembered to click.

The epic proposes collapsing those 3 modes into a single `ASSISTANT` mode, keeping `DEMO` structurally separate (it has a narrowed tool palette + different conversational stance + ESLint backstop for fan-out safety). Slice 1 is a **spike** — no UI changes, no migration, no production-default flip — proving that the 3 modes CAN share a code path without behavioural regression on 6 representative scenarios.

---

## Decision

**Build the unified builder behind a feature flag (`HF_FLAG_UNIFIED_ASSISTANT=true`). Default OFF in CI and prod; ON on hf-dev VM for live testing. Run the existing 40 factual-grounding tests AND a new 16-test unified-assistant suite AND a 6-scenario promptfoo eval before deciding whether to make the flag the default in Slice 2.**

### Implementation

| Artefact | Location | Purpose |
|---|---|---|
| Unified builder | `apps/admin/lib/chat/unified-assistant-prompt.ts` | Merges DATA prompt + tuning catalogue + new intent-routing block + entity context + page hints + ticket / feedback hints |
| Route gate | `apps/admin/app/api/chat/route.ts` (line ~395) | When flag ON and `mode in (DATA, TUNING, COURSE_MANAGE)`, route through `handleDataModeWithTools` with `ADMIN_TOOLS` (full palette) and the unified prompt. DEMO / CALL / BUG / WIZARD / COURSE_REF untouched. |
| Vitest pin | `apps/admin/tests/api/chat-unified-assistant.test.ts` | 6 representative scenarios + intent-signal unit tests (16 tests total) |
| Promptfoo eval | `apps/admin/evals/wizard/unified-assistant-spike.yaml` | Same 6 scenarios, model-in-the-loop |
| Flag check | `isUnifiedAssistantEnabled()` in builder file | String-strict `=== "true"` — typos can't flip it on |

### What the unified prompt builder does

The unified prompt is composed of these layers (in order):

1. `DATA_SYSTEM_PROMPT` — catalogue of admin tools + grounding contract + write-action rules
2. `buildTuningSystemPrompt({ entityContext, tuningScope })` — behaviour-target catalogue + scope toggle
3. **Intent-routing block (NEW)** — short hints that nudge the model to prefer course-edit tools when on a course page, learner-edit tools when on a learner page, and the relevant `update_behavior_target` scope when the toggle is set
4. Page context + feature catalogue + entity breadcrumb context + ticket / feedback hint + runtime context + terminology

The full `ADMIN_TOOLS` palette is exposed in the tools array regardless of mode. The intent block tells the model which subset is contextually relevant; the model self-narrows.

### What this slice does NOT do

- No UI change — the 3 tabs still render
- No per-mode history merge (deferred to Slice 2 with the localStorage migration)
- No change to the factual-grounding intercept (it fires structurally on `toolUsesInTurn`, regardless of which builder produced the system prompt)
- No change to DEMO / CALL / BUG / WIZARD / COURSE_REF modes

---

## Spike findings

### What the BUILDER tests reveal

The 16-test vitest suite confirms structurally:

1. **Intent signals derive correctly** from any combination of breadcrumb + page hint + tuning scope.
2. **The intent-routing block emits the right hints** for course-only, learner-only, both-in-scope, and neither-in-scope cases.
3. **The grounding contract is preserved** verbatim — every scenario still sees "Learner-scoped facts grounding contract" + the `get_caller_detail` template phrasing.
4. **The tuning catalogue is always carried in** — even with `tuningScope` unset, the model sees the behaviour-target tools and the "no scope picked yet — ask the educator" header. This is the key collapse: TUNING was a separate mode only because the tuning catalogue was conditionally injected; in the unified surface it's always there.
5. **The feature flag defaults OFF** — `isUnifiedAssistantEnabled()` returns false for any value other than the exact string `"true"`.

### Drift surface — where the collapse could regress

| Risk | Today's behaviour | Unified behaviour | Mitigation |
|---|---|---|---|
| **Course-tuning ambiguity** | TUNING mode + scope toggle disambiguates "make warmer" → BEH-WARMTH at PLAYBOOK scope | Unified relies on intent block + tuning scope toggle to nudge the model | Promptfoo Scenario 1 pins; if the model writes at LEARNER instead of PLAYBOOK with the toggle set to PLAYBOOK, refine the routing block |
| **Cross-tenant writes** | COURSE_MANAGE narrows tools to `COURSE_MANAGE_TOOLS` (no `query_specs`, no `query_callers` for other tenants) | Unified exposes the full palette; relies on the intent block + the model's self-narrowing | Promptfoo Scenarios 1 + 3 + 6 pin; if the model calls cross-tenant tools when on a course page, harden the prompt or move the filter to a runtime guard |
| **Grounding intercept coverage** | DATA + COURSE_MANAGE routes through `detectUngroundedLearnerClaim`; TUNING does not | Unified routes everything through `handleDataModeWithTools` → intercept fires for all three | **POSITIVE side effect** — TUNING gains grounding intercept coverage it didn't have before |
| **Tuning-scope semantics on a learner page with PLAYBOOK toggle** | TUNING mode warns "your toggle is PLAYBOOK but you're saying 'just for her'" | Unified inherits the same warning from the embedded tuning prompt | Tests confirm the embedded prompt is verbatim — no semantic loss |
| **`update_playbook_config` from a learner page** | In COURSE_MANAGE, this is permitted (course-scoped); in DATA it was gated by the model's reasoning | Unified emits the "this will affect this learner's whole cohort — confirm before calling them" hint when learner is in scope | Promptfoo Scenario 6 will catch a confirm-bypass regression |

### What COULDN'T be proven in the spike

- **Live model behaviour at scale** — the 6 promptfoo scenarios are representative but not exhaustive. A larger eval set (~50 scenarios) is groomed for Slice 2 before the flag default flips.
- **Per-mode history merge** — deferred to Slice 2 (involves localStorage migration + idempotent re-load logic).
- **UI tab collapse** — deferred to Slice 3.
- **Token cost delta** — the unified prompt always includes the tuning catalogue (~500 tokens) even on a DATA query that has nothing to do with tuning. Slice 2 should measure the actual cost delta on a representative sample of calls; if it's > 20% the catalogue should be lazy-loaded from a tool call instead of pre-injected.

---

## Decision verdict

**PROCEED TO SLICE 2 — with one refinement.**

1. The 6 representative scenarios all pin cleanly against the unified prompt structure.
2. The factual-grounding intercept fires unchanged — the 40-test pin is preserved.
3. The intent-routing block successfully encodes the implicit signal that DATA / TUNING / COURSE_MANAGE were encoding via mode + filter.
4. The flag-gated approach lets us run BEFORE/AFTER comparisons in dev without breaking CI.

**The one refinement before Slice 2:** the intent-routing block must explicitly tell the model that when a learner is in scope, `update_playbook_config` (course-level) and `update_behavior_target scope: PLAYBOOK` (course-level) WILL fan out to the learner's whole cohort. The current wording mentions this but Slice 2 should pin it harder with a dedicated promptfoo scenario ("operator says 'fix this for her' while toggle is PLAYBOOK") to confirm the model asks before fanning out.

### Slice 2 entry conditions

Before flipping the flag default to ON:

- [ ] Run the 6 promptfoo scenarios with both providers (legacy vs unified) — pin the diffs in a comment on #1504
- [ ] Expand the promptfoo set to ~20 scenarios covering edge cases (cross-tenant queries, scope-mismatch detection, error-recovery flows)
- [ ] Measure token cost delta on a representative sample (target: < 20% increase, or lazy-load the tuning catalogue from a tool call)
- [ ] Tighten the routing block's "cohort fan-out" wording per the refinement above
- [ ] Confirm the per-mode history merge plan with the operator (one-time idempotent migration vs forced clear-and-recreate)

### Slice 3 entry conditions

After Slice 2 ships and the flag default is ON for 1 week of dev usage:

- [ ] Operator interviews — does the unified Assistant feel like a regression vs the 3-tab shape? If yes, identify the workflow that broke.
- [ ] Collapse `ChatModeTabs()` from 3 → 1 + DEMO (2 tabs total)
- [ ] Surface migration banner on first open after collapse
- [ ] Remove `MODE_CONFIG` entries for `TUNING` and `COURSE_MANAGE`

---

## Out of scope

- Collapsing `WIZARD` / `COURSE_REF` / `CALL` / `BUG` into the unified surface — these are route-level execution modes with structurally different concerns (wizard graph evaluation, course-ref interview, voice roleplay, source-code awareness). They stay as separate modes.
- Expanding the DEMO tool palette — DEMO stays at 5 tools with the `no-ai-fanout-all` ESLint backstop.
- Moving the `TuningScopeToggle` out of the UI — disposition decided in Slice 3.

---

## Rollback

The flag default is OFF. To revert:

1. Set `HF_FLAG_UNIFIED_ASSISTANT` unset (or anything other than `"true"`) on every environment.
2. The legacy `buildSystemPrompt` cascade runs unchanged.
3. Delete `lib/chat/unified-assistant-prompt.ts`, the route gate, the vitest file, and the promptfoo eval.

No data migrations were done in this slice, so rollback is a single env var flip.
