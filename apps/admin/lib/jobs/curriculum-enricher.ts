/**
 * Async Curriculum Enrichment
 *
 * Takes a skeleton CONTENT spec (module titles + descriptions only)
 * and enriches it with full detail: learning outcomes, assessment criteria,
 * key terms, delivery config. Runs as a background UserTask.
 *
 * Follows the same pattern as curriculum-runner.ts.
 */

import { prisma } from "@/lib/prisma";
import { startTaskTracking, updateTaskProgress, completeTask, failTask } from "@/lib/ai/task-guidance";
import { generateCurriculumFromGoals } from "@/lib/content-trust/extract-curriculum";
import { patchContentSpecForContract } from "@/lib/domain/generate-content-spec";
import { bumpPlaybookComposeTimestamp } from "@/lib/compose/bump-timestamp";
import { resolvePlaybookIdsForAnalysisSpec } from "@/lib/curriculum/resolve-playbook-for-curriculum";

export interface EnrichmentInput {
  subjectName: string;
  persona: string;
  learningGoals: string[];
  qualificationRef?: string;
  domainId: string;
}

/**
 * Start async curriculum enrichment for a skeleton CONTENT spec.
 * Returns the taskId immediately — AI runs in background.
 */
export async function startCurriculumEnrichment(
  contentSpecId: string,
  input: EnrichmentInput,
  userId: string,
): Promise<string> {
  const taskId = await startTaskTracking(userId, "curriculum_enrichment", {
    contentSpecId,
    subjectName: input.subjectName,
    domainId: input.domainId,
  });

  // Fire-and-forget background enrichment
  runCurriculumEnrichment(taskId, contentSpecId, input).catch(async (err) => {
    console.error(`[curriculum-enricher] Task ${taskId} unhandled error:`, err);
    await failTask(taskId, err.message || "Curriculum enrichment failed");
  });

  return taskId;
}

async function runCurriculumEnrichment(
  taskId: string,
  contentSpecId: string,
  input: EnrichmentInput,
): Promise<void> {
  // Step 1: Generate full curriculum with Sonnet
  await updateTaskProgress(taskId, { currentStep: 1, context: { phase: "generating" } });

  const fullCurriculum = await generateCurriculumFromGoals(
    input.subjectName,
    input.persona,
    input.learningGoals,
    input.qualificationRef,
  );

  if (!fullCurriculum.ok || fullCurriculum.modules.length === 0) {
    await failTask(taskId, fullCurriculum.error || "Enrichment produced no modules");
    return;
  }

  // Step 2: Patch the CONTENT spec with full modules
  await updateTaskProgress(taskId, { currentStep: 2, context: { phase: "patching" } });

  const spec = await prisma.analysisSpec.findUnique({
    where: { id: contentSpecId },
    select: { config: true },
  });

  if (!spec) {
    await failTask(taskId, "Content spec not found");
    return;
  }

  const cfg = (spec.config || {}) as Record<string, any>;

  // Replace skeleton modules with full detail
  cfg.modules = fullCurriculum.modules;
  cfg.deliveryConfig = fullCurriculum.deliveryConfig;
  cfg.enrichedAt = new Date().toISOString();
  cfg.generatedFrom = "goals-enriched";

  await prisma.analysisSpec.update({
    where: { id: contentSpecId },
    data: { config: cfg },
  });

  // Re-run contract patching with full modules
  await patchContentSpecForContract(contentSpecId);

  // #834 — post-enrolment background enrichment. The patched spec
  // flows into compose via the content-authority loader. Bump every
  // playbook that links this spec via PlaybookItem so the next call
  // recomposes against the enriched modules.
  const playbookIds = await resolvePlaybookIdsForAnalysisSpec(contentSpecId);
  for (const pbId of playbookIds) await bumpPlaybookComposeTimestamp(pbId);

  // Step 3: Complete
  await updateTaskProgress(taskId, {
    currentStep: 3,
    context: {
      phase: "complete",
      moduleCount: fullCurriculum.modules.length,
      enrichedAt: cfg.enrichedAt,
      summary: {
        contentSpecId,
        counts: { modules: fullCurriculum.modules.length },
      },
    },
  });

  await completeTask(taskId);
}
