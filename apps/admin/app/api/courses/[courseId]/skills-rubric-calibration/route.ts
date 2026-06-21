/**
 * @api GET /api/courses/[courseId]/skills-rubric-calibration
 *
 * Reads the Rubric Calibration view for one course — the surface that closes
 * the "what is the AI actually scoring against?" trust gap.
 *
 * Per skill, returns:
 *   1. The structural rubric (tierScheme + tiers + bandThresholds) — same
 *      shape as `/skills-framework` but always present (no
 *      ContentAssertion fallback — calibration is a structural read).
 *   2. The literal MEASURE-spec prompt the AI tutor scores against —
 *      `AnalysisTrigger.{given, when, then}` for that skill, plus
 *      `AnalysisAction.{description, parameterId, weight}`. Surfaced
 *      verbatim so the educator sees exactly the prose passed to the LLM
 *      (the spec-loader does no template interpolation on these fields).
 *   3. Cascade envelopes for the 2 cascade-eligible mastery knobs
 *      (`skillTierMapping`, `skillScoringEmaHalfLifeDays`) — Domain-over-
 *      Playbook resolution + provenance for the `<CascadeValue>` chips.
 *   4. Raw values for the 3 variant-intrinsic mastery knobs
 *      (`useFreshMastery`, `maxMasteryTier`, `scoringMode`) — no cascade,
 *      these are variant identity. The UI renders them with a small
 *      variant-preset pill instead of a chip.
 *
 * Auth: OPERATOR+ (matches Course Detail tab + sibling skills routes).
 *
 * Sprint 3 SP3-A from the Skills Framework Inspector epic.
 *
 * Data sources:
 *   - `resolveAllSkillsForPlaybook(courseId)` — Skill x BehaviorTarget x
 *     Parameter tuples (PR #1569).
 *   - `AnalysisSpec` (slug `skill-measure-<playbookId.slice(0,8)>`) +
 *     `AnalysisTrigger` rows — the literal MEASURE rubric prose
 *     (apply-projection.ts:657).
 *   - `Parameter.config.{tierScheme, tiers, bandThresholds}` — structural
 *     rubric written by `applyProjection` (PR #1573).
 *   - `Playbook.config.{useFreshMastery, maxMasteryTier, scoringMode}` —
 *     variant-intrinsic mastery knobs (no cascade).
 *   - `resolveEffective` (lib/cascade/effective-value.ts) — cascade
 *     envelopes for `skillTierMapping` + `skillScoringEmaHalfLifeDays`
 *     dispatched through the `mastery-policy` family (PR #1571).
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { resolveAllSkillsForPlaybook } from "@/lib/curriculum/resolve-skill";
import { resolveEffective } from "@/lib/cascade/effective-value";
import type { Effective } from "@/lib/cascade/layer-types";

export interface RubricCalibrationAction {
  description: string;
  parameterId: string;
  weight: number;
}

export interface RubricCalibrationMeasure {
  /**
   * The trigger name as authored — typically the skill's display name.
   * `AnalysisTrigger.name` is nullable in the schema; falls back to the
   * skillRef ("SKILL-01") when the trigger row carries no explicit name.
   */
  triggerName: string;
  given: string;
  when: string;
  then: string;
  /**
   * MEASURE actions only — actions with a non-null `parameterId`. LEARN
   * actions (which set `learnCategory` instead) are filtered out: the
   * Rubric Calibration lens is about scoring, not knowledge extraction.
   */
  actions: RubricCalibrationAction[];
}

export interface RubricCalibrationSkill {
  skillRef: string;
  parameterId: string;
  parameterName: string;
  description: string | null;
  targetValue: number;
  tierScheme: string[];
  tiers: Record<string, string>;
  bandThresholds: Record<string, string> | null;
  /**
   * The literal `AnalysisTrigger` rubric prose the AI tutor reads at
   * SCORE_AGENT stage. `null` when no MEASURE spec exists yet (course
   * authored before #417 Phase B, or skill never matched a trigger).
   */
  measure: RubricCalibrationMeasure | null;
}

export interface RubricCalibrationMasteryPolicyChip<T = unknown> {
  knobKey: "skillTierMapping" | "skillScoringEmaHalfLifeDays";
  envelope: Effective<T>;
}

export interface RubricCalibrationVariantPreset {
  /** `null` when the playbook config doesn't set this knob (default applies). */
  useFreshMastery: boolean | null;
  /** Tier name capping mastery (e.g. "practitioner"). `null` = no cap. */
  maxMasteryTier: string | null;
  /** "evidence-first" or null (default behaviour). */
  scoringMode: string | null;
}

/**
 * Story #2158 — surfacing the IELTS LLM scoring override on the Rubric
 * Calibration lens. Carries enough state for the "AI Measurement
 * Method" card to render:
 *   - `isIeltsShaped` — whether the playbook carries any of the 4 IELTS
 *     skill parameters on its PLAYBOOK-scope BehaviorTargets. Same
 *     signal `filterByBehaviorTargetParams` uses at pipeline time, so
 *     the UI's auto-detect verdict matches runtime exactly.
 *   - `disableLlmIeltsScoring` — the per-course operator override.
 *     Defaults `false` when the config key isn't set.
 */
export interface RubricCalibrationAiMeasurement {
  isIeltsShaped: boolean;
  disableLlmIeltsScoring: boolean;
}

export interface RubricCalibrationResponse {
  courseId: string;
  playbookStatus: string;
  /**
   * The slug of the per-playbook MEASURE spec, when one exists. Useful for
   * deep-linking to the spec admin UI and for the operator-facing
   * "spec slug" tooltip on the lens.
   */
  measureSpecSlug: string | null;
  skills: RubricCalibrationSkill[];
  /** Cascade-eligible mastery knobs (SP1-D / PR #1571 family). */
  masteryPolicyChips: RubricCalibrationMasteryPolicyChip[];
  /** Variant-intrinsic mastery knobs — no cascade. */
  variantPreset: RubricCalibrationVariantPreset;
  /** Story #2158 — AI Measurement Method card state. */
  aiMeasurement: RubricCalibrationAiMeasurement;
  empty: boolean;
}

/**
 * Story #2158 — the 4 IELTS skill parameter IDs. Same constants used by
 * `lib/pipeline/prosody-consumer.ts` (legacy `IELTS_PARAM_IDS`) and by
 * the seed at `prisma/seed-from-specs.ts`. Kept inline here to avoid a
 * cross-layer import dependency for a 4-element tuple.
 */
const IELTS_SKILL_PARAMETER_IDS: readonly string[] = [
  "skill_fluency_and_coherence_fc",
  "skill_pronunciation_p",
  "skill_lexical_resource_lr",
  "skill_grammatical_range_and_accuracy_gra",
];

/** Extract `SKILL-NN` from a trigger.notes string like `skillRef:SKILL-01 (#417)`. */
function skillRefFromNotes(notes: string | null): string | null {
  if (!notes) return null;
  const m = notes.match(/skillRef:(SKILL-\d+)/i);
  return m ? m[1].toUpperCase() : null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const { courseId } = await params;
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const playbook = await prisma.playbook.findUnique({
    where: { id: courseId },
    select: { id: true, status: true, config: true },
  });
  if (!playbook) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  const skills = await resolveAllSkillsForPlaybook(courseId);

  // Per-skill Parameter rows for tier descriptors + bandThresholds (one
  // round-trip, same pattern as /skills-framework).
  const parameterIds = skills.map((s) => s.parameterId);
  const parameters = parameterIds.length
    ? await prisma.parameter.findMany({
        where: { parameterId: { in: parameterIds } },
        select: { parameterId: true, name: true, definition: true, config: true },
      })
    : [];
  const paramById = new Map(parameters.map((p) => [p.parameterId, p]));

  // MEASURE spec lookup — `apply-projection.ts:657` mints the slug. Match
  // by slug rather than scanning every spec for the playbook to keep this
  // a single bounded read.
  const measureSpecSlug = `skill-measure-${courseId.slice(0, 8)}`;
  const measureSpec = await prisma.analysisSpec.findUnique({
    where: { slug: measureSpecSlug },
    select: {
      id: true,
      slug: true,
      triggers: {
        select: {
          name: true,
          given: true,
          when: true,
          then: true,
          notes: true,
          sortOrder: true,
          actions: {
            select: { description: true, parameterId: true, weight: true, sortOrder: true },
            orderBy: { sortOrder: "asc" },
          },
        },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  // Index triggers by skillRef for O(1) per-skill lookup.
  const measureBySkillRef = new Map<string, RubricCalibrationMeasure>();
  if (measureSpec) {
    for (const trig of measureSpec.triggers) {
      const ref = skillRefFromNotes(trig.notes);
      if (!ref) continue;
      measureBySkillRef.set(ref, {
        triggerName: trig.name ?? ref,
        given: trig.given,
        when: trig.when,
        then: trig.then,
        actions: trig.actions
          .filter(
            (a): a is typeof a & { parameterId: string } => a.parameterId !== null,
          )
          .map((a) => ({
            description: a.description,
            parameterId: a.parameterId,
            weight: a.weight,
          })),
      });
    }
  }

  // Cascade envelopes for the 2 mastery-policy knobs. Both go through the
  // same family resolver (lib/cascade/resolvers/mastery-policy.ts).
  const [tierMappingEnvelope, halfLifeEnvelope] = await Promise.all([
    resolveEffective<unknown>({
      knobKey: "skillTierMapping",
      scopeChain: { playbookId: courseId },
    }),
    resolveEffective<unknown>({
      knobKey: "skillScoringEmaHalfLifeDays",
      scopeChain: { playbookId: courseId },
    }),
  ]);

  const pbConfig = (playbook.config ?? {}) as Record<string, unknown>;
  const variantPreset: RubricCalibrationVariantPreset = {
    useFreshMastery:
      typeof pbConfig.useFreshMastery === "boolean"
        ? pbConfig.useFreshMastery
        : null,
    maxMasteryTier:
      typeof pbConfig.maxMasteryTier === "string"
        ? pbConfig.maxMasteryTier
        : null,
    scoringMode:
      typeof pbConfig.scoringMode === "string" ? pbConfig.scoringMode : null,
  };

  // Story #2158 — IELTS-shape detection mirrors the runtime gate at
  // `lib/pipeline/specs-loader.ts::filterByBehaviorTargetParams`. We
  // query the playbook's PLAYBOOK-scope BehaviorTargets and ask whether
  // ANY of the 4 IELTS skill parameter IDs are present — that's the
  // single signal that toggles auto-detect on. Same query the pipeline
  // runs each call, so the UI's verdict can't drift from runtime.
  const ieltsTargets = await prisma.behaviorTarget.findMany({
    where: {
      scope: "PLAYBOOK",
      playbookId: courseId,
      parameterId: { in: [...IELTS_SKILL_PARAMETER_IDS] },
    },
    select: { parameterId: true },
  });
  const isIeltsShaped = ieltsTargets.length > 0;
  const aiMeasurementCfg = pbConfig.aiMeasurement as
    | { disableLlmIeltsScoring?: boolean }
    | null
    | undefined;
  const aiMeasurement: RubricCalibrationAiMeasurement = {
    isIeltsShaped,
    disableLlmIeltsScoring: aiMeasurementCfg?.disableLlmIeltsScoring === true,
  };

  const response: RubricCalibrationResponse = {
    courseId,
    playbookStatus: playbook.status,
    measureSpecSlug: measureSpec?.slug ?? null,
    skills: skills.map((s) => {
      const param = paramById.get(s.parameterId);
      const cfg = (param?.config as Record<string, unknown> | null) ?? {};
      const tiersFromConfig =
        (cfg.tiers as Record<string, string> | undefined) ?? {};
      const bandThresholds =
        (cfg.bandThresholds as Record<string, string> | undefined) ?? null;
      return {
        skillRef: s.skillRef,
        parameterId: s.parameterId,
        parameterName: param?.name ?? s.parameterId,
        description: param?.definition ?? null,
        targetValue: s.targetValue,
        tierScheme: [...s.tierScheme],
        tiers: tiersFromConfig,
        bandThresholds,
        measure: measureBySkillRef.get(s.skillRef) ?? null,
      };
    }),
    masteryPolicyChips: [
      { knobKey: "skillTierMapping", envelope: tierMappingEnvelope },
      { knobKey: "skillScoringEmaHalfLifeDays", envelope: halfLifeEnvelope },
    ],
    variantPreset,
    aiMeasurement,
    empty: skills.length === 0,
  };

  return NextResponse.json(response);
}
