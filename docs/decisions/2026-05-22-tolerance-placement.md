# ADR: Tolerance placement — where every tunable knob lives

**Date:** 2026-05-22 (filename pinned; ratified 2026-05-25)
**Status:** Proposed
**Deciders:** Paul W, AI planning session
**Related:** [#598 — Course Tuning epic](https://github.com/WANDERCOLTD/HF/issues/598), [#599 — priorCallRecap v2 epic](https://github.com/WANDERCOLTD/HF/issues/599), [scheduler-owns-the-plan](2026-04-14-scheduler-owns-the-plan.md), [outcome-graph-pacing](2026-04-14-outcome-graph-pacing.md)

## Context

The adaptive loop has accumulated dozens of numeric and boolean knobs — mastery threshold, retrieval cadence, memory decay, prior-call recap depth, first-call mode, evidence-gate windows, EMA half-lives, daily caps. Each was added by whichever transform or loader needed it, and lives wherever the author found convenient at that moment. The result:

- The same conceptual knob is read from three different sources in three files (e.g. `masteryThreshold` is hardcoded at `0.7` in 8 places in `transforms/modules.ts`, also at `specConfig.metadata.curriculum.masteryThreshold`, also at `ContractRegistry.getThresholds`, also at `Playbook.config` for some courses).
- It's unclear to an educator who can change what — some knobs are exposed in the UI, some require redeploy, some require platform-team intervention.
- It's unclear to a developer who can change what — when you add a new knob, there's no decision tree for which storage layer it belongs in, so the next person picks differently again.
- Per-learner overrides land alongside playbook-wide overrides without a typed boundary, masking the audience.

This ADR closes that gap with a small classification framework. Every new knob picks a bucket; reads cascade in a documented order; writes are gated by audience.

This ADR is **shared** with the priorCallRecap v2 epic (#599) — both epics introduce new `PlaybookConfig` fields, and both must classify them under the same rubric. Do not write a duplicate ADR for #599.

## Decision

**Every tunable knob in the adaptive loop falls into exactly one of three buckets.** The bucket determines storage, edit surface, and write audit policy.

### The 3-bucket framework

| Bucket | Storage | Edit surface | Audited? | When to use |
|---|---|---|---|---|
| **1 — Course parameter** | `Playbook.config.<field>` (structured/enum) or `BehaviorTarget(scope=PLAYBOOK)` (0-1 scalar) | Educator UI (PromptTunerSidebar, CourseDesignTab, wizard) | Yes — `AuditLog` with `action: PLAYBOOK_CONFIG_WRITE` | The knob is a *pedagogical choice* an educator owns for the lifetime of this course. Different courses can reasonably hold different values. |
| **2 — System default** | Hardcoded constant in a single canonical resolver, OR `SystemSetting` row for admin-managed feature flags/allowlists, OR env var kill switch | Platform-team only (PR + deploy) | No (single resolver + commit history is the audit) | The knob is a *platform invariant*: a safe baseline that should apply to every course unless explicitly overridden. Changes are rare and reviewed at PR time. |
| **3 — Per-learner adaptation** | `BehaviorTarget(scope=CALLER)` (0-1 scalar) or `CallerAttribute(scope=TOLERANCE, valueType=JSON)` (structured) | Educator UI scoped to a single learner (PromptTunerSidebar in learner mode) | Yes — `AuditLog` with `action: TOLERANCE_WRITE` | The knob differs *for this specific learner* and would be wrong to apply playbook-wide. Always layered on top of a Bucket-1 default, never replacing it. |

### Cascade resolution order

Reads always traverse the cascade top-down, first non-null wins:

1. **Bucket 3** — per-caller (`CallerAttribute(TOLERANCE)` first, then `BehaviorTarget(CALLER)`)
2. **Bucket 1** — per-playbook (`Playbook.config.<field>` first, then `BehaviorTarget(PLAYBOOK)`)
3. **Preset / archetype default** — if the field is preset-managed, the scheduler preset or subject teaching profile supplies a default
4. **Spec config** — `specConfig.metadata.<field>` from the relevant spec
5. **`ContractRegistry`** — DataContract thresholds (for legacy fields not yet promoted to spec config)
6. **Bucket 2** — hardcoded fallback at the bottom of the resolver

Every resolver logs the winning layer to console on every call. There is no silent fallback — if all six layers resolve null, the resolver throws (no implicit zero).

### Write audience invariant

A field's bucket determines who can write it, structurally enforced:

- **Bucket 1 writes** go through `applyBehaviorTargets(scope=PLAYBOOK)` or a `PATCH /api/playbooks/[id]` route. Educator-facing UI surfaces show the field for the course.
- **Bucket 2 writes** are code changes: a `git commit` to the resolver, or a `SystemSetting` upsert via an admin-only CLI. No runtime API.
- **Bucket 3 writes** go through `applyCallerTargets(scope=CALLER)` or `PATCH /api/callers/[id]/tolerances`. Educator-facing UI surfaces show the field in learner mode only, and the cascade source label says "(course default)" until a per-learner value is set.

A field cannot live in two buckets at once. A field intentionally exposed to all three layers (e.g. `masteryThreshold`) is **Bucket 1 with optional Bucket 3 override** — the cascade reads Bucket 3 first, then falls back to Bucket 1. The Bucket-2 hardcoded default at the bottom is for "this resolver was called with no playbook context at all" — a system-level safety net, not a routine path.

## Examples (the inventory the next two epics use)

### From #598 (Course Tuning)

| Knob | Bucket | Notes |
|---|---|---|
| `tolerances.masteryThreshold` (0–1) | **1 + 3** | Educator default per course; per-learner override via `BehaviorTarget(CALLER)` for `TOL-MASTERY-THRESHOLD` parameter. Cascade layer 1 = caller, layer 2 = playbook, layer 6 = hardcoded `0.7`. |
| `tolerances.retrievalCadenceOverride` (positive integer) | **1 only** | Course-level only. Cadence is a course-wide rhythm; per-learner cadence would defeat interleaving. |
| `tolerances.memoryDecayScale` (0.1–1.0 multiplier) | **1 only** | Course-level only. Multiplies the category default in `CATEGORY_DECAY_DEFAULTS`; explicit per-assertion `decayFactor < 1.0` is not double-penalised. |
| `firstCallMode` (`onboarding` \| `teach_immediately` \| `baseline_assessment`) | **1 only** | Already shipped (#790). First-call posture is a pedagogical choice per course; no per-learner override planned. |
| `firstCall.durationMinsOverride` | **1 only** | Course-level only; per-learner first-call duration would surprise the learner relative to subsequent calls. |
| `firstCall.introducePedagogy` (boolean) | **1 only** | Course-level only. |

### From #599 (priorCallRecap v2)

| Knob | Bucket | Notes |
|---|---|---|
| `priorCallRecap.enabled` (boolean) | **1 only** | Per-course opt-in. Defaults to `false` until validated. |
| `priorCallRecap.depth` (`minimal` \| `standard` \| `rich`) | **1 only** | Pedagogical choice per course. |
| `priorCallRecap.dailyCap` (number) | **1 only** | Per-course rate limit; default 50. |
| `PRIOR_CALL_RECAP_SYNTHESIS_ENABLED` (env var) | **2** | System-level kill switch. When absent or not `"true"`, the loader short-circuits to the templated recap for every course. |
| `SystemSetting("prior_call_recap.allowlist")` (JSON array of playbookIds) | **2** | Admin-managed. Absent row + empty array both block synthesis for every playbook (safe default). |

### Counter-examples (what NOT to add)

- **Hardcoded `0.7` masteryThreshold in `transforms/modules.ts`** — violates buckets. Belongs in the resolver's Bucket 2 fallback only, read by every callsite. (Fixed by #598 Slice 1.)
- **`learningStructure: structured | continuous` repeated on both `Playbook.config` and `Curriculum.deliveryConfig`** — same field in two places, no cascade. Pick one bucket.
- **Per-learner `retrievalCadence`** — would let one learner break interleaving for their own session. Decline; explain "course-wide rhythm" in tooltip.

## Constraints on new fields

When adding a new tunable to `PlaybookConfig`, the JSDoc above the field MUST include a `@bucket` tag:

```typescript
export interface PlaybookConfig {
  /**
   * @bucket 1 — Course parameter
   * Mastery threshold above which a learner is considered to have mastered a TP.
   * Cascade: Bucket 3 (`BehaviorTarget(CALLER, TOL-MASTERY-THRESHOLD)`) → this →
   * preset `masteryThresholdOverride` → `specConfig.metadata.curriculum.masteryThreshold` →
   * `ContractRegistry.getThresholds('CURRICULUM_PROGRESS_V1').masteryComplete` →
   * hardcoded `0.7` (Bucket 2).
   * @see docs/decisions/2026-05-22-tolerance-placement.md
   */
  tolerances?: {
    masteryThreshold?: number;
    // ...
  };
}
```

The `arch-checker` agent flags `PlaybookConfig` field additions missing a `@bucket` tag (soft check — warning, not hard fail).

## Out of scope

- Schema enforcement of the cascade — no DB constraint, no runtime type wrapper. The resolver is the single point of truth.
- Migration of every legacy hardcoded knob today. This ADR sets the standard; each subsequent epic migrates the knobs in its scope (#598 does the tolerance set, #599 does the priorCallRecap set, future epics do the rest).
- A unified "tolerance editor" UI — current epics surface knobs in their natural homes (PromptTunerSidebar, CourseDesignTab). A unified editor can come later if the count grows past ~15.
- Visual indication in `buildComposeTrace` of which cascade layer won — console logs are the v1 mechanism; trace integration is a follow-up.

## Consequences

**Positive:**
- A developer adding a new knob has a 5-line decision tree, not a 30-min hunt through prior art.
- An educator looking at the UI knows what they can change (Bucket 1 + 3 fields surface; Bucket 2 does not).
- A code reviewer can point at `@bucket` tags and the `resolve-tolerance.ts` cascade as the contract.
- The 8 hardcoded `0.7` literals in `transforms/modules.ts` (#598 Slice 1) become a single bucket-2 fallback inside `resolveMasteryThreshold()`.

**Negative:**
- One more concept in the codebase glossary. Mitigated by being a small framework (3 buckets) with one canonical doc.
- Slight ceremony for adding a knob (the `@bucket` tag). Mitigated by arch-checker enforcement — the friction is in code review, not on a future learner's session.
- Resolver pattern adds an indirection that didn't exist before. Acceptable cost: every consumer of a tolerance now goes through a single typed function, which is the entire point.

## References

- `lib/types/json-fields.ts::PlaybookConfig` — JSDoc on this interface cites this ADR
- `lib/tolerance/resolve-tolerance.ts` (to be created in #598 Slice 1) — the cascade implementation for the first batch of fields
- `.claude/agents/arch-checker.md` — soft-check for `@bucket` tag on new `PlaybookConfig` fields
- `prisma/schema.prisma` — `BehaviorTargetScope { SYSTEM, PLAYBOOK, SEGMENT, CALLER }` and `CallerAttribute { scope }` are the storage primitives
