/**
 * #308: Module-balanced MCQ generation — caller-layer helpers.
 *
 * The assessment package generates MCQs without knowing about authored modules.
 * `resolveModuleGroupsForSource` does the lookup once, and the result is passed
 * into `generateMcqsForSource` so the assessment package itself stays course-
 * type-agnostic (TL guidance from #308 review).
 *
 * Returns null when the source belongs to a non-authored playbook — callers
 * fall through to the existing Bloom-distributed prompt path.
 */

import { prisma } from "@/lib/prisma";
import type { AuthoredModule } from "@/lib/types/json-fields";

export interface ModuleGroup {
  /** AuthoredModule.id — e.g. "part1", "mock". */
  moduleId: string;
  /** AuthoredModule.label — e.g. "Part 1: Familiar Topics". */
  moduleLabel: string;
  /** outcomesPrimary refs — e.g. ["OUT-01", "OUT-06"]. */
  outcomeRefs: string[];
}

/**
 * Resolve the module → outcome groupings for a content source.
 *
 * Path: ContentSource → PlaybookSource → Playbook.config.modules[]. Uses the
 * `outcomesPrimary` array on each authored module as the canonical group def.
 * The string-ref path covers 74% of IELTS v2 assertions vs. 41% for the
 * `learningObjectiveId` FK, so we group by `learningOutcomeRef` here and let
 * the FK-backfill story (out of scope for #308) raise that later.
 *
 * Returns null when:
 *   - source has no PlaybookSource link (legacy SubjectSource path)
 *   - playbook config has no `modules` array (non-authored course)
 *   - all modules have empty `outcomesPrimary` (e.g. baseline-only courses)
 */
export async function resolveModuleGroupsForSource(
  sourceId: string,
): Promise<ModuleGroup[] | null> {
  const playbookSource = await prisma.playbookSource.findFirst({
    where: { sourceId },
    select: {
      playbook: {
        select: {
          config: true,
          curricula: { select: { id: true }, orderBy: { createdAt: "asc" }, take: 1 },
        },
      },
    },
  });

  if (!playbookSource?.playbook?.config) return null;

  const cfg = playbookSource.playbook.config as { modules?: AuthoredModule[] } | null;
  const modules = Array.isArray(cfg?.modules) ? cfg!.modules : [];
  if (modules.length === 0) return null;

  // #317 — load systemRole for each ref in this curriculum so we can drop
  // refs that point to system-only LOs (rubric / score-explainer / teaching-
  // instruction). They describe how the assessor scores or how the tutor
  // teaches, not what the learner should answer questions about.
  // ITEM_GENERATOR_SPEC refs stay included — they're boundary specs the
  // question generator legitimately consumes.
  const curriculumId = playbookSource.playbook.curricula[0]?.id ?? null;
  const excludedRefs = new Set<string>();
  if (curriculumId) {
    const allRefs = modules.flatMap((m) => (Array.isArray(m?.outcomesPrimary) ? (m.outcomesPrimary as string[]) : []));
    if (allRefs.length > 0) {
      const excluded = await prisma.learningObjective.findMany({
        where: {
          module: { curriculumId },
          ref: { in: allRefs },
          systemRole: { in: ["ASSESSOR_RUBRIC", "SCORE_EXPLAINER", "TEACHING_INSTRUCTION"] },
        },
        select: { ref: true },
      });
      for (const lo of excluded) excludedRefs.add(lo.ref);
    }
  }

  const groups: ModuleGroup[] = [];
  for (const m of modules) {
    const allRefs: string[] = Array.isArray(m?.outcomesPrimary)
      ? (m.outcomesPrimary as string[]).filter((r) => typeof r === "string" && r.length > 0)
      : [];
    // Drop ASSESSOR_RUBRIC + SCORE_EXPLAINER refs (Q2 decision per #317).
    const outcomeRefs = allRefs.filter((r) => !excludedRefs.has(r));
    if (outcomeRefs.length === 0) continue; // skip modules where every ref is system-only
    groups.push({
      moduleId: m.id,
      moduleLabel: m.label || m.id,
      outcomeRefs,
    });
  }

  if (excludedRefs.size > 0) {
    console.log(
      `[module-groups] #317 excluded ${excludedRefs.size} system-only LO ref(s) from MCQ pool: ${[...excludedRefs].join(", ")}`,
    );
  }

  return groups.length > 0 ? groups : null;
}

/**
 * Per-module question budget. Returns one count per group.
 *
 * Floor = 1 per module so a thin module isn't excluded entirely.
 * Target = TARGET_PER_MODULE per module (matches the pre-test default count).
 * Total cap = MAX_TOTAL_COUNT to bound the AI prompt size on courses with many
 * modules; budgets shrink proportionally when target × numModules > cap.
 */
export const TARGET_PER_MODULE = 5;
export const MAX_TOTAL_COUNT = 40;

export function computeModuleBudget(numModules: number): number[] {
  if (numModules <= 0) return [];
  const target = TARGET_PER_MODULE * numModules;
  if (target <= MAX_TOTAL_COUNT) {
    return new Array(numModules).fill(TARGET_PER_MODULE);
  }
  // Many-module course: shrink each budget proportionally, floor at 1.
  const shrunk = Math.max(1, Math.floor(MAX_TOTAL_COUNT / numModules));
  return new Array(numModules).fill(shrunk);
}
