# M4 — Pedagogy review worksheet (epic #1967)

Of the 57 deferred params (`measurement: "deferred-#1967"`) M1 surfaced, M4 reclassified 9 in the same PR (3 measured via STYLE-001 alias-citation; 6 operator-only tutor knobs). The remaining 48 listed below need pedagogy review.

**For each row, the reviewer picks one of:**

- **`measure`** — author a MEASURE AnalysisSpec that scores this from transcript. Note the proposed spec id.
- **`operator-only`** — non-measurable tutor knob; reclassify in registry as `usage.measurement: { kind: "operator-only", reason: "..." }`.
- **`defer`** — genuinely cannot decide today; keep as `"deferred-#1967"`.

Closing the loop for `measure` rows also closes the M2 loop-closure ratchet by 1 if an AGGREGATE / ADAPT spec already consumes the param — or the same PR extends one to do so.

## `curriculum-adaptation` (20 params)

| parameterId | definition | proposed classification |
|---|---|---|
| `BEH-ADVANCE-READINESS` | How quickly the AI moves the learner to new material based on demonstrated understanding. | _(reviewer)_ |
| `BEH-ANALOGY-USAGE` | How often the AI uses analogies and metaphors to bridge from familiar concepts to new ones. | _(reviewer)_ |
| `BEH-CHALLENGE-LEVEL` | The difficulty of questions and problems the AI presents to the learner. | _(reviewer)_ |
| `BEH-CHECK-FOR-UNDERSTANDING` | How frequently the AI pauses to verify the learner has understood before moving on. | _(reviewer)_ |
| `BEH-CONCEPT-DENSITY` | How many new ideas the AI introduces in a single exchange. | _(reviewer)_ |
| `BEH-EXAMPLE-RICHNESS` | How many concrete examples the AI provides when explaining a concept. | _(reviewer)_ |
| `BEH-EXPLANATION-VARIETY` | Whether the AI tries different approaches when a learner doesn't understand the first time. | _(reviewer)_ |
| `BEH-FOUNDATION-FOCUS` | How much the AI prioritises filling gaps in prerequisite knowledge before advancing. | _(reviewer)_ |
| `BEH-GUIDED-PRACTICE` | How much step-by-step support the AI provides during practice activities. | _(reviewer)_ |
| `BEH-INTERLEAVING` | How much the AI mixes review of previous topics into current learning. | _(reviewer)_ |
| `BEH-NEW-CONTENT-RATE` | How quickly the AI introduces fresh material versus reviewing what's already been taught. | _(reviewer)_ |
| `BEH-NUANCE-EXPLORATION` | How deeply the AI explores edge cases, exceptions, and subtle distinctions. | _(reviewer)_ |
| `BEH-PRACTICE-RATIO` | The balance between explanation and hands-on practice in each session. | _(reviewer)_ |
| `BEH-PREREQUISITE-CALLBACK` | How often the AI explicitly links current material back to previously learned concepts. | _(reviewer)_ |
| `BEH-PROBING-QUESTIONS` | How often the AI asks deeper follow-up questions to extend the learner's thinking. | _(reviewer)_ |
| `BEH-PRODUCTIVE-STRUGGLE` | How long the AI lets a learner work through difficulty before stepping in to help. | _(reviewer)_ |
| `BEH-REPETITION-FREQUENCY` | How often the AI restates or revisits key concepts within a session. | _(reviewer)_ |
| `BEH-SCAFFOLDING` | How much structural support the AI provides to help the learner tackle complex tasks. | _(reviewer)_ |
| `BEH-SPACED-RETRIEVAL-PRIORITY` | How aggressively the AI schedules review of material showing signs of fading. | _(reviewer)_ |
| `BEH-WORKED-EXAMPLES` | Whether the AI demonstrates complete solutions before asking the learner to try. | _(reviewer)_ |

## `learning-adaptation` (27 params)

| parameterId | definition | proposed classification |
|---|---|---|
| `BEH-ABSTRACT-OK` | How comfortable the learner is with theoretical and abstract concepts versus concrete ones. | _(reviewer)_ |
| `BEH-ABSTRACT-VS-CONCRETE` | Visual learners prefer concrete over abstract | _(reviewer)_ |
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
| `analogy-usage` | Visual learners respond well to analogies | _(reviewer)_ |
| `concept-density` | Fast pace learners can handle more concepts at once | _(reviewer)_ |
| `example-richness` | Visual learners benefit from concrete examples | _(reviewer)_ |
| `repetition-frequency` | Slow pace learners benefit from repetition | _(reviewer)_ |
| `scaffolding` | Guided learners need structured support | _(reviewer)_ |

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

1. Update the registry row: `usage.measurement: { kind: "operator-only", reason: "<>20 chars explaining why this isn't measurable" }`.
2. Run `npx vitest run tests/lib/measurement/parameter-measurement-coverage.test.ts`. Drop `EXPECTED_GAP_COUNT` by the count moved.