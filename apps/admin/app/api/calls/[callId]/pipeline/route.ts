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
 * @body partialFailureMode string - Optional. When "minimal", COMPOSE short-circuits the LLM path and carries the prior prompt forward via the I-CT2 cascade. Used by the Slice 5 reconciler (#1346).
 * @response 200 { ok: true, mode: "prep" | "prompt", message: string, data: { scoresCreated, memoriesCreated, callTargetsCreated, agentMeasurements, ... }, prompt?: object, logs: LogEntry[], duration: number }
 * @response 400 { ok: false, error: "callerId is required" | "mode must be 'prep' or 'prompt'", logs: LogEntry[] }
 * @response 404 { ok: false, error: "Call not found", logs: LogEntry[] }
 * @response 500 { ok: false, error: string, logs: LogEntry[], duration: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { AIEngine, isEngineAvailable } from "@/lib/ai/client";
import { classifyAIError, userMessageForError } from "@/lib/ai/error-utils";
import { getConfiguredMeteredAICompletion, logMockAIUsage } from "@/lib/metering";
import {
  PIPELINE_MEASURE_SYSTEM_PROMPT,
  PIPELINE_SCORE_AGENT_SYSTEM_PROMPT,
  PIPELINE_ADAPT_SYSTEM_PROMPT,
} from "@/lib/ai/analyst-system-prompts";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { runAggregateSpecs } from "@/lib/pipeline/aggregate-runner";
import { runProsodyStage } from "@/lib/pipeline/prosody-runner";
import { applyProsodyContractToAggregate } from "@/lib/pipeline/prosody-consumer";
import { aggregateCallerMemorySummary } from "@/lib/ops/memory-extract";
import { runAdaptSpecs as runRuleBasedAdapt } from "@/lib/pipeline/adapt-runner";
import { extractFailureAdaptation } from "@/lib/pipeline/extract-failure-adaptation";
import { runEvidencePrefilterBatch } from "@/lib/pipeline/evidence-prefilter";
import { shouldSkipForEvidenceFirst, shouldSkipForZeroEvidence } from "@/lib/pipeline/evidence-gate";
import { validateSpecDependencies } from "@/lib/pipeline/validate-dependencies";
import { checkInvariantsAfterPipeline } from "@/lib/pipeline/adaptive-loop-invariants";
import { loadBehaviorTargetsWithCascade } from "@/lib/pipeline/score-agent-cascade";
import { trackGoalProgress, applyAssessmentAdaptation } from "@/lib/goals/track-progress";
import { evaluateCheckpoints } from "@/lib/assessment/checkpoint-evaluator";
import { extractGoals, extractGoalCompletionSignals } from "@/lib/goals/extract-goals";
import { extractArtifacts } from "@/lib/artifacts/extract-artifacts";
import { deliverArtifacts } from "@/lib/artifacts/deliver-artifacts";
import { extractActions } from "@/lib/actions/extract-actions";
import { config as appConfig } from "@/lib/config";
import { updateCurriculumProgress, getCurriculumProgress, completeModule } from "@/lib/curriculum/track-progress";
import { validateIeltsCompletion } from "@/lib/curriculum/validate-ielts-completion";
import { markModuleIncomplete } from "@/lib/curriculum/mark-module-incomplete";
import { buildPostAssessmentPlan } from "@/lib/lesson-plan/build-post-assessment-plan";
// initializeLessonPlanSession removed — scheduler replaces session tracking
import { resolvePlaybookId } from "@/lib/enrollment/resolve-playbook";
import { resolveCurriculumIdForPlaybook, resolveModuleByLogicalId } from "@/lib/curriculum/resolve-module";
import { segmentMockTranscript } from "@/lib/curriculum/segment-mock-transcript";
import { buildPerSegmentMeasurePrompt, bandToScore } from "@/lib/curriculum/build-per-segment-measure-prompt";
import { computeModuleMastery } from "@/lib/curriculum/compute-mastery";
import { generateDiagnosticFromMock } from "@/lib/curriculum/diagnostic-from-mock";
import { ContractRegistry } from "@/lib/contracts/registry";
import { loadPipelineStages, PipelineStage } from "@/lib/pipeline/config";

import { TRAITS } from "@/lib/registry";
import { recoverBrokenJson } from "@/lib/utils/json-recovery";
import { executeComposition, persistComposedPrompt, loadComposeConfig } from "@/lib/prompt/composition";
import { carryThroughCompose } from "@/lib/voice/carry-through-compose";
import { renderPromptSummary } from "@/lib/prompt/composition/renderPromptSummary";
import { getAudienceOption, type AudienceId } from "@/lib/prompt/composition/transforms/audience";
import { getPipelineGates, getAITimeoutSettings } from "@/lib/system-settings";
import { logAI, log as appLog } from "@/lib/logger";
import { createLogger, type PipelineLogger } from "@/lib/pipeline/logger";
import { mapToMemoryCategory } from "@/lib/pipeline/memory";
import { loadGuardrails, type GuardrailsConfig } from "@/lib/pipeline/guardrails";
import { shouldRunCallerAnalysis } from "@/lib/pipeline/event-gate";
import { getCourseStyle, type CourseStyle } from "@/lib/pipeline/course-style";
import { getTranscriptLimit, getSystemSpecs, getSpecsByOutputType, getPlaybookSpecs, batchLoadParameters, resolveCallerTeachingProfile, filterByTeachingProfile } from "@/lib/pipeline/specs-loader";
import { writeCallScore, MEASUREMENT_SENTINEL_SPEC_IDS } from "@/lib/measurement/write-call-score";
import { withTextNamespace } from "@/lib/pipeline/segment-key-namespace";
import { normalizeScoreAgentEvidence } from "@/lib/pipeline/normalize-score-agent-evidence";
import { logStageWriteCounts } from "@/lib/pipeline/write-count-logger";
import { updateTargets } from "@/lib/ops/update-targets";
import { buildParameterSpecMap, type ParameterWithSpec } from "@/lib/measurement/parameter-spec-map";
import { buildBatchedMeasurePrompt } from "@/lib/measurement/build-batched-measure-prompt";
import type { SpecConfig } from "@/lib/types/json-fields";
import { PlaybookCurriculumRole } from "@prisma/client";

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

  // ── #242 Slice 2: requestedModuleId override ──
  // When the learner picked a module via the picker, build the moduleContext
  // directly from Playbook.config.modules (the authored shape). The override
  // bypasses the scheduler so mastery fires against the learner's choice
  // even if scheduler logic would have selected a different module.
  if (opts?.requestedModuleId) {
    const pb = await prisma.playbook.findUnique({
      where: { id: resolvedPlaybookId },
      select: {
        name: true,
        config: true,
        // #1205 — canonical PlaybookCurriculum primary join (variant-aware).
        playbookCurricula: {
          where: { role: PlaybookCurriculumRole.primary },
          take: 1,
          select: { curriculum: { select: { slug: true } } },
        },
      },
    });
    const cfg = (pb?.config ?? {}) as Record<string, any>;
    const authored = Array.isArray(cfg.modules) ? cfg.modules : [];
    const match = authored.find((m: any) => m?.id === opts.requestedModuleId);
    if (match) {
      const specSlug =
        pb?.playbookCurricula[0]?.curriculum.slug ??
        `playbook-${resolvedPlaybookId.slice(0, 8)}-modules`;

      // #317 — drop system-only refs (ASSESSOR_RUBRIC / SCORE_EXPLAINER /
      // TEACHING_INSTRUCTION) from the pipeline's learningOutcomes so the
      // assessor scoring loop never assesses the learner ON the rubric or on
      // tutor-strategic content. Those surface via assessorOutcomes (rubric
      // / scoreExplainer / teachingInstruction) in the appropriate system
      // prompts instead.
      const allRefs: string[] = Array.isArray(match.outcomesPrimary)
        ? match.outcomesPrimary
        : [];
      let filteredRefs = allRefs;
      if (allRefs.length > 0) {
        try {
          // #1034 — resolveCurriculumIdForPlaybook reads PlaybookCurriculum
          // first (variant Playbooks share the parent's Curriculum) and
          // falls back to the deprecated Curriculum.playbookId column.
          const curriculumId = await resolveCurriculumIdForPlaybook(resolvedPlaybookId);
          if (curriculumId) {
            const excluded = await prisma.learningObjective.findMany({
              where: {
                module: { curriculumId },
                ref: { in: allRefs },
                systemRole: { in: ["ASSESSOR_RUBRIC", "SCORE_EXPLAINER", "TEACHING_INSTRUCTION"] },
              },
              select: { ref: true },
            });
            const drop = new Set(excluded.map((lo) => lo.ref));
            if (drop.size > 0) {
              filteredRefs = allRefs.filter((r) => !drop.has(r));
              log.info("#317 filtered system-only LO refs from pipeline", {
                moduleId: match.id,
                droppedCount: drop.size,
                droppedRefs: [...drop],
              });
            }
          }
        } catch (err: any) {
          log.warn("#317 systemRole filter failed; passing all refs", { error: err?.message });
        }
      }

      log.info("Module context override from picker", {
        requestedModuleId: opts.requestedModuleId,
        specSlug,
        loCount: filteredRefs.length,
      });
      return {
        specSlug,
        moduleId: match.id,
        moduleName: match.label || match.id,
        learningOutcomes: filteredRefs,
        // #1008 — read CURRICULUM_PROGRESS_V1 contract (matches Path 3's pattern below).
        masteryThreshold: (await ContractRegistry.getThresholds('CURRICULUM_PROGRESS_V1'))?.masteryComplete ?? 0.7,
        allModuleIds: authored.map((m: any) => m?.id).filter(Boolean),
      };
    }
    log.warn("requestedModuleId not found in Playbook.config.modules — falling back to scheduler", {
      requestedModuleId: opts.requestedModuleId,
      playbookId: resolvedPlaybookId,
    });
  }

  // ── #284 Path 0b: authored-module fallback ──
  // Authored-module playbooks (modulesAuthored=true) store the canonical
  // module catalogue in `Playbook.config.modules[]`. When the caller has no
  // `requestedModuleId` (every inbound voice-provider background call) we never used to look
  // here — Path 1's CONTENT-spec lookup misses, Path 2's curriculum.notableInfo
  // is empty, and the function returned null. Result: `learningAssessment`
  // never fires and `CallerModuleProgress` never gets written. That's the
  // bug Soren Guzmán surfaced (6 calls, 0 CMP rows, all 8 module bars at 0).
  //
  // Recipe: read the authored catalogue, find the caller's progress, pick
  // the first non-completed module, and build the moduleContext from its
  // `outcomesPrimary` refs (filtered the same way as the picker path).
  {
    const pb = await prisma.playbook.findUnique({
      where: { id: resolvedPlaybookId },
      select: {
        config: true,
        // #1205 — canonical PlaybookCurriculum primary join (variant-aware).
        playbookCurricula: {
          where: { role: PlaybookCurriculumRole.primary },
          take: 1,
          select: { curriculum: { select: { id: true, slug: true } } },
        },
      },
    });
    const cfg = (pb?.config ?? {}) as Record<string, any>;
    const modulesAuthored = cfg.modulesAuthored === true;
    const authored = Array.isArray(cfg.modules) ? cfg.modules : [];

    if (modulesAuthored && authored.length > 0) {
      // Pick the first non-completed module via CMP; first authored entry if
      // none seen yet. Order matches the curriculum's authored sequence.
      const cmps = await prisma.callerModuleProgress.findMany({
        where: { callerId },
        select: { moduleId: true, mastery: true },
      });
      const masteryByModuleId = new Map(cmps.map((c) => [c.moduleId, c.mastery]));
      // #1008 — read CURRICULUM_PROGRESS_V1 contract instead of bare 0.7 (Finding D).
      const masteryThreshold = (await ContractRegistry.getThresholds('CURRICULUM_PROGRESS_V1'))?.masteryComplete ?? 0.7;
      const next =
        authored.find((m: any) => (masteryByModuleId.get(m?.id) ?? 0) < masteryThreshold) ??
        authored[0];

      const allRefs: string[] = Array.isArray(next?.outcomesPrimary)
        ? next.outcomesPrimary
        : [];
      let filteredRefs = allRefs;
      if (allRefs.length > 0 && pb?.playbookCurricula[0]?.curriculum.id) {
        try {
          const excluded = await prisma.learningObjective.findMany({
            where: {
              module: { curriculumId: pb.playbookCurricula[0].curriculum.id },
              ref: { in: allRefs },
              systemRole: { in: ["ASSESSOR_RUBRIC", "SCORE_EXPLAINER", "TEACHING_INSTRUCTION"] },
            },
            select: { ref: true },
          });
          const drop = new Set(excluded.map((lo) => lo.ref));
          if (drop.size > 0) {
            filteredRefs = allRefs.filter((r) => !drop.has(r));
          }
        } catch (err: any) {
          log.warn("Path 0b: systemRole filter failed; passing all refs", { error: err?.message });
        }
      }

      log.info("Module context from authored catalogue (#284 Path 0b)", {
        playbookId: resolvedPlaybookId,
        moduleId: next?.id,
        loCount: filteredRefs.length,
        seenModules: cmps.length,
      });
      return {
        specSlug:
          pb?.playbookCurricula[0]?.curriculum.slug ??
          `playbook-${resolvedPlaybookId.slice(0, 8)}-modules`,
        moduleId: next?.id,
        moduleName: next?.label || next?.id,
        learningOutcomes: filteredRefs,
        masteryThreshold,
        allModuleIds: authored.map((m: any) => m?.id).filter(Boolean),
      };
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
          // #1008 — spec-first; ContractRegistry-second; hard fallback 0.7.
          masteryThreshold:
            specConfig.metadata?.curriculum?.masteryThreshold ??
            (await ContractRegistry.getThresholds('CURRICULUM_PROGRESS_V1'))?.masteryComplete ??
            0.7,
          allModuleIds: modules.map((m: any) => m.id || m.slug),
        };
      }
    }
  }

  // Path 2: Playbook curriculum (direct link via playbookId)
  if (resolvedPlaybookId) {
    // #1034 / #1177 Slice 6 — canonical PlaybookCurriculum read. The legacy
    // Curriculum.playbookId fallback was removed when the column was dropped
    // in #1038; backfill ensures every Curriculum has a join row.
    const pbcLink = await prisma.playbookCurriculum.findFirst({
      where: { playbookId: resolvedPlaybookId },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: { curriculum: { select: { slug: true, notableInfo: true } } },
    });
    const pbCurriculum = pbcLink?.curriculum;
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
            // #1008 — read CURRICULUM_PROGRESS_V1 contract (matches Path 3's pattern below).
            masteryThreshold: (await ContractRegistry.getThresholds('CURRICULUM_PROGRESS_V1'))?.masteryComplete ?? 0.7,
            allModuleIds: rawModules.map((m: any) => m.id),
          };
        }
      }
    }
  }

  // Path 2.5 (#1117) — first-class CurriculumModule fallback.
  //
  // Modern courses (#1034 PlaybookCurriculum + first-class CurriculumModule
  // rows + first-class LearningObjective rows) don't necessarily cache the
  // catalog in Playbook.config.modules[] or Curriculum.notableInfo.modules[].
  // The CIO/CTO Standard family hit this gap: modulesAuthored=true but the
  // modules[] cache was never populated, so Paths 0b / 1 / 2 all returned null
  // and per-LO scoring never fired. Read directly from CurriculumModule +
  // LearningObjective when the JSON caches are absent or empty. This is the
  // universal fallback that unblocks every Curriculum-anchored course.
  if (resolvedPlaybookId) {
    const pbcLink = await prisma.playbookCurriculum.findFirst({
      where: { playbookId: resolvedPlaybookId },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: { curriculumId: true, curriculum: { select: { slug: true } } },
    });
    if (pbcLink?.curriculumId && pbcLink.curriculum?.slug) {
      const moduleRows = await prisma.curriculumModule.findMany({
        where: { curriculumId: pbcLink.curriculumId, isActive: true },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          slug: true,
          title: true,
          masteryThreshold: true,
          learningObjectives: {
            where: { learnerVisible: true },
            orderBy: { sortOrder: "asc" },
            select: { ref: true },
          },
        },
      });
      if (moduleRows.length > 0) {
        const defaultThreshold =
          (await ContractRegistry.getThresholds("CURRICULUM_PROGRESS_V1"))
            ?.masteryComplete ?? 0.7;
        const progress = await getCurriculumProgress(callerId, pbcLink.curriculum.slug);
        const masteryByModuleKey = new Map(
          Object.entries(progress.modulesMastery || {}) as [string, number][],
        );
        // Pick the first module whose mastery is below the threshold; falls
        // back to the first authored module when all are above threshold.
        const next =
          moduleRows.find((m) => {
            const masteryKey = m.slug || m.id;
            const mastery = masteryByModuleKey.get(masteryKey) ?? 0;
            return mastery < (m.masteryThreshold ?? defaultThreshold);
          }) ?? moduleRows[0];
        const refs = next.learningObjectives.map((lo) => lo.ref);
        log.info("#1117 Path 2.5 — module context from first-class CurriculumModule rows", {
          curriculumSlug: pbcLink.curriculum.slug,
          moduleSlug: next.slug,
          loCount: refs.length,
          availableModules: moduleRows.length,
        });
        return {
          specSlug: pbcLink.curriculum.slug,
          moduleId: next.slug || next.id,
          moduleName: next.title || next.slug || next.id,
          learningOutcomes: refs,
          masteryThreshold: next.masteryThreshold ?? defaultThreshold,
          allModuleIds: moduleRows.map((m) => m.slug || m.id),
        };
      }
    }
  }

  // Path 3: Domain-wide Subject curriculum fallback (legacy)
  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { domainId: true },
  });
  if (!caller?.domainId) return null;
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

// #1539 — `buildBatchedCallerPrompt` was extracted to
// `lib/measurement/build-batched-measure-prompt.ts::buildBatchedMeasurePrompt`.
// The old inline builder dropped each spec's `promptTemplate`; the new
// builder interpolates it as a per-parameter rubric block. Do NOT
// reintroduce a local copy here — the helper is the contract.

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

  // #1608 — request `e` (evidence) as a short verbatim-quote array per param.
  // Pre-fix the prompt asked for {s, c} only and the parser at the
  // BehaviorMeasurement write loop fell through to `["AI analysis"]` for every
  // row (4259 universal rows). Evidence quotes are what feed the Attainment
  // tab's per-skill evidence trail (SP4-A).
  return `Score AGENT behavior 0-1 (0=poor, 1=excellent).

TRANSCRIPT:
${transcript.slice(0, transcriptLimit)}

BEHAVIORS: ${paramList}

For each behavior, also return 1-2 short verbatim learner quotes (≤100 chars each) from the TRANSCRIPT supporting the score, in field "e". If the transcript has no learner contribution for a behavior, return "e":[].

Return compact JSON:
{"scores":{"PARAM-ID":{"s":0.75,"c":0.8,"e":["short quote","another short quote"]},...}}`;
}

/**
 * Per-part MEASURE pass for multi-attribute modules (#491 Slice 1.5).
 *
 * When the call's bound `CurriculumModule.coversModules` is non-empty
 * (e.g. an IELTS Full Mock that walks the learner through Part 1,
 * Part 2, Part 3 in a single call), this helper segments the
 * transcript and runs one extra MEASURE AI call per segment. Each
 * resulting `CallScore` row is tagged with the sub-part's
 * `CurriculumModule.id` — that's what gives educators per-part bands
 * instead of one Mock-level score.
 *
 * Augments the bound-module MEASURE scores already written by the
 * caller — does NOT replace them. Mock-level rows stay so the
 * existing `weakSkill` / `diagnostic-from-mock` readers keep working;
 * the per-part rows feed the new per-part display + EMA per
 * sub-module.
 *
 * Returns the count of NEW per-segment `CallScore` rows created.
 * Returns `0` when segmentation does not apply, fails, or produces
 * zero usable segments.
 *
 * Safe to call unconditionally with `skipMeasure: false` — internal
 * guards short-circuit when this call's bound module has no
 * `coversModules` declared.
 */
async function runPerSegmentScoring(
  call: { id: string; transcript: string | null; curriculumModuleId?: string | null },
  callerId: string,
  measureParams: ParameterWithSpec[],
  engine: AIEngine,
  transcriptLimit: number,
  log: PipelineLogger,
  userName?: string,
): Promise<number> {
  if (engine === "mock") return 0; // mock engine writes random scores via the bound path only
  if (!call.curriculumModuleId) return 0;
  if (measureParams.length === 0) return 0;
  const transcript = call.transcript || "";
  if (transcript.trim().length === 0) return 0;

  const boundModule = await prisma.curriculumModule.findUnique({
    where: { id: call.curriculumModuleId },
    select: { coversModules: true, curriculumId: true, slug: true },
  });
  if (!boundModule || boundModule.coversModules.length === 0) return 0;

  // Resolve each declared slug → CurriculumModule (id + segmentCues), scoped
  // to the bound module's curriculum (#407 — never a global slug lookup).
  // Batched as a single findMany to avoid N+1; #1785 also reads `segmentCues`
  // so the segmenter's heuristic matchers are course-agnostic (DB-driven
  // tutor cue phrases instead of an IELTS-hardcoded regex map).
  const subModules = await prisma.curriculumModule.findMany({
    where: { curriculumId: boundModule.curriculumId, slug: { in: boundModule.coversModules } },
    select: { id: true, slug: true, segmentCues: true },
  });
  const slugToId = new Map<string, string>(subModules.map((m) => [m.slug, m.id]));
  const slugToCues: Record<string, string[]> = {};
  for (const m of subModules) {
    if (m.segmentCues.length > 0) slugToCues[m.slug] = m.segmentCues;
  }
  for (const slug of boundModule.coversModules) {
    if (!slugToId.has(slug)) {
      log.warn("Per-part MEASURE: coversModules slug not found in curriculum", {
        slug,
        curriculumId: boundModule.curriculumId,
        boundSlug: boundModule.slug,
      });
    }
  }
  if (slugToId.size === 0) return 0;

  const segments = await segmentMockTranscript({
    transcript,
    coversModuleSlugs: boundModule.coversModules.filter((s) => slugToId.has(s)),
    slugToCues,
    engine,
    log,
  });
  // Loud-skip fallback (#1700 Theme 6 / #1702). The bound module declares a
  // multi-part Mock (`coversModules.length > 0`, guaranteed above) but the
  // segmenter resolved 0 or 1 boundary — per-part scoring is not viable, so
  // we fall back to bound-module scoring. Promote this to an AppLog subject
  // (precedent: `pipeline.aggregate.lo_mastery_skipped`) so a 24h dashboard
  // can spot "Mock call → no per-part scores" instead of it dying in the
  // response-only PipelineLogger.
  if (segments.length <= 1) {
    appLog("system", "prosody.segmentation.fallback", {
      message:
        "Per-part MEASURE fell back to bound-module scoring — segmenter resolved ≤1 boundary",
      callId: call.id,
      moduleSlug: boundModule.slug,
      coversModules: boundModule.coversModules,
      segmentsReturned: segments.length,
    });
    log.info("Per-part MEASURE: segmentation returned ≤1 segment, skipping", {
      callId: call.id,
      boundSlug: boundModule.slug,
      segmentsReturned: segments.length,
    });
    return 0;
  }

  log.info("Per-part MEASURE: running per-segment scoring", {
    callId: call.id,
    boundSlug: boundModule.slug,
    segments: segments.map((s) => ({ slug: s.slug, len: s.text.length, method: s.method })),
  });

  const timeouts = await getAITimeoutSettings();
  let segmentScoresCreated = 0;

  for (const segment of segments) {
    // Whitelist guard (#1700 Theme 6 / #1702). The segment slug MUST resolve
    // to a curriculum-declared sub-module (`coversModules` → `slugToId`). A
    // slug outside that set is a segmentation mismatch — promote to AppLog
    // and skip only that segment's writes (other segments still score).
    const segmentModuleId = slugToId.get(segment.slug);
    if (!segmentModuleId) {
      appLog("system", "prosody.segmentation.mismatch", {
        message:
          "Per-part MEASURE skipped a segment — slug not in curriculum coversModules whitelist",
        callId: call.id,
        slug: segment.slug,
        knownKeys: [...slugToId.keys()],
      });
      continue;
    }

    // IELTS-focused per-segment prompt: scopes scoring to the 4
    // IELTS Speaking skills, embeds the band rubric, gives per-part
    // context, and asks for IELTS bands (4-9) instead of free-floating
    // 0-1 scores. Returns null when the param set has no IELTS skill
    // params — in that case the segment is skipped (non-IELTS courses
    // don't get per-part scoring through this path).
    const ieltsPrompt = buildPerSegmentMeasurePrompt({
      segmentText: segment.text,
      measureParams,
      partSlug: segment.slug,
      transcriptLimit,
    });
    if (!ieltsPrompt) {
      log.info("Per-part MEASURE: no IELTS skill params in scope, skipping segment", {
        segmentSlug: segment.slug,
      });
      continue;
    }
    const allowedParamIds = new Set(ieltsPrompt.scopedParams.map((p) => p.parameterId));

    try {
      // @ai-call pipeline.measure-segment — Per-part MEASURE for multi-attribute modules | config: /x/ai-config
      const segResult = await getConfiguredMeteredAICompletion(
        {
          callPoint: "pipeline.measure-segment",
          // #1868 — Lattice scope so Playbook/Domain `aiOverrides[callPoint]` resolve before global.
          scope: { callId: call.id },
          engineOverride: engine,
          messages: [
            {
              role: "system",
              content:
                "You are an expert IELTS Speaking examiner. Score against the official band rubric. Always respond with valid JSON only — no commentary, no markdown fences.",
            },
            { role: "user", content: ieltsPrompt.prompt },
          ],
          maxTokens: Math.max(800, ieltsPrompt.scopedParams.length * 200),
          temperature: 0,
          timeoutMs: timeouts.pipelineTimeoutMs,
        },
        { callId: call.id, callerId, sourceOp: "pipeline:extract-segment", userName },
      );

      const { parsed: segParsed } = recoverBrokenJson(segResult.content, "pipeline:extract-segment");
      if (!segParsed?.scores) {
        log.warn("Per-part MEASURE: AI returned no scores object for segment", {
          segmentSlug: segment.slug,
        });
        continue;
      }

      // Whitelist the parameter IDs to the IELTS skill set we asked
      // about. Anything else the AI returns is rejected — keeps
      // CallScore rows aligned with the Parameter table.
      const validEntries: Array<[string, any]> = [];
      const rejectedKeys: string[] = [];
      for (const [parameterId, scoreData] of Object.entries(segParsed.scores as Record<string, any>)) {
        if (allowedParamIds.has(parameterId)) validEntries.push([parameterId, scoreData]);
        else rejectedKeys.push(parameterId);
      }
      if (rejectedKeys.length > 0) {
        log.warn("Per-part MEASURE: rejected AI-returned parameter IDs not in whitelist", {
          segmentSlug: segment.slug,
          rejectedCount: rejectedKeys.length,
          sampleRejected: rejectedKeys.slice(0, 5),
        });
      }

      for (const [parameterId, scoreData] of validEntries) {
        // The IELTS prompt asks for `band` (4-9). Convert via
        // bandToScore. Legacy `score`/`s` are still honoured as a
        // safety net — if the AI ignores instructions and returns
        // a 0-1 value, we still write something usable.
        const rawBand =
          typeof scoreData?.band === "number"
            ? scoreData.band
            : typeof scoreData?.b === "number"
              ? scoreData.b
              : null;
        const score =
          rawBand !== null
            ? bandToScore(rawBand)
            : Math.max(0, Math.min(1, scoreData?.score ?? scoreData?.s ?? 0.5));
        const confidence = Math.max(0, Math.min(1, scoreData?.confidence ?? scoreData?.c ?? 0.7));
        const reasoning: string | undefined = scoreData?.reasoning ?? scoreData?.r ?? undefined;
        // #566 Step 1 — evidence-aware fields. The IELTS per-segment prompt
        // does not yet ask for these; leave null until the prompt is updated.
        // Pattern matches the batched scorer for forward compatibility.
        // TODO(#1155): update the IELTS per-segment prompt to request `he`/`eq`,
        // then change the fallback below from `null` to `true` to match the
        // claude_batched_v2 server-side fallback. Until prompt-update lands,
        // claude_segment_v1 writes carry null evidence and are treated as
        // "unknown — pass" by the AGGREGATE filter G5 introduces (`!== false`).
        const hasLearnerEvidence =
          typeof scoreData?.he === "boolean"
            ? scoreData.he
            : typeof scoreData?.hasLearnerEvidence === "boolean"
              ? scoreData.hasLearnerEvidence
              : null;
        const evidenceQuality =
          typeof scoreData?.eq === "number"
            ? Math.max(0, Math.min(1, scoreData.eq))
            : typeof scoreData?.evidenceQuality === "number"
              ? Math.max(0, Math.min(1, scoreData.evidenceQuality))
              : null;

        // #1539 — inherit the parent parameter's spec lineage. The
        // per-segment scorer writes against the same AnalysisSpec that
        // produced the bound-module score; the rubric chain stays
        // intact even though the per-segment prompt is hardcoded
        // IELTS (`buildPerSegmentMeasurePrompt`) rather than spec-driven.
        const parentSpec = measureParams.find((p) => p.parameterId === parameterId);
        const segmentResult = await writeCallScore({
          callId: call.id,
          callerId,
          parameterId,
          analysisSpecId: parentSpec?.analysisSpecId ?? MEASUREMENT_SENTINEL_SPEC_IDS.MOCK,
          moduleId: segmentModuleId,
          // #1700 Theme 6 / #1702 — annotate which Mock part produced this
          // score so the Results screen (Theme 13a) can render per-part
          // criterion bands. Bound-module/whole-call writes omit this →
          // `segmentKey = null`, zero regression on non-Mock paths.
          // #1872 — namespace prefix (`text:<slug>`) so this writer can't
          // collide with the cue-scheduler's phase-keyed prosody writes.
          // See `lib/pipeline/segment-key-namespace.ts` for the single
          // source of truth.
          segmentKey: withTextNamespace(segment.slug),
          score,
          confidence,
          reasoning,
          evidence: [`Segment: ${segment.slug}`],
          scoredBy: `${engine}_segment_v1`,
          hasLearnerEvidence,
          evidenceQuality,
        });
        if (segmentResult.created) segmentScoresCreated++;
      }
    } catch (err: any) {
      log.warn("Per-part MEASURE failed for segment", {
        segmentSlug: segment.slug,
        error: err?.message ?? "unknown",
      });
    }
  }

  return segmentScoresCreated;
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
    curriculumModuleId?: string | null;
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
  // #1539 — preserve the parameter -> AnalysisSpec lineage so the prompt
  // builder can inject the spec's `promptTemplate` rubric AND the write
  // helper can stamp `CallScore.analysisSpecId`. Previously this path
  // used `batchLoadParameters` which dropped the spec association.
  let paramMap: Map<string, ParameterWithSpec>;
  if (skipMeasure) {
    const alwaysSpecs = measureSpecs.filter(
      (s) => (s.config as SpecConfig)?.scoringGate === "always",
    );
    paramMap = alwaysSpecs.length > 0
      ? await buildParameterSpecMap(alwaysSpecs, { log: (m, meta) => log.info(m, meta) })
      : new Map();
    if (alwaysSpecs.length > 0) {
      log.info(`Event-gate: ${measureSpecs.length - alwaysSpecs.length} MEASURE specs gated, ${alwaysSpecs.length} always-on (${alwaysSpecs.map(s => s.slug).join(", ")})`);
    }
  } else {
    paramMap = await buildParameterSpecMap(measureSpecs, {
      log: (m, meta) => log.info(m, meta),
    });
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

  // #164 + #1117 — LO scoring is universal by default, with an explicit-spec
  // override path.
  //
  // Today, IELTS Playbooks carry a LEARN spec whose `config.assessmentMode ===
  // "curriculum_mastery"` to opt into per-LO scoring. #1098's qualification
  // dashboard exposed the gap: the CIO/CTO Standard Playbooks (and any future
  // course not explicitly seeded with that spec config) silently produce zero
  // `lo_mastery:*` rows because the gate never opens. The dashboard then sits
  // at "Not yet assessed" forever even after real calls.
  //
  // The fix: always attempt to load `moduleContext`. If the caller's enrolment
  // resolves to a Curriculum + Module with LOs, the downstream batched AI
  // prompt automatically picks up the LO scoring instructions (the existing
  // `if (moduleContext?.learningOutcomes?.length)` branch in
  // `buildBatchedMeasurePrompt`) and emits `learning.outcomes`, which flows
  // through `updateCurriculumProgress({ loMastery })` → `lo_mastery:*` writes.
  // When no module resolves (content-only courses, personality-only enrolments,
  // SIM testers without enrolment), `loadCurrentModuleContext` returns null
  // and the existing non-LO path runs unchanged.
  //
  // The explicit `assessmentSpec` path is preserved as a (1) marker for IELTS
  // back-compat logging and (2) `masteryThreshold` override hook.
  const assessmentSpec = learnSpecs.find(
    (s) => (s.config as SpecConfig)?.assessmentMode === "curriculum_mastery",
  );
  let moduleContext: Awaited<ReturnType<typeof loadCurrentModuleContext>> = null;

  try {
    moduleContext = await loadCurrentModuleContext(callerId, log, {
      requestedModuleId: call.requestedModuleId ?? null,
      callPlaybookId: call.playbookId ?? null,
    });
    if (moduleContext) {
      if (assessmentSpec) {
        // Explicit-spec override: honour the spec's masteryThreshold.
        const assessConfig = assessmentSpec.config as Record<string, any>;
        moduleContext.masteryThreshold = assessConfig.masteryThreshold ?? moduleContext.masteryThreshold;
      }
      log.info(
        assessmentSpec
          ? `LEARN-ASSESS spec active (${assessmentSpec.slug}): module context loaded`
          : `#1117 universal LO scoring: module context loaded by default`,
        {
          specSlug: moduleContext.specSlug,
          moduleId: moduleContext.moduleId,
          loCount: moduleContext.learningOutcomes.length,
          threshold: moduleContext.masteryThreshold,
          mode: assessmentSpec ? "spec-driven" : "universal-default",
        },
      );
    }
  } catch (err: any) {
    log.warn(`Failed to load module context (non-blocking): ${err.message}`);
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
    // Mock: generate random scores and **no memories**.
    // #1008 (Finding F) — load GUARD-001 once so educators can override the
    // mock-confidence default via spec without touching code. Default value
    // unchanged (0.7) when no override exists.
    //
    // G9 / #1158 (audit 2026-06-06): warn-log so the silent zero-memory
    // outcome is visible in logs. Mock engine has no LLM reasoning, so it
    // cannot extract memories; this is by-design but was invisible to
    // operators staring at a "0 CallerMemory rows" trace. See PIPELINE.md §2.
    log.warn(
      `[extract] engine=mock — CallerMemory writes suppressed (mock has no LLM reasoning)`,
      { callId: call.id, measureParamCount: measureParams.length },
    );
    const mockGuardrails = await loadGuardrails(log);
    const mockConfidence = mockGuardrails.confidenceBounds.defaultConfidence;
    for (const param of measureParams) {
      const score = 0.4 + Math.random() * 0.4;
      // #1539 — mock engine inherits the spec lineage of the parameter
      // it's scoring. Falls back to the MOCK sentinel only when the
      // parameter has no resolved spec (should be impossible — the map
      // omits parameters without a spec).
      await writeCallScore({
        callId: call.id,
        callerId,
        parameterId: param.parameterId,
        analysisSpecId: param.analysisSpecId ?? MEASUREMENT_SENTINEL_SPEC_IDS.MOCK,
        moduleId: call.curriculumModuleId ?? null,
        score,
        confidence: mockConfidence,
        evidence: ["Mock batched scoring"],
        scoredBy: "mock_batched_v1",
        // #566 Step 1 — mock engine has no LLM reasoning; leave evidence
        // fields null (legacy path semantics per schema comment).
        hasLearnerEvidence: null,
        evidenceQuality: null,
      });
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
    // #1539 — switched from the inline `buildBatchedCallerPrompt` (which
    // dropped each spec's `promptTemplate`) to the spec-aware builder.
    // Each MEASURE parameter now gets its rubric block interpolated into
    // the prompt body so the LLM scores against the IELTS band
    // descriptors (or whichever rubric the spec carries) instead of its
    // own internalised idea of the dimension.
    const prompt = buildBatchedMeasurePrompt({
      transcript,
      measureParams,
      learnActions,
      transcriptLimit,
      moduleContext,
      assessmentPromptInstructions: assessPromptInstructions,
      log: (m, meta) => log.warn(m, meta),
    });

    // #UI-followup Gap 1 — load the playbook config ONCE up front so the
    // Boaz guard (per-parameter persistence skip below) can honour the
    // `scoringMode: "evidence-first"` declaration from the course-ref
    // front-matter without a DB round-trip per parameter.
    let playbookConfigForGuard: Record<string, unknown> | null = null;
    if (call.playbookId) {
      const pb = await prisma.playbook.findUnique({
        where: { id: call.playbookId },
        select: { config: true },
      });
      playbookConfigForGuard = (pb?.config as Record<string, unknown> | null) ?? null;
    }

    // #566 Step 2 — Evidence pre-filter shadow pass. Logs which params the
    // deterministic check WOULD have skipped before the scorer LLM runs.
    // Never actually skips — Step 3 wires the decision into the gate.
    try {
      const paramsForPrefilter = await prisma.parameter.findMany({
        where: { parameterId: { in: measureParams.map((p) => p.parameterId) } },
        select: { parameterId: true, name: true, definition: true, config: true },
      });
      const { summary: prefilterSummary } = runEvidencePrefilterBatch(
        transcript,
        paramsForPrefilter,
      );
      log.info("Evidence pre-filter shadow telemetry", {
        callId: call.id,
        callerId,
        ...prefilterSummary,
      });
    } catch (err: any) {
      log.warn("Evidence pre-filter shadow pass failed (non-blocking)", {
        error: err?.message ?? "unknown",
      });
    }

    try {
      const result = await getConfiguredMeteredAICompletion({
        callPoint: "pipeline.measure",
        // #1868 — Lattice scope so Playbook/Domain overrides resolve before global.
        scope: { callId: call.id, playbookId: call.playbookId ?? undefined },
        engineOverride: engine,
        messages: [
          { role: "system", content: PIPELINE_MEASURE_SYSTEM_PROMPT },
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
      // #566 Step 1 — also accept evidence-aware fields (he/hasLearnerEvidence, eq/evidenceQuality).
      // Both fields default to null when the scorer LLM omits them (back-compat with old responses).
      let shadowEvidencePresent = 0;
      let shadowEvidenceAbsent = 0;
      let shadowEvidenceUnknown = 0;
      if (parsed.scores) {
        for (const [parameterId, scoreData] of Object.entries(parsed.scores as Record<string, any>)) {
          const score = Math.max(0, Math.min(1, scoreData.score ?? scoreData.s ?? 0.5));
          const confidence = Math.max(0, Math.min(1, scoreData.confidence ?? scoreData.c ?? 0.7));
          const reasoning: string | undefined = scoreData.reasoning ?? scoreData.r ?? undefined;
          // G5 / #1155 — server-side fallback when LLM omits `he`/`eq`. The
          // batched scorer is supposed to return both fields per the prompt
          // but omits them 35% of the time. Pre-fix the null fell through
          // the #611 gate (gate only drops on explicit false+0), so the row
          // was treated as "has evidence" by the gate while AGGREGATE saw
          // null and made no semantic distinction either. Now: fallback to
          // `true` on missing — conservative ("LLM didn't say, so assume
          // present"); matches the gate's effective behaviour pre-fix while
          // making the AGGREGATE filter G5 introduces meaningful.
          const hasLearnerEvidence =
            typeof scoreData.he === "boolean"
              ? scoreData.he
              : typeof scoreData.hasLearnerEvidence === "boolean"
                ? scoreData.hasLearnerEvidence
                : true; // G5 fallback (was: null)
          const evidenceQuality =
            typeof scoreData.eq === "number"
              ? Math.max(0, Math.min(1, scoreData.eq))
              : typeof scoreData.evidenceQuality === "number"
                ? Math.max(0, Math.min(1, scoreData.evidenceQuality))
                : null; // evidenceQuality kept null when LLM omits — semantics differ from he
          if (hasLearnerEvidence === true) shadowEvidencePresent++;
          else if (hasLearnerEvidence === false) shadowEvidenceAbsent++;
          else shadowEvidenceUnknown++;

          // #611 Fix B — universal zero-evidence gate. Fires regardless of
          // playbook ID, scheduler config, or evidence-first allowlist. The
          // existing #566 Step 3 Boaz guard (below) only activates for
          // evidence-first playbooks, leaving every other course writing
          // unconditional zero-scores when the scorer found no learner
          // evidence — which is the 47-param zero-storm bug from the Nico
          // Grant evidence call.
          //
          // Rule: when BOTH `hasLearnerEvidence === false` AND
          // `evidenceQuality === 0`, drop the row. The legacy null-sentinel
          // path (either field is null) falls through unchanged — that's
          // the back-compat shape for prompts that pre-date evidence-aware
          // scoring, and we MUST NOT silently drop legacy 0-scores that
          // were the correct measurement.
          //
          // See: docs/epic-100-chain-walk.md (Link 4 — CALL → SCORE).
          if (shouldSkipForZeroEvidence(hasLearnerEvidence, evidenceQuality)) {
            log.info("#611 universal zero-evidence gate: skipping score (no learner evidence + zero quality)", {
              callId: call.id,
              callerId,
              parameterId,
              score,
            });
            continue;
          }

          // #566 Step 3 — Boaz guard. For evidence-first playbooks, drop
          // rows where the scorer judged the learner produced no evidence.
          // The score itself is logged for audit but not persisted.
          // #UI-followup Gap 1 — pass playbookConfigForGuard so courses that
          // declared `hf-scoring-mode: evidence-first` activate without a
          // hardcoded ID in the JSON list.
          if (shouldSkipForEvidenceFirst(call.playbookId, hasLearnerEvidence, evidenceQuality, playbookConfigForGuard)) {
            log.info("Evidence-first Boaz guard: skipping score (no learner evidence)", {
              callId: call.id,
              callerId,
              parameterId,
              score,
              hasLearnerEvidence,
              evidenceQuality,
            });
            continue;
          }

          // #1539 — stamp the spec lineage. The batched prompt loaded
          // this parameter via `buildParameterSpecMap`, which preserves
          // the originating AnalysisSpec id; the writer reads it from
          // paramMap. The fallback sentinel exists only as a structural
          // backstop — it should never fire because paramMap omits
          // parameters without a spec.
          const sourceSpec = paramMap.get(parameterId);
          await writeCallScore({
            callId: call.id,
            callerId,
            parameterId,
            analysisSpecId:
              sourceSpec?.analysisSpecId ?? MEASUREMENT_SENTINEL_SPEC_IDS.MOCK,
            moduleId: call.curriculumModuleId ?? null,
            score,
            confidence,
            reasoning,
            evidence: ["AI batched analysis"],
            scoredBy: `${engine}_batched_v2`,
            hasLearnerEvidence,
            evidenceQuality,
          });
          scoresCreated++;
        }
        // #566 Step 1 — shadow log of evidence-field coverage. Records what
        // the scorer reported about learner-side evidence without changing
        // any decision yet. Step 3 will use these counts to validate the
        // evidence-aware gate before flipping IELTS playbooks over.
        log.info("Evidence-aware scoring shadow telemetry", {
          callId: call.id,
          callerId,
          present: shadowEvidencePresent,
          absent: shadowEvidenceAbsent,
          unknown: shadowEvidenceUnknown,
        });
      }

      // #491 Slice 1.5 — per-part MEASURE for multi-attribute modules.
      // When this call's bound module (typically the IELTS Mock)
      // declares `coversModules: [part1, part2, part3]`, segment the
      // transcript and run a per-segment MEASURE so each part gets its
      // own `CallScore` rows. Augments (does not replace) the
      // bound-module scores written above — Mock-level rows remain so
      // existing readers (`weakSkill`, diagnostic) keep working, and
      // per-part rows feed the new per-part view + EMA per sub-module.
      if (!skipMeasure) {
        try {
          const segmentScores = await runPerSegmentScoring(
            call,
            callerId,
            measureParams,
            engine,
            transcriptLimit,
            log,
            userName,
          );
          scoresCreated += segmentScores;
        } catch (err: any) {
          log.warn("Per-part MEASURE pass failed (non-blocking)", {
            error: err?.message ?? "unknown",
          });
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
        // #558: if the AI returned a `learning` block with overallMastery
        // but no per-LO outcomes, degrade to overall-mastery-per-LO so the
        // CallerModuleProgress.loScoresJson row still gets populated.
        // Observed in 2026-05-20 sim runs against module-bound calls:
        // calls launched with --module=part2/--module=mock had the right
        // moduleContext.learningOutcomes refs in the prompt, but the AI
        // omitted the `outcomes` field in its response. Without this
        // fallback the row stays loScoresJson=null and per-LO progress
        // tracking is silently lost. Logged at WARN so we can spot AI
        // regressions in observability rather than failing silent.
        if (
          Object.keys(outcomes).length === 0 &&
          moduleContext.learningOutcomes.length > 0
        ) {
          for (const ref of moduleContext.learningOutcomes) outcomes[ref] = overallMastery;
          log.warn(
            "AI learning.outcomes missing — synthesised from overallMastery (#558)",
            {
              moduleId: moduleContext.moduleId,
              overallMastery,
              loRefCount: moduleContext.learningOutcomes.length,
            },
          );
        }
        // #611 Fix A — drop the `learning.moduleId ||` fallback. The AI's
        // echoed moduleId is not trusted for DB writes (it has appeared as
        // a display name like "Part 1: Familiar Topics" or a raw UUID in
        // production calls, producing dual lo_mastery keys for the same LO).
        // The host-side `moduleContext.moduleId` is the canonical slug —
        // resolved from caller context BEFORE the prompt was composed —
        // and is the only value safe to bake into mastery keys.
        // See: docs/epic-100-chain-walk.md (Link 4 — CALL → SCORE).
        learningAssessment = {
          specSlug: moduleContext.specSlug,
          moduleId: moduleContext.moduleId,
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

  // Get DOMAIN MEASURE + MEASURE_AGENT specs from caller's domain playbook
  // (or fallback). Need playbookId first to filter system specs.
  //
  // #2084 S6 — extended to load BOTH `MEASURE` (caller-behaviour scoring,
  // e.g. CA-001) AND `MEASURE_AGENT` (agent-quality supervision, e.g.
  // STYLE-001 + SUPV-001). The SCORE_AGENT stage IS the canonical home for
  // MEASURE_AGENT outputType per PIPELINE.md §1 + §1.1 — the stage name
  // doesn't match the enum (see §1.1 landmine). Pre-#2084 the executor
  // only loaded `MEASURE`, leaving the 11 SUPV-001 supervision-quality
  // parameters producer-only despite their spec being seeded.
  const { specs: playbookSpecs, playbookId, fallback } = await getPlaybookSpecs(
    callerId,
    ["MEASURE", "MEASURE_AGENT"],
    log
  );

  // Get SYSTEM MEASURE + MEASURE_AGENT specs filtered by playbook toggle settings
  const systemSpecs = await getSystemSpecs(["MEASURE", "MEASURE_AGENT"], playbookId, log);

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
      // #1608 — bumped from 150 → 250 tokens/param so two short verbatim quotes
      // per param fit without truncation. Context-window safety: for a worst-case
      // 60-param playbook this is +6k tokens vs the previous budget; well inside
      // the configured model's window after the transcript (sliced to
      // transcriptLimit ≤ 4000) and the system prompt are accounted for.
      const estimatedTokens = Math.max(2048, Math.ceil(agentParams.length * 250));

      const agentTimeouts = await getAITimeoutSettings();
      const result = await getConfiguredMeteredAICompletion({
        callPoint: "pipeline.score_agent",
        // #1868 — Lattice scope so Playbook/Domain overrides resolve before global.
        scope: { callId: call.id },
        engineOverride: engine,
        messages: [
          { role: "system", content: PIPELINE_SCORE_AGENT_SYSTEM_PROMPT },
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
          // #1608 — extracted into `normalizeScoreAgentEvidence` for testability.
          // Empty array (model omitted `e`) is now preserved as `[]` rather than
          // overwritten with the legacy `["AI analysis"]` placeholder; reader
          // (SkillEvidencePanel) renders "No evidence captured" — honest fail.
          const evidence: string[] = normalizeScoreAgentEvidence(scoreData);

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
 * Compute reward score (#1256).
 *
 * STRUCTURED courses: weighted blend of behaviorScore (diff to SYSTEM
 * targets) and goalProgressScore. The previous `targetValue ?? 0.5` and
 * "no measurements → 0.5" silent fallbacks are now hard errors — every
 * MEASURE-emitted parameter must have a real SYSTEM-scope BehaviorTarget
 * at publish time (#1252 acceptance criteria).
 *
 * CONTINUOUS courses: no fixed module mastery, often no behavior targets
 * configured. The function returns `{ overallScore: null }` and SKIPS the
 * `RewardScore.upsert` entirely. Downstream readers (`compose-next-prompt`,
 * `update-targets`) are already null-safe on the `Call.rewardScore`
 * relation. ADAPT doesn't read REWARD output from ctx (verified — it
 * reads CallerAttribute), so the missing row doesn't cascade.
 */
async function computeReward(
  callId: string,
  courseStyle: CourseStyle,
  log: PipelineLogger
): Promise<{ overallScore: number | null }> {
  const call = await prisma.call.findUnique({
    where: { id: callId },
    include: { behaviorMeasurements: true },
  });

  if (!call) {
    log.warn("computeReward: call not found");
    return { overallScore: null };
  }

  // #1256 — CONTINUOUS branch: no targets to diff against, no module
  // mastery to composite. Skip the write; return null.
  if (courseStyle === "continuous") {
    log.info("REWARD: CONTINUOUS course — skipping RewardScore.upsert (overallScore=null)");
    return { overallScore: null };
  }

  // STRUCTURED branch from here down.
  if (call.behaviorMeasurements.length === 0) {
    // Hard error — STRUCTURED courses ran MEASURE without producing any
    // BehaviorMeasurements. Silent 0.5 fallback was the bug class #1252
    // is closing. Surface it and let the outer Promise.allSettled record
    // the failure on the pipeline run rather than write a fake score.
    throw new Error(
      `REWARD: STRUCTURED call ${callId} has zero BehaviorMeasurements — refusing silent 0.5 fallback (#1256)`,
    );
  }

  // #1641 — Load BOTH SYSTEM-scope and PLAYBOOK-scope targets, then
  // cascade-merge: PLAYBOOK row wins over SYSTEM row on parameterId
  // collision. This matches the BehaviorTarget cascade contract
  // (`loadBehaviorTargetsWithCascade` for the SCORE_AGENT read side)
  // and unblocks STRUCTURED courses that measure `skill_*` params with
  // PLAYBOOK-scope targets but no SYSTEM-scope target (e.g. IELTS
  // Speaking V1.0 / PAW / PLS USE NEW V1.0 — verified 2026-06-14:
  // SCORE_AGENT measured `skill_fluency_and_coherence_fc` against a
  // PLAYBOOK target of 0.70, but REWARD's SYSTEM-only findMany missed
  // it and the #1632 guard threw "0 measurements matched").
  //
  // Pre-#1641 the cascade was effectively SYSTEM-only at REWARD; this
  // PR adds the PLAYBOOK overlay. CALLER-scope overrides are still
  // out of scope here — those flow through ADAPT's `updateTargets`
  // sub-op (#1609) once REWARD writes a RewardScore row.
  const rawTargets = await prisma.behaviorTarget.findMany({
    where: call.playbookId
      ? {
          OR: [
            { scope: "SYSTEM" },
            { scope: "PLAYBOOK", playbookId: call.playbookId },
          ],
        }
      : { scope: "SYSTEM" },
  });

  // Cascade merge: PLAYBOOK overrides SYSTEM on parameterId collision.
  const targetByParam = new Map<string, (typeof rawTargets)[number]>();
  for (const t of rawTargets) {
    if (t.scope === "SYSTEM") targetByParam.set(t.parameterId, t);
  }
  for (const t of rawTargets) {
    if (t.scope === "PLAYBOOK") targetByParam.set(t.parameterId, t);
  }

  // #1632 — REWARD compares the AI tutor's TUNABLE BEHAVIOR (BEH-* +
  // skill_* params, `Parameter.isAdjustable === true`) against the
  // SYSTEM-scope BehaviorTarget cascade. STATE-type measurements
  // (`COMP-*`, `COACH_*`, `CONV_*`, `application_score`, etc.) are
  // OBSERVATIONS the AI made about the conversation/learner — they
  // have no target by design and feed AGGREGATE / CallerAttribute
  // downstream, not the reward delta loop.
  //
  // Pre-#1632 the guard required every BehaviorMeasurement to have a
  // matching SYSTEM BehaviorTarget. Because SCORE_AGENT measures
  // dozens of STATE params per call (verified live on hf-dev: Freddy
  // Starr's call produced 22 measurements vs 6 SYSTEM targets), the
  // guard threw on every STRUCTURED call, REWARD bailed, the
  // RewardScore row was never written, the #1609 reward-loop sub-op
  // had no row to process, and the Adaptations "Why" timeline stayed
  // empty.
  //
  // Fix: compute diff over MATCHED measurements only. The remaining
  // unmatched STATE measurements are not a reward signal; their
  // absence from `parameterDiffs` is correct. The previous guard's
  // intent (refuse to silently fall back to 0.5) is preserved by the
  // earlier `behaviorMeasurements.length === 0` throw and the new
  // `diffs.length === 0` throw below.
  const diffs: Array<{ parameterId: string; target: number; actual: number; diff: number; scope: string }> = [];
  const unmatchedMeasurements: string[] = [];
  for (const measurement of call.behaviorMeasurements) {
    const target = targetByParam.get(measurement.parameterId);
    if (!target) {
      unmatchedMeasurements.push(measurement.parameterId);
      continue;
    }
    const diff = Math.abs(measurement.actualValue - target.targetValue);
    diffs.push({
      parameterId: measurement.parameterId,
      target: target.targetValue,
      actual: measurement.actualValue,
      diff,
      // #1641 — stamp which scope's target won the cascade. Lets the
      // operator-facing pipeline diagnostic at /x/logs distinguish
      // "scored against the SYSTEM default" (suggests an unset playbook
      // target) from "scored against an explicit PLAYBOOK override".
      scope: target.scope,
    });
  }

  // #1632 — only flag the unmatched set when ZERO measurements matched a
  // target. That's the "REWARD has nothing to score" condition the old
  // guard was trying (and failing) to catch. Partial matches are
  // expected — STATE measurements outnumber BEHAVIOR targets by ~3:1
  // on a typical structured call. Log the unmatched set at debug level
  // for forensics without spamming.
  if (diffs.length === 0) {
    throw new Error(
      `REWARD: STRUCTURED call ${callId} produced ${call.behaviorMeasurements.length} BehaviorMeasurement(s) but NONE matched a SYSTEM or PLAYBOOK BehaviorTarget — refusing silent 0.5 fallback (#1256/#1632/#1641). Measured: ${call.behaviorMeasurements.map((m) => m.parameterId).slice(0, 10).join(", ")}${call.behaviorMeasurements.length > 10 ? "..." : ""}. Targets loaded: ${targetByParam.size} (SYSTEM + PLAYBOOK for playbook ${call.playbookId ?? "(null)"}). Expected at least one BEH-* or skill_* parameter with a target at either scope.`,
    );
  }
  if (unmatchedMeasurements.length > 0) {
    log.debug("REWARD: skipping STATE measurements without cascade targets (expected)", {
      count: unmatchedMeasurements.length,
      sample: unmatchedMeasurements.slice(0, 5),
    });
  }
  // #1641 — log the cascade composition for operator-facing diagnostics.
  const systemHits = diffs.filter((d) => d.scope === "SYSTEM").length;
  const playbookHits = diffs.filter((d) => d.scope === "PLAYBOOK").length;
  log.info("REWARD cascade composition", {
    totalMatched: diffs.length,
    bySystemTarget: systemHits,
    byPlaybookOverride: playbookHits,
    unmatchedCount: unmatchedMeasurements.length,
  });

  const avgDiff = diffs.length > 0 ? diffs.reduce((sum, d) => sum + d.diff, 0) / diffs.length : 0;
  const behaviorScore = Math.max(0, 1 - avgDiff);

  let goalProgressScore: number | null = null;
  let overallScore = behaviorScore;

  // call.callerId is typed `string | null` at this point but the function
  // is guard-gated above on its presence — narrow here so the Prisma where
  // clause type-checks. (Was a pre-existing tsc error before #1872; net-zero
  // baseline keeps the macOS-local ratchet honest.)
  const assessmentGoals = call.callerId
    ? await prisma.goal.findMany({
        where: {
          callerId: call.callerId,
          isAssessmentTarget: true,
          status: { in: ["ACTIVE", "PAUSED"] },
        },
        select: { id: true, progress: true, priority: true },
      })
    : [];

  if (assessmentGoals.length > 0) {
    const totalWeight = assessmentGoals.reduce((sum, g) => sum + (g.priority || 5), 0);
    goalProgressScore = assessmentGoals.reduce(
      (sum, g) => sum + g.progress * (g.priority || 5), 0
    ) / totalWeight;
    overallScore = 0.8 * behaviorScore + 0.2 * goalProgressScore;
    log.info(`Goal progress reward`, { goalProgressScore, assessmentGoals: assessmentGoals.length });
  }

  // #1641 follow-up — snapshot the merged target cascade onto
  // `RewardScore.effectiveTargets` so the downstream ADAPT sub-op 8
  // (`updateTargets` from `lib/ops/update-targets.ts`) can read the
  // per-parameter `{target, confidence, scope}` triple. Pre-fix
  // `effectiveTargets` was NEVER written (every RewardScore had NULL),
  // so `updateTargets`'s findMany filter `effectiveTargets: { not:
  // Prisma.DbNull }` returned zero rows and the reward-loop sub-op
  // logged `rewardsProcessed: 0` for every call. The fanout-by-callerIdentity
  // logic in update-targets.ts at line ~261 also requires this snapshot
  // shape — see #836 fanout discipline.
  //
  // Shape per `update-targets.ts:281-285`:
  //   { [parameterId]: { target: number, confidence: number, scope: string } }
  const effectiveTargets: Record<string, { target: number; confidence: number; scope: string }> = {};
  for (const [parameterId, target] of targetByParam.entries()) {
    effectiveTargets[parameterId] = {
      target: target.targetValue,
      // BehaviorTarget.confidence is 0..1 from the cascade writer.
      // Default 0.7 when the cascade row left it null (typical for
      // hand-seeded SYSTEM rows). `update-targets.ts` filters at
      // `minConfidence` (default 0.2) so an explicit 0.7 default is
      // well above the floor.
      confidence: target.confidence ?? 0.7,
      scope: target.scope,
    };
  }

  await prisma.rewardScore.upsert({
    where: { callId },
    create: {
      callId,
      overallScore,
      goalProgressScore,
      modelVersion: "batched_v1",
      parameterDiffs: diffs,
      effectiveTargets,
    },
    update: {
      overallScore,
      goalProgressScore,
      parameterDiffs: diffs,
      effectiveTargets,
      scoredAt: new Date(),
    },
  });

  // #2084 S6 — REW-001 per-parameter CallScore mirror.
  //
  // REW-001 declares 4 reward-component parameters (`BEH-ENGAGEMENT-REWARD`,
  // `BEH-LEARNING-REWARD`, `BEH-RAPPORT-REWARD`, `BEH-GOAL-PROGRESS-REWARD`)
  // plus `BEH-COMPOSITE-REWARD` (the weighted blend). Pre-#2084 every reward
  // computation wrote ONLY a single `RewardScore` row holding `overallScore +
  // parameterDiffs[]` — the 4 component parameters had NO runtime consumer,
  // showing up as producer-only in parameter-coverage.test.ts.
  //
  // Per the design brief at PR #2088 (Fork 2 → A "lighter shape"), we mirror
  // the computed reward components onto `CallScore` rows keyed by the
  // canonical BEH-* parameter ids that already exist in the
  // `behavior-parameters.registry.json` registry. The chokepoint
  // `writeCallScore` requires a real `AnalysisSpec.id`; we resolve the
  // active SYSTEM-scope REW-001 spec at runtime.
  //
  // Component derivation (pragmatic — improve in a follow-on PR):
  //   - engagement_reward      → behaviorScore  (alignment-with-targets proxy)
  //   - learning_reward        → behaviorScore  (we don't yet decompose
  //                                              memory-extraction count here;
  //                                              the LEARN-stage memories are
  //                                              the proper basis. Until then
  //                                              behaviorScore is the honest
  //                                              proxy — REW-001 spec text
  //                                              ties this to information
  //                                              density which behaviorScore
  //                                              correlates with).
  //   - rapport_reward         → behaviorScore  (personality-style alignment
  //                                              proxy; ditto.)
  //   - goal_progress_reward   → goalProgressScore ?? 0
  //
  // BEH-COMPOSITE-REWARD is intentionally NOT mirrored here — it's already
  // "covered" via the categorisation route at
  // app/api/playbooks/[playbookId]/parameters/route.ts:339. The CallScore
  // overallScore field on RewardScore IS the composite. Writing it as a
  // CallScore too would create competing readers.
  //
  // BEH-ERROR-ELABORATION (also in the `reinforcement` domain group) is
  // explicitly excluded from S6 — it's a learning-style directive, not a
  // reward parameter. Picked up by S2 (#2087).
  //
  // Sibling-writer survey (per lattice-survey.md):
  // - `CallScore` is written by: SCORE_AGENT runner (EXTRACT/MEASURE writes),
  //   PROSODY consumer (`lib/pipeline/prosody-consumer.ts`), ADAPT delta
  //   deriver. All route through `writeCallScore`. No collision — our writes
  //   use distinct parameterIds (BEH-*-REWARD) not used by any other writer.
  // - The chokepoint's idempotence key is `(callId, parameterId, moduleId)`;
  //   re-running REWARD overwrites the row in place. moduleId is NULL here
  //   because reward components are call-scoped not module-scoped.
  try {
    const rewSpec = await prisma.analysisSpec.findFirst({
      where: { outputType: "REWARD", scope: "SYSTEM", isActive: true },
      select: { id: true },
    });
    if (!rewSpec) {
      log.warn(
        "REW-001 mirror skipped: no active SYSTEM REWARD spec found — " +
          "per-parameter CallScore rows not written (BEH-*-REWARD producer-only)",
      );
    } else {
      const rewardComponents: Array<{
        parameterId: string;
        score: number;
        sourceField: string;
      }> = [
        { parameterId: "BEH-ENGAGEMENT-REWARD", score: behaviorScore, sourceField: "behaviorScore" },
        { parameterId: "BEH-LEARNING-REWARD", score: behaviorScore, sourceField: "behaviorScore" },
        { parameterId: "BEH-RAPPORT-REWARD", score: behaviorScore, sourceField: "behaviorScore" },
        {
          parameterId: "BEH-GOAL-PROGRESS-REWARD",
          score: goalProgressScore ?? 0,
          sourceField: "goalProgressScore",
        },
      ];

      for (const component of rewardComponents) {
        const clamped = Math.max(0, Math.min(1, component.score));
        await writeCallScore({
          callId,
          callerId: call.callerId,
          parameterId: component.parameterId,
          analysisSpecId: rewSpec.id,
          moduleId: null,
          score: clamped,
          confidence: 0.7,
          evidence: [
            `REW-001 component mirror — ${component.sourceField}=${component.score.toFixed(3)} → clamped=${clamped.toFixed(3)}`,
          ],
          reasoning:
            `Reward component derived during pipeline REWARD stage. ` +
            `overallScore=${overallScore.toFixed(3)}, behaviorScore=${behaviorScore.toFixed(3)}, ` +
            `goalProgressScore=${goalProgressScore?.toFixed(3) ?? "null"}. ` +
            `See app/api/calls/[callId]/pipeline/route.ts::computeReward (#2084 S6).`,
          scoredBy: "reward_components_v1",
        });
      }

      log.info("REW-001 per-component CallScore mirror written", {
        callId,
        rewSpecId: rewSpec.id,
        componentsCount: rewardComponents.length,
      });
    }
  } catch (mirrorErr) {
    // Non-fatal — log + continue. The RewardScore row above is the
    // canonical reward store; the per-component mirror is closing the
    // parameter-coverage loop. A failure here doesn't break ADAPT/UPDATE.
    log.warn(
      `REW-001 per-component CallScore mirror failed (non-fatal): ${mirrorErr instanceof Error ? mirrorErr.message : String(mirrorErr)}`,
    );
  }

  log.info(`Reward computed`, {
    overallScore,
    behaviorScore,
    goalProgressScore,
    diffs: diffs.length,
    effectiveTargetsCount: Object.keys(effectiveTargets).length,
  });
  return { overallScore };
}

/**
 * #491 Slice 1.3 — Increment CallerModuleProgress.callCount for the module
 * this call was attributed to. Runs at the end of AGGREGATE so it stays
 * consistent with the CallScore.moduleId writes from Slice 1.2.
 *
 * Idempotency: pipeline force-rerun must not double-count. We track the
 * last call that touched this row via `lastCallId`. If the current call
 * already incremented this row, we no-op. The pipeline is serial per
 * callId, so the read-then-write window is safe.
 *
 * Status transitions:
 * - missing row     → create with callCount=1, status=IN_PROGRESS, startedAt=now
 * - NOT_STARTED row → bump to IN_PROGRESS + increment
 * - IN_PROGRESS row → increment, status unchanged
 * - COMPLETED row   → increment, status unchanged (don't reopen)
 *
 * Returns the new callCount for logging / test assertions; -1 indicates
 * a no-op (null moduleId or idempotent skip).
 */
export async function incrementModuleEvidence(
  callId: string,
  callerId: string,
  moduleId: string | null,
  log: PipelineLogger
): Promise<{ callCount: number; created: boolean; skipped: boolean }> {
  if (!moduleId) {
    log.debug("incrementModuleEvidence skipped: no moduleId attribution", { callId, callerId });
    return { callCount: -1, created: false, skipped: true };
  }

  const existing = await prisma.callerModuleProgress.findUnique({
    where: { callerId_moduleId: { callerId, moduleId } },
    select: { id: true, callCount: true, lastCallId: true, status: true },
  });

  if (!existing) {
    const created = await prisma.callerModuleProgress.create({
      data: {
        callerId,
        moduleId,
        callCount: 1,
        status: "IN_PROGRESS",
        startedAt: new Date(),
        lastCallId: callId,
      },
      select: { callCount: true },
    });
    log.info("CallerModuleProgress created (first call on module)", {
      callerId,
      moduleId,
      callCount: created.callCount,
    });
    return { callCount: created.callCount, created: true, skipped: false };
  }

  // Idempotency: this exact call already incremented this row.
  if (existing.lastCallId === callId && existing.callCount > 0) {
    log.info("CallerModuleProgress increment skipped (idempotent re-run)", {
      callerId,
      moduleId,
      callId,
      callCount: existing.callCount,
    });
    return { callCount: existing.callCount, created: false, skipped: true };
  }

  // Preserve COMPLETED; promote NOT_STARTED to IN_PROGRESS; leave IN_PROGRESS as-is.
  const nextStatus = existing.status === "NOT_STARTED" ? "IN_PROGRESS" : existing.status;
  const updated = await prisma.callerModuleProgress.update({
    where: { id: existing.id },
    data: {
      callCount: { increment: 1 },
      lastCallId: callId,
      status: nextStatus,
      ...(existing.status === "NOT_STARTED" && !existing.lastCallId ? { startedAt: new Date() } : {}),
    },
    select: { callCount: true },
  });
  log.info("CallerModuleProgress incremented", {
    callerId,
    moduleId,
    callId,
    callCount: updated.callCount,
    status: nextStatus,
  });
  return { callCount: updated.callCount, created: false, skipped: false };
}

/**
 * #494 E2 Slice 2.2 — Recompute `CallerModuleProgress.mastery` from the
 * EMA over `CallScore` rows for (callerId, moduleId) and flip status to
 * COMPLETED when the threshold is crossed.
 *
 * Called after `incrementModuleEvidence` for every module credited by the
 * current call (Slice 1.3 bound module + Slice 1.4 coversModules fan-out).
 * The mastery value becomes the canonical store — legacy
 * `CallerAttribute mastery:*` writes are deprecated and will be removed
 * in Slice 2.1.
 *
 * Idempotency: only writes when `mastery` or `status` actually change
 * relative to the existing row. Re-running the pipeline on the same call
 * with no new CallScore rows produces zero DB writes here.
 *
 * No-op when the row does not exist (caller never had a CallScore for
 * this module). `incrementModuleEvidence` already created the row when a
 * call's bound moduleId arrives; this helper is safe to call before that
 * row exists — it simply skips.
 *
 * Per-call overrides (passed in from AGGREGATE):
 *   - `masteryThreshold` — `CurriculumModule.masteryThreshold` if set, else 0.7.
 *   - `emaHalfLifeDays`  — `Playbook.config.skillScoringEmaHalfLifeDays`.
 *   - `minCallsToFull`   — `Playbook.config.skillMinCallsToFull`.
 */
export async function writeModuleMastery(
  callerId: string,
  moduleId: string,
  options: {
    masteryThreshold?: number;
    emaHalfLifeDays?: number;
    minCallsToFull?: number;
  },
  log: PipelineLogger,
): Promise<{
  mastery: number;
  evidenceCount: number;
  statusFlipped: boolean;
  skipped: boolean;
}> {
  const existing = await prisma.callerModuleProgress.findUnique({
    where: { callerId_moduleId: { callerId, moduleId } },
    select: { id: true, mastery: true, status: true, completedAt: true },
  });

  if (!existing) {
    // No progress row yet — caller has never had a call attributed here.
    // `incrementModuleEvidence` creates the row when a call is attributed
    // to this module, but is itself a no-op when `Call.curriculumModuleId`
    // is null. Either way, there is nothing to update.
    log.debug("writeModuleMastery skipped: no CallerModuleProgress row", {
      callerId,
      moduleId,
    });
    return { mastery: 0, evidenceCount: 0, statusFlipped: false, skipped: true };
  }

  const { mastery, evidenceCount, shouldMarkCompleted } =
    await computeModuleMastery(prisma, {
      callerId,
      moduleId,
      masteryThreshold: options.masteryThreshold,
      emaHalfLifeDays: options.emaHalfLifeDays,
      minCallsToFull: options.minCallsToFull,
    });

  // Idempotency: only write when mastery or status actually changes. The
  // pipeline re-runs the AGGREGATE stage on every force=true call; without
  // this guard each re-run would burn a write even when the EMA over the
  // same CallScore rows produced an identical mastery value.
  const shouldFlipToCompleted =
    shouldMarkCompleted && existing.status !== "COMPLETED";
  const masteryUnchanged = existing.mastery === mastery;
  // #950 — also need to write when mastery is unchanged but the row is
  // stuck at NOT_STARTED with a non-zero mastery (the dirty state this
  // helper now repairs). Without this, a re-run of the pipeline on a
  // call that produced the stuck state would short-circuit before the
  // promotion below ever fires.
  const stuckNotStartedRepairNeeded =
    existing.status === "NOT_STARTED" && mastery > 0;

  if (masteryUnchanged && !shouldFlipToCompleted && !stuckNotStartedRepairNeeded) {
    log.debug("writeModuleMastery skipped: no change", {
      callerId,
      moduleId,
      mastery,
      evidenceCount,
      status: existing.status,
    });
    return {
      mastery,
      evidenceCount,
      statusFlipped: false,
      skipped: true,
    };
  }

  // #950 — promote NOT_STARTED → IN_PROGRESS when mastery rises above 0.
  // `incrementModuleEvidence` is the canonical status writer, but it can
  // be beaten to the row by the legacy `updateModuleMastery` path
  // (`lib/curriculum/track-progress.ts`) when the AI's learningAssessment
  // returns all-zero LO scores — that path computes finalMastery=0 →
  // status=NOT_STARTED. Then this helper runs with the non-zero EMA-derived
  // mastery and leaves status stuck. Without this promotion, any single-
  // call module with bad initial LO scoring reports `mastery > 0` +
  // `status = NOT_STARTED` indefinitely. Preserve COMPLETED (the existing
  // flip wins); only repair the NOT_STARTED case.
  const shouldPromoteToInProgress =
    existing.status === "NOT_STARTED" && mastery > 0 && !shouldFlipToCompleted;

  await prisma.callerModuleProgress.update({
    where: { id: existing.id },
    data: {
      mastery,
      ...(shouldFlipToCompleted
        ? { status: "COMPLETED", completedAt: new Date() }
        : shouldPromoteToInProgress
          ? { status: "IN_PROGRESS", startedAt: new Date() }
          : {}),
    },
  });

  log.info("CallerModuleProgress mastery updated", {
    callerId,
    moduleId,
    mastery,
    evidenceCount,
    statusFlipped: shouldFlipToCompleted,
    previousStatus: existing.status,
  });

  return {
    mastery,
    evidenceCount,
    statusFlipped: shouldFlipToCompleted,
    skipped: false,
  };
}

/**
 * #491 Slice 1.4 — Resolve the set of CurriculumModule ids that should be
 * credited with evidence (callCount++) for this call.
 *
 * Always includes the call's bound `curriculumModuleId` (Slice 1.3). When the
 * bound module declares a `coversModules: string[]` array (authored per-module
 * concept — "this Mock covers part1/part2/part3"), each slug is resolved
 * against the call's curriculum and added to the set. Unresolved slugs (typo,
 * deleted module) are logged and skipped — the caller still gets credit for
 * the bound module + every slug that did resolve.
 *
 * The schema field `coversModules` arrives in Slice 2.4. Until then it is read
 * via `(module as any).coversModules` and treated as `[]` when absent — every
 * existing authored / AI-generated module simply falls back to single-credit
 * behaviour, identical to Slice 1.3.
 *
 * Returns a deduped array of `CurriculumModule.id` values. The bound moduleId
 * is always position 0 when present so callers can distinguish "primary" from
 * "fan-out" in logs.
 */
export async function resolveModuleEvidenceTargets(
  call: { id: string; playbookId: string | null; curriculumModuleId: string | null },
  log: PipelineLogger,
): Promise<string[]> {
  const boundModuleId = call.curriculumModuleId;
  if (!boundModuleId) return [];

  const credits: string[] = [boundModuleId];
  const seen = new Set<string>([boundModuleId]);

  const boundModule = await prisma.curriculumModule.findUnique({
    where: { id: boundModuleId },
    select: { id: true, slug: true, curriculumId: true },
  });
  if (!boundModule) {
    log.warn("resolveModuleEvidenceTargets: bound CurriculumModule not found", {
      callId: call.id,
      moduleId: boundModuleId,
    });
    return credits;
  }

  // `coversModules` is authored metadata; DB column lands in Slice 2.4. Cast
  // through `any` and treat missing/undefined as the empty array so this code
  // is a no-op for every module that hasn't declared the field.
  const coversModules: unknown = (boundModule as any).coversModules;
  if (!Array.isArray(coversModules) || coversModules.length === 0) {
    return credits;
  }

  const slugs = coversModules.filter((s): s is string => typeof s === "string" && s.length > 0);
  if (slugs.length === 0) return credits;

  for (const slug of slugs) {
    const resolved = await resolveModuleByLogicalId(boundModule.curriculumId, slug);
    if (!resolved) {
      log.warn("resolveModuleEvidenceTargets: coversModules slug did not resolve", {
        callId: call.id,
        boundModuleId,
        curriculumId: boundModule.curriculumId,
        unresolvedSlug: slug,
      });
      continue;
    }
    if (seen.has(resolved.id)) continue;
    seen.add(resolved.id);
    credits.push(resolved.id);
  }

  return credits;
}

/**
 * #494 E2 Slice 2.6 — diagnosticFromMock writer.
 *
 * Decides whether the just-finished call is a "Mock" (bound module declares
 * `coversModules.length >= 2`), generates a deterministic diagnostic via
 * `generateDiagnosticFromMock`, and persists it as a single CallerAttribute
 * row (`scope=DIAGNOSTIC`, `key=fromMock`) keyed by the existing
 * `@@unique([callerId, key, scope])` constraint. Most recent Mock wins on
 * subsequent runs.
 *
 * Failure is **not fatal**: any thrown error is logged at warn and the
 * helper returns `{ written: false }`. The pipeline's AGGREGATE stage must
 * continue past this point even when the diagnostic write fails — mastery
 * writes have already succeeded and the user's progress is still durable.
 *
 * Returns `{ written: false }` when:
 *   - The call has no bound `curriculumModuleId`.
 *   - `moduleEvidenceTargets.length < 2` (a Mock by definition covers ≥2).
 *   - The bound CurriculumModule is missing or its `coversModules.length < 2`.
 *   - The diagnostic generator returns null (defensive duplicate of above).
 *   - An error is thrown anywhere in the path.
 */
export async function writeDiagnosticFromMock(
  callId: string,
  callerId: string,
  call: { id: string; playbookId: string | null; curriculumModuleId: string | null },
  moduleEvidenceTargets: string[],
  log: PipelineLogger,
): Promise<{ written: boolean }> {
  if (!call.curriculumModuleId || moduleEvidenceTargets.length < 2) {
    return { written: false };
  }
  try {
    const boundModule = await prisma.curriculumModule.findUnique({
      where: { id: call.curriculumModuleId },
      select: { curriculumId: true, coversModules: true },
    });
    const covers = boundModule
      ? ((boundModule as any).coversModules as unknown[] | null)
      : null;
    const isMock = boundModule && Array.isArray(covers) && covers.length >= 2;
    if (!isMock || !boundModule) {
      return { written: false };
    }

    let pbConfig: Record<string, unknown> | null = null;
    if (call.playbookId) {
      const pb = await prisma.playbook.findUnique({
        where: { id: call.playbookId },
        select: { config: true },
      });
      pbConfig = (pb?.config as Record<string, unknown> | null) ?? null;
    }

    const diagnostic = await generateDiagnosticFromMock(prisma, {
      callId,
      callerId,
      curriculumId: boundModule.curriculumId,
      coveredModuleIds: moduleEvidenceTargets,
      playbookConfig: pbConfig as any,
    });
    if (!diagnostic) return { written: false };

    // CallerAttribute @@unique([callerId, key, scope]) — upsert keeps a
    // single diagnostic row per caller; the most recent Mock overwrites.
    await prisma.callerAttribute.upsert({
      where: {
        callerId_key_scope: {
          callerId,
          key: "fromMock",
          scope: "DIAGNOSTIC",
        },
      },
      create: {
        callerId,
        key: "fromMock",
        scope: "DIAGNOSTIC",
        valueType: "JSON",
        stringValue: JSON.stringify(diagnostic),
        sourceSpecSlug: "diagnostic-from-mock",
      },
      update: {
        valueType: "JSON",
        stringValue: JSON.stringify(diagnostic),
        sourceSpecSlug: "diagnostic-from-mock",
      },
    });
    log.info("diagnosticFromMock written", {
      callId,
      callerId,
      focusModules: diagnostic.focusModules,
      strengthModule: diagnostic.strengthModule,
      weakSkill: diagnostic.weakSkill,
    });
    return { written: true };
  } catch (err) {
    // Per spec: diagnostic failure must NOT break the pipeline.
    log.warn("diagnosticFromMock generation failed", {
      callId,
      callerId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { written: false };
  }
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
        // #1539 — delta inherits the parent score's spec lineage when
        // available (the parent CallScore now stamps analysisSpecId).
        // Falls back to ADAPT-DELTA-V1 sentinel for first-run callers
        // whose source score was written pre-#1539 (NULL spec id).
        await writeCallScore({
          callId,
          callerId,
          parameterId: deltaParameterId,
          analysisSpecId:
            currentScore.analysisSpecId ?? MEASUREMENT_SENTINEL_SPEC_IDS.ADAPT_DELTA,
          // #491 Slice 1.2 — delta scores inherit the source call's module attribution.
          moduleId: currentCall.curriculumModuleId ?? null,
          score: deltaScore,
          confidence: 0.9,
          evidence: [`adapt:delta-from=${currentScore.id}`],
          scoredBy: "adapt_v1",
        });
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
        // #1868 — Lattice scope so Playbook/Domain overrides resolve before global.
        scope: { callId: call.id, playbookId: call.playbookId ?? undefined },
        engineOverride: engine,
        messages: [
          { role: "system", content: PIPELINE_ADAPT_SYSTEM_PROMPT },
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
  callId?: string,
  /**
   * #1081 Slice 1 — Playbook owning this call. Threaded through to
   * `updateCurriculumProgress` so the AGGREGATE write site can apply
   * `useFreshMastery` routing + `maxMasteryTier` capping. Falsy = no
   * Playbook context → standard CallerAttribute write path.
   */
  playbookId?: string | null,
): Promise<boolean> {
  // If we have a learning assessment, write mastery and potentially advance
  if (learningAssessment) {
    const { specSlug, moduleId, overallMastery, outcomes, masteryThreshold, allModuleIds } = learningAssessment;

    try {
      // #611 Fix A — resolve curriculumId for this specSlug + thread it
      // through to `updateCurriculumProgress`. The loMastery write path
      // then canonicalises `moduleId` to slug form before constructing
      // the storage key, eliminating the dual-key bug (name-form +
      // slug-form for the same LO). See docs/epic-100-chain-walk.md
      // (Link 4) and lib/curriculum/track-progress.ts::updateCurriculumProgress.
      const curriculumForSpec = await prisma.curriculum.findFirst({
        where: { slug: specSlug },
        select: { id: true },
      });

      // Write mastery score for this module + per-LO outcomes.
      // `callId` threads through so `updateModuleMastery` can apply the
      // #547 idempotency guard — the canonical AGGREGATE-stage
      // `incrementModuleEvidence` has typically already counted this
      // call by the time we get here.
      await updateCurriculumProgress(callerId, specSlug, {
        moduleMastery: { [moduleId]: overallMastery },
        loMastery: Object.keys(outcomes).length > 0 ? { moduleId, outcomes } : undefined,
        lastAccessedAt: new Date(),
        callId,
        curriculumId: curriculumForSpec?.id ?? null,
        // #1081 Slice 1 — enable per-Playbook mastery discipline at the
        // AGGREGATE write site (useFreshMastery routing + maxMasteryTier cap).
        playbookId: playbookId ?? null,
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
        // #1034 / #1177 Slice 6 — canonical PlaybookCurriculum read.
        const pbcLink = await prisma.playbookCurriculum.findFirst({
          where: { playbookId: enrolledPbId },
          orderBy: [{ role: "asc" }, { createdAt: "asc" }],
          select: { curriculum: { select: { slug: true, notableInfo: true } } },
        });
        const pbCurr = pbcLink?.curriculum;
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
      const caller = await prisma.caller.findUnique({
        where: { id: callerId },
        select: { domainId: true },
      });
      if (!caller?.domainId) return false;
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


// =====================================================
// SPEC-DRIVEN PIPELINE EXECUTION
// =====================================================

/**
 * Pipeline execution context passed to all stage executors
 */
interface PipelineContext {
  callId: string;
  callerId: string;
  call: { id: string; transcript: string | null; playbookId: string | null; requestedModuleId: string | null; curriculumModuleId: string | null; sessionId: string | null };
  engine: AIEngine;
  guardrails: GuardrailsConfig;
  pipelineStages: PipelineStage[];
  mode: "prep" | "prompt";
  force: boolean;
  log: PipelineLogger;
  request: NextRequest;
  userName?: string;
  /**
   * #1253 — pre-resolved course shape for this call. Drives every stage that
   * branches on STRUCTURED vs CONTINUOUS (modules transform, REWARD,
   * scheduler). Default-deny: anything not explicitly `lessonPlanMode ===
   * "structured"` resolves to `"continuous"`. See `lib/pipeline/course-style.ts`.
   */
  courseStyle: CourseStyle;
  /**
   * #1346 Slice 5 — partial-failure mode flag. When set to `"minimal"`,
   * the COMPOSE stage runner skips the live LLM pipeline and routes to
   * `carryThroughCompose` — produces a ComposedPrompt by carrying the
   * I-CT2 cascade prompt forward, stamped with `inputs.partialFailureMode
   * = "minimal"` so the Tune tab shows the "↻ reconciled" badge. Called
   * by the reconciler cron and by ops doing manual recovery.
   */
  partialFailureMode?: "minimal";
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
    } else {
      // #405: force re-run must clear prior writes for this call BEFORE recreating.
      // CallScore has @@unique([callId, parameterId]); without this delete, the
      // recreate inside runBatchedCallerAnalysis throws on the first duplicate
      // pair and the error gets swallowed by the outer Promise.allSettled — the
      // route reports 200 ok but no new state lands. CallerMemory has no unique
      // constraint, so the symptom there is silent duplication instead. Clearing
      // both keeps force semantics clean: "re-extract from scratch for this call".
      const [scoreDel, memDel] = await Promise.all([
        prisma.callScore.deleteMany({ where: { callId: ctx.callId } }),
        prisma.callerMemory.deleteMany({ where: { callId: ctx.callId } }),
      ]);
      if (scoreDel.count > 0 || memDel.count > 0) {
        ctx.log.info(
          `EXTRACT force: cleared ${scoreDel.count} CallScore + ${memDel.count} CallerMemory row(s) for call ${ctx.callId} before re-extract`,
        );
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
    // #566 Step 3 — pass playbookId so evidence-first playbooks short-circuit
    // the mode gate. Non-listed playbooks keep the legacy mode-based decision.
    const gate = await shouldRunCallerAnalysis(ctx.callerId, ctx.call.playbookId);

    // #491 Slice 1.5 — Mock-style calls (bound module declares
    // `coversModules`) are explicit assessment events by definition.
    // The learner deliberately picked the Mock module, so the
    // event-gate's "no assessment evidence" verdict doesn't apply —
    // we override to keep MEASURE running. Without this override the
    // per-part segmenter has no full param set to score against and
    // we lose the whole point of running a Mock.
    let mockOverride = false;
    if (!gate.allow && ctx.call.curriculumModuleId) {
      const boundCovers = await prisma.curriculumModule.findUnique({
        where: { id: ctx.call.curriculumModuleId },
        select: { coversModules: true },
      });
      if (boundCovers && boundCovers.coversModules.length > 0) {
        mockOverride = true;
        ctx.log.info("Event-gate override: Mock-style call (coversModules non-empty) — MEASURE runs regardless of prior mode", {
          callId: ctx.callId,
          priorMode: gate.mode,
        });
      }
    }
    const skipMeasure = !gate.allow && !mockOverride;

    const callerResult = await runBatchedCallerAnalysis(
      ctx.call,
      ctx.callerId,
      ctx.engine,
      ctx.log,
      ctx.userName,
      { skipMeasure },
    );

    if (!gate.allow && !mockOverride) {
      ctx.log.info(
        `EXTRACT caller-scoring gated: ${gate.reason} (${callerResult.scoresCreated} always-on scores, ${callerResult.memoriesCreated} memories — gated specs skipped)`,
      );
    }
    const deltaResult = await computeAdapt(ctx.callId, ctx.callerId, ctx.log);

    // Run all 4 non-blocking post-analysis ops in parallel.
    // #1615 — TP-mastery sub-op (was sub-op 3) removed; the function
    // `updateTpMasteryAfterCall` was dead in practice — both branches
    // produced 0 rows DB-wide (Branch A's `playbook:*:lo:*` write +
    // Branch B's `tp_status:*`/`tp_mastery:*` write). The active per-LO
    // mastery store is `curriculum:{specSlug}:lo_mastery:{moduleSlug}:{loRef}`
    // written by `updateCurriculumProgress` in the AGGREGATE stage above.
    // Removing this op also closes the runtime crash filed as #1633
    // (the dead Branch A's `CallerAttribute.upsert` was missing the
    // `caller` relation).
    const [currSettled, onboardSettled, artifactSettled, actionSettled] =
      await Promise.allSettled([
        // 1. Curriculum progress + CurriculumModule FK write
        // #1081 Slice 1 — `callerResult.playbookUsed` threaded through so the
        // AGGREGATE write site can apply per-Playbook mastery discipline
        // (useFreshMastery routing + maxMasteryTier cap).
        trackCurriculumAfterCall(
          ctx.callerId,
          ctx.log,
          callerResult.learningAssessment,
          ctx.callId,
          callerResult.playbookUsed ?? null,
        )
          .then(async (updated) => {
            if (callerResult.learningAssessment?.moduleId) {
              // Two-step scope chain (#407): caller → playbook → curriculum →
              // module. Unscoped slug findFirst picked the wrong curriculum's
              // part1 when slugs collide across playbooks — corrupted
              // Call.curriculumModuleId on every pipeline run.
              const playbookId =
                callerResult.playbookUsed ?? (await resolvePlaybookId(ctx.callerId));
              const curriculumId = await resolveCurriculumIdForPlaybook(playbookId);
              if (curriculumId) {
                const mod = await resolveModuleByLogicalId(
                  curriculumId,
                  callerResult.learningAssessment.moduleId,
                );
                if (mod) {
                  await prisma.call.update({
                    where: { id: ctx.callId },
                    data: { curriculumModuleId: mod.id },
                  });
                }
              }
            }
            return updated;
          }),
        // 2. Onboarding completion
        trackOnboardingAfterCall(ctx.callerId, ctx.callId, ctx.log),
        // 3. Artifact extraction + delivery
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
        // 4. Action extraction
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
    // #1615 — sessionAdvanced was derived from the removed TP-mastery
    // op's return; it was logged only on rejection and never consumed
    // downstream. Dropped along with `lessonSettled`.
    const sessionAdvanced = false;

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
      callerAnalysisGated: skipMeasure,
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

  // PROSODY stage (#1119): Score the call's stereo recording via the
  // configured SpeechAssessmentProvider. Emits a VOICE_PROSODY_V1
  // contract envelope persisted to Call.voiceProsody. Failure modes
  // (no recording, vendor error, timeout, no provider) encode as
  // `mode: "unavailable"` rather than throwing — pipeline continues.
  // AGGREGATE consumes the envelope and writes CallScore (IELTS mode)
  // or BehaviorParameter deltas (general mode). PROSODY itself writes
  // ZERO downstream rows. NOT added to parallelStages — sequential.
  PROSODY: async (ctx, stage) => {
    ctx.log.info(`Stage ${stage.name}: ${stage.description}`);
    const result = await runProsodyStage({
      callId: ctx.callId,
      callerId: ctx.callerId,
      force: ctx.force,
    });
    ctx.log.info("PROSODY stage complete", {
      callId: ctx.callId,
      mode: result.envelope.mode,
      errorReason: result.envelope.errorReason,
      vendorCalled: result.vendorCalled,
      skippedReason: result.skippedReason,
    });
    return {
      mode: result.envelope.mode,
      vendorCalled: result.vendorCalled,
      ...(result.envelope.errorReason
        ? { errorReason: result.envelope.errorReason }
        : {}),
      ...(result.skippedReason
        ? { skippedReason: result.skippedReason }
        : {}),
    };
  },

  // SCORE_AGENT stage: Score agent behavior (batched)
  SCORE_AGENT: async (ctx, stage) => {
    ctx.log.info(`Stage ${stage.name}: ${stage.description}`);

    // #1513 Slice 3 — BehaviorTarget cascade observability. Loads the
    // (playbookId, scope=PLAYBOOK) → (scope=SYSTEM) cascade for I-AL5
    // surfacing. Runs BEFORE the idempotency short-circuit so the
    // dashboard still sees the gap on a force-rerun. NON-BLOCKING:
    // result is logged for visibility; downstream scoring uses MEASURE
    // specs to derive parameters (cascade is observational only).
    const targetCascade = await loadBehaviorTargetsWithCascade({
      playbookId: ctx.call.playbookId,
      callerId: ctx.callerId,
      callId: ctx.callId,
    });
    ctx.log.info("SCORE_AGENT BehaviorTarget cascade resolved", {
      playbookId: ctx.call.playbookId,
      resolvedScope: targetCascade.resolvedScope,
      targetCount: targetCascade.targets.length,
      iAL5Emitted: targetCascade.emitted,
    });

    // Idempotency: skip AI call if measurements already exist for this call
    if (!ctx.force) {
      const existingMeasurements = await prisma.behaviorMeasurement.count({ where: { callId: ctx.callId } });
      if (existingMeasurements > 0) {
        ctx.log.info(`SCORE_AGENT skipped: ${existingMeasurements} measurements already exist for call ${ctx.callId} (use force=true to re-run)`);
        return { agentMeasurements: 0, skippedReason: "existing_measurements" };
      }
    } else {
      // #405: force re-run clears prior measurements before re-scoring.
      // BehaviorMeasurement has @@unique([callId, parameterId]); without this
      // delete, the recreate would hit a unique-constraint violation and the
      // re-score would silently fail. Matches the EXTRACT cleanup above.
      const measDel = await prisma.behaviorMeasurement.deleteMany({ where: { callId: ctx.callId } });
      if (measDel.count > 0) {
        ctx.log.info(
          `SCORE_AGENT force: cleared ${measDel.count} BehaviorMeasurement row(s) for call ${ctx.callId} before re-score`,
        );
      }
    }

    const stageStart = Date.now();
    const agentResult = await runBatchedAgentAnalysis(ctx.call, ctx.callerId, ctx.engine, ctx.log, ctx.userName);
    // #1622 — emit per-stage write counts so the silent-writer detector
    // can flag SCORE_AGENT producing zero BehaviorMeasurement rows over a
    // rolling 24h window (the #1608 fingerprint pre-fix).
    logStageWriteCounts({
      stage: "SCORE_AGENT",
      callId: ctx.callId,
      callerId: ctx.callerId,
      playbookId: ctx.call.playbookId ?? undefined,
      writeCounts: {
        behaviorMeasurement: agentResult.measurementsCreated,
      },
      durationMs: Date.now() - stageStart,
    });
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

    // 2.5. #1119 — Consume VOICE_PROSODY_V1 envelope written by the
    // PROSODY stage earlier in the pipeline. Writes 4 IELTS skill
    // CallScore rows (mode=ielts) or 2 general-mode CallScore rows
    // (mode=general). No-op when mode=unavailable / envelope missing.
    try {
      const prosodyResult = await applyProsodyContractToAggregate(
        ctx.callId,
        ctx.callerId,
      );
      ctx.log.info("Prosody aggregate applied", prosodyResult);

      // #1953 — Four-criteria IELTS completion gate. Fires ONLY when
      // prosody wrote IELTS scores (mode === "ielts") AND the call is
      // bound to a curriculumModule. Runs HERE (early in AGGREGATE,
      // before the mastery writer at track-progress.ts:665) so a
      // waived row can't be clobbered back to NOT_STARTED on the next
      // pipeline run. courseStyle threading is required by guard
      // #1252 — markModuleIncomplete short-circuits on continuous
      // courses and emits the `module.incomplete.skipped_continuous`
      // AppLog. See Boaz/Eldar gap-analysis response (2026-06-18) §2.
      if (
        prosodyResult.applied &&
        prosodyResult.mode === "ielts" &&
        ctx.call.curriculumModuleId
      ) {
        const completion = await validateIeltsCompletion(ctx.callId);
        if (!completion.complete) {
          ctx.log.info("IELTS completion gate: incomplete", {
            callId: ctx.callId,
            moduleId: ctx.call.curriculumModuleId,
            missing: completion.missing,
            reason: "ielts_criteria",
          });
          await markModuleIncomplete(prisma, {
            callerId: ctx.callerId,
            moduleId: ctx.call.curriculumModuleId,
            courseStyle: ctx.courseStyle,
            playbookId: ctx.call.playbookId,
          });
        } else {
          ctx.log.info("IELTS completion gate: complete", {
            callId: ctx.callId,
            moduleId: ctx.call.curriculumModuleId,
          });
          // #1954 (Boaz/Eldar gap analysis Unit 1.1) — Post-Assessment
          // lesson-plan trigger. Fire-and-forget the plan generator
          // ONLY when the four-criteria completion gate fires
          // "complete". The helper itself gates on the locked
          // module's `generateLessonPlan` toggle (default off; IELTS
          // baseline fixture sets it true) so this call is cheap and
          // safe across all non-IELTS playbooks. The .catch wrapper
          // guarantees AGGREGATE completion even if plan generation
          // throws unexpectedly — defence in depth on top of the
          // helper's own try/catch.
          buildPostAssessmentPlan({
            callId: ctx.callId,
            callerId: ctx.callerId,
            sessionId: ctx.call.sessionId ?? null,
            playbookId: ctx.call.playbookId ?? null,
            curriculumModuleId: ctx.call.curriculumModuleId ?? null,
          }).catch((err: unknown) => {
            ctx.log.warn(
              `Post-Assessment lesson plan failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        }
      }
    } catch (prosodyErr) {
      // Non-fatal — log and continue. Prosody is a nice-to-have signal;
      // the other AGGREGATE work must complete regardless.
      ctx.log.warn(
        `Prosody aggregate failed (non-fatal): ${prosodyErr instanceof Error ? prosodyErr.message : String(prosodyErr)}`,
      );
    }

    // 3. #491 Slice 1.3 + 1.4 — increment CallerModuleProgress.callCount for
    // every module credited by this call. Slice 1.3 credited only the bound
    // module (`Call.curriculumModuleId`); Slice 1.4 fans out via the bound
    // module's `coversModules: string[]` declaration so an IELTS Mock counts
    // as evidence for part1 + part2 + part3 in addition to "mock" itself.
    // Idempotent on pipeline force-rerun via the lastCallId check inside the
    // helper. Per-segment CallScore attribution is Slice 1.5.
    const moduleEvidenceTargets = await resolveModuleEvidenceTargets(ctx.call, ctx.log);
    const evidenceResults = await Promise.all(
      moduleEvidenceTargets.map((moduleId) =>
        incrementModuleEvidence(ctx.callId, ctx.callerId, moduleId, ctx.log),
      ),
    );
    // Primary (bound module) is always position 0 — preserve the Slice 1.3
    // summary fields so downstream consumers don't break, then add a fan-out
    // count for observability.
    const primaryEvidence = evidenceResults[0] ?? { callCount: -1, created: false, skipped: true };
    if (moduleEvidenceTargets.length > 1) {
      ctx.log.info("Module evidence fan-out applied", {
        callId: ctx.callId,
        boundModuleId: ctx.call.curriculumModuleId,
        creditedModuleIds: moduleEvidenceTargets,
        creditedCount: moduleEvidenceTargets.length,
      });
    }

    // 4. #494 E2 Slice 2.2 — recompute CallerModuleProgress.mastery as the
    // EMA over CallScore rows for each credited module and flip status to
    // COMPLETED when the per-module threshold is crossed AND minCallsToFull
    // pieces of evidence have accumulated. CallerModuleProgress.mastery is
    // the canonical store from this slice forward — legacy CallerAttribute
    // mastery:* writes are deprecated (reconcile + remove in Slice 2.1).
    //
    // Load per-module masteryThreshold + playbook config once for the call,
    // not per credited module — every credited module shares the same
    // playbook + curriculum (coversModules can only fan out within the
    // bound module's curriculum). The threshold IS per-module though, so
    // fetch each row's value.
    let masteryResults: Array<{
      moduleId: string;
      mastery: number;
      evidenceCount: number;
      statusFlipped: boolean;
      skipped: boolean;
    }> = [];
    if (moduleEvidenceTargets.length > 0) {
      // Playbook config drives EMA tuning. `ctx.call.playbookId` may be null
      // for self-serve / unenrolled SIM callers — fall back to module-level
      // defaults in that case. The keys mirror `aggregate-runner.ts` so the
      // skill-EMA and module-mastery paths stay in lockstep.
      let emaHalfLifeDays: number | undefined;
      let minCallsToFull: number | undefined;
      if (ctx.call.playbookId) {
        const pb = await prisma.playbook.findUnique({
          where: { id: ctx.call.playbookId },
          select: { config: true },
        });
        const pbCfg = (pb?.config ?? {}) as Record<string, unknown>;
        if (typeof pbCfg.skillScoringEmaHalfLifeDays === "number") {
          emaHalfLifeDays = pbCfg.skillScoringEmaHalfLifeDays;
        }
        if (typeof pbCfg.skillMinCallsToFull === "number") {
          minCallsToFull = pbCfg.skillMinCallsToFull;
        }
      }

      // Per-module threshold lookup. `masteryThreshold` is a real column on
      // CurriculumModule today; the `(m as any)` cast is defensive because
      // older Prisma client builds in transit may not expose it.
      const moduleRows = await prisma.curriculumModule.findMany({
        where: { id: { in: moduleEvidenceTargets } },
        select: { id: true, masteryThreshold: true },
      });
      const thresholdById = new Map<string, number | null>(
        moduleRows.map((m) => [m.id, (m as any).masteryThreshold ?? null]),
      );

      masteryResults = await Promise.all(
        moduleEvidenceTargets.map(async (moduleId) => {
          const moduleThreshold = thresholdById.get(moduleId) ?? null;
          const result = await writeModuleMastery(
            ctx.callerId,
            moduleId,
            {
              masteryThreshold:
                typeof moduleThreshold === "number" ? moduleThreshold : undefined,
              emaHalfLifeDays,
              minCallsToFull,
            },
            ctx.log,
          );
          return { moduleId, ...result };
        }),
      );
    }

    const primaryMastery = masteryResults[0] ?? {
      mastery: 0,
      evidenceCount: 0,
      statusFlipped: false,
      skipped: true,
    };
    const masteryFlippedCount = masteryResults.filter((r) => r.statusFlipped).length;

    // 5. #494 E2 Slice 2.6 — diagnosticFromMock writer. Generate + persist
    // a learner-facing diagnostic when this call is a "Mock" (bound module
    // declares coversModules.length >= 2). Wrapped in try/catch inside the
    // helper — diagnostic failure MUST NOT break the pipeline.
    const diagnosticResult = await writeDiagnosticFromMock(
      ctx.callId,
      ctx.callerId,
      ctx.call,
      moduleEvidenceTargets,
      ctx.log,
    );
    const diagnosticWritten = diagnosticResult.written;

    // #1622 — emit per-stage write counts. AGGREGATE writes the four
    // adaptive-loop state stores most-loaded by the audit (CallerTarget,
    // CallerModuleProgress, lo_mastery on CallerAttribute, plus the per-call
    // PersonalityObservation/CallScore rows). lo_mastery and moduleProgress
    // are continuous-vs-structured-gated downstream — silent values here
    // are the #1614/#1615 fingerprint.
    logStageWriteCounts({
      stage: "AGGREGATE",
      callId: ctx.callId,
      callerId: ctx.callerId,
      playbookId: ctx.call.playbookId ?? undefined,
      writeCounts: {
        personalityObservation: personalityResult.observationCreated ? 1 : 0,
        callScore: primaryEvidence.created ? 1 : 0,
        callerModuleProgress: primaryMastery.statusFlipped ? 1 : 0,
        // CallerTarget + lo_mastery counts aren't returned by the inner runners
        // today — leave unset so detector reads "not measured here" instead
        // of "always zero". Follow-up: thread counts back from the writers
        // (`accumulateSkillScores`, `updateCurriculumProgress`) so the alarm
        // can resolve them. Tracked as a TODO inside Slice 1's PR.
      },
      durationMs: undefined,
    });

    return {
      personalityObservationCreated: personalityResult.observationCreated,
      personalityProfileUpdated: personalityResult.profileUpdated,
      aggregateSpecsRun: aggregateResult.specsRun,
      profileUpdates: aggregateResult.profileUpdates,
      moduleEvidenceCallCount: primaryEvidence.callCount,
      moduleEvidenceCreated: primaryEvidence.created,
      moduleEvidenceSkipped: primaryEvidence.skipped,
      moduleEvidenceCreditedCount: moduleEvidenceTargets.length,
      moduleEvidenceCreditedModuleIds: moduleEvidenceTargets,
      moduleMastery: primaryMastery.mastery,
      moduleMasteryEvidenceCount: primaryMastery.evidenceCount,
      moduleMasteryStatusFlipped: primaryMastery.statusFlipped,
      moduleMasteryFlippedCount: masteryFlippedCount,
      diagnosticFromMockWritten: diagnosticWritten,
    };
  },

  // REWARD stage: Compute reward scores
  REWARD: async (ctx, stage) => {
    ctx.log.info(`Stage ${stage.name}: ${stage.description}`);
    const rewardResult = await computeReward(ctx.callId, ctx.courseStyle, ctx.log);
    // #1622 — REWARD writes exactly one RewardScore row per call. The
    // `targetUpdatesApplied` field of that row stays NULL until #1609
    // Slice 2 wires `updateTargets` per-call, so this counter alone
    // won't surface #1609 — the detector wants a sibling count of
    // "RewardScore rows with non-null targetUpdatesApplied" which
    // #1609 Slice 2 should add as a separate `writeCount` key.
    logStageWriteCounts({
      stage: "REWARD",
      callId: ctx.callId,
      callerId: ctx.callerId,
      playbookId: ctx.call.playbookId ?? undefined,
      writeCounts: {
        rewardScore: rewardResult.overallScore != null ? 1 : 0,
      },
    });
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

    // 7. Failure adaptation (#1340, ADAPT sub-op 8) — derives a soft
    //    "previous attempt failed" signal from FailureLog rows attached
    //    to the parent Session. The signal feeds COMPOSE's preamble
    //    (Slice 5 wires the read side); Slice 1 only emits + observes.
    //    No-ops cleanly when the Session has no FailureLog children
    //    (per `extract-failure-adaptation.ts` contract — L7 risk).
    let failureSignal: { kind: string; failureCount: number; signal: string } | null = null;
    if (ctx.call.sessionId) {
      const failureLogs = await prisma.failureLog.findMany({
        where: { sessionId: ctx.call.sessionId },
        orderBy: { occurredAt: "desc" },
      });
      const extracted = extractFailureAdaptation(failureLogs);
      if (extracted) {
        failureSignal = {
          kind: extracted.kind,
          failureCount: extracted.failureCount,
          signal: extracted.signal,
        };
        ctx.log.info(`Failure adaptation signal emitted`, failureSignal);
      }
    }

    // 8. Reward-loop target update (#1609 / Epic #1618) — closes the
    //    per-call reward-feedback loop. Reads this call's RewardScore
    //    row (written by REWARD stage 40) + ParameterDiff array,
    //    computes BehaviorTarget adjustments via TARGET_LEARN spec
    //    rules, writes new BehaviorTarget versions, AND stamps
    //    `RewardScore.targetUpdatesApplied` with the applied updates
    //    (or `[]` when no updates were needed). Pre-#1609 this
    //    function was admin-ops/CLI-only — 73/73 RewardScore rows on
    //    hf-dev sandbox 2026-06-14 had `targetUpdatesApplied = NULL`,
    //    so the Adaptations tab's "Why" timeline (SP5-C) was always
    //    empty. Slice 2 of #1609 wires it into the ADAPT executor as
    //    its 8th sub-op (sequential AFTER the failure-adaptation
    //    signal — ordering invariant: REWARD stage 40 must have
    //    written the RewardScore before ADAPT stage 50 reads it).
    //
    //    Scoped to this call only via `{callId: ctx.callId, limit: 1}`
    //    — never touches sibling RewardScore rows even if they exist
    //    with NULL targetUpdatesApplied (those are the Slice 3
    //    backfill's job, gated behind operator opt-in).
    //
    //    Non-blocking — errors are logged but never abort the rest of
    //    the pipeline. Matches the pattern of every other ADAPT
    //    sub-op (the loop should not fall apart because the reward
    //    closer hit a Prisma timeout on one call).
    let rewardLoopUpdates = 0;
    let rewardLoopProcessed = 0;
    try {
      const targetsLoop = await updateTargets({
        callId: ctx.callId,
        limit: 1,
        verbose: false,
        plan: false,
      });
      rewardLoopProcessed = targetsLoop.rewardsProcessed;
      rewardLoopUpdates = targetsLoop.updates.reduce((sum, u) => sum + u.updateCount, 0);
      if (targetsLoop.errors.length > 0) {
        ctx.log.error("Reward-loop target update failed (non-blocking)", {
          errors: targetsLoop.errors,
        });
      } else {
        ctx.log.info("Reward-loop targets updated", {
          rewardsProcessed: rewardLoopProcessed,
          updateCount: rewardLoopUpdates,
        });
      }
    } catch (err: any) {
      ctx.log.error("Reward-loop target update threw (non-blocking)", {
        error: err?.message ?? String(err),
      });
    }

    ctx.log.info(`ADAPT parallel ops completed in ${Date.now() - startTime}ms`);

    // #1622 — emit per-stage write counts for the eight ADAPT sub-ops.
    // The Goal counters here are the #1614 fingerprint surface (goals
    // get created/updated/progress-bumped + the .progress timeline
    // append on `progressMetrics` from #1614). The callTarget /
    // callerTarget counts surface #1609 — once the reward loop is wired
    // (this PR's sub-op 8 above), the rewardLoopUpdates counter is the
    // direct silent-writer signal for the Adaptations "Why" timeline.
    logStageWriteCounts({
      stage: "ADAPT",
      callId: ctx.callId,
      callerId: ctx.callerId,
      playbookId: ctx.call.playbookId ?? undefined,
      writeCounts: {
        callTarget: adaptResult.targetsCreated,
        callerTarget: ruleBasedResult.targetsCreated + ruleBasedResult.targetsUpdated + rewardLoopUpdates,
        goal: goalExtractionResult.goalsCreated + goalExtractionResult.goalsUpdated + goalResult.updated,
        failureLog: failureSignal ? 1 : 0,
      },
      durationMs: Date.now() - startTime,
    });

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
      failureSignal,
      // #1609 — reward-loop closure counters surface in the response
      // payload so the operator-facing pipeline diagnostic at /x/logs
      // can render the per-call "targets nudged by reward feedback"
      // line WITHOUT querying RewardScore.targetUpdatesApplied
      // separately.
      rewardLoopProcessed,
      rewardLoopUpdates,
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
    // #1622 — SUPERVISE adjusts existing CallerTarget rows (validation
    // adjustments + aggregator updates) rather than creating new ones.
    // Counter surfaces "supervise ran but did nothing" silent state.
    logStageWriteCounts({
      stage: "SUPERVISE",
      callId: ctx.callId,
      callerId: ctx.callerId,
      playbookId: ctx.call.playbookId ?? undefined,
      writeCounts: {
        callerTarget: validateResult.adjustments + callerTargetResult.aggregated,
      },
    });
    return {
      targetsValidated: validateResult.adjustments,
      callerTargetsAggregated: callerTargetResult.aggregated,
    };
  },

  // COMPOSE stage: Build final prompt
  COMPOSE: async (ctx, stage) => {
    ctx.log.info(`Stage ${stage.name}: ${stage.description}`);

    // #1346 Slice 5 — partial-failure minimal mode short-circuits the
    // entire COMPOSE LLM path. Reads the I-CT2 cascade and carries the
    // prior prompt forward; ALWAYS produces a ComposedPrompt; never
    // throws (unless the cascade returns null, which is the brand-new-
    // caller edge case).
    if (ctx.partialFailureMode === "minimal") {
      const sessionIdForCarry = ctx.call.sessionId;
      if (!sessionIdForCarry) {
        const msg = "partialFailureMode='minimal' but Call.sessionId is null — Slice 4 cutover should have set this for every Call.";
        ctx.log.error(msg);
        throw new Error(msg);
      }
      ctx.log.info(
        `[COMPOSE/minimal] short-circuiting LLM path; carrying forward via I-CT2 cascade for session ${sessionIdForCarry.slice(0, 8)}`,
      );
      const carried = await carryThroughCompose({
        sessionId: sessionIdForCarry,
        callerId: ctx.callerId,
        playbookId: ctx.call.playbookId,
        triggerType: "pipeline-minimal-mode",
      });
      ctx.log.info(
        `[COMPOSE/minimal] reconciled — composedPromptId=${carried.composedPromptId.slice(0, 8)} source=${carried.carryForwardSource}${carried.raced ? " (raced — kept prior winner)" : ""}`,
      );
      return {
        promptId: carried.composedPromptId,
        prompt: "(minimal-mode carry-through — body inherited from " +
          `${carried.carryForwardPromptId.slice(0, 8)} via cascade source=${carried.carryForwardSource})`,
        partialFailureMode: "minimal",
        carryForwardSource: carried.carryForwardSource,
        carryForwardPromptId: carried.carryForwardPromptId,
        raced: carried.raced,
      };
    }

    // Direct function call — no HTTP self-call
    const playbookIds = ctx.call.playbookId ? [ctx.call.playbookId] : undefined;
    const { fullSpecConfig, sections, specSlug } = await loadComposeConfig({ playbookIds });
    // #492 Slice 3.1: thread the call row's `curriculumModuleId` (resolved
    // at call-create from `?module=<slug>` via E1 1.1) so the composer locks
    // the prompt to the picked module. When null, falls through to scheduler.
    // #492 Slice 3.5: thread `ctx.callId` so the priorCallFeedback loader can
    // exclude the current call from its "last attempt on this module" search.
    const composition = await executeComposition(
      ctx.callerId,
      sections,
      fullSpecConfig,
      undefined,
      ctx.call.curriculumModuleId ?? null,
      ctx.callId,
    );
    const promptSummary = renderPromptSummary(composition.llmPrompt);

    // #1344 Slice 4 — resolve the parent Session id from the Call row so
    // the new `triggerSessionId` lands. `Call.sessionId` is the 1:1 link
    // written by `createSession`; null only for pre-#1342 historical Calls.
    const triggerSessionId = ctx.call.sessionId ?? null;
    const persisted = await persistComposedPrompt(composition, promptSummary, {
      callerId: ctx.callerId,
      playbookId: ctx.call.playbookId,
      triggerType: "pipeline",
      triggerSessionId,
      composeSpecSlug: specSlug,
      specConfig: fullSpecConfig,
    });

    ctx.log.info(`COMPOSE complete: ${persisted.prompt.length} chars, id=${persisted.id}`);

    // #1622 — COMPOSE writes exactly one ComposedPrompt per call (or
    // carries through one via I-CT2 in minimal mode, handled above).
    logStageWriteCounts({
      stage: "COMPOSE",
      callId: ctx.callId,
      callerId: ctx.callerId,
      playbookId: ctx.call.playbookId ?? undefined,
      writeCounts: {
        composedPrompt: persisted.prompt.length > 0 ? 1 : 0,
      },
    });

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
  //
  // PIPELINE-001 drives stage ORDER via the spec, but stage PARALLELISM
  // is hardcoded here. To add a new parallel pair, edit BOTH the spec
  // and this set — failing to update one leaves silent serialisation
  // (or worse, a race) with no compile-time signal.
  //
  // Acceptable trade-off documented in docs/pipeline.md §4 L5
  // ("By design. To add a parallel pair: edit the constant AND ensure
  // no cross-batch DB dependency."). To spec-drive parallelism in
  // future, add a `parallelGroup: string` field to PIPELINE-001 stage
  // entries and replace this set with a group lookup at runner start.
  // See #814 (story 3) for the deferral.
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

  // #1511 — Adaptive Loop observability invariants (epic #1510 Slice 1).
  // Derives I-AL1 (memory presence on real-engine) + I-AL2 (skill scores
  // reach CallerTarget) and writes structured AppLog rows for the
  // pipeline-health dashboard. WARN-only, NON-BLOCKING — fire-and-forget,
  // never awaited, never throws (the runner swallows its own errors).
  // I-AL3 / I-AL4 / I-AL5 emit at their stage runners via sibling slices
  // (#1512 / #1513). See docs/CHAIN-CONTRACTS.md §6.
  void checkInvariantsAfterPipeline(ctx.callId).catch(() => undefined);

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
    // Allow internal service-to-service calls (voice webhook → pipeline)
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
    // #1346 Slice 5 — accept partialFailureMode from the request body. The
    // only supported value today is "minimal" — anything else is ignored.
    // Wired by the reconciler cron + ops manual-recovery surfaces.
    const partialFailureMode: "minimal" | undefined =
      body && body.partialFailureMode === "minimal" ? "minimal" : undefined;

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
    // #1340 — `sessionId` added for ADAPT sub-op 8
    // (`extractFailureAdaptation`). Nullable during the Slice 0→4
    // transition: backfilled Calls have a parent Session; the live
    // create paths in `createCallEnteringPipeline` don't yet stamp the
    // FK (Slice 3 wires `createSession`). Pipeline gracefully no-ops
    // the failure sub-op when sessionId is null.
    const call = await prisma.call.findUnique({
      where: { id: callId },
      select: { id: true, transcript: true, playbookId: true, requestedModuleId: true, curriculumModuleId: true, sessionId: true },
    });

    if (!call) {
      return NextResponse.json({ ok: false, error: "Call not found", logs: log.getLogs() }, { status: 404 });
    }

    // =====================================================
    // LOAD GUARDRAILS & PIPELINE CONFIG
    // =====================================================
    const guardrails = await loadGuardrails(log);
    const pipelineStages = await loadPipelineStages(log);

    // #1253 — resolve course shape ONCE at pipeline entry. Every downstream
    // stage reads `ctx.courseStyle` and never re-derives. Default-deny:
    // anything not explicitly `lessonPlanMode === "structured"` is treated
    // as CONTINUOUS. See `lib/pipeline/course-style.ts`.
    let courseStyle: CourseStyle = "continuous";
    if (call.playbookId) {
      const pb = await prisma.playbook.findUnique({
        where: { id: call.playbookId },
        select: { config: true },
      });
      courseStyle = getCourseStyle((pb?.config ?? null) as any);
    }
    log.info(`[course-style] resolved: ${courseStyle}`, {
      playbookId: call.playbookId,
    });

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
      courseStyle,
      partialFailureMode,
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
