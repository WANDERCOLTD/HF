/**
 * Block bare string literals that reference legacy parameter IDs renamed
 * by S2 of epic #1946 (story #1950) to the BEH-* canonical convention.
 *
 * History: the registry held a mix of `BEH-*` kebab, snake_case, hybrid
 * kebab-no-BEH, SCREAMING_SNAKE, B5-*, COMP-*, and stranded IDs (CP-004,
 * scaffolding). Sister story S1 (#1949) landed the alias resolver +
 * `Parameter.aliases[]`. S2 renamed 73 non-canonical IDs to BEH-* and
 * pushed the old names into `aliases[]`. Reads via
 * `resolveParameterId` now follow the alias to the canonical row.
 *
 * This rule blocks the regression: a new code path hard-coding a legacy
 * id (`"abstract_vs_concrete"`, `"B5-A"`, `"COMP-ENERGY"`, `"CONV_DOM"`,
 * etc.) bypasses the resolver. The string still resolves through the
 * alias map AT READ TIME, but the LITERAL is brittle — it ties the
 * code to a name that no longer exists as a canonical id.
 *
 * Fires on any string Literal whose value is in the legacy id set.
 *
 * Greenlit (no fire):
 *   - `lib/registry/` — the resolver + alias map source
 *   - `docs-archive/bdd-specs/behavior-parameters.registry.json` — the
 *     registry seed (legacy names sit in `aliases[]` of each canonical
 *     row by design)
 *   - `prisma/seed-*.ts` — re-seed from canonical registry, but historical
 *     seed scripts may still mention legacy names in comments / migration
 *     paths
 *   - `prisma/migrations/` — historical migrations reference the names
 *     they were dealing with at the time (`#1950 rename migration` in
 *     particular)
 *   - Test files (`*.test.ts`, `*.spec.ts`, `__tests__/`, `tests/`)
 *     — fixtures exercise the alias fallback path on purpose
 *   - `docs/` and the `docs-archive/` tree — markdown references to
 *     legacy names in PARAMETER-RENAME-MAP / PARAMETER-DEDUP-DECISIONS
 *     etc.
 *   - `scripts/generate-registry.ts` — generator over canonical sources
 *
 * Severity: `error` from day 1. The migration + registry update happen in
 * the same PR so no pre-existing offences in non-allow-listed paths
 * remain.
 *
 * Sync responsibility: when a new alias is added to the registry (S1-style
 * dedup or a future S2-style rename), the new legacy id should NOT need
 * to be added here — this rule's set is the snapshot of S2's renames.
 * Future renames ship their own rule update OR a structural test reads
 * `Parameter.aliases` at lint time. Add new legacy IDs to
 * `LEGACY_PARAMETER_IDS` below in the same PR as the migration.
 */

// Hardcoded mirror of S2 (#1950) rename old-name set. Each entry is a
// legacy `Parameter.parameterId` value now living in some BEH-* row's
// `aliases[]`. See `docs/PARAMETER-RENAME-MAP.md` §Renames for the full
// old→new mapping.
const LEGACY_PARAMETER_IDS = new Set([
  "abstract-vs-concrete",
  "adapt_to_feedback_style",
  "adapt_to_interaction_style",
  "adapt_to_question_frequency",
  "aggregate_profile",
  "agreeableness_adaptation",
  "application_adaptation",
  "application_score",
  "B5-A",
  "B5-C",
  "B5-E",
  "B5-N",
  "B5-O",
  "call_frequency_adaptation",
  "chunk-size",
  "communication_complexity_adaptation",
  "COMP-DEPTH-PREFERENCE",
  "COMP-ENERGY",
  "COMP-ENGAGEMENT",
  "COMP-MOOD",
  "composite_reward",
  "comprehension_adaptation",
  "comprehension_score",
  "COMP-REMINISCENCE",
  "concept_exposure",
  "conscientiousness_adaptation",
  "context_setting_quality",
  "CONV_DOM",
  "CP-004",
  "crisis_detection_score",
  "default_targets_quality",
  "engagement_adaptation",
  "engagement-prompts",
  "engagement_reward",
  "engagement_trend_score",
  "engagement_with_examples",
  "error-elaboration",
  "explanation-depth",
  "exploration_structure",
  "extraversion_adaptation",
  "goal_discovery_quality",
  "goal_progress_reward",
  "insight_quality",
  "learning_progress_score",
  "learning_reward",
  "learning_velocity_adaptation",
  "mastery_adaptation",
  "module_introduction",
  "module_mastery",
  "multimodal_adaptation",
  "neuroticism_adaptation",
  "openness_adaptation",
  "pause-for-questions",
  "preference_elicitation_quality",
  "prerequisite_adaptation",
  "prerequisite_check",
  "question_asking_rate",
  "rapport_reward",
  "reading_writing_adaptation",
  "response_length_preference",
  "response_length_score",
  "review_adaptation",
  "review_status",
  "safety_compliance_score",
  "socratic-questioning",
  "student_application_score",
  "style_consistency_score",
  "target_alignment_score",
  "TONE_ASSERT",
  "tutor_fidelity_score",
  "tutor_intro_score",
  "tutor_sequence_score",
  "welcome_quality",
]);

// Allow-list path fragments. Any file containing one of these in its
// path will skip the rule entirely.
const ALLOWLIST_PATH_FRAGMENTS = [
  "/lib/registry/",
  "/docs-archive/bdd-specs/behavior-parameters.registry.json",
  "/prisma/seed",
  "/prisma/migrations/",
  "/scripts/generate-registry",
  "/docs/",
  "/docs-archive/",
  "/eslint-rules/", // the rule's own data file lives here
  ".test.",
  ".spec.",
  "/__tests__/",
  "/tests/",
];

function isAllowlistedFile(filename) {
  if (!filename) return false;
  return ALLOWLIST_PATH_FRAGMENTS.some((p) => filename.includes(p));
}

const messages = {
  bareLegacy:
    "Bare string literal `{{value}}` is a legacy parameter id renamed by " +
    "#1950 to the BEH-* canonical convention. Replace with the canonical " +
    "id, or — when the id flows in from external data (course-ref YAML, " +
    "spec import, admin sync) — route through " +
    "`resolveParameterId` / `resolveParameterIds` from " +
    "`@/lib/registry/resolve` to normalise. See " +
    "`docs/PARAMETER-RENAME-MAP.md` for the old→new mapping.",
};

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Block bare string literals referencing legacy parameter IDs renamed by #1950; use canonical BEH-* id or alias resolver.",
      url: "https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-no-bare-parameter-id",
    },
    schema: [],
    messages,
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.();
    if (isAllowlistedFile(filename)) {
      return {};
    }
    return {
      Literal(node) {
        if (typeof node.value !== "string") return;
        if (!LEGACY_PARAMETER_IDS.has(node.value)) return;
        context.report({
          node,
          messageId: "bareLegacy",
          data: { value: node.value },
        });
      },
    };
  },
};

export default rule;
