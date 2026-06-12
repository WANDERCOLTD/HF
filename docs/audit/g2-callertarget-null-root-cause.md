# G2 — CallerTarget.currentScore NULL for skill_* parameters

**Issue:** [#1516](https://github.com/WANDERCOLTD/HF/issues/1516)
**Surfaced by:** [#1525](https://github.com/WANDERCOLTD/HF/pull/1525) — adaptive-loop canary live verdict (G2 gate `aggregate.skill_*` failed in WARN mode)
**Investigator:** fix/1516-callertarget-null-currentscore
**Date:** 2026-06-11

## TL;DR — the chain is NOT broken; the canary fixture is

The AGGREGATE → CallerTarget write path works correctly for real (non-canary) callers on `hf_sandbox`. The canary fixture's playbook is missing the per-playbook `skill-measure-<playbookPrefix>` MEASURE spec, so EXTRACT never writes `skill_*` CallScore rows for the canary caller, so AGGREGATE (`SKILL-AGG-001`) reads zero source rows and writes zero CallerTarget rows.

The canary's G2 gate at [`adaptive-loop-canary.integration.test.ts:292-317`](../../apps/admin/tests/integration/journey/adaptive-loop-canary.integration.test.ts) is asserting on a precondition that the canary fixture itself never establishes.

## Evidence

### 1. AGGREGATE specs are correctly seeded

```text
=== Active AGGREGATE specs on hf_sandbox ===
{ slug: 'spec-learn-prof-001', ruleMethods: ['threshold_mapping' x 5] }
{ slug: 'spec-coach-agg-001',  ruleMethods: ['threshold_mapping' x 5] }
{ slug: 'spec-disc-agg-001',   ruleMethods: ['threshold_mapping' x 5] }
{ slug: 'spec-comp-agg-001',   ruleMethods: ['threshold_mapping' x 7] }
{ slug: 'spec-skill-agg-001',  ruleMethods: ['ema_to_caller_target'] }  ← SKILL-AGG-001
```

`SKILL-AGG-001` is seeded with the correct rule. Spec config at
`apps/admin/docs-archive/bdd-specs/SKILL-AGG-001-skill-ema-aggregation.spec.json:36-44`:

```json
{
  "sourceParameter": "skill_*",
  "sourceParameterPattern": "skill_*",
  "method": "ema_to_caller_target",
  "emaHalfLifeDays": 14,
  "minCallsToFull": 4
}
```

### 2. The runner path is wired and exercised

`apps/admin/app/api/calls/[callId]/pipeline/route.ts::stageExecutors.AGGREGATE` calls
`runAggregateSpecs(ctx.callerId)`. That function picks up SKILL-AGG-001 because it
filters on `outputType: 'AGGREGATE', isActive: true`. SKILL-AGG-001 satisfies both.

The runner then enters `runAggregation` → `accumulateSkillScores` which queries
`CallScore.findMany({ where: { callerId, parameterId: { startsWith: 'skill_' }, NOT: { hasLearnerEvidence: false } } })`.

### 3. The canary caller has zero CallScore rows of any parameterId

```text
=== Distinct CallScore.parameterId for canary caller (externalId=canary-1514-caller) ===
(empty — cleanup ran after PR #1525's live run)
```

The canary fixture's `cleanupCanaryFixture` (`canary-fixture.ts:293-355`) wipes
CallScore + CallerTarget for the canary caller. So we cannot inspect the post-run
state directly. But we can inspect the post-run state for OTHER callers who share
the same pipeline path.

### 4. Real callers DO get `CallerTarget.currentScore` populated

`callerId=c05d5267-471c-4a10-9288-4ff416fb7cb6` on the IELTS playbook
(`playbookId=eb6bc79e-3168-49e5-90a0-d732a37fe294`):

```text
=== CallScore evidence breakdown ===
{ skill_scores: 10, evidence_true: 10, evidence_false: 0, evidence_null: 0 }

=== CallerTarget(skill_*) ===
{ parameterId: 'skill_grammatical_range_and_accuracy_gra', currentScore: 0.538, callsUsed: 3 }
{ parameterId: 'skill_pronunciation_p',                    currentScore: 0.500, callsUsed: 1 }
{ parameterId: 'skill_fluency_and_coherence_fc',           currentScore: <populated> }
{ parameterId: 'skill_lexical_resource_lr',                currentScore: <populated> }
```

**The runner WORKS for real callers.** When `skill_*` CallScore rows exist, the
EMA cascade lands them in `CallerTarget.currentScore` correctly.

### 5. The differentiator: per-playbook MEASURE spec attachment

```text
=== AnalysisSpec slugs containing 'skill' ===
{ slug: 'skill-measure-ec4127a1', outputType: 'MEASURE', specType: 'DOMAIN' }
{ slug: 'skill-measure-eb6bc79e', outputType: 'MEASURE', specType: 'DOMAIN' }  ← IELTS playbook
{ slug: 'skill-measure-41d4dcfa', outputType: 'MEASURE', specType: 'DOMAIN' }
{ slug: 'skill-measure-2d63715e', outputType: 'MEASURE', specType: 'DOMAIN' }
{ slug: 'skill-measure-eebf437a', outputType: 'MEASURE', specType: 'DOMAIN' }
{ slug: 'spec-skill-agg-001',     outputType: 'AGGREGATE', specType: 'SYSTEM' }
```

Every IELTS-style playbook has its own `skill-measure-<playbookPrefix>` spec. These
are created by `apps/admin/lib/wizard/apply-projection.ts::upsertMeasureSpec`
(line 618) **when a course-reference projection is run on the playbook**. The spec
writes `skill_*` CallScore rows during EXTRACT.

The canary playbook (`Canary 1514 Playbook`) has **no** such spec because the
canary fixture bootstrap (`canary-fixture.ts::bootstrapCanaryFixture`) seeds the
playbook directly without going through the wizard projection. Result: the canary
EXTRACT has nothing to write `skill_*` CallScores from; AGGREGATE finds zero source
rows; CallerTarget(skill_*).currentScore stays NULL.

## Distinguishing the four candidates

| Candidate | Verdict |
|---|---|
| AGGREGATE doesn't run at all | ❌ False — `runAggregateSpecs` is wired into `stageExecutors.AGGREGATE` and the entry/exit log lines exist at `aggregate-runner.ts:392-394, 434-436` |
| AGGREGATE runs but no rules | ❌ False — `SKILL-AGG-001` is seeded with `method: ema_to_caller_target` |
| AGGREGATE runs with rules but writes fail silently | ❌ False — real callers like `c05d5267` have populated `currentScore` |
| AGGREGATE runs but `skill_*` source rows don't exist | ✅ **TRUE for canary** — canary playbook has no `skill-measure-<canary>` MEASURE spec |

## Relationship to #1519 (ContractRegistry.get typo)

The `.get()` typo at `aggregate-runner.ts:184` is real but **not** the root cause
of #1516. It causes a silent throw inside the try/catch at lines 173-196, which
falls through to `SKILL_DEFAULTS = { emaHalfLifeDays: 14, minCallsToFull: 4 }`.
Critically, **these defaults are IDENTICAL to the contract values** in
`SKILL_MEASURE_V1.contract.json`. So the typo causes I-AL3 ("defaults fired") to
emit when it doesn't have to, but the EMA math runs with the same constants the
contract would have supplied.

Fixing the typo is correct (it eliminates a spurious I-AL3 emit) but it does not
populate `CallerTarget.currentScore` for the canary. **#1519's scope is the typo;
#1516's scope is the canary fixture seeding gap.** They are independent.

This PR does NOT touch the typo — keep that change in #1519's own PR with its own
behavioural risk review (the contract STARTS being consulted instead of being
silently bypassed, which is a behavioural change even when the values match).

## Fix shape

Extend `bootstrapCanaryFixture` in `apps/admin/tests/integration/journey/canary-fixture.ts`
to seed a minimal per-playbook MEASURE spec for the canary's playbook AND the
matching `BehaviorTarget` rows that the AGGREGATE-side `CallerTarget.upsert` uses
as the parameter set.

Specifically:
1. Create 4 skill `Parameter` rows (`skill_fluency_and_coherence_fc`,
   `skill_lexical_resource_lr`, `skill_grammatical_range_and_accuracy_gra`,
   `skill_pronunciation_p`) — these are the canonical IELTS Speaking parameters
   the rubric writes.
2. Create a `skill-measure-canary-1514` `AnalysisSpec` with `outputType=MEASURE,
   scope=DOMAIN, specRole=MEASURE` whose triggers + actions reference those
   parameters with `weight: 1.0` and `parameterId` set.
3. Link it to the canary playbook via `PlaybookItem` (`itemType=SPEC,
   isEnabled=true, groupId=SKILL_MEASURE`).
4. Seed `BehaviorTarget` rows scoped to the canary playbook with the 4 skill
   parameterIds and `targetValue=1.0` so AGGREGATE's `CallerTarget.upsert`
   `create.targetValue` default matches the cascade root.
5. Add `cleanupCanaryFixture` teardown for these rows (PlaybookItem +
   AnalysisTrigger + AnalysisAction + AnalysisSpec + BehaviorTarget +
   Parameter).

After this seeding, a real-engine claude pass over `CANARY_TRANSCRIPT` should:
- write `skill_*` CallScores in EXTRACT (the canary transcript has explicit
  fluency, vocabulary, and grammar exemplars) — gate G2 source rows present
- run `accumulateSkillScores` and EMA-blend those scores into
  `CallerTarget.currentScore` — gate G2 PASS

## Verification — DONE (post-fix evidence)

Live canary runs on hf-dev VM, source `AppLog.stage='pipeline.canary.run'`:

| Run | Verdict | Detail |
|---|---|---|
| 2026-06-12T11:52:28Z (BEFORE, on `main`) | G2=WARN | `CallerTarget(skill_*, currentScore!=null) count=0; > 0 expected` |
| 2026-06-12T11:07:45Z (BEFORE, on `main`) | G2=WARN | `count=0` |
| 2026-06-12T12:11:26Z (AFTER, on `fix/1516`) | G2=PASS | `count=3` |
| 2026-06-12T12:12:39Z (AFTER) | G2=PASS | `count=3` |
| 2026-06-12T12:13:44Z (AFTER) | G2=PASS | `count=3` |
| 2026-06-12T12:14:34Z (AFTER) | G2=PASS | `count=3` |

4 stable PASSes across consecutive runs with `engine=claude`. `extract.scores`
remained at `count=18..19` across runs. Three distinct skill parameters
(out of 4 seeded) landed CallerTarget rows; the 4th (pronunciation) has no
text-only signal so claude legitimately skipped it.

Other gates after fix:
- `extract.scores >= 10` PASS (unchanged)
- `learn.memories > 0` PASS — already passing on the v2 canary (G9/#1515 was disproven; see PR #1527 audit doc)
- `compose.keyMemories > 0` still WARN — downstream `key_memories` plumbing has its own gap (not in scope here)
- `compose.invariantErrors empty` PASS (unchanged)

## How to re-verify

```bash
gcloud compute ssh hf-dev --zone=europe-west2-a --command='cd ~/HF/apps/admin && \
  set -a && source .env.local && set +a && \
  npm run test:integration -- tests/integration/journey/adaptive-loop-canary.integration.test.ts'
```

Then inspect `AppLog` for the G2 verdict:

```sql
SELECT metadata->'gateResults'
FROM "AppLog"
WHERE stage = 'pipeline.canary.run'
ORDER BY "createdAt" DESC LIMIT 1;
```

## Risk + rollback

- **Risk:** zero for production code paths. Fixture-only change. Rollback = revert
  the PR; the canary returns to its current WARN-on-G2 state.
- **Risk:** Parameter table is shared across the DB; the canary's 4 skill
  parameter slugs collide with the production IELTS slugs. **Mitigation:** the
  canary fixture uses `upsert` semantics (`skill_fluency_and_coherence_fc` etc.
  are stable and shared with production IELTS — using the same parameterIds is
  actually correct because SKILL-AGG-001 matches `startsWith: 'skill_'`
  irrespective of which playbook produced the score).
- **Note:** The `behaviorTarget` rows are scoped to the canary playbook (not
  SYSTEM), so they don't leak into the cascade root for other playbooks.

## What this PR is NOT

- NOT fixing the EMA math (works correctly per evidence section 4)
- NOT fixing CallScore writing (works correctly per evidence section 4)
- NOT fixing the `.get()` typo (that's #1519's scope; values are identical
  anyway so no behavioural diff in defaults)
- NOT touching the invariant runner from Slice 1 (#1517)
