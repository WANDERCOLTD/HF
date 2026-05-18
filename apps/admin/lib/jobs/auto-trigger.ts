/**
 * Auto-trigger curriculum generation after all extractions complete.
 *
 * Called from runBackgroundExtraction() when an extraction task finishes.
 * If all extraction tasks for the subject are done and no curriculum
 * generation is already running, starts one automatically.
 */

import { prisma } from "@/lib/prisma";
import { startCurriculumGeneration } from "./curriculum-runner";
import { detectAuthoredModules } from "@/lib/wizard/detect-authored-modules";

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

  // 3b. #469 — skip auto-trigger when the playbook has authored modules.
  // applyProjection() (run from create_course + republish) owns the
  // CurriculumModule write path for authored catalogues. Firing the LLM
  // generator here would compete with that path and produce spurious
  // modules from QUESTION_BANK assertions.
  const pbSubject = await prisma.playbookSubject.findFirst({
    where: { subjectId },
    orderBy: { createdAt: "asc" },
    select: { playbookId: true, playbook: { select: { config: true } } },
  });
  if (pbSubject?.playbook?.config) {
    const pbConfig = pbSubject.playbook.config as Record<string, unknown>;
    if (pbConfig.modulesAuthored === true) {
      console.log(
        `[auto-trigger] Skipping curriculum generation — playbook ${pbSubject.playbookId} has authored modules. ` +
        `applyProjection() owns the CurriculumModule write path for this playbook.`,
      );
      return null;
    }
  }

  // 3c. #476 — extraction completes BEFORE create_course, so #469's playbook
  // lookup returns null and the LLM runner wins the race against the doc-side
  // applyProjection. Detect the "Modules authored: Yes" declaration directly
  // from the COURSE_REFERENCE_CANONICAL source's textSample (first ~1000 chars,
  // where the canonical template's `## Course Configuration` preamble lives).
  // detectAuthoredModules is pure regex, stateless, no AI call.
  const canonicalSources = await prisma.subjectSource.findMany({
    where: {
      subjectId,
      source: {
        documentType: { in: ["COURSE_REFERENCE_CANONICAL", "COURSE_REFERENCE"] },
        textSample: { not: null },
      },
    },
    select: {
      source: { select: { id: true, slug: true, textSample: true } },
    },
  });
  for (const { source } of canonicalSources) {
    if (!source.textSample) continue;
    const detected = detectAuthoredModules(source.textSample);
    // Use the header flag directly — table-row parse failures are a
    // create_course-time concern, not a reason to fire the LLM generator.
    // Once the educator declares "Modules authored: Yes" the runner must
    // step out of the way.
    if (detected.modulesAuthored === true) {
      console.log(
        `[auto-trigger] Skipping curriculum generation — source ${source.slug} declares ` +
        `**Modules authored: Yes** (parsed ${detected.modules.length} module(s)). ` +
        `applyProjection() will write the authored catalogue at create_course time.`,
      );
      return null;
    }
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
