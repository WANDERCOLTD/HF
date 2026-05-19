/**
 * isCourseComplete — #494 E2 Slice 2.7
 *
 * Pure read predicate: given a learner and a curriculum, decide whether the
 * course is "done" under the course-level `completionMode` flag.
 *
 * Three modes (see `lib/curriculum/course-completion.ts::readCourseFlags`):
 *
 *   - `"all-modules"`   → every authored module must be COMPLETED.
 *   - `"terminal-only"` → at least one module with `terminal === true` is
 *     COMPLETED. Default. The IELTS-style "mock exam" pattern.
 *   - `"any"`           → any one module COMPLETED ends the course (open-ended
 *     / exploratory courses).
 *
 * Works uniformly for BOTH authored and AI-generated routes because both write
 * `CurriculumModule` rows + `CallerModuleProgress` rows.
 *
 * No DB writes. Pure recommendation/predicate — the route layer is responsible
 * for projecting this into a `courseComplete` field on a response payload
 * (downstream slice E5 5.4).
 *
 * `prisma` is injected so the helper is straightforward to unit-test without a
 * live DB.
 */
import type { PrismaClient } from "@prisma/client";
import {
  readCourseFlags,
  readModuleFlags,
  type CompletionMode,
} from "@/lib/curriculum/course-completion";
import type { PlaybookConfig } from "@/lib/types/json-fields";

export interface IsCourseCompleteInput {
  callerId: string;
  curriculumId: string;
  playbookConfig: PlaybookConfig | null;
}

export interface IsCourseCompleteResult {
  complete: boolean;
  mode: CompletionMode;
  /**
   * ISO timestamp of the moment the course transitioned to complete — taken as
   * `max(completedAt)` across the modules that triggered completion. `null`
   * whenever `complete === false`.
   */
  completedAt: string | null;
  /**
   * Module IDs whose COMPLETED state drove the verdict:
   *   - `all-modules`   → every module in the curriculum.
   *   - `terminal-only` → completed terminal modules (often one, can be many).
   *   - `any`           → every COMPLETED module.
   * Empty when `complete === false`.
   */
  triggeringModuleIds: string[];
}

type ProgressStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";

interface ModuleRow {
  id: string;
  slug: string;
  terminal?: boolean | null;
  prerequisites?: string[] | null;
  coversModules?: string[] | null;
  masteryThreshold?: number | null;
}

interface ProgressRow {
  moduleId: string;
  status: string | null;
  completedAt: Date | null;
}

/**
 * Compute whether the learner has completed the course under the configured
 * `completionMode`. Pure read — no DB writes.
 */
export async function isCourseComplete(
  prisma: PrismaClient,
  input: IsCourseCompleteInput,
): Promise<IsCourseCompleteResult> {
  const { callerId, curriculumId, playbookConfig } = input;

  const { completionMode } = readCourseFlags(playbookConfig);

  const empty: IsCourseCompleteResult = {
    complete: false,
    mode: completionMode,
    completedAt: null,
    triggeringModuleIds: [],
  };

  if (!callerId || !curriculumId) return empty;

  // Load all active modules for this curriculum. We need module-level flags
  // (`terminal`, `masteryThreshold`, etc.) — read them through `readModuleFlags`
  // for default-safe access.
  const modules = (await prisma.curriculumModule.findMany({
    where: { curriculumId, isActive: true },
    select: {
      id: true,
      slug: true,
      terminal: true,
      prerequisites: true,
      coversModules: true,
      masteryThreshold: true,
    },
  })) as unknown as ModuleRow[];

  if (modules.length === 0) return empty;

  // Load progress rows for this learner across these modules.
  const progressRows = (await prisma.callerModuleProgress.findMany({
    where: { callerId, moduleId: { in: modules.map((m) => m.id) } },
    select: { moduleId: true, status: true, completedAt: true },
  })) as unknown as ProgressRow[];

  const progressById = new Map<string, ProgressRow>();
  for (const row of progressRows) {
    progressById.set(row.moduleId, row);
  }

  const isCompleted = (moduleId: string): boolean =>
    normaliseStatus(progressById.get(moduleId)?.status) === "COMPLETED";

  const completedAtOf = (moduleId: string): Date | null =>
    progressById.get(moduleId)?.completedAt ?? null;

  switch (completionMode) {
    case "all-modules": {
      const everyComplete = modules.every((m) => isCompleted(m.id));
      if (!everyComplete) return { ...empty, mode: "all-modules" };
      const triggeringModuleIds = modules.map((m) => m.id);
      const completedAt = maxIso(triggeringModuleIds.map(completedAtOf));
      return {
        complete: true,
        mode: "all-modules",
        completedAt,
        triggeringModuleIds,
      };
    }

    case "terminal-only": {
      const terminalModules = modules.filter(
        (m) => readModuleFlags(m).terminal,
      );
      if (terminalModules.length === 0) {
        console.warn(
          "[is-course-complete] terminal-only mode with no terminal modules",
        );
        return { ...empty, mode: "terminal-only" };
      }
      const completedTerminals = terminalModules.filter((m) =>
        isCompleted(m.id),
      );
      if (completedTerminals.length === 0) {
        return { ...empty, mode: "terminal-only" };
      }
      const triggeringModuleIds = completedTerminals.map((m) => m.id);
      const completedAt = maxIso(triggeringModuleIds.map(completedAtOf));
      return {
        complete: true,
        mode: "terminal-only",
        completedAt,
        triggeringModuleIds,
      };
    }

    case "any": {
      const completedModules = modules.filter((m) => isCompleted(m.id));
      if (completedModules.length === 0) return { ...empty, mode: "any" };
      const triggeringModuleIds = completedModules.map((m) => m.id);
      const completedAt = maxIso(triggeringModuleIds.map(completedAtOf));
      return {
        complete: true,
        mode: "any",
        completedAt,
        triggeringModuleIds,
      };
    }
  }
}

function normaliseStatus(raw: string | null | undefined): ProgressStatus {
  if (raw === "COMPLETED" || raw === "IN_PROGRESS" || raw === "NOT_STARTED") {
    return raw;
  }
  return "NOT_STARTED";
}

/**
 * Pick the latest non-null completedAt and return as ISO. Returns `null` when
 * no input contains a valid date (e.g. a COMPLETED row whose `completedAt` was
 * never populated by legacy data).
 */
function maxIso(dates: Array<Date | null>): string | null {
  let max: Date | null = null;
  for (const d of dates) {
    if (!d) continue;
    if (max === null || d.getTime() > max.getTime()) {
      max = d;
    }
  }
  return max ? max.toISOString() : null;
}
