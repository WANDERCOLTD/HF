# BDD typed unions Coverage — CueCardType / StallType / ScoreReadoutMode

> Three BDD-defined typed unions in
> `apps/admin/lib/types/json-fields.ts` (`CueCardType` / `StallType` /
> `ScoreReadoutMode`) MUST each carry a three-axis consumer matrix
> (teaching / adminUI / learnerUI). Modes that legitimately don't need
> a per-axis consumer (because the BDD spec declares them as
> producer-only data the runtime hasn't wired yet) live in
> `UNION_AXIS_EXEMPT` with a >20-char reason.
>
> Sibling Coverage-pillar gates:
> [`mode-ui-coverage.md`](./mode-ui-coverage.md) (the canonical
> 3-axis matrix template for `AuthoredModuleMode`),
> [`sessionkind-reader-coverage.md`](./sessionkind-reader-coverage.md)
> (`SessionKindString` value → writer + reader),
> [`mode-spec-selection-coverage.md`](./mode-spec-selection-coverage.md)
> (`AuthoredModuleMode` runtime spec selection),
> [`learner-ui-leak-coverage.md`](./learner-ui-leak-coverage.md)
> (internal-label leak gate — pins these tag names as internal).
>
> Born of the 2026-06-21 big-matrix audit (PR #2144 conversation): of
> the 9 BDD-defined typed-union surfaces the audit catalogued, 6 had
> typed unions + Coverage gates post-Phase A of epic #2145; these
> three were the remaining gap. Each is a learner-experienced enum:
> cue card type drives the Part 2 prep prompt; stall type drives which
> scaffold the tutor uses; readout mode drives the post-module
> experience.
>
> Story: [#2162](https://github.com/WANDERCOLTD/HF/issues/2162).

## Rule

When you add or modify a value in any of the three unions in
`apps/admin/lib/types/json-fields.ts`:

1. **Update the `*_VALUES` const tuple** alongside the type. The
   sibling test imports the tuple shape AND re-parses the union from
   source — both must agree.
2. **Update `*_VALUES` in
   `apps/admin/tests/lib/sim-chat/bdd-typed-unions-coverage.test.ts`**.
   The source-vs-matrix sanity test fires immediately if the union
   diverges.
3. **Decide the consumer plan for each of the three axes**:
   - **teaching** (compose-side): does this value need a compose-time
     directive (sibling-pattern: `resolveModuleQuizDirective` /
     `resolveModuleMockExamDirective` in
     `lib/prompt/composition/transforms/instructions.ts`)?
   - **adminUI**: at least one `app/x/**` or `components/**` file
     should branch on the value to render a distinct badge / icon /
     inspector hint.
   - **learnerUI**: does the learner experience anything different —
     a SimChat reskin / banner / variant in the Results screen?
4. **If you can't ship a consumer in the same PR**, add to
   `UNION_AXIS_EXEMPT` with a reason describing WHY the cell is
   intentionally producer-only AND bump `EXPECTED_EXEMPT_COUNT`. The
   ratchet test catches the bump as a conscious decision.

## How matching works

For each (union, value, axis) cell, the test walks the axis's
consumer directories and looks for the value literal in:

```
=== "<value>"
!== "<value>"
case "<value>":
```

Pure type-exhaustiveness switches (rare for these 4th-layer
primitives) ARE matched here because the value tags appear as case
labels in the runtime detector pattern. Plain string literals
elsewhere (e.g. "personal" as a PII enum value in
`lib/intake/compliance.ts`) do NOT match because they don't appear in
the consumer dirs OR they appear only as `: "personal"` mapping
values, not as `=== "personal"` comparators.

## Axis consumer-directory map

| Axis | Directories |
|---|---|
| teaching | `lib/prompt/composition/transforms`, `lib/prompt/composition/loaders`, `lib/prompt/composition`, `lib/curriculum`, `lib/voice` |
| adminUI | `app/x`, `components/modules-tab`, `components/journey-tab` |
| learnerUI | `components/sim`, `app/x/student`, `hooks` (stall detector lives here), `../foh/app`, `../foh/components` |

## Today's incumbent matrix (2026-06-21 baseline, type-only PR)

| Union | Value | teaching | adminUI | learnerUI |
|---|---|---|---|---|
| CueCardType | personal | exempt | exempt | exempt |
| CueCardType | abstract | exempt | exempt | exempt |
| StallType | i-dont-know | exempt | exempt | exempt |
| StallType | opinion-gap | exempt | exempt | exempt |
| StallType | abstraction-freeze | exempt | exempt | exempt |
| StallType | vocabulary-search | exempt | exempt | exempt |
| StallType | blank-out | exempt | exempt | exempt |
| ScoreReadoutMode | on-screen | exempt | exempt | exempt |
| ScoreReadoutMode | end-of-module-on-screen | exempt | exempt | exempt |
| ScoreReadoutMode | aloud-with-indicative-qualifier | exempt | exempt | exempt |

Ratchet baseline: `EXPECTED_EXEMPT_COUNT = 30`, `EXPECTED_GAP_COUNT = 0`.

Every cell is exempt at land time because this PR types the three
unions WITHOUT wiring runtime consumers (per story scope — "type-system
hardening only"). Follow-on PRs ship consumers and decrement the
ratchet one cell at a time.

## Where each union lives in the BDD

| Union | BDD source |
|---|---|
| CueCardType | HF IELTS — BDD Stories, US-P2-01 + IELTS course-ref v2.3 Source 5 (cue card pool) |
| StallType | HF IELTS — BDD Stories, US-P3-02b + IELTS course-ref v2.3 Source 7 (Part 3 stall scaffolds, scaffold-tag taxonomy) |
| ScoreReadoutMode | IELTS course-ref v2.3 (per-module `scoreReadoutMode` field on Baseline / Part 2 / Part 3 / Mock modules) + HF-IELTS-Pre-Voice-Testing-Checklist Unit 5 (Mock Results screen) |

## When NOT to apply

This rule covers `CueCardType` / `StallType` / `ScoreReadoutMode`.
The same generic 3-axis matrix shape applies to other small
BDD-defined unions where producer-only failure would surprise
learners — each surface gets its own paired test + rule (today:
`mode-ui-coverage` for `AuthoredModuleMode`).

## When adding a new value to one of these unions

Author checklist (same PR):

1. Extend the `*_VALUES` const tuple in `lib/types/json-fields.ts`.
2. Add the value to the matching `*_VALUES` array in the test file.
3. Decide consumer presence for each of the 3 axes; wire OR exempt.
4. If exempting, bump `EXPECTED_EXEMPT_COUNT` (+1 per axis exempted).
5. Run
   `npx vitest run tests/lib/sim-chat/bdd-typed-unions-coverage.test.ts`.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `tests/lib/sim-chat/bdd-typed-unions-coverage.test.ts` (born 2026-06-21, this PR) | 8 vitests: matrix-vs-source sanity, gap check, gap ratchet, exempt ratchet, non-empty reason, no-contradiction, non-stale exempt, distribution sanity, type-system compile-sanity | Producer-only union values shipping without a UI / teaching consumer beyond the ratcheted count. |
| `tests/lib/wizard/fixture-type-coverage.test.ts` (#1910 + #2162 update) | `scoreReadoutMode` exempt entry removed; `EXPECTED_FIXTURE_KEY_EXEMPT_COUNT 4 → 3` | The wizard parser silently dropping the v2.3 fixture key — now typed + emitted. |
| `apps/admin/lib/wizard/detect-module-settings.ts` (#2162 update) | `scoreReadoutMode` moved from NON_SCHEMA_FIELDS to KNOWN_FIELDS; new case validates against `SCORE_READOUT_MODE_VALUES` | Off-canonical strings reaching `Playbook.config.modules[i].settings.scoreReadoutMode`. |

## When NOT to exempt — the wiring trigger

When a follow-on PR wires a real consumer for a previously-exempt
cell:

1. Remove the matching `UNION_AXIS_EXEMPT[...]` entry.
2. Drop `EXPECTED_EXEMPT_COUNT` by 1.
3. Run the test; the cell flips from `exempt` to `covered`.

The "no exempt entry is contradicted by an actual consumer match"
vitest catches the case where the consumer landed but the exempt
entry stayed (stale-exempt drift).

## Related

- [`tests/lib/sim-chat/bdd-typed-unions-coverage.test.ts`](../../apps/admin/tests/lib/sim-chat/bdd-typed-unions-coverage.test.ts) — the test
- [`apps/admin/lib/types/json-fields.ts`](../../apps/admin/lib/types/json-fields.ts) — `CueCardType` / `StallType` / `ScoreReadoutMode` source-of-truth
- [`apps/admin/lib/wizard/detect-module-settings.ts`](../../apps/admin/lib/wizard/detect-module-settings.ts) — wizard parser, now emits `scoreReadoutMode`
- [`.claude/rules/mode-ui-coverage.md`](./mode-ui-coverage.md) — canonical 3-axis matrix template
- [`.claude/rules/learner-ui-leak-coverage.md`](./learner-ui-leak-coverage.md) — pins tag names as internal-only (stall-type tags + cue-card type labels)
- [`.claude/rules/fixture-type-coverage.md`](./fixture-type-coverage.md) — sibling gate; ScoreReadoutMode exempt entry dropped this PR
- PR #2153 (`Part3TechniqueFocus` Phase A — sibling 4th-layer primitive)
- PR #2173 (`LearnerShellKind` — sibling 4th-layer primitive)
- PR #2180 (`AssessmentKind` — sibling 4th-layer primitive)
- Big-matrix audit (PR #2144 conversation, 2026-06-21) — origin of this story
- Story [#2162](https://github.com/WANDERCOLTD/HF/issues/2162)
