-- #1950 — Rename non-canonical Parameter rows to BEH-* kebab convention.
--
-- See docs/PARAMETER-RENAME-MAP.md for the full rename map (73 rows) +
-- the 4 deferred cohorts (5 already canonical / 5 VARK awaiting #1966
-- / 6 dedup colliders awaiting follow-on).
--
-- Each statement:
--   UPDATE Parameter
--   SET parameterId = '<NEW>',
--       aliases = ARRAY(SELECT DISTINCT unnest(aliases || ARRAY['<OLD>']))
--   WHERE parameterId = '<OLD>';
--
-- All FKs to Parameter.parameterId in this schema use ON UPDATE CASCADE
-- (verified: BehaviorTarget, CallScore, ParameterTag, ParameterMapping,
-- ParameterSetParameter, BddAcceptanceCriteria, ParameterScoringAnchor,
-- KnowledgeArtifact, ParameterKnowledgeLink, ControlSetParameter).
-- Child rows update automatically on rename.
--
-- Idempotent: re-run finds no rows matching WHERE parameterId = '<OLD>'
-- (already swapped). Each statement is then a no-op. Safe to re-run.
--
-- Lattice survey: docs/PARAMETER-RENAME-MAP.md §"Lattice survey".

BEGIN;

UPDATE "Parameter"
SET "parameterId" = 'BEH-ABSTRACT-VS-CONCRETE',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['abstract-vs-concrete']))
WHERE "parameterId" = 'abstract-vs-concrete';

UPDATE "Parameter"
SET "parameterId" = 'BEH-ADAPT-TO-FEEDBACK-STYLE',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['adapt_to_feedback_style']))
WHERE "parameterId" = 'adapt_to_feedback_style';

UPDATE "Parameter"
SET "parameterId" = 'BEH-ADAPT-TO-INTERACTION-STYLE',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['adapt_to_interaction_style']))
WHERE "parameterId" = 'adapt_to_interaction_style';

UPDATE "Parameter"
SET "parameterId" = 'BEH-ADAPT-TO-QUESTION-FREQUENCY',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['adapt_to_question_frequency']))
WHERE "parameterId" = 'adapt_to_question_frequency';

UPDATE "Parameter"
SET "parameterId" = 'BEH-AGGREGATE-PROFILE',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['aggregate_profile']))
WHERE "parameterId" = 'aggregate_profile';

UPDATE "Parameter"
SET "parameterId" = 'BEH-AGREEABLENESS-ADAPTATION',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['agreeableness_adaptation']))
WHERE "parameterId" = 'agreeableness_adaptation';

UPDATE "Parameter"
SET "parameterId" = 'BEH-APPLICATION-ADAPTATION',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['application_adaptation']))
WHERE "parameterId" = 'application_adaptation';

UPDATE "Parameter"
SET "parameterId" = 'BEH-APPLICATION-SCORE',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['application_score']))
WHERE "parameterId" = 'application_score';

UPDATE "Parameter"
SET "parameterId" = 'BEH-B5-A',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['B5-A']))
WHERE "parameterId" = 'B5-A';

UPDATE "Parameter"
SET "parameterId" = 'BEH-B5-C',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['B5-C']))
WHERE "parameterId" = 'B5-C';

UPDATE "Parameter"
SET "parameterId" = 'BEH-B5-E',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['B5-E']))
WHERE "parameterId" = 'B5-E';

UPDATE "Parameter"
SET "parameterId" = 'BEH-B5-N',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['B5-N']))
WHERE "parameterId" = 'B5-N';

UPDATE "Parameter"
SET "parameterId" = 'BEH-B5-O',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['B5-O']))
WHERE "parameterId" = 'B5-O';

UPDATE "Parameter"
SET "parameterId" = 'BEH-CALL-FREQUENCY-ADAPTATION',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['call_frequency_adaptation']))
WHERE "parameterId" = 'call_frequency_adaptation';

UPDATE "Parameter"
SET "parameterId" = 'BEH-CHUNK-SIZE',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['chunk-size']))
WHERE "parameterId" = 'chunk-size';

UPDATE "Parameter"
SET "parameterId" = 'BEH-COMMUNICATION-COMPLEXITY-ADAPTATION',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['communication_complexity_adaptation']))
WHERE "parameterId" = 'communication_complexity_adaptation';

UPDATE "Parameter"
SET "parameterId" = 'BEH-DEPTH-PREFERENCE',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['COMP-DEPTH-PREFERENCE']))
WHERE "parameterId" = 'COMP-DEPTH-PREFERENCE';

UPDATE "Parameter"
SET "parameterId" = 'BEH-ENERGY',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['COMP-ENERGY']))
WHERE "parameterId" = 'COMP-ENERGY';

UPDATE "Parameter"
SET "parameterId" = 'BEH-ENGAGEMENT',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['COMP-ENGAGEMENT']))
WHERE "parameterId" = 'COMP-ENGAGEMENT';

UPDATE "Parameter"
SET "parameterId" = 'BEH-MOOD',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['COMP-MOOD']))
WHERE "parameterId" = 'COMP-MOOD';

UPDATE "Parameter"
SET "parameterId" = 'BEH-COMPOSITE-REWARD',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['composite_reward']))
WHERE "parameterId" = 'composite_reward';

UPDATE "Parameter"
SET "parameterId" = 'BEH-COMPREHENSION-ADAPTATION',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['comprehension_adaptation']))
WHERE "parameterId" = 'comprehension_adaptation';

UPDATE "Parameter"
SET "parameterId" = 'BEH-COMPREHENSION-SCORE',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['comprehension_score']))
WHERE "parameterId" = 'comprehension_score';

UPDATE "Parameter"
SET "parameterId" = 'BEH-REMINISCENCE',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['COMP-REMINISCENCE']))
WHERE "parameterId" = 'COMP-REMINISCENCE';

UPDATE "Parameter"
SET "parameterId" = 'BEH-CONCEPT-EXPOSURE',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['concept_exposure']))
WHERE "parameterId" = 'concept_exposure';

UPDATE "Parameter"
SET "parameterId" = 'BEH-CONSCIENTIOUSNESS-ADAPTATION',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['conscientiousness_adaptation']))
WHERE "parameterId" = 'conscientiousness_adaptation';

UPDATE "Parameter"
SET "parameterId" = 'BEH-CONTEXT-SETTING-QUALITY',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['context_setting_quality']))
WHERE "parameterId" = 'context_setting_quality';

UPDATE "Parameter"
SET "parameterId" = 'BEH-CONV-DOM',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['CONV_DOM']))
WHERE "parameterId" = 'CONV_DOM';

UPDATE "Parameter"
SET "parameterId" = 'BEH-COGNITIVE-ACTIVATION',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['CP-004']))
WHERE "parameterId" = 'CP-004';

UPDATE "Parameter"
SET "parameterId" = 'BEH-CRISIS-DETECTION-SCORE',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['crisis_detection_score']))
WHERE "parameterId" = 'crisis_detection_score';

UPDATE "Parameter"
SET "parameterId" = 'BEH-DEFAULT-TARGETS-QUALITY',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['default_targets_quality']))
WHERE "parameterId" = 'default_targets_quality';

UPDATE "Parameter"
SET "parameterId" = 'BEH-ENGAGEMENT-ADAPTATION',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['engagement_adaptation']))
WHERE "parameterId" = 'engagement_adaptation';

UPDATE "Parameter"
SET "parameterId" = 'BEH-ENGAGEMENT-PROMPTS',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['engagement-prompts']))
WHERE "parameterId" = 'engagement-prompts';

UPDATE "Parameter"
SET "parameterId" = 'BEH-ENGAGEMENT-REWARD',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['engagement_reward']))
WHERE "parameterId" = 'engagement_reward';

UPDATE "Parameter"
SET "parameterId" = 'BEH-ENGAGEMENT-TREND-SCORE',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['engagement_trend_score']))
WHERE "parameterId" = 'engagement_trend_score';

UPDATE "Parameter"
SET "parameterId" = 'BEH-ENGAGEMENT-WITH-EXAMPLES',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['engagement_with_examples']))
WHERE "parameterId" = 'engagement_with_examples';

UPDATE "Parameter"
SET "parameterId" = 'BEH-ERROR-ELABORATION',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['error-elaboration']))
WHERE "parameterId" = 'error-elaboration';

UPDATE "Parameter"
SET "parameterId" = 'BEH-EXPLANATION-DEPTH',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['explanation-depth']))
WHERE "parameterId" = 'explanation-depth';

UPDATE "Parameter"
SET "parameterId" = 'BEH-EXPLORATION-STRUCTURE',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['exploration_structure']))
WHERE "parameterId" = 'exploration_structure';

UPDATE "Parameter"
SET "parameterId" = 'BEH-EXTRAVERSION-ADAPTATION',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['extraversion_adaptation']))
WHERE "parameterId" = 'extraversion_adaptation';

UPDATE "Parameter"
SET "parameterId" = 'BEH-GOAL-DISCOVERY-QUALITY',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['goal_discovery_quality']))
WHERE "parameterId" = 'goal_discovery_quality';

UPDATE "Parameter"
SET "parameterId" = 'BEH-GOAL-PROGRESS-REWARD',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['goal_progress_reward']))
WHERE "parameterId" = 'goal_progress_reward';

UPDATE "Parameter"
SET "parameterId" = 'BEH-INSIGHT-QUALITY',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['insight_quality']))
WHERE "parameterId" = 'insight_quality';

UPDATE "Parameter"
SET "parameterId" = 'BEH-LEARNING-PROGRESS-SCORE',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['learning_progress_score']))
WHERE "parameterId" = 'learning_progress_score';

UPDATE "Parameter"
SET "parameterId" = 'BEH-LEARNING-REWARD',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['learning_reward']))
WHERE "parameterId" = 'learning_reward';

UPDATE "Parameter"
SET "parameterId" = 'BEH-LEARNING-VELOCITY-ADAPTATION',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['learning_velocity_adaptation']))
WHERE "parameterId" = 'learning_velocity_adaptation';

UPDATE "Parameter"
SET "parameterId" = 'BEH-MASTERY-ADAPTATION',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['mastery_adaptation']))
WHERE "parameterId" = 'mastery_adaptation';

UPDATE "Parameter"
SET "parameterId" = 'BEH-MODULE-INTRODUCTION',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['module_introduction']))
WHERE "parameterId" = 'module_introduction';

UPDATE "Parameter"
SET "parameterId" = 'BEH-MODULE-MASTERY',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['module_mastery']))
WHERE "parameterId" = 'module_mastery';

UPDATE "Parameter"
SET "parameterId" = 'BEH-MULTIMODAL-ADAPTATION',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['multimodal_adaptation']))
WHERE "parameterId" = 'multimodal_adaptation';

UPDATE "Parameter"
SET "parameterId" = 'BEH-NEUROTICISM-ADAPTATION',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['neuroticism_adaptation']))
WHERE "parameterId" = 'neuroticism_adaptation';

UPDATE "Parameter"
SET "parameterId" = 'BEH-OPENNESS-ADAPTATION',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['openness_adaptation']))
WHERE "parameterId" = 'openness_adaptation';

UPDATE "Parameter"
SET "parameterId" = 'BEH-PAUSE-FOR-QUESTIONS',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['pause-for-questions']))
WHERE "parameterId" = 'pause-for-questions';

UPDATE "Parameter"
SET "parameterId" = 'BEH-PREFERENCE-ELICITATION-QUALITY',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['preference_elicitation_quality']))
WHERE "parameterId" = 'preference_elicitation_quality';

UPDATE "Parameter"
SET "parameterId" = 'BEH-PREREQUISITE-ADAPTATION',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['prerequisite_adaptation']))
WHERE "parameterId" = 'prerequisite_adaptation';

UPDATE "Parameter"
SET "parameterId" = 'BEH-PREREQUISITE-CHECK',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['prerequisite_check']))
WHERE "parameterId" = 'prerequisite_check';

UPDATE "Parameter"
SET "parameterId" = 'BEH-QUESTION-ASKING-RATE',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['question_asking_rate']))
WHERE "parameterId" = 'question_asking_rate';

UPDATE "Parameter"
SET "parameterId" = 'BEH-RAPPORT-REWARD',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['rapport_reward']))
WHERE "parameterId" = 'rapport_reward';

UPDATE "Parameter"
SET "parameterId" = 'BEH-READING-WRITING-ADAPTATION',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['reading_writing_adaptation']))
WHERE "parameterId" = 'reading_writing_adaptation';

UPDATE "Parameter"
SET "parameterId" = 'BEH-RESPONSE-LENGTH-PREFERENCE',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['response_length_preference']))
WHERE "parameterId" = 'response_length_preference';

UPDATE "Parameter"
SET "parameterId" = 'BEH-RESPONSE-LENGTH-SCORE',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['response_length_score']))
WHERE "parameterId" = 'response_length_score';

UPDATE "Parameter"
SET "parameterId" = 'BEH-REVIEW-ADAPTATION',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['review_adaptation']))
WHERE "parameterId" = 'review_adaptation';

UPDATE "Parameter"
SET "parameterId" = 'BEH-REVIEW-STATUS',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['review_status']))
WHERE "parameterId" = 'review_status';

UPDATE "Parameter"
SET "parameterId" = 'BEH-SAFETY-COMPLIANCE-SCORE',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['safety_compliance_score']))
WHERE "parameterId" = 'safety_compliance_score';

UPDATE "Parameter"
SET "parameterId" = 'BEH-SOCRATIC-QUESTIONING',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['socratic-questioning']))
WHERE "parameterId" = 'socratic-questioning';

UPDATE "Parameter"
SET "parameterId" = 'BEH-STUDENT-APPLICATION-SCORE',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['student_application_score']))
WHERE "parameterId" = 'student_application_score';

UPDATE "Parameter"
SET "parameterId" = 'BEH-STYLE-CONSISTENCY-SCORE',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['style_consistency_score']))
WHERE "parameterId" = 'style_consistency_score';

UPDATE "Parameter"
SET "parameterId" = 'BEH-TARGET-ALIGNMENT-SCORE',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['target_alignment_score']))
WHERE "parameterId" = 'target_alignment_score';

UPDATE "Parameter"
SET "parameterId" = 'BEH-TONE-ASSERT',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['TONE_ASSERT']))
WHERE "parameterId" = 'TONE_ASSERT';

UPDATE "Parameter"
SET "parameterId" = 'BEH-TUTOR-FIDELITY-SCORE',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['tutor_fidelity_score']))
WHERE "parameterId" = 'tutor_fidelity_score';

UPDATE "Parameter"
SET "parameterId" = 'BEH-TUTOR-INTRO-SCORE',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['tutor_intro_score']))
WHERE "parameterId" = 'tutor_intro_score';

UPDATE "Parameter"
SET "parameterId" = 'BEH-TUTOR-SEQUENCE-SCORE',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['tutor_sequence_score']))
WHERE "parameterId" = 'tutor_sequence_score';

UPDATE "Parameter"
SET "parameterId" = 'BEH-WELCOME-QUALITY',
    "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['welcome_quality']))
WHERE "parameterId" = 'welcome_quality';

COMMIT;
