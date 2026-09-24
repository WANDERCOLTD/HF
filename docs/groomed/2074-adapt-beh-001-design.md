# Groomed Design Brief — ADAPT-BEH-001 + adapt-runner extension

**Issue:** #2074
**Branch:** `docs/2074-adapt-beh-001-design`
**Status:** Design — awaiting operator decisions on open questions before coding

---

## Summary

BEH-AGG-001 (commit `a8234bf3`) closed the MEASURE → AGGREGATE leg of the
`beh-aggregate-cascade` Lattice chain. The ADAPT leg remains a `❌ GAP` in
`docs/lattice-chains.md`. This brief specifies ADAPT-BEH-001 — the spec that
reads the aggregated `behavior_profile:*` CallerAttribute rows and writes
adjusted `CallerTarget` rows — and the minimal runner extension that makes it
work.

**Pipeline position:** AGGREGATE → **ADAPT** → SUPERVISE → COMPOSE.
**Affected Lattice chain row:** `beh-aggregate-cascade:adapt-leg` (pipeline section, docs/lattice-chains.md).
**PIPELINE.md reference:** §1 stage table (ADAPT stage) and §7 ADAPT sub-ops.

---

## A. Runtime intent

### Who sees this

Operators (EDUCATOR / ADMIN role) see the downstream effect in two places:

1. **Caller detail panel — "Behavior Targets" section.** After ADAPT-BEH-001
   fires, `CallerTarget` rows for BEH-* parameters will drift away from the
   playbook-level defaults. The panel already surfaces `CallerTarget.targetValue`
   with source attribution. No new UI surface is required for first pass.
2. **Composed prompt.** The `targets.ts` transform reads `CallerTarget.targetValue`
   at compose time. When the ADAPT-BEH-001 output raises `BEH-EMPATHY-RATE` for
   a caller who consistently scores low on `behavior_profile:companion:empathy_level`,
   the next session's prompt directive will reflect the higher target — making the
   tutor place more emphasis on empathy with that specific learner.

Operators do **not** need to action anything. ADAPT-BEH-001 is an autonomous
background signal. The operator-facing surface is read-only (view the target
that the system derived).

### User-visible effect

Before ADAPT-BEH-001: every learner in a playbook starts with the same
`BehaviorTarget` defaults (e.g. `BEH-WARMTH = 0.7`). After 5+ calls the
aggregated profile may reveal the tutor consistently under-delivers on empathy
for learner X. Without ADAPT-BEH-001, that insight never changes the
system's target. With ADAPT-BEH-001, the CallerTarget for `BEH-EMPATHY-RATE`
is bumped to `0.8` on the next call, and the compose prompt's directive
becomes stronger — the tutor is guided to be warmer with this specific learner.

### Where ADAPT outputs land

**Canonical pattern:** `CallerTarget` row upsert (per `adapt-runner.ts:291-308`).
This is identical to what `ADAPT-PERS-001`, `ADAPT-VARK-001`, `DISC-ADAPT-001`
all do: `prisma.callerTarget.upsert({ where: { callerId_parameterId }, data: { targetValue, confidence } })`.

**ADAPT-BEH-001 must follow the same pattern.** No `BehaviorTarget` row writes
from ADAPT; no `TargetUpdate` audit rows in first pass. Rationale:

- `BehaviorTarget` rows are operator-set; ADAPT writing there would merge
  system-derived signals into the operator's explicit config space — wrong layer.
- `TargetUpdate` audit trail is a Phase 2 concern (see §E failure modes and
  open question Q3).
- `CallerTarget` is the correct write surface: it is the per-caller ADAPT
  output store that compose and the goals system already read.

**Resolution cascade (highest to lowest priority):**
`CallerTarget.targetValue` > `BehaviorTarget(scope=CALLER)` > `BehaviorTarget(scope=PLAYBOOK)` > `BehaviorTarget(scope=DOMAIN)` > `BehaviorTarget(scope=SYSTEM)`.

ADAPT-BEH-001 writes to the top of this cascade — its outputs immediately take
effect at the next compose cycle without any bump required (compose reads
`CallerTarget` directly).

---

## B. Spec semantics — per-bucket adaptation rules

### Approach decision

The 9 BEH-AGG-001 groups produce categorical string values (`"high"`, `"low"`,
`"deep"`, `"moderate"`, `"honoured"`, `"drift"`, etc.). ADAPT-BEH-001 reads
these string values from `CallerAttribute(scope="BEH-AGG-001")` using the
existing `dataSource: "callerAttribute"` lookup pattern (new data source path
— see §C for the runner extension).

**Condition operator used:** `"in"` with a set of categorical values. This is
simpler and more stable than numeric thresholds (which belong to the MEASURE
layer, not the ADAPT layer). Example:

```json
{
  "condition": {
    "profileKey": "behavior_profile:companion:empathy_level",
    "operator": "in",
    "values": ["emerging", "no_evidence"],
    "dataSource": "callerAttribute"
  },
  "actions": [
    {
      "targetParameter": "BEH-EMPATHY-RATE",
      "adjustment": "increase",
      "delta": 0.1,
      "rationale": "Tutor consistently under-delivers on empathy — raise the target"
    }
  ]
}
```

### Phase 1: 3 representative buckets (fully spec'd)

The remaining 6 buckets are deferred to Phase 2 (declared below).

#### Bucket 1 — `companion` (most immediately learner-visible)

| AGGREGATE key | ADAPT fires when | Target adjusted | Direction | Delta |
|---|---|---|---|---|
| `behavior_profile:companion:empathy_level` | `in ["emerging", "no_evidence"]` | `BEH-EMPATHY-RATE` | increase | 0.10 |
| `behavior_profile:companion:empathy_level` | `in ["mastery", "secure"]` | `BEH-EMPATHY-RATE` | decrease | 0.05 |
| `behavior_profile:companion:engagement_level` | `= "low"` | `BEH-ENGAGEMENT` | increase | 0.10 |
| `behavior_profile:companion:question_rate` | `= "rare"` | `BEH-QUESTION-RATE` | increase | 0.10 |
| `behavior_profile:companion:question_rate` | `= "frequent"` | `BEH-PROACTIVE` | increase | 0.05 |

**Activation:** every call. The companion group has `minimumObservations: 3` in
BEH-AGG-001 — if the AGGREGATE row doesn't exist yet, the runner skips (see §E
failure modes).

#### Bucket 2 — `supervision` (agent-quality feedback loop)

The supervision bucket aggregates SUPV-001 scores (agent-side compliance). ADAPT
reads the *tutor's* per-caller compliance fingerprint and tightens targets where
the tutor is drifting.

| AGGREGATE key | ADAPT fires when | Target adjusted | Direction | Delta |
|---|---|---|---|---|
| `behavior_profile:supervision:tutor_fidelity` | `= "low"` | `BEH-INSTRUCTOR-CLARITY` | increase | 0.10 |
| `behavior_profile:supervision:style_consistency` | `= "inconsistent"` | `BEH-FORMALITY` | set | 0.6 |
| `behavior_profile:supervision:target_alignment` | `= "misaligned"` | `BEH-DIRECTNESS` | increase | 0.05 |
| `behavior_profile:supervision:safety_compliance` | `= "marginal"` | `BEH-WARMTH` | decrease | 0.05 |

**Activation:** every call. Supervision bucket has `minimumObservations: 2` and
`recencyWeight: 0.8` — fast-responding by design (safety signals should not need
many sessions).

**Semantics note:** these are tutor-side targets, not learner-side. When
`tutor_fidelity = "low"`, it means the agent consistently failed to honour its
own target. Raising `BEH-INSTRUCTOR-CLARITY` sharpens the prompt directive
instructing it to stay on topic — a form of self-correction via ADAPT.

#### Bucket 3 — `engagement`

| AGGREGATE key | ADAPT fires when | Target adjusted | Direction | Delta |
|---|---|---|---|---|
| `behavior_profile:engagement:cognitive_activation` | `= "low"` | `BEH-INTELLECTUAL-CHALLENGE` | increase | 0.10 |
| `behavior_profile:engagement:cognitive_activation` | `= "high"` | `BEH-INTELLECTUAL-CHALLENGE` | decrease | 0.05 |
| `behavior_profile:engagement:call_frequency_fidelity` | `= "drift"` | `BEH-ENGAGEMENT` | set | 0.8 |

**Activation:** every call.

### Phase 2 — remaining 6 buckets (deferred)

Declared as Phase 2 follow-on work. One-line rationale per bucket:

| Bucket | Deferred reason |
|---|---|
| `personality` | The B5 adaptation is already handled by `ADAPT-PERS-001` reading from `parameterValues`. ADAPT-BEH-001 should not double-fire; needs a conflict analysis first (open question Q2). |
| `curriculum` | Curriculum fidelity signals belong in `ADAPT-CURR-001` (if it exists) — check before authoring a second curriculum adaptor. |
| `learning` | Feedback-style and interaction-style fidelity signals partially overlap with `ADAPT-LEARN-001`; same conflict risk as personality. |
| `reinforcement` | Reward-trend signals (composite, engagement reward, mastery reward) should inform `REWARD` stage weighting, not `ADAPT` target tuning. Design not yet settled. |
| `onboarding` | `behavior_aggregate_onboarding` uses `windowSize: 1, minimumObservations: 1` — adapting from a single call is premature; needs a floor of 2 confirmed observations. |
| `core_style` | `behavior_profile:style:exploration_structure_balance` maps cleanly to `BEH-EXPLORATION-STRUCTURE` but ADAPT-VARK-001 already touches similar style dimensions. Phase 2 after conflict analysis. |

---

## C. Adapt-runner extension

### What changes in `lib/pipeline/adapt-runner.ts`

**Minimal extension: add a new `dataSource` type — `"callerAttribute"`.**

Current `adapt-runner.ts::applyAdaptationRules` resolves condition values
from two sources (lines 221-226):

```typescript
if (rule.condition.dataSource === "parameterValues") {
  profileValue = parameterValues[rule.condition.profileKey] ?? null;
} else {
  profileValue = getProfileValue(learnerProfile, rule.condition.profileKey);
}
```

The `learnerProfile` path reads `CallerAttribute(scope=LEARNER_PROFILE)` keys
via `getLearnerProfile(callerId)` — a structured object with 8 named fields.
The BEH-AGG-001 keys live at `scope="BEH-AGG-001"` with arbitrary `targetProfileKey`
strings — they do not fit the `LearnerProfile` typed object.

**Required change:** add a third branch:

```typescript
else if (rule.condition.dataSource === "callerAttribute") {
  profileValue = await readCallerAttribute(
    callerId,
    rule.condition.profileKey,    // e.g. "behavior_profile:companion:empathy_level"
    rule.condition.scope ?? "BEH-AGG-001",  // default scope
  );
}
```

Where `readCallerAttribute` is a new thin helper:

```typescript
async function readCallerAttribute(
  callerId: string,
  key: string,
  scope: string,
): Promise<string | null> {
  const row = await prisma.callerAttribute.findUnique({
    where: { callerId_key_scope: { callerId, key, scope } },
    select: { stringValue: true },
  });
  return row?.stringValue ?? null;
}
```

**Why `scope` is a field on the condition, not hardcoded:** future ADAPT specs
may want to read from other aggregate scopes (e.g. `"DISC-AGG-001"`). Making
scope configurable in the spec JSON keeps the runner contract-based per the
existing `adapt-runner.ts` design principle (file header: "Contract-based — NO
HARDCODING of profile keys or parameters").

### The `scope` field on `AdaptCondition` — type change

Add to the `AdaptCondition` interface:

```typescript
scope?: string;  // CallerAttribute scope — used when dataSource = "callerAttribute". Defaults to "BEH-AGG-001".
```

### Activation frequency — alignment with BEH-AGG-001

BEH-AGG-001 uses per-section `minimumObservations` (3 for most groups; 2 for
supervision and curriculum; 1 for onboarding). The ADAPT stage runs after
AGGREGATE on every call (`route.ts::stageExecutors.ADAPT`). This is correct:
the runner should **always** attempt to read the AGGREGATE rows and fire rules
where the condition matches. If AGGREGATE rows don't exist yet
(`minimumObservations` not yet met), the `readCallerAttribute` call returns
`null` and `evaluateCondition` returns `false` — the rule silently skips.
No N-call window logic is needed in ADAPT-BEH-001. BEH-AGG-001's own
window semantics are the gate.

**No change to calling convention.** ADAPT-BEH-001 is picked up by the existing
`runAdaptSpecs(callerId)` loop at `route.ts::stageExecutors.ADAPT` because it
has `outputType: "ADAPT"`. No new runner entry point is needed.

### DB tables written

Same as existing ADAPT specs: `prisma.callerTarget.upsert`. No new tables.
No migration needed.

---

## D. Sibling-writer survey

Per `.claude/rules/lattice-survey.md`, the following survey was conducted before
writing this brief.

### Writers to `CallerTarget`

| Writer | Intent | Path |
|---|---|---|
| `adapt-runner.ts::applyAdaptationRules` | ADAPT stage — per-spec target adjustments | `lib/pipeline/adapt-runner.ts:291` |
| `aggregate-runner.ts::accumulateSkillScores` | AGGREGATE stage — EMA skill score → `currentScore` field only | `lib/pipeline/aggregate-runner.ts:269` |
| `enrollment/instantiate-targets.ts` | Enrollment — pre-creates placeholder rows | `lib/enrollment/instantiate-targets.ts` |
| `writeBehaviorTarget` / `writeCallerBehaviorTarget` | Operator manual edit or chat-tool | `lib/agent-tuner/write-target.ts:48,175` |

**Drift risk assessment:**

1. `accumulateSkillScores` writes only `currentScore` and `lastScoredAt`/`callsUsed`
   — it never touches `targetValue`. ADAPT-BEH-001 writes only `targetValue`
   and `confidence`. **No column collision.**

2. `writeCallerBehaviorTarget` writes `BehaviorTarget(scope=CALLER)`, NOT
   `CallerTarget`. Different table. **No collision.**

3. `instantiate-targets.ts` seeds `targetValue: 1.0` as a placeholder. The
   adapt-runner's upsert will overwrite this after sufficient observations.
   **Desired behaviour — no conflict.**

4. **Operator-vs-ADAPT conflict:** `writeBehaviorTarget(scope=PLAYBOOK)` sets
   the playbook-default, which is at a lower priority than `CallerTarget.targetValue`.
   An operator setting `BEH-EMPATHY-RATE = 0.5` at playbook scope is overridden
   by a ADAPT-BEH-001 write of `targetValue = 0.7` at the CallerTarget layer.
   This is the correct cascade order but may surprise operators. **See open
   question Q1.**

5. **Sibling ADAPT spec conflict:** `ADAPT-PERS-001` writes `BEH-WARMTH`,
   `BEH-DIRECTNESS`, `BEH-EMPATHY-RATE`, `BEH-RESPONSE-LEN`, `BEH-PAUSE-TOLERANCE`,
   `BEH-PROACTIVE`. Some of these overlap with ADAPT-BEH-001's Phase 1 targets
   (`BEH-EMPATHY-RATE`, `BEH-PROACTIVE`). Both specs write to the same
   `CallerTarget` row via upsert — the last write in the pipeline wins.
   **Pipeline execution order matters.** The adapt-runner iterates specs in
   `prisma.analysisSpec.findMany` order (no guaranteed ordering). **See open
   question Q2.**

### Convergence decision for operator-locked targets

**Decision (for Phase 1):** ADAPT-BEH-001 writes `source: "ADAPT"` on the
`CallerTarget` row (new `source` field, see open question Q3). If a CALLER-scoped
`BehaviorTarget` row exists (set by the operator explicitly for this caller), the
ADAPT write still proceeds — CallerTarget is the higher-priority layer so the
ADAPT output takes precedence. This is intentional: per-learner adaptation
should win over the operator's course-wide override for individual learners.

However, when a `BehaviorTarget(scope=CALLER)` row exists with `source=MANUAL`,
**open question Q1 must be answered** before coding whether ADAPT should check
for an explicit caller-level operator lock and skip.

### AI-to-DB guard registration

Per `.claude/rules/ai-to-db-guard.md`, ADAPT-BEH-001 writes AI-derived values
into `CallerTarget.targetValue`. This is a NEW chokepoint that must be catalogued.

**Existing guards that apply:**
- The `adapt-runner.ts` already validates `parameterId` against the live adjustable
  BEHAVIOR catalogue (`prisma.parameter.findUnique`) before writing. This guard
  covers ADAPT-BEH-001 too — no new guard needed for the parameterId whitelist.
- `targetValue` is already clamped to `[0, 1]` in `applyAdaptationRules:288`.

**New guard needed:** the `readCallerAttribute` helper must guard against
returning values from the wrong scope. The default `scope = "BEH-AGG-001"` must
be validated — a typo in a spec's `condition.scope` could cause the runner to
read from an unrelated CallerAttribute bucket and fire spurious rules.

**Proposed guard:** at spec load time (`runAdaptSpecs`), reject any rule with
`dataSource: "callerAttribute"` where `scope` is neither a known AGGREGATE spec
slug nor `null` (defaulting to `"BEH-AGG-001"`). Validate against the list of
active AGGREGATE spec slugs loaded in the same query.

This guard must be documented in `.claude/rules/ai-to-db-guard.md` as a new
chokepoint row.

---

## E. Failure modes

### E1 — AGGREGATE rows don't exist yet

**Scenario:** ADAPT-BEH-001 fires on call #1 or #2 before `minimumObservations`
is met.

**Handling:** `readCallerAttribute` returns `null`. `evaluateCondition` with
`null` profileValue returns `false` (existing behaviour at `adapt-runner.ts:61`).
The rule silently skips. Zero `CallerTarget` writes. Runner returns
`{ rulesFired: 0 }` which is logged but not an error.

**No special handling needed.** The null-guard in `evaluateCondition` already
covers this case.

### E2 — Operator-locked BehaviorTarget

**Scenario:** an operator explicitly set `BEH-EMPATHY-RATE = 0.3` for a caller
via the chat tuning tool (stored as `BehaviorTarget(scope=CALLER)`). ADAPT-BEH-001
wants to write `CallerTarget.targetValue = 0.7`.

**Decision needed (open question Q1).**

Two options:
- **Option A (recommended for Phase 1):** ADAPT writes regardless. The cascade
  (`CallerTarget > BehaviorTarget(CALLER) > ...`) means the CallerTarget value
  always wins. The operator's explicit CALLER-scope override is silently trumped.
  This is simple but may violate operator intent.
- **Option B:** Before writing, check if a `BehaviorTarget(scope=CALLER,
  source=MANUAL)` row exists for this caller+parameter. If yes, skip the write
  and log `adapt.beh.skipped_operator_locked`. This respects explicit operator
  intent but adds a DB query per action.

**Provisional decision for this brief:** Option A, with the `source: "ADAPT"`
field (Q3) making the write attributable and reversible. If the operator observes
unexpected target changes, they can reset via the UI and the next ADAPT cycle
will re-apply — exposing the tension explicitly rather than hiding it.

### E3 — Pipeline aborts mid-ADAPT

**Scenario:** ADAPT-BEH-001 fires rules 1–3, then the process crashes. Rules
4–5 never execute.

**Handling:** `adapt-runner.ts` uses individual `prisma.callerTarget.upsert`
calls (not a transaction). Partial writes are durable — rules 1–3's outputs
survive. On the next pipeline run (next call), rules 1–3 re-evaluate and may
re-write (idempotent via upsert). Rules 4–5 will fire if their conditions still
hold.

**No partial-write recovery story needed.** Upsert idempotency is sufficient
for Phase 1. The only risk is a temporary inconsistency between CallerTarget
rows for the same spec if rules target the same parameter. The existing spec
design avoids this — each rule in Phase 1 targets a different `parameterId`.

### E4 — Minimum-observation divergence between AGGREGATE and ADAPT

**Scenario:** `minimumObservations: 3` in BEH-AGG-001 companion group, but
ADAPT fires on call #3 before the AGGREGATE stage has had time to compute the
current call's contribution (AGGREGATE runs before ADAPT in the pipeline — this
is fine). The AGGREGATE row for call #3 is written; ADAPT reads it on the same
pipeline run.

**This is the correct behaviour** — the pipeline ordering (AGGREGATE then ADAPT)
guarantees ADAPT always reads the freshest AGGREGATE output. No issue.

---

## F. Test plan

### F1 — Unit: `readCallerAttribute` helper

File: `tests/lib/pipeline/adapt-beh-001-caller-attribute-read.test.ts`

- Returns `null` when no row exists for (callerId, key, scope)
- Returns `stringValue` when row exists
- Uses exact scope match — wrong scope returns `null`

### F2 — Unit: ADAPT rule evaluation with `dataSource: "callerAttribute"`

File: `tests/lib/pipeline/adapt-runner-caller-attribute.test.ts`

Extend the existing `adapt-runner` vitest pattern (mirrors `evaluateCondition`
export):

- Rule with `operator: "in", values: ["emerging", "no_evidence"]` fires when
  CallerAttribute value is `"emerging"`, skips when value is `"moderate"`
- Rule skips when CallerAttribute row is absent (null path)
- Rule fires correctly for each Phase 1 bucket (companion, supervision, engagement)
- `scope` field on condition: runner reads from the declared scope, not default

### F3 — Round-trip: AGGREGATE writes → ADAPT reads → expected CallerTarget delta

File: `tests/lib/pipeline/adapt-beh-001-roundtrip.test.ts`

Spec: seed a caller with `CallerAttribute(scope="BEH-AGG-001", key="behavior_profile:companion:empathy_level", stringValue="emerging")`. Run `runAdaptSpecs(callerId)` with ADAPT-BEH-001 active. Assert `CallerTarget(callerId, "BEH-EMPATHY-RATE").targetValue` increases by 0.10 from the baseline.

Cover the Phase 1 three-bucket rules (companion, supervision, engagement).

### F4 — End-to-end: full beh-aggregate-cascade chain

If e2e is feasible on the sim runner:

```
sim call → SCORE_AGENT (BEH-* CallScore) → AGGREGATE (BEH-AGG-001 CallerAttribute)
         → ADAPT (ADAPT-BEH-001 CallerTarget) → COMPOSE (targets.ts reads targetValue)
```

Assert: after N >= 3 calls, the composed prompt's `targets` section includes a
directive referencing the adjusted `BEH-EMPATHY-RATE` value.

This test exercises `docs/lattice-chains.md`'s `beh-aggregate-cascade` chain
end-to-end and can close the GAP row once green.

---

## Acceptance criteria (for the story that builds from this brief)

- [ ] `ADAPT-BEH-001-behavior-adaptation.spec.json` created in
  `docs-archive/bdd-specs/` with Phase 1 companion, supervision, and engagement
  adaptation rules
- [ ] `lib/pipeline/adapt-runner.ts` — `AdaptCondition.dataSource` extended to
  accept `"callerAttribute"`; `readCallerAttribute` helper added; existing
  `dataSource: "learnerProfile"` and `"parameterValues"` paths unchanged
- [ ] `AdaptCondition.scope?: string` added — used when
  `dataSource = "callerAttribute"`; defaults to `"BEH-AGG-001"`
- [ ] `tests/lib/pipeline/adapt-beh-001-caller-attribute-read.test.ts` passes
  (F1 above)
- [ ] `tests/lib/pipeline/adapt-runner-caller-attribute.test.ts` passes (F2 above)
- [ ] `tests/lib/pipeline/adapt-beh-001-roundtrip.test.ts` passes (F3 above)
- [ ] `docs/lattice-chains.md` — `beh-aggregate-cascade:adapt-leg` row updated
  from `❌ GAP` to at least `⚠️ PARTIAL` (gate = round-trip vitest)
- [ ] `.claude/rules/ai-to-db-guard.md` — new chokepoint row for
  ADAPT-BEH-001 `callerAttribute` data source guard (scope whitelist)
- [ ] `parameter-loop-closure.test.ts` ratchet passes — Phase 1 ADAPT-BEH-001
  should close 3+ loop-closure rows (companion, supervision, engagement params
  that had no ADAPT consumer)
- [ ] `PIPELINE.md §7` ADAPT sub-ops list updated to document the new
  `callerAttribute` data source
- [ ] V3/V4 paths unaffected — existing `ADAPT-PERS-001`, `ADAPT-VARK-001`,
  `DISC-ADAPT-001` specs continue to work unchanged (no regression in
  `dataSource: "parameterValues"` or `"learnerProfile"` paths)
- [ ] (Phase 2 — not in this story) Operator Q1 decision implemented if Option
  B chosen; companion conflict with ADAPT-PERS-001 resolved if Q2 decision is
  "add ordering"; `source: "ADAPT"` on CallerTarget if Q3 is approved

---

## Effort estimate

~6h: spec JSON authoring (1h) + runner extension (2h) + tests F1-F3 (2h) +
docs updates (1h). E2e test F4 adds ~2h if pursued in Phase 1.

No migration needed. `CallerTarget` table already exists. `CallerAttribute`
table already exists. Only application-layer changes.

**Deploy command:** `/vm-cp` (no schema change).

---

## Open questions for operator — design-level decisions needed before coding

### Q1 — Should ADAPT skip if an operator has explicitly locked a CallerTarget?

When a `BehaviorTarget(scope=CALLER, source=MANUAL)` row exists for a specific
learner and parameter, should ADAPT-BEH-001 respect it as an operator lock and
skip writing `CallerTarget.targetValue`?

- **Option A (simpler):** ADAPT always writes. The operator's manual override
  at the BehaviorTarget layer is still visible but CallerTarget overrides it.
  The operator must explicitly delete the CallerTarget row to restore their
  intent.
- **Option B (safer):** ADAPT checks for a CALLER-scoped MANUAL BehaviorTarget
  first and skips if found.

**Recommendation:** Option A for Phase 1 — explicit locks are rare in early
usage and Option B adds a DB query per action per rule. Re-evaluate after Phase 2
when there are real operator tuning patterns to study.

### Q2 — How should ADAPT-BEH-001 and ADAPT-PERS-001 coordinate on shared targets?

Both specs can write to `BEH-EMPATHY-RATE` and `BEH-PROACTIVE`. The
`runAdaptSpecs` loop runs them in `findMany` database-return order (no
guaranteed ordering). Last write wins.

Three options:
- **Option A:** No coordination. Accept last-write-wins. Document the ambiguity.
- **Option B:** Add an `outputPriority` field to ADAPT spec config (higher
  number wins). ADAPT-BEH-001 sets `outputPriority: 2`, ADAPT-PERS-001 sets
  `outputPriority: 1` — behaviour profile signals trump personality signals for
  the same parameter.
- **Option C:** ADAPT-BEH-001 Phase 1 avoids targeting parameters that
  ADAPT-PERS-001 already covers. Remove `BEH-EMPATHY-RATE` and `BEH-PROACTIVE`
  from Phase 1 companion rules; use other parameters instead.

**Recommendation:** Option C for Phase 1 (no coordination complexity). ADAPT-BEH-001
companion bucket targets `BEH-ENGAGEMENT`, `BEH-QUESTION-RATE`, and
`BEH-INTELLECTUAL-CHALLENGE` instead of the personality-owned parameters.
Defer Option B to Phase 2 if needed. Requires operator confirmation that
`BEH-ENGAGEMENT` and `BEH-QUESTION-RATE` are not already claimed by another
active ADAPT spec.

### Q3 — Should `CallerTarget` carry a `source` discriminator?

The `adapt-runner.ts` writes `CallerTarget` rows but the schema does not have a
`source` field — there is no way to distinguish a CallerTarget set by ADAPT from
one set by the enrollment placeholder. `write-target.ts` has a `BehaviorTargetSource`
enum (`MANUAL | ADAPT | SYSTEM`) but `CallerTarget` is a different table.

Options:
- **Option A:** Leave `CallerTarget` without a source field. Attribution comes
  from the `confidence` value — ADAPT-BEH-001 writes `confidence: 0.75`
  (spec-level `defaultAdaptConfidence`) vs enrollment placeholders which write
  `targetValue: 1.0, confidence: null`.
- **Option B:** Add `source: BehaviorTargetSource` column to `CallerTarget`
  (requires migration). Enables operators and the UI to surface "this target was
  set by ADAPT, not by you".

**Recommendation:** Option A for Phase 1 to avoid a migration. Revisit in Phase 2
alongside the TargetUpdate audit trail story. A migration is justified only once
there is UI surface to display the attribution.

### Q4 — Should ADAPT-BEH-001 be gated on `profileCondition`?

ADAPT-PERS-001 has no `profileCondition` gate (fires for all callers). `DISC-ADAPT-001`
has `"profileCondition": ["discussion-led"]` — it only fires for courses where
the discussion teaching mode is active.

Should ADAPT-BEH-001 fire for ALL courses, or only for specific
`interactionPattern` values (e.g. `"companion"` for the companion bucket)?

- **Option A (recommended):** No `profileCondition` gate. The companion bucket's
  rules are safe to evaluate for any course — if the `behavior_profile:companion:*`
  CallerAttribute rows don't exist (because the course doesn't score
  companion-mode BEH params), the rules simply skip.
- **Option B:** Gate companion-bucket rules on `profileCondition: ["companion",
  "conversational-guide"]` so they only run for courses where companion-mode is
  active. Cleaner separation but requires the profileCondition field to be
  evaluated per-parameter-group, not per-spec. The runner doesn't support
  per-parameter-group gating today.

**Recommendation:** Option A. The null-guard in `evaluateCondition` provides
natural gating without new gate logic.

### Q5 — Confirm Phase 2 exclusion list

Before coding Phase 1, confirm the operator agrees the following 6 buckets
are deferred and no urgent adaptation signal requires them in the initial
implementation:

- `personality` (overlap with ADAPT-PERS-001)
- `curriculum` (overlap risk with ADAPT-CURR-001 if it exists)
- `learning` (overlap risk with ADAPT-LEARN-001)
- `reinforcement` (belongs at REWARD stage, not ADAPT)
- `onboarding` (single-observation window too narrow)
- `core_style` (overlap risk with ADAPT-VARK-001)

If the operator believes one of these has an urgent use case, promote it to
Phase 1 and clarify the conflict resolution for the overlapping spec.

---

## Appendix — key source files

| File | Role in this story |
|---|---|
| `apps/admin/lib/pipeline/adapt-runner.ts` | PRIMARY EDIT — add `callerAttribute` dataSource |
| `apps/admin/docs-archive/bdd-specs/BEH-AGG-001-behavior-aggregation.spec.json` | Source of truth for AGGREGATE output keys |
| `apps/admin/docs-archive/bdd-specs/ADAPT-PERS-001-personality-adaptation.spec.json` | Canonical ADAPT spec pattern |
| `apps/admin/docs-archive/bdd-specs/DISC-ADAPT-001-discussion-adaptation.spec.json` | Most recent ADAPT spec (2026-04-06) |
| `apps/admin/lib/pipeline/aggregate-runner.ts:526-546` | CallerAttribute write pattern with `scope: specSlug` |
| `apps/admin/lib/agent-tuner/write-target.ts` | BehaviorTarget write path — must NOT be used by ADAPT |
| `docs/lattice-chains.md` (Pipeline section) | Row to update from GAP → PARTIAL |
| `docs/PIPELINE.md §7` | ADAPT sub-ops — update after runner extension |
| `.claude/rules/ai-to-db-guard.md` | New chokepoint row required |
