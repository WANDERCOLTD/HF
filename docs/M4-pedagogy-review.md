# M4 — Pedagogy review worksheet (epic #1967)

Of the 57 deferred params (`measurement: "deferred-#1967"`) M1 surfaced, M4 reclassified 9 in the same PR (3 measured via STYLE-001 alias-citation; 6 operator-only tutor knobs). **The M4 structural pass 1 (2026-06-19, PR #2008) reclassified 14 more without pedagogy input** using the decision tree in [`.claude/rules/parameter-measurement-coverage.md`](../.claude/rules/parameter-measurement-coverage.md). **The M4 structural pass 2 (2026-06-19, this commit) reclassified a further 32 without pedagogy input** using the same decision tree more aggressively.

The remaining **2 active rows** below GENUINELY need pedagogy review — both are learner-state questions (not tutor knobs) and the decision tree cannot classify them mechanically.

**For each row, the reviewer picks one of:**

- **`measure`** — author a MEASURE AnalysisSpec that scores this from transcript. Note the proposed spec id.
- **`operator-only`** — non-measurable; reclassify in registry as `usage.measurement: { kind: "operator-only", reason: "..." }`. Use one of the three reason templates in the decision tree (tutor-emit directive / folk-pedagogy assertion / ADAPT-stage decision rule).
- **`defer`** — genuinely cannot decide today; keep as `"deferred-#1967"`.

Closing the loop for `measure` rows also closes the M2 loop-closure ratchet by 1 if an AGGREGATE / ADAPT spec already consumes the param — or the same PR extends one to do so.

## Structural passes completed (2026-06-19) — DO NOT review again

### Pass 1 (PR #2008, 14 rows)

| parameterId | shape | drop-rationale |
|---|---|---|
| `BEH-ABSTRACT-VS-CONCRETE` | tutor-emit directive | Already wired to STYLE section via `parametersAsDirectives` (#1907); stale `deferred-#1967` row |
| `analogy-usage`, `concept-density`, `example-richness`, `repetition-frequency`, `scaffolding` | folk-pedagogy assertion | Learner-preference statements paired with BEH-* siblings; not derivable from one transcript |
| `BEH-ADVANCE-READINESS`, `BEH-CHALLENGE-LEVEL`, `BEH-FOUNDATION-FOCUS`, `BEH-INTERLEAVING`, `BEH-NEW-CONTENT-RATE`, `BEH-PREREQUISITE-CALLBACK`, `BEH-PRODUCTIVE-STRUGGLE`, `BEH-SPACED-RETRIEVAL-PRIORITY` | ADAPT-stage decision rule | Consumed by ADAPT-runner against aggregated mastery; not an EXTRACT-stage observable |

### Pass 2 (this commit, 32 rows)

**29 tutor-emit directives** (curriculum-adaptation 12 + learning-adaptation 17) — definitions all read "How [much/often/many] the AI [verb]…" or "Whether the AI [verb]…". The AI is told via prompt; no learner-side signal reflects it back. SUPERVISE-stage compliance check is a separate concern.

| Cluster | parameterIds |
|---|---|
| curriculum-adaptation tutor-emit | `BEH-ANALOGY-USAGE`, `BEH-CHECK-FOR-UNDERSTANDING`, `BEH-CONCEPT-DENSITY`, `BEH-EXAMPLE-RICHNESS`, `BEH-EXPLANATION-VARIETY`, `BEH-GUIDED-PRACTICE`, `BEH-NUANCE-EXPLORATION`, `BEH-PRACTICE-RATIO`, `BEH-PROBING-QUESTIONS`, `BEH-REPETITION-FREQUENCY`, `BEH-SCAFFOLDING`, `BEH-WORKED-EXAMPLES` |
| learning-adaptation tutor-emit | `BEH-ACTION-VERBS`, `BEH-APPROACH-SWITCHING`, `BEH-DEFINITION-PRECISION`, `BEH-DIAGRAM-LANGUAGE`, `BEH-FEELING-LANGUAGE`, `BEH-IMAGERY-DENSITY`, `BEH-LIST-STRUCTURE`, `BEH-MODALITY-CONSISTENCY`, `BEH-MODALITY-VARIETY`, `BEH-PRACTICE-EXERCISES`, `BEH-REAL-WORLD-EXAMPLES`, `BEH-REPETITION-OFFER`, `BEH-RHYTHM-ATTENTION`, `BEH-SPATIAL-METAPHOR`, `BEH-TERMINOLOGY-FORMAL`, `BEH-VERBAL-ELABORATION`, `BEH-WRITTEN-ALTERNATIVE` |

**3 folk-pedagogy assertions** — definitions read "[LearnerType] learners [verb] …", paired with measurable BEH-* tutor-knob sibling axes.

| parameterId | sibling axis cited in reason |
|---|---|
| `BEH-ENGAGEMENT-PROMPTS` | `BEH-PROBING-QUESTIONS` / `BEH-SOCRATIC-QUESTIONING` |
| `BEH-EXPLANATION-DEPTH` | `BEH-DEFINITION-PRECISION` / `BEH-VERBAL-ELABORATION` |
| `BEH-SOCRATIC-QUESTIONING` | `BEH-PROBING-QUESTIONS` |

---

## Remaining 2 rows (genuine pedagogy decision required)

| parameterId | definition | why not auto-classified | proposed paths |
|---|---|---|---|
| `BEH-ABSTRACT-OK` | How comfortable the learner is with theoretical and abstract concepts versus concrete ones. | LEARNER-STATE, not tutor knob. Could be derived from transcript by analysing learner's engagement with abstract-probe questions across calls. Genuine pedagogy decision: measure (author a spec) vs operator-only (intake-captured profile field, not transcript-derived). | (a) MEASURE — author `ielts-abstract-comfort.spec.json` analysing learner abstract-engagement signal; (b) OPERATOR-ONLY — captured at intake / profile, no transcript inference; (c) DEFER |
| `BEH-ERROR-ELABORATION` | Detailed feedback learners want thorough error explanations | Definition wording is genuinely ambiguous. Reads as a folk-pedagogy assertion ("learners want…"), but the parameter name suggests a tutor-behavior knob (how much the AI elaborates on errors). Could be measured by counting feedback-block token length on error turns. | (a) MEASURE — author a small spec counting feedback-block tokens on error-correction turns; (b) OPERATOR-ONLY — tutor-emit directive (rewrite the definition to match other tutor-emit rows); (c) FOLK-PEDAGOGY — operator-only with the standard folk-pedagogy reason template |

---

## Author checklist after pedagogy review

For each `measure` row:

1. Author the AnalysisSpec under `apps/admin/docs-archive/bdd-specs/<slug>.spec.json`.
2. Update the registry row: `usage.measurement: { specSlug: "<slug>" }`.
3. If an AGGREGATE / ADAPT spec doesn't already cite the param, extend one (or the new spec) with the matching `sourceParameter` / `sourceParameterId` rule so the M2 loop closure ratchet drops too.
4. Run `npx vitest run tests/lib/measurement/`. Drop `EXPECTED_GAP_COUNT` in both M1 and M2 tests by the count moved.

For each `operator-only` row:

1. Update the registry row: `usage.measurement: { kind: "operator-only", reason: "<>40 chars matching one of the three reason templates in `.claude/rules/parameter-measurement-coverage.md`" }`.
2. Run `npx vitest run tests/lib/measurement/parameter-measurement-coverage.test.ts`. Drop `EXPECTED_GAP_COUNT` by the count moved.

When the 2 remaining rows resolve, the ratchet hits 0 and the M4 epic closes.
