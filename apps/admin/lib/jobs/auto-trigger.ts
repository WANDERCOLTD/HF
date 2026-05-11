/**
 * Auto-trigger curriculum generation after all extractions complete.
 *
 * Called from runBackgroundExtraction() when an extraction task finishes.
 * If all extraction tasks for the subject are done and no curriculum
 * generation is already running, starts one automatically.
 */

import { prisma } from "@/lib/prisma";
import { startCurriculumGeneration } from "./curriculum-runner";

/**
 * Check if all extractions for a subject are done and auto-trigger
 * curriculum generation if so.
 *
 * @returns The new curriculum task ID if triggered, null if skipped.
 */
export async function checkAutoTriggerCurriculum(
  subjectId: string,
  userId: string,
): Promise<string | null> {
  // 1. Any active extraction tasks still running for this subject?
  const activeExtractions = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) as count FROM "UserTask"
    WHERE "taskType" = 'extraction'
      AND "status" = 'in_progress'
      AND "context"->>'subjectId' = ${subjectId}
  `;

  if (Number(activeExtractions[0]?.count ?? 0) > 0) {
    return null; // Still running
  }

  // 2. Any active curriculum generation already running for this subject?
  const activeCurriculum = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) as count FROM "UserTask"
    WHERE "taskType" = 'curriculum_generation'
      AND "status" = 'in_progress'
      AND "context"->>'subjectId' = ${subjectId}
  `;

  if (Number(activeCurriculum[0]?.count ?? 0) > 0) {
    return null; // Already generating
  }

  // 3. Check that there are assertions to generate from
  const assertionCount = await prisma.contentAssertion.count({
    where: {
      source: {
        subjects: { some: { subjectId } },
      },
    },
  });

  if (assertionCount === 0) {
    return null; // Nothing to generate from
  }

  // 4. Look up subject name
  const subject = await prisma.subject.findUnique({
    where: { id: subjectId },
    select: { name: true },
  });

  if (!subject) {
    return null;
  }

  // 5. Auto-trigger
  console.log(
    `[auto-trigger] All extractions for subject "${subject.name}" (${subjectId}) complete. ` +
    `${assertionCount} assertions available. Starting curriculum generation.`
  );

  const taskId = await startCurriculumGeneration(subjectId, subject.name, userId);

  // #317 follow-up — bug #4: auto-trigger fires curriculum-gen as a fully
  // detached background task. Failures are recorded on the UserTask record
  // but no in-flight surface (chat AI, wizard, scorecard) polls it. Attach
  // an out-of-band failure observer that LOG-LOUDLY surfaces the failure so
  // it appears in production traces, even when no UI is watching.
  void (async () => {
    try {
      // Wait a short interval for the runner to finish or fail.
      // The runner timeouts are bounded by AI-call settings (~3 min);
      // poll for up to 5 min.
      const deadline = Date.now() + 5 * 60_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 5_000));
        const task = await prisma.userTask.findUnique({
          where: { id: taskId },
          select: { status: true, blockers: true, context: true },
        });
        if (!task) break;
        if (task.status === "completed") {
          const ctx = task.context as Record<string, unknown> | null;
          const persisted = (ctx?.persisted as boolean | undefined) ?? false;
          if (!persisted) {
            console.warn(
              `[auto-trigger] ⚠️ task ${taskId} (subject ${subjectId}) completed with persisted=false — ` +
                `the AI generated a curriculum preview but no Playbook+Curriculum was written to DB. ` +
                `The user must call create_course / commit endpoint to persist.`,
            );
          }
          break;
        }
        if (task.status === "abandoned" || task.status === "failed") {
          console.error(
            `[auto-trigger] 🚨 task ${taskId} (subject ${subjectId}) ${task.status}. ` +
              `Blockers: ${JSON.stringify(task.blockers)}. ` +
              `Curriculum will NOT be available until the user retries generation.`,
          );
          break;
        }
      }
    } catch (err: any) {
      console.error(`[auto-trigger] failure observer for task ${taskId} crashed:`, err?.message);
    }
  })();

  return taskId;
}
