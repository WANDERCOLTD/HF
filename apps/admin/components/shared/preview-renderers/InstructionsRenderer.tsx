"use client";

/**
 * InstructionsRenderer — A.4 of Epic #1606 (Designer Renderers v2).
 *
 * Shows the goal-adaptation guidance template the COMPOSE pipeline
 * stamps into the prompt for each goal. The map is course-agnostic
 * (canonical GOAL_ADAPTATION map mirrored from
 * `lib/prompt/composition/transforms/instructions.ts`); when the
 * course has goals, the in-use types are highlighted and the rest
 * are dimmed.
 *
 * Read-only by design (epic #1675 Slice B note): the goal-adaptation
 * matrix is a static reference table, not an educator-tunable setting.
 * No journey-contract entry exists; this renderer remains a read-only
 * display regardless of the JourneySettingMutatorProvider context.
 *
 * Source of truth for the labels: GOAL_ADAPTATION in
 * `lib/prompt/composition/transforms/instructions.ts`. Mirroring here
 * keeps the renderer free of a server import and free of a fetch —
 * the cost is keeping the two arrays in sync. A vitest pins the
 * shape so divergence fails CI.
 */

import { registerPreviewRenderer } from "@/components/shared/designer-shell/section-registry";
import type { PreviewRendererProps } from "@/components/shared/designer-shell/section-registry";

export type GoalType =
  | "LEARN"
  | "ACHIEVE"
  | "CHANGE"
  | "CONNECT"
  | "SUPPORT"
  | "CREATE";

/** Mirror of `GOAL_ADAPTATION` in `transforms/instructions.ts`. If the
 *  server-side map changes, `tests/components/preview-renderers/
 *  instructions-renderer.test.tsx` will fail until this is resynced. */
export const GOAL_ADAPTATION_GUIDANCE: Record<
  GoalType,
  [low: string, mid: string, high: string]
> = {
  LEARN: [
    "Introduce concepts gently, check understanding frequently",
    "Build on prior foundations, connect to what they already know",
    "Challenge with application, prepare for mastery",
  ],
  ACHIEVE: [
    "Clarify what success looks like, break into steps",
    "Track milestones, celebrate progress",
    "Focus on final steps, anticipate obstacles",
  ],
  CHANGE: [
    "Explore motivation, validate feelings",
    "Practice new behaviours, reflect on changes",
    "Reinforce new habits, plan sustainability",
  ],
  CONNECT: [
    "Build trust, find common ground",
    "Deepen relationship, share openly",
    "Maintain connection, mutual exchange",
  ],
  SUPPORT: [
    "Listen actively, understand needs",
    "Provide targeted support, check coping",
    "Evaluate effectiveness, plan independence",
  ],
  CREATE: [
    "Brainstorm freely, no judgment",
    "Iterate and refine, give constructive feedback",
    "Polish and finish, celebrate creation",
  ],
};

const GOAL_TYPES: GoalType[] = [
  "LEARN",
  "ACHIEVE",
  "CHANGE",
  "CONNECT",
  "SUPPORT",
  "CREATE",
];

export interface InstructionsRendererData {
  /** Goal types in use on this course — drives the dimmed/highlighted
   *  treatment per row. If undefined, all rows render at full strength. */
  goalTypesInUse?: GoalType[];
}

export function InstructionsRenderer({
  data,
}: PreviewRendererProps<InstructionsRendererData>) {
  const inUseSet = data.goalTypesInUse
    ? new Set(data.goalTypesInUse)
    : null;
  return (
    <div className="hf-card-compact">
      <div className="hf-category-label">
        Goal adaptation guidance (LOW / MID / HIGH)
      </div>
      <div className="hf-text-sm">
        Static template stamped by the COMPOSE pipeline per goal type and
        progress bracket.
      </div>
      {GOAL_TYPES.map((type) => {
        const guidance = GOAL_ADAPTATION_GUIDANCE[type];
        const dimmed = inUseSet !== null && !inUseSet.has(type);
        return (
          <div
            key={type}
            className={`hf-card-compact ${dimmed ? "hf-text-muted" : ""}`}
            data-testid={`hf-instructions-row-${type}`}
            data-dimmed={dimmed}
          >
            <div className="hf-chip-row">
              <span
                className={`hf-badge ${dimmed ? "hf-badge-muted" : "hf-badge-info"}`}
              >
                {type}
              </span>
              {!dimmed && inUseSet !== null ? (
                <span className="hf-badge hf-badge-success">in use</span>
              ) : null}
            </div>
            <ol className="hf-list-row">
              <li>
                <span className="hf-category-label">LOW</span>{" "}
                {guidance[0]}
              </li>
              <li>
                <span className="hf-category-label">MID</span>{" "}
                {guidance[1]}
              </li>
              <li>
                <span className="hf-category-label">HIGH</span>{" "}
                {guidance[2]}
              </li>
            </ol>
          </div>
        );
      })}
    </div>
  );
}

registerPreviewRenderer<"instructions", InstructionsRendererData>(
  "instructions",
  InstructionsRenderer,
);
