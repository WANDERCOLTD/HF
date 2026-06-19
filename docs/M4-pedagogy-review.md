# M4 — Pedagogy review worksheet (epic #1967)

Of the 57 deferred params (`measurement: "deferred-#1967"`) M1 surfaced, M4 reclassified 9 in the same PR (3 measured via STYLE-001 alias-citation; 6 operator-only tutor knobs). **The M4 structural pass (2026-06-19) reclassified 14 more without pedagogy input** using the decision tree in [`.claude/rules/parameter-measurement-coverage.md`](../.claude/rules/parameter-measurement-coverage.md). The remaining **34 active rows** below need pedagogy review.

**For each row, the reviewer picks one of:**

- **`measure`** — author a MEASURE AnalysisSpec that scores this from transcript. Note the proposed spec id.
- **`operator-only`** — non-measurable tutor knob; reclassify in registry as `usage.measurement: { kind: "operator-only", reason: "..." }`. Use one of the three reason templates in the decision tree (tutor-emit directive / folk-pedagogy assertion / ADAPT-stage decision rule).
- **`defer`** — genuinely cannot decide today; keep as `"deferred-#1967"`.

Closing the loop for `measure` rows also closes the M2 loop-closure ratchet by 1 if an AGGREGATE / ADAPT spec already consumes the param — or the same PR extends one to do so.

## Structural pass completed (2026-06-19) — DO NOT review again

The 14 rows below were structurally classified without pedagogy input and now carry an `operator-only` measurement kind in the registry. Tracked here for audit trail:

| parameterId | shape | drop-rationale |
|---|---|---|
| `BEH-ABSTRACT-VS-CONCRETE` | tutor-emit directive | Already wired to STYLE section via `parametersAsDirectives` (#1907); stale `deferred-#1967` row |
| `analogy-usage`, `concept-density`, `example-richness`, `repetition-frequency`, `scaffolding` | folk-pedagogy assertion | Learner-preference statements paired with BEH-* siblings; not derivable from one transcript |
| `BEH-ADVANCE-READINESS`, `BEH-CHALLENGE-LEVEL`, `BEH-FOUNDATION-FOCUS`, `BEH-INTERLEAVING`, `BEH-NEW-CONTENT-RATE`, `BEH-PREREQUISITE-CALLBACK`, `BEH-PRODUCTIVE-STRUGGLE`, `BEH-SPACED-RETRIEVAL-PRIORITY` | ADAPT-stage decision rule | Consumed by ADAPT-runner against aggregated mastery; not an EXTRACT-stage observable |

## `curriculum-adaptation` (12 params remaining — 8 already classified above)

| parameterId | definition | proposed classification |
|---|---|---|
| `BEH-ANALOGY-USAGE` | How often the AI uses analogies and metaphors to bridge from familiar concepts to new ones. | _(reviewer)_ |
| `BEH-CHECK-FOR-UNDERSTANDING` | How frequently the AI pauses to verify the learner has understood before moving on. | _(reviewer)_ |
| `BEH-CONCEPT-DENSITY` | How many new ideas the AI introduces in a single exchange. | _(reviewer)_ |
| `BEH-EXAMPLE-RICHNESS` | How many concrete examples the AI provides when explaining a concept. | _(reviewer)_ |
| `BEH-EXPLANATION-VARIETY` | Whether the AI tries different approaches when a learner doesn't understand the first time. | _(reviewer)_ |
| `BEH-GUIDED-PRACTICE` | How much step-by-step support the AI provides during practice activities. | _(reviewer)_ |
| `BEH-NUANCE-EXPLORATION` | How deeply the AI explores edge cases, exceptions, and subtle distinctions. | _(reviewer)_ |
| `BEH-PRACTICE-RATIO` | The balance between explanation and hands-on practice in each session. | _(reviewer)_ |
| `BEH-PROBING-QUESTIONS` | How often the AI asks deeper follow-up questions to extend the learner's thinking. | _(reviewer)_ |
| `BEH-REPETITION-FREQUENCY` | How often the AI restates or revisits key concepts within a session. | _(reviewer)_ |
| `BEH-SCAFFOLDING` | How much structural support the AI provides to help the learner tackle complex tasks. | _(reviewer)_ |
| `BEH-WORKED-EXAMPLES` | Whether the AI demonstrates complete solutions before asking the learner to try. | _(reviewer)_ |

## `learning-adaptation` (21 params remaining — 6 already classified above: `BEH-ABSTRACT-VS-CONCRETE` + 5 legacy lowercase)

| parameterId | definition | proposed classification |
|---|---|---|
| `BEH-ABSTRACT-OK` | How comfortable the learner is with theoretical and abstract concepts versus concrete ones. | _(reviewer)_ |
| `BEH-ACTION-VERBS` | Whether the AI uses action-oriented, practical language versus abstract terminology. | _(reviewer)_ |
| `BEH-APPROACH-SWITCHING` | How freely the AI switches between different teaching modalities during a session. | _(reviewer)_ |
| `BEH-DEFINITION-PRECISION` | How precisely the AI defines technical terms and concepts. | _(reviewer)_ |
| `BEH-DIAGRAM-LANGUAGE` | How much the AI describes concepts using visual/spatial structures (diagrams, charts, maps). | _(reviewer)_ |
| `BEH-ENGAGEMENT-PROMPTS` | Conversational learners like to be drawn into dialogue | _(reviewer)_ |
| `BEH-EXPLANATION-DEPTH` | Reading learners can handle detailed explanations | _(reviewer)_ |
| `BEH-FEELING-LANGUAGE` | How much the AI uses sensory and emotional language (feel, sense, touch, experience). | _(reviewer)_ |
| `BEH-IMAGERY-DENSITY` | How much the AI uses vivid mental imagery and visualisation in explanations. | _(reviewer)_ |
| `BEH-LIST-STRUCTURE` | How much the AI organises information into numbered lists, hierarchies, and structured formats. | _(reviewer)_ |
| `BEH-MODALITY-CONSISTENCY` | Whether the AI sticks to the learner's preferred learning modality or varies approaches. | _(reviewer)_ |
| `BEH-MODALITY-VARIETY` | How many different teaching channels the AI uses based on the content being taught. | _(reviewer)_ |
| `BEH-PRACTICE-EXERCISES` | How much the AI includes hands-on activities and exercises in the learning experience. | _(reviewer)_ |
| `BEH-REAL-WORLD-EXAMPLES` | How much the AI connects abstract concepts to practical, everyday applications. | _(reviewer)_ |
| `BEH-REPETITION-OFFER` | How proactively the AI offers to repeat or rephrase key points. | _(reviewer)_ |
| `BEH-RHYTHM-ATTENTION` | How much the AI attends to the pace, cadence, and flow of spoken delivery. | _(reviewer)_ |
| `BEH-SOCRATIC-QUESTIONING` | Conversational learners engage well with questions | _(reviewer)_ |
| `BEH-SPATIAL-METAPHOR` | How much the AI uses spatial organisation and location-based metaphors. | _(reviewer)_ |
| `BEH-TERMINOLOGY-FORMAL` | How much the AI uses formal, subject-specific vocabulary versus everyday language. | _(reviewer)_ |
| `BEH-VERBAL-ELABORATION` | How richly and extensively the AI elaborates on concepts through spoken explanation. | _(reviewer)_ |
| `BEH-WRITTEN-ALTERNATIVE` | How much the AI offers written references, summaries, or notes alongside spoken teaching. | _(reviewer)_ |

## `reinforcement` (1 params)

| parameterId | definition | proposed classification |
|---|---|---|
| `BEH-ERROR-ELABORATION` | Detailed feedback learners want thorough error explanations | _(reviewer)_ |

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