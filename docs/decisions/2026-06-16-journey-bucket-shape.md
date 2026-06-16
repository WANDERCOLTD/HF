# 2026-06-16 — Journey LH menu: 13 educator-intent buckets

**Status:** accepted
**Drives:** Slice C of epic [#1675](https://github.com/WANDERCOLTD/HF/issues/1675) (#1721 / #1736 / #1737 / #1738)
**Sibling docs:** [`docs/CONTRACTS-JOURNEY.md`](../CONTRACTS-JOURNEY.md) §17 · [`.claude/rules/cascade-reuse.md`](../../.claude/rules/cascade-reuse.md)

## Decision

Replace the 45-row "one setting per LH menu row" shape of the Journey
Editor (Slice A/B) with **13 educator-intent buckets** organised by
*session moment*. Bucket assignment is declared on every
`JourneySettingContract` via an additive `menuGroupKey?: JourneyMenuBucketId`
field. The Inspector stacks ALL settings in the selected bucket. Mixed-
scope buckets render two sub-groups ("Course defaults" / "This module").

The 13 buckets are:

| ID | Label | Parent group |
|---|---|---|
| A_intake | Sign-up & pre-call profile | G1 |
| B_call1_opening | Call 1 — opening & assessment shape | G2 |
| C_teaching_style | How the tutor teaches every call | G4 |
| D_question_flow | Questions & module flow | G3 |
| E_learner_visual | What the learner sees during sessions | G4 (reserved for IELTS Theme 3) |
| F_stall_recovery | How the tutor handles silence & struggles | G4 (reserved for IELTS Theme 2 / 7) |
| G_session_length | How long sessions must be | G2 |
| H_closing | How the tutor closes | G6 |
| I_scoring | How learners are scored | G7 |
| J_feedback | Progress feedback to the learner | G4 |
| K_between_calls | Between calls — recap, recommendations, frequency | G7 |
| L_mid_journey | Mid-journey stops | G5 |
| M_end_of_course | End-of-course delivery | G6 |

## Context

The Slice A/B LH menu listed every setting in the journey + voice
registry as a single row (~56 rows under G1..G7). Three problems:

1. **Vocabulary tax** — operators don't think in storage entities
   (`sessionFlow.welcomeMessage`, `config.firstCallMode`). They think
   in session moments ("how does call 1 open?"). The IELTS pre-voice
   gap analysis ([`docs/draft-issues/ielts-pre-voice-gap-analysis.md`](../draft-issues/ielts-pre-voice-gap-analysis.md))
   captured this mental model from operator interviews.
2. **N-to-1 illusion** — multiple settings shape the same Preview
   bubble (e.g. `welcomeMessage`, `firstCallMode`, `firstCallTargets`
   all affect Call 1 opening), but the Slice A LH presented each
   setting separately, hiding the joint affordance.
3. **Click cost** — switching between three sibling settings cost
   three round-trips through the LH menu plus the Inspector mount.

## Considered alternatives

### (a) Sibling registry — `JOURNEY_MENU.ts` with bucket → setting[] arrays

Pro: clean separation between "what settings exist" and "how the LH
groups them"; the bucket model could change without touching
`JOURNEY_SETTINGS`.

Con: two sources of truth → drift class. Adding a new setting requires
remembering to also wire it into the menu file. The registry-completeness
vitest would have to enforce parity at test time; the natural place to
declare bucket membership is *on* the setting.

### (b) Additive `menuGroupKey?` field on the contract (CHOSEN)

Pro: single source of truth. The completeness vitest enforces the
invariant at test time; the new
`hf-journey/no-bucketless-journey-setting` ESLint rule (#1738) enforces
it at edit time. No drift class. Future bucket reorganisations are a
single-field rename across entries.

Con: contract grows by one field. The field is optional (voice settings
don't need it), which is fine since they belong to the Settings tab's
voice registry (`S1_voice` group), not a journey bucket.

### (c) Hard-code the bucket → setting map in `JourneyLhMenu.tsx`

Pro: simplest possible change.

Con: bypasses the registry entirely; new settings would silently fail
to appear in the LH; bucket renames would be invisible to readers of
the registry; CommandPalette can't derive a count. Worst-of-three.

## Why **(b)** wins

The Slice A/B registry is already the canonical declaration of every
journey setting. Adding `menuGroupKey` to the same record keeps the
bucket model in lock-step with the settings it groups — the SAME PR
that adds a new setting adds its bucket assignment. The
completeness vitest + ESLint rule combination makes "forgot to assign
a bucket" structurally impossible without the dev seeing red squiggle
at edit time. The cost is one optional field per contract.

## Lattice 4-pillar audit

| Pillar | Coverage |
|---|---|
| **Chain Contracts** | `composeImpact.sections` + `previewLocators` chains unchanged. New chain: bucket → settings → previewLocators (via `lib/journey/bucket-relations.ts` pure derivers). |
| **Guards** | `eslint-rules/no-bucketless-journey-setting.mjs` (Slice C3) blocks new entries without `menuGroupKey` at edit time. Companion `registry-completeness.test.ts` pins the same invariant at test time. |
| **Cascade** | Slice C2 (#1737) routes Inspector reads through `useEffectiveValue` → `<CascadeValue>` → `<LayerBadge>`. The bucket reshape did not introduce snapshot reads of cascade-resolvable values. |
| **Rules** | `.claude/rules/cascade-reuse.md` pins the cascade-honesty pattern. This ADR + [`CONTRACTS-JOURNEY.md`](../CONTRACTS-JOURNEY.md) §17 pin the bucket shape. |

## Consequences

### Positive

- LH click cost dropped from N clicks (one per setting) to 1 (per
  bucket), with all bucket members visible in the Inspector
  simultaneously.
- The IELTS gap-analysis bucket vocabulary aligns with operator mental
  model — onboarding new educators no longer requires learning
  storage-entity vocabulary.
- New chain: `previewLocators` ↔ `menuGroupKey` makes the N-to-N
  bucket↔bubble relationship navigable in both directions (Preview
  click → bucket; bucket select → multi-pulse all touched bubbles).
- Empty buckets carry an `emptyReservation` pointer to the IELTS epic
  ([#1700](https://github.com/WANDERCOLTD/HF/issues/1700)) themes that
  will populate them — the operator sees the future shape, not just
  "TODO".

### Negative

- One additional optional field on every `JourneySettingContract`.
  Mitigated by the ESLint rule + vitest making absences structurally
  impossible.
- Two buckets (E_learner_visual / F_stall_recovery) are sparsely
  populated today (1 entry each — the G8 module-scoped settings).
  Mitigated by the `emptyReservation` field surfacing the planned
  IELTS theme population.
- Settings tab voice registry (`VOICE_SETTINGS`) lives in
  `lib/settings/voice-setting-contracts.ts` and intentionally does NOT
  carry `menuGroupKey` (voice settings belong to the Settings tab's
  `S1_voice` group, not a journey bucket). The ESLint rule allow-lists
  this path.

## Related

- [Story #1721 (C1)](https://github.com/WANDERCOLTD/HF/issues/1721) — registry
  + LH menu refactor (shipped via [#1736](https://github.com/WANDERCOLTD/HF/pull/1736))
- [Story #1737 (C2)](https://github.com/WANDERCOLTD/HF/issues/1737) — cascade-
  honesty discipline (shipped via [#1753](https://github.com/WANDERCOLTD/HF/pull/1753))
- [Story #1738 (C3)](https://github.com/WANDERCOLTD/HF/issues/1738) — this
  ADR + ESLint rule + writeGate UI lock chip + Cmd+K bucket count
- [docs/CONTRACTS-JOURNEY.md §17](../CONTRACTS-JOURNEY.md#17--slice-c-bucket-model-1721)
- [`.claude/rules/cascade-reuse.md`](../../.claude/rules/cascade-reuse.md)
- IELTS pre-voice gap analysis: [`docs/draft-issues/ielts-pre-voice-gap-analysis.md`](../draft-issues/ielts-pre-voice-gap-analysis.md)
