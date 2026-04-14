/**
 * Async curriculum generation via UserTask.
 *
 * Creates a UserTask of type "curriculum_generation", fires the AI call
 * in the background, and stores the preview result in task context.
 */

import { prisma } from "@/lib/prisma";
import { startTaskTracking, updateTaskProgress, completeTask, failTask } from "@/lib/ai/task-guidance";
import { extractCurriculumFromAssertions } from "@/lib/content-trust/extract-curriculum";

/**
 * Start async curriculum generation for a subject.
 * Returns the taskId immediately — AI runs in background.
 */
export async function startCurriculumGeneration(
  subjectId: string,
  subjectName: string,
  userId: string,
): Promise<string> {
  const taskId = await startTaskTracking(userId, "curriculum_generation", {
    subjectId,
    subjectName,
  });

  // Fire-and-forget background generation
  runCurriculumGeneration(taskId, subjectId, subjectName).catch(async (err) => {
    console.error(`[curriculum-runner] Task ${taskId} unhandled error:`, err);
    await failTask(taskId, err.message || "Curriculum generation failed");
  });

  return taskId;
}

async function runCurriculumGeneration(
  taskId: string,
  subjectId: string,
  subjectName: string,
): Promise<void> {
  // Step 1: Load assertions
  await updateTaskProgress(taskId, { currentStep: 1 });

  const subject = await prisma.subject.findUnique({
    where: { id: subjectId },
  });

  if (!subject) {
    await failTask(taskId, "Subject not found");
    return;
  }

  // Find syllabus-tagged sources, fall back to all
  const syllabusSources = await prisma.subjectSource.findMany({
    where: { subjectId, tags: { has: "syllabus" } },
    select: { sourceId: true },
  });

  const sourceIds = syllabusSources.length > 0
    ? syllabusSources.map((s) => s.sourceId)
    : (
        await prisma.subjectSource.findMany({
          where: { subjectId },
          select: { sourceId: true },
        })
      ).map((s) => s.sourceId);

  if (sourceIds.length === 0) {
    await failTask(taskId, "No sources attached to this subject");
    return;
  }

  const assertions = await prisma.contentAssertion.findMany({
    where: { sourceId: { in: sourceIds } },
    select: {
      id: true, // required for in-extractor LO-ref write-back
      assertion: true,
      category: true,
      chapter: true,
      section: true,
      tags: true,
    },
    orderBy: [{ chapter: "asc" }, { section: "asc" }, { createdAt: "asc" }],
  });

  if (assertions.length === 0) {
    await failTask(taskId, "No assertions found. Extract documents first.");
    return;
  }

  await updateTaskProgress(taskId, {
    context: { assertionCount: assertions.length },
  });

  // Step 2: Generate curriculum via AI
  await updateTaskProgress(taskId, { currentStep: 2 });

  // Build the 1-based index → assertion ID map in the SAME ordering used by
  // extractCurriculumFromAssertions so the AI's assertionTags[i] can be
  // resolved back to a real UUID at commit time.
  const assertionIdByIndexObj: Record<string, string> = {};
  assertions.forEach((a, i) => { assertionIdByIndexObj[String(i + 1)] = a.id; });

  const result = await extractCurriculumFromAssertions(
    assertions,
    subjectName,
    subject.qualificationRef || undefined,
  );

  if (!result.ok) {
    await failTask(taskId, result.error || "Curriculum extraction failed");
    return;
  }

  // Step 3: Complete — store preview + summary + assertion index map in
  // context. Maps don't JSON-serialise, so we keep the map as a plain object
  // keyed by stringified index; the commit route rebuilds the Map.
  await updateTaskProgress(taskId, {
    currentStep: 3,
    context: {
      preview: result,
      assertionIdByIndexObj,
      moduleCount: result.modules?.length ?? 0,
      warnings: result.warnings,
      summary: {
        subject: { id: subjectId, name: subjectName },
        counts: {
          modules: result.modules?.length ?? 0,
          assertions: assertions.length,
        },
      },
    },
  });

  await completeTask(taskId);
}
