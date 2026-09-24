/**
 * Shared types for the Content tab skeleton (#2204 / U2 of #2185).
 *
 * Mirrors the response shape of GET /api/courses/[courseId]/typed-content.
 * Kept in a sibling file so the tab + LH picker + detail panel + vitest
 * all read the same definition without importing from the route module
 * (server-only).
 */

import type { CueCardType } from "@/lib/types/json-fields";

export type ContentKind =
  | "mcqs"
  | "cueCards"
  | "topicPrompts"
  | "scenarioProbes"
  | "reflectionPrompts";

export interface ModuleProvenance {
  moduleId: string;
  moduleLabel: string;
}

export interface SourceProvenance {
  sourceId: string;
  sourceName: string;
}

export interface McqItem {
  id: string;
  questionText: string;
  source: SourceProvenance;
  learningOutcomeRef: string | null;
  difficulty: number | null;
}

export interface CueCardItem {
  id: string;
  /** Stable row index inside the module's cueCardPool — used by the row editor. */
  index: number;
  topic: string;
  bullets: string[];
  /** Optional CueCardType (#2162). `null` for legacy rows without a type. */
  type: CueCardType | null;
  module: ModuleProvenance;
}

export interface TopicPromptItem {
  id: string;
  topic: string;
  questions: string[];
  module: ModuleProvenance;
}

export interface ScenarioProbeItem {
  id: string;
  prompt: string;
  module: ModuleProvenance | null;
}

export interface ReflectionPromptItem {
  id: string;
  prompt: string;
  module: ModuleProvenance | null;
}

export interface TypedContentGroups {
  mcqs: McqItem[];
  cueCards: CueCardItem[];
  topicPrompts: TopicPromptItem[];
  scenarioProbes: ScenarioProbeItem[];
  reflectionPrompts: ReflectionPromptItem[];
}

export interface TypedContentPayload {
  courseId: string;
  groups: TypedContentGroups;
  modules: ModuleProvenance[];
  sources: SourceProvenance[];
}

/** Display metadata for the LH intent groups. Source-of-truth for labels. */
export interface ContentKindMeta {
  kind: ContentKind;
  label: string;
  description: string;
}

export const CONTENT_KINDS: ContentKindMeta[] = [
  {
    kind: "mcqs",
    label: "MCQ Bank",
    description: "Multiple-choice items linked from course content sources.",
  },
  {
    kind: "cueCards",
    label: "Cue Cards",
    description: "Part-2 monologue framings — topic + bullets per module.",
  },
  {
    kind: "topicPrompts",
    label: "Topic Prompts",
    description: "Per-topic question pools for student-led practice.",
  },
  {
    kind: "scenarioProbes",
    label: "Scenario Probes",
    description: "Reserved for future scenario-based teaching content.",
  },
  {
    kind: "reflectionPrompts",
    label: "Reflection Prompts",
    description: "Reserved for future reflection-cue authoring.",
  },
];

export function countItemsForKind(
  groups: TypedContentGroups,
  kind: ContentKind,
): number {
  switch (kind) {
    case "mcqs":
      return groups.mcqs.length;
    case "cueCards":
      return groups.cueCards.length;
    case "topicPrompts":
      return groups.topicPrompts.length;
    case "scenarioProbes":
      return groups.scenarioProbes.length;
    case "reflectionPrompts":
      return groups.reflectionPrompts.length;
  }
}
