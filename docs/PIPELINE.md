# Pipeline — Canonical Map of the 7-Stage Post-Call Adaptive Loop

> **Read this before you add a pipeline stage, a runner, a cross-stage DB write, or any code that depends on a stage having already run.**
>
> Stage ordering is enforced only by the `order` field in PIPELINE-001. There is no compile-time check. Inserting a stage at the wrong order causes **silent** downstream failures — upstream writes rows the next stage hasn't read yet, or COMPOSE runs before ADAPT writes targets.
>
> **Five-pillar canon — read the right doc before changing related code:**
>
> | Pillar | Doc | Covers |
> |--------|-----|--------|
> | Inputs | [`docs/WIZARD-DATA-BAG.md`](./WIZARD-DATA-BAG.md) | educator intent → `Playbook.config` |
> | Classification | [`docs/CONTENT-PIPELINE.md`](./CONTENT-PIPELINE.md) | extraction, audience filters, compose-time gates |
> | Model | `docs/ENTITIES.md` *(in flight — see PR for `docs/entities-canonical-map`)* | hierarchy + content-boundary path |
> | Composition | `docs/PROMPT-COMPOSITION.md` *(in flight — #327)* | loaders → transforms → assembly |
> | **Adaptive loop** | **this doc** | **the 7-stage post-call pipeline** |

---

## 1. Stage table (canonical)

PIPELINE-001 seed order, live executor symbols. **Citations use symbol form** — `route.ts` is 2700+ lines and actively edited; line numbers drift, symbol names don't.

| Stage | Order | outputType (spec enum) | Executor | Parallel? | `requiresMode` |
|-------|-------|------------------------|----------|-----------|----------------|
| EXTRACT | 10 | `MEASURE`, `LEARN` | `app/api/calls/[callId]/pipeline/route.ts::stageExecutors.EXTRACT` | YES (with `SCORE_AGENT`) | — |
| SCORE_AGENT | 20 | `MEASURE_AGENT` | `route.ts::stageExecutors.SCORE_AGENT` | YES (with `EXTRACT`) | — |
| AGGREGATE | 30 | `AGGREGATE` | `route.ts::stageExecutors.AGGREGATE` | no | — |
| REWARD | 40 | `REWARD` | `route.ts::stageExecutors.REWARD` | no | — |
| ADAPT | 50 | `ADAPT` | `route.ts::stageExecutors.ADAPT` (3 internal parallel + 4 sequential — §7) | no | — |
| SUPERVISE | 60 | `SUPERVISE` | `route.ts::stageExecutors.SUPERVISE` | no | — |
| COMPOSE | 100 | `COMPOSE` | `route.ts::stageExecutors.COMPOSE` | no | `prompt` only |

Spec seed: `apps/admin/docs-archive/bdd-specs/PIPELINE-001-pipeline-configuration.spec.json`.

### 1.1 Landmine — stage name ≠ `AnalysisOutputType`

The stage executor key is **not** the same string as the spec's `outputType`. Most stages match (`EXTRACT.outputTypes = ["MEASURE","LEARN"]` already differs because EXTRACT is a stage, MEASURE/LEARN are spec output types) but **`SCORE_AGENT` is the canonical foot-gun**:

- **Stage name:** `SCORE_AGENT` (key in `route.ts::stageExecutors`, key in `PIPELINE-001.config.stages[].name`)
- **outputType the stage processes:** `MEASURE_AGENT` (the value used on `AnalysisSpec.outputType` rows)
- **`prisma/schema.prisma::enum AnalysisOutputType` has 8 values:** `MEASURE`, `LEARN`, `ADAPT`, `MEASURE_AGENT`, `AGGREGATE`, `COMPOSE`, `REWARD`, `SUPERVISE` — **`SCORE_AGENT` is NOT in the enum.**

Developers grepping for `SCORE_AGENT` in `schema.prisma` will find nothing and assume the stage is dead. It is not. See §4.

---

## 2. Per-stage detail

For each stage: input DB rows it reads, output DB rows it writes (and the function that writes them), idempotency policy, and failure mode. All stages are non-blocking — see §3.

Format per row: stage → reads → writes (and runner) → idempotency. All failures are non-blocking (§3) unless flagged.

| Stage | Reads | Writes (runner) | Idempotency |
|-------|-------|-----------------|-------------|
| EXTRACT | transcript, `AnalysisSpec(MEASURE\|LEARN)`, prior `SchedulerDecision` | `CallScore`, `CallerMemory` (caller analysis batched per call) | Skip if any `CallScore` row exists for the call; `force=true` overrides |
| SCORE_AGENT | transcript, `BehaviorTarget`, `AnalysisSpec(MEASURE_AGENT)` | `BehaviorMeasurement` | Per-spec inside the runner — no executor-level gate |
| AGGREGATE | `CallScore` (caller history) | `PersonalityObservation`, `CallerPersonality`, `CallerPersonalityProfile`, `LearnerProfile` — runner `lib/pipeline/aggregate-runner.ts::runAggregateSpecs` | No — pure recompute |
| REWARD | `BehaviorMeasurement`, `BehaviorTarget`, `Playbook.config.rewardComponents` | `RewardScore` — runner `lib/ops/compute-reward.ts::computeReward` | No — overwrites |
| ADAPT | `Call`, `CallerPersonalityProfile`, transcript, current `Goal` rows | `CallTarget`, `CallerTarget`, `Goal`, `GoalProgress` — see §7 for the seven sub-runners | Skip if any `CallTarget` exists for the call; `force=true` overrides |
| SUPERVISE | `CallTarget`, `CallerTarget`, `Playbook.config.audience`, guardrails from `lib/pipeline/guardrails.ts::loadGuardrails` | clamped `CallTarget.value`, aggregated `CallerTarget` — functions `validateTargets()` and `aggregateCallerTargets()` (both inline in `route.ts` — see L4) | No |
| COMPOSE | `CallerMemory`, `CallerPersonalityProfile`, `Goal`, `CallerTarget`, composition specs | `ComposedPrompt` — runner `lib/prompt/composition/CompositionExecutor.ts::executeComposition` | No — new row every run |

Key nuances captured below where they don't fit the table.

**EXTRACT event-gate (Scheduler v1 Slice 1).** When the prior `SchedulerDecision.mode` isn't an assessment mode, caller-skill scoring is suppressed (`skipMeasure` on the batched analysis) — memory/LEARN extraction always runs. Prevents Boaz S1–S4 false positives. LLM JSON is repaired by `recoverBrokenJson()`; short transcripts cap confidence.

**SUPERVISE clamp.** Default `targetClamp.minValue=0.2`, `targetClamp.maxValue=0.8` from `DEFAULT_GUARDRAILS` in `lib/pipeline/guardrails.ts` — overridable via GUARD-001 parameters and audience-aware (clamp range varies by `Playbook.config.audience`). Teacher alerts do NOT live here (§8).

**COMPOSE.** Direct function call — no HTTP self-call. Persisted via `persistComposedPrompt` with `triggerType: "pipeline"`. Failure handling is special — see §3.

---

## 3. Failure handling — `stageErrors` and the COMPOSE exception

All stages run inside `Promise.allSettled` (parallel batches) or a `try/catch` (sequential). The orchestrator logs failures, appends to `ctx.results.stageErrors[]`, and continues. **Stage failures do NOT abort the pipeline.**

The only exception: when **COMPOSE** fails **in `prompt` mode**, `ctx.results.composeFailed = true` and the route returns `500`. In `prep` mode, COMPOSE doesn't run at all (it has `requiresMode: "prompt"`).

### 3.1 Landmine — non-blocking errors → green response

A pipeline run can have EXTRACT, AGGREGATE, and REWARD all fail and still return `{ ok: true }` to the caller. The `stageErrors` array is included in the response body but the HTTP status is 200.

**Trip-wire:** check `response.stageErrors.length === 0` if you depend on every stage running. Don't trust `ok: true` alone.

---

## 4. Ordering invariant and parallelism

`lib/pipeline/config.ts::loadPipelineStages`:

1. Queries the PIPELINE-001 spec (or `GUARD-001` fallback, `config.specs.pipelineFallback`).
2. Calls `extractStagesFromConfig(pipelineSpec.config)` — picks the `pipeline_stages` parameter and reads `config.stages[]`.
3. Sorts by `stage.order` ascending. **No DB constraint** on uniqueness — order collision is a soft warning (`C-PIPE-1`).
4. Throws if PIPELINE-001 is missing. No silent fallback.

Parallelism is **hardcoded** in `route.ts::runSpecDrivenPipeline`:

```ts
const parallelStages = new Set(["EXTRACT", "SCORE_AGENT"]);
```

The runner greedily batches consecutive stages whose names are in this set. Adding a new parallel pair requires editing this constant. Changing the order field alone does not unlock new parallelism.

### 4.1 What happens if you insert a stage at the wrong order

| Mistake | Effect |
|---------|--------|
| New stage at order 25 (between SCORE_AGENT and AGGREGATE) reads `CallerPersonalityProfile` | Reads stale or empty — AGGREGATE hasn't run yet |
| New stage at order 70 (after SUPERVISE) writes `CallTarget` | COMPOSE picks up unclamped values — guardrail bypass |
| New stage shares order 30 with AGGREGATE | Both run sequentially; sort is stable but order is undefined |

No runtime error in any of these cases. The only sentry is reviewer discipline.

### 4.2 Cross-stage data flow

```
EXTRACT      writes: CallScore (MEASURE specs), CallerMemory (LEARN specs)
SCORE_AGENT  writes: BehaviorMeasurement (MEASURE_AGENT specs)
AGGREGATE    reads:  CallScore
             writes: PersonalityObservation, CallerPersonality,
                     CallerPersonalityProfile, LearnerProfile
REWARD       reads:  BehaviorMeasurement, BehaviorTarget
             writes: RewardScore
ADAPT        reads:  CallerPersonalityProfile, transcript, Goal
             writes: CallTarget, CallerTarget, Goal, GoalProgress
SUPERVISE    reads:  CallTarget, CallerTarget
             writes: clamped CallTarget, aggregated CallerTarget
COMPOSE      reads:  CallerMemory, CallerPersonalityProfile, Goal, CallerTarget
             writes: ComposedPrompt
```

Use this as the dependency map when adding a new write. If your new stage produces a row, the next stage that reads it must be downstream in `order`.

---

## 5. Modes and entry points

| Mode | Stages run | Triggered by |
|------|-----------|--------------|
| `prep` | All except COMPOSE | VAPI webhook auto-trigger (fire-and-forget `triggerPipeline()`); pre-call warm-up |
| `prompt` | All 7 | Call-end route, Sim UI "Run Pipeline" button, dry-run prompt endpoint |

Route: `POST /api/calls/:callId/pipeline`. Auth: `requireAuth("OPERATOR")` **OR** `x-internal-secret` header matching `appConfig.security.internalApiSecret` (used by the VAPI webhook).

`memory/flow-call-lifecycle.md` covers the upstream lifecycle (VAPI → transcript → pipeline trigger).

---

## 6. Spec slugs and env-overrides per stage

All stage-driving specs are dynamically loaded — no hardcoded slugs. Active EXTRACT/SCORE_AGENT/AGGREGATE/REWARD/ADAPT specs are pulled by `outputType`. SUPERVISE loads GUARD-001 via `loadGuardrails()`. COMPOSE loads composition section specs.

| Slug | Used by | Env-override |
|------|---------|--------------|
| `PIPELINE-001` | Stage ordering | `PIPELINE_SPEC_SLUG` (`config.specs.pipeline`) |
| `GUARD-001` | Guardrails + fallback if PIPELINE-001 missing | `PIPELINE_FALLBACK_SPEC_SLUG` (`config.specs.pipelineFallback`) |
| `COMP-001` (and other `composition-*`) | COMPOSE section loaders | per-section slugs in `config.specs.*` |
| `PERS-001`, `VARK-001`, `MEM-001`, etc. | EXTRACT MEASURE/LEARN | per-spec slugs in `config.specs.*` |
| `REW-001` | REWARD | `config.specs.reward` |
| `ADAPT-*` | ADAPT | per-spec slugs in `config.specs.*` |

See `lib/config.ts` for the full 16-slug surface. **Rule:** never hardcode a slug string — read it from `config.specs.*`.

---

## 7. ADAPT sub-operations

The ADAPT executor runs 7 sub-operations: 3 in parallel, 4 sequential. Each is non-blocking individually.

**Parallel batch (`Promise.allSettled`):**

1. `runAdaptSpecs()` — AI-based adapt specs → `CallTarget`
2. `runRuleBasedAdapt()` — rule-based adapt specs → `CallerTarget`
3. `extractGoals()` — transcript → new/updated `Goal` rows (GOAL-001)

**Sequential after the batch:**

4. `trackGoalProgress(callerId, callId)` — per-goal progress update → `GoalProgress`
5. `evaluateCheckpoints(callerId, callId, sessionNumber=1)` — comprehension/discussion/coaching checkpoints. *sessionNumber is hardcoded to 1; scheduler owns pacing now — see TODO in executor.*
6. `extractGoalCompletionSignals()` — detects "I passed!" claims; surfaces as teacher alerts (NOT a SUPERVISE concern — see §8)
7. `applyAssessmentAdaptation()` — `CallerTarget` adjustment based on proximity to assessment threshold

For internal logic of (3)/(4)/(6)/(7) see `memory/flow-goal-tracking.md`. That memory file is Claude-only; if you change goal mechanics, update both this section and that file.

---

## 8. SUPERVISE surface — what it does and doesn't do

| Concern | SUPERVISE? | Where it actually lives |
|---------|------------|-------------------------|
| Clamp `CallTarget.value` to `[0.2, 0.8]` | **YES** | `validateTargets()` in `route.ts`, guardrail from `lib/pipeline/guardrails.ts::DEFAULT_GUARDRAILS.targetClamp` |
| Aggregate cross-call targets → `CallerTarget` | **YES** | `aggregateCallerTargets()` (inline in `route.ts` — §9 L4) |
| Audience-aware clamp | **YES** | passes `audience` from `Playbook.config` into `validateTargets` |
| Teacher alerts ("learner claimed pass") | **NO** | `extractGoalCompletionSignals()` in ADAPT |
| Cross-caller / cross-playbook policy enforcement | **NO** | not implemented today |
| Spec drift detection | **NO** | covered by `arch-checker` agent and seed-sync tests |

If you find yourself adding a "this should be flagged" branch to SUPERVISE, stop — it almost certainly belongs in ADAPT's signal extraction or in the post-pipeline alerts layer.

---

## 9. Landmines

| # | Landmine | Where | Status |
|---|----------|-------|--------|
| L1 | **`SCORE_AGENT` stage name ≠ `MEASURE_AGENT` outputType.** Grepping `schema.prisma` for `SCORE_AGENT` returns nothing — the executor key and the spec enum diverged. | `route.ts::stageExecutors.SCORE_AGENT` vs `prisma/schema.prisma::enum AnalysisOutputType` | ⚠ Documented here. Rename either side would be a multi-file refactor — accept the divergence and read this doc. |
| L2 | **`lib/ops/pipeline-run.ts` is a legacy CLI, not the runtime orchestrator.** Still imported by `app/api/ops/route.ts` (admin batch ops) but not used per-call. Developers tracing the post-call loop frequently land here and follow the wrong path. | `lib/ops/pipeline-run.ts` | ⚠ OPEN. Live orchestrator is `app/api/calls/[callId]/pipeline/route.ts::stageExecutors`. |
| L3 | **Non-blocking `stageErrors` → green response.** A pipeline run can have 3 failed stages and still return `{ ok: true }` unless COMPOSE fails in `prompt` mode. | `route.ts::runSpecDrivenPipeline` | ⚠ Intentional resilience. Consumers must check `stageErrors.length` not just `ok`. |
| L4 | **`aggregateCallerTargets()` is inline in `route.ts`, not exported from `lib/pipeline/`.** Anyone looking for "where do CallerTargets come from?" greps the lib folder and finds nothing. | `route.ts::aggregateCallerTargets` (single inline function) | ⚠ OPEN — extract to `lib/pipeline/supervise-runner.ts` when a follow-up touches it. |
| L5 | **`parallelStages` hardcoded.** Spec-driven ordering doesn't drive parallelism — you can move stages around in PIPELINE-001 forever and EXTRACT/SCORE_AGENT will still be the only parallel pair. | `route.ts::runSpecDrivenPipeline` (`new Set(["EXTRACT","SCORE_AGENT"])`) | ⚠ By design. To add a parallel pair: edit the constant AND ensure no cross-batch DB dependency. |
| L6 | **`memory/flow-pipeline.md` last verified 2026-03-27.** Lesson-plan generation removal, event-gated scoring, session-advance deletion (all 2026-04-16) and audience-aware clamping are in the code, not in the memory file. | `memory/flow-pipeline.md` | ⚠ This doc replaces it. Front-matter on the memory file is updated to `superseded_by: docs/PIPELINE.md`. |
| L7 | **Idempotency by row-existence is fragile.** EXTRACT skips if any `CallScore` exists; ADAPT skips if any `CallTarget` exists. A partial-failure run can leave half-written rows that look "complete" to the next attempt. | `route.ts::stageExecutors.EXTRACT`, `::stageExecutors.ADAPT` | ⚠ OPEN. `force=true` overrides. Consider per-spec idempotency in a future revision. |
| L8 | **Order-collision is a soft warning.** Two stages with the same `order` produce undefined effective ordering (sort is stable but spec source-order is not contracted). | `lib/pipeline/config.ts::loadPipelineStages` | ⚠ Tracked in PIPELINE-001 seed as `C-PIPE-1`. No DB constraint to enforce uniqueness. |

---

## 10. Pre-change checklist

Before merging a PR that adds, removes, or reorders a stage / runner / cross-stage write, confirm:

### Adding a new stage

- [ ] Add stage entry to `apps/admin/docs-archive/bdd-specs/PIPELINE-001-pipeline-configuration.spec.json` with a unique `order` value.
- [ ] Add executor to `route.ts::stageExecutors` with the **stage name** as the key (NOT the outputType — see L1).
- [ ] If the stage processes a new `outputType`, add it to `prisma/schema.prisma::enum AnalysisOutputType` and migrate.
- [ ] Walk §4.2 — confirm every downstream consumer of your stage's writes is at a higher `order`.
- [ ] If the stage should batch with another, add the name to `parallelStages` in `route.ts::runSpecDrivenPipeline` AND verify zero cross-batch DB dependency.
- [ ] If the stage only runs in one mode, set `requiresMode` in the spec config.
- [ ] Add idempotency policy — row-existence skip (like EXTRACT/ADAPT) or per-spec.
- [ ] Update §1 stage table, §2 per-stage detail, §4.2 cross-stage flow, this checklist.

### Adding a runner to an existing stage (most ADAPT changes)

- [ ] Place the runner under `lib/pipeline/` (or `lib/goals/`, `lib/ops/`) — **never inline in `route.ts`** (L4).
- [ ] Add to the parallel batch only if it has no read dependency on its batch peers.
- [ ] Update §7 if it's an ADAPT sub-op.
- [ ] If it writes a new row type, update §4.2.

### Modifying guardrails (clamp ranges, audience rules)

- [ ] Update `DEFAULT_GUARDRAILS` in `lib/pipeline/guardrails.ts` AND ensure the GUARD-001 spec parameters can override it.
- [ ] If the change is audience-aware, thread the audience id through `validateTargets`.
- [ ] Update §8 if the SUPERVISE surface changes.

### Reordering an existing stage

- [ ] Walk §4.2 to confirm no downstream consumer is now upstream of its producer.
- [ ] Check both `prep` and `prompt` mode flows — COMPOSE's `requiresMode` means moving COMPOSE earlier would skip it in `prep`.
- [ ] Update §1.

### Touching `lib/ops/pipeline-run.ts`

- [ ] **Don't** — that file is a legacy CLI, not the runtime orchestrator (L2). Verify the live route at `app/api/calls/[callId]/pipeline/route.ts` does what you need first.

---

## 11. Change log

| Date | Change |
|------|--------|
| 2026-05-11 | Initial canonical version. Fifth pillar of the architecture canon alongside WIZARD-DATA-BAG, CONTENT-PIPELINE, ENTITIES (in flight), and PROMPT-COMPOSITION (in flight, #327). Replaces `memory/flow-pipeline.md` (last verified 2026-03-27). Closes #330. |
