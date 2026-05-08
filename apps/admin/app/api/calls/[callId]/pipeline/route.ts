/**
 * @api POST /api/calls/:callId/pipeline
 * @visibility public
 * @scope pipeline:execute
 * @auth session | x-internal-secret
 * @tags calls, pipeline
 * @description SPEC-DRIVEN pipeline endpoint that runs analysis in configurable stages. Pipeline stages are loaded from the PIPELINE-001 spec (or GUARD-001 fallback), not hardcoded. Each stage has a name, order, outputTypes, and optional requiresMode. Default stages: EXTRACT (10), SCORE_AGENT (20), AGGREGATE (30), REWARD (40), ADAPT (50), SUPERVISE (60), COMPOSE (100, prompt mode only).
 * @pathParam callId string - The call ID to run the pipeline on
 * @body callerId string - The caller ID (required)
 * @body mode string - Pipeline mode: "prep" (all stages except COMPOSE) or "prompt" (all stages including COMPOSE) (required)
 * @body engine string - AI engine to use: "mock" | "claude" | "openai" (default: "claude")
 * @response 200 { ok: true, mode: "prep" | "prompt", message: string, data: { scoresCreated, memoriesCreated, callTargetsCreated, agentMeasurements, ... }, prompt?: object, logs: LogEntry[], duration: number }
 * @response 400 { ok: false, error: "callerId is required" | "mode must be 'prep' or 'prompt'", logs: LogEntry[] }
 * @response 404 { ok: false, error: "Call not found", logs: LogEntry[] }
 * @response 500 { ok: false, error: string, logs: LogEntry[], duration: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { MemoryCategory } from "@prisma/client";
import { AIEngine, isEngineAvailable } from "@/lib/ai/client";
import { classifyAIError, userMessageForError } from "@/lib/ai/error-utils";
import { getConfiguredMeteredAICompletion, logMockAIUsage } from "@/lib/metering";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { runAggregateSpecs } from "@/lib/pipeline/aggregate-runner";
import { aggregateCallerMemorySummary } from "@/lib/ops/memory-extract";
import { runAdaptSpecs as runRuleBasedAdapt } from "@/lib/pipeline/adapt-runner";
import { validateSpecDependencies } from "@/lib/pipeline/validate-dependencies";
import { trackGoalProgress, applyAssessmentAdaptation } from "@/lib/goals/track-progress";
import { evaluateCheckpoints } from "@/lib/assessment/checkpoint-evaluator";
import { extractGoals, extractGoalCompletionSignals } from "@/lib/goals/extract-goals";
import { extractArtifacts } from "@/lib/artifacts/extract-artifacts";
import { deliverArtifacts } from "@/lib/artifacts/deliver-artifacts";
import { extractActions } from "@/lib/actions/extract-actions";
import { config as appConfig } from "@/lib/config";
import { updateCurriculumProgress, getCurriculumProgress, completeModule, updateTpMasteryBatch } from "@/lib/curriculum/track-progress";
// initializeLessonPlanSession removed — scheduler replaces session tracking
import { resolvePlaybookId } from "@/lib/enrollment/resolve-playbook";
import { ContractRegistry } from "@/lib/contracts/registry";
import { loadPipelineStages, PipelineStage } from "@/lib/pipeline/config";

import { TRAITS } from "@/lib/registry";
import { recoverBrokenJson } from "@/lib/utils/json-recovery";
import { executeComposition, persistComposedPrompt, loadComposeConfig } from "@/lib/prompt/composition";
import { renderPromptSummary } from "@/lib/prompt/composition/renderPromptSummary";
import { getAudienceOption, type AudienceId } from "@/lib/prompt/composition/transforms/audience";
import { getPipelineGates, getAITimeoutSettings } from "@/lib/system-settings";
import { logAI } from "@/lib/logger";
import { createLogger, type PipelineLogger } from "@/lib/pipeline/logger";
import { mapToMemoryCategory } from "@/lib/pipeline/memory";
import { loadGuardrails, type GuardrailsConfig } from "@/lib/pipeline/guardrails";
import { shouldRunCallerAnalysis } from "@/lib/pipeline/event-gate";
import { getTranscriptLimit, getSystemSpecs, getSpecsByOutputType, getPlaybookSpecs, batchLoadParameters, resolveCallerTeachingProfile, filterByTeachingProfile } from "@/lib/pipeline/specs-loader";
import type { SpecConfig } from "@/lib/types/json-fields";

/**
 * Build a BATCHED prompt for all MEASURE + LEARN specs
 * This scores all caller parameters AND extracts memories in ONE AI call
 */
/**
 * Load current module context for learning assessment.
 * Tries CONTENT spec path first, then falls back to Subject curriculum.
 */
async function loadCurrentModuleContext(
  callerId: string,
  log: PipelineLogger,
  opts?: {
    /**
     * #242 Slice 2: explicit module pick from the picker, persisted on
     * Call.requestedModuleId. When provided AND found in
     * Playbook.config.modules, we build a moduleContext from it directly
     * rather than running the scheduler — guarantees mastery is emitted
     * against the learner's choice.
     */
    requestedModuleId?: string | null;
    /**
     * Fallback playbookId from the call record itself, used when the caller
     * has no CallerPlaybook enrollment (common for SIM testers). Must NOT
     * shadow a real enrollment.
     */
    callPlaybookId?: string | null;
  }
): Promise<{
  specSlug: string;
  moduleId: string;
  moduleName: string;
  learningOutcomes: string[];
  masteryThreshold: number;
  allModuleIds: string[];
} | null> {
  // Resolve the caller's actual enrolment (CallerPlaybook) first.
  // Fall back to the call's own playbookId for SIM testers without
  // an explicit CallerPlaybook row.
  let resolvedPlaybookId = await resolvePlaybookId(callerId);
  if (!resolvedPlaybookId && opts?.callPlaybookId) {
    log.info("No enrollment; using call.playbookId as fallback", {
      callPlaybookId: opts.callPlaybookId,
    });
    resolvedPlaybookId = opts.callPlaybookId;
  }
  if (!resolvedPlaybookId) return null;

  // Single fetch for the resolved playbook — shared between Path 0 (picker
  // override) and Path 0.5 (authored fallback). Both read Playbook.config.modules.
  const pb = await prisma.playbook.findUnique({
    where: { id: resolvedPlaybookId },
    select: {
      name: true,
      config: true,
      curricula: {
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { id: true, slug: true },
      },
    },
  });
  const cfg = (pb?.config ?? {}) as Record<string, any>;
  const authored: any[] = Array.isArray(cfg.modules) ? cfg.modules : [];
  const knownOutcomes: Record<string, string> =
    cfg.outcomes && typeof cfg.outcomes === "object" && !Array.isArray(cfg.outcomes)
      ? (cfg.outcomes as Record<string, string>)
      : {};
  const fallbackSpecSlug = `playbook-${resolvedPlaybookId.slice(0, 8)}-modules`;

  function buildAuthoredModuleContext(
    chosen: any,
    source: "picker" | "prev-call" | "first-incomplete" | "first-authored",
  ) {
    const rawRefs: string[] = Array.isArray(chosen?.outcomesPrimary) ? chosen.outcomesPrimary : [];
    const validRefs = Object.keys(knownOutcomes).length > 0
      ? rawRefs.filter((ref) => ref in knownOutcomes)
      : rawRefs;
    const dropped = rawRefs.length - validRefs.length;
    if (dropped > 0) {
      log.warn(`Authored module ${chosen.id}: dropped ${dropped} unknown outcome ref(s) — not present in Playbook.config.outcomes`);
    }
    const specSlug = pb?.curricula[0]?.slug ?? fallbackSpecSlug;
    log.info(`Module context from authored modules (${source})`, {
      moduleId: chosen.id,
      specSlug,
      loCount: validRefs.length,
      droppedRefs: dropped,
    });
    return {
      specSlug,
      moduleId: chosen.id,
      moduleName: chosen.label || chosen.id,
      learningOutcomes: validRefs,
      masteryThreshold: 0.7,
      allModuleIds: authored.map((m: any) => m?.id).filter(Boolean),
    };
  }

  // ── #242 Slice 2: requestedModuleId override ──
  // When the learner picked a module via the picker, build the moduleContext
  // directly from Playbook.config.modules (the authored shape). The override
  // bypasses the scheduler so mastery fires against the learner's choice
  // even if scheduler logic would have selected a different module.
  if (opts?.requestedModuleId) {
    const match = authored.find((m: any) => m?.id === opts.requestedModuleId);
    if (match) {
      return buildAuthoredModuleContext(match, "picker");
    }
    log.warn("requestedModuleId not found in Playbook.config.modules — falling back to scheduler", {
      requestedModuleId: opts.requestedModuleId,
      playbookId: resolvedPlaybookId,
    });
  }

  // ── #284 Path 0.5: authored modules without picker ──
  // Free-form sim/voice calls on authored courses (modulesAuthored=true,
  // no requestedModuleId) need a module context too — otherwise mastery
  // never writes for the dominant non-picker flow. Selection priority:
  //   1. Previous call's curriculumModuleId (continuous-mode anchor — keep
  //      learner on the same module across consecutive calls until completed).
  //   2. First non-completed authored module by `position` / array order.
  //   3. Last resort: first authored module.
  if (!opts?.requestedModuleId && cfg.modulesAuthored === true && authored.length > 0) {
    const curriculumId = pb?.curricula[0]?.id ?? null;
    let chosen: any = null;
    let source: "prev-call" | "first-incomplete" | "first-authored" = "first-incomplete";

    if (curriculumId) {
      const prevCall = await prisma.call.findFirst({
        where: { callerId, curriculumModuleId: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { curriculumModuleId: true },
      });
      if (prevCall?.curriculumModuleId) {
        const prevMod = await prisma.curriculumModule.findUnique({
          where: { id: prevCall.curriculumModuleId },
          select: { slug: true, curriculumId: true },
        });
        if (prevMod && prevMod.curriculumId === curriculumId) {
          const match = authored.find((m: any) => m?.id === prevMod.slug);
          // Only resume on the same module if it isn't already complete.
          if (match) {
            const completed = await prisma.callerModuleProgress.findFirst({
              where: { callerId, moduleId: prevCall.curriculumModuleId, status: "COMPLETED" },
              select: { id: true },
            });
            if (!completed) {
              chosen = match;
              source = "prev-call";
            }
          }
        }
      }

      if (!chosen) {
        const completedRows = await prisma.callerModuleProgress.findMany({
          where: { callerId, status: "COMPLETED", module: { curriculumId } },
          select: { module: { select: { slug: true } } },
        });
        const completedSlugs = new Set(completedRows.map((r) => r.module.slug));
        const ordered = [...authored].sort(
          (a: any, b: any) => (a?.position ?? 0) - (b?.position ?? 0),
        );
        chosen = ordered.find((m: any) => m?.id && !completedSlugs.has(m.id)) ?? null;
        source = "first-incomplete";
      }
    }

    if (!chosen) {
      chosen = authored[0];
      source = "first-authored";
    }

    if (chosen?.id) {
      return buildAuthoredModuleContext(chosen, source);
    }
  }

  // Path 1: CONTENT spec via the caller's enrolled playbook
  const playbook = await prisma.playbook.findUnique({
    where: { id: resolvedPlaybookId },
    select: {
      items: {
        where: {
          itemType: "SPEC",
          isEnabled: true,
          spec: { specRole: "CONTENT", isActive: true },
        },
        select: {
          spec: { select: { slug: true, config: true } },
        },
      },
    },
  });

  if (playbook?.items?.length) {
    for (const item of playbook.items) {
      const spec = item.spec;
      if (!spec) continue;
      const specConfig = spec.config as Record<string, any> | null;
      if (!specConfig) continue;

      const modules = specConfig.modules || specConfig.curriculum?.modules || [];
      if (modules.length === 0) continue;

      const progress = await getCurriculumProgress(callerId, spec.slug);
      const currentModuleId = progress.currentModuleId || modules[0]?.id || modules[0]?.slug;
      const currentModule = modules.find((m: any) => (m.id || m.slug) === currentModuleId) || modules[0];

      if (currentModule) {
        return {
          specSlug: spec.slug,
          moduleId: currentModule.id || currentModule.slug,
          moduleName: currentModule.name || currentModule.title || currentModule.id,
          learningOutcomes: currentModule.learningOutcomes || [],
          masteryThreshold: specConfig.metadata?.curriculum?.masteryThreshold ?? 0.7,
          allModuleIds: modules.map((m: any) => m.id || m.slug),
        };
      }
    }
  }

  // Path 2: Playbook curriculum (direct link via playbookId)
  if (resolvedPlaybookId) {
    const pbCurriculum = await prisma.curriculum.findFirst({
      where: { playbookId: resolvedPlaybookId },
      orderBy: { updatedAt: "desc" },
      select: { slug: true, notableInfo: true },
    });
    if (pbCurriculum?.notableInfo) {
      const rawModules = (pbCurriculum.notableInfo as Record<string, any>)?.modules;
      if (Array.isArray(rawModules) && rawModules.length > 0) {
        const progress = await getCurriculumProgress(callerId, pbCurriculum.slug);
        const currentModuleId = progress.currentModuleId || rawModules[0]?.id;
        const currentModule = rawModules.find((m: any) => m.id === currentModuleId) || rawModules[0];
        if (currentModule) {
          return {
            specSlug: pbCurriculum.slug,
            moduleId: currentModule.id,
            moduleName: currentModule.name || currentModule.title || currentModule.id,
            learningOutcomes: currentModule.learningOutcomes || [],
            masteryThreshold: 0.7,
            allModuleIds: rawModules.map((m: any) => m.id),
          };
        }
      }
    }
  }

  // Path 3: Domain-wide Subject curriculum fallback (legacy)
  const subjectDomains = await prisma.subjectDomain.findMany({
    where: { domainId: caller.domainId },
    include: {
      subject: {
        include: {
          curricula: {
            orderBy: { updatedAt: "desc" },
            take: 1,
            select: {
              slug: true,
              notableInfo: true,
            },
          },
        },
      },
    },
  });

  for (const sd of subjectDomains) {
    const curriculum = sd.subject.curricula[0];
    if (!curriculum?.notableInfo) continue;

    const rawModules = (curriculum.notableInfo as Record<string, any>)?.modules;
    if (!Array.isArray(rawModules) || rawModules.length === 0) continue;

    const progress = await getCurriculumProgress(callerId, curriculum.slug);
    const currentModuleId = progress.currentModuleId || rawModules[0]?.id;
    const currentModule = rawModules.find((m: any) => m.id === currentModuleId) || rawModules[0];

    if (currentModule) {
      log.info(`Module context from Subject curriculum`, {
        specSlug: curriculum.slug,
        moduleId: currentModule.id,
        loCount: (currentModule.learningOutcomes || []).length,
      });
      return {
        specSlug: curriculum.slug,
        moduleId: currentModule.id,
        moduleName: currentModule.title || currentModule.name || currentModule.id,
        learningOutcomes: currentModule.learningOutcomes || [],
        masteryThreshold: (await ContractRegistry.getThresholds('CURRICULUM_PROGRESS_V1'))?.masteryComplete ?? 0.7,
        allModuleIds: rawModules.map((m: any) => m.id),
      };
    }
  }

  return null;
}

function buildBatchedCallerPrompt(
  transcript: string,
  measureParams: Array<{ parameterId: string; name: string; definition: string | null }>,
  learnActions: Array<{ category: string; keyPrefix: string; keyHint: string; description: string }>,
  transcriptLimit: number = 4000,
  moduleContext?: { moduleId: string; moduleName: string; learningOutcomes: string[] } | null,
  assessmentPromptInstructions?: string | null,
): string {
  const paramList = measureParams.map(p => `${p.parameterId}:${p.name}`).join("|");
  const learnList = learnActions.map(a => {
    const keys = a.keyHint || `${a.keyPrefix}item`;
    return `- ${a.category}: ${a.description}. Use keys like: ${keys}`;
  }).join("\n");

  let learningSection = "";
  let learningJsonHint = "";
  if (moduleContext?.learningOutcomes?.length) {
    const loList = moduleContext.learningOutcomes.map((lo, i) => `LO${i + 1}:${lo}`).join("|");
    const instructions = assessmentPromptInstructions
      || "Score caller's demonstrated understanding of each outcome 0-1 (0=no evidence, 0.5=partial, 1=full mastery).";
    learningSection = `\n\nLEARNING OUTCOMES TO ASSESS (module "${moduleContext.moduleName}"):\n${loList}\n${instructions}`;
    learningJsonHint = `,"learning":{"moduleId":"${moduleContext.moduleId}","outcomes":{"LO1":0.6},"overallMastery":0.7}`;
  }

  return `Analyze transcript. Score caller 0-1 on params, extract ALL personal facts.

TRANSCRIPT (analyze this — read the ENTIRE transcript including the end):
${transcript.slice(0, transcriptLimit)}

PARAMS TO SCORE: ${paramList}

FACTS TO EXTRACT (use the suggested keys, extract EVERY fact mentioned including names, pets, family, preferences):
${learnList}${learningSection}

Return compact JSON:
{"scores":{"PARAM-ID":{"s":0.75,"c":0.8},...},"memories":[{"cat":"RELATIONSHIP","key":"family_pet","val":"dog called Fred","c":0.9,"e":"my dog is called Fred"},...]${learningJsonHint}}`;
}

/**
 * Build a BATCHED prompt for MEASURE specs
 * This scores all behaviour parameters in ONE AI call
 */
function buildBatchedAgentPrompt(
  transcript: string,
  agentParams: Array<{ parameterId: string; name: string; definition: string | null }>,
  transcriptLimit: number = 4000
): string {
  const paramList = agentParams.map(p => `${p.parameterId}:${p.name}`).join("|");

  return `Score AGENT behavior 0-1 (0=poor, 1=excellent).

TRANSCRIPT:
${transcript.slice(0, transcriptLimit)}

BEHAVIORS: ${paramList}

Return compact JSON:
{"scores":{"PARAM-ID":{"s":0.75,"c":0.8},...}}`;
}

/**
 * Run batched caller analysis (MEASURE + LEARN)
 */
async function runBatchedCallerAnalysis(
  call: {
    id: string;
    transcript: string | null;
    playbookId?: string | null;
    requestedModuleId?: string | null;
  },
  callerId: string,
  engine: AIEngine,
  log: PipelineLogger,
  userName?: string,
  opts?: { skipMeasure?: boolean },
): Promise<{
  scoresCreated: number;
  memoriesCreated: number;
  playbookUsed: string | null;
  learningAssessment: {
    specSlug: string;
    moduleId: string;
    overallMastery: number;
    outcomes: Record<string, number>;
    masteryThreshold: number;
    allModuleIds: string[];
  } | null;
}> {
  const transcript = call.transcript || "";
  // #155 (follow-up fix) — when the event-gate blocks scoring, we still run the
  // batched call for LEARN specs (memories + artifacts) so Bella the dog still
  // ends up on the caller page. Previously the entire function was skipped when
  // the gate blocked, silently dropping memory extraction on every teach-mode
  // call — a latent bug from Slice 1 that only became visible when #155 started
  // firing real scheduler decisions. `skipMeasure` forces the LLM to see an
  // empty MEASURE workload and a null moduleContext, so it only returns
  // memories in its JSON response.
  const skipMeasure = opts?.skipMeasure === true;

  // Get DOMAIN specs from caller's domain playbook (or fallback to all active DOMAIN specs)
  // Need playbookId first to filter system specs
  const { specs: playbookSpecs, playbookId, playbookName, fallback } = await getPlaybookSpecs(
    callerId,
    ["MEASURE", "LEARN"],
    log
  );

  // Get SYSTEM specs filtered by playbook toggle settings
  const systemSpecs = await getSystemSpecs(["MEASURE", "LEARN"], playbookId, log);

  // Combine SYSTEM + DOMAIN specs (deduplicate by ID)
  const allSpecIds = new Set<string>();
  const combinedSpecs: Array<{ id: string; slug: string; outputType: string }> = [];

  for (const spec of [...systemSpecs, ...playbookSpecs]) {
    if (!allSpecIds.has(spec.id)) {
      allSpecIds.add(spec.id);
      combinedSpecs.push(spec);
    }
  }

  log.info(`Combined specs for caller analysis`, {
    systemCount: systemSpecs.length,
    playbookCount: playbookSpecs.length,
    totalUnique: combinedSpecs.length
  });

  // Filter profile-conditional specs (e.g. COMP-MEASURE-001 only runs for comprehension-led)
  const callerProfile = await resolveCallerTeachingProfile(callerId, log);
  const allMeasureIds = combinedSpecs.filter(s => s.outputType === "MEASURE").map(s => s.id);
  const allLearnIds = combinedSpecs.filter(s => s.outputType === "LEARN").map(s => s.id);
  const measureSpecIds = await filterByTeachingProfile(allMeasureIds, callerProfile, log);
  const learnSpecIds = await filterByTeachingProfile(allLearnIds, callerProfile, log);

  // Load full MEASURE specs with triggers/actions
  const measureSpecs = measureSpecIds.length > 0
    ? await prisma.analysisSpec.findMany({
        where: { id: { in: measureSpecIds } },
        include: { triggers: { include: { actions: true } } },
      })
    : [];

  // Load full LEARN specs with triggers/actions
  const learnSpecs = learnSpecIds.length > 0
    ? await prisma.analysisSpec.findMany({
        where: { id: { in: learnSpecIds } },
        include: { triggers: { include: { actions: true } } },
      })
    : [];

  if (fallback) {
    log.warn("Running in fallback mode - no playbook constraint");
  }

  // Collect unique parameters to score (batched lookup - O(1) instead of O(N))
  //
  // Spec-level scoring gate (#155 follow-up): MEASURE specs can declare
  // `config.scoringGate: "always"` to bypass the scheduler event-gate.
  // Personality/learning-style specs score on every call (they observe the
  // caller, not curriculum mastery). Curriculum-evidence specs remain gated
  // so teach-mode sessions don't produce false mastery scores (Boaz S1–S4).
  //
  // When skipMeasure is true we still include "always" specs — only the
  // gated specs are zeroed out.
  let paramMap: Map<string, { parameterId: string; name: string; definition: string | null }>;
  if (skipMeasure) {
    const alwaysSpecs = measureSpecs.filter(
      (s) => (s.config as SpecConfig)?.scoringGate === "always",
    );
    paramMap = alwaysSpecs.length > 0
      ? await batchLoadParameters(alwaysSpecs)
      : new Map();
    if (alwaysSpecs.length > 0) {
      log.info(`Event-gate: ${measureSpecs.length - alwaysSpecs.length} MEASURE specs gated, ${alwaysSpecs.length} always-on (${alwaysSpecs.map(s => s.slug).join(", ")})`);
    }
  } else {
    paramMap = await batchLoadParameters(measureSpecs);
  }

  // Collect LEARN actions
  const learnActions: Array<{ category: string; keyPrefix: string; keyHint: string; description: string }> = [];
  for (const spec of learnSpecs) {
    for (const trigger of spec.triggers) {
      for (const action of trigger.actions) {
        if (action.learnCategory) {
          learnActions.push({
            category: action.learnCategory,
            keyPrefix: action.learnKeyPrefix || "",
            keyHint: action.learnKeyHint || "",
            description: action.description,
          });
        }
      }
    }
  }

  const measureParams = Array.from(paramMap.values());

  // Check if LEARN-ASSESS-001 (or any spec with assessmentMode) is active.
  // #164: LEARN-ASSESS runs unconditionally. Retrieval practice injects questions
  // on every call (including teach-mode), and the learning-assessment path picks
  // up answers from the transcript. The event-gate (skipMeasure) only blocks
  // MEASURE parameter scoring, not curriculum mastery tracking.
  const assessmentSpec = learnSpecs.find(
    (s) => (s.config as SpecConfig)?.assessmentMode === "curriculum_mastery",
  );
  let moduleContext: Awaited<ReturnType<typeof loadCurrentModuleContext>> = null;

  if (assessmentSpec) {
    const assessConfig = assessmentSpec.config as Record<string, any>;
    try {
      moduleContext = await loadCurrentModuleContext(callerId, log, {
        requestedModuleId: call.requestedModuleId ?? null,
        callPlaybookId: call.playbookId ?? null,
      });
      if (moduleContext) {
        // Use mastery threshold from spec config (overrides default)
        moduleContext.masteryThreshold = assessConfig.masteryThreshold ?? moduleContext.masteryThreshold;
        log.info(`LEARN-ASSESS spec active (${assessmentSpec.slug}): module context loaded`, {
          specSlug: moduleContext.specSlug,
          moduleId: moduleContext.moduleId,
          loCount: moduleContext.learningOutcomes.length,
          threshold: moduleContext.masteryThreshold,
        });
      }
    } catch (err: any) {
      log.warn(`Failed to load module context (non-blocking): ${err.message}`);
    }
  }

  log.info(`Batched caller analysis`, {
    params: measureParams.length,
    learnActions: learnActions.length,
    assessmentSpec: assessmentSpec?.slug || null,
    hasModuleContext: !!moduleContext,
    skipMeasure,
  });

  if (measureParams.length === 0 && learnActions.length === 0 && !moduleContext) {
    log.warn("No MEASURE or LEARN specs found and no assessment spec active");
    return { scoresCreated: 0, memoriesCreated: 0, playbookUsed: playbookName, learningAssessment: null };
  }

  let scoresCreated = 0;
  let memoriesCreated = 0;
  let learningAssessment: {
    specSlug: string;
    moduleId: string;
    overallMastery: number;
    outcomes: Record<string, number>;
    masteryThreshold: number;
    allModuleIds: string[];
  } | null = null;

  if (engine === "mock") {
    // Mock: generate random scores and no memories
    for (const param of measureParams) {
      const score = 0.4 + Math.random() * 0.4;
      // Check if score already exists for this call+parameter
      const existing = await prisma.callScore.findFirst({
        where: { callId: call.id, parameterId: param.parameterId },
      });
      if (existing) {
        await prisma.callScore.update({
          where: { id: existing.id },
          data: {
            score,
            confidence: 0.7,
            evidence: ["Mock batched scoring"],
            scoredBy: "mock_batched_v1",
            scoredAt: new Date(),
          },
        });
      } else {
        await prisma.callScore.create({
          data: {
            callId: call.id,
            callerId,
            parameterId: param.parameterId,
            score,
            confidence: 0.7,
            evidence: ["Mock batched scoring"],
            scoredBy: "mock_batched_v1",
          },
        });
      }
      scoresCreated++;
    }
    // Log mock usage for visibility in metering dashboard
    logMockAIUsage({
      callId: call.id,
      callerId,
      sourceOp: "pipeline:extract",
      reason: "requested",
      metadata: { scoresCreated, paramsProcessed: measureParams.length },
    }).catch((e) => log.warn("Failed to log mock usage", { error: e.message }));
    log.info(`Mock caller analysis complete`, { scoresCreated });
  } else {
    // @ai-call pipeline.measure — Score caller parameters from transcript | config: /x/ai-config
    const transcriptLimit = await getTranscriptLimit("pipeline.measure");
    const timeouts = await getAITimeoutSettings();
    const assessPromptInstructions = assessmentSpec ? (assessmentSpec.config as SpecConfig)?.promptInstructions : null;
    const prompt = buildBatchedCallerPrompt(transcript, measureParams, learnActions, transcriptLimit, moduleContext, assessPromptInstructions);

    try {
      const result = await getConfiguredMeteredAICompletion({
        callPoint: "pipeline.measure",
        engineOverride: engine,
        messages: [
          { role: "system", content: "You are an expert behavioral analyst. Always respond with valid JSON." },
          { role: "user", content: prompt },
        ],
        maxTokens: Math.max(2048, (measureParams.length + learnActions.length) * 120),
        timeoutMs: timeouts.pipelineTimeoutMs,
      }, { callId: call.id, callerId, sourceOp: "pipeline:extract", userName });

      log.debug("AI caller analysis response", { model: result.model, tokens: result.usage });

      // Parse response with recovery for truncated LLM output
      const { parsed, recovered, fixesApplied } = recoverBrokenJson(result.content, "pipeline:extract");
      if (recovered) {
        log.info("EXTRACT JSON recovery applied", { fixesApplied });
      }

      // Store scores (handle both full and compact keys: score/s, confidence/c, reasoning/r)
      if (parsed.scores) {
        for (const [parameterId, scoreData] of Object.entries(parsed.scores as Record<string, any>)) {
          const score = Math.max(0, Math.min(1, scoreData.score ?? scoreData.s ?? 0.5));
          const confidence = Math.max(0, Math.min(1, scoreData.confidence ?? scoreData.c ?? 0.7));
          const reasoning: string | undefined = scoreData.reasoning ?? scoreData.r ?? undefined;

          // Check if score already exists for this call+parameter
          const existing = await prisma.callScore.findFirst({
            where: { callId: call.id, parameterId },
          });
          if (existing) {
            await prisma.callScore.update({
              where: { id: existing.id },
              data: {
                score,
                confidence,
                reasoning,
                evidence: ["AI batched analysis"],
                scoredBy: `${engine}_batched_v2`,
                scoredAt: new Date(),
              },
            });
          } else {
            await prisma.callScore.create({
              data: {
                callId: call.id,
                callerId,
                parameterId,
                score,
                confidence,
                reasoning,
                evidence: ["AI batched analysis"],
                scoredBy: `${engine}_batched_v2`,
              },
            });
          }
          scoresCreated++;
        }
      }

      // Store memories (handle both full and compact keys: category/cat, value/val, confidence/c)
      if (parsed.memories && Array.isArray(parsed.memories)) {
        for (const mem of parsed.memories) {
          const category = mem.category || mem.cat;
          const key = mem.key;
          const value = mem.value || mem.val;
          const confidence = mem.confidence ?? mem.c ?? 0.8;
          const evidence = mem.evidence || mem.e || "AI extraction";

          if (category && key && value) {
            const mappedCategory = mapToMemoryCategory(category);
            const memValue = String(value);

            // Dedup: check for existing active memory with same key+value (exact match)
            const exactMatch = await prisma.callerMemory.findFirst({
              where: { callerId, key, value: memValue, supersededById: null },
            });

            if (exactMatch) {
              // Identical — skip (update confidence if higher)
              if (confidence > exactMatch.confidence) {
                await prisma.callerMemory.update({
                  where: { id: exactMatch.id },
                  data: { confidence },
                });
              }
              continue;
            }

            // For single-value keys (bio_name, etc.), supersede the old entry.
            // For multi-value keys (family_pet, topic_interest), allow multiple.
            const MULTI_VALUE_PREFIXES = ["family_", "topic_", "event_", "history_"];
            const isMultiValue = MULTI_VALUE_PREFIXES.some(p => key.startsWith(p));

            const toSupersede = isMultiValue ? null : await prisma.callerMemory.findFirst({
              where: { callerId, key, supersededById: null },
            });

            const newMemory = await prisma.callerMemory.create({
              data: {
                callerId,
                callId: call.id,
                category: mappedCategory,
                key,
                value: memValue,
                evidence: String(evidence),
                confidence,
                extractedBy: `${engine}_batched_v2`,
              },
            });

            if (toSupersede) {
              await prisma.callerMemory.update({
                where: { id: toSupersede.id },
                data: { supersededById: newMemory.id },
              });
            }

            memoriesCreated++;
          }
        }
      }

      // Aggregate memory summary after extraction
      if (memoriesCreated > 0) {
        await aggregateCallerMemorySummary(callerId, false);
      }

      // Parse learning assessment from AI response
      if (parsed.learning && moduleContext) {
        const learning = parsed.learning;
        const overallMastery = Math.max(0, Math.min(1, learning.overallMastery ?? 0));
        const outcomes: Record<string, number> = {};
        if (learning.outcomes) {
          for (const [key, value] of Object.entries(learning.outcomes)) {
            outcomes[key] = Math.max(0, Math.min(1, Number(value) || 0));
          }
        }
        learningAssessment = {
          specSlug: moduleContext.specSlug,
          moduleId: learning.moduleId || moduleContext.moduleId,
          overallMastery,
          outcomes,
          masteryThreshold: moduleContext.masteryThreshold,
          allModuleIds: moduleContext.allModuleIds,
        };
        log.info(`Learning assessment parsed`, {
          moduleId: learningAssessment.moduleId,
          mastery: learningAssessment.overallMastery,
          outcomesScored: Object.keys(outcomes).length,
        });
      }

      log.info(`AI caller analysis complete`, { scoresCreated, memoriesCreated, hasLearning: !!learningAssessment });
    } catch (error: any) {
      log.error("AI caller analysis failed", { error: error.message });
      logAI("pipeline.measure:error", `Caller analysis for call ${call.id}`, error.message, {
        callId: call.id, callerId, sourceOp: "pipeline:extract",
      });
      throw error;
    }
  }

  return { scoresCreated, memoriesCreated, playbookUsed: playbookName, learningAssessment };
}

/**
 * Run batched agent analysis (MEASURE)
 */
async function runBatchedAgentAnalysis(
  call: { id: string; transcript: string | null },
  callerId: string,
  engine: AIEngine,
  log: PipelineLogger,
  userName?: string,
): Promise<{ measurementsCreated: number }> {
  const transcript = call.transcript || "";

  // Transcript length gate — skip or cap confidence for short transcripts
  const gates = await getPipelineGates();
  const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;

  if (wordCount < gates.minTranscriptWords) {
    log.info("Skipping agent scoring - transcript too short", {
      wordCount,
      min: gates.minTranscriptWords,
    });
    return { measurementsCreated: 0 };
  }

  const isShortTranscript = wordCount < gates.shortTranscriptThresholdWords;
  const confidenceCap = isShortTranscript ? gates.shortTranscriptConfidenceCap : 1.0;
  if (isShortTranscript) {
    log.info("Short transcript - capping confidence", { wordCount, cap: confidenceCap });
  }

  // Get DOMAIN MEASURE specs from caller's domain playbook (or fallback)
  // Need playbookId first to filter system specs
  const { specs: playbookSpecs, playbookId, fallback } = await getPlaybookSpecs(
    callerId,
    ["MEASURE"],
    log
  );

  // Get SYSTEM MEASURE specs filtered by playbook toggle settings
  const systemSpecs = await getSystemSpecs(["MEASURE"], playbookId, log);

  // Combine SYSTEM + DOMAIN specs (deduplicate by ID)
  const allSpecIds = new Set<string>();
  const combinedSpecs: Array<{ id: string; slug: string; outputType: string }> = [];

  for (const spec of [...systemSpecs, ...playbookSpecs]) {
    if (!allSpecIds.has(spec.id)) {
      allSpecIds.add(spec.id);
      combinedSpecs.push(spec);
    }
  }

  log.info(`Combined specs for agent analysis`, {
    systemCount: systemSpecs.length,
    playbookCount: playbookSpecs.length,
    totalUnique: combinedSpecs.length
  });

  const agentSpecIds = combinedSpecs.map(s => s.id);

  // Load full specs with triggers/actions
  const agentSpecs = agentSpecIds.length > 0
    ? await prisma.analysisSpec.findMany({
        where: { id: { in: agentSpecIds } },
        include: { triggers: { include: { actions: true } } },
      })
    : [];

  if (fallback) {
    log.debug("Agent analysis running in fallback mode");
  }

  // Collect unique agent parameters (batched lookup - O(1) instead of O(N))
  const paramMap = await batchLoadParameters(agentSpecs);

  const agentParams = Array.from(paramMap.values());
  log.info(`Batched agent analysis`, { params: agentParams.length });

  if (agentParams.length === 0) {
    log.warn("No MEASURE specs found");
    return { measurementsCreated: 0 };
  }

  let measurementsCreated = 0;

  if (engine === "mock") {
    // Mock scoring
    for (const param of agentParams) {
      const actualValue = 0.5 + Math.random() * 0.3;
      const existing = await prisma.behaviorMeasurement.findFirst({
        where: { callId: call.id, parameterId: param.parameterId },
      });

      if (existing) {
        await prisma.behaviorMeasurement.update({
          where: { id: existing.id },
          data: { actualValue, confidence: Math.min(0.75, confidenceCap), evidence: ["Mock batched"] },
        });
      } else {
        await prisma.behaviorMeasurement.create({
          data: { callId: call.id, parameterId: param.parameterId, actualValue, confidence: Math.min(0.75, confidenceCap), evidence: ["Mock batched"] },
        });
      }
      measurementsCreated++;
    }
    // Log mock usage for visibility in metering dashboard
    logMockAIUsage({
      callId: call.id,
      callerId,
      sourceOp: "pipeline:score_agent",
      reason: "requested",
      metadata: { measurementsCreated, paramsProcessed: agentParams.length },
    }).catch((e) => log.warn("Failed to log mock usage", { error: e.message }));
  } else {
    // @ai-call pipeline.score_agent — Evaluate agent behavior against targets | config: /x/ai-config
    const transcriptLimit = await getTranscriptLimit("pipeline.score_agent");
    const prompt = buildBatchedAgentPrompt(transcript, agentParams, transcriptLimit);

    try {
      // More tokens for agent analysis with many parameters
      // ~100 tokens per param (score + confidence + evidence array)
      // Add 25% buffer to prevent truncation
      const estimatedTokens = Math.max(2048, Math.ceil(agentParams.length * 150));

      const agentTimeouts = await getAITimeoutSettings();
      const result = await getConfiguredMeteredAICompletion({
        callPoint: "pipeline.score_agent",
        engineOverride: engine,
        messages: [
          { role: "system", content: "You are an expert at evaluating conversational AI behavior. Always respond with valid JSON. Keep evidence arrays brief (1-2 short quotes max per parameter)." },
          { role: "user", content: prompt },
        ],
        maxTokens: estimatedTokens,
        timeoutMs: agentTimeouts.pipelineTimeoutMs,
      }, { callId: call.id, callerId, sourceOp: "pipeline:score_agent", userName });

      log.debug("AI agent analysis response", { model: result.model, contentLength: result.content.length });

      // Parse response with recovery for truncated LLM output
      const { parsed, recovered: scoreRecovered, fixesApplied: scoreFixes } = recoverBrokenJson(result.content, "pipeline:score_agent");
      if (scoreRecovered) {
        log.info("SCORE_AGENT JSON recovery applied", { fixesApplied: scoreFixes });
      }

      if (parsed.scores) {
        for (const [parameterId, scoreData] of Object.entries(parsed.scores as Record<string, any>)) {
          // Handle both full and compact keys: score/s, confidence/c, evidence/e
          const actualValue = Math.max(0, Math.min(1, scoreData.score ?? scoreData.s ?? 0.5));
          const confidence = Math.max(0, Math.min(confidenceCap, scoreData.confidence ?? scoreData.c ?? 0.7));
          const rawEvidence = scoreData.evidence ?? scoreData.e;
          const evidence = Array.isArray(rawEvidence) ? rawEvidence : [rawEvidence || "AI analysis"];

          const existing = await prisma.behaviorMeasurement.findFirst({
            where: { callId: call.id, parameterId },
          });

          if (existing) {
            await prisma.behaviorMeasurement.update({
              where: { id: existing.id },
              data: { actualValue, confidence, evidence },
            });
          } else {
            await prisma.behaviorMeasurement.create({
              data: { callId: call.id, parameterId, actualValue, confidence, evidence },
            });
          }
          measurementsCreated++;
        }
      }

      log.info(`AI agent analysis complete`, { measurementsCreated });
    } catch (error: any) {
      log.error("AI agent analysis failed", { error: error.message });
      logAI("pipeline.score_agent:error", `Agent analysis for call ${call.id}`, error.message, {
        callId: call.id, callerId, sourceOp: "pipeline:score_agent",
      });
      throw error;
    }
  }

  return { measurementsCreated };
}

/**
 * Compute reward score
 *
 * When the caller has active assessment target goals, computes a goalProgressScore
 * (weighted average of goal progress * priority) and composites it with the behavior
 * score: overallScore = 0.8 * behaviorScore + 0.2 * goalProgressScore.
 * When no assessment targets exist, uses behavior score alone (backward compatible).
 */
async function computeReward(
  callId: string,
  log: PipelineLogger
): Promise<{ overallScore: number }> {
  const call = await prisma.call.findUnique({
    where: { id: callId },
    include: { behaviorMeasurements: true },
  });

  if (!call || call.behaviorMeasurements.length === 0) {
    log.warn("No behavior measurements for reward");
    return { overallScore: 0.5 };
  }

  // Load system targets
  const targets = await prisma.behaviorTarget.findMany({
    where: { scope: "SYSTEM" },
  });

  const diffs: any[] = [];
  for (const measurement of call.behaviorMeasurements) {
    const target = targets.find((t) => t.parameterId === measurement.parameterId);
    const targetValue = target?.targetValue ?? 0.5;
    const diff = Math.abs(measurement.actualValue - targetValue);
    diffs.push({ parameterId: measurement.parameterId, target: targetValue, actual: measurement.actualValue, diff });
  }

  const avgDiff = diffs.length > 0 ? diffs.reduce((sum, d) => sum + d.diff, 0) / diffs.length : 0;
  const behaviorScore = Math.max(0, 1 - avgDiff);

  // Compute goal progress reward for assessment targets
  let goalProgressScore: number | null = null;
  let overallScore = behaviorScore;

  const assessmentGoals = await prisma.goal.findMany({
    where: {
      callerId: call.callerId,
      isAssessmentTarget: true,
      status: { in: ["ACTIVE", "PAUSED"] },
    },
    select: { id: true, progress: true, priority: true },
  });

  if (assessmentGoals.length > 0) {
    // Weighted average of goal progress by priority
    const totalWeight = assessmentGoals.reduce((sum, g) => sum + (g.priority || 5), 0);
    goalProgressScore = assessmentGoals.reduce(
      (sum, g) => sum + g.progress * (g.priority || 5), 0
    ) / totalWeight;

    // Composite: 80% behavior + 20% goal progress
    overallScore = 0.8 * behaviorScore + 0.2 * goalProgressScore;
    log.info(`Goal progress reward`, { goalProgressScore, assessmentGoals: assessmentGoals.length });
  }

  // Store reward
  await prisma.rewardScore.upsert({
    where: { callId },
    create: { callId, overallScore, goalProgressScore, modelVersion: "batched_v1", parameterDiffs: diffs },
    update: { overallScore, goalProgressScore, parameterDiffs: diffs, scoredAt: new Date() },
  });

  log.info(`Reward computed`, { overallScore, behaviorScore, goalProgressScore, diffs: diffs.length });
  return { overallScore };
}

/**
 * Aggregate caller personality from call scores
 * Creates/updates PersonalityObservation for the call and CallerPersonality aggregate
 *
 * Loads configuration from system-personality-aggregate AnalysisSpec:
 * - traitMapping: Maps parameter IDs to personality field names
 * - halfLifeDays: Decay half-life for time-weighted averaging
 * - defaultConfidence: Default confidence for observations
 */
async function aggregatePersonality(
  callId: string,
  callerId: string,
  log: PipelineLogger
): Promise<{ observationCreated: boolean; profileUpdated: boolean }> {
  // Load AGGREGATE spec config
  const aggregateSpec = await prisma.analysisSpec.findFirst({
    where: {
      outputType: "AGGREGATE",
      isActive: true,
      scope: "SYSTEM",
    },
  });

  // Extract config with defaults
  const specConfig = (aggregateSpec?.config as SpecConfig) || {};
  const traitMapping: Record<string, string> = specConfig.traitMapping || {
    [TRAITS.B5_O]: "openness",
    [TRAITS.B5_C]: "conscientiousness",
    [TRAITS.B5_E]: "extraversion",
    [TRAITS.B5_A]: "agreeableness",
    [TRAITS.B5_N]: "neuroticism",
  };
  const halfLifeDays: number = specConfig.halfLifeDays || 30;
  const defaultConfidence: number = specConfig.defaultConfidence || 0.7;
  const defaultDecayFactor: number = specConfig.defaultDecayFactor || 1.0;

  log.debug("AGGREGATE spec config", {
    specSlug: aggregateSpec?.slug || "(defaults)",
    traitCount: Object.keys(traitMapping).length,
    halfLifeDays,
    defaultConfidence,
  });

  // Get scores for this specific call (to create PersonalityObservation)
  const callScores = await prisma.callScore.findMany({
    where: { callId },
    select: { parameterId: true, score: true, confidence: true },
  });

  if (callScores.length === 0) {
    log.warn("No call scores for personality observation");
    return { observationCreated: false, profileUpdated: false };
  }

  // Initialize trait scores for all mapped traits
  const traitScores: Record<string, number | null> = {};
  for (const traitName of Object.values(traitMapping)) {
    traitScores[traitName] = null;
  }

  let observationCreated = false;

  for (const score of callScores) {
    const traitName = traitMapping[score.parameterId];
    if (traitName) {
      traitScores[traitName] = score.score;
    }
  }

  // Check if any mapped trait scores were found
  const hasMappedScores = Object.values(traitScores).some((v) => v !== null);

  if (hasMappedScores) {
    // Create or update PersonalityObservation for this call
    const existing = await prisma.personalityObservation.findUnique({
      where: { callId },
    });

    if (existing) {
      await prisma.personalityObservation.update({
        where: { callId },
        data: {
          ...traitScores,
          confidence: defaultConfidence,
          observedAt: new Date(),
        },
      });
    } else {
      await prisma.personalityObservation.create({
        data: {
          callId,
          callerId,
          ...traitScores,
          observedAt: new Date(),
          confidence: defaultConfidence,
          decayFactor: defaultDecayFactor,
        },
      });
    }
    observationCreated = true;
    log.info("PersonalityObservation created/updated", { traitScores });
  }

  // Now aggregate all scores into CallerPersonality
  const allScores = await prisma.callScore.findMany({
    where: { callerId },
    include: { call: { select: { createdAt: true } } },
    orderBy: { scoredAt: "desc" },
  });

  if (allScores.length === 0) {
    return { observationCreated, profileUpdated: false };
  }

  // Group by parameter and compute weighted average with time decay
  const byParameter: Record<string, Array<{ score: number; confidence: number; date: Date }>> = {};

  for (const s of allScores) {
    if (!byParameter[s.parameterId]) {
      byParameter[s.parameterId] = [];
    }
    byParameter[s.parameterId].push({
      score: s.score,
      confidence: s.confidence,
      date: s.call?.createdAt || s.scoredAt,
    });
  }

  const now = new Date();
  const aggregatedValues: Record<string, number> = {};

  for (const [parameterId, paramScores] of Object.entries(byParameter)) {
    let weightedSum = 0;
    let totalWeight = 0;

    for (const ps of paramScores) {
      const ageMs = now.getTime() - ps.date.getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      const decayWeight = Math.exp((-Math.log(2) * ageDays) / halfLifeDays);
      const weight = decayWeight * ps.confidence;

      weightedSum += ps.score * weight;
      totalWeight += weight;
    }

    if (totalWeight > 0) {
      aggregatedValues[parameterId] = weightedSum / totalWeight;
    }
  }

  // Update CallerPersonality using trait mapping from spec
  // Build profile data dynamically from trait mapping
  const profileData: Record<string, any> = {
    lastAggregatedAt: now,
    observationsUsed: allScores.length,
    confidenceScore: defaultConfidence,
    decayHalfLife: halfLifeDays,
  };

  // Map aggregated values to personality fields using the spec's trait mapping
  for (const [parameterId, fieldName] of Object.entries(traitMapping)) {
    profileData[fieldName] = aggregatedValues[parameterId] ?? null;
  }

  await prisma.callerPersonality.upsert({
    where: { callerId },
    create: { callerId, ...profileData },
    update: profileData,
  });

  // Update CallerPersonalityProfile with ALL parameter values
  await prisma.callerPersonalityProfile.upsert({
    where: { callerId },
    create: {
      callerId,
      parameterValues: aggregatedValues,
      lastUpdatedAt: now,
    },
    update: {
      parameterValues: aggregatedValues,
      lastUpdatedAt: now,
    },
  });

  // Build log output for mapped traits
  const mappedTraits: Record<string, string | undefined> = {};
  for (const [parameterId, fieldName] of Object.entries(traitMapping)) {
    mappedTraits[fieldName] = aggregatedValues[parameterId]?.toFixed(2);
  }

  log.info("Personality aggregated", {
    scoresUsed: allScores.length,
    parametersAggregated: Object.keys(aggregatedValues).length,
    mappedTraits,
  });

  return { observationCreated, profileUpdated: true };
}

/**
 * Compute adapt (deltas from previous call)
 */
async function computeAdapt(
  callId: string,
  callerId: string,
  log: PipelineLogger
): Promise<{ deltasComputed: number }> {
  const currentCall = await prisma.call.findUnique({
    where: { id: callId },
    include: { scores: true },
  });

  if (!currentCall) {
    return { deltasComputed: 0 };
  }

  const previousCall = await prisma.call.findFirst({
    where: { callerId, createdAt: { lt: currentCall.createdAt } },
    orderBy: { createdAt: "desc" },
    include: { scores: true },
  });

  if (!previousCall) {
    log.info("First call for caller - no deltas");
    return { deltasComputed: 0 };
  }

  let deltasComputed = 0;
  for (const currentScore of currentCall.scores) {
    const previousScore = previousCall.scores.find((s) => s.parameterId === currentScore.parameterId);
    if (previousScore) {
      const delta = currentScore.score - previousScore.score;
      const deltaParameterId = `${currentScore.parameterId}-DELTA`;

      // Check if delta parameter exists
      const deltaParam = await prisma.parameter.findUnique({ where: { parameterId: deltaParameterId } });
      if (deltaParam) {
        const deltaScore = (delta + 1) / 2; // Normalize -1..1 to 0..1
        // Check if score already exists
        const existing = await prisma.callScore.findFirst({
          where: { callId, parameterId: deltaParameterId },
        });
        if (existing) {
          await prisma.callScore.update({
            where: { id: existing.id },
            data: { score: deltaScore, scoredAt: new Date() },
          });
        } else {
          await prisma.callScore.create({
            data: { callId, callerId, parameterId: deltaParameterId, score: deltaScore, confidence: 0.9, scoredBy: "adapt_v1" },
          });
        }
        deltasComputed++;
      }
    }
  }

  log.info(`Adapt computed`, { deltasComputed });
  return { deltasComputed };
}

// =====================================================
// ADAPT & SUPERVISE SPEC RUNNERS
// =====================================================

/**
 * Build prompt for ADAPT specs to compute personalized targets
 */
function buildAdaptPrompt(
  transcript: string,
  callScores: Array<{ parameterId: string; score: number; confidence: number }>,
  callerProfile: Record<string, any> | null,
  targetParams: Array<{ parameterId: string; name: string; definition: string | null }>,
  transcriptLimit: number = 2500,
  audienceContext?: { audience: string; ages: string; description: string } | null,
): string {
  const scoreList = callScores.map(s => `${s.parameterId}:${s.score.toFixed(2)}`).join("|");
  const paramList = targetParams.map(p => `${p.parameterId}:${p.name}`).join("|");
  const profileStr = callerProfile ? JSON.stringify(callerProfile).slice(0, 500) : "";

  const audienceBlock = audienceContext
    ? `\nAUDIENCE: ${audienceContext.audience} (age ${audienceContext.ages}) — ${audienceContext.description}\nSet targets appropriate for this age group. For younger audiences, keep challenge, complexity, and pace LOW. For BEH-CHALLENGE-LEVEL with primary school children, stay ≤0.4.`
    : "";

  return `Compute agent behavior targets (0-1) for next call based on caller profile.

TRANSCRIPT:
${transcript.slice(0, transcriptLimit)}

CALLER SCORES: ${scoreList}
${profileStr ? `PROFILE: ${profileStr}` : ""}${audienceBlock}

PARAMS: ${paramList}

Return compact JSON:
{"targets":{"PARAM-ID":{"v":0.65,"c":0.8},...}}`;
}

/**
 * Run ADAPT specs to compute personalized CallTargets
 * These specs compute what target values the agent should aim for based on caller profile
 */
async function runAdaptSpecs(
  call: { id: string; transcript: string | null; playbookId: string | null },
  callerId: string,
  engine: AIEngine,
  guardrails: GuardrailsConfig,
  log: PipelineLogger,
  userName?: string,
): Promise<{ targetsCreated: number }> {
  const callId = call.id;
  // Load ADAPT specs (by outputType, not specType)
  const adaptSpecs = await getSpecsByOutputType("ADAPT", log);

  if (adaptSpecs.length === 0) {
    log.info("No ADAPT specs configured - using defaults");
    return { targetsCreated: 0 };
  }

  // Load call scores for this call
  const callScores = await prisma.callScore.findMany({
    where: { callId },
    select: { parameterId: true, score: true, confidence: true },
  });

  // Load caller personality profile
  const callerProfile = await prisma.callerPersonalityProfile.findUnique({
    where: { callerId },
    select: { parameterValues: true },
  });

  // Load full ADAPT specs with triggers/actions to get target parameters
  const fullSpecs = await prisma.analysisSpec.findMany({
    where: { id: { in: adaptSpecs.map(s => s.id) } },
    include: { triggers: { include: { actions: true } } },
  });

  // Collect unique parameters that ADAPT specs compute targets for (batched lookup - O(1) instead of O(N))
  const paramMap = await batchLoadParameters(fullSpecs);

  const targetParams = Array.from(paramMap.values());
  log.info(`Running ADAPT specs`, { specCount: adaptSpecs.length, targetParams: targetParams.length });

  if (targetParams.length === 0) {
    log.warn("No target parameters found in ADAPT specs");
    return { targetsCreated: 0 };
  }

  let targetsCreated = 0;

  const { mockBehavior, confidenceBounds, aiSettings } = guardrails;

  if (engine === "mock") {
    // Mock: compute targets as slight adjustments from call scores
    // Using guardrails config for mock behavior
    const center = (mockBehavior.scoreRangeMin + mockBehavior.scoreRangeMax) / 2;

    for (const param of targetParams) {
      const callScore = callScores.find(s => s.parameterId === param.parameterId);
      // Target is based on caller score with some adjustment toward center
      const baseValue = callScore?.score ?? center;
      const targetValue = baseValue + (center - baseValue) * mockBehavior.nudgeFactor;

      await prisma.callTarget.upsert({
        where: { callId_parameterId: { callId, parameterId: param.parameterId } },
        create: {
          callId,
          parameterId: param.parameterId,
          targetValue,
          confidence: confidenceBounds.defaultConfidence,
          sourceSpecSlug: "mock_adapt",
          reasoning: `Mock adaptation (nudge ${mockBehavior.nudgeFactor} toward ${center})`,
        },
        update: {
          targetValue,
          confidence: confidenceBounds.defaultConfidence,
          sourceSpecSlug: "mock_adapt",
          reasoning: `Mock adaptation (nudge ${mockBehavior.nudgeFactor} toward ${center})`,
        },
      });
      targetsCreated++;
    }
    // Log mock usage for visibility in metering dashboard
    logMockAIUsage({
      callId,
      callerId,
      sourceOp: "pipeline:adapt",
      reason: "requested",
      metadata: { targetsCreated, paramsProcessed: targetParams.length },
    }).catch((e) => console.warn("[pipeline] Failed to log mock usage:", e.message));
  } else {
    // @ai-call pipeline.adapt — Compute personalized behavior targets | config: /x/ai-config
    const transcriptLimit = await getTranscriptLimit("pipeline.adapt");
    const adaptTimeouts = await getAITimeoutSettings();

    // Load audience context from the playbook so AI can reason about age-appropriateness
    let audienceContext: { audience: string; ages: string; description: string } | null = null;
    if (call.playbookId) {
      const pb = await prisma.playbook.findUnique({
        where: { id: call.playbookId },
        select: { config: true },
      });
      const pbConfig = pb?.config as Record<string, any> | null;
      const audienceId = (pbConfig?.audience as AudienceId) || null;
      if (audienceId) {
        const opt = getAudienceOption(audienceId);
        if (opt) {
          audienceContext = { audience: opt.id, ages: opt.ages, description: opt.description };
        }
      }
    }

    const prompt = buildAdaptPrompt(
      call.transcript || "",
      callScores,
      callerProfile?.parameterValues as Record<string, any> | null,
      targetParams,
      transcriptLimit,
      audienceContext,
    );

    try {
      const result = await getConfiguredMeteredAICompletion({
        callPoint: "pipeline.adapt",
        engineOverride: engine,
        messages: [
          { role: "system", content: "You are an expert at personalizing AI behaviour based on caller profiles. Always respond with valid JSON." },
          { role: "user", content: prompt },
        ],
        maxTokens: 1024,
        temperature: aiSettings.temperature,
        timeoutMs: adaptTimeouts.pipelineTimeoutMs,
      }, { callId, callerId, sourceOp: "pipeline:adapt", userName });

      // logAI now handled centrally by getConfiguredMeteredAICompletion

      // Parse response with recovery for truncated LLM output
      const { parsed, recovered: adaptRecovered, fixesApplied: adaptFixes } = recoverBrokenJson(result.content, "pipeline:adapt");
      if (adaptRecovered) {
        log.info("ADAPT JSON recovery applied", { fixesApplied: adaptFixes });
      }

      if (parsed.targets) {
        for (const [parameterId, targetData] of Object.entries(parsed.targets as Record<string, any>)) {
          // Handle both full and compact keys: value/v, confidence/c
          const targetValue = Math.max(0, Math.min(1, targetData.value ?? targetData.v ?? 0.5));
          const confidence = Math.max(0, Math.min(1, targetData.confidence ?? targetData.c ?? 0.7));

          await prisma.callTarget.upsert({
            where: { callId_parameterId: { callId, parameterId } },
            create: {
              callId,
              parameterId,
              targetValue,
              confidence,
              sourceSpecSlug: `${engine}_adapt`,
              reasoning: "AI-computed target",
            },
            update: {
              targetValue,
              confidence,
              sourceSpecSlug: `${engine}_adapt`,
              reasoning: "AI-computed target",
            },
          });
          targetsCreated++;
        }
      }

      log.info(`ADAPT specs complete`, { targetsCreated });
    } catch (error: any) {
      log.error("ADAPT specs failed", { error: error.message });
      logAI("pipeline.adapt:error", `Adapt specs for call ${callId}`, error.message, {
        callId, callerId, sourceOp: "pipeline:adapt",
      });
      throw error;
    }
  }

  return { targetsCreated };
}

/**
 * Audience-aware max bounds for specific parameters.
 * Falls back to guardrails.targetClamp.maxValue when no audience override exists.
 *
 * TODO: Move to GUARD-001 spec config so caps are admin-tunable, not hardcoded.
 */
const AUDIENCE_TARGET_CAPS: Record<string, Partial<Record<AudienceId, number>>> = {
  "BEH-CHALLENGE-LEVEL": {
    primary: 0.4,
    secondary: 0.6,
  },
};

/**
 * Validate/clamp targets to safe ranges using guardrails from SUPERVISE spec.
 * When an audience is provided, applies tighter per-parameter caps for age-appropriate behavior.
 */
async function validateTargets(
  callId: string,
  guardrails: GuardrailsConfig,
  log: PipelineLogger,
  audience?: AudienceId | null,
): Promise<{ adjustments: number }> {
  const targets = await prisma.callTarget.findMany({
    where: { callId },
  });

  if (targets.length === 0) {
    return { adjustments: 0 };
  }

  const { minValue, maxValue } = guardrails.targetClamp;

  // Clamp targets to safe range (avoid extremes), with audience-aware overrides
  let adjustments = 0;
  for (const target of targets) {
    let effectiveMax = maxValue;

    // Apply audience-specific cap if stricter than global max
    if (audience) {
      const paramCaps = AUDIENCE_TARGET_CAPS[target.parameterId];
      const audienceCap = paramCaps?.[audience];
      if (audienceCap !== undefined && audienceCap < effectiveMax) {
        effectiveMax = audienceCap;
      }
    }

    let newValue = target.targetValue;
    let adjusted = false;
    let clampLabel = `${minValue}-${effectiveMax}`;

    if (newValue < minValue) {
      newValue = minValue;
      adjusted = true;
    } else if (newValue > effectiveMax) {
      newValue = effectiveMax;
      adjusted = true;
      clampLabel = `${minValue}-${effectiveMax}` + (audience ? ` (audience:${audience})` : "");
    }

    if (adjusted) {
      await prisma.callTarget.update({
        where: { id: target.id },
        data: {
          targetValue: newValue,
          reasoning: `${target.reasoning || ""} [clamped to ${clampLabel}]`.trim(),
        },
      });
      adjustments++;
    }
  }

  log.info(`Targets validated`, { adjustments, clampRange: { minValue, maxValue }, audience: audience || "none" });
  return { adjustments };
}

/**
 * Aggregate CallTargets to CallerTargets (moving average for prompt composition)
 */
async function aggregateCallerTargets(
  callId: string,
  callerId: string,
  guardrails: GuardrailsConfig,
  log: PipelineLogger
): Promise<{ aggregated: number }> {
  // Get all CallTargets for this caller's calls
  const callerCalls = await prisma.call.findMany({
    where: { callerId },
    select: { id: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const callIds = callerCalls.map(c => c.id);

  // Get all CallTargets for these calls
  const allTargets = await prisma.callTarget.findMany({
    where: { callId: { in: callIds } },
    include: { call: { select: { createdAt: true } } },
  });

  if (allTargets.length === 0) {
    log.info("No CallTargets to aggregate");
    return { aggregated: 0 };
  }

  // Group by parameterId
  const byParameter: Record<string, Array<{ value: number; confidence: number; date: Date }>> = {};
  for (const target of allTargets) {
    if (!byParameter[target.parameterId]) {
      byParameter[target.parameterId] = [];
    }
    byParameter[target.parameterId].push({
      value: target.targetValue,
      confidence: target.confidence,
      date: target.call?.createdAt || target.createdAt,
    });
  }

  // Use aggregation settings from guardrails
  const { decayHalfLifeDays, confidenceGrowthBase, confidenceGrowthPerCall, maxAggregatedConfidence } = guardrails.aggregation;
  const now = new Date();
  let aggregated = 0;

  for (const [parameterId, targets] of Object.entries(byParameter)) {
    let weightedSum = 0;
    let totalWeight = 0;

    for (const t of targets) {
      const ageMs = now.getTime() - t.date.getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      const decayWeight = Math.exp((-Math.log(2) * ageDays) / decayHalfLifeDays);
      const weight = decayWeight * t.confidence;

      weightedSum += t.value * weight;
      totalWeight += weight;
    }

    if (totalWeight > 0) {
      const avgValue = weightedSum / totalWeight;

      // Confidence grows with more data: base + (calls * growthPerCall), capped at max
      const computedConfidence = Math.min(
        maxAggregatedConfidence,
        confidenceGrowthBase + targets.length * confidenceGrowthPerCall
      );

      await prisma.callerTarget.upsert({
        where: { callerId_parameterId: { callerId, parameterId } },
        create: {
          callerId,
          parameterId,
          targetValue: avgValue,
          confidence: computedConfidence,
          callsUsed: targets.length,
          lastUpdatedAt: now,
          decayHalfLife: decayHalfLifeDays,
        },
        update: {
          targetValue: avgValue,
          confidence: computedConfidence,
          callsUsed: targets.length,
          lastUpdatedAt: now,
        },
      });
      aggregated++;
    }
  }

  log.info(`CallerTargets aggregated`, { aggregated, totalCallTargets: allTargets.length });
  return { aggregated };
}

// =====================================================
// CURRICULUM PROGRESS TRACKING
// =====================================================

/**
 * Update curriculum progress after a call completes.
 * Finds CONTENT specs with curriculum modules via the caller's published playbook,
 * updates lastAccessedAt, and assigns Module 1 if this is the first curriculum call.
 */
async function trackCurriculumAfterCall(
  callerId: string,
  log: PipelineLogger,
  learningAssessment?: {
    specSlug: string;
    moduleId: string;
    overallMastery: number;
    outcomes: Record<string, number>;
    masteryThreshold: number;
    allModuleIds: string[];
  } | null,
): Promise<boolean> {
  // If we have a learning assessment, write mastery and potentially advance
  if (learningAssessment) {
    const { specSlug, moduleId, overallMastery, outcomes, masteryThreshold, allModuleIds } = learningAssessment;

    try {
      // Write mastery score for this module + per-LO outcomes
      await updateCurriculumProgress(callerId, specSlug, {
        moduleMastery: { [moduleId]: overallMastery },
        loMastery: Object.keys(outcomes).length > 0 ? { moduleId, outcomes } : undefined,
        lastAccessedAt: new Date(),
      });
      log.info(`Mastery written for ${specSlug}:${moduleId}`, { mastery: overallMastery, threshold: masteryThreshold, loCount: Object.keys(outcomes).length });

      // Check if mastery meets threshold → advance to next module
      if (overallMastery >= masteryThreshold) {
        const currentIdx = allModuleIds.indexOf(moduleId);
        const nextModuleId = currentIdx >= 0 && currentIdx + 1 < allModuleIds.length
          ? allModuleIds[currentIdx + 1]
          : undefined;

        await completeModule(callerId, specSlug, moduleId, nextModuleId);
        log.info(`Module completed: ${moduleId}`, {
          nextModule: nextModuleId || "(curriculum complete)",
          mastery: overallMastery,
        });
      }

      return true;
    } catch (err: any) {
      log.warn(`Learning assessment write failed for ${specSlug}: ${err.message}`);
    }
  }

  // Fallback: no learning assessment — still assign first module if needed.
  // Resolve the caller's actual enrolment rather than picking a random
  // playbook in the domain.
  const resolvedPlaybookId = await resolvePlaybookId(callerId);
  if (!resolvedPlaybookId) return false;

  // Try CONTENT spec path on the caller's enrolled playbook
  const playbook = await prisma.playbook.findUnique({
    where: { id: resolvedPlaybookId },
    select: {
      items: {
        where: {
          itemType: "SPEC",
          isEnabled: true,
          spec: { specRole: "CONTENT", isActive: true },
        },
        select: {
          spec: { select: { slug: true, config: true } },
        },
      },
    },
  });

  let updated = false;

  if (playbook?.items?.length) {
    for (const item of playbook.items) {
      const spec = item.spec;
      if (!spec) continue;

      const specConfig = spec.config as Record<string, any> | null;
      if (!specConfig) continue;

      const modules = specConfig.modules || specConfig.curriculum?.modules || [];
      if (modules.length === 0 && !specConfig.metadata?.curriculum) continue;

      try {
        const progress = await getCurriculumProgress(callerId, spec.slug);
        if (!progress.currentModuleId && modules.length > 0) {
          const firstModule = modules[0];
          await updateCurriculumProgress(callerId, spec.slug, {
            currentModuleId: firstModule.id || firstModule.slug,
            lastAccessedAt: new Date(),
          });
          log.info(`Assigned caller to first module of ${spec.slug}`, {
            moduleId: firstModule.id || firstModule.slug,
          });
          updated = true;
        } else {
          await updateCurriculumProgress(callerId, spec.slug, { lastAccessedAt: new Date() });
          updated = true;
        }
      } catch (err: any) {
        log.warn(`Curriculum progress update failed for ${spec.slug}: ${err.message}`);
      }
    }
  }

  // Playbook curriculum — assign first module (direct link)
  if (!updated) {
    try {
      const enrolledPbId = await resolvePlaybookId(callerId);
      if (enrolledPbId) {
        const pbCurr = await prisma.curriculum.findFirst({
          where: { playbookId: enrolledPbId },
          orderBy: { updatedAt: "desc" },
          select: { slug: true, notableInfo: true },
        });
        if (pbCurr?.notableInfo) {
          const rawMods = (pbCurr.notableInfo as Record<string, any>)?.modules;
          if (Array.isArray(rawMods) && rawMods.length > 0) {
            const prog = await getCurriculumProgress(callerId, pbCurr.slug);
            if (!prog.currentModuleId) {
              await updateCurriculumProgress(callerId, pbCurr.slug, {
                currentModuleId: rawMods[0].id,
                lastAccessedAt: new Date(),
              });
              log.info(`Assigned caller to first module of Playbook curriculum ${pbCurr.slug}`, { moduleId: rawMods[0].id });
            } else {
              await updateCurriculumProgress(callerId, pbCurr.slug, { lastAccessedAt: new Date() });
            }
            updated = true;
          }
        }
      }
    } catch (err: any) {
      log.warn(`Playbook curriculum progress update failed: ${err.message}`);
    }
  }

  // Subject curriculum fallback — assign first module if no CONTENT spec found (legacy)
  if (!updated) {
    try {
      const subjectDomains = await prisma.subjectDomain.findMany({
        where: { domainId: caller.domainId },
        include: {
          subject: {
            include: {
              curricula: {
                orderBy: { updatedAt: "desc" },
                take: 1,
                select: { slug: true, notableInfo: true },
              },
            },
          },
        },
      });

      for (const sd of subjectDomains) {
        const curriculum = sd.subject.curricula[0];
        if (!curriculum?.notableInfo) continue;

        const rawModules = (curriculum.notableInfo as Record<string, any>)?.modules;
        if (!Array.isArray(rawModules) || rawModules.length === 0) continue;

        const progress = await getCurriculumProgress(callerId, curriculum.slug);
        if (!progress.currentModuleId) {
          await updateCurriculumProgress(callerId, curriculum.slug, {
            currentModuleId: rawModules[0].id,
            lastAccessedAt: new Date(),
          });
          log.info(`Assigned caller to first module of Subject curriculum ${curriculum.slug}`, {
            moduleId: rawModules[0].id,
          });
          updated = true;
        } else {
          await updateCurriculumProgress(callerId, curriculum.slug, { lastAccessedAt: new Date() });
          updated = true;
        }
        break; // Only process first curriculum
      }
    } catch (err: any) {
      log.warn(`Subject curriculum fallback failed: ${err.message}`);
    }
  }

  return updated;
}

/**
 * Track onboarding completion after first call.
 * Marks OnboardingSession as complete and initializes lesson plan session tracking.
 */
async function trackOnboardingAfterCall(
  callerId: string,
  callId: string,
  log: PipelineLogger,
): Promise<boolean> {
  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { domainId: true },
  });
  if (!caller?.domainId) return false;

  // Check if onboarding session exists and is incomplete
  const onboardingSession = await prisma.onboardingSession.findUnique({
    where: { callerId_domainId: { callerId, domainId: caller.domainId } },
  });

  if (!onboardingSession || onboardingSession.isComplete) return false;

  // Only complete onboarding on first call in this domain
  const callCount = await prisma.call.count({
    where: { callerId, caller: { domainId: caller.domainId } },
  });
  if (callCount !== 1) return false;

  // Mark onboarding complete
  await prisma.onboardingSession.update({
    where: { id: onboardingSession.id },
    data: {
      isComplete: true,
      completedAt: new Date(),
      firstCallId: callId,
    },
  });
  log.info("Onboarding completed", { callerId, domainId: caller.domainId });

  return true;
}

/**
 * Update per-TP mastery scores after a call.
 * Resolves LO assessment outcomes → individual TP mastery via FK chain.
 * Session advancement removed — scheduler owns pacing.
 */
async function updateTpMasteryAfterCall(
  callerId: string,
  log: PipelineLogger,
  learningAssessment?: {
    specSlug: string;
    moduleId: string;
    overallMastery: number;
    outcomes?: Record<string, number>;
    masteryThreshold: number;
  } | null,
): Promise<boolean> {
  if (!learningAssessment?.outcomes) return false;

  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { domainId: true },
  });
  if (!caller?.domainId) return false;

  // Try playbook curriculum first (direct link)
  const enrolledPbForAssess = await resolvePlaybookId(callerId);
  if (enrolledPbForAssess) {
    const pbCurr = await prisma.curriculum.findFirst({
      where: { playbookId: enrolledPbForAssess },
      orderBy: { updatedAt: "desc" },
      select: { slug: true },
    });
    if (pbCurr) {
      const threshold = learningAssessment.masteryThreshold || 0.7;
      const assessedLoRefs = Object.keys(learningAssessment.outcomes);
      const loRows = await prisma.learningObjective.findMany({
        where: {
          ref: { in: assessedLoRefs },
          module: { curriculum: { slug: pbCurr.slug }, isActive: true },
        },
        select: { id: true, ref: true },
      });
      if (loRows.length > 0) {
        for (const lo of loRows) {
          const score = learningAssessment.outcomes[lo.ref];
          if (score !== undefined) {
            await prisma.callerAttribute.upsert({
              where: { callerId_key: { callerId, key: `curriculum:${pbCurr.slug}:lo:${lo.ref}` } },
              update: { value: String(score), updatedAt: new Date() },
              create: { callerId, key: `curriculum:${pbCurr.slug}:lo:${lo.ref}`, value: String(score) },
            });
          }
        }
        return true;
      }
    }
  }

  // Fallback: domain-wide Subject curriculum (legacy)
  const subjectDomains = await prisma.subjectDomain.findMany({
    where: { domainId: caller.domainId },
    include: {
      subject: {
        include: {
          curricula: {
            orderBy: { updatedAt: "desc" },
            take: 1,
            select: { slug: true },
          },
        },
      },
    },
  });

  for (const sd of subjectDomains) {
    const curriculum = sd.subject.curricula[0];
    if (!curriculum) continue;

    const threshold = learningAssessment.masteryThreshold || 0.7;

    // Resolve LO ref strings → IDs, then query assertions by FK
    const assessedLoRefs = Object.keys(learningAssessment.outcomes);
    const loRows = await prisma.learningObjective.findMany({
      where: {
        ref: { in: assessedLoRefs },
        module: { curriculum: { slug: curriculum.slug }, isActive: true },
      },
      select: { id: true, ref: true },
    });
    const assessedLoIds = loRows.map((lo) => lo.id);

    const assessedTps = assessedLoIds.length > 0
      ? await prisma.contentAssertion.findMany({
          where: { learningObjectiveId: { in: assessedLoIds } },
          select: { id: true, learningObjectiveId: true },
        })
      : [];

    const loIdToRef = new Map(loRows.map((lo) => [lo.id, lo.ref]));

    const updates: Record<string, { mastery: number; status: "not_started" | "in_progress" | "mastered" }> = {};
    for (const tp of assessedTps) {
      const loRef = tp.learningObjectiveId ? loIdToRef.get(tp.learningObjectiveId) : null;
      const loScore = loRef ? learningAssessment.outcomes[loRef] ?? 0 : 0;
      updates[tp.id] = {
        mastery: loScore,
        status: loScore >= threshold ? "mastered" : loScore > 0 ? "in_progress" : "not_started",
      };
    }

    if (Object.keys(updates).length > 0) {
      await updateTpMasteryBatch(callerId, curriculum.slug, updates);
      log.info(`Updated ${Object.keys(updates).length} TP mastery scores`);
      return true;
    }

    break;
  }

  return false;
}

// =====================================================
// SPEC-DRIVEN PIPELINE EXECUTION
// =====================================================

/**
 * Pipeline execution context passed to all stage executors
 */
interface PipelineContext {
  callId: string;
  callerId: string;
  call: { id: string; transcript: string | null; playbookId: string | null; requestedModuleId: string | null };
  engine: AIEngine;
  guardrails: GuardrailsConfig;
  pipelineStages: PipelineStage[];
  mode: "prep" | "prompt";
  force: boolean;
  log: PipelineLogger;
  request: NextRequest;
  userName?: string;
  // Accumulated results from previous stages
  results: Record<string, any>;
}

/**
 * Stage executor function type
 */
type StageExecutor = (ctx: PipelineContext, stage: PipelineStage) => Promise<Record<string, any>>;

/**
 * Stage executor registry - maps stage names to executor functions
 * Each executor handles the specific logic for that stage
 */
const stageExecutors: Record<string, StageExecutor> = {
  // EXTRACT stage: Learn + Measure caller data (batched)
  EXTRACT: async (ctx, stage) => {
    ctx.log.info(`Stage ${stage.name}: ${stage.description}`);

    // Idempotency: skip AI call if scores already exist for this call
    if (!ctx.force) {
      const existingScores = await prisma.callScore.count({ where: { callId: ctx.callId } });
      if (existingScores > 0) {
        ctx.log.info(`EXTRACT skipped: ${existingScores} scores already exist for call ${ctx.callId} (use force=true to re-run)`);
        return { scoresCreated: 0, memoriesCreated: 0, skippedReason: "existing_scores" };
      }
    }

    // Scheduler v1 Slice 1 (#154) + follow-up (#155 smoke test) — event-gate
    // caller SCORING on prior mode, but always run memory/LEARN extraction.
    //
    // The gate reads the SchedulerDecision written by the previous call's
    // COMPOSE and decides whether this call's transcript counts as assessment
    // evidence. When it doesn't, caller-skill scoring is suppressed (fixes
    // Boaz S1–S4: COMP_VOCABULARY/RECALL/EVALUATION scored in teach sessions
    // where no question was asked). Memories, artifacts, and actions always
    // run — a caller volunteering "my dog is Bella" in a teach-mode call must
    // still land on the caller page. That's what `skipMeasure` on the batched
    // caller analysis enables: same function, zero params to score, full LEARN
    // path intact. Previously the whole call was skipped and memories were
    // silently dropped on every teach-mode call.
    const gate = await shouldRunCallerAnalysis(ctx.callerId);

    const callerResult = await runBatchedCallerAnalysis(
      ctx.call,
      ctx.callerId,
      ctx.engine,
      ctx.log,
      ctx.userName,
      { skipMeasure: !gate.allow },
    );

    if (!gate.allow) {
      ctx.log.info(
        `EXTRACT caller-scoring gated: ${gate.reason} (${callerResult.scoresCreated} always-on scores, ${callerResult.memoriesCreated} memories — gated specs skipped)`,
      );
    }
    const deltaResult = await computeAdapt(ctx.callId, ctx.callerId, ctx.log);

    // Run all 5 non-blocking post-analysis ops in parallel
    const [currSettled, onboardSettled, lessonSettled, artifactSettled, actionSettled] =
      await Promise.allSettled([
        // 1. Curriculum progress + CurriculumModule FK write
        trackCurriculumAfterCall(ctx.callerId, ctx.log, callerResult.learningAssessment)
          .then(async (updated) => {
            if (callerResult.learningAssessment?.moduleId) {
              const mod = await prisma.curriculumModule.findFirst({
                where: { slug: callerResult.learningAssessment.moduleId },
                select: { id: true },
              });
              if (mod) {
                await prisma.call.update({
                  where: { id: ctx.callId },
                  data: { curriculumModuleId: mod.id },
                });
              }
            }
            return updated;
          }),
        // 2. Onboarding completion
        trackOnboardingAfterCall(ctx.callerId, ctx.callId, ctx.log),
        // 3. TP mastery update (scheduler reads these next call)
        updateTpMasteryAfterCall(ctx.callerId, ctx.log, callerResult.learningAssessment),
        // 4. Artifact extraction + delivery
        appConfig.artifacts.enabled
          ? extractArtifacts(ctx.call, ctx.callerId, ctx.engine, ctx.log)
              .then(async (r) => {
                if (r.artifactsCreated > 0) {
                  const deliveryResult = await deliverArtifacts(ctx.callId, ctx.callerId, ctx.log);
                  ctx.log.info("Artifact delivery result", deliveryResult);
                }
                return r;
              })
          : Promise.resolve({ artifactsCreated: 0, artifactsSkipped: 0, errors: [] as string[] }),
        // 5. Action extraction
        appConfig.actions.enabled
          ? extractActions(ctx.call, ctx.callerId, ctx.engine, ctx.log)
          : Promise.resolve({ actionsCreated: 0, actionsSkipped: 0, errors: [] as string[] }),
      ]);

    // Extract results from settled promises, log rejections
    const curriculumUpdated = currSettled.status === "fulfilled" ? currSettled.value : false;
    if (currSettled.status === "rejected") {
      ctx.log.warn(`Curriculum tracking failed (non-blocking): ${currSettled.reason?.message || String(currSettled.reason)}`);
    }

    const onboardingCompleted = onboardSettled.status === "fulfilled" ? onboardSettled.value : false;
    if (onboardSettled.status === "rejected") {
      ctx.log.warn(`Onboarding tracking failed (non-blocking): ${onboardSettled.reason?.message || String(onboardSettled.reason)}`);
    }

    const sessionAdvanced = lessonSettled.status === "fulfilled" ? lessonSettled.value : false;
    if (lessonSettled.status === "rejected") {
      ctx.log.warn(`Lesson plan advancement failed (non-blocking): ${lessonSettled.reason?.message || String(lessonSettled.reason)}`);
    }

    const artifactsExtracted = artifactSettled.status === "fulfilled" ? artifactSettled.value.artifactsCreated : 0;
    if (artifactSettled.status === "rejected") {
      ctx.log.warn(`Artifact extraction failed (non-blocking): ${artifactSettled.reason?.message || String(artifactSettled.reason)}`);
    }

    const actionsExtracted = actionSettled.status === "fulfilled" ? actionSettled.value.actionsCreated : 0;
    if (actionSettled.status === "rejected") {
      ctx.log.warn(`Action extraction failed (non-blocking): ${actionSettled.reason?.message || String(actionSettled.reason)}`);
    }

    return {
      playbookUsed: callerResult.playbookUsed,
      scoresCreated: callerResult.scoresCreated,
      memoriesCreated: callerResult.memoriesCreated,
      deltasComputed: deltaResult.deltasComputed,
      callerAnalysisGated: !gate.allow,
      gate: { allow: gate.allow, mode: gate.mode, reason: gate.reason },
      curriculumUpdated,
      onboardingCompleted,
      sessionAdvanced,
      artifactsExtracted,
      actionsExtracted,
      learningAssessment: callerResult.learningAssessment ? {
        moduleId: callerResult.learningAssessment.moduleId,
        mastery: callerResult.learningAssessment.overallMastery,
        advanced: curriculumUpdated && callerResult.learningAssessment.overallMastery >= callerResult.learningAssessment.masteryThreshold,
      } : null,
    };
  },

  // SCORE_AGENT stage: Score agent behavior (batched)
  SCORE_AGENT: async (ctx, stage) => {
    ctx.log.info(`Stage ${stage.name}: ${stage.description}`);

    // Idempotency: skip AI call if measurements already exist for this call
    if (!ctx.force) {
      const existingMeasurements = await prisma.behaviorMeasurement.count({ where: { callId: ctx.callId } });
      if (existingMeasurements > 0) {
        ctx.log.info(`SCORE_AGENT skipped: ${existingMeasurements} measurements already exist for call ${ctx.callId} (use force=true to re-run)`);
        return { agentMeasurements: 0, skippedReason: "existing_measurements" };
      }
    }

    const agentResult = await runBatchedAgentAnalysis(ctx.call, ctx.callerId, ctx.engine, ctx.log, ctx.userName);
    return {
      agentMeasurements: agentResult.measurementsCreated,
    };
  },

  // AGGREGATE stage: Aggregate personality profiles and run AGGREGATE specs
  AGGREGATE: async (ctx, stage) => {
    ctx.log.info(`Stage ${stage.name}: ${stage.description}`);

    // 1. Aggregate personality (legacy hardcoded aggregation)
    const personalityResult = await aggregatePersonality(ctx.callId, ctx.callerId, ctx.log);

    // 2. Run generic AGGREGATE specs (learner profile, curriculum, etc.)
    const aggregateResult = await runAggregateSpecs(ctx.callerId);
    ctx.log.info(`Aggregate specs completed`, {
      specsRun: aggregateResult.specsRun,
      profileUpdates: aggregateResult.profileUpdates,
      errors: aggregateResult.errors
    });

    return {
      personalityObservationCreated: personalityResult.observationCreated,
      personalityProfileUpdated: personalityResult.profileUpdated,
      aggregateSpecsRun: aggregateResult.specsRun,
      profileUpdates: aggregateResult.profileUpdates,
    };
  },

  // REWARD stage: Compute reward scores
  REWARD: async (ctx, stage) => {
    ctx.log.info(`Stage ${stage.name}: ${stage.description}`);
    const rewardResult = await computeReward(ctx.callId, ctx.log);
    return {
      rewardScore: rewardResult.overallScore,
    };
  },

  // ADAPT stage: Compute personalized targets
  // Ops 1-3 are independent and run in parallel for latency savings
  ADAPT: async (ctx, stage) => {
    ctx.log.info(`Stage ${stage.name}: ${stage.description}`);

    // Idempotency: skip AI calls if targets already exist for this call
    if (!ctx.force) {
      const existingTargets = await prisma.callTarget.count({ where: { callId: ctx.callId } });
      if (existingTargets > 0) {
        ctx.log.info(`ADAPT skipped: ${existingTargets} targets already exist for call ${ctx.callId} (use force=true to re-run)`);
        return { callTargetsCreated: 0, skippedReason: "existing_targets" };
      }
    }

    const startTime = Date.now();

    // Run AI adapt, rule-based adapt, and goal extraction in parallel
    const [adaptSettled, ruleSettled, goalSettled] = await Promise.allSettled([
      // 1. AI-based adapt specs (creates CallTarget entries)
      runAdaptSpecs(ctx.call, ctx.callerId, ctx.engine, ctx.guardrails, ctx.log, ctx.userName),
      // 2. Rule-based adapt specs (creates/updates CallerTarget entries)
      runRuleBasedAdapt(ctx.callerId),
      // 3. Extract goals from transcript (GOAL-001)
      extractGoals(ctx.call, ctx.callerId, ctx.engine, ctx.log),
    ]);

    const adaptResult = adaptSettled.status === "fulfilled" ? adaptSettled.value : { targetsCreated: 0 };
    if (adaptSettled.status === "rejected") {
      ctx.log.error(`AI-based adapt failed (non-blocking)`, { error: adaptSettled.reason?.message || String(adaptSettled.reason) });
    }

    const ruleBasedResult = ruleSettled.status === "fulfilled" ? ruleSettled.value : { specsRun: 0, targetsCreated: 0, targetsUpdated: 0, errors: [] };
    if (ruleSettled.status === "rejected") {
      ctx.log.error(`Rule-based adapt failed (non-blocking)`, { error: ruleSettled.reason?.message || String(ruleSettled.reason) });
    } else {
      ctx.log.info(`Rule-based adapt completed`, {
        specsRun: ruleBasedResult.specsRun,
        targetsCreated: ruleBasedResult.targetsCreated,
        targetsUpdated: ruleBasedResult.targetsUpdated,
        errors: ruleBasedResult.errors
      });
    }

    const goalExtractionResult = goalSettled.status === "fulfilled" ? goalSettled.value : { goalsCreated: 0, goalsUpdated: 0, goalsSkipped: 0, errors: [] };
    if (goalSettled.status === "rejected") {
      ctx.log.error(`Goal extraction failed (non-blocking)`, { error: goalSettled.reason?.message || String(goalSettled.reason) });
    } else {
      ctx.log.info(`Goal extraction completed`, {
        goalsCreated: goalExtractionResult.goalsCreated,
        goalsUpdated: goalExtractionResult.goalsUpdated,
        goalsSkipped: goalExtractionResult.goalsSkipped,
        errors: goalExtractionResult.errors,
      });
    }

    // 4. Track goal progress — depends on extracted goals, runs after
    const goalResult = await trackGoalProgress(ctx.callerId, ctx.callId);
    ctx.log.info(`Goal tracking completed`, {
      goalsUpdated: goalResult.updated,
      goalsCompleted: goalResult.completed,
    });

    // 4b. Evaluate learning checkpoints (comprehension/discussion/coaching courses)
    // sessionNumber hardcoded to 1 — scheduler owns pacing, currentSession attr is no longer written.
    // TODO: rekey checkpoints to outcome-graph progress when scheduler matures.
    const checkpointResults = await evaluateCheckpoints(ctx.callerId, ctx.callId, 1);
    if (checkpointResults.length > 0) {
      ctx.log.info(`Checkpoints evaluated`, { results: checkpointResults });
    }

    // 5. Extract goal completion signals — detects "I passed!" claims for teacher confirmation
    const completionSignals = await extractGoalCompletionSignals(ctx.call, ctx.callerId, ctx.engine, ctx.log);
    if (completionSignals.signalsDetected > 0) {
      ctx.log.info(`Goal completion signals detected`, { signals: completionSignals.signalsDetected });
    }

    // 6. Assessment-aware adaptation — adjusts CallerTarget based on proximity to assessment threshold
    const assessmentAdapt = await applyAssessmentAdaptation(ctx.callerId);
    if (assessmentAdapt.adjustments > 0) {
      ctx.log.info(`Assessment adaptation applied`, { adjustments: assessmentAdapt.adjustments });
    }

    ctx.log.info(`ADAPT parallel ops completed in ${Date.now() - startTime}ms`);

    return {
      callTargetsCreated: adaptResult.targetsCreated,
      callerTargetsCreated: ruleBasedResult.targetsCreated,
      callerTargetsUpdated: ruleBasedResult.targetsUpdated,
      adaptSpecsRun: ruleBasedResult.specsRun,
      goalsExtracted: goalExtractionResult.goalsCreated,
      goalsUpdatedFromExtraction: goalExtractionResult.goalsUpdated,
      goalsSkipped: goalExtractionResult.goalsSkipped,
      goalsProgressUpdated: goalResult.updated,
      goalsCompleted: goalResult.completed,
      completionSignalsDetected: completionSignals.signalsDetected,
      assessmentAdaptations: assessmentAdapt.adjustments,
    };
  },

  // SUPERVISE stage: Validate and clamp targets
  SUPERVISE: async (ctx, stage) => {
    ctx.log.info(`Stage ${stage.name}: ${stage.description}`);

    // Load audience from playbook for audience-aware target clamping
    let audience: AudienceId | null = null;
    if (ctx.call.playbookId) {
      const pb = await prisma.playbook.findUnique({
        where: { id: ctx.call.playbookId },
        select: { config: true },
      });
      audience = ((pb?.config as Record<string, any> | null)?.audience as AudienceId) || null;
    }

    const validateResult = await validateTargets(ctx.callId, ctx.guardrails, ctx.log, audience);
    const callerTargetResult = await aggregateCallerTargets(ctx.callId, ctx.callerId, ctx.guardrails, ctx.log);
    return {
      targetsValidated: validateResult.adjustments,
      callerTargetsAggregated: callerTargetResult.aggregated,
    };
  },

  // COMPOSE stage: Build final prompt
  COMPOSE: async (ctx, stage) => {
    ctx.log.info(`Stage ${stage.name}: ${stage.description}`);

    // Direct function call — no HTTP self-call
    const playbookIds = ctx.call.playbookId ? [ctx.call.playbookId] : undefined;
    const { fullSpecConfig, sections, specSlug } = await loadComposeConfig({ playbookIds });
    const composition = await executeComposition(ctx.callerId, sections, fullSpecConfig);
    const promptSummary = renderPromptSummary(composition.llmPrompt);

    const persisted = await persistComposedPrompt(composition, promptSummary, {
      callerId: ctx.callerId,
      playbookId: ctx.call.playbookId,
      triggerType: "pipeline",
      triggerCallId: ctx.callId,
      composeSpecSlug: specSlug,
      specConfig: fullSpecConfig,
    });

    ctx.log.info(`COMPOSE complete: ${persisted.prompt.length} chars, id=${persisted.id}`);

    return {
      promptId: persisted.id,
      promptLength: persisted.prompt.length,
      prompt: persisted.prompt,
    };
  },
};

/**
 * Run the pipeline using spec-driven stage configuration
 */
async function runSpecDrivenPipeline(ctx: PipelineContext): Promise<{
  summary: Record<string, any>;
  prompt?: string;
}> {
  const { pipelineStages: stages, mode, log } = ctx;

  log.info(`Running spec-driven pipeline with ${stages.length} stages`, {
    stages: stages.map((s) => s.name),
    mode,
  });

  // Validate spec dependencies before executing any stages
  // Load all active spec slugs that will be used in this pipeline run
  const allActiveSpecs = await prisma.analysisSpec.findMany({
    where: { isActive: true, isDirty: false },
    select: { slug: true },
  });
  const depValidation = await validateSpecDependencies(allActiveSpecs.map(s => s.slug));
  if (!depValidation.valid) {
    for (const warning of depValidation.warnings) {
      log.warn(`[dependency] ${warning}`);
    }
    if (depValidation.skipped.length > 0) {
      log.warn(`[dependency] ${depValidation.skipped.length} spec(s) have unsatisfied dependencies — they may produce incomplete results`);
    }
  }

  // Stages that can run in parallel (no dependencies between them)
  const parallelStages = new Set(["EXTRACT", "SCORE_AGENT"]);
  const stageErrors: string[] = [];

  // Execute stages - parallelize where possible
  // Stages are RESILIENT: failures are logged but don't stop the pipeline.
  // This ensures COMPOSE always runs even if earlier stages fail.
  let i = 0;
  while (i < stages.length) {
    const stage = stages[i];

    // Skip stages that require a specific mode
    if (stage.requiresMode && stage.requiresMode !== mode) {
      log.debug(`Skipping stage ${stage.name} (requires mode=${stage.requiresMode})`);
      i++;
      continue;
    }

    // Check if this and next stages can run in parallel
    const canParallelize = parallelStages.has(stage.name);
    const parallelBatch: PipelineStage[] = [];

    if (canParallelize) {
      // Collect consecutive parallelizable stages
      while (i < stages.length && parallelStages.has(stages[i].name)) {
        const s = stages[i];
        if (!s.requiresMode || s.requiresMode === mode) {
          parallelBatch.push(s);
        }
        i++;
      }
    }

    if (parallelBatch.length > 1) {
      // Run stages in parallel using allSettled so one failure doesn't block others
      log.info(`Running ${parallelBatch.length} stages in parallel: ${parallelBatch.map(s => s.name).join(", ")}`);
      const startTime = Date.now();

      const settled = await Promise.allSettled(
        parallelBatch.map(async (s) => {
          const executor = stageExecutors[s.name];
          if (!executor) {
            log.warn(`No executor for stage ${s.name} - skipping`);
            return {};
          }
          return executor(ctx, s);
        })
      );

      // Merge results from fulfilled stages, log rejected ones
      for (let j = 0; j < settled.length; j++) {
        const outcome = settled[j];
        if (outcome.status === "fulfilled") {
          Object.assign(ctx.results, outcome.value);
        } else {
          const stageName = parallelBatch[j].name;
          const errMsg = outcome.reason?.message || String(outcome.reason);
          log.error(`Stage ${stageName} failed (non-blocking)`, { error: errMsg });
          stageErrors.push(`${stageName}: ${errMsg}`);
          if (stageName === "COMPOSE" && ctx.mode === "prompt") {
            ctx.results.composeFailed = true;
            ctx.results.composeError = errMsg;
          }
        }
      }

      log.info(`Parallel stages completed in ${Date.now() - startTime}ms`);
    } else {
      // Run single stage — catch errors and continue
      const executor = stageExecutors[stage.name];
      if (!executor) {
        log.warn(`No executor for stage ${stage.name} - skipping`);
        i++;
        continue;
      }

      try {
        const stageResults = await executor(ctx, stage);
        Object.assign(ctx.results, stageResults);
      } catch (error: any) {
        log.error(`Stage ${stage.name} failed (non-blocking)`, { error: error.message });
        stageErrors.push(`${stage.name}: ${error.message}`);
        if (stage.name === "COMPOSE" && ctx.mode === "prompt") {
          ctx.results.composeFailed = true;
          ctx.results.composeError = error.message;
        }
      }
      i++;
    }
  }

  if (stageErrors.length > 0) {
    ctx.results.stageErrors = stageErrors;
    log.warn(`Pipeline completed with ${stageErrors.length} stage error(s)`, { stageErrors });
  }

  // Update CallerIdentity: track callCount and lastCallAt after every pipeline run
  try {
    const existingIdentity = await prisma.callerIdentity.findFirst({
      where: { callerId: ctx.callerId },
      select: { id: true, callCount: true },
    });
    if (existingIdentity) {
      await prisma.callerIdentity.update({
        where: { id: existingIdentity.id },
        data: { callCount: existingIdentity.callCount + 1, lastCallAt: new Date() },
      });
    } else {
      await prisma.callerIdentity.create({
        data: { callerId: ctx.callerId, callCount: 1, lastCallAt: new Date() },
      });
    }
  } catch (err: any) {
    log.warn(`CallerIdentity update failed (non-blocking): ${err.message}`);
  }

  return {
    summary: ctx.results,
    prompt: ctx.results.prompt,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ callId: string }> }
) {
  const log = createLogger();

  try {
    // Allow internal service-to-service calls (VAPI webhook → pipeline)
    const internalSecret = request.headers.get("x-internal-secret");
    const isInternalCall = internalSecret && internalSecret === appConfig.security.internalApiSecret;

    let pipelineUserName: string | undefined;
    if (!isInternalCall) {
      const authResult = await requireAuth("OPERATOR");
      if (isAuthError(authResult)) return authResult.error;
      pipelineUserName = authResult.session.user.name || undefined;
    } else {
      pipelineUserName = "vapi-webhook";
    }

    const { callId } = await params;
    const body = await request.json().catch(() => ({}));
    const { callerId, mode, engine: requestedEngine, force = false } = body;

    if (!callerId) {
      return NextResponse.json({ ok: false, error: "callerId is required", logs: log.getLogs() }, { status: 400 });
    }

    if (!mode || !["prep", "prompt"].includes(mode)) {
      return NextResponse.json({ ok: false, error: "mode must be 'prep' or 'prompt'", logs: log.getLogs() }, { status: 400 });
    }

    // Validate engine - default to claude for real AI inference
    let engine: AIEngine = "claude";
    if (requestedEngine && ["mock", "claude", "openai"].includes(requestedEngine)) {
      engine = requestedEngine as AIEngine;
    }

    // Verify the engine is available (has API key configured)
    if (!isEngineAvailable(engine)) {
      if (engine !== "mock") {
        log.warn(`Engine "${engine}" not available (missing API key), falling back to mock`);
        engine = "mock";
      }
    }

    log.info("Pipeline started", { callId, callerId, mode, engine });

    // Load call
    const call = await prisma.call.findUnique({
      where: { id: callId },
      select: { id: true, transcript: true, playbookId: true, requestedModuleId: true },
    });

    if (!call) {
      return NextResponse.json({ ok: false, error: "Call not found", logs: log.getLogs() }, { status: 404 });
    }

    // =====================================================
    // LOAD GUARDRAILS & PIPELINE CONFIG
    // =====================================================
    const guardrails = await loadGuardrails(log);
    const pipelineStages = await loadPipelineStages(log);

    // =====================================================
    // SPEC-DRIVEN PIPELINE EXECUTION
    // Stages are loaded from PIPELINE-001 spec (or GUARD-001 fallback)
    // =====================================================

    const pipelineCtx: PipelineContext = {
      callId,
      callerId,
      call,
      engine,
      guardrails,
      pipelineStages,
      mode: mode as "prep" | "prompt",
      force,
      log,
      request,
      userName: pipelineUserName,
      results: {},
    };

    const { summary, prompt } = await runSpecDrivenPipeline(pipelineCtx);

    if (mode === "prep") {
      log.info("Prep complete", summary);
      return NextResponse.json({
        ok: true,
        mode: "prep",
        message: `Prep complete: ${summary.scoresCreated || 0} scores, ${summary.memoriesCreated || 0} memories, ${summary.callTargetsCreated || 0} targets, ${summary.agentMeasurements || 0} agent measurements`,
        data: summary,
        logs: log.getLogs(),
        duration: log.getDuration(),
      });
    }

    // Mode is "prompt" - COMPOSE stage was already run by spec-driven pipeline
    if (summary.composeFailed) {
      log.warn("Prompt mode complete but COMPOSE stage failed — no prompt generated");
      return NextResponse.json({
        ok: false,
        mode: "prompt",
        error: `Prompt generation failed: ${summary.composeError || "COMPOSE stage error"}`,
        data: summary,
        logs: log.getLogs(),
        duration: log.getDuration(),
      }, { status: 500 });
    }

    log.info("Prompt mode complete");

    return NextResponse.json({
      ok: true,
      mode: "prompt",
      message: `Full pipeline complete with prompt`,
      data: summary,
      prompt,
      logs: log.getLogs(),
      duration: log.getDuration(),
    });

  } catch (error: any) {
    const errorCode = classifyAIError(error);
    const userMessage = userMessageForError(errorCode);
    log.error("Pipeline failed", { error: error.message, stack: error.stack, errorCode });
    return NextResponse.json({
      ok: false,
      error: userMessage,
      errorCode,
      logs: log.getLogs(),
      duration: log.getDuration(),
    }, { status: 500 });
  }
  // NOTE: Do NOT call prisma.$disconnect() in API routes - it breaks the shared client
}
