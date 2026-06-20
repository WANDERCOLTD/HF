/**
 * Companion Directives Transform — #2085 (S5 of epic #2078).
 *
 * Reads merged BehaviorTarget cascade values for the 12 producer-only
 * companion-domain parameters and emits per-parameter natural-language
 * directives the LLM consumes alongside the existing
 * `behavior_targets_semantics` block.
 *
 * Why a dedicated transform instead of `parametersAsDirectives` registry
 * entries:
 *
 *   - The 12 companion params produce more nuanced directive copy than
 *     the bipolar `templateLow` / `templateHigh` template the generic
 *     dispatcher supports. A companion who is HIGH on
 *     `BEH-INSIGHT-QUALITY` needs different framing from one who is HIGH
 *     on `BEH-INTELLECTUAL-CHALLENGE` even though both fall under the
 *     same domainGroup.
 *
 *   - Centralising the 12 wires here makes the next companion-parameter
 *     addition trivially mechanical: add an entry to
 *     `COMPANION_DIRECTIVE_MAP` below and the transform picks it up on
 *     the next compose cycle. Authors don't have to touch the registry
 *     `promptInjection` shape.
 *
 *   - Several COMP-* AnalysisSpecs (COMP-CD-001, COMP-IE-001,
 *     COMP-PP-001, COMP-RE-001, COMP-MC-001, COMP-EW-001,
 *     COMP-INSIGHT-001) measure these parameters into CallScore rows
 *     but no compose-side reader existed. This transform closes that
 *     loop for the 12 producer-only entries the 2026-06-19 audit
 *     surfaced (see `docs/groomed/2078-parameter-coverage-survey.md`
 *     §"4. companion").
 *
 * Architectural notes:
 *
 *   - **Reads from `sections.behaviorTargets._merged`.** Same source
 *     `instructions.ts` reads from. The mergeAndGroupTargets transform
 *     has already applied CALLER > PLAYBOOK > DOMAIN > SYSTEM cascade
 *     priority. We don't need a separate `getEffectiveBehaviorTargets`
 *     call — the merged list is the canonical resolved view.
 *
 *   - **HIGH/LOW/MODERATE classification** uses the shared
 *     `thresholds` from `context.sharedState`. Same classifier the
 *     other transforms use; consistent behaviour across the whole
 *     prompt.
 *
 *   - **MODERATE values are omitted.** When the target sits inside the
 *     neutral band, the LLM receives no directive for that parameter.
 *     The behaviour_targets_semantics block carries the full list
 *     regardless; this section is supplementary natural-language
 *     guidance for non-neutral targets only. Same convention as
 *     `computePersonalityAdaptation` in `personality.ts`.
 *
 *   - **`@renderer-consumed-at` sentinel.** Required by the
 *     `composition-directive-needs-renderer` ESLint rule (#1848). Render
 *     site: `renderPromptSummary.ts::renderProviderPrompt` — emits the
 *     `[COMPANION STYLE]` block alongside [STYLE] / [AUDIENCE].
 *
 *   - **`directiveCount === 0` → null section.** When the caller has no
 *     companion-domain BehaviorTargets at all (e.g. a brand-new caller
 *     pre-SYSTEM-default seeding), the transform returns null so the
 *     section is omitted from the rendered prompt rather than emitting
 *     an empty block.
 *
 * @renderer-consumed-at lib/prompt/composition/renderPromptSummary.ts
 *
 * @see docs/groomed/2078-parameter-coverage-survey.md (§4)
 * @see .claude/rules/parameter-coverage.md
 * @see https://github.com/WANDERCOLTD/HF/issues/2085
 */

import { registerTransform } from "../TransformRegistry";
import type { AssembledContext } from "../types";
import { NEUTRAL_PARAMETER_TARGET, NEUTRAL_TARGET_TOLERANCE } from "@/lib/measurement/neutral-target";

// ── Companion directive copy bank ──────────────────────────────────────
// The 12 producer-only companion-domain parameters covered by this
// transform. Keyed by `Parameter.parameterId`; emits the appropriate
// `whenHigh` / `whenLow` directive based on the cascade-resolved
// target. Copy phrasing is derived from each parameter's
// `interpretationHigh` / `interpretationLow` in
// `behavior-parameters.registry.json` — the registry holds the
// semantic axis, this map holds the imperative tutor-facing phrasing.

interface CompanionDirective {
  whenHigh: string;
  whenLow: string;
}

const COMPANION_DIRECTIVE_MAP: Record<string, CompanionDirective> = {
  "BEH-CONVERSATIONAL-DEPTH": {
    whenHigh: "Go deep into topics — nuanced exploration is welcome. This learner engages with complex ideas.",
    whenLow: "Keep conversation light and approachable. Surface-level exchanges are fine; don't overwhelm with depth.",
  },
  "BEH-INTELLECTUAL-CHALLENGE": {
    whenHigh: "Provide genuine intellectual challenge — this person enjoys being stretched. Ask probing questions and surface assumptions.",
    whenLow: "Keep things comfortable and accessible. Avoid pushing on intellectual edges; prioritise warmth over rigour.",
  },
  "BEH-MEMORY-REFERENCE": {
    whenHigh: "Actively reference past conversations, names, interests, and prior context. Continuity matters to this learner.",
    whenLow: "Don't lean on past references. Treat each conversation as a relatively fresh exchange.",
  },
  "BEH-PATIENCE-LEVEL": {
    whenHigh: "Be unhurried — allow plenty of time for thought. Don't rush turns; embrace silence as thinking time.",
    whenLow: "Keep pace brisk and forward-moving. Don't dwell or pad with reassurance.",
  },
  "BEH-RESPECT-EXPERIENCE": {
    whenHigh: "Honour this person's wisdom and experience. Treat them as an intellectual equal, not a student.",
    whenLow: "Stay simple and direct — extensive deference to experience isn't expected here.",
  },
  "BEH-STORY-INVITATION": {
    whenHigh: "Warmly invite stories and personal sharing. Create space for them to recount their experiences.",
    whenLow: "Don't actively prompt for personal stories. Let sharing emerge naturally if it does.",
  },
  "BEH-DEPTH-PREFERENCE": {
    whenHigh: "This learner prefers depth — analysis, nuance, complexity. Trade breadth for depth when in doubt.",
    whenLow: "This learner prefers lighter conversation — social connection, simple topics. Trade depth for warmth.",
  },
  "BEH-ENERGY": {
    whenHigh: "Match high energy — alert, engaged, lots to share. This person is in a strong-engagement window.",
    whenLow: "Gentle pacing — shorter turns, softer prompts, ready to wrap up if needed. They may be tired.",
  },
  "BEH-ENGAGEMENT": {
    whenHigh: "Engagement is high — pursue threads, build on what they say, follow tangential interest.",
    whenLow: "Engagement is low — keep prompts simple, offer easier entry points, don't push for elaboration.",
  },
  "BEH-MOOD": {
    whenHigh: "Mood is warm and positive — reciprocate the energy, share freely, enjoy the exchange.",
    whenLow: "Mood signals are low — withdrawn or flat affect. Stay gentle, validate, and watch for loneliness cues.",
  },
  "BEH-REMINISCENCE": {
    whenHigh: "Reminiscence mode is on — invite reflection on the past, bridge present to history, honour stories.",
    whenLow: "Stay present-focused — this learner is oriented to the here and now, not to recounting history.",
  },
  "BEH-INSIGHT-QUALITY": {
    whenHigh: "Aim for insights that feel like a well-read friend sharing something they just thought of — relevant, fresh, concise.",
    whenLow: "Pull back on offered insights — they may feel irrelevant or Wikipedia-like. Listen more, opine less.",
  },
};

// ── Transform input + output shapes ────────────────────────────────────

interface MergedTarget {
  parameterId: string;
  targetValue: number;
  parameter?: {
    name?: string | null;
    domainGroup?: string | null;
  } | null;
}

interface CompanionDirectiveLine {
  parameterId: string;
  targetLevel: "HIGH" | "LOW";
  targetValue: number;
  directive: string;
}

export interface CompanionDirectivesOutput {
  directives: CompanionDirectiveLine[];
  directiveCount: number;
}

// ── Transform registration ─────────────────────────────────────────────

registerTransform(
  "companionDirectives",
  (
    _rawData: unknown,
    context: AssembledContext,
  ): CompanionDirectivesOutput | null => {
    const mergedTargets: MergedTarget[] =
      context.sections.behaviorTargets?._merged ?? [];
    const { thresholds } = context.sharedState;

    if (mergedTargets.length === 0) return null;

    // Build a quick lookup. The map carries the cascade-resolved target
    // for every parameter the caller currently has a row for.
    const targetByParam = new Map<string, number>();
    for (const t of mergedTargets) {
      targetByParam.set(t.parameterId, t.targetValue);
    }

    const directives: CompanionDirectiveLine[] = [];

    for (const [parameterId, copyBank] of Object.entries(COMPANION_DIRECTIVE_MAP)) {
      const value = targetByParam.get(parameterId);
      // No cascade layer set → skip emission (null-effective contract,
      // mirrors the dispatcher convention in `parametersAsDirectives.ts`).
      if (value === undefined) continue;

      // Skip MODERATE values — the behavior_targets_semantics block in
      // `instructions.ts` already carries the full target list with
      // interpretations; this section is for non-neutral guidance only.
      const isNeutral =
        Math.abs(value - NEUTRAL_PARAMETER_TARGET) <= NEUTRAL_TARGET_TOLERANCE;
      if (isNeutral) continue;

      let targetLevel: "HIGH" | "LOW";
      let directive: string;
      if (value >= thresholds.high) {
        targetLevel = "HIGH";
        directive = copyBank.whenHigh;
      } else if (value <= thresholds.low) {
        targetLevel = "LOW";
        directive = copyBank.whenLow;
      } else {
        // Value sits inside [low, high] but outside the neutral
        // tolerance band — pick the closer pole. This gives the LLM a
        // soft steer rather than nothing for mid-range targets that
        // aren't quite at the thresholds.
        if (value > NEUTRAL_PARAMETER_TARGET) {
          targetLevel = "HIGH";
          directive = copyBank.whenHigh;
        } else {
          targetLevel = "LOW";
          directive = copyBank.whenLow;
        }
      }

      directives.push({
        parameterId,
        targetLevel,
        targetValue: value,
        directive,
      });
    }

    if (directives.length === 0) return null;

    return {
      directives,
      directiveCount: directives.length,
    };
  },
);

// Export the map so tests can pin coverage of the 12 expected params
// without re-introducing the literal list elsewhere.
export const COMPANION_PARAMETER_IDS = Object.keys(COMPANION_DIRECTIVE_MAP);
