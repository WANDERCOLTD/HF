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
import { buildComposeTrace, renderComposeTraceLog } from "./buildComposeTrace";
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
import "./transforms/teaching-style";
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
import "./transforms/physical-materials";
import "./transforms/session-materials";
import "./transforms/retrieval-practice";
import "./transforms/course-instructions";
import "./transforms/audience";
import "./transforms/offboarding";
import "./transforms/priorCallFeedback";
import "./transforms/mockDiagnostic";
import "./transforms/interleaveReview";
import "./transforms/courseComplete";

/**
 * Execute the full composition pipeline.
 *
 * @param callerId - The caller to compose a prompt for
 * @param specSections - Section definitions from COMP-001 spec (or defaults)
 * @param specConfig - Full spec config (thresholds, limits, etc.)
 * @param triggerType - What triggered this composition ('sim' → text channel, others → voice)
 * @param requestedModuleId - #492 Slice 3.1: when set, the composer locks the
 *   session to a specific `CurriculumModule.id`. Highest-priority module pick —
 *   overrides scheduler choice and locked-module-from-state. Surfaced from
 *   `Call.curriculumModuleId` (resolved at call creation from a `?module=<slug>`
 *   param) and from explicit picker → compose-prompt flows. When the id does
 *   not resolve to a module in the active curriculum, falls back silently to
 *   the existing priority (locked-from-spec → scheduler → recommendNextModule)
 *   and logs a warning so wizard / route bugs surface in dev.
 */
export async function executeComposition(
  callerId: string,
  specSections: CompositionSectionDef[],
  specConfig: Record<string, any>,
  triggerType?: string,
  requestedModuleId?: string | null,
  currentCallId?: string | null,
): Promise<CompositionResult> {
  const loadStart = Date.now();

  // 1. Load all data in parallel
  // #492 Slice 3.5: `currentCallId` + `requestedModuleId` thread the active
  // call's module scope into the priorCallFeedback loader so it can fetch the
  // learner's last attempt on this module (and exclude the current call).
  const loadedData = await loadAllData(callerId, specConfig, {
    requestedModuleId: requestedModuleId ?? null,
    currentCallId: currentCallId ?? null,
  });
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
  console.log(`[CompositionExecutor] Voice: ${resolvedSpecs.voiceSpec?.name || "NONE"}`);

  // 3. Compute shared state (modules, session flow, etc.)
  // #492 Slice 3.1: `requestedModuleId` (a CurriculumModule.id) is threaded as
  // an explicit param — separate from `specConfig.requestedModuleId` (the
  // authored-module id matched against Playbook.config.modules from #274
  // Slice A). Both are honoured, DB-id wins when both match.
  const sharedState = await computeSharedState(
    loadedData,
    resolvedSpecs,
    specConfig,
    triggerType,
    requestedModuleId ?? null,
  );

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
        result = await transformFn(result, context, sectionDef);
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

  // #479 — per-section character-count observability. The composed prompt
  // grew from 86K → 119K across 6 calls on hf-dev IELTS Speaking, sitting
  // near the OpenAI 30K TPM tier ceiling. Before trimming anything we need
  // to know which sections actually dominate. This log emits a sorted
  // breakdown so the next trim PR can target with confidence instead of
  // guessing. Counted on the JSON-stringified value of each section after
  // strip-internal — what actually goes into the prompt downstream.
  try {
    const sectionSizes: Array<{ key: string; chars: number }> = [];
    let totalChars = 0;
    for (const [key, value] of Object.entries(llmPrompt)) {
      if (key === "_version" || key === "_format") continue;
      const chars = typeof value === "string" ? value.length : JSON.stringify(value).length;
      sectionSizes.push({ key, chars });
      totalChars += chars;
    }
    sectionSizes.sort((a, b) => b.chars - a.chars);
    const lines = [`[compose-sizes] total=${totalChars} chars across ${sectionSizes.length} sections`];
    for (const s of sectionSizes) {
      const pct = totalChars > 0 ? Math.round((s.chars / totalChars) * 100) : 0;
      lines.push(`  ${String(s.chars).padStart(7)} (${String(pct).padStart(2)}%)  ${s.key}`);
    }
    console.log(lines.join("\n"));
  } catch (err) {
    console.warn("[compose-sizes] failed to compute section breakdown:", err);
  }

  // 8. Build callerContext markdown (for LLM prompt and storage)
  const callerContext = buildCallerContext(context);

  // Build observability trace + log it for grep-ability
  let composeTrace;
  try {
    composeTrace = await buildComposeTrace(
      { loadedData, resolvedSpecs, sectionsActivated, sectionsSkipped },
    );
    console.log(renderComposeTraceLog(composeTrace));
  } catch (err) {
    console.warn("[compose-trace] failed to build trace:", err);
  }

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
      composeTrace,
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

    case "curriculumDataExists":
      if (context.sharedState?.modules?.length > 0) {
        return { activated: true, reason: `Curriculum has ${context.sharedState.modules.length} modules` };
      }
      return { activated: false, reason: "No curriculum modules found" };

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

    case "priorCallFeedbackExists": {
      // #492 Slice 3.5 — only activate when the priorCallFeedback loader found
      // a prior call AND it produced a usable summary. The loader always
      // returns an object so the generic `dataExists` check passes; this
      // checks the hasFeedback flag explicitly so the section is omitted
      // (via fallback.action: "omit") on first-attempt calls.
      const data = (context.loadedData as any).priorCallFeedback;
      if (data && data.hasFeedback === true && typeof data.summary === "string" && data.summary.length > 0) {
        return { activated: true, reason: "Prior call feedback available" };
      }
      return { activated: false, reason: "No prior call on this module (or empty summary)" };
    }

    case "mockDiagnosticExists": {
      // #492 Slice 3.6 — only activate when the mockDiagnostic loader found a
      // DIAGNOSTIC/fromMock row AND it parsed cleanly. The chicken/egg case
      // (diagnostic.fromCallId === currentCallId) is filtered upstream in
      // the loader, which returns hasDiagnostic: false in that scenario.
      const data = (context.loadedData as any).mockDiagnostic;
      if (data && data.hasDiagnostic === true) {
        return { activated: true, reason: "Mock diagnostic available" };
      }
      return { activated: false, reason: "No mock diagnostic for this caller" };
    }

    case "interleaveReviewExists": {
      // #492 E3 Slice 3.3 — only activate when the interleaveReview loader
      // identified a stale mastered module to nudge for review. Activation
      // gates on hasReview === true AND a non-empty summary so the section
      // is OMITTED when: no active module, < 2 mastered modules, every
      // mastered module called recently, or playbookConfig is suppressing
      // via a high minDays. fallback.action="omit" drops the section
      // entirely from llmPrompt.
      const data = (context.loadedData as any).interleaveReview;
      if (
        data &&
        data.hasReview === true &&
        typeof data.summary === "string" &&
        data.summary.length > 0
      ) {
        return { activated: true, reason: "Stale mastered module available for review" };
      }
      return { activated: false, reason: "No stale mastered modules to review" };
    }

    case "courseCompleteApplies": {
      // #492 Slice 3.7 — activate the celebratory block only when the
      // courseComplete loader returned a positive verdict. The flag is set
      // by `loaders/courseComplete.ts` via `isCourseComplete`. When false
      // (most calls) the section is omitted via fallback.action: "omit"
      // and the modules section renders unchanged.
      const data = (context.loadedData as any).courseComplete;
      if (data && data.courseComplete === true) {
        return {
          activated: true,
          reason: `Course complete (mode=${data.completionMode ?? "unknown"})`,
        };
      }
      return { activated: false, reason: "Course not yet complete" };
    }

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
    // #575 — Per-band descriptor reference, sourced from
    // Parameter.config.bandThresholds (populated by #564's rubric pass).
    // Lets the tutor/assessor cite "Band 5 LR: limited range" inline.
    const withBands = (sections.behaviorTargets.all || []).filter(
      (t: { bandThresholds?: Record<string, string> | null }) =>
        t.bandThresholds && Object.keys(t.bandThresholds).length > 0,
    );
    if (withBands.length > 0) {
      parts.push("\n## Skill Band Reference (rubric source)");
      parts.push(
        "When citing a learner's current level, anchor it to the specific band descriptor below — don't paraphrase or invent.",
      );
      for (const t of withBands) {
        parts.push(`\n### ${t.name}`);
        const entries = Object.entries(
          t.bandThresholds as Record<string, string>,
        )
          .map(([band, descriptor]) => ({
            band,
            descriptor,
            sortKey: parseFloat(band),
          }))
          .filter((e) => !Number.isNaN(e.sortKey))
          .sort((a, b) => b.sortKey - a.sortKey);
        for (const e of entries) {
          parts.push(`- **Band ${e.band}:** ${e.descriptor}`);
        }
      }
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
      const pct = Math.round(g.progress * 100);
      const assessmentTag = g.isAssessmentTarget
        ? `, assessment target${g.assessmentConfig?.threshold ? `, target: ${Math.round(g.assessmentConfig.threshold * 100)}%` : ""}`
        : "";
      const progressStr = g.progress > 0 ? ` [${pct}%${g.isAssessmentTarget ? " ready" : " complete"}]` : "";
      parts.push(`- ${g.name} (${g.type}${assessmentTag})${progressStr}`);
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

  // Course instructions (tutor rules)
  if (sections.courseInstructions?.hasCourseInstructions) {
    parts.push("\n## Course Instructions");
    parts.push(`- ${sections.courseInstructions.totalInstructions} tutor instructions from course reference documents`);
  }

  return parts.join("\n");
}

// =============================================================
// HELPER
// =============================================================

function buildAgentIdentitySummary(resolvedSpecs: { identitySpec: any }): string {
  if (!resolvedSpecs.identitySpec) {
    return "No identity spec - using default conversational style.";
  }
  const parts: string[] = [];
  parts.push(`WHO: ${resolvedSpecs.identitySpec.name}`);
  const role = resolvedSpecs.identitySpec.config?.roleStatement;
  if (role) parts.push(`Role: ${role.substring(0, 100)}...`);
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
      // #492 E3 Slice 3.7 — celebratory block when the course is complete.
      // Sits at HIGH priority (5) so the tutor reads it BEFORE any teaching
      // directives (modules priority 7, mockDiagnostic 7.6, goals 9). The
      // section is omitted when courseComplete=false so the prompt is
      // unchanged for the 99% case.
      id: "courseComplete",
      name: "Course Complete Celebration",
      priority: 5,
      dataSource: "courseComplete",
      activateWhen: { condition: "courseCompleteApplies" },
      fallback: { action: "omit" },
      transform: "buildCourseCompleteBlock",
      outputKey: "courseComplete",
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
      activateWhen: { condition: "curriculumDataExists" },
      fallback: { action: "null" },
      transform: "computeModuleProgress",
      outputKey: "curriculum",
    },
    {
      // #492 Slice 3.5 — recap of the learner's last attempt on this module.
      // Slots between curriculum (priority 7) and learner_goals (priority 9) so
      // the tutor reads "what happened last time" before any goal framing.
      // activateWhen=priorCallFeedbackExists checks loadedData.priorCallFeedback.hasFeedback,
      // which is false on first-attempt calls — combined with fallback.action="omit"
      // that drops the section entirely from llmPrompt rather than emitting a null block.
      id: "prior_call_feedback",
      name: "Prior Call Feedback",
      priority: 7.5,
      dataSource: "priorCallFeedback",
      activateWhen: { condition: "priorCallFeedbackExists" },
      fallback: { action: "omit" },
      transform: "renderPriorCallFeedback",
      outputKey: "priorCallFeedback",
      dependsOn: ["curriculum"],
    },
    {
      // #492 Slice 3.6 — most recent post-Mock diagnostic. Slots between
      // prior_call_feedback (7.5) and session_planning (8) so the tutor reads
      // "what happened last time on this module" first, then "what the Mock
      // showed about the bigger picture", then session planning.
      // Activation gates on mockDiagnostic.hasDiagnostic === true so the
      // section is OMITTED when no Mock has run, the diagnostic JSON failed
      // to parse, or the diagnostic was generated by the current call
      // (chicken/egg — handled inside the loader).
      id: "mock_diagnostic",
      name: "Mock Diagnostic",
      priority: 7.6,
      dataSource: "mockDiagnostic",
      activateWhen: { condition: "mockDiagnosticExists" },
      fallback: { action: "omit" },
      transform: "renderMockDiagnostic",
      outputKey: "mockDiagnostic",
      dependsOn: ["curriculum"],
    },
    {
      // #492 E3 Slice 3.3 — spaced-review nudge for mastered modules. Slots
      // between mock_diagnostic (7.6) and session_planning (8) — i.e. AFTER
      // the post-Mock diagnostic block and BEFORE learner_goals. The block
      // is a soft cue, not a directive: the tutor decides whether to weave
      // it into the conversation. Activation gates on
      // interleaveReview.hasReview === true; fallback=omit drops the
      // section entirely when there's nothing stale to nudge for.
      id: "interleave_review",
      name: "Review Opportunity (Spaced Retrieval)",
      priority: 7.8,
      dataSource: "interleaveReview",
      activateWhen: { condition: "interleaveReviewExists" },
      fallback: { action: "omit" },
      transform: "renderInterleaveReview",
      outputKey: "interleaveReview",
      dependsOn: ["curriculum"],
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
    // "content" section removed — Content Spec consolidated (ADR-002)
    {
      id: "content_trust",
      name: "Content Trust & Source Authority",
      priority: 12.5,
      dataSource: "subjectSources",
      activateWhen: { condition: "dataExists" },
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
      id: "course_instructions",
      name: "Course Instructions",
      priority: 12.62,
      dataSource: "courseInstructions",
      activateWhen: { condition: "dataExists" },
      fallback: { action: "null" },
      transform: "renderCourseInstructions",
      outputKey: "courseInstructions",
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
      id: "session_materials",
      name: "Session Materials",
      priority: 12.655,
      dataSource: "_assembled",
      activateWhen: { condition: "always" },
      fallback: { action: "null" },
      transform: "formatSessionMaterials",
      outputKey: "sessionMaterials",
    },
    {
      id: "physical_materials",
      name: "Physical Materials",
      priority: 12.66,
      dataSource: "_assembled",
      activateWhen: { condition: "always" },
      fallback: { action: "null" },
      transform: "formatPhysicalMaterials",
      outputKey: "physicalMaterials",
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
      id: "retrieval_practice",
      name: "Retrieval Practice Questions",
      priority: 12.75,
      dataSource: "_assembled",
      activateWhen: { condition: "always" },
      fallback: { action: "null" },
      transform: "formatRetrievalPractice",
      outputKey: "retrievalPractice",
      dependsOn: ["curriculum", "teaching_content"],
    },
    {
      id: "teaching_style",
      name: "Teaching Style",
      priority: 12.8,
      dataSource: "_assembled",
      activateWhen: { condition: "always" },
      fallback: { action: "null" },
      transform: "computeTeachingStyle",
      outputKey: "teachingStyle",
      dependsOn: ["identity"],
    },
    {
      id: "audience_guidance",
      name: "Audience Guidance",
      priority: 12.82,
      dataSource: "_assembled",
      activateWhen: { condition: "always" },
      fallback: { action: "null" },
      transform: "computeAudienceGuidance",
      outputKey: "audienceGuidance",
    },
    {
      id: "activity_toolkit",
      name: "Activity Toolkit",
      priority: 12.85,
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
      id: "offboarding",
      name: "Offboarding Guidance",
      priority: 13.5,
      dataSource: "_assembled",
      activateWhen: { condition: "always" },
      fallback: { action: "null" },
      transform: "computeOffboarding",
      outputKey: "offboarding",
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
      dependsOn: ["memories", "personality", "behavior_targets", "curriculum", "learner_goals", "identity", "content_trust", "teaching_content", "course_instructions", "instructions_pedagogy", "instructions_voice"],
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
