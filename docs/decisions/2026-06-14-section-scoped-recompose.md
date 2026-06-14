# ADR: Section-scoped incremental recompose

**Date:** 2026-06-14
**Status:** Accepted
**Deciders:** Paul W
**Story:** #1558 (S3 of EPIC #1555)
**Prerequisites:** #1556 S1 (`ComposeSection` taxonomy) merged; #1557 S2 (section-grain staleness primitives) in review at PR #1600

## Context

`CompositionExecutor` today is all-or-nothing. A single field write that
touches `welcomeMessage` triggers a full-prompt recompose: every loader
runs, every transform fires, the entire `Playbook.config` is re-snapshotted
into `ComposedPrompt.inputs`. For a course in steady state with 14 sections
and ~10 active demo callers, that's ~140 loader invocations and ~10
ComposedPrompt writes for a one-key edit.

S1 (#1556) gave us the section taxonomy + `PIPELINE_STATE_SECTION_LOADERS`
map; S2 (#1557) gave us per-section staleness primitives. S3 closes the
loop: when only the `welcome` hash drifted, recompose only `welcome`.

The user-visible surface is `POST /api/courses/[courseId]/recompose-section`
with `{ sectionKey: "welcome", dryRun?: boolean }`. The route reruns the
loaders that section depends on (from `PIPELINE_STATE_SECTION_LOADERS`),
re-runs the transforms that produce that section's text, patches the
section in every active `ComposedPrompt` for the course, and refreshes the
section hash via `bumpSectionHash`.

This ADR enumerates per-section safe/unsafe verdicts (which sections CAN
be recomposed in isolation without compose-semantic drift), picks a fanout
strategy for courses with many enrolled callers (TL open question Q2), and
nails down the dryRun contract + rollback path.

## The 14 sections + safe/unsafe verdict

Verdict definition:

- **SAFE** — the section's transform reads only inputs declared in
  `PIPELINE_STATE_SECTION_LOADERS[sectionKey]` plus its own slice of
  `Playbook.config`. Recomputing it in isolation produces byte-identical
  output to a full-prompt recompose (modulo timestamps).
- **UNSAFE** — the section's transform reads cross-section state (e.g.
  another section's loader output, the full assembled prompt, a Playbook
  field outside its declared dependency set). Section-scoped recompose
  is not implemented; route returns 422 `{ error: "section requires full
  recompose", reason: "..." }`.

| Section | Kind | Loader deps (from S1) | Verdict | Reason |
|---|---|---|---|---|
| `firstCallMode` | config | — | **SAFE** | Self-referential read from `Playbook.config.firstCallMode`. No transform; the composer emits the value as-is. |
| `modePolicy` | config | — | **SAFE** | Self-referential reads (`progressNarrative`, `audience`, `teachingMode`). Independent of other sections. |
| `intake` | runtime, config-sourced | — | **SAFE** | `sessionFlow` slice rendered by `intake` transform. Inputs are `Playbook.config.sessionFlow` only. |
| `welcome` | runtime, config-sourced | — | **SAFE** | `welcomeMessage` + `firstCallCourseIntro` + `firstCallWaitForAck`. Pure config-read; no per-caller state in the section. |
| `onboarding` | runtime, config-sourced | — | **SAFE** | `onboardingFlowPhases` rendered by `transforms/quickstart.ts`. Pure config-read. |
| `offboarding` | runtime, config-sourced | — | **SAFE** | `offboardingSummary` config-read. |
| `nps` | runtime, config-sourced | — | **SAFE** | `surveys.nps` slice. No cross-section dependency. |
| `modulesGate` | runtime, pipeline-state | `curriculumAssertions` | **SAFE** | `transforms/modules.ts` reads structured-curriculum assertions only. Declared dep matches actual reads. |
| `instructions` | runtime, pipeline-state | `goals` | **SAFE** | Goal-adaptation guidance sub-field. `transforms/instructions.ts` reads only the goals loader output + `Playbook.config.goals`. |
| `moduleMastery` | runtime, pipeline-state | `callerAttributes` | **SAFE** | Per-module mastery chips. Reads `module_mastery:*` `CallerAttribute` keys only. |
| `loMastery` | runtime, pipeline-state | `callerAttributes` | **SAFE** | Per-LO mastery chips. Reads `lo_mastery:{moduleId}:{loRef}` keys only (TL note in S1 `section.ts:103-105` confirms). |
| `behaviorTargets` | runtime, pipeline-state | `callerTargets` | **SAFE** | Skill-band rendering. Reads `callerTargets` loader output only. |
| `personality` | runtime, pipeline-state | `personality` | **SAFE** | Personality snippets from `CallerAttribute personality:*`. |
| `contentTrust` | runtime, pipeline-state | `subjectSources` | **SAFE-WITH-CAVEAT** | `transforms/trust.ts::checkFreshness` runs at compose time and emits `FreshnessWarning` chips. The freshness check itself is cheap; the loader (`subjectSources`) reads `PlaybookSource(COURSE_REFERENCE)` rows. SAFE for partial recompose. **Caveat:** if a new `PlaybookSource` is uploaded while a section-scoped run is in flight, the warning may lag by one cycle. Acceptable. |
| `carryOverActions` | runtime, pipeline-state | `openActions` | **SAFE** | Open-action chips. Reads `Action` rows for the caller. |
| `priorCallFeedback` | runtime, pipeline-state | `priorCallFeedback` | **SAFE-WITH-CAVEAT** | Reads `Call.feedbackJson` for the prior call. SAFE when the trigger is an educator config change. **Caveat:** if the trigger is a pipeline-stage write (END_OF_CALL → REWARD), section-scoped recompose is the wrong primitive — the pipeline's COMPOSE stage already runs fresh at the end of each pipeline run (per `bump-timestamp.ts` "When NOT to call these" header). Route rejects with 422 when invoked mid-pipeline. |

**Net: 14 of 14 sections SAFE for educator-driven, out-of-pipeline,
section-scoped recompose.** Two carry caveats; neither blocks the
implementation. No UNSAFE rows. If a future transform develops cross-section
reads, demote its section to UNSAFE here and the route returns 422 — the
educator falls back to full-prompt recompose, no data corruption risk.

## Fanout strategy (TL Q2)

The choice: how does section-scoped recompose handle courses with >20
enrolled callers? Three options considered:

1. **Sync everywhere — block until every caller's ComposedPrompt is
   patched.** Simple, no infrastructure. **Rejected:** on a 200-caller
   course this is a multi-second educator-facing wait per save. Bad UX.
2. **Async everywhere — fire-and-forget queue for every fanout.** Uniform.
   **Rejected:** for the common case (1 demo caller, 1 educator iterating
   in the Designer Console) the educator wants to see the change reflect
   in the Preview lens immediately. An async path forces a polling loop
   or a refetch button.
3. **Hybrid — sync when ≤20, async fire-and-forget when >20.** Mirrors
   the #1429 demo-caller eager-reprompt pattern already in production
   (`lib/compose/eager-reprompt-on-bump.ts`). The 20-caller threshold
   matches the same constant used there. **Accepted.**

The 20-caller cutoff is conservative — a fully patched ComposedPrompt
write is ~5ms (a single `UPDATE` against an indexed row), so 20 callers ≤
100ms sync. Above the cutoff, the route returns immediately with `{
fanoutMode: "async", queued: N }` and the eager-reprompt helper drives
each per-caller patch fire-and-forget. Failures are captured in the
existing `[demo-reprompt]` log channel; no retry — the next compose-input
write recovers via the normal staleness path.

When >20, the route's response carries `queued: N` and the caller-list is
NOT returned (could be unbounded). Operator follow-up: the existing
`/api/courses/[courseId]/staleness-aggregate` route is the canonical
"is it done yet" probe.

## dryRun contract

`POST /api/courses/[courseId]/recompose-section` with `{ sectionKey,
dryRun: true }` returns:

```json
{
  "ok": true,
  "dryRun": true,
  "sectionKey": "welcome",
  "previewDiff": {
    "before": "<current section text from any one active ComposedPrompt>",
    "after": "<projected section text after recompose>",
    "affectedCallerCount": 12
  }
}
```

dryRun does NOT:

- Write to `PlaybookSectionStaleness` (no hash bump)
- Write to any `ComposedPrompt` (no patch)
- Trigger fanout

dryRun DOES:

- Run the section's loaders (read-only)
- Run the section's transforms (in-memory)
- Read one representative active ComposedPrompt for the `before` text

Per-caller previewDiff is intentionally out of scope: the educator's
Preview-lens cohort is the demo learner; the educator can use the
existing `/dry-run-prompt` route for caller-specific previews.

## Rollback path

If a section-scoped recompose ships bad text:

1. Educator reverts the source field (e.g. `welcomeMessage`) to the prior
   value via the Designer Console.
2. The revert is itself a compose-affecting write → triggers another
   section-scoped recompose → patches every caller back.

No special rollback API needed. The "rollback" is just another forward
write of the previous value.

The compose-semantic safety net is the byte-identical-sibling acceptance
criterion: a promptfoo eval pins that recomposing `welcome` produces a
ComposedPrompt where every section OTHER than `welcome` is byte-identical
to the pre-recompose state. If a transform drift causes sibling-section
text to move, the eval fails before the PR merges.

## Section hash semantics post-recompose

After a successful (non-dryRun) section-scoped recompose for `welcome`:

- `PlaybookSectionStaleness` row for `(playbookId, "welcome")` is bumped
  with the new hash. `staleSince = now`.
- ALL OTHER section rows for the playbook are untouched. Their `staleSince`
  values keep reporting "this section has been stale since X" until they
  too are recomposed.
- `Playbook.composeInputsUpdatedAt` is bumped IFF a full-prompt recompose
  would also have been triggered (i.e. the same `composeAffectingChanged`
  gate fires). For pure section-scoped runs initiated via the API without
  an upstream config write, the page-level clock does NOT move.

This is the same separation-of-clocks contract pinned by S2: section hash
and page clock are independent. The API contract makes that visible.

## Out of scope (parked)

- **UI for section staleness chips and the [Recompose section] button.**
  Lives in the Renderers v2 follow-on epic. S3 ships the API + the
  primitives; the Inspector renderer registry (S4) provides the slot.
- **Multi-section batch recompose (`{ sectionKeys: ["welcome", "onboarding"] }`).**
  Defer until at least one operator workflow demands it; today's hot path
  is single-section editing in the Designer Console.
- **Per-caller dryRun cohort preview.** Use `/dry-run-prompt` for that
  shape; section-scoped dryRun is for the educator's "what will every
  active caller see after this save" question.

## Acceptance hooks

The S3 implementation PR must:

- Match the 14-section verdict table above. Adding a 15th section means
  adding it to this ADR's table AND to `PIPELINE_STATE_SECTION_LOADERS`
  in the same PR.
- Pin the byte-identical-sibling property via a promptfoo eval.
- Reject mid-pipeline invocation (return 422) — the pipeline COMPOSE
  stage runs end-of-run by contract.
- Honour the 20-caller sync/async threshold and surface the chosen mode
  on the response.

## Consequences

**Positive:** section-grain recompose unlocks finer-grain dirty-region
rendering downstream (the Designer Console can flag "welcome is stale,
others are clean" with surgical accuracy). Cost per educator save drops
from ~140 loader invocations to ~1.

**Negative:** new public API surface that future cross-section transforms
could violate. Mitigated by the verdict table (must be updated when a
transform's read set widens) and the promptfoo eval.

**Reversible:** if section-scoped recompose proves a footgun, the route
can short-circuit to full-prompt recompose with a one-line change.
`PlaybookSectionStaleness` rows remain useful for the staleness-display
purpose S2 ships.
