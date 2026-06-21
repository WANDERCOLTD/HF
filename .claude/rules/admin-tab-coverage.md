# Admin tab Coverage — CourseDetail tab ↔ mode-aware-variant pairing

> Every CourseDetail TAB COMPONENT under
> `apps/admin/app/x/courses/[courseId]/_components/`,
> `apps/admin/app/x/courses/[courseId]/Course*Tab.tsx`,
> `apps/admin/components/journey-tab/**`,
> `apps/admin/components/scoring-tab/**`,
> `apps/admin/components/teaching-tab/**`, and
> `apps/admin/components/modules-tab/**` MUST be classified as
> **covered** (renders a typed mode-shape value from
> `AuthoredModuleMode` — and, once the sibling agents land them, from
> `AssessmentKind` / `LearnerShellKind`), **exempt** (the 4
> no-mode-axis tabs the story body named — Overview / Who / Learners /
> Proof), or **gap** (ratcheted at incumbent count). Infrastructure
> helpers that live alongside tabs (LH menus, breadcrumbs, modals,
> command palettes, write-gate chips, summary cards) are exempted by
> file-name pattern match — they don't render per-module mode and
> don't need a per-tab exempt row.
>
> Sibling Coverage-pillar gates:
> [`mode-ui-coverage.md`](./mode-ui-coverage.md) (the `sim-chat`-side
> 3-axis pairing this rule extends to the admin-tab surface),
> [`mode-spec-selection-coverage.md`](./mode-spec-selection-coverage.md)
> (the runtime spec-selection axis of the same `AuthoredModuleMode`
> source),
> [`sessionkind-reader-coverage.md`](./sessionkind-reader-coverage.md)
> (sibling type-union ↔ writer+reader pairing),
> [`registry-consumer-coverage.md`](./registry-consumer-coverage.md)
> (storagePath ↔ transform reader, same generic pattern),
> [`tier-visibility-coverage.md`](./tier-visibility-coverage.md)
> (route response ↔ redactor).
>
> Born of umbrella [#2185](https://github.com/WANDERCOLTD/HF/issues/2185)
> axis **A4** — the 2026-06-21 operator audit found that the Module
> Inspector + sibling CourseDetail tabs have NO mode-aware HOW-card
> variants. Operators see identical card chrome regardless of
> `module.mode`. The umbrella's framing: "drive Admin UI gap count to
> ZERO". This Coverage gate (U1 of #2185) pins the incumbent gap
> count + freezes it, so future drift is impossible and follow-on PRs
> drop the ratchet monotonically toward 0.
>
> Catalogued in [`docs/lattice-chains.md`](../../docs/lattice-chains.md)
> under the "Coverage / RBAC" cluster as the admin-tab sibling of
> `mode-ui-coverage`.

## Rule

When you add or modify a TAB COMPONENT under any of the 5 admin-tab
surfaces above:

1. **Decide the consumer plan for the tab's render path**:
   - **Mode-aware variant** — branch on `module.mode === "<value>"`
     (or `assessment.kind === "<value>"` / `shell.kind === "<value>"`
     once those types ship) in the JSX to render distinct chrome /
     copy / behaviour per mode-shape literal. Test classifies as
     `covered` on the first mode-literal occurrence.
   - **No-mode-axis tab** — the tab surfaces aggregate state
     (cohort enrolment, identity config, evidence) that doesn't vary
     by per-module mode. Add the file to `ADMIN_TAB_EXEMPT` in
     `apps/admin/tests/components/admin-tab-coverage.test.ts` with a
     reason >20 chars describing why per-mode rendering doesn't
     apply.
   - **Infra helper** — the file is a sub-component scaffold (LH
     menu, modal, breadcrumb, palette, chip, summary card) that
     doesn't render per-module content. The file's name SHOULD match
     a pattern already in `ADMIN_TAB_INFRA_PATTERNS`. If it doesn't,
     extend the pattern list AND add a one-line PR note explaining
     the new pattern.
2. **If you can't ship the variant in the same PR**, the gap counts
   against the ratchet. The ratchet is the structural surface that
   forces a conscious decision — bumping it requires a >1-line
   justification in the PR body.

## Why this exists

`AuthoredModuleMode` shipped with 5 values (`examiner` / `tutor` /
`mixed` / `quiz` / `mock-exam`) and the compose-side directives + the
admin badge icons + (most of) the learner-UI shells ship as covered
by sibling gates. But the admin TAB SURFACE — where operators TUNE
the module behaviour — has zero mode-awareness today. Operator opens
the Module Inspector on a `quiz` module and sees an identical HOW
card to the one on a `tutor` module. The DB carries the mode
literal; the editor surface ignores it.

The audit fingerprint (2026-06-21 operator review of CourseDetail
under hf_staging): all 12 of the following tab/sub-tab files have
no `module.mode === "X"` branch in their render path:

- `app/x/courses/[courseId]/_components/PreviewLens.tsx`
- `components/journey-tab/CourseJourneyTab.tsx`
- `components/scoring-tab/CourseScoringTab.tsx`
- `components/teaching-tab/CourseTeachingTab.tsx`
- `components/modules-tab/CourseModulesTab.tsx`
- `components/modules-tab/ModuleEditor.tsx`
- `app/x/courses/[courseId]/CourseCurriculumTab.tsx`
- `app/x/courses/[courseId]/CourseGenomeTab.tsx`
- `app/x/courses/[courseId]/CourseGoalsTab.tsx`
- `app/x/courses/[courseId]/CourseHowTab.tsx`
- `app/x/courses/[courseId]/CourseIntelligenceTab.tsx`
- `app/x/courses/[courseId]/CourseSkillsTab.tsx`

This rule + its paired vitest freeze that population at
`EXPECTED_GAP_COUNT = 12`. Every follow-on PR that wires mode
awareness on one of these tabs drops the ratchet by 1 toward 0.

## How matching works

For each `.tsx` file enumerated by the walker:

1. If the file's relative path is in `ADMIN_TAB_EXEMPT` → `exempt`.
2. Else if the file's basename matches an entry in
   `ADMIN_TAB_INFRA_PATTERNS` → `exempt` (no row needed).
3. Else read the source and check for a quoted occurrence of any
   value in `MODE_SHAPE_VALUES`:
   - `examiner`, `tutor`, `mixed`, `quiz`, `mock-exam`
     (`AuthoredModuleMode` today)
   - Future additions: `AssessmentKind` literals (`upfront-baseline`,
     `midpoint-check`, `end-mock`, `popquiz`, `rubric-board-chair`)
     once epic #2176 S1 lands; `LearnerShellKind` literals once
     epic #2163 lands.
4. Match → `covered`. No match → `gap`.

The matching is intentionally LOOSE — any quoted string literal
counts, not a strict `.mode === "X"` pattern. This catches:

- Direct comparisons (`mode === "quiz"`)
- Dispatch tables (`{ quiz: ... }` keyed strings)
- Switch cases (`case "examiner":`)
- JSX label strings

A future hardening pass MAY tighten to `.mode ===` patterns when the
operator audit confirms every existing covered tab uses the strict
shape. Today's loose match is calibrated to avoid false-negatives on
tab files that legitimately render mode labels in JSX.

## Today's incumbent matrix

| Surface | Files | Covered | Exempt-explicit | Exempt-infra | Gap |
|---|---|---|---|---|---|
| `app/x/courses/[courseId]/Course*Tab.tsx` | 11 | 0 | 4 | 1 | 6 |
| `app/x/courses/[courseId]/_components/` | 5 | 2 | 0 | 2 | 1 |
| `components/journey-tab/` | 11 | 0 | 0 | 10 | 1 |
| `components/scoring-tab/` | 2 | 0 | 0 | 1 | 1 |
| `components/teaching-tab/` | 2 | 0 | 0 | 1 | 1 |
| `components/modules-tab/` | 4 | 0 | 0 | 2 | 2 |

Counts approximate at land time; the test re-classifies on every
run.

| Classification | Files |
|---|---|
| `covered` | `AuthoredModulesPanel.tsx`, `LearnerModulePicker.tsx` (the 2 tabs that ALREADY branch on `module.mode`) |
| `exempt-explicit` | Overview / Who / Learners / Proof (4 — story #2203 named) |
| `gap` | 12 incumbent — see "Why this exists" above |

## When NOT to apply

- Files outside the 5 admin-tab surfaces — out of scope.
- Test fixtures and route templates — the walker excludes
  `.test.tsx` files.
- Infra helpers matching `ADMIN_TAB_INFRA_PATTERNS` — auto-exempt
  by pattern.
- The `lib/types/json-fields.ts` source — owned by sibling gate
  `mode-ui-coverage`, not this one.

## When adding a new tab

Author checklist (same PR):

1. Decide: mode-aware variant OR no-mode-axis tab?
2. **Mode-aware** — wire a `module.mode === "X"` branch in the JSX
   for at least one mode literal. The Coverage test auto-picks it up
   as `covered` on the next run.
3. **No-mode-axis** — add the file to `ADMIN_TAB_EXEMPT` with a
   reason >20 chars. Bump `EXPECTED_EXEMPT_COUNT` consciously.
4. Run `npx vitest run tests/components/admin-tab-coverage.test.ts`.
   Green → ship.

## When closing a gap (the expected drift direction)

Author checklist (same PR):

1. Wire the mode-aware variant in the tab file. Branch on
   `module.mode === "<value>"` for at least one mode literal.
2. Drop `EXPECTED_GAP_COUNT` by 1.
3. Run the test. Expect green.
4. If the variant covers MULTIPLE mode literals on the same render
   path, the gap-count still drops by 1 (one fewer FILE in the gap
   set) — the test is per-file, not per-cell.

## When deleting a tab

1. Delete the `.tsx` file.
2. If the file was in `ADMIN_TAB_EXEMPT`, remove the entry AND drop
   `EXPECTED_EXEMPT_COUNT` by 1.
3. If the file was `covered`, drop nothing — the file just leaves
   the walker's enumeration.
4. If the file was `gap`, drop `EXPECTED_GAP_COUNT` by 1.
5. Run the test — the "no exempt entry references a path that
   doesn't exist" assertion catches missed cleanup.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `tests/components/admin-tab-coverage.test.ts` (born 2026-06-21, this PR) | 9 vitests: source-vs-matrix sanity + non-empty walker + gap check + 2 ratchets + non-empty reason + no-stale-exempt + no-contradiction + distribution sanity | New admin-tab files shipping without mode awareness beyond the 12-incumbent ratchet. Exempt-list drift. Files deleted but still in exempt. Gaps widened silently. |
| `tests/lib/sim-chat/mode-ui-coverage.test.ts` (PR #2144) | 3-axis UI consumer matrix on the SimChat side | Sibling Coverage on the learner-UI axis of the same `AuthoredModuleMode` source. |
| `tests/lib/pipeline/mode-spec-selection-coverage.test.ts` (PR #2155, story #2152) | Runtime spec-selection axis | Sibling Coverage at the pipeline-stage layer of the same source. |
| `.claude/rules/lattice-survey.md` | Author discipline | Pre-coding survey discipline for the Lattice surfaces this rule covers. |

## When NOT to apply (structural)

The vitest is structural — it ALWAYS applies. What's exempted is
specific files via `ADMIN_TAB_EXEMPT` with documented reason OR via
basename match against `ADMIN_TAB_INFRA_PATTERNS` (the
infrastructure-helper pattern list).

## Future hardening

- **Tighten the match shape** when the operator confirms every
  covered tab uses strict `.mode === "X"` syntax. Today's loose
  any-quoted-literal match accepts dispatch tables and switch cases
  too. Tightening would catch tabs that mention a literal in a
  label string without branching on it (false-positive risk).
- **Extend `MODE_SHAPE_VALUES`** when sibling agents land
  `AssessmentKind` (epic #2176 S1) and `LearnerShellKind` (epic
  #2163). The source-vs-matrix sanity check is authoritative for
  `AuthoredModuleMode` today; mirror that shape for the new types
  when they land.
- **Promote gap count to 0** by wiring mode-aware variants on the
  12 incumbent tabs. Umbrella #2185 axis A4 stories track this
  monotonically.

## Related

- [`tests/components/admin-tab-coverage.test.ts`](../../apps/admin/tests/components/admin-tab-coverage.test.ts) — the test
- [`apps/admin/lib/types/json-fields.ts`](../../apps/admin/lib/types/json-fields.ts) — `AuthoredModuleMode` source-of-truth
- [`.claude/rules/mode-ui-coverage.md`](./mode-ui-coverage.md) — sibling Coverage gate (SimChat axis)
- [`.claude/rules/mode-spec-selection-coverage.md`](./mode-spec-selection-coverage.md) — sibling Coverage gate (pipeline-stage axis)
- [`.claude/rules/sessionkind-reader-coverage.md`](./sessionkind-reader-coverage.md) — sibling type-union ↔ runtime consumer pairing
- [`.claude/rules/lattice-survey.md`](./lattice-survey.md) — pre-coding survey discipline
- Story [#2203](https://github.com/WANDERCOLTD/HF/issues/2203) — this gate (U1 of umbrella #2185)
- Parent umbrella [#2185](https://github.com/WANDERCOLTD/HF/issues/2185) — UI Gap Zero
