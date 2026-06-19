# Parameter Rename Map (S2 of epic #1946 / story #1950)

Generated 2026-06-18 from `apps/admin/docs-archive/bdd-specs/behavior-parameters.registry.json`.

## Summary

| Class | Count | Action |
|---|---:|---|
| Already canonical `BEH-*` | 55 | No action |
| Mechanical renames to `BEH-*` | **73** | Per-row migration + alias |
| VARK modality params | 5 | Defer to #1966 (retire surface) |
| Dedup colliders (need pedagogy) | 6 | Defer to follow-on dedup story |
| **Total active params** | **139** | |

## Rename rules

1. **snake_case** → `BEH-` + UPPERCASE + hyphens (`abstract_vs_concrete` → `BEH-ABSTRACT-VS-CONCRETE`)
2. **kebab-no-BEH** → `BEH-` + uppercase (`abstract-vs-concrete` → `BEH-ABSTRACT-VS-CONCRETE`)
3. **SCREAMING_SNAKE** → `BEH-` + hyphenated (`CONV_DOM` → `BEH-CONV-DOM`)
4. **B5 OCEAN trait codes** → preserve framework code: `B5-A` → `BEH-B5-A` (avoids collision with `*_adaptation` siblings which measure the AI's adaptation, not the trait)
5. **COMP-* companion params** → drop `COMP-` prefix (`domainGroup: "companion"` already namespaces): `COMP-ENERGY` → `BEH-ENERGY`
6. **VARK modality codes** → unchanged in S2 (deferred to #1966 which retires the VARK measurable surface in favour of declared learner preferences)
7. **Edge cases**:
   - `CP-004` → `BEH-COGNITIVE-ACTIVATION` (stranded test id)
   - `scaffolding` → **DEFER** (collides with existing `BEH-SCAFFOLDING` in `curriculum-adaptation` — pedagogy review needed)

## Renames (73)

| Old `parameterId` | New `parameterId` | `domainGroup` |
|---|---|---|
| `abstract-vs-concrete` | `BEH-ABSTRACT-VS-CONCRETE` | learning-adaptation |
| `adapt_to_feedback_style` | `BEH-ADAPT-TO-FEEDBACK-STYLE` | learning-adaptation |
| `adapt_to_interaction_style` | `BEH-ADAPT-TO-INTERACTION-STYLE` | learning-adaptation |
| `adapt_to_question_frequency` | `BEH-ADAPT-TO-QUESTION-FREQUENCY` | learning-adaptation |
| `aggregate_profile` | `BEH-AGGREGATE-PROFILE` | learning-adaptation |
| `agreeableness_adaptation` | `BEH-AGREEABLENESS-ADAPTATION` | personality-adaptation |
| `application_adaptation` | `BEH-APPLICATION-ADAPTATION` | curriculum-adaptation |
| `application_score` | `BEH-APPLICATION-SCORE` | curriculum-adaptation |
| `B5-A` | `BEH-B5-A` | personality-adaptation |
| `B5-C` | `BEH-B5-C` | personality-adaptation |
| `B5-E` | `BEH-B5-E` | personality-adaptation |
| `B5-N` | `BEH-B5-N` | personality-adaptation |
| `B5-O` | `BEH-B5-O` | personality-adaptation |
| `call_frequency_adaptation` | `BEH-CALL-FREQUENCY-ADAPTATION` | engagement |
| `chunk-size` | `BEH-CHUNK-SIZE` | engagement |
| `communication_complexity_adaptation` | `BEH-COMMUNICATION-COMPLEXITY-ADAPTATION` | engagement |
| `COMP-DEPTH-PREFERENCE` | `BEH-DEPTH-PREFERENCE` | companion |
| `COMP-ENERGY` | `BEH-ENERGY` | companion |
| `COMP-ENGAGEMENT` | `BEH-ENGAGEMENT` | companion |
| `COMP-MOOD` | `BEH-MOOD` | companion |
| `COMP-REMINISCENCE` | `BEH-REMINISCENCE` | companion |
| `composite_reward` | `BEH-COMPOSITE-REWARD` | reinforcement |
| `comprehension_adaptation` | `BEH-COMPREHENSION-ADAPTATION` | curriculum-adaptation |
| `comprehension_score` | `BEH-COMPREHENSION-SCORE` | curriculum-adaptation |
| `concept_exposure` | `BEH-CONCEPT-EXPOSURE` | curriculum-adaptation |
| `conscientiousness_adaptation` | `BEH-CONSCIENTIOUSNESS-ADAPTATION` | personality-adaptation |
| `context_setting_quality` | `BEH-CONTEXT-SETTING-QUALITY` | onboarding |
| `CONV_DOM` | `BEH-CONV-DOM` | engagement |
| `CP-004` | `BEH-COGNITIVE-ACTIVATION` | engagement |
| `crisis_detection_score` | `BEH-CRISIS-DETECTION-SCORE` | supervision |
| `default_targets_quality` | `BEH-DEFAULT-TARGETS-QUALITY` | onboarding |
| `engagement_adaptation` | `BEH-ENGAGEMENT-ADAPTATION` | engagement |
| `engagement_reward` | `BEH-ENGAGEMENT-REWARD` | reinforcement |
| `engagement_trend_score` | `BEH-ENGAGEMENT-TREND-SCORE` | supervision |
| `engagement_with_examples` | `BEH-ENGAGEMENT-WITH-EXAMPLES` | learning-adaptation |
| `engagement-prompts` | `BEH-ENGAGEMENT-PROMPTS` | learning-adaptation |
| `error-elaboration` | `BEH-ERROR-ELABORATION` | reinforcement |
| `explanation-depth` | `BEH-EXPLANATION-DEPTH` | learning-adaptation |
| `exploration_structure` | `BEH-EXPLORATION-STRUCTURE` | behavior-core |
| `extraversion_adaptation` | `BEH-EXTRAVERSION-ADAPTATION` | personality-adaptation |
| `goal_discovery_quality` | `BEH-GOAL-DISCOVERY-QUALITY` | onboarding |
| `goal_progress_reward` | `BEH-GOAL-PROGRESS-REWARD` | reinforcement |
| `insight_quality` | `BEH-INSIGHT-QUALITY` | companion |
| `learning_progress_score` | `BEH-LEARNING-PROGRESS-SCORE` | supervision |
| `learning_reward` | `BEH-LEARNING-REWARD` | reinforcement |
| `learning_velocity_adaptation` | `BEH-LEARNING-VELOCITY-ADAPTATION` | engagement |
| `mastery_adaptation` | `BEH-MASTERY-ADAPTATION` | curriculum-adaptation |
| `module_introduction` | `BEH-MODULE-INTRODUCTION` | curriculum-adaptation |
| `module_mastery` | `BEH-MODULE-MASTERY` | curriculum-adaptation |
| `multimodal_adaptation` | `BEH-MULTIMODAL-ADAPTATION` | learning-adaptation |
| `neuroticism_adaptation` | `BEH-NEUROTICISM-ADAPTATION` | personality-adaptation |
| `openness_adaptation` | `BEH-OPENNESS-ADAPTATION` | personality-adaptation |
| `pause-for-questions` | `BEH-PAUSE-FOR-QUESTIONS` | engagement |
| `preference_elicitation_quality` | `BEH-PREFERENCE-ELICITATION-QUALITY` | onboarding |
| `prerequisite_adaptation` | `BEH-PREREQUISITE-ADAPTATION` | curriculum-adaptation |
| `prerequisite_check` | `BEH-PREREQUISITE-CHECK` | curriculum-adaptation |
| `question_asking_rate` | `BEH-QUESTION-ASKING-RATE` | learning-adaptation |
| `rapport_reward` | `BEH-RAPPORT-REWARD` | reinforcement |
| `reading_writing_adaptation` | `BEH-READING-WRITING-ADAPTATION` | learning-adaptation |
| `response_length_preference` | `BEH-RESPONSE-LENGTH-PREFERENCE` | learning-adaptation |
| `response_length_score` | `BEH-RESPONSE-LENGTH-SCORE` | supervision |
| `review_adaptation` | `BEH-REVIEW-ADAPTATION` | curriculum-adaptation |
| `review_status` | `BEH-REVIEW-STATUS` | curriculum-adaptation |
| `safety_compliance_score` | `BEH-SAFETY-COMPLIANCE-SCORE` | supervision |
| `socratic-questioning` | `BEH-SOCRATIC-QUESTIONING` | learning-adaptation |
| `student_application_score` | `BEH-STUDENT-APPLICATION-SCORE` | supervision |
| `style_consistency_score` | `BEH-STYLE-CONSISTENCY-SCORE` | supervision |
| `target_alignment_score` | `BEH-TARGET-ALIGNMENT-SCORE` | supervision |
| `TONE_ASSERT` | `BEH-TONE-ASSERT` | engagement |
| `tutor_fidelity_score` | `BEH-TUTOR-FIDELITY-SCORE` | supervision |
| `tutor_intro_score` | `BEH-TUTOR-INTRO-SCORE` | supervision |
| `tutor_sequence_score` | `BEH-TUTOR-SEQUENCE-SCORE` | supervision |
| `welcome_quality` | `BEH-WELCOME-QUALITY` | onboarding |

## Deferred — dedup candidates (6)

These 6 kebab-no-BEH params collide with existing canonical `BEH-*` params of the same root name in different `domainGroup`s. They look like dedup candidates S1 missed (same shape as the warmth / pace / formality / directness / empathy clusters). They require pedagogy review to decide canonical winner. **File follow-on story.**

| Loser candidate | Existing canonical | Domain conflict |
|---|---|---|
| `analogy-usage` | `BEH-ANALOGY-USAGE` | learning-adaptation |
| `check-for-understanding` | `BEH-CHECK-FOR-UNDERSTANDING` | engagement |
| `concept-density` | `BEH-CONCEPT-DENSITY` | learning-adaptation |
| `example-richness` | `BEH-EXAMPLE-RICHNESS` | learning-adaptation |
| `repetition-frequency` | `BEH-REPETITION-FREQUENCY` | learning-adaptation |
| `scaffolding` | `BEH-SCAFFOLDING` | learning-adaptation |

## Deferred — VARK modality (5)

Retired entirely by #1966 (measurable surface → declared learner preferences). Don't rename in S2.

| `parameterId` | Action | `domainGroup` |
|---|---|---|
| `VARK-A` | (defer to #1966) | learning-adaptation |
| `VARK-K` | (defer to #1966) | learning-adaptation |
| `VARK-PROFILE` | (defer to #1966) | learning-adaptation |
| `VARK-R` | (defer to #1966) | learning-adaptation |
| `VARK-V` | (defer to #1966) | learning-adaptation |

## Migration approach

Per-row `UPDATE Parameter SET parameterId = '<NEW>', aliases = array_append(aliases, '<OLD>') WHERE parameterId = '<OLD>'` wrapped in a `$transaction`. All `Parameter.parameterId` FK constraints in the schema use `ON UPDATE CASCADE` (verified: `BehaviorTarget`, `CallScore`, `ParameterTag`, `ParameterMapping`, `ParameterSetParameter`, `BddAcceptanceCriteria`, `ParameterScoringAnchor`, `KnowledgeArtifact`, `ParameterKnowledgeLink`, `ControlSetParameter`), so child rows follow automatically.

Idempotency: a re-run finds no rows matching `WHERE parameterId = '<OLD>'` (already swapped) so each statement is a no-op.

## Lattice survey

- **Sibling-writer drift**: 13+ writers to `Parameter` (seed scripts, admin sync, lab features, parameters CRUD, wizard `upsertParameters`). All key by `parameterId`. After rename, seed scripts re-running with old names would attempt to INSERT new rows with old IDs (which now have rows with the new ID). The `aliases[]` array stays the source of truth for the resolver. Strategy: registry JSON is updated to new names, so re-seeds work. ESLint rule (`hf-registry/no-bare-parameter-id`) blocks string literals of legacy IDs outside allow-list.
- **Default-deny gate**: new ESLint rule added.
- **Cascade respect**: `getEffectiveBehaviorTargetsForCaller` already uses `resolveParameterIds` (S1). After rename, reads still find the value via alias fallback. ✓
- **Convention conflict**: Confirmed `BEH-*` kebab. ✓

## Pedagogy notes

No semantic shifts in any of the 73 renames — purely structural ID changes. Each param keeps its definition, domainGroup, defaultTarget, promptInjection block. The previous name is preserved in `aliases[]` so any existing reference (course-ref YAML, hardcoded seed, operator-pinned tune) continues to resolve via `lib/registry/resolve.ts::resolveParameterId`.

## References

- Sister story S1 (#1949) — alias resolver + 5 dedup clusters
- Sister story S4 (#1951) — interpretation backfill + SEMANTICS render block (closes 5/139 → 139/139 emission gap)
- Follow-on #1966 — retire VARK UI on Caller detail
- Follow-on (to file) — 6 dedup candidates discovered during S2
