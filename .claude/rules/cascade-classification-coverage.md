# Cascade-chip classification coverage (Lattice 5th-pillar member)

> Every `JourneySettingContract` (+ `VoiceSettingsContract`) MUST
> classify into exactly one of five cascade-coverage categories:
> `cascade-resolvable`, `course-only`, `producer-only`, `static-chain`,
> or `gap`. The structural enforcement lives in
> [`tests/lib/journey/cascade-classification-coverage.test.ts`](../../apps/admin/tests/lib/journey/cascade-classification-coverage.test.ts).
>
> Sibling Coverage-pillar tests:
> [`registry-consumer-coverage.md`](./registry-consumer-coverage.md)
> (the storagePath → transform reader gate that this rule complements —
> A0 of #2225 fixed its FAMILIES-match shortcut to use the real
> `isResolvableKnob` helper),
> [`registry-schema-coverage.md`](./registry-schema-coverage.md)
> (schema↔registry bidirectional coverage),
> [`route-auth-zod-coverage.md`](./route-auth-zod-coverage.md),
> [`tier-visibility-coverage.md`](./tier-visibility-coverage.md),
> [`parameter-coverage.md`](./parameter-coverage.md),
> [`arraykey-writer-coverage.md`](./arraykey-writer-coverage.md).
> Same generic enumerate→classify→ratchet pattern.
>
> Born of epic [#2225](https://github.com/WANDERCOLTD/HF/issues/2225)
> A6 — the closing piece of the A0/A1a/A1b/A3 thread that audited the
> cascade-coverage surface end-to-end.

## Why this exists

The 2026-06-21 audit (epic #2225) found 89 of 105 contracts silently
rendering nothing where the Inspector's cascade chip should appear.
Three structural failure modes were in play:

1. **A0 (PR #2230)** — `registry-consumer-coverage.test.ts` used a
   storage-path-root heuristic that produced false-negative COVERED
   verdicts. Contracts that LOOKED like they sat under a cascade
   family (`sessionFlow.intake.goals.question`) but whose leaf knob
   key wasn't actually in `FAMILIES` slipped through. A0 replaced the
   heuristic with the real `isResolvableKnob(knobKey)` helper.

2. **A1a/A1b** — operator audit enumerated every contract's intended
   cascade plan. Three buckets surfaced:
   - 21 contracts in `FAMILIES` (post-A1b once `teachingStyle`
     lands).
   - 73 intentionally course-scoped (no `cascadeKnobKey`, no
     `cascadeSources` — single course-level value, no upstream
     fallback).
   - 9 producer-only G8 module-scoped IELTS contracts gated by
     `HF_FLAG_IELTS_MODULE_SETTINGS`.

3. **A3 (PR #2233)** — `CascadeTraceBreadcrumb` rendered NOTHING for
   the 73 course-only contracts (`!sources.length && return null`).
   Operators couldn't tell whether the chip was missing because the
   feature shipped without it, or because there genuinely is no
   cascade. A3 added a "Course-only" pill so the intent is explicit.

This Coverage gate is the structural backstop: future contracts MUST
ship with a clear cascade plan, classifiable into one of the five
categories. A `gap` classification — typically a `cascadeKnobKey`
that doesn't match any FAMILIES entry AND no `cascadeSources`
declared — fails CI immediately.

## Rule

When you add or modify a `JourneySettingContract` /
`VoiceSettingsContract`:

1. **Decide the cascade plan** for the contract:
   - **`cascade-resolvable`** (preferred when the value cascades across
     System → Domain → Course) — set `cascadeKnobKey` to a knob in
     `lib/cascade/effective-value.ts::FAMILIES`. If the FAMILY doesn't
     exist yet, add it in the same PR (resolver under
     `lib/cascade/resolvers/`, sibling FAMILIES entry, knob name
     matching the convention). Bump
     `EXPECTED_CASCADE_RESOLVABLE_COUNT` by 1.
   - **`course-only`** (for genuinely course-scoped values with no
     upstream layer — `firstCallMode`, course-specific behaviour
     flags) — leave `cascadeKnobKey` undefined AND
     `cascadeSources: []`. The "Course-only" pill renders explicit
     intent. Bump `EXPECTED_COURSE_ONLY_COUNT` by 1.
   - **`producer-only`** (for module-scoped contracts gated by a
     Phase 2 feature flag) — add the contract id to
     `PRODUCER_ONLY_CONTRACTS` in the test file with a >20-char
     reason citing the flag/epic. Bump
     `EXPECTED_PRODUCER_ONLY_COUNT` by 1.
   - **`static-chain`** (when the cascade is documented in
     `cascadeSources[]` for historical reference but isn't wired into
     `FAMILIES`) — declare `cascadeSources: [...]`. The breadcrumb
     renders `<StaticChain>` rows from the array. Bump
     `EXPECTED_STATIC_CHAIN_COUNT` by 1. Prefer `cascade-resolvable`
     over `static-chain` when possible — `static-chain` is the
     "documented but not runtime-resolved" fallback.
2. **`gap` MUST stay at 0**. If you ship a contract that classifies
   as `gap`, the test fails. Pick one of the four legitimate
   categories above.

## How matching works

For each entry in `[...JOURNEY_SETTINGS, ...VOICE_SETTINGS]`:

| Order | Check | Classification |
|---|---|---|
| 1 | Listed in `PRODUCER_ONLY_CONTRACTS` | `producer-only` |
| 2 | `isResolvableKnob(cascadeKnobKey ?? id)` returns true | `cascade-resolvable` |
| 3 | `cascadeSources.length > 0` | `static-chain` |
| 4 | `cascadeKnobKey === undefined` AND `cascadeSources.length === 0` | `course-only` |
| 5 | None of the above | `gap` (fails CI) |

Producer-only takes precedence over the cascade-family match so a
future FAMILY accidentally matching one of the G8 knob keys doesn't
silently reclassify the cohort.

## Today's incumbent matrix (A6 land-time baseline)

| Classification | Count |
|---|---|
| `cascade-resolvable` | 8 |
| `course-only` | 77 |
| `producer-only` | 9 |
| `static-chain` | 11 |
| `gap` | 0 |
| **Total** | **105** |

The 8 cascade-resolvable contracts at land time:

- `welcomeMessage` (welcome-message FAMILY)
- `skillTierMapping` + `tierPresetId` + `loMasteryThreshold` +
  `assessmentReadinessThreshold` (mastery-policy FAMILIES)
- `aiMeasurementDisableLlmIeltsScoring` (ai-measurement FAMILY,
  #2174 S3)
- `voiceProvider` + `voiceId` (voice-config FAMILY)

The 11 static-chain contracts at land time (declare `cascadeSources[]`
but no FAMILIES entry):

- `intakeSpecId`, `onboardingFlowPhases`, `firstCallTargets`,
  `teachingStyle`, `offboardingFlowPhases` (journey)
- `backgroundSound`, `voiceSpeed`, `voicePitch`,
  `silenceThreshold`, `endCallAfterSilence`, `maxCallDuration`
  (voice)

The 9 producer-only contracts (G8 IELTS cohort):

`moduleQuestionTarget`, `moduleMinSpeakingSec`, `moduleCueCardPool`,
`moduleTopicPool`, `moduleClosingLine`,
`moduleFirstTimeOrientationLine`, `moduleScheduledCues`,
`moduleScaffoldPool`, `moduleProfileFieldsToCapture`.

**Note on the brief's enumeration vs reality:** the A6 brief
referenced post-A1b targets of `21 / 73 / 9 / 0 / 0`. The actual
land-time numbers above reflect pre-A1b state (this branch's base is
`main`, and PRs #2230 + #2231 + #2233 are all OPEN, not merged). Once
A1b merges, `teachingStyle` flips from `static-chain` to
`cascade-resolvable` (8→9 / 11→10). Once A1a's contract corrections
land (the 4-contract delta in course-only vs static-chain), the
matrix will move toward the brief's expected distribution.

## When NOT to apply

The gate is **structural** and always runs. What's exempted (via
`PRODUCER_ONLY_CONTRACTS`) is specific contracts that are
intentionally producer-only with documented reason.

The gate covers cascade-coverage classification specifically. Sibling
gates cover:

- `registry-consumer-coverage.test.ts` — same `isResolvableKnob`
  helper but for the storagePath → transform reader pairing. The two
  tests complement: this one pins WHICH cascade plan each contract
  uses; that one pins whether the producer↔consumer pairing
  actually fires at compose time.
- `cascade-reuse.md` — the UI-side discipline that the cascade chip
  rendering MUST route through `useEffectiveValue` /
  `<CascadeValue>` / `<LayerBadge>`. This gate doesn't reach into
  component code.

## When adding a new contract

Author checklist (same PR):

1. Decide the cascade plan from the 4 legitimate categories above.
2. Wire the appropriate fields:
   - `cascade-resolvable`: set `cascadeKnobKey` (or rely on `id`
     match); add FAMILY entry if missing.
   - `course-only`: leave `cascadeKnobKey` undefined; set
     `cascadeSources: []`.
   - `producer-only`: add to `PRODUCER_ONLY_CONTRACTS` with reason.
   - `static-chain`: declare `cascadeSources: [...]` array.
3. Bump the matching `EXPECTED_*_COUNT` in the test.
4. Run
   `npx vitest run tests/lib/journey/cascade-classification-coverage.test.ts`.
5. Green → ship. `gap` → wire one of the 4 plans.

## When retiring a contract

1. Remove the contract from `JOURNEY_SETTINGS` / `VOICE_SETTINGS`.
2. Remove from `PRODUCER_ONLY_CONTRACTS` if it was listed (the
   "no stale entry" assertion catches the missed step).
3. Drop `EXPECTED_TOTAL_COUNT` by 1 AND drop the matching per-class
   `EXPECTED_*_COUNT` by 1.
4. Run the test.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `tests/lib/journey/cascade-classification-coverage.test.ts` (A6 of #2225, this PR) | 11 vitests: registry-size sanity, gap-check, 5 per-class ratchets, non-empty reason, non-stale producer-only, non-contradicted producer-only, distribution sanity | New contracts shipping without a clear cascade plan (`gap` classification). Drift between contract declarations + FAMILIES coverage + producer-only intent. Stale `PRODUCER_ONLY_CONTRACTS` entries surviving contract retirements. |
| `tests/lib/journey/registry-consumer-coverage.test.ts` (#1849; A0 fix #2230) | Sibling Coverage gate; uses the same `isResolvableKnob` helper | Producer-only Inspector settings (registry → transform reader pairing) |
| `lib/cascade/effective-value.ts::FAMILIES` | Single source-of-truth for cascade-resolver dispatch | Drift between the cascade chip's runtime resolution and the test's classification |
| `components/journey-tab/CascadeTraceBreadcrumb.tsx` (A3, PR #2233) | Renders "Course-only" pill for course-only classification | Silent-null breadcrumb for intentionally-course-scoped settings |
| `.claude/rules/lattice-survey.md` "Producer ↔ consumer pairing" | Author discipline | Catches what slips past the structural gate |

## Related

- [`tests/lib/journey/cascade-classification-coverage.test.ts`](../../apps/admin/tests/lib/journey/cascade-classification-coverage.test.ts) — the test
- [`apps/admin/lib/cascade/effective-value.ts`](../../apps/admin/lib/cascade/effective-value.ts) — `FAMILIES` + `isResolvableKnob`
- [`apps/admin/lib/journey/setting-contracts.ts`](../../apps/admin/lib/journey/setting-contracts.ts) — `JourneySettingContract` shape
- [`apps/admin/components/journey-tab/CascadeTraceBreadcrumb.tsx`](../../apps/admin/components/journey-tab/CascadeTraceBreadcrumb.tsx) — the UI consumer (A3, PR #2233)
- [`.claude/rules/registry-consumer-coverage.md`](./registry-consumer-coverage.md) — sibling Coverage gate (storagePath → transform reader, A0 of #2225 fix)
- [`.claude/rules/cascade-reuse.md`](./cascade-reuse.md) — UI-side cascade discipline (`useEffectiveValue` / `<CascadeValue>` / `<LayerBadge>`)
- [`.claude/rules/lattice-survey.md`](./lattice-survey.md) — pre-coding survey discipline
- Epic [#2225](https://github.com/WANDERCOLTD/HF/issues/2225) — parent thread (A0 / A1a / A1b / A3 / A6)
- PR #2230 — A0 (registry-consumer-coverage FAMILIES fix)
- PR #2231 — A1b (`teachingStyle` cascade FAMILY)
- PR #2233 — A3 (Course-only pill)
