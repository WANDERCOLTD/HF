/**
 * Pipeline Manifest - Static description of the pipeline structure
 *
 * This file defines the "Blueprint" view - showing HOW the pipeline works
 * independent of any specific execution. It describes:
 * - Which steps exist
 * - What triggers them
 * - What specs configure them
 * - Data flow between steps
 *
 * Used by the Pipeline Blueprint UI to show the generic pipeline structure.
 */

// =============================================================================
// TYPES
// =============================================================================

export type PipelinePhase = "learn" | "adapt";

export type ConfigSource = "code" | "spec" | "hybrid";

export interface PipelineStepManifest {
  /** Unique identifier for this step */
  id: string;

  /** Human-readable label */
  label: string;

  /** Short description of what this step does */
  description: string;

  /** Which phase this step belongs to */
  phase: PipelinePhase;

  /** Source code location */
  sourceFile: string;
  sourceLine?: number;

  /** How this step is configured */
  configSource: ConfigSource;

  /**
   * For spec-configured steps: which spec key(s) configure this
   * e.g., "personality" for AnalysisSpec with slug "personality"
   */
  specKeys?: string[];

  /**
   * Which config fields from the spec are used
   * e.g., ["promptTemplate", "thresholds"]
   */
  configFields?: string[];

  /** What data this step consumes */
  inputs: string[];

  /** What data this step produces (DB models or computed values) */
  outputs: string[];

  /** Steps that must complete before this one */
  dependsOn?: string[];
}

export interface CompositionSectionManifest {
  /** Section identifier (matches outputKey in composition) */
  id: string;

  /** Human-readable label */
  label: string;

  /** Data loader function name */
  loader: string;

  /** Transform function name (if any) */
  transform?: string;

  /** When this section activates */
  activateWhen: "always" | "dataExists" | "contentSpecExists" | "identitySpecExists" | "custom";

  /** What happens if activation fails */
  fallback: "null" | "emptyObject" | "omit";

  /** Source file for the loader/transform */
  sourceFile: string;

  /** Other sections this depends on */
  dependsOn?: string[];
}

export interface PipelineManifest {
  /** Manifest version for compatibility checking */
  version: string;

  /** When this manifest was generated */
  generatedAt: string;

  /** Pipeline phases and their steps */
  phases: {
    id: PipelinePhase;
    label: string;
    description: string;
    steps: PipelineStepManifest[];
  }[];

  /** Composition sections (for the COMPOSE step) */
  compositionSections: CompositionSectionManifest[];
}

// =============================================================================
// MANIFEST DATA
// =============================================================================

export const PIPELINE_MANIFEST: PipelineManifest = {
  version: "1.0.0",
  generatedAt: new Date().toISOString(),

  phases: [
    {
      id: "learn",
      label: "Learn Phase",
      description:
        "Post-call analysis: process transcripts, measure caller personality, extract memories, measure agent behavior, compute rewards",
      steps: [
        {
          id: "transcripts:process",
          label: "Process Transcripts",
          description:
            "Import raw transcript files, create Call and Caller records",
          phase: "learn",
          sourceFile: "lib/ops/pipeline-run.ts",
          sourceLine: 45,
          configSource: "code",
          inputs: ["Raw JSON transcript files"],
          outputs: ["Call", "Caller"],
        },
        {
          id: "personality:analyze",
          label: "Analyze Personality",
          description:
            "Score caller traits (Big 5) from transcript using analysis specs",
          phase: "learn",
          sourceFile: "lib/ops/personality-analyze.ts",
          configSource: "spec",
          specKeys: ["personality"],
          configFields: ["promptTemplate", "config.thresholds"],
          inputs: ["Call.transcript", "AnalysisSpec"],
          outputs: ["CallScore", "PersonalityObservation"],
          dependsOn: ["transcripts:process"],
        },
        {
          id: "personality:aggregate",
          label: "Aggregate Personality",
          description:
            "Aggregate per-call scores into CallerPersonality profile with time decay",
          phase: "learn",
          sourceFile: "lib/ops/personality-aggregate.ts",
          configSource: "spec",
          specKeys: ["personality-aggregate"],
          configFields: ["config.halfLifeDays", "config.traitMapping"],
          inputs: ["CallScore[]", "PersonalityObservation[]"],
          outputs: ["CallerPersonality", "CallerPersonalityProfile"],
          dependsOn: ["personality:analyze"],
        },
        {
          id: "memory:extract",
          label: "Extract Memories",
          description:
            "Extract structured facts, preferences, and events from transcript",
          phase: "learn",
          sourceFile: "lib/ops/memory-extract.ts",
          configSource: "spec",
          specKeys: ["memory-personal-facts", "memory-preferences"],
          configFields: ["promptTemplate", "triggers[].actions[].learnCategory"],
          inputs: ["Call.transcript", "AnalysisSpec[]"],
          outputs: ["CallerMemory"],
          dependsOn: ["transcripts:process"],
        },
        {
          id: "agent:measure",
          label: "Measure Agent",
          description:
            "Score what the agent actually did during the call against behavior parameters",
          phase: "learn",
          sourceFile: "lib/ops/measure-agent.ts",
          configSource: "spec",
          specKeys: ["measure-agent"],
          configFields: ["promptTemplate", "config.parameters"],
          inputs: ["Call.transcript", "BehaviorTarget[]"],
          outputs: ["BehaviorMeasurement"],
          dependsOn: ["transcripts:process"],
        },
        {
          id: "reward:compute",
          label: "Compute Reward",
          description:
            "Compare actual behavior vs targets, compute reward scores and deltas",
          phase: "learn",
          sourceFile: "lib/ops/compute-reward.ts",
          configSource: "spec",
          specKeys: ["reward-compute"],
          configFields: [
            "config.outcomeWeights",
            "config.behaviorWeight",
            "config.tolerance",
          ],
          inputs: ["BehaviorMeasurement[]", "BehaviorTarget[]"],
          outputs: ["RewardScore"],
          dependsOn: ["agent:measure"],
        },
      ],
    },
    {
      id: "adapt",
      label: "Adapt Phase",
      description:
        "Pre-call preparation: compose personalized prompt from caller data, specs, and playbook",
      steps: [
        {
          id: "prompt:compose",
          label: "Compose Prompt",
          description:
            "Assemble personalized prompt from personality, memories, targets, and playbook specs",
          phase: "adapt",
          sourceFile: "lib/prompt/composition/CompositionExecutor.ts",
          configSource: "hybrid",
          specKeys: ["compose-prompt"],
          configFields: [
            "config.memoriesLimit",
            "config.recentCallsLimit",
            "config.thresholds",
          ],
          inputs: [
            "CallerPersonality",
            "CallerMemory[]",
            "BehaviorTarget[]",
            "CallerTarget[]",
            "Playbook",
            "AnalysisSpec[] (identity, content, voice)",
          ],
          outputs: ["ComposedPrompt"],
          dependsOn: [],
        },
      ],
    },
  ],

  compositionSections: [
    {
      id: "caller_info",
      label: "Caller Info",
      loader: "SectionDataLoader.caller",
      activateWhen: "always",
      fallback: "emptyObject",
      sourceFile: "lib/prompt/composition/SectionDataLoader.ts",
    },
    {
      id: "personality",
      label: "Personality Traits",
      loader: "SectionDataLoader.personality",
      transform: "mapPersonalityTraits",
      activateWhen: "dataExists",
      fallback: "omit",
      sourceFile: "lib/prompt/composition/transforms.ts",
    },
    {
      id: "learner_profile",
      label: "Learner Profile",
      loader: "SectionDataLoader.learnerProfile",
      transform: "mapLearnerProfile",
      activateWhen: "dataExists",
      fallback: "omit",
      sourceFile: "lib/prompt/composition/transforms.ts",
    },
    {
      id: "memories",
      label: "Caller Memories",
      loader: "SectionDataLoader.memories",
      transform: "deduplicateAndGroupMemories",
      activateWhen: "dataExists",
      fallback: "omit",
      sourceFile: "lib/prompt/composition/transforms.ts",
    },
    {
      id: "behavior_targets",
      label: "Behavior Targets",
      loader: "SectionDataLoader.behaviorTargets + callerTargets",
      transform: "mergeAndGroupTargets",
      activateWhen: "dataExists",
      fallback: "omit",
      sourceFile: "lib/prompt/composition/transforms.ts",
      dependsOn: ["caller_info"],
    },
    {
      id: "call_history",
      label: "Call History",
      loader: "SectionDataLoader.recentCalls",
      transform: "computeCallHistory",
      activateWhen: "dataExists",
      fallback: "omit",
      sourceFile: "lib/prompt/composition/transforms.ts",
    },
    {
      id: "curriculum",
      label: "Curriculum Progress",
      loader: "SectionDataLoader.callerAttributes",
      transform: "computeModuleProgress",
      activateWhen: "contentSpecExists",
      fallback: "omit",
      sourceFile: "lib/prompt/composition/transforms.ts",
      dependsOn: ["content"],
    },
    {
      id: "session_planning",
      label: "Session Planning",
      loader: "SectionDataLoader.callerAttributes",
      transform: "filterSessionAttributes",
      activateWhen: "dataExists",
      fallback: "omit",
      sourceFile: "lib/prompt/composition/transforms.ts",
    },
    {
      id: "learner_goals",
      label: "Learner Goals",
      loader: "SectionDataLoader.goals",
      transform: "mapGoals",
      activateWhen: "dataExists",
      fallback: "omit",
      sourceFile: "lib/prompt/composition/transforms.ts",
    },
    {
      id: "domain_context",
      label: "Domain Context",
      loader: "SectionDataLoader.playbook",
      transform: "computeDomainContext",
      activateWhen: "always",
      fallback: "emptyObject",
      sourceFile: "lib/prompt/composition/transforms.ts",
    },
    {
      id: "identity",
      label: "Agent Identity (WHO)",
      loader: "resolveIdentitySpec",
      transform: "extractIdentitySpec",
      activateWhen: "identitySpecExists",
      fallback: "omit",
      sourceFile: "lib/prompt/composition/CompositionExecutor.ts",
    },
    {
      id: "instructions_voice",
      label: "Voice Instructions (HOW)",
      loader: "resolveVoiceSpec",
      transform: "computeVoiceGuidance",
      activateWhen: "dataExists",
      fallback: "omit",
      sourceFile: "lib/prompt/composition/transforms.ts",
      dependsOn: ["identity"],
    },
    {
      id: "instructions_pedagogy",
      label: "Pedagogy Instructions",
      loader: "derived",
      transform: "computeSessionPedagogy",
      activateWhen: "contentSpecExists",
      fallback: "omit",
      sourceFile: "lib/prompt/composition/transforms.ts",
      dependsOn: ["learner_profile", "content"],
    },
    {
      id: "instructions",
      label: "Merged Instructions",
      loader: "derived",
      transform: "computeInstructions",
      activateWhen: "always",
      fallback: "emptyObject",
      sourceFile: "lib/prompt/composition/transforms.ts",
      dependsOn: ["instructions_voice", "instructions_pedagogy"],
    },
    {
      id: "quick_start",
      label: "Quick Start Summary",
      loader: "derived",
      transform: "computeQuickStart",
      activateWhen: "always",
      fallback: "emptyObject",
      sourceFile: "lib/prompt/composition/transforms.ts",
      dependsOn: ["personality", "memories", "behavior_targets"],
    },
    {
      id: "preamble",
      label: "Agent Preamble",
      loader: "derived",
      transform: "computePreamble",
      activateWhen: "identitySpecExists",
      fallback: "omit",
      sourceFile: "lib/prompt/composition/transforms.ts",
      dependsOn: ["identity"],
    },
  ],
};

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Get all steps for a given phase
 */
export function getStepsForPhase(phase: PipelinePhase): PipelineStepManifest[] {
  const phaseData = PIPELINE_MANIFEST.phases.find((p) => p.id === phase);
  return phaseData?.steps ?? [];
}

/**
 * Get a step by its ID
 */
export function getStepById(stepId: string): PipelineStepManifest | undefined {
  for (const phase of PIPELINE_MANIFEST.phases) {
    const step = phase.steps.find((s) => s.id === stepId);
    if (step) return step;
  }
  return undefined;
}

/**
 * Get composition sections in dependency order (topological sort)
 */
export function getSectionsInOrder(): CompositionSectionManifest[] {
  const sections = PIPELINE_MANIFEST.compositionSections;
  const result: CompositionSectionManifest[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(section: CompositionSectionManifest) {
    if (visited.has(section.id)) return;
    if (visiting.has(section.id)) {
      throw new Error(`Circular dependency detected: ${section.id}`);
    }

    visiting.add(section.id);

    for (const depId of section.dependsOn ?? []) {
      const dep = sections.find((s) => s.id === depId);
      if (dep) visit(dep);
    }

    visiting.delete(section.id);
    visited.add(section.id);
    result.push(section);
  }

  for (const section of sections) {
    visit(section);
  }

  return result;
}

/**
 * Check if a step is spec-configured (vs pure code)
 */
export function isSpecConfigured(step: PipelineStepManifest): boolean {
  return step.configSource === "spec" || step.configSource === "hybrid";
}

/**
 * Get all unique spec keys used by the pipeline
 */
export function getAllSpecKeys(): string[] {
  const keys = new Set<string>();
  for (const phase of PIPELINE_MANIFEST.phases) {
    for (const step of phase.steps) {
      for (const key of step.specKeys ?? []) {
        keys.add(key);
      }
    }
  }
  return Array.from(keys);
}
