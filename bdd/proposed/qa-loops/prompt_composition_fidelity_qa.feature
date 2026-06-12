# PROPOSED — documents a current gap in the engine. Steps are NOT implemented.
# Kept outside bdd/features/ so CI (npm run bdd) does not execute it.
#
# Today: the bootstrap prompt ("prompt 0") and each post-session prompt ("prompt n+1")
# are composed deterministically (model: "deterministic"), templating in the course
# configuration and the session's measurements and trusting them. Mechanical invariants
# run (module-lock, call-counter coherence — apps/admin/lib/prompt/composition/compose-invariants.ts)
# and the SUPERVISE stage clamps numeric targets (docs/PIPELINE.md states SUPERVISE does
# NOT do drift detection). Nothing checks that prompt 0 reflects the configuration, or that
# prompt n+1 reflects the configuration AND the session's measurements.
# The one AI prompt critic (apps/admin/app/api/callers/[callerId]/eval-prompt/route.ts) is
# operator-triggered, config- and measurement-blind, and its result is stored but never used
# to gate anything — ComposedPrompt is written status="active" immediately.
#
# This feature describes the intended QA loop, for discussion.

Feature: QA of composed prompts against configuration and measurements

  As the engine
  I want to verify each composed prompt against the configuration and the latest measurements
  So that a prompt that drifts from the course design or ignores the measured results never drives the next call

  Background:
    Given a published course configuration exists

  Scenario: The bootstrap prompt is checked against the course configuration before it becomes active
    Given the system composes the bootstrap prompt for a new learner
    When the bootstrap prompt has been composed
    Then the prompt is checked for fidelity against the course configuration
    And a prompt that omits or contradicts the configuration is blocked or flagged before it becomes active

  Scenario: The next prompt is checked against the course configuration
    Given a learner has completed a session
    When the system composes the next prompt
    Then the prompt is checked for fidelity against the course configuration
    And a prompt that drifts from the configuration is blocked or flagged before it becomes active

  Scenario: The next prompt is checked against the session's measurements
    Given a learner has completed a session
    And the session produced measurements and analysis
    When the system composes the next prompt
    Then the prompt is checked for consistency with those measurements
    And a prompt that ignores or contradicts the measured results is blocked or flagged before it becomes active

  Scenario: The prompt-quality check runs in the loop and gates the prompt status
    Given a prompt has been composed
    When the prompt-quality check runs as part of composition
    Then its result determines whether the prompt becomes active
    And a prompt that fails the check does not silently go live
