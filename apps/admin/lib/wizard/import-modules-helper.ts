/**
 * import-modules-helper.ts
 *
 * Shared core for the "import authored modules from a Course Reference"
 * pipeline. Used by:
 *   1. POST /api/courses/[courseId]/import-modules  (manual re-import)
 *   2. create_course tool (wizard-tool-executor)    (auto-import at creation)
 *
 * Why a shared helper: the bug we're fixing (#318 follow-up) is that
 * `create_course` returned success even when the playbook's
 * `config.modules` was empty despite the course-ref containing
 * `**Modules authored:** Yes` + a `## Modules` table. The manual re-import
 * endpoint already did the right thing; create_course just wasn't calling
 * any of it. Pulling the logic into one function eliminates the drift.
 *
 * Caller contract:
 *   - Pass an open Prisma transaction (`tx`). The helper writes
 *     Playbook.config + CurriculumModule + LearningObjective inside it.
 *   - Run `reclassifyLearningObjectives(curriculumId)` AFTER the outer
 *     transaction commits. The classifier opens its own transactions and
 *     will deadlock if called from inside this one.
 *
 * Issue #318 follow-up.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import type { PlaybookConfig } from "@/lib/types/json-fields";
import {
  detectAuthoredModules,
  extractOutcomeStatements,
  type DetectedAuthoredModules,
} from "./detect-authored-modules";
import { applyAuthoredModules, hasBlockingErrors } from "./persist-authored-modules";
import { syncAuthoredModulesToCurriculum } from "./sync-authored-modules-to-curriculum";

type Tx = PrismaClient | Prisma.TransactionClient;

export interface ImportModulesResult {
  /** Parser output (modules, defaults, warnings, source ranges). */
  detected: DetectedAuthoredModules;
  /** True when the merge actually changed the Playbook.config. */
  persisted: boolean;
  /** True when the parse produced an error-severity warning. */
  hasErrors: boolean;
  /** Curriculum upsert result — null when no modules were synced. */
  curriculumSync: Awaited<ReturnType<typeof syncAuthoredModulesToCurriculum>> | null;
}

export interface ImportModulesOptions {
  sourceRef?: { docId: string; version: string };
}

/**
 * Parse a Course Reference markdown body and merge the result into the
 * Playbook + Curriculum. Does NOT run audience-split classification — that
 * has to happen after the caller's transaction commits.
 *
 * Idempotent: re-importing the same markdown produces the same result.
 */
export async function importAuthoredModulesIntoPlaybook(
  tx: Tx,
  playbookId: string,
  markdown: string,
  options: ImportModulesOptions = {},
): Promise<ImportModulesResult> {
  const detected = detectAuthoredModules(markdown);
  // #258: also pull in outcome statements so authored OUT-NN refs become
  // first-class LearningObjective rows downstream. Without this, MCQs land
  // with null learningOutcomeRef because no whitelist match is possible.
  const outcomes = extractOutcomeStatements(markdown);
  detected.outcomes = { ...detected.outcomes, ...outcomes };

  const playbook = await tx.playbook.findUnique({
    where: { id: playbookId },
    select: { id: true, config: true },
  });
  if (!playbook) {
    throw new Error(`Playbook ${playbookId} not found`);
  }
  const existingConfig = (playbook.config ?? {}) as PlaybookConfig;
  const { config: nextConfig, changed } = applyAuthoredModules(
    existingConfig,
    detected,
    { sourceRef: options.sourceRef },
  );

  let curriculumSync: ImportModulesResult["curriculumSync"] = null;
  if (changed) {
    await tx.playbook.update({
      where: { id: playbookId },
      data: { config: nextConfig as object },
    });
    if (detected.modulesAuthored === true && detected.modules.length > 0) {
      curriculumSync = await syncAuthoredModulesToCurriculum(
        tx,
        playbookId,
        detected.modules,
        detected.outcomes,
      );
    }
  }

  return {
    detected,
    persisted: changed,
    hasErrors: hasBlockingErrors(detected),
    curriculumSync,
  };
}
