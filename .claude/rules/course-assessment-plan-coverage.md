# CourseAssessmentPlan Coverage (Data Presence sub-pillar instance)

> "Assessment" today fragments across 4 enums (`SessionKindString`,
> `JourneyStopKind`, `FirstCallMode`, `AuthoredModuleMode`); none of
> them cross-check each other. **CourseAssessmentPlan** is the
> 4th-layer typed primitive that composes them into a declarative
> per-course assessment design — typed sampling policy × delivery
> shell × scoring spec × scheduled moment (upfront / midpoint / end).
>
> Operator framing (2026-06-21):
> > *"an assessment is extremely similar to cross-curriculum N questions."*
>
> This Coverage gate pins that for every published course, every
> declared `AssessmentMoment` resolves end-to-end: the cited module
> exists, its mode matches the moment's `kind`, the cited content
> source has rows, and the cited scoring spec is selectable.
>
> Sibling 4th-layer typed primitives (the family this rule completes):
> [SessionFocus #2145](https://github.com/WANDERCOLTD/HF/issues/2145) +
> [LearnerShell #2163](https://github.com/WANDERCOLTD/HF/issues/2163) +
> **CourseAssessmentPlan (this rule, epic
> [#2176](https://github.com/WANDERCOLTD/HF/issues/2176))**.
>
> Parent sub-pillar:
> [`data-presence-coverage.md`](./data-presence-coverage.md) — the
> umbrella meta-rule for the Data Presence sub-pillar of the Lattice
> Coverage pillar. This file is the **first non-Coverage-test-only
> instance** that combines the Cartesian-completeness, declared-need
> fulfilment, AND cascade-reachability shapes simultaneously (across
> the 4 fragmenting enums).
>
> Sibling Coverage gates this rule composes / cross-checks against:
> [`mode-ui-coverage.md`](./mode-ui-coverage.md) (typed primitive
> Coverage; same gate shape on a sibling type-union surface),
> [`mode-spec-selection-coverage.md`](./mode-spec-selection-coverage.md)
> (the runtime spec-selection consumer of `AuthoredModuleMode`),
> [`sessionkind-reader-coverage.md`](./sessionkind-reader-coverage.md)
> (the writer/reader pairing for the `ASSESSMENT` SessionKind value —
> a `CourseAssessmentPlan` plan declaration is the structural surface
> that flips that ghost to either implemented or removed),
> [`learner-ui-leak-coverage.md`](./learner-ui-leak-coverage.md) (the
> learner-safe projection discipline that AssessmentMoment delivery
> shells must respect),
> [`source-ref-coverage.md`](./source-ref-coverage.md) (the Data
> Presence sibling that pins `contentSourceRef` resolution — this
> rule cross-checks that the moment's content references resolve via
> the same gate).
>
> Catalogued in [`docs/lattice-chains.md`](../../docs/lattice-chains.md)
> under the "Data Presence (Coverage sub-pillar)" section.

## Rule: every declared AssessmentMoment resolves end-to-end

When a published `Playbook.config.assessmentPlan` declares an
`AssessmentMoment` (upfront / midpoint[] / end), the PR-time gate
asserts the moment resolves to working DB state:

```
AssessmentMoment {
  kind: AssessmentKind,                  // e.g. "upfront-baseline"
  moduleSlug: string,                    // → AuthoredModule.slug
  samplingPolicy: AssessmentSamplingPolicy, // typed sampling design
  shellKind: LearnerShellKind,           // delivery shell from #2163
  scoringSpec: string,                   // → AnalysisSpec.slug
}
```

The gate enumerates every published Playbook's plan and classifies
each moment:

| Classification | Meaning |
|---|---|
| `resolvable` | Module exists in `Playbook.config.modules[]`; `AuthoredModule.mode` matches the kind (e.g. `quiz` for `popquiz`); content sources resolve (re-uses `source-ref-coverage.test.ts` family); scoring spec exists in `AnalysisSpec` |
| `exempt` | Plan declares `noAssessmentPlan: true` (coaching-led / continuous-only by design) |
| `gap` | Some reference doesn't resolve (missing module / mode mismatch / unresolvable content source / missing scoring spec) |

The plan is **declarative** — lives in
`Playbook.config.assessmentPlan` JSON. The sampling engine
(`lib/assessment/sample-questions.ts`, S2 of epic #2176) is
**course-agnostic** by design; per-course policies live in the JSON,
never in code. This rule pins the data-presence cross-check the
sampling engine implicitly assumes at runtime.

## Why this exists

Pre-epic-#2176, "assessment" lived as 4 disconnected enum values:

| Enum | Values | Role | Cross-checks? |
|---|---|---|---|
| `SessionKindString` | `"ASSESSMENT"` (one of 5) | Runtime session kind | None — type-only ghost (pinned by `sessionkind-reader-coverage.md`) |
| `JourneyStopKind` | `"assessment"` (one of 4) | Intake-time journey-rail wrapper | None |
| `FirstCallMode` | `"baseline_assessment"` (one of 3) | First-call-only flag on a Playbook | None against plan |
| `AuthoredModuleMode` | `"examiner" / "quiz" / "mock-exam"` (3 of 5) | Per-module session behaviour | None against plan |

Each does a different thing at a different layer. None pin
**"this course has an assessable upfront → midpoint → end plan that
actually resolves to real questions + a runnable shell + a working
scoring spec."**

Live evidence (2026-06-21 hf_sandbox audit): only IELTS has a
documented upfront + end assessment design, and even then 5 of its 5
declared content sources are missing
([#2166](https://github.com/WANDERCOLTD/HF/issues/2166) /
[#2167](https://github.com/WANDERCOLTD/HF/issues/2167)). Big Five,
Persuasion Literacy, Intro to Psychology have **no formal assessment
plan at all**. CIO/CTO Pop Quiz + Exam Assessment have the design but
await [#2009](https://github.com/WANDERCOLTD/HF/issues/2009) +
content backfill.

Without `CourseAssessmentPlan`:
- New course launches without an assessment design pass silently
- The 4 fragmenting enums can disagree with no CI signal (e.g.
  `FirstCallMode = "baseline_assessment"` but no upfront moment
  declared)
- The `SessionKind = ASSESSMENT` ghost stays unresolved indefinitely
- Sampling logic gets re-implemented per course (the cross-curriculum
  N-questions primitive isn't shared)

This rule + the paired vitest at
`tests/lib/assessment/course-assessment-plan-coverage.test.ts`
(S3 of epic #2176, in flight via sibling agent) close the structural
gap.

## How the 4 fragmented enums compose under this primitive

| Today's enum | Role under `CourseAssessmentPlan` |
|---|---|
| `SessionKindString.ASSESSMENT` | The runtime SessionKind value when an `AssessmentMoment` fires. Decision (S4 of epic #2176): implement (recommended) or remove from union. |
| `JourneyStopKind.assessment` | The journey-rail wrapper that renders an upfront-baseline `AssessmentMoment` as an intake-stop in the journey. |
| `FirstCallMode.baseline_assessment` | Cross-checked against `plan.upfront.kind === "upfront-baseline"`. If `FirstCallMode` says baseline but `plan.upfront` is absent (or vice versa), the gate fails. |
| `AuthoredModuleMode.examiner / quiz / mock-exam` | The mode the plan's `moduleSlug` must have for the AssessmentMoment to render correctly. Cross-checked via the existing mode→spec selection gate ([`mode-spec-selection-coverage.md`](./mode-spec-selection-coverage.md)). |

## When this applies

Any PR that:

1. Adds or modifies `Playbook.config.assessmentPlan` JSON on a
   published course
2. Adds or modifies an `AuthoredModule` that is cited by an existing
   `AssessmentMoment.moduleSlug` (mode change can break the
   moment's `kind` match)
3. Adds or modifies a `ContentSource` row that is cited by an
   `AssessmentMoment`'s sampling policy
4. Adds or modifies an `AnalysisSpec` cited by an `AssessmentMoment.scoringSpec`
5. Adds a new published course to the catalogue — author must declare
   either a plan OR `noAssessmentPlan: true` (forces a conscious
   decision, no silent default)
6. Touches one of the 4 fragmenting enums (`SessionKindString`,
   `JourneyStopKind`, `FirstCallMode`, `AuthoredModuleMode`) — the
   gate re-classifies every plan to surface drift

## When NOT to apply

The gate is **structural** and always runs. What's exempted are
specific courses via `noAssessmentPlan: true`:

| Course shape | Why exempt |
|---|---|
| **Coaching-led** | The session model is conversational coaching, not assessable moments. e.g. CIO/CTO Revision Aid (mode: mixed — by design). |
| **Continuous-only** | The course has no formal assessment moments; assessment is replaced by per-call adaptive scoring. e.g. Big Five OCEAN (sessionTerminal not formal scoring). |
| **In-flight scoring authoring** | The plan exists in the BDD but the scoring spec isn't authored yet. e.g. Persuasion Literacy until the rubric ships. Exempt with reason `"scoring spec pending — see #NNNN"`. |
| **Empty courses** | E2E Adaptive v1 + similar test playbooks. |

`noAssessmentPlan: true` is **load-bearing** — it forces the operator
to consciously declare "this course intentionally has no formal
assessment design", rather than allowing silent omission.

## Canonical shape

The declarative plan in `Playbook.config.assessmentPlan`:

```typescript
type CourseAssessmentPlan = {
  upfront?: AssessmentMoment;
  midpoints?: AssessmentMoment[];
  end?: AssessmentMoment;
  noAssessmentPlan?: true;
};

type AssessmentMoment = {
  kind: AssessmentKind;
  moduleSlug: string;
  samplingPolicy: AssessmentSamplingPolicy;
  shellKind: LearnerShellKind;
  scoringSpec: string;
};

type AssessmentKind =
  | "upfront-baseline"
  | "midpoint-check"
  | "end-mock"
  | "popquiz"
  | "rubric-board-chair";

type AssessmentSamplingPolicy = {
  scope: "per-unit" | "cross-curriculum"
       | "weakest-skill-anchored" | "weakest-lo-anchored";
  count: { min: number; target: number; max: number };
  contentKind: "mcq" | "cue-card" | "topic-prompt" | "scenario-probe";
  stratification?: {
    perCriterionMin?: number;
    perLoMin?: number;
  };
};
```

Types declared in `lib/types/json-fields.ts` (S1 of epic #2176, in
flight via sibling agent). Sampling engine at
`lib/assessment/sample-questions.ts` (S2, in flight). This rule
documents the operator + structural discipline; it does not declare
the types.

## Author checklist — adding a new assessment moment to a published course

Same PR:

1. **Declare the moment** in `Playbook.config.assessmentPlan` as an
   `upfront`, `midpoints[]` entry, or `end`. Pick the correct
   `AssessmentKind` for the slot:
   - upfront → `"upfront-baseline"`
   - midpoint → `"midpoint-check"` (or `"popquiz"` for per-unit
     CIO/CTO style)
   - end → `"end-mock"` (or `"rubric-board-chair"` for CIO/CTO
     Distinction-tier delivery)
2. **Confirm the `moduleSlug`** points at an `AuthoredModule` already
   declared in `Playbook.config.modules[]`.
3. **Confirm the module's `mode`** matches the kind:
   - `"upfront-baseline"` / `"end-mock"` → module mode `"examiner"`
     or `"mock-exam"`
   - `"popquiz"` → module mode `"quiz"`
   - `"rubric-board-chair"` → module mode `"examiner"` (with the
     rubric scoring spec)
4. **Author the `samplingPolicy`**:
   - `scope` — pick `"per-unit"` for popquiz, `"cross-curriculum"`
     for upfront + end, `"weakest-*-anchored"` for adaptive midpoints
   - `count` — `{ min, target, max }` triple; min ≤ target ≤ max
   - `contentKind` — must match what's available in the cited
     content sources (the gate cross-checks via
     `source-ref-coverage.test.ts`)
   - `stratification` — set `perCriterionMin` ≥ 1 for IELTS-shape
     courses (Fluency / Lexical / Grammar / Pronunciation each get
     at least one item)
5. **Confirm the `scoringSpec`** is an existing `AnalysisSpec.slug`
   (typically authored same-PR if this is a new assessment).
6. **Cross-check `FirstCallMode`** — if the plan declares
   `upfront.kind === "upfront-baseline"`, the Playbook's
   `firstCallMode` should be `"baseline_assessment"`. If they
   disagree, the gate fails.
7. **Run the gate**:
   `npx vitest run tests/lib/assessment/course-assessment-plan-coverage.test.ts`.
   Green → ship. `gap` → fix the unresolved reference OR add
   `noAssessmentPlan: true` if the design has changed.
8. **Live verification** post-merge: on hf_sandbox, the next session
   on that course's intake should fire the upfront moment (or the
   next end-of-curriculum session should fire the end moment). The
   pipeline AppLog subject `assessment.moment.fired` reports
   `{ playbookId, momentKind, moduleSlug, sampledCount }`.

## Author checklist — adding a new published course

Same PR or follow-on within the same epic:

1. Decide the course's assessment design: does it have formal
   moments (yes — declare a plan) or is it coaching-led /
   continuous-only (no — declare `noAssessmentPlan: true`)?
2. If yes-plan: follow the moment checklist above for each declared
   moment.
3. If no-plan: set `assessmentPlan: { noAssessmentPlan: true }` in
   `Playbook.config`. The exempt reason should explain why
   (e.g. `"coaching-led — sessions are reflective dialogues, not
   assessable moments"`).
4. The gate at land time will classify the new course; ratchet
   bumps if the plan is `gap`.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `tests/lib/assessment/course-assessment-plan-coverage.test.ts` (in flight, S3 of epic #2176) | Cross-enum Coverage gate: walks every published Playbook, classifies each `AssessmentMoment` as `resolvable` / `exempt` / `gap`. Ratchets incumbent count at launch. | New course launches without an assessment design decision; moments that cite non-existent modules / spec slugs; FirstCallMode-vs-plan drift |
| `lib/assessment/sample-questions.ts` (in flight, S2 of epic #2176) | Course-agnostic pure sampling engine. Reads the plan + queries typed `ContentQuestion` / `ContentSource` rows. AppLog `data_presence.unresolved` on miss. | Per-course imperative sampling code; silent null returns from the sampling engine |
| `lib/types/json-fields.ts::CourseAssessmentPlan` + siblings (in flight, S1 of epic #2176) | TypeScript primitives | Typo-class drift in plan declarations; unresolvable plan shapes at compile time |
| Sibling [`mode-spec-selection-coverage.md`](./mode-spec-selection-coverage.md) | Pins that the assessment module's `mode` has a scoring spec wired | `AuthoredModuleMode` reaching the runtime without a spec selector match |
| Sibling [`source-ref-coverage.md`](./source-ref-coverage.md) | Pins that the assessment module's content sources resolve to `ContentSource` rows | The `samplingPolicy.contentKind` referencing a content kind that doesn't exist in DB |
| Sibling [`sessionkind-reader-coverage.md`](./sessionkind-reader-coverage.md) | Pins the SessionKind writer/reader pairing | The `ASSESSMENT` ghost staying unresolved (this rule's plan declaration is the structural surface that drives the decision) |
| Sibling [`data-presence-coverage.md`](./data-presence-coverage.md) | Parent sub-pillar discipline | Generic absence-of-row failure modes |
| `components/scoring-tab/AssessmentPlanEditor.tsx` + `components/scoring-tab/AssessmentMomentEditor.tsx` (this PR — #2176 S1 lens build) | Operator UI for declarative plan authoring + `noAssessmentPlan` opt-out | Operators authoring / iterating / opting-out of plans without editing JSON in DB; drives Coverage gate gap-count toward 0. Inline mode-mismatch warnings (kind ↔ moduleSlug.mode) + count-invalid warnings + contradiction warning (noAssessmentPlan + moments) all surface at edit time. |
| `app/api/courses/[courseId]/journey-setting/route.ts` (Slice 9 of #2176 S1) | Server-side AppLog `assessment.plan.contradiction` on save | Silent operator save of `noAssessmentPlan:true` AND moments — the route writes a fire-and-forget AppLog so the dual state is operator-visible in logs without blocking the write (operator decision 1 + 8 ratified). |
| `app/api/system/spec-slugs/route.ts` (Slice 8 of #2176 S1) | OPERATOR-only typeahead endpoint feeding the scoringSpec dropdown | Operators authoring a plan against a non-existent or wrong-shape spec slug; the route filters by `outputType` (e.g. `MEASURE`) so the dropdown only surfaces canonical scoring specs. |

## When the gate legitimately stays orange

A few course shapes don't resolve through the same gate:

- **In-flight scoring authoring** — the plan is declared but cites a
  scoring spec that hasn't been authored yet. Mark with
  `noAssessmentPlan: true` (temporary) + a `// TODO(assessment-plan): see #NNNN` comment, OR exempt the specific moment with reason
  `"scoring spec pending — see #NNNN"`.
- **#2009 CIO/CTO trio** — Pop Quiz and Exam Assessment plans depend
  on the variant mechanics ship. Exempt with reason
  `"#2009 trio mechanics pending"`.
- **#2167 IELTS Sources backfill** — IELTS plan declarations depend
  on the 5 missing `ContentSource` rows landing. Exempt with reason
  `"IELTS Sources 1-5 backfill pending — see #2167"`.

These exemptions clear automatically once the cited blocker ships;
the gate re-classifies the moment from `exempt` back to `resolvable`
on the next run.

## Future hardening

When the launch incumbent gap-count drops to 0 (every published
course has either a `resolvable` plan or an explicit
`noAssessmentPlan: true`), promote the ratchet to a strict `=== 0`
check. At that point new courses MUST land with an assessment design
decision — no implicit-default path remains.

When the runtime sampling engine emits enough `assessment.moment.fired`
AppLog entries to establish baselines (~50 per moment kind per
course), add a sibling Coverage test that pins the empirical
distribution against the declared `samplingPolicy.count` triple. A
moment that consistently fires below `count.min` items signals either
a content-source under-population or a sampling-engine bug.

## Related

- [`tests/lib/assessment/course-assessment-plan-coverage.test.ts`](../../apps/admin/tests/lib/assessment/course-assessment-plan-coverage.test.ts) — the gate (S3 of epic #2176, in flight via sibling agent)
- [`apps/admin/lib/assessment/sample-questions.ts`](../../apps/admin/lib/assessment/sample-questions.ts) — the course-agnostic sampling engine (S2, in flight)
- [`apps/admin/lib/types/json-fields.ts`](../../apps/admin/lib/types/json-fields.ts) — the typed primitives (S1, in flight)
- [`.claude/rules/data-presence-coverage.md`](./data-presence-coverage.md) — parent sub-pillar meta-rule (PR #2170, in flight)
- [`.claude/rules/mode-ui-coverage.md`](./mode-ui-coverage.md) — sibling typed primitive Coverage (`AuthoredModuleMode` 3-axis)
- [`.claude/rules/mode-spec-selection-coverage.md`](./mode-spec-selection-coverage.md) — sibling: `AuthoredModuleMode` → runtime spec selection
- [`.claude/rules/sessionkind-reader-coverage.md`](./sessionkind-reader-coverage.md) — sibling: SessionKind writer/reader pairing; this rule's plan declaration is the structural surface that drives the `ASSESSMENT` ghost decision
- [`.claude/rules/source-ref-coverage.md`](./source-ref-coverage.md) — sibling Data Presence gate; cross-checked at plan resolution
- [`.claude/rules/learner-ui-leak-coverage.md`](./learner-ui-leak-coverage.md) — learner-safe projection discipline that assessment delivery shells must respect
- Epic [#2176](https://github.com/WANDERCOLTD/HF/issues/2176) — this primitive
- Epic [#2168](https://github.com/WANDERCOLTD/HF/issues/2168) — Data Presence Coverage umbrella
- Sibling 4th-layer primitive [#2145](https://github.com/WANDERCOLTD/HF/issues/2145) — SessionFocus substrate
- Sibling 4th-layer primitive [#2163](https://github.com/WANDERCOLTD/HF/issues/2163) — LearnerShell typed primitive
- Story [#2009](https://github.com/WANDERCOLTD/HF/issues/2009) — CIO/CTO trio variant mechanics (delivers quiz + mock-exam infra this primitive composes)
- Story [#2135](https://github.com/WANDERCOLTD/HF/issues/2135) — IELTS canonical MEASURE specs (delivers scoring axis this primitive's `scoringSpec` field cites)
- Story [#2167](https://github.com/WANDERCOLTD/HF/issues/2167) — IELTS Sources backfill (clears IELTS plan exemption)
- PR #2144 — established sibling Coverage gates (mode-ui-coverage + sessionkind-reader-coverage + learner-ui-leak-coverage)
- PR #2173 — LearnerShell types (this primitive uses `LearnerShellKind` in `AssessmentMoment.shellKind`)
- PR #2175 — source-ref Coverage (this primitive depends on its content-source resolution)
- Memory: `feedback_lattice_5th_pillar_coverage.md` — Coverage pillar framing
