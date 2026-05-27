/**
 * Progress Narrative Transform (S1 of Felt Progress epic, #779)
 *
 * Surfaces measured LO mastery to the AI so it can briefly acknowledge a
 * specific improvement mid-conversation — never inventing. Direct response to
 * tester feedback that calls happen but progress is not felt.
 *
 * Gated by `Playbook.config.progressNarrative` (see lib/types/json-fields.ts).
 * Defaults: enabled=true, cadence='on_threshold_crossing', minScoreDelta=0.1,
 * skipFirstCall=true.
 *
 * V1 note on cadence: 'on_threshold_crossing' fires when at least one LO score
 * is at or above `minScoreDelta`. True call-to-call delta tracking needs a
 * historical mastery snapshot (not currently surfaced into composer context);
 * tracked as follow-on to this story.
 */

import { registerTransform } from "../TransformRegistry";
import { buildLoMasteryMap } from "../lo-mastery-map";
import type { AssembledContext } from "../types";
import type { PlaybookConfig } from "@/lib/types/json-fields";

export interface ProgressObservation {
  loRef: string;
  score: number;
}

export interface ProgressNarrativeOutput {
  evidenceType: "lo_mastery";
  cadence: "every_call" | "on_threshold_crossing";
  observations: ProgressObservation[];
  guidance: string[];
}

const DEFAULTS = {
  enabled: true,
  cadence: "on_threshold_crossing" as const,
  minScoreDelta: 0.1,
  skipFirstCall: true,
};

const MAX_OBSERVATIONS = 3;

registerTransform("computeProgressNarrative", (
  _rawData: unknown,
  context: AssembledContext,
): ProgressNarrativeOutput | null => {
  const { sharedState, loadedData } = context;
  const playbook = loadedData.playbooks?.[0];
  const config = (playbook?.config ?? {}) as PlaybookConfig;
  const settings = config.progressNarrative ?? {};

  const enabled = settings.enabled ?? DEFAULTS.enabled;
  if (!enabled) return null;

  const skipFirstCall = settings.skipFirstCall ?? DEFAULTS.skipFirstCall;
  const callNumber: number = (sharedState as { callNumber?: number }).callNumber ?? 1;
  if (skipFirstCall && callNumber <= 1) return null;

  const cadence = settings.cadence ?? DEFAULTS.cadence;
  const minScoreDelta =
    typeof settings.minScoreDelta === "number" ? settings.minScoreDelta : DEFAULTS.minScoreDelta;

  // Rebuild loMasteryMap from CallerAttributes — scoped to the current
  // curriculum spec slug (#928); behaviour contract + grace-window rationale
  // live in `lib/prompt/composition/lo-mastery-map.ts`.
  const loMasteryMap = buildLoMasteryMap(
    loadedData.callerAttributes,
    sharedState.curriculumSpecSlug,
  );

  const candidates: ProgressObservation[] = Object.entries(loMasteryMap)
    .filter(([, score]) => {
      if (cadence === "every_call") return score > 0;
      // 'on_threshold_crossing' V1 — absolute threshold check. Proper
      // call-to-call delta tracking is a follow-on (needs prior snapshot).
      return score >= minScoreDelta;
    })
    .map(([suffix, score]) => {
      // suffix shape: "<moduleSlugOrName>:<loRef>" — take the trailing segment as loRef.
      const parts = suffix.split(":");
      const loRef = parts[parts.length - 1] ?? suffix;
      return { loRef, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_OBSERVATIONS);

  if (candidates.length === 0) return null;

  return {
    evidenceType: "lo_mastery",
    cadence,
    observations: candidates,
    guidance: [
      "Measured progress signals from this learner:",
      ...candidates.map(
        (c) => `  - ${c.loRef}: mastery ${Math.round(c.score * 100)}%`,
      ),
      "",
      "If a notable improvement is evidenced above, you MAY briefly acknowledge it in your own voice (one short sentence, woven into the conversation) — e.g. 'Your handling of {topic} is much clearer than before'.",
      "STRICT RULES — read every time:",
      "  - Cite ONLY the learning objectives listed above. Never name an LO that is not in this list.",
      "  - If no clear improvement is evidenced this call, say nothing. Never invent progress.",
      "  - Do NOT recite the mastery percentage — translate into plain language ('much stronger', 'noticeable progress', 'getting solid').",
      "  - Acknowledge at most ONE improvement per call. The learner doesn't need a report card mid-conversation.",
    ],
  };
});
