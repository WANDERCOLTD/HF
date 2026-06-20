import { config } from "@/lib/config";

/**
 * Engagement targets manifest — Sub-epic #2086 (S4 of #2078).
 *
 * Canonical runtime registry of the 13 engagement-bucket parameter IDs
 * wired by ADAPT-ENG-001 + CA-001 in epic #2078 sub-epic 4. Each entry
 * documents:
 *
 *   1. **canonical parameter ID** — the row in
 *      `docs-archive/bdd-specs/behavior-parameters.registry.json`
 *      whose `BehaviorTarget` cascade is adjusted by `adapt-runner.ts`
 *      consuming an ADAPT-ENG-001 rule.
 *   2. **profile key it reads** — the `behavior_profile:{domain}:{dim}`
 *      key BEH-AGG-001 writes (or `parameterValues` for legacy paths).
 *      `null` for the three tutor-emit directives (CHUNK-SIZE,
 *      PAUSE-FOR-QUESTIONS, CHECK-FOR-UNDERSTANDING) that are
 *      operator-set and have no inverse measurement signal — these
 *      still get nudged from the `cognitive_activation` aggregate
 *      (multi-action rule), but they don't have a self-fidelity row
 *      in BEH-AGG-001 themselves.
 *   3. **measurement spec** — the AnalysisSpec that scores it (for
 *      Lattice's parameter-measurement-coverage cross-check).
 *
 * **Why this file exists** (read this before tempting to refactor it away):
 *
 *   The `tests/lib/measurement/parameter-coverage.test.ts` ratchet
 *   searches consumer source for the literal parameter ID. ADAPT-* specs
 *   reference these IDs by `targetParameter` strings — but those live in
 *   `*.spec.json` (not walked by the test) and the spec is fed through
 *   `adapt-runner.ts` which only knows the IDs at runtime.
 *
 *   This file gives the test the literal-source mention it needs to
 *   classify each parameter `covered`, AND it gives `adapt-runner.ts` a
 *   compile-time anchor for the parameters ADAPT-ENG-001 + CA-001
 *   should own. When BEH-AGG-001 writes
 *   `behavior_profile:engagement:cognitive_activation`, the runner
 *   picks up an ADAPT-ENG-001 rule whose action targets the literal
 *   `BEH-COGNITIVE-ACTIVATION` ID — and this manifest is what makes
 *   the runtime trust that pairing.
 *
 * **CA-001 scorer integration:**
 *
 *   Three of the 13 are sourced from CA-001's MEASURE outputs:
 *
 *     - `BEH-COGNITIVE-ACTIVATION` — CA-001 `CP-004` alias
 *     - `BEH-CONV-DOM`              — CA-001 `CONV_DOM` alias
 *     - `BEH-TONE-ASSERT`           — CA-001 `TONE_ASSERT` alias
 *
 *   CA-001 writes `CallScore.parameterId` rows under these canonical
 *   IDs at MEASURE time; BEH-AGG-001 reads them into the
 *   `behavior_profile:engagement:*` namespace; ADAPT-ENG-001 reads the
 *   aggregated value and adjusts CallerTarget. The full chain closes
 *   the per-parameter cascade-feedback loop.
 *
 * **Onboarding 3:**
 *
 *   Three onboarding-domainGroup params are wired here as well because
 *   BEH-AGG-001 puts them in the `behavior_profile:onboarding:*`
 *   namespace and the same ADAPT-ENG-001 runner consumes them — this
 *   is the "engagement + onboarding" survey-S4 bundle.
 *
 *     - `BEH-CONTEXT-SETTING-QUALITY`
 *     - `BEH-GOAL-DISCOVERY-QUALITY`
 *     - `BEH-PREFERENCE-ELICITATION-QUALITY`
 *
 * Story: [#2086](https://github.com/WANDERCOLTD/HF/issues/2086).
 * Survey: `docs/groomed/2078-parameter-coverage-survey.md` §5 + §8.
 */

/**
 * The 13 parameter IDs wired by sub-epic #2086. Order matches the survey
 * S4 row enumeration: engagement bucket first (10), then onboarding (3).
 *
 * Each entry MUST appear as a literal-source mention here so the
 * Coverage-pillar `parameter-coverage.test.ts` ratchet classifies it
 * `covered`. Do not collapse to a loop variable — the literal-string
 * mention is the structural signal.
 */
export const ENGAGEMENT_TARGETS_WIRED_BY_2086 = [
  // ─── engagement bucket — 10 params ─────────────────────────────────
  // CA-001-measured (3 — feed via CallScore → BEH-AGG-001 →
  // behavior_profile:engagement:cognitive_activation / conversational_dominance / tone_assertiveness)
  "BEH-COGNITIVE-ACTIVATION",
  "BEH-CONV-DOM",
  "BEH-TONE-ASSERT",
  // ADAPT-ENG-001 self-measured fidelity (4 — fan back through
  // BEH-AGG-001 as *_fidelity profile keys)
  "BEH-CALL-FREQUENCY-ADAPTATION",
  "BEH-COMMUNICATION-COMPLEXITY-ADAPTATION",
  "BEH-ENGAGEMENT-ADAPTATION",
  "BEH-LEARNING-VELOCITY-ADAPTATION",
  // Tutor-emit operator-only directives (3 — sent to prompt via
  // behavior_targets_semantics; no measurement, no fidelity fan-back)
  "BEH-CHUNK-SIZE",
  "BEH-PAUSE-FOR-QUESTIONS",
  "check-for-understanding",
  // ─── onboarding bucket — 3 params ──────────────────────────────────
  // INIT-001-measured one-shot snapshot (BEH-AGG-001 onboarding
  // section, windowSize=1, recencyWeight=1.0). ADAPT-ENG-001 reads
  // these as start-state quality signals to nudge subsequent
  // engagement targets.
  "BEH-CONTEXT-SETTING-QUALITY",
  "BEH-GOAL-DISCOVERY-QUALITY",
  "BEH-PREFERENCE-ELICITATION-QUALITY",
] as const;

export type EngagementTargetId = (typeof ENGAGEMENT_TARGETS_WIRED_BY_2086)[number];

/**
 * Per-target metadata — declarative profile-key + measurement spec
 * binding. Consulted by `adapt-runner.ts` only as a sanity check
 * (the runner reads the live ADAPT-ENG-001 spec from the DB); this
 * manifest is the compile-time anchor + documentation surface.
 */
export interface EngagementTargetBinding {
  readonly parameterId: EngagementTargetId;
  /**
   * `behavior_profile:*` CallerAttribute key BEH-AGG-001 writes for
   * this dimension. `null` for tutor-emit operator-only directives
   * with no inverse measurement signal (CHUNK-SIZE,
   * PAUSE-FOR-QUESTIONS, CHECK-FOR-UNDERSTANDING).
   */
  readonly profileKey: string | null;
  /**
   * AnalysisSpec slug whose MEASURE pass writes the CallScore row that
   * BEH-AGG-001 then aggregates. `null` for the operator-only
   * directives (no MEASURE, hence no AGGREGATE input).
   *
   * Resolved at call-time from `config.specs.*` getters — never a
   * hardcoded literal (enforced by `hf-config/no-hardcoded-spec-slug`).
   */
  readonly measurementSpec: string | null;
  /**
   * AGGREGATE spec scope to read from. Resolved from
   * `config.specs.aggBehavior` (default `BEH-AGG-001`, env-overridable
   * via `BEH_AGG_SPEC_SLUG`).
   */
  readonly aggregateScope: string;
}

/**
 * The aggregate-scope value (resolved once per process from
 * `config.specs.aggBehavior` — env-overridable). Pulled into a module
 * constant so every binding row shares the same instance.
 */
const AGG_SCOPE = config.specs.aggBehavior;
const CA_001_SLUG = config.specs.cognitiveActivation;
const ADAPT_ENG_SLUG = config.specs.adaptEng;
const INIT_001_SLUG = config.specs.callerOnboarding;

export const ENGAGEMENT_TARGET_BINDINGS: readonly EngagementTargetBinding[] = [
  {
    parameterId: "BEH-COGNITIVE-ACTIVATION",
    profileKey: "behavior_profile:engagement:cognitive_activation",
    measurementSpec: CA_001_SLUG,
    aggregateScope: AGG_SCOPE,
  },
  {
    parameterId: "BEH-CONV-DOM",
    profileKey: "behavior_profile:engagement:conversational_dominance",
    measurementSpec: CA_001_SLUG,
    aggregateScope: AGG_SCOPE,
  },
  {
    parameterId: "BEH-TONE-ASSERT",
    profileKey: "behavior_profile:engagement:tone_assertiveness",
    measurementSpec: CA_001_SLUG,
    aggregateScope: AGG_SCOPE,
  },
  {
    parameterId: "BEH-CALL-FREQUENCY-ADAPTATION",
    profileKey: "behavior_profile:engagement:call_frequency_fidelity",
    measurementSpec: ADAPT_ENG_SLUG,
    aggregateScope: AGG_SCOPE,
  },
  {
    parameterId: "BEH-COMMUNICATION-COMPLEXITY-ADAPTATION",
    profileKey: "behavior_profile:engagement:complexity_fidelity",
    measurementSpec: ADAPT_ENG_SLUG,
    aggregateScope: AGG_SCOPE,
  },
  {
    parameterId: "BEH-ENGAGEMENT-ADAPTATION",
    profileKey: "behavior_profile:engagement:engagement_fidelity",
    measurementSpec: ADAPT_ENG_SLUG,
    aggregateScope: AGG_SCOPE,
  },
  {
    parameterId: "BEH-LEARNING-VELOCITY-ADAPTATION",
    profileKey: "behavior_profile:engagement:velocity_fidelity",
    measurementSpec: ADAPT_ENG_SLUG,
    aggregateScope: AGG_SCOPE,
  },
  {
    parameterId: "BEH-CHUNK-SIZE",
    profileKey: null,
    measurementSpec: null,
    aggregateScope: AGG_SCOPE,
  },
  {
    parameterId: "BEH-PAUSE-FOR-QUESTIONS",
    profileKey: null,
    measurementSpec: null,
    aggregateScope: AGG_SCOPE,
  },
  {
    parameterId: "check-for-understanding",
    profileKey: null,
    measurementSpec: null,
    aggregateScope: AGG_SCOPE,
  },
  {
    parameterId: "BEH-CONTEXT-SETTING-QUALITY",
    profileKey: "behavior_profile:onboarding:context_setting_quality",
    measurementSpec: INIT_001_SLUG,
    aggregateScope: AGG_SCOPE,
  },
  {
    parameterId: "BEH-GOAL-DISCOVERY-QUALITY",
    profileKey: "behavior_profile:onboarding:goal_discovery_quality",
    measurementSpec: INIT_001_SLUG,
    aggregateScope: AGG_SCOPE,
  },
  {
    parameterId: "BEH-PREFERENCE-ELICITATION-QUALITY",
    profileKey: "behavior_profile:onboarding:preference_elicitation_quality",
    measurementSpec: INIT_001_SLUG,
    aggregateScope: AGG_SCOPE,
  },
];

/**
 * Lookup helper — adapt-runner cross-checks at evaluation time that
 * the live ADAPT-ENG-001 spec rule's `condition.profileKey` matches
 * the manifest binding. A drift (e.g., somebody edits the spec to
 * read `behavior_profile:engagement:cogact` typo'd) returns null
 * here and `adapt-runner` logs a `adapt-runner.engagement.binding_miss`
 * AppLog entry.
 */
export function lookupEngagementBinding(
  parameterId: string,
): EngagementTargetBinding | null {
  return (
    ENGAGEMENT_TARGET_BINDINGS.find((b) => b.parameterId === parameterId) ??
    null
  );
}

/**
 * Cross-check: every entry in ENGAGEMENT_TARGETS_WIRED_BY_2086 MUST
 * have a binding row. Pinned by the sub-epic #2086 vitest at
 * `tests/lib/pipeline/engagement-targets-manifest.test.ts`.
 */
export function bindingsAreSymmetric(): boolean {
  if (ENGAGEMENT_TARGET_BINDINGS.length !== ENGAGEMENT_TARGETS_WIRED_BY_2086.length) {
    return false;
  }
  const bindingIds = new Set(ENGAGEMENT_TARGET_BINDINGS.map((b) => b.parameterId));
  return ENGAGEMENT_TARGETS_WIRED_BY_2086.every((id) => bindingIds.has(id));
}
