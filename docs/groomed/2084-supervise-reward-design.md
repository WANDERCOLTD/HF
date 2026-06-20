# 2084 — Supervise + Reward parameter wiring (S6 of #2078)

> **Status:** DESIGN BRIEF — pre-implementation. Multi-fork architectural
> decisions need review before code lands.
>
> **Sister sub-epic precedent:** PR #2058 shipped a design brief for
> sub-epic B (Call 1 shape consumers) on the same pattern — three
> producer-only `JourneySettingContract`s that needed semantic
> decisions before implementation could land. This S6 sub-epic is the
> harder cousin: NEW pipeline-runner architecture plus chain-contract
> + Lattice survey decisions that need orchestrator sign-off.
>
> **Survey-anchored:** [`docs/groomed/2078-parameter-coverage-survey.md`](./2078-parameter-coverage-survey.md) §6 "supervision (11 producer-only)" + §7 "reinforcement (5 producer-only)".
>
> **CHAIN-CONTRACTS.md anchor:** §3 Link 5 (SUPERVISE → COMPOSE clamp invariant) — this design proposes a NEW Link 5b for spec-driven supervision-quality measurements that does not perturb Link 5.

---

## Why this sub-epic is hardest

The S6 survey row identifies 16 producer-only parameters split across two
runtime gaps:

- **Part A (11 supervision-quality params)** — SUPV-001 spec exists
  ([`docs-archive/bdd-specs/SUPV-001-agent-supervision.spec.json`](../../apps/admin/docs-archive/bdd-specs/SUPV-001-agent-supervision.spec.json))
  with all 11 parameter rows. No runtime executor reads it. The
  parameters describe AGENT-SIDE quality measurements (`response_length_score`,
  `tutor_intro_score`, `safety_compliance_score`, etc.) — observations of
  what the LLM did, similar in shape to SCORE_AGENT writes today.
- **Part B (5 reward params)** — REW-001 spec exists with 5 parameters
  declared (`engagement_reward`, `learning_reward`, `rapport_reward`,
  `goal_progress_reward`, `composite_reward`). The REWARD stage's
  `compute-reward.ts` writes `RewardScore` rows but does NOT write
  per-parameter `CallScore` rows keyed on these IDs. So the canonical
  parameter-coverage substring search misses them.

Both gaps are **chain-stage architecture** problems, not transform
omissions. They need design decisions before implementation can ship.

---

## The two architectural forks

### Fork 1 — Where does SUPV-001 measurement run?

`SUPV-001-agent-supervision.spec.json` declares `"outputType": "MEASURE_AGENT"`
and `"specRole": "EXTRACT"`. The 7-stage pipeline table
([`docs/PIPELINE.md`](../PIPELINE.md) §1) shows `MEASURE_AGENT` outputType is
processed by the **SCORE_AGENT** stage (order 20) via
`route.ts::stageExecutors.SCORE_AGENT`, which already exists.

Two paths:

| Option | Cost | Risk | Lattice fingerprint |
|---|---|---|---|
| **A — Activate SUPV-001 via existing SCORE_AGENT** | Low — spec is already shaped right; just wire it active and ensure the SCORE_AGENT runner picks it up. NO new runner file. | The existing SCORE_AGENT runner may have assumptions that exclude SUPV-001 today (e.g., grouping by `specType` or filtering by `domain`). Need to inverse-probe. | Sibling-writer: SCORE_AGENT also writes `BehaviorMeasurement` (per PIPELINE.md §2 table). Adding 11 new parameter rows is structurally identical to adding any other MEASURE_AGENT spec. Survey clear. |
| **B — NEW `supervise-runner.ts` at SUPERVISE stage** | High — new runner, new spec wiring, new chain-contract Link 5b. | New stage runner introduces a new chain boundary; must compose cleanly with existing target-clamp executor that owns the SUPERVISE name today. | Sibling-writer: existing `validateTargets()` + `aggregateCallerTargets()` at `route.ts::SUPERVISE` write to `CallTarget` + `CallerTarget`. New runner writing `CallScore` is a different surface — no conflict. But the stage now has TWO sub-runners, which is a §7 ADAPT-shape pattern (8 sub-ops). |

**Recommendation:** **Option A**. The survey row's text "no SUPERVISE runner
is wired" was written before the spec's `outputType: MEASURE_AGENT` was
re-examined. Today SCORE_AGENT is the right home — SUPV-001 just needs to
be confirmed-active in DB and the SCORE_AGENT executor confirmed to pick
it up. If it doesn't pick it up, the fix is to extend the executor's spec
loader, not author a new runner.

**Open question for review:** Should SUPV-001 be reclassified to a NEW
`SUPERVISE_MEASURE` outputType + dedicated runner? The argument for: the
parameters are scored AFTER ADAPT writes targets (so target-alignment
measurements have something to compare against). The argument against:
adding a new stage is L1-landmine territory and the SCORE_AGENT pattern
already handles spec-driven measurements cleanly.

### Fork 2 — Where do REW-001's 5 reward params write CallScore?

`compute-reward.ts` writes `RewardScore` rows (one per call) — NOT
per-parameter `CallScore` rows. The parameter-coverage test searches
for parameter IDs in source files; it doesn't search the DB. So even
when `compute-reward.ts` runs and produces an `engagement_reward`
numeric, the parameter ID `BEH-LEARNING-REWARD` (and siblings) never
appears in code → classified `gap`.

Two paths:

| Option | Cost | Risk |
|---|---|---|
| **A — Author 5 spec-driven REW branches that write `CallScore`** | Medium — extend REW-001 spec config with per-param branches; extend `compute-reward.ts` to mirror each branch's output into a `CallScore` row keyed on the parameter ID. | Sibling-writer with `RewardScore`. Need to decide if `CallScore.parameterId = "BEH-LEARNING-REWARD"` co-exists with `RewardScore.parameterDiffs[].parameterId` (the existing per-diff array). |
| **B — Mention each parameter ID in `compute-reward.ts` source** | Trivial — add the 5 IDs as string literals in a switch/branch. | Sat the parameter-coverage test green but doesn't close the actual reward-loop closure gap (parameter-loop-closure.test.ts will still gap them). |

**Recommendation:** **Option A**, but with the lighter shape: extend the
existing `RewardScore` reader to map each parameter into a `CallScore`
write via the canonical writer (no-bare-call-score-write ESLint rule
applies — must use the chokepoint). This closes both the parameter-coverage
gap AND the parameter-loop-closure gap (M2) in the same PR.

**Open question for review:** Should `composite_reward` be a derived value
(formula in spec config: `0.3*engagement + 0.25*learning + 0.25*rapport + 0.2*goal_progress`)
written as a 5th CallScore row, OR computed on the fly in transforms?
Today REW-001 declares it as a parameter; consistency suggests writing
it as a CallScore.

---

## The 16 parameters in S6

Source: [`docs/groomed/2078-parameter-coverage-survey.md`](./2078-parameter-coverage-survey.md) §6 + §7. Validated against
[`apps/admin/docs-archive/bdd-specs/behavior-parameters.registry.json`](../../apps/admin/docs-archive/bdd-specs/behavior-parameters.registry.json) at canonical IDs (with alias resolution from
SUPV-001 snake_case shorthand to BEH-* canonical form):

### Part A — Supervision (11)

All map to SUPV-001 parameters (snake_case in spec.json) via the alias
column in the registry:

| Canonical id | Alias in SUPV-001 spec | Section |
|---|---|---|
| `BEH-RESPONSE-LENGTH-SCORE` | `response_length_score` | response_quality |
| `BEH-CRISIS-DETECTION-SCORE` | `crisis_detection_score` | safety |
| `BEH-SAFETY-COMPLIANCE-SCORE` | `safety_compliance_score` | safety |
| `BEH-ENGAGEMENT-TREND-SCORE` | `engagement_trend_score` | progress |
| `BEH-LEARNING-PROGRESS-SCORE` | `learning_progress_score` | progress |
| `BEH-TARGET-ALIGNMENT-SCORE` | `target_alignment_score` | consistency |
| `BEH-STYLE-CONSISTENCY-SCORE` | `style_consistency_score` | consistency |
| `BEH-TUTOR-INTRO-SCORE` | `tutor_intro_score` | tutoring |
| `BEH-TUTOR-SEQUENCE-SCORE` | `tutor_sequence_score` | tutoring |
| `BEH-TUTOR-FIDELITY-SCORE` | `tutor_fidelity_score` | tutoring |
| `BEH-STUDENT-APPLICATION-SCORE` | `student_application_score` | tutoring |

Note: SUPV-001 also declares `response_empathy_score` + `source_citation_score`
which sit alongside but aren't in the producer-only-11 list (the survey
counted 11 supervision gaps + 1 deprecated — these two are likely
already-covered or duplicate of the 11 via different aliases). Need to
confirm during implementation.

### Part B — Reward (5)

All map to REW-001 spec parameters (already declared, just unwired):

| Canonical id | REW-001 parameter id |
|---|---|
| `BEH-ENGAGEMENT-REWARD` (already covered per survey §7) | `engagement_reward` |
| `BEH-LEARNING-REWARD` | `learning_reward` |
| `BEH-RAPPORT-REWARD` | `rapport_reward` |
| `BEH-GOAL-PROGRESS-REWARD` | `goal_progress_reward` |
| `BEH-ERROR-ELABORATION` | (not in REW-001 today — needs to be added, OR moved out of the reward group) |
| (5th — likely `composite_reward` mapped to a new `BEH-COMPOSITE-REWARD` canonical id) | `composite_reward` |

**Open question:** `BEH-ERROR-ELABORATION` doesn't map to a REW-001
parameter today. The survey row may be misclassified, or REW-001 needs
extending. If extending, the spec edit is small; otherwise the
parameter should be reclassified out of S6.

---

## Sibling-writer survey (Lattice mandatory)

Per [`.claude/rules/lattice-survey.md`](../../.claude/rules/lattice-survey.md), the 4 classic risk shapes:

### Risk 1 — Sibling-writer drift on `CallScore.parameterId`

- **Existing writers:** SCORE_AGENT executor → BehaviorMeasurement +
  CallScore (per PIPELINE.md §4.2); AGGREGATE runner →
  `CallerTarget.currentScore` via `ema_to_caller_target` method;
  EXTRACT executor → `CallScore` for MEASURE specs.
- **New writers proposed:** SUPV-001-driven CallScores via Option A
  (SCORE_AGENT picks up the spec — net-zero new writer); REW-001
  per-param CallScores via Option A (extending `compute-reward.ts` to
  write a CallScore row per param using the chokepoint).
- **Convergence design:** Both new writers route through the canonical
  CallScore chokepoint (`hf-measurement/no-bare-call-score-write` ESLint
  rule enforces). The chokepoint guarantees each row carries a real
  `analysisSpecId`. No race condition — SCORE_AGENT runs at order 20,
  REWARD at order 40, sequential.

### Risk 2 — Default-deny gates

- SCORE_AGENT has no `requiresMode` gate (PIPELINE.md §1 table).
- REWARD has no `requiresMode` gate.
- No default-deny applies. No survey gap.

### Risk 3 — Cascade respect

- None of these 16 params are in `lib/cascade/knob-keys.ts` cascade
  families. They're scoring outputs, not configurable knobs. No cascade
  involvement; survey clear.

### Risk 4 — Convention conflict

- `CallScore.parameterId` carries canonical IDs (e.g.
  `skill_fluency_and_coherence_fc`, `BEH-RESPONSE-LEN`). The 11
  supervision params use BEH-* form (e.g. `BEH-TUTOR-INTRO-SCORE`).
  Convention preserved.
- REW-001's `composite_reward` snake_case form is the spec parameter
  id today. If we write a CallScore with `parameterId =
  "composite_reward"`, we're inconsistent with the BEH-* convention.
  Convention decision: write `BEH-COMPOSITE-REWARD` instead (matching
  the registry's BEH-* prefix) — but that requires the registry to
  also have `BEH-COMPOSITE-REWARD` with `composite_reward` as alias.
- **Survey gap surfaced:** REW-001 spec parameter ids
  (`engagement_reward` etc.) are snake_case but the registry uses
  BEH-* canonical with snake_case aliases. The spec.json and registry
  need to be reconciled — either the spec uses BEH-* form, OR the
  CallScore write deliberately uses the snake_case form and the
  reader (parameter-coverage substring search) walks aliases too.

---

## Proposed chain-contract row

If Option A goes ahead with extending SCORE_AGENT to consume SUPV-001,
no new chain row is needed — SUPV-001 inherits the existing SCORE_AGENT
chain row.

If Option B (new SUPERVISE-stage measurement runner) is preferred, a
new Link 5b should be authored:

> **Link 5b — SUPERVISE_MEASURE → COMPOSE supervision-quality bridge**
>
> The SUPERVISE stage MAY produce per-parameter CallScores keyed on
> supervision-quality parameter ids (SUPV-001 family). These CallScores
> are written by `lib/pipeline/supervise-runner.ts` AFTER the
> target-clamp branch (`validateTargets()` + `aggregateCallerTargets()`)
> AND consumed by COMPOSE via the existing CallScore reader. Idempotency:
> per-spec idempotency at runner level; force=true overrides.

This is design-doc territory — the choice between Option A (no new row)
and Option B (new row) is the central architectural question.

---

## Test plan

### Unit
- `parameter-coverage.test.ts` gap count drops from incumbent to incumbent-16.
- `parameter-loop-closure.test.ts` (M2) gap count drops for the 5 reward params.
- `parameter-measurement-coverage.test.ts` (M1) confirms each of the 16 cite SUPV-001 or REW-001 as their measurement spec.

### Integration
- Sim a single call end-to-end with SUPV-001 active. Verify 11 CallScore rows land for the call.
- Sim a single call end-to-end. Verify REWARD stage writes RewardScore PLUS 5 CallScore rows.

### Lattice
- `lattice-self-maintenance.test.ts` confirms the new chain row (if Option B) exists with citation.
- `lattice-chain-closure.test.ts` validates link-by-link key agreement for the new SUPV chain (if Option B).

---

## Open questions for review (must resolve before code lands)

1. **Fork 1 decision** — Option A (extend SCORE_AGENT to consume SUPV-001) OR Option B (new `supervise-runner.ts` for SUPERVISE_MEASURE outputType)?
2. **Fork 2 decision** — Option A (write per-param CallScores from `compute-reward.ts`) OR a different shape?
3. **Convention** — Should REW-001 parameter ids be renamed to BEH-* form, or should the registry alias-walking be deepened to make snake_case parameter ids first-class?
4. **`BEH-ERROR-ELABORATION`** classification — does it belong in S6 (reward), or should it move to a different sub-epic? Today it's not in REW-001.
5. **Should the inline `aggregateCallerTargets()` in route.ts be extracted to `lib/pipeline/supervise-runner.ts` as part of this PR** (per L4 of PIPELINE.md), even if Option A wins? Extracting would clean up the L4 landmine and create a natural home for any future supervision runners.

---

## Implementation slicing (if forks resolve to A/A)

Pessimistic estimate assuming Option A on both forks:

| Slice | Work | Effort |
|---|---|---|
| S6.1 | Confirm SUPV-001 active in DB; verify SCORE_AGENT picks it up; if not, extend executor's spec loader | 0.5 d |
| S6.2 | Reconcile REW-001 parameter ids ↔ registry canonical form; decide alias-walking vs renaming | 0.3 d |
| S6.3 | Extend `compute-reward.ts` to write per-param CallScores through chokepoint | 0.8 d |
| S6.4 | Live verification on hf_staging (sim a call; SQL CallScore for the 16 params) | 0.5 d |
| S6.5 | Drop parameter-coverage ratchet by 16; update parameter-loop-closure ratchet; lattice-chains entry | 0.3 d |

**Total estimate if A/A:** ~2.4 days
**Total estimate if B/A (new runner):** ~5 days (matches survey row)
**Total estimate if B/B (new runner + reward refactor):** ~6 days

---

## Risk flags

- **Spec / registry convention mismatch** — Risk 4 surfaced a real gap: snake_case parameter ids in REW-001.spec.json don't match the BEH-* registry canonical. This needs a one-line decision before implementation.
- **L4 landmine pressure** — The inline `aggregateCallerTargets()` in route.ts (L4 of PIPELINE.md) has been "extract when a follow-up touches it" for months. S6 is the natural follow-up. Either tackle it here or explicitly defer.
- **Idempotency** — SCORE_AGENT has no executor-level idempotency gate (per-spec only). If SUPV-001 runs twice (force=true), 11 CallScores get duplicated unless the spec's runner is idempotent. Need to verify.
- **`composite_reward` as a derived parameter** — If we write it as a 5th CallScore (per Fork 2 Option A), the math becomes load-bearing in the writer. If pedagogy ever revises the weights (0.3/0.25/0.25/0.2), every historical CallScore for it is stale. Consider: read-side derivation (compose-time) avoids that, but parameter-coverage will flag it.

---

## Recommendation summary

1. **Fork 1 — Option A.** Extend SCORE_AGENT to consume SUPV-001 (already shaped right). No new runner; no new chain row.
2. **Fork 2 — Option A (lighter shape).** Extend `compute-reward.ts` to mirror RewardScore.parameterDiffs into per-param CallScore writes via the chokepoint.
3. **Fork 5 — Defer L4 landmine extraction.** Worth doing but expands S6 scope significantly; file as a follow-on.
4. **Convention question 3 — Walk aliases in parameter-coverage test.** Less disruptive than renaming canonical ids. The test's `searchTerms()` helper already does kebab → camel → SCREAMING_SNAKE; extending to walk the registry's `aliases[]` is a 5-line change.
5. **Question 4 — Move `BEH-ERROR-ELABORATION` to S2 (learning-adaptation) follow-on.** It's not a reward parameter on inspection; it's a learning-style directive.

If approved as stated, implementation drops to ~2.4 days and S6 becomes
the simplest sub-epic, not the hardest.

---

## Verified by

- [verified] SUPV-001 spec exists with all 11 parameter rows: read `docs-archive/bdd-specs/SUPV-001-agent-supervision.spec.json` lines 87-660; counted 13 parameters total (11 in the producer-only list, 2 outside).
- [verified] REW-001 spec exists with 5 parameter rows (`engagement_reward`, `learning_reward`, `rapport_reward`, `goal_progress_reward`, `composite_reward`): `docs-archive/bdd-specs/REW-001-reward-computation.spec.json` lines 77-413.
- [verified] SUPV-001 `outputType: "MEASURE_AGENT"` AND `specRole: "EXTRACT"`: spec line 9 + 698.
- [verified] PIPELINE.md §1 table confirms `MEASURE_AGENT` outputType is processed by SCORE_AGENT stage: docs/PIPELINE.md line 26.
- [verified] PIPELINE.md L4 landmine confirms inline `aggregateCallerTargets()` in route.ts is the L4 architectural debt point: docs/PIPELINE.md line 253.
- [verified] `compute-reward.ts` writes `RewardScore` not per-param `CallScore`: `lib/ops/compute-reward.ts` lines 1-22 header + module structure.
- [verified] Existing SUPERVISE executor at `route.ts:4015-4046` does target-clamping (validateTargets + aggregateCallerTargets), NOT spec-driven measurement.
- [verified] Parameter-coverage test uses a budget ratchet (`EXPECTED_EXEMPT_COUNT_INITIAL_BUDGET = 118`), not a per-row exempt list — so wiring 16 consumers drops `gaps.length` by 16 without explicit exempt-list edits: `tests/lib/measurement/parameter-coverage.test.ts:197+260-281`.
- [verified] Registry uses BEH-* canonical IDs with snake_case in `aliases[]` for the supervision params (e.g. `BEH-RESPONSE-LENGTH-SCORE` carries `response_length_score` as alias): `behavior-parameters.registry.json:2256-2265`.

## CI Docs Skip

docs-only PR — no CI/infra changes. Pure design brief for orchestrator review.
