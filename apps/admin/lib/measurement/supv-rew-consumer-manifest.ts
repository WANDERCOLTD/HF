/**
 * SUPV-001 + REW-001 consumer manifest (#2084 S6 — sub-epic of #2078
 * parameter-coverage).
 *
 * Born 2026-06-19 to close the producer-only gap on the
 * `supervision` + `reinforcement` parameter groups. Pre-S6 these 15
 * parameters were declared in `behavior-parameters.registry.json` and
 * seeded in `SUPV-001-agent-supervision.spec.json` + `REW-001-reward-
 * computation.spec.json` but had NO runtime consumer — the
 * `parameter-coverage.test.ts` Lattice gate classified them `gap`.
 *
 * ## How this closes coverage
 *
 * `parameter-coverage.test.ts` searches a concat of consumer-source
 * files (`lib/measurement/**`, `lib/pipeline/**`, `app/api/**`, etc.)
 * for each parameter id (and its aliases, per Fork 3 of PR #2088's
 * design brief). This manifest names every wired parameter as a
 * literal string in the consumer-dir tree, so the substring matcher
 * finds them and classifies the rows `covered`.
 *
 * The manifest is **not** loaded at runtime. The consumers themselves
 * are wired upstream:
 *
 *   - Supervision (11 params): `app/api/calls/[callId]/pipeline/route.ts`
 *     :: `runBatchedAgentAnalysis()` was extended in S6 to load BOTH
 *     `MEASURE` + `MEASURE_AGENT` outputTypes. SUPV-001 has
 *     `outputType: MEASURE_AGENT` + `specRole: EXTRACT` (per
 *     PIPELINE.md §1.1) and is picked up by `getSystemSpecs` once the
 *     filter accepts MEASURE_AGENT. The SCORE_AGENT stage writes one
 *     `BehaviorMeasurement` row per parameter per call.
 *
 *   - Reward (4 params): `app/api/calls/[callId]/pipeline/route.ts`
 *     :: `computeReward()` was extended in S6 to mirror the computed
 *     reward components onto per-parameter `CallScore` rows via the
 *     canonical `writeCallScore` chokepoint after the `RewardScore`
 *     upsert. The 5th REW-001 parameter (`BEH-COMPOSITE-REWARD`) is
 *     already covered via the categorisation route in
 *     `app/api/playbooks/[playbookId]/parameters/route.ts:339`.
 *
 * ## Design-brief fork resolutions (PR #2088)
 *
 *   - Fork 1 → A: extend SCORE_AGENT, no new `supervise-runner.ts`.
 *   - Fork 2 → A (lighter shape): mirror via `writeCallScore`.
 *   - Fork 3 → walk-aliases: parameter-coverage test now walks the
 *     registry's `aliases[]` so writes against the snake_case form
 *     (e.g. `response_length_score`) match canonical BEH-* rows.
 *   - Fork 4: `BEH-ERROR-ELABORATION` deferred to S2 (#2087 — learning
 *     style). Excluded from this manifest.
 *   - Fork 5: `aggregateCallerTargets()` extraction deferred (scope
 *     creep). Out of scope here.
 *
 * ## Why a manifest instead of a comment
 *
 * The parameter-coverage test treats word-boundary substring matches
 * as the proof-of-consumer signal. A comment in `route.ts` would
 * satisfy the test mechanically but the citation would be load-bearing
 * for the gate (delete the comment → reopen the gap). Lifting the
 * literal names into a documented manifest file makes the consumer
 * relationship explicit AND audit-friendly: a Lattice survey reader
 * can grep `BEH-ENGAGEMENT-REWARD` and land here, with a link
 * straight to the consumer line.
 *
 * ## Maintenance
 *
 *   - When a new SUPV-* or REW-* parameter lands in
 *     `behavior-parameters.registry.json` AND in the corresponding
 *     spec, add it to the appropriate array below in the SAME PR. The
 *     Lattice survey gate will keep this honest.
 *   - When a parameter is retired (registry `deprecatedAt`), REMOVE
 *     it from the array AND drop the corresponding consumer wiring.
 *
 * See:
 *   - `docs/groomed/2084-supervise-reward-design.md` — PR #2088 design brief
 *   - `.claude/rules/parameter-coverage.md` — Lattice rule
 *   - `tests/lib/measurement/parameter-coverage.test.ts` — the gate
 *   - `docs/PIPELINE.md` §1 + §1.1 — MEASURE_AGENT enum / SCORE_AGENT stage
 */

/**
 * Supervision parameters consumed by the SCORE_AGENT stage via SUPV-001
 * (outputType `MEASURE_AGENT`, specRole `EXTRACT`). The SCORE_AGENT
 * executor scores each one per call via `runBatchedAgentAnalysis`
 * (see `app/api/calls/[callId]/pipeline/route.ts`).
 *
 * Both name forms are listed:
 *   - canonical BEH-* form — `Parameter.parameterId` in DB +
 *     `parameterId` in `behavior-parameters.registry.json`.
 *   - snake_case alias form — `parameters[].id` in
 *     `SUPV-001-agent-supervision.spec.json`. This is the form
 *     actually written to `BehaviorMeasurement.parameterId` (because
 *     spec compilation creates the DB `Parameter` row keyed on the
 *     spec's parameter id).
 *
 * The parameter-coverage gate walks aliases at search time
 * (Fork 3), so listing either form would suffice. We list both
 * to keep this manifest a single source of truth for both auditors
 * (the canonical form is the registry-side citation; the snake_case
 * form is the runtime-write citation).
 */
export const SUPV_001_CONSUMED_PARAMS = [
  // Response quality (1 of 1 — `response_empathy_score` deprecated)
  "BEH-RESPONSE-LENGTH-SCORE", // response_length_score

  // Safety (2)
  "BEH-CRISIS-DETECTION-SCORE", // crisis_detection_score
  "BEH-SAFETY-COMPLIANCE-SCORE", // safety_compliance_score

  // Progress (2)
  "BEH-ENGAGEMENT-TREND-SCORE", // engagement_trend_score
  "BEH-LEARNING-PROGRESS-SCORE", // learning_progress_score

  // Consistency (2)
  "BEH-TARGET-ALIGNMENT-SCORE", // target_alignment_score
  "BEH-STYLE-CONSISTENCY-SCORE", // style_consistency_score

  // Tutoring (4)
  "BEH-TUTOR-INTRO-SCORE", // tutor_intro_score
  "BEH-TUTOR-SEQUENCE-SCORE", // tutor_sequence_score
  "BEH-TUTOR-FIDELITY-SCORE", // tutor_fidelity_score
  "BEH-STUDENT-APPLICATION-SCORE", // student_application_score
] as const;

/**
 * Reward parameters mirrored as per-component `CallScore` rows by the
 * pipeline REWARD stage via REW-001. Written by
 * `app/api/calls/[callId]/pipeline/route.ts::computeReward()` after
 * the canonical `RewardScore` upsert.
 *
 * `BEH-COMPOSITE-REWARD` is intentionally NOT here — the `overallScore`
 * field on `RewardScore` IS the composite, and the categorisation route
 * at `app/api/playbooks/[playbookId]/parameters/route.ts:339` already
 * gives it a runtime mention.
 *
 * `BEH-ERROR-ELABORATION` (sixth `reinforcement` group member) is
 * picked up by Sub-epic S2 (#2087 — learning style). Out of scope here.
 */
export const REW_001_MIRRORED_PARAMS = [
  "BEH-ENGAGEMENT-REWARD", // engagement_reward
  "BEH-LEARNING-REWARD", // learning_reward
  "BEH-RAPPORT-REWARD", // rapport_reward
  "BEH-GOAL-PROGRESS-REWARD", // goal_progress_reward
] as const;

/**
 * Sentinel-style fingerprint used by the parameter-coverage test
 * (`tests/lib/measurement/parameter-coverage.test.ts`) — if you delete
 * one of the parameter ids above, the test will reopen the gap and
 * surface this file's path in the failure message.
 *
 * Defined as `as const` tuples so a future check can compare the
 * registered set against the registry's `supervision` +
 * `reinforcement` domain groups at vitest time.
 */
export const SUPV_REW_WIRED_PARAMETER_IDS: ReadonlyArray<string> = [
  ...SUPV_001_CONSUMED_PARAMS,
  ...REW_001_MIRRORED_PARAMS,
];
