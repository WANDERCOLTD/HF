# Mode → spec selection Coverage gate — bridge between build-time and runtime

> Every `AuthoredModuleMode` value in
> `apps/admin/lib/types/json-fields.ts` MUST have either a real
> spec-selection consumer (a `module.mode === "<value>"` branch in
> `lib/pipeline/**`, `lib/voice/**`, `lib/prompt/composition/**`, or
> `lib/curriculum/**` that loads / drops / re-routes an AnalysisSpec
> or compose directive) OR an explicit `default-fallback` exemption
> declaring that the mode legitimately runs the baseline
> conversational MEASURE path. Modes referenced as literals with no
> selection AND no exemption are silent bugs — failing the test.
>
> Sibling Coverage-pillar gates:
> [`mode-ui-coverage.md`](./mode-ui-coverage.md) — same
> `AuthoredModuleMode` source, three-axis UI consumer matrix
> (teaching / adminUI / learnerUI) at build time. This rule covers
> the FOURTH axis — spec selection at runtime.
> [`sessionkind-reader-coverage.md`](./sessionkind-reader-coverage.md)
> — sibling type-union ↔ runtime consumer pairing
> ([`registry-consumer-coverage.md`](./registry-consumer-coverage.md))
> — sibling registry storagePath ↔ transform reader.
> [`parameter-coverage.md`](./parameter-coverage.md) — sibling
> Parameter ↔ runtime consumer.
>
> Born of epic [#2145](https://github.com/WANDERCOLTD/HF/issues/2145)
> S6 ([#2152](https://github.com/WANDERCOLTD/HF/issues/2152)) as the
> bridge between two prior structural gates:
>
> - PR #2144 (`mode-ui-coverage.test.ts`) pinned the build-time UI
>   axis of the producer→consumer pairing.
> - PR #2155 wired `IELTS-MEASURE-001` into SCORE_AGENT under
>   `HF_IELTS_LLM_MEASURE_V1` — the first non-default-fallback spec
>   selection decision in the runtime pipeline. Today's selection is
>   gated by `requiresBehaviorTargetParams` + the env flag, NOT by
>   `module.mode`. Future mode-specific spec selection (per epic
>   #2135 + course-specific stories) will move modes out of
>   `default-fallback` and into `covered`.

## Rule

When you add or modify a value in the `AuthoredModuleMode` type union
at `apps/admin/lib/types/json-fields.ts`:

1. **Add the literal to `AUTHORED_MODULE_MODE_VALUES`** in
   `apps/admin/tests/lib/pipeline/mode-spec-selection-coverage.test.ts`.
   The source-vs-matrix sanity test fires immediately if the union
   diverges.
2. **Decide the selection plan**:
   - **Real selection** — wire a `module.mode === "<value>"` branch
     in one of the spec-selection dirs
     (`lib/pipeline/**`, `lib/voice/**`,
     `lib/prompt/composition/**`, `lib/curriculum/**`) that loads,
     drops, or re-routes an AnalysisSpec or compose directive. Test
     classifies as `covered`.
   - **Default-fallback** — the mode runs the baseline
     conversational MEASURE path with no mode-literal branching at
     the selection layer (e.g. `tutor` baseline, `mixed` =
     tutor + scoringGate-driven assessment activation). Add to
     `MODE_SPEC_SELECTION_EXEMPT` with a >20-char reason. Bump
     `EXPECTED_EXEMPT_COUNT`.
3. **If you can't ship a selection plan in the same PR**, add to
   `MODE_SPEC_SELECTION_EXEMPT` with a reason describing the
   deferral AND bump `EXPECTED_EXEMPT_COUNT`. The ratchet catches
   the bump as a conscious decision.

## Why this exists

The build-time `mode-ui-coverage.test.ts` pins three axes
(teaching / adminUI / learnerUI) but does NOT pin the spec-selection
layer of the pipeline runtime. PR #2144 closed the UI side; PR #2155
opened the runtime side with the first non-default selection
decision (`IELTS-MEASURE-001`). Without a paired Coverage gate, a
future mode value could ship with a UI consumer but quietly run the
wrong spec set — exactly the failure mode `mode-ui-coverage.md`
warns about, applied one level deeper.

Today's incumbent matrix (2026-06-21 baseline):

| Mode | Spec-selection classification | How |
|---|---|---|
| `tutor` | exempt (`default-fallback`) | baseline conversational MEASURE — no mode-literal branching |
| `mixed` | exempt (`default-fallback`) | tutor baseline + `scoringGate` firing — no mode-literal branching |
| `examiner` | exempt (`default-fallback`) | wired via spec-slug template at `lib/curriculum/build-per-segment-measure-prompt.ts`, not via `.mode` comparator |
| `quiz` | `covered` | `lib/prompt/composition/transforms/instructions.ts::resolveModuleQuizDirective` gates on `matched.mode === "quiz"` |
| `mock-exam` | `covered` | `lib/prompt/composition/transforms/instructions.ts::resolveModuleMockExamDirective` gates on `matched.mode === "mock-exam"` |

Ratchet baseline: `EXPECTED_EXEMPT_COUNT = 3`, `EXPECTED_GAP_COUNT = 0`.

## How matching works

For each mode value, the test concatenates source from
`SELECTION_DIRS` and looks for a literal-consumer pattern referencing
the mode:

```
mode === "<value>"
mode !== "<value>"
.mode === "<value>"
.mode !== "<value>"
```

Switch-case branches (`case "<value>":`) are deliberately NOT
matched — they may legitimately exist for unrelated string literals
(e.g. `AudienceId = "mixed"` in `lib/prompt/composition/transforms/audience.ts`,
`scheduler.mode === "assess"`, `prosody.mode === "ielts"`). If your
mode is consumed via a switch inside one of `SELECTION_DIRS`,
rewrite the branch to an explicit `===` comparator OR list the mode
in `MODE_SPEC_SELECTION_EXEMPT` with a one-line reason.

## Selection-consumer-directory map

| Dir | What lives here |
|---|---|
| `lib/pipeline` | Pipeline runners + spec loaders (`specs-loader.ts`, `aggregate-runner.ts`, etc.) |
| `lib/voice` | Voice-side mode-aware helpers (`build-assistant-config.ts` + siblings) |
| `lib/prompt/composition` | COMPOSE-stage transforms + directive renderers (incl. `instructions.ts::resolveModuleQuizDirective` + `resolveModuleMockExamDirective`) |
| `lib/curriculum` | Curriculum / module dispatch (`build-per-segment-measure-prompt.ts`, `select-pinned-card.ts`, etc.) |

## When NOT to apply

This rule covers `AuthoredModuleMode`. The same generic shape applies
to other type unions where producer-only failure at the runtime spec-
selection layer would surprise the learner — e.g. `SessionKindString`
(covered by
[`sessionkind-reader-coverage.md`](./sessionkind-reader-coverage.md))
or future per-spec selection gates. Each surface gets its own paired
test + rule.

## When adding a new mode

Author checklist (same PR):

1. Extend `AuthoredModuleMode` in `lib/types/json-fields.ts`.
2. Add the literal to `AUTHORED_MODULE_MODE_VALUES` in the test
   AND in `mode-ui-coverage.test.ts` (sibling gate).
3. Decide UI presence (3-axis per `mode-ui-coverage.md`) AND spec-
   selection presence (this rule). Each is its own decision.
4. Run `npx vitest run tests/lib/pipeline/mode-spec-selection-coverage.test.ts`.
   If green → ship. If `gap` → wire selection consumer OR add
   `MODE_SPEC_SELECTION_EXEMPT` entry + bump `EXPECTED_EXEMPT_COUNT`.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `tests/lib/pipeline/mode-spec-selection-coverage.test.ts` (born 2026-06-21, this PR) | 7 vitests: source-vs-matrix sanity, gap-check, gap ratchet, exempt ratchet, non-empty reason, no contradiction, distribution sanity | New `AuthoredModuleMode` values shipping without a spec-selection consumer or a documented default-fallback. The build-time→runtime drift that `mode-ui-coverage.test.ts` and PR #2155 collectively open. |
| `tests/lib/sim-chat/mode-ui-coverage.test.ts` (PR #2144) | 3-axis UI consumer matrix | Build-time UI consumer drift — sibling gate at the UI layer. |
| `lib/prompt/composition/transforms/instructions.ts` (PR #2081 + PR #2090 — epic #2009 S2 / S4) | `resolveModuleQuizDirective` + `resolveModuleMockExamDirective` | The reference consumers that pin `quiz` + `mock-exam` to `covered` today. |
| `app/api/calls/[callId]/pipeline/route.ts` (PR #2155 — epic #2135 S2) | `filterByBehaviorTargetParams` + `ieltsLlmMeasureV1Enabled` gate | The first non-default-fallback spec-selection decision in the runtime. Gated by BehaviorTarget presence + env flag, NOT by `.mode` — modes stay default-fallback until a story explicitly graduates them. |

## Related

- [`tests/lib/pipeline/mode-spec-selection-coverage.test.ts`](../../apps/admin/tests/lib/pipeline/mode-spec-selection-coverage.test.ts) — the test
- [`apps/admin/lib/types/json-fields.ts`](../../apps/admin/lib/types/json-fields.ts) — `AuthoredModuleMode` source-of-truth
- [`apps/admin/lib/prompt/composition/transforms/instructions.ts`](../../apps/admin/lib/prompt/composition/transforms/instructions.ts) — `resolveModuleQuizDirective` + `resolveModuleMockExamDirective` (the two `covered` consumers today)
- [`apps/admin/lib/pipeline/specs-loader.ts`](../../apps/admin/lib/pipeline/specs-loader.ts) — spec-selection helpers + `filterByBehaviorTargetParams` (#2137)
- [`.claude/rules/mode-ui-coverage.md`](./mode-ui-coverage.md) — sibling Coverage gate (UI consumer side)
- [`.claude/rules/sessionkind-reader-coverage.md`](./sessionkind-reader-coverage.md) — sibling Coverage gate
- [`.claude/rules/registry-consumer-coverage.md`](./registry-consumer-coverage.md) — sibling Coverage gate (storagePath surface)
- Epic [#2145](https://github.com/WANDERCOLTD/HF/issues/2145) — Generic SessionFocus substrate (parent)
- Epic [#2135](https://github.com/WANDERCOLTD/HF/issues/2135) — IELTS scoring as canonical MEASURE specs (the architectural framing that makes future mode-specific selection decisions real)
- Story [#2152](https://github.com/WANDERCOLTD/HF/issues/2152) — this gate (S6 of epic #2145)
- PR #2144 (sibling Coverage gate, UI side)
- PR #2155 (the first non-default-fallback spec-selection decision)
