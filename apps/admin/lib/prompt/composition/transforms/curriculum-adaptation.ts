/**
 * curriculum-adaptation transform — #2082 / S3 of epic #2078.
 *
 * Closes 22 of the 28 producer-only `domainGroup=curriculum-adaptation`
 * parameters identified by the 2026-06-19 parameter-coverage survey
 * (`docs/groomed/2078-parameter-coverage-survey.md`).
 *
 * **What it reads:**
 *   - `sections.behaviorTargets` — the merged BehaviorTarget +
 *     CallerTarget map (cascade-resolved) for the 22 curriculum-adaptation
 *     parameter IDs this transform wires.
 *   - `sharedState.modules`, `completedModules`, `nextModule`,
 *     `moduleToReview`, `resolvedMasteryThreshold`, `moduleAttemptCounts`,
 *     `schedulerDecision`, `callNumber`, `isFirstCall`, `estimatedProgress`
 *     — the LEARN-ASSESS-001 / CURR-001 derived per-module mastery state.
 *
 * **What it emits:**
 *   - `directives[]` — one short tutor-readable line per active
 *     curriculum-adaptation parameter whose effective value diverges from
 *     the neutral target (0.5) OR whose mastery context flips a binary
 *     gate (e.g. "below threshold → reinforce foundations").
 *   - `summary` — single-line digest used by the renderer when the
 *     directive list is empty (every param near neutral and no mastery
 *     signal worth surfacing).
 *
 * **Sibling-writer survey** (per `.claude/rules/lattice-survey.md`):
 *   - `transforms/targets.ts` already emits behaviour-target SUMMARY data
 *     into `instructions.behavior_targets_summary` /
 *     `behavior_targets_semantics`. This transform writes a DIFFERENT
 *     output key (`curriculumAdaptation`) and a different intent —
 *     curriculum-pace directives, not behaviour-shape semantics. The two
 *     coexist without overlap; both can mention the same parameterId
 *     because they emit different framings (data + guidance).
 *   - `transforms/instructions.ts::computeInstructions` builds
 *     `curriculum_guidance` ("THIS SESSION: Continue with X" /
 *     "Review Y → Introduce Z") from `sharedState`. This transform reads
 *     the SAME `sharedState` fields to derive ADAPTATION directives (a
 *     different concern — pacing/depth vs sequencing). No write conflict.
 *   - `transforms/parametersAsDirectives.ts` (#1907) dispatches registry
 *     entries that carry `promptInjection` blocks. None of the 22 params
 *     wired here carry that block today; if they later do, the
 *     dispatcher emits its STYLE-section directive alongside this
 *     transform's CURRICULUM-section directive. The LLM sees both as
 *     separate signals.
 *   - DB writes: this transform performs ZERO `prisma.*` writes. It is
 *     read-only on `sections.behaviorTargets._merged`.
 *
 * **Renderer pairing**:
 *   The output goes into `llmPrompt.curriculumAdaptation`. The
 *   `renderPromptSummary.ts` renderer pushes it into the
 *   "[CURRICULUM ADAPTATION]" section just after the curriculum guidance
 *   block. See PAIRS row "curriculumAdaptation" in
 *   `tests/lib/prompt/composition/coverage-producer-consumer.test.ts`.
 *
 * @renderer-consumed-at lib/prompt/composition/renderPromptSummary.ts
 *
 * @see docs/groomed/2078-parameter-coverage-survey.md §curriculum-adaptation
 * @see .claude/rules/parameter-coverage.md
 * @see https://github.com/WANDERCOLTD/HF/issues/2082
 */

import { registerTransform } from "../TransformRegistry";
import type { AssembledContext, CompositionSectionDef } from "../types";
import type { NormalizedTarget } from "./targets";

/**
 * The 22 curriculum-adaptation parameter IDs this transform wires.
 *
 * Substring matches against these literals are what the
 * `parameter-coverage.test.ts` Coverage-pillar ratchet classifies as
 * `covered`. Removing or renaming any entry here will re-classify the
 * parameter as `gap` and trip the ratchet. If the registry adds a new
 * curriculum-adaptation parameter, add its id here (or to PHASE_2_DEFERRED
 * below if pedagogy/architecture deferred).
 *
 * Survey breakdown:
 *   - CURR-A (trivial mastery/progress reads): 12 — params whose
 *     directive flips on per-module mastery state from LEARN-ASSESS-001.
 *   - CURR-B (standard instructional design): 10 — params whose
 *     directive flips on the cascade-resolved target value alone.
 */
const CURR_A_MASTERY_PARAMS = [
  "BEH-APPLICATION-ADAPTATION",
  "BEH-ADVANCE-READINESS",
  "BEH-ANALOGY-USAGE",
  "BEH-CHECK-FOR-UNDERSTANDING",
  "BEH-COMPREHENSION-ADAPTATION",
  "BEH-COMPREHENSION-SCORE",
  "BEH-CONCEPT-EXPOSURE",
  "BEH-FOUNDATION-FOCUS",
  "BEH-GUIDED-PRACTICE",
  "BEH-MASTERY-ADAPTATION",
  "BEH-MODULE-INTRODUCTION",
  "BEH-MODULE-MASTERY",
] as const;

const CURR_B_INSTRUCTIONAL_PARAMS = [
  "BEH-APPLICATION-SCORE",
  "BEH-EXPLANATION-VARIETY",
  "BEH-INTERLEAVING",
  "BEH-NEW-CONTENT-RATE",
  "BEH-NUANCE-EXPLORATION",
  "BEH-PROBING-QUESTIONS",
  "BEH-PRODUCTIVE-STRUGGLE",
  "BEH-WORKED-EXAMPLES",
  "BEH-REVIEW-ADAPTATION",
  "BEH-REVIEW-STATUS",
] as const;

/** Union of the 22 wired curriculum-adaptation parameter IDs (for tests). */
export const CURRICULUM_ADAPTATION_PARAMS = [
  ...CURR_A_MASTERY_PARAMS,
  ...CURR_B_INSTRUCTIONAL_PARAMS,
] as const;

/**
 * Phase-2 deferred curriculum-adaptation parameters — NOT wired by this
 * transform. Listed for discoverability so future PRs know what's pending.
 *   - BEH-CHALLENGE-LEVEL: needs per-module/LO difficulty knob (no schema
 *     surface today).
 *   - BEH-PREREQUISITE-ADAPTATION / BEH-PREREQUISITE-CHECK /
 *     BEH-PREREQUISITE-CALLBACK: full prerequisite-graph traversal beyond
 *     `module.prerequisites[]` strings — Phase 2 with curriculum-graph
 *     editor.
 *   - BEH-SPACED-RETRIEVAL-PRIORITY: feeds the SRS scheduler (separate
 *     concern from prompt composition).
 *
 * These stay producer-only until the architectural prereqs land.
 */
export const PHASE_2_DEFERRED = [
  "BEH-CHALLENGE-LEVEL",
  "BEH-PREREQUISITE-ADAPTATION",
  "BEH-PREREQUISITE-CHECK",
  "BEH-PREREQUISITE-CALLBACK",
  "BEH-SPACED-RETRIEVAL-PRIORITY",
] as const;

// ── Tunables ────────────────────────────────────────────────────────────
//
// Band cuts mirror `transforms/targets.ts::thresholds` (default high=0.65,
// low=0.35). Kept as local constants here so this transform's
// `when-non-neutral` gate doesn't drift independently. Per
// `lib/measurement/neutral-target.ts`, the neutral point is 0.5 — any
// value in (LOW_CUT, HIGH_CUT) is treated as "no signal worth a directive".

const HIGH_CUT = 0.65;
const LOW_CUT = 0.35;

/** Pick "low" / "neutral" / "high" band for a 0-1 target value. */
function band(v: number): "low" | "neutral" | "high" {
  if (v <= LOW_CUT) return "low";
  if (v >= HIGH_CUT) return "high";
  return "neutral";
}

// ── Output shape ────────────────────────────────────────────────────────

export interface CurriculumAdaptationDirective {
  parameterId: string;
  /** Single tutor-readable line ready for the prompt. */
  directive: string;
  /** Resolved target value 0-1 — surfaced for diagnostic / replay. */
  targetValue: number;
  /** Band classification at resolve time (low / neutral / high). */
  band: "low" | "neutral" | "high";
}

export interface CurriculumAdaptationSection {
  /** Whether any directive (or contextual line) was emitted. */
  hasDirectives: boolean;
  /** Per-parameter directives — empty if every param sits at neutral. */
  directives: CurriculumAdaptationDirective[];
  /** Per-module mastery state lines from LEARN-ASSESS-001 (CURR-A side). */
  masteryContext: string[];
  /**
   * Fully-assembled markdown block (heading + bulleted directives +
   * mastery context). When `hasDirectives === false` this is empty and
   * the renderer omits the section.
   */
  body: string;
  /** 1-sentence digest for tutor scanning. */
  summary: string;
  /** Total directives emitted (CURR-A + CURR-B). */
  directiveCount: number;
}

// ── Directive templates (CURR-B: cascade-target driven) ─────────────────
//
// Each template is one short tutor-facing line. The `low` and `high`
// branches emit; `neutral` returns `null` and the parameter is skipped.

type Template = Record<"low" | "high", string>;

const CURR_B_TEMPLATES: Record<string, Template> = {
  "BEH-APPLICATION-SCORE": {
    low: "Treat application as weak — give worked examples before any practice question.",
    high: "Application is strong — let the learner attempt novel problems with minimal scaffolding.",
  },
  "BEH-EXPLANATION-VARIETY": {
    low: "Stick with one clear explanation; avoid alternative framings until requested.",
    high: "When something doesn't land, offer an alternative explanation in a different style (analogy / step-by-step / story).",
  },
  "BEH-INTERLEAVING": {
    low: "Keep this session focused on one module; do not interleave older material.",
    high: "Weave brief callbacks to earlier modules where they support the current concept.",
  },
  "BEH-NEW-CONTENT-RATE": {
    low: "Introduce at most one new concept this session; consolidate the rest.",
    high: "Move briskly — new concepts can be introduced as soon as prior ones are acknowledged.",
  },
  "BEH-NUANCE-EXPLORATION": {
    low: "Skip edge cases and exceptions; teach the central rule first.",
    high: "Explore nuance and edge cases when the learner shows understanding of the core idea.",
  },
  "BEH-PROBING-QUESTIONS": {
    low: "Ask straightforward comprehension checks; avoid Socratic probing.",
    high: "Use probing questions to deepen understanding (\"why does that follow?\", \"what would change if…?\").",
  },
  "BEH-PRODUCTIVE-STRUGGLE": {
    low: "Step in quickly when the learner hesitates — do not let silence linger.",
    high: "Allow productive struggle: wait several seconds before offering help.",
  },
  "BEH-WORKED-EXAMPLES": {
    low: "Skip worked examples; jump straight to learner-led practice.",
    high: "Lead with a fully worked example before any practice question.",
  },
  "BEH-REVIEW-ADAPTATION": {
    low: "Spend minimal time reviewing prior material; default to forward progress.",
    high: "Open with a brief review of the last module before introducing new content.",
  },
  "BEH-REVIEW-STATUS": {
    low: "Treat earlier modules as fresh; no spaced-retrieval prompts needed.",
    high: "Bring back at least one concept from a prior module for spaced retrieval this session.",
  },
};

// ── Directive templates (CURR-A: target × mastery-state driven) ─────────
//
// CURR-A parameters interact with per-module mastery state from
// LEARN-ASSESS-001. Each takes the cascade target band AND a mastery
// context (`belowThreshold` / `atThreshold` / `aboveThreshold` /
// `noData`) and emits accordingly. The mastery context comes from
// `sharedState.moduleAttemptCounts` × `resolvedMasteryThreshold`.

type MasteryState = "belowThreshold" | "atThreshold" | "aboveThreshold" | "noData";

interface CurrATemplate {
  /** Direct overrides keyed by `${band}:${state}`. Most specific wins. */
  matrix: Partial<Record<`${"low" | "neutral" | "high"}:${MasteryState}`, string>>;
  /** Fallback by band only when no matrix entry matches. */
  byBand?: Partial<Record<"low" | "high", string>>;
}

const CURR_A_TEMPLATES: Record<string, CurrATemplate> = {
  "BEH-APPLICATION-ADAPTATION": {
    matrix: {
      "low:belowThreshold": "Application is weak and mastery is below threshold — favour explanation over practice.",
      "high:aboveThreshold": "Application is strong and mastery is solid — favour practice problems over re-explanation.",
    },
    byBand: {
      low: "Favour explanation over practice this session.",
      high: "Favour practice over explanation this session.",
    },
  },
  "BEH-ADVANCE-READINESS": {
    matrix: {
      "high:aboveThreshold": "Mastery exceeds threshold — advance to the next module when the learner is ready.",
      "low:belowThreshold": "Mastery is below threshold — stay on this module; do not advance yet.",
      "neutral:belowThreshold": "Mastery is still below threshold — keep working on the current module.",
    },
  },
  "BEH-ANALOGY-USAGE": {
    matrix: {
      "low:belowThreshold": "Skip elaborate analogies; the learner needs direct teaching first.",
      "high:belowThreshold": "Use analogies generously to bridge to the abstract concept.",
      "high:atThreshold": "Use analogies to connect this concept to others the learner already knows.",
    },
    byBand: {
      low: "Prefer literal explanation over analogy.",
      high: "Use analogies to make abstract ideas concrete.",
    },
  },
  "BEH-CHECK-FOR-UNDERSTANDING": {
    matrix: {
      "low:aboveThreshold": "Comprehension checks can be infrequent — learner is demonstrating mastery.",
      "high:belowThreshold": "Check for understanding after every concept — mastery is shaky.",
    },
    byBand: {
      high: "Insert comprehension checks frequently.",
      low: "Reduce comprehension-check frequency — let the learner drive.",
    },
  },
  "BEH-COMPREHENSION-ADAPTATION": {
    matrix: {
      "high:belowThreshold": "Adapt to comprehension signals aggressively — slow down or reframe at the first sign of confusion.",
      "low:aboveThreshold": "Comprehension is strong; do not adapt away from the planned pace.",
    },
  },
  "BEH-COMPREHENSION-SCORE": {
    matrix: {
      "low:belowThreshold": "Comprehension score is low and mastery is below threshold — slow the pace and re-explain in simpler terms.",
      "high:aboveThreshold": "Comprehension score is high — proceed at full pace with confidence.",
    },
  },
  "BEH-CONCEPT-EXPOSURE": {
    matrix: {
      "low:belowThreshold": "Keep concept exposure narrow — focus on the one concept this module needs.",
      "high:aboveThreshold": "Increase concept exposure — the learner can handle adjacent ideas.",
    },
  },
  "BEH-FOUNDATION-FOCUS": {
    matrix: {
      "high:belowThreshold": "Focus on foundations — re-teach prerequisites before adding new material.",
      "low:aboveThreshold": "Foundations are solid; build on them without revisiting basics.",
    },
    byBand: {
      high: "Prioritise foundational concepts over advanced ones.",
    },
  },
  "BEH-GUIDED-PRACTICE": {
    matrix: {
      "high:belowThreshold": "Guide every practice question step-by-step; do not leave the learner alone yet.",
      "low:aboveThreshold": "Let the learner attempt practice independently; intervene only on errors.",
    },
    byBand: {
      high: "Provide guided practice with scaffolding.",
      low: "Use independent practice; minimise tutor hand-holding.",
    },
  },
  "BEH-MASTERY-ADAPTATION": {
    matrix: {
      "high:belowThreshold": "Adapt aggressively to mastery signals — re-teach when mastery drops below threshold.",
      "low:aboveThreshold": "Mastery is steady; adapt minimally — continue the planned arc.",
    },
  },
  "BEH-MODULE-INTRODUCTION": {
    matrix: {
      "high:noData": "First exposure to this module — introduce it with a clear framing and learning intent.",
      "high:belowThreshold": "Re-introduce the module at the start of the session before practice.",
    },
    byBand: {
      high: "Open the session with an explicit module introduction.",
    },
  },
  "BEH-MODULE-MASTERY": {
    matrix: {
      "high:aboveThreshold": "Module mastery is strong — narrate the win and prepare to advance.",
      "low:belowThreshold": "Module mastery is weak — focus the session on closing the gap.",
      "neutral:atThreshold": "Module mastery is near threshold — one focused session should close it.",
    },
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Resolve the mastery state of the focus module for this call. Uses
 * `sharedState.moduleAttemptCounts` (DB-backed CallerModuleProgress) +
 * `resolvedMasteryThreshold` (cascade-resolved). Picks the
 * `nextModule` / `moduleToReview` / first-not-completed as the focus.
 *
 * Returns `noData` when no module has been attempted yet (typical Call 1).
 */
function resolveFocusMastery(context: AssembledContext): {
  state: MasteryState;
  moduleSlug: string | null;
  callCount: number;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | null;
} {
  const ss = context.sharedState;
  const focusModule = ss.lockedModule || ss.moduleToReview || ss.nextModule || ss.modules[0] || null;
  if (!focusModule) {
    return { state: "noData", moduleSlug: null, callCount: 0, status: null };
  }

  const counts = focusModule.id ? ss.moduleAttemptCounts?.[focusModule.id] : undefined;
  if (!counts || counts.callCount === 0) {
    return { state: "noData", moduleSlug: focusModule.slug, callCount: 0, status: counts?.status ?? null };
  }

  if (counts.status === "COMPLETED") {
    return {
      state: "aboveThreshold",
      moduleSlug: focusModule.slug,
      callCount: counts.callCount,
      status: counts.status,
    };
  }

  // IN_PROGRESS or NOT_STARTED with at least one call — derive from
  // estimatedProgress (per-module mastery isn't stored on counts, so
  // fall back to course-wide estimate as a coarse signal). Below-vs-at
  // threshold is what the directive matrix cares about; the exact value
  // doesn't propagate.
  const threshold = ss.resolvedMasteryThreshold ?? 0.7;
  const progress = ss.estimatedProgress ?? 0;
  if (progress >= threshold) {
    return {
      state: "aboveThreshold",
      moduleSlug: focusModule.slug,
      callCount: counts.callCount,
      status: counts.status,
    };
  }
  if (progress >= threshold - 0.1) {
    return {
      state: "atThreshold",
      moduleSlug: focusModule.slug,
      callCount: counts.callCount,
      status: counts.status,
    };
  }
  return {
    state: "belowThreshold",
    moduleSlug: focusModule.slug,
    callCount: counts.callCount,
    status: counts.status,
  };
}

/** Index merged behaviour targets by parameterId for O(1) lookup. */
function indexTargets(targets: NormalizedTarget[]): Map<string, NormalizedTarget> {
  const map = new Map<string, NormalizedTarget>();
  for (const t of targets) {
    map.set(t.parameterId, t);
  }
  return map;
}

/** Emit the CURR-B directive for one parameter, or null when neutral. */
function renderCurrB(parameterId: string, target: NormalizedTarget): CurriculumAdaptationDirective | null {
  const tmpl = CURR_B_TEMPLATES[parameterId];
  if (!tmpl) return null;
  const b = band(target.targetValue);
  if (b === "neutral") return null;
  const directive = tmpl[b];
  if (!directive) return null;
  return { parameterId, directive, targetValue: target.targetValue, band: b };
}

/** Emit the CURR-A directive given target + mastery context, or null when neutral. */
function renderCurrA(
  parameterId: string,
  target: NormalizedTarget,
  masteryState: MasteryState,
): CurriculumAdaptationDirective | null {
  const tmpl = CURR_A_TEMPLATES[parameterId];
  if (!tmpl) return null;
  const b = band(target.targetValue);
  // 1. Matrix override (band × mastery state) — most specific.
  const matrixKey = `${b}:${masteryState}` as const;
  const matrixHit = tmpl.matrix[matrixKey];
  if (matrixHit) {
    return { parameterId, directive: matrixHit, targetValue: target.targetValue, band: b };
  }
  // 2. Band-only fallback for non-neutral bands.
  if (b !== "neutral") {
    const fallback = tmpl.byBand?.[b];
    if (fallback) {
      return { parameterId, directive: fallback, targetValue: target.targetValue, band: b };
    }
  }
  return null;
}

// ── Transform ───────────────────────────────────────────────────────────

registerTransform(
  "computeCurriculumAdaptation",
  (
    _rawData: unknown,
    context: AssembledContext,
    _sectionDef: CompositionSectionDef,
  ): CurriculumAdaptationSection => {
    // Behavior targets are merged + grouped by `transforms/targets.ts`
    // (the `mergeAndGroupTargets` transform). Same compose cycle, so the
    // dependency contract via `dependsOn: ["behavior_targets"]` is already
    // honoured at the section level.
    const merged: NormalizedTarget[] =
      context.sections.behaviorTargets?._merged ||
      context.sections.behaviorTargets?.all ||
      [];
    const byId = indexTargets(merged);

    // Pre-resolve the focus module's mastery state — used by every CURR-A
    // directive AND by the masteryContext lines surfaced to the tutor.
    const focus = resolveFocusMastery(context);

    const directives: CurriculumAdaptationDirective[] = [];

    // CURR-A — target × mastery-state matrix.
    for (const paramId of CURR_A_MASTERY_PARAMS) {
      const t = byId.get(paramId);
      if (!t) continue; // No cascade row for this param — silently skip.
      const d = renderCurrA(paramId, t, focus.state);
      if (d) directives.push(d);
    }

    // CURR-B — target-band only.
    for (const paramId of CURR_B_INSTRUCTIONAL_PARAMS) {
      const t = byId.get(paramId);
      if (!t) continue;
      const d = renderCurrB(paramId, t);
      if (d) directives.push(d);
    }

    // Mastery context lines — surfaced separately from directives so the
    // renderer can prepend them ("the focus module is …") before the
    // bullet list. These are tutor-facing context, NOT prescriptive
    // directives.
    const masteryContext: string[] = [];
    if (focus.moduleSlug) {
      switch (focus.state) {
        case "belowThreshold":
          masteryContext.push(
            `Focus module "${focus.moduleSlug}" — mastery is BELOW the threshold (call ${focus.callCount}).`,
          );
          break;
        case "atThreshold":
          masteryContext.push(
            `Focus module "${focus.moduleSlug}" — mastery is at threshold (call ${focus.callCount}).`,
          );
          break;
        case "aboveThreshold":
          masteryContext.push(
            `Focus module "${focus.moduleSlug}" — mastery is ABOVE the threshold (call ${focus.callCount}).`,
          );
          break;
        case "noData":
          // Don't surface a noData line on Call 1 — it would just say
          // "no attempts yet" which is redundant with the curriculum
          // section's "first call" framing.
          break;
      }
    }

    const hasDirectives = directives.length > 0 || masteryContext.length > 0;
    if (!hasDirectives) {
      return {
        hasDirectives: false,
        directives: [],
        masteryContext: [],
        body: "",
        summary: "",
        directiveCount: 0,
      };
    }

    const lines: string[] = [];
    lines.push("## Curriculum adaptation");
    for (const line of masteryContext) lines.push(line);
    for (const d of directives) lines.push(`- ${d.directive}`);
    const body = lines.join("\n");
    const summary =
      directives.length > 0
        ? `${directives.length} curriculum-adaptation directive(s) active.`
        : (masteryContext[0] ?? "");

    return {
      hasDirectives,
      directives,
      masteryContext,
      body,
      summary,
      directiveCount: directives.length,
    };
  },
);
