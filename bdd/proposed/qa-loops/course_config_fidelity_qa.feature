# PROPOSED — documents a current gap in the engine. Steps are NOT implemented.
# Kept outside bdd/features/ so CI (npm run bdd) does not execute it.
#
# Today: a course configuration is generated from a creator's intent (course-reference)
# by a deterministic, no-AI projection (apps/admin/lib/wizard/project-course-reference.ts).
# The only gate before publish is STRUCTURAL — item counts, duplicate IDs, ordering,
# active specs, placeholder shape (apps/admin/app/api/playbooks/[playbookId]/publish/route.ts;
# validationPassed = errors.length === 0). There is NO semantic check that the generated
# configuration faithfully reflects the creator's intent.
#
# This feature describes the intended QA loop, for discussion.

Feature: QA of generated course configuration against creator intent

  As the engine
  I want to verify a generated course configuration against the creator's intent
  So that a course never goes live with silently missing or incoherent parameters, goals, or criteria

  Background:
    Given a course creator has provided their intent as a course-reference
    And the system has generated a course configuration from that intent

  Scenario: Every intended parameter is represented in the configuration
    When the configuration is checked against the course-reference
    Then every parameter named in the intent has a matching parameter in the configuration
    And any intended parameter missing from the configuration is reported as a fidelity error

  Scenario: Goals are coherent with the parameters and criteria
    When the configuration is checked for coherence
    Then every goal references parameters or criteria that exist in the configuration
    And a goal that targets a missing or undefined criterion is reported as a fidelity error

  Scenario: The configuration is compared back to its source for completeness
    When the configuration is compared against the course-reference
    Then sections present in the source but absent from the configuration are reported
    And content present in the configuration but absent from the source is flagged as a possible hallucination

  Scenario: A low-fidelity configuration is routed to review rather than published silently
    Given the fidelity check finds one or more issues
    When the creator attempts to publish the configuration
    Then publishing is blocked, or the configuration is routed to a review queue
    And the specific fidelity issues are shown to the reviewer
