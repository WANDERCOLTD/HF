/**
 * courseComplete loader (#492 E3 Slice 3.7)
 *
 * Surfaces the course-completion verdict (from `isCourseComplete`) into the
 * composition pipeline. When `courseComplete === true`, downstream sections
 * MUST stop teaching new content:
 *
 *   - `transforms/courseComplete.ts::buildCourseCompleteBlock` emits a
 *     celebratory block at the top of the prompt (priority 5, HIGH).
 *   - `transforms/modules.ts::computeModuleProgress` thins the modules list
 *     to titles-only and clears `nextModule` so the tutor doesn't push the
 *     learner toward a "next" module that doesn't exist.
 *
 * Pure function — takes a prisma client + scope so it can be unit-tested
 * against a minimal mock client. The `SectionDataLoader` wrapper layers a
 * try/catch on top so any failure degrades to `courseComplete: false`
 * (section omitted, modules section unchanged).
 *
 * @see lib/curriculum/is-course-complete.ts
 * @see transforms/courseComplete.ts
 */

import type { PrismaClient } from "@prisma/client";
import { isCourseComplete } from "@/lib/curriculum/is-course-complete";
import type { CompletionMode } from "@/lib/curriculum/course-completion";
import type { PlaybookConfig } from "@/lib/types/json-fields";

/**
 * Shape consumed by:
 *   - `transforms/courseComplete.ts::buildCourseCompleteBlock` (full section)
 *   - `transforms/modules.ts::computeModuleProgress` (thin-modules toggle)
 */
export interface CourseCompleteData {
  courseComplete: boolean;
  /** ISO 8601 of the completing CallerModuleProgress.completedAt. Null when not complete. */
  completedAt: string | null;
  /** Mode that produced the verdict (defaulted from playbookConfig). Null when not complete. */
  completionMode: CompletionMode | null;
  /** Whole-day delta `floor((now - completedAt) / 86_400_000)`. Null when not complete. */
  daysSinceCompletion: number | null;
}

export interface LoadCourseCompleteOptions {
  callerId: string;
  /** Optional — falsy values short-circuit to the not-complete shape. */
  curriculumId: string | null | undefined;
  playbookConfig: PlaybookConfig | null;
  /** Override "now" for deterministic tests. */
  now?: Date;
}

const NOT_COMPLETE: CourseCompleteData = {
  courseComplete: false,
  completedAt: null,
  completionMode: null,
  daysSinceCompletion: null,
};

const MS_PER_DAY = 86_400_000;

/**
 * Narrowed prisma surface — `isCourseComplete` only touches
 * `curriculumModule` + `callerModuleProgress`.
 */
type PrismaForLoader = Pick<PrismaClient, "curriculumModule" | "callerModuleProgress">;

/**
 * Load the course-completion verdict for a learner. Always resolves — every
 * failure path returns `{ courseComplete: false, ... }`. The `SectionDataLoader`
 * wrapper additionally catches thrown errors so composition never breaks on
 * a completion miss.
 */
export async function loadCourseComplete(
  prisma: PrismaForLoader,
  opts: LoadCourseCompleteOptions,
): Promise<CourseCompleteData> {
  const { callerId, curriculumId, playbookConfig, now } = opts;
  if (!callerId || !curriculumId) return NOT_COMPLETE;

  const verdict = await isCourseComplete(prisma as unknown as PrismaClient, {
    callerId,
    curriculumId,
    playbookConfig,
  });

  if (!verdict.complete) {
    return {
      courseComplete: false,
      completedAt: null,
      completionMode: verdict.mode,
      daysSinceCompletion: null,
    };
  }

  const completedAtIso = verdict.completedAt;
  const completedAtMs = completedAtIso ? Date.parse(completedAtIso) : NaN;
  const nowMs = (now ?? new Date()).getTime();
  const daysSinceCompletion = Number.isFinite(completedAtMs)
    ? Math.max(0, Math.floor((nowMs - completedAtMs) / MS_PER_DAY))
    : null;

  return {
    courseComplete: true,
    completedAt: completedAtIso,
    completionMode: verdict.mode,
    daysSinceCompletion,
  };
}
