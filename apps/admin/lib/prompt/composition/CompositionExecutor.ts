/**
 * Composition Executor
 *
 * The orchestrator that reads COMP-001 spec sections and drives the pipeline:
 * 1. Load all data in parallel via SectionDataLoader
 * 2. Resolve identity/content/voice specs
 * 3. Compute shared state (modules, session flow)
 * 4. Process each section: check activation → resolve data → transform → store
 * 5. Assemble final llmPrompt JSON
 *
 * Replaces the ~1100-line buildLlmFriendlyPrompt() function.
 */

import { loadAllData } from "./SectionDataLoader";
import { getTransform } from "./TransformRegistry";
import { resolveSpecs, resolveVoiceSpecFallback, mergeIdentitySpec, applyGroupToneOverride } from "./transforms/identity";
import { computeSharedState } from "./transforms/modules";
import type {
  AssembledContext,
  CompositionResult,
  CompositionSectionDef,
} from "./types";

// Import all transform files to trigger self-registration
import "./transforms/personality";
import "./transforms/memories";
import "./transforms/targets";
import "./transforms/modules";
import "./transforms/pedagogy";
import "./transforms/pedagogy-mode";
import "./transforms/voice";
import "./transforms/quickstart";
import "./transforms/preamble";
import "./transforms/instructions";
import "./transforms/identity";
import "./transforms/simple";
import "./transforms/trust";
import "./transforms/teaching-content";
import "./transforms/activities";
import "./transforms/actions";
import "./transforms/visual-aids";

/**
 * Execute the full composition pipeline.
 *
 * @param callerId - The caller to compose a prompt for
 * @param specSections - Section definitions from COMP-001 spec (or defaults)
 * @param specConfig - Full spec config (thresholds, limits, etc.)
 */
export async function executeComposition(
  callerId: string,
  specSections: CompositionSectionDef[],
  specConfig: Record<string, any>,
): Promise<CompositionResult> {
  const loadStart = Date.now();

  // 1. Load all data in parallel
  const loadedData = await loadAllData(callerId, specConfig);
  const loadTimeMs = Date.now() - loadStart;

  if (!loadedData.caller) {
    throw new Error("Caller not found");
  }

  // 2. Resolve identity/content/voice specs from stacked playbooks + system specs
  let resolvedSpecs = resolveSpecs(loadedData.playbooks, loadedData.systemSpecs);
  resolvedSpecs = await resolveVoiceSpecFallback(resolvedSpecs);

  // 2b. Merge base + overlay if identity spec extends a base archetype
  if (resolvedSpecs.identitySpec?.extendsAgent) {
    resolvedSpecs = {
      ...resolvedSpecs,
      identitySpec: await mergeIdentitySpec(resolvedSpecs.identitySpec),
    };
  }

  // 2c. Apply department/group tone override (layers between domain identity + course identity)
  const groupOverride = loadedData.playbooks?.[0]?.group?.identityOverride;
  if (resolvedSpecs.identitySpec && groupOverride && typeof groupOverride === "object") {
    resolvedSpecs = {
      ...resolvedSpecs,
      identitySpec: applyGroupToneOverride(
        resolvedSpecs.identitySpec,
        groupOverride as Record<string, any>,
      ),
    };
    console.log(`[CompositionExecutor] Applied group tone override from "${loadedData.playbooks[0].group?.name}"`);
  }

  console.log(`[CompositionExecutor] Playbooks stacked: ${loadedData.playbooks.length} (${loadedData.playbooks.map(p => p.name).join(", ") || "none"})`);
  console.log(`[CompositionExecutor] Identity: ${resolvedSpecs.identitySpec?.name || "NONE"}${resolvedSpecs.identitySpec?.extendsAgent ? ` (extends ${resolvedSpecs.identitySpec.extendsAgent})` : ""}`);
  console.log(`[CompositionExecutor] Content: ${resolvedSpecs.contentSpec?.name || "NONE"}`);
  console.log(`[CompositionExecutor] Voice: ${resolvedSpecs.voiceSpec?.name || "NONE"}`);

  // 3. Compute shared state (modules, session flow, etc.)
  const sharedState = await computeSharedState(loadedData, resolvedSpecs, specConfig);

  // 4. Initialize assembled context
  const context: AssembledContext = {
    loadedData,
    sections: {},
    resolvedSpecs,
    sharedState,
    specConfig,
  };

  // 5. Sort sections by dependency order
  const sortedSections = topologicalSort(specSections);

  const transformStart = Date.now();
  const sectionsActivated: string[] = [];
  const sectionsSkipped: string[] = [];
  const activationReasons: Record<string, string> = {};

  // 6. Process each section
  for (const sectionDef of sortedSections) {
    // Check activation condition
    const activationResult = checkActivationWithReason(sectionDef, context);
    if (!activationResult.activated) {
      applyFallback(sectionDef, context);
      sectionsSkipped.push(sectionDef.id);
      activationReasons[sectionDef.id] = `SKIPPED: ${activationResult.reason}`;
      continue;
    }
    activationReasons[sectionDef.id] = activationResult.reason;

    // Resolve raw data for this section
    const rawData = resolveDataSource(sectionDef.dataSource, context);

    // Apply transform(s) — supports single string or chained array
    let result: any;
    if (sectionDef.transform) {
      const transforms = Array.isArray(sectionDef.transform)
        ? sectionDef.transform
        : [sectionDef.transform];

      result = rawData;
      for (const tName of transforms) {
        const transformFn = getTransform(tName);
        if (!transformFn) {
          console.error(`[CompositionExecutor] Unknown transform: ${tName}`);
          break;
        }
        result = transformFn(result, context, sectionDef);
      }
    } else if (sectionDef.dataSource === "_assembled") {
      // No transform on _assembled — collect dependent sections to avoid circular ref
      const deps = sectionDef.dependsOn || [];
      const collected: Record<string, any> = {};
      for (const depId of deps) {
        const depSection = sortedSections.find(s => s.id === depId);
        if (depSection && context.sections[depSection.outputKey] !== undefined) {
          collected[depSection.outputKey] = context.sections[depSection.outputKey];
        }
      }
      result = collected;
    } else {
      result = rawData;
    }

    context.sections[sectionDef.outputKey] = result;
    sectionsActivated.push(sectionDef.id);
  }

  const transformTimeMs = Date.now() - transformStart;

  // 7. Assemble final llmPrompt
  const llmPrompt: Record<string, any> = {
    _version: "2.0",
    _format: "LLM_STRUCTURED",
  };

  // Add sections in priority order
  for (const sectionDef of sortedSections) {
    const value = context.sections[sectionDef.outputKey];
    if (value !== undefined) {
      // Strip internal fields (prefixed with _) from section output
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const cleaned: Record<string, any> = {};
        for (const [k, v] of Object.entries(value)) {
          if (!k.startsWith("_")) cleaned[k] = v;
        }
        llmPrompt[sectionDef.outputKey] = cleaned;
      } else {
        llmPrompt[sectionDef.outputKey] = value;
      }
    }
  }

  // Add agent identity summary
  llmPrompt.agentIdentitySummary = buildAgentIdentitySummary(resolvedSpecs);

  // 8. Build callerContext markdown (for LLM prompt and storage)
  const callerContext = buildCallerContext(context);

  return {
    llmPrompt,
    callerContext,
    sections: context.sections,
    loadedData,
    resolvedSpecs,
    metadata: {
      sectionsActivated,
      sectionsSkipped,
      activationReasons,
      loadTimeMs,
      transformTimeMs,
      mergedTargetCount: context.sections.behaviorTargets?.all?.length || 0,
    },
  };
}

// =============================================================
// ACTIVATION & FALLBACK
// =============================================================

function checkActivationWithReason(
  sectionDef: CompositionSectionDef,
  context: AssembledContext,
): { activated: boolean; reason: string } {
  const { condition } = sectionDef.activateWhen;

  switch (condition) {
    case "always":
      return { activated: true, reason: "Always active" };

    case "dataExists": {
      const sources = Array.isArray(sectionDef.dataSource)
        ? sectionDef.dataSource
        : [sectionDef.dataSource];
      const found = sources.filter(s => {
        if (s === "_assembled") return true;
        const data = (context.loadedData as any)[s];
        if (data === null || data === undefined) return false;
        if (Array.isArray(data)) return data.length > 0;
        return true;
      });
      if (found.length > 0) {
        return { activated: true, reason: `Data found: ${found.join(", ")}` };
      }
      const missing = sources.filter(s => !found.includes(s));
      return { activated: false, reason: `No data for: ${missing.join(", ")}` };
    }

    case "contentSpecExists":
      if (context.resolvedSpecs.contentSpec) {
        return { activated: true, reason: `Content spec resolved: ${context.resolvedSpecs.contentSpec.name}` };
      }
      return { activated: false, reason: "No content spec in playbook" };

    case "callerHasDomain":
      if (context.loadedData.caller?.domain) {
        return { activated: true, reason: `Domain: ${context.loadedData.caller.domain.name}` };
      }
      return { activated: false, reason: "Caller has no domain assigned" };

    case "callCount == 0":
      if (context.sharedState.isFirstCall) {
        return { activated: true, reason: "First call for this caller" };
      }
      return { activated: false, reason: "Not first call" };

    case "firstCallInDomain":
      if (context.sharedState.isFirstCallInDomain) {
        return { activated: true, reason: "First call in current domain" };
      }
      return { activated: false, reason: "Not first call in domain" };

    default:
      return { activated: true, reason: `Custom condition: ${condition}` };
  }
}

function applyFallback(
  sectionDef: CompositionSectionDef,
  context: AssembledContext,
): void {
  switch (sectionDef.fallback.action) {
    case "null":
      context.sections[sectionDef.outputKey] = null;
      break;
    case "emptyObject":
      context.sections[sectionDef.outputKey] = sectionDef.fallback.value || {};
      break;
    case "omit":
    case "skip":
      // Don't add to sections
      break;
  }
}

// =============================================================
// DATA SOURCE RESOLUTION
// =============================================================

function resolveDataSource(
  dataSource: string | string[],
  context: AssembledContext,
): any {
  if (dataSource === "_assembled") {
    return context; // Full context for meta-sections
  }
  if (Array.isArray(dataSource)) {
    const result: Record<string, any> = {};
    for (const source of dataSource) {
      if (source === "callerDomain") {
        result.callerDomain = context.loadedData.caller?.domain || null;
      } else if (source === "contentSpec") {
        result.contentSpec = context.resolvedSpecs.contentSpec;
      } else {
        result[source] = (context.loadedData as any)[source];
      }
    }
    return result;
  }
  if (dataSource === "callerDomain") {
    return context.loadedData.caller?.domain || null;
  }
  return (context.loadedData as any)[dataSource];
}

// =============================================================
// TOPOLOGICAL SORT
// =============================================================

function topologicalSort(sections: CompositionSectionDef[]): CompositionSectionDef[] {
  const sorted: CompositionSectionDef[] = [];
  const visited = new Set<string>();
  const sectionMap = new Map(sections.map(s => [s.id, s]));

  function visit(section: CompositionSectionDef) {
    if (visited.has(section.id)) return;
    visited.add(section.id);
    for (const depId of section.dependsOn || []) {
      const dep = sectionMap.get(depId);
      if (dep) visit(dep);
    }
    sorted.push(section);
  }

  for (const section of sections) {
    visit(section);
  }

  return sorted;
}

// =============================================================
// CALLER CONTEXT MARKDOWN (for LLM prompt and storage)
// =============================================================

function buildCallerContext(context: AssembledContext): string {
  const { loadedData, sections, sharedState } = context;
  const parts: string[] = [];
  const caller = loadedData.caller;

  // Caller info
  parts.push("## Caller Information");
  if (caller?.name) parts.push(`- Name: ${caller.name}`);
  if (caller?.email) parts.push(`- Email: ${caller.email}`);
  if (caller?.phone) parts.push(`- Phone: ${caller.phone}`);

  // Personality
  if (sections.personality) {
    parts.push("\n## Personality Profile");
    const traits = sections.personality.traits;
    for (const [name, trait] of Object.entries(traits) as [string, any][]) {
      if (trait.score !== null) {
        parts.push(`- ${name.charAt(0).toUpperCase() + name.slice(1)}: ${trait.level?.toLowerCase() || "unknown"} (${(trait.score * 100).toFixed(0)}%)`);
      }
    }
  }

  // Memories
  if (sections.memories?.totalCount > 0) {
    parts.push("\n## Key Memories");
    for (const [category, mems] of Object.entries(sections.memories.byCategory) as [string, any[]][]) {
      parts.push(`\n### ${category}`);
      for (const m of mems) {
        parts.push(`- ${m.key}: ${m.value}`);
      }
    }
  }

  // Behavior targets
  if (sections.behaviorTargets?.totalCount > 0) {
    parts.push("\n## Agent Behavior Targets");
    for (const t of sections.behaviorTargets.all || []) {
      parts.push(`- ${t.name}: ${(t.targetLevel || "MODERATE").toLowerCase()} (${(t.targetValue * 100).toFixed(0)}%)`);
    }
  }

  // Call history
  if (sections.callHistory?.totalCalls > 0) {
    parts.push("\n## Recent Interaction Summary");
    parts.push(`${sections.callHistory.totalCalls} previous calls on record.`);
    if (sections.callHistory.mostRecent) {
      parts.push(`Most recent call: ${sections.callHistory.mostRecent.date}`);
    }
  }

  // Curriculum
  if (sections.curriculum?.hasData) {
    parts.push("\n## Curriculum Progress");
    parts.push(`- Curriculum: ${sections.curriculum.name}`);
    parts.push(`- Total Modules: ${sections.curriculum.totalModules}`);
    parts.push(`- Completed: ${sections.curriculum.completedCount}/${sections.curriculum.totalModules}`);
  }

  // Goals
  if (sections.learnerGoals?.hasData) {
    parts.push("\n## Learner Goals");
    for (const g of sections.learnerGoals.goals) {
      const progressStr = g.progress > 0 ? ` [${Math.round(g.progress * 100)}% complete]` : "";
      parts.push(`- ${g.name}${progressStr}`);
    }
  }

  // Domain
  if (sections.domain) {
    parts.push("\n## Domain Context");
    parts.push(`- Domain: ${sections.domain.name}`);
    if (sections.domain.description) parts.push(`- Description: ${sections.domain.description}`);
  }

  // Identity
  if (sections.identity) {
    parts.push("\n## Agent Identity (WHO)");
    parts.push(`- Identity Spec: ${sections.identity.specName}`);
    if (sections.identity.role) parts.push(`- Core Role: ${sections.identity.role}`);
  }

  // Content
  if (sections.content) {
    parts.push("\n## Curriculum/Content (WHAT)");
    parts.push(`- Content Spec: ${sections.content.specName}`);
    if (sections.content.curriculumName) parts.push(`- Curriculum: ${sections.content.curriculumName}`);
  }

  // Teaching content
  if (sections.teachingContent?.hasTeachingContent) {
    parts.push("\n## Teaching Content");
    parts.push(`- ${sections.teachingContent.totalAssertions} approved teaching points`);
    parts.push(`- Sources: ${(sections.teachingContent.sources || []).join(", ")}`);
    if (sections.teachingContent.highExamRelevanceCount > 0) {
      parts.push(`- ${sections.teachingContent.highExamRelevanceCount} high exam-relevance assertions`);
    }
  }

  return parts.join("\n");
}

// =============================================================
// HELPER
// =============================================================

function buildAgentIdentitySummary(resolvedSpecs: { identitySpec: any; contentSpec: any }): string {
  if (!resolvedSpecs.identitySpec && !resolvedSpecs.contentSpec) {
    return "No identity or content specs - using default conversational style.";
  }
  const parts: string[] = [];
  if (resolvedSpecs.identitySpec) {
    parts.push(`WHO: ${resolvedSpecs.identitySpec.name}`);
    const role = resolvedSpecs.identitySpec.config?.roleStatement;
    if (role) parts.push(`Role: ${role.substring(0, 100)}...`);
  }
  if (resolvedSpecs.contentSpec) {
    parts.push(`WHAT: ${resolvedSpecs.contentSpec.name}`);
    const curriculum = resolvedSpecs.contentSpec.config?.name;
    if (curriculum) parts.push(`Curriculum: ${curriculum}`);
  }
  return parts.join(". ");
}

// =============================================================
// DEFAULT SECTIONS (backward-compatible fallback when spec has no sections[])
// =============================================================

export function getDefaultSections(): CompositionSectionDef[] {
  return [
    {
      id: "caller_info",
      name: "Caller Information",
      priority: 1,
      dataSource: "caller",
      activateWhen: { condition: "always" },
      fallback: { action: "omit" },
      transform: null,
      outputKey: "caller",
    },
    {
      id: "personality",
      name: "Personality Profile",
      priority: 2,
      dataSource: "personality",
      activateWhen: { condition: "dataExists" },
      fallback: { action: "null" },
      transform: "mapPersonalityTraits",
      outputKey: "personality",
    },
    {
      id: "learner_profile",
      name: "Learner Profile",
      priority: 3,
      dataSource: "learnerProfile",
      activateWhen: { condition: "dataExists" },
      fallback: { action: "null" },
      transform: "mapLearnerProfile",
      outputKey: "learnerProfile",
    },
    {
      id: "memories",
      name: "Caller Memories",
      priority: 4,
      dataSource: "memories",
      activateWhen: { condition: "dataExists" },
      fallback: { action: "emptyObject", value: { totalCount: 0, byCategory: {}, all: [] } },
      transform: "deduplicateAndGroupMemories",
      config: { memoriesPerCategory: 5 },
      outputKey: "memories",
    },
    {
      id: "behavior_targets",
      name: "Behavior Targets",
      priority: 5,
      dataSource: ["behaviorTargets", "callerTargets"],
      activateWhen: { condition: "always" },
      fallback: { action: "emptyObject", value: { totalCount: 0, byDomain: {}, all: [] } },
      transform: "mergeAndGroupTargets",
      outputKey: "behaviorTargets",
    },
    {
      id: "call_history",
      name: "Call History",
      priority: 6,
      dataSource: ["recentCalls", "callCount"],
      activateWhen: { condition: "always" },
      fallback: { action: "emptyObject", value: { totalCalls: 0, mostRecent: null, recent: [] } },
      transform: "computeCallHistory",
      outputKey: "callHistory",
    },
    {
      id: "curriculum",
      name: "Curriculum Progress",
      priority: 7,
      dataSource: "_assembled",
      activateWhen: { condition: "contentSpecExists" },
      fallback: { action: "null" },
      transform: "computeModuleProgress",
      outputKey: "curriculum",
    },
    {
      id: "session_planning",
      name: "Session Planning",
      priority: 8,
      dataSource: "callerAttributes",
      activateWhen: { condition: "dataExists" },
      fallback: { action: "emptyObject", value: { hasData: false, context: [] } },
      transform: "filterSessionAttributes",
      outputKey: "sessionPlanning",
    },
    {
      id: "learner_goals",
      name: "Learner Goals",
      priority: 9,
      dataSource: "goals",
      activateWhen: { condition: "dataExists" },
      fallback: { action: "emptyObject", value: { hasData: false, goals: [] } },
      transform: "mapGoals",
      outputKey: "learnerGoals",
    },
    {
      id: "domain_context",
      name: "Domain Context",
      priority: 10,
      dataSource: ["callerDomain", "callerAttributes"],
      activateWhen: { condition: "callerHasDomain" },
      fallback: { action: "null" },
      transform: "computeDomainContext",
      outputKey: "domain",
    },
    {
      id: "identity",
      name: "Agent Identity",
      priority: 11,
      dataSource: "_assembled",
      activateWhen: { condition: "always" },
      fallback: { action: "null" },
      transform: "extractIdentitySpec",
      outputKey: "identity",
    },
    {
      id: "content",
      name: "Content Spec",
      priority: 12,
      dataSource: "_assembled",
      activateWhen: { condition: "contentSpecExists" },
      fallback: { action: "null" },
      transform: "extractContentSpec",
      outputKey: "content",
    },
    {
      id: "content_trust",
      name: "Content Trust & Source Authority",
      priority: 12.5,
      dataSource: "_assembled",
      activateWhen: { condition: "contentSpecExists" },
      fallback: { action: "null" },
      transform: "computeTrustContext",
      outputKey: "contentTrust",
      dependsOn: ["curriculum"],
    },
    {
      id: "teaching_content",
      name: "Approved Teaching Content",
      priority: 12.6,
      dataSource: "curriculumAssertions",
      activateWhen: { condition: "dataExists" },
      fallback: { action: "null" },
      transform: "renderTeachingContent",
      outputKey: "teachingContent",
      dependsOn: ["content_trust"],
    },
    {
      id: "visual_aids",
      name: "Visual Aids",
      priority: 12.65,
      dataSource: "visualAids",
      activateWhen: { condition: "dataExists" },
      fallback: { action: "null" },
      transform: "formatVisualAids",
      outputKey: "visualAids",
    },
    {
      id: "pedagogy_mode",
      name: "Pedagogy Mode",
      priority: 12.7,
      dataSource: "_assembled",
      activateWhen: { condition: "always" },
      fallback: { action: "null" },
      transform: "computePedagogyMode",
      outputKey: "pedagogyMode",
      dependsOn: ["curriculum"],
    },
    {
      id: "activity_toolkit",
      name: "Activity Toolkit",
      priority: 12.8,
      dataSource: "_assembled",
      activateWhen: { condition: "always" },
      fallback: { action: "emptyObject", value: { hasActivities: false, recommended: [], principles: [] } },
      transform: "computeActivityToolkit",
      outputKey: "activityToolkit",
      dependsOn: ["personality", "curriculum", "instructions_pedagogy"],
    },
    // Pedagogy and voice are computed first, then assembled into instructions
    {
      id: "instructions_pedagogy",
      name: "Session Pedagogy",
      priority: 13,
      dataSource: "_assembled",
      activateWhen: { condition: "always" },
      fallback: { action: "null" },
      transform: "computeSessionPedagogy",
      outputKey: "instructions_pedagogy",
      dependsOn: ["curriculum"],
    },
    {
      id: "instructions_voice",
      name: "Voice Guidance",
      priority: 14,
      dataSource: "_assembled",
      activateWhen: { condition: "always" },
      fallback: { action: "null" },
      transform: "computeVoiceGuidance",
      outputKey: "instructions_voice",
    },
    {
      id: "instructions",
      name: "Instructions",
      priority: 15,
      dataSource: "_assembled",
      activateWhen: { condition: "always" },
      fallback: { action: "emptyObject" },
      transform: "computeInstructions",
      outputKey: "instructions",
      dependsOn: ["memories", "personality", "behavior_targets", "curriculum", "learner_goals", "identity", "content", "content_trust", "teaching_content", "instructions_pedagogy", "instructions_voice"],
    },
    {
      id: "quick_start",
      name: "Quick Start",
      priority: 0,
      dataSource: "_assembled",
      activateWhen: { condition: "always" },
      fallback: { action: "emptyObject" },
      transform: "computeQuickStart",
      outputKey: "_quickStart",
      dependsOn: ["caller_info", "memories", "behavior_targets", "curriculum", "learner_goals", "identity"],
    },
    {
      id: "preamble",
      name: "Preamble",
      priority: -1,
      dataSource: "_assembled",
      activateWhen: { condition: "always" },
      fallback: { action: "emptyObject" },
      transform: "computePreamble",
      outputKey: "_preamble",
      dependsOn: ["identity"],
    },
  ];
}
