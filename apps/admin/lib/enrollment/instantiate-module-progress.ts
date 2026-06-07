/**
 * Instantiate CallerModuleProgress rows for a caller's STRUCTURED playbook
 * enrolments (#1254).
 *
 * Sibling of `instantiate-goals.ts` / `instantiate-targets.ts`. For each
 * active enrolment where the playbook resolves to STRUCTURED (
 * `config.lessonPlanMode === "structured"`), upserts a NOT_STARTED row
 * for every CurriculumModule under the primary Curriculum.
 *
 * Why this exists: pre-#1254, CallerModuleProgress rows were created lazily
 * by the pipeline's `incrementModuleEvidence` on the first call that
 * resolved a module. A freshly enrolled learner on a STRUCTURED course
 * therefore had no progress rows until call #1 — and the modules transform
 * fell through to the `estimatedProgress = recentCalls.length / 2` heuristic
 * (the I-C5 fallback in CHAIN-CONTRACTS.md), which is the bug #1252 closes.
 *
 * Seeding NOT_STARTED rows at enrolment means Layer 2 of the
 * `computeModuleProgress` derivation (the `moduleAttemptCounts` read)
 * always sees real data. The `callCount > 0` invariant inside that layer
 * is the load-bearing guard — pre-seeded rows with `callCount = 0` do
 * NOT mark the module as attempted. The runtime increment in
 * `incrementModuleEvidence` keeps working unchanged because it upserts
 * (create on miss; update otherwise), so it now updates the pre-seeded
 * row instead of creating one.
 *
 * Why CONTINUOUS playbooks are skipped: they have no module sequence to
 * seed. A CONTINUOUS playbook with a Curriculum (for topic-pool assertions)
 * still has no learner-facing "module N is next" arc, so seeding
 * NOT_STARTED rows would be misleading.
 *
 * Idempotent: uses `createMany({ skipDuplicates: true })` against the
 * `(callerId, moduleId)` unique constraint.
 *
 * Failure policy: returns `{ created, skipped }` on success. Callers wrap
 * this in `.catch(...)` to log-and-continue. Goals are the load-bearing
 * artifact; module-progress rows are an evidence-tracking affordance that
 * the pipeline can rebuild on first call.
 */

import { prisma } from "@/lib/prisma";
import { getCourseStyle } from "@/lib/pipeline/course-style";
import type { PlaybookConfig } from "@/lib/types/json-fields";

export interface InstantiateModuleProgressResult {
  created: number;
  skipped: number;
  structuredPlaybooks: number;
  continuousPlaybooks: number;
}

export async function instantiatePlaybookModuleProgress(
  callerId: string,
): Promise<InstantiateModuleProgressResult> {
  const enrollments = await prisma.callerPlaybook.findMany({
    where: { callerId, status: "ACTIVE" },
    select: { playbookId: true },
  });

  if (enrollments.length === 0) {
    return { created: 0, skipped: 0, structuredPlaybooks: 0, continuousPlaybooks: 0 };
  }

  const playbookIds = enrollments.map((e) => e.playbookId);

  const playbooks = await prisma.playbook.findMany({
    where: { id: { in: playbookIds } },
    select: {
      id: true,
      config: true,
      playbookCurricula: {
        where: { role: "primary" },
        select: { curriculumId: true },
        take: 1,
      },
    },
  });

  let structuredPlaybooks = 0;
  let continuousPlaybooks = 0;
  const moduleIdsToSeed: string[] = [];

  for (const pb of playbooks) {
    const courseStyle = getCourseStyle((pb.config ?? null) as PlaybookConfig | null);
    if (courseStyle !== "structured") {
      continuousPlaybooks += 1;
      continue;
    }
    structuredPlaybooks += 1;

    const primaryCurriculumId = pb.playbookCurricula[0]?.curriculumId;
    if (!primaryCurriculumId) continue;

    const modules = await prisma.curriculumModule.findMany({
      where: { curriculumId: primaryCurriculumId },
      select: { id: true },
    });
    for (const m of modules) moduleIdsToSeed.push(m.id);
  }

  if (moduleIdsToSeed.length === 0) {
    return { created: 0, skipped: 0, structuredPlaybooks, continuousPlaybooks };
  }

  const rows = moduleIdsToSeed.map((moduleId) => ({
    callerId,
    moduleId,
    mastery: 0,
    status: "NOT_STARTED",
    callCount: 0,
  }));

  const result = await prisma.callerModuleProgress.createMany({
    data: rows,
    skipDuplicates: true,
  });

  return {
    created: result.count,
    skipped: rows.length - result.count,
    structuredPlaybooks,
    continuousPlaybooks,
  };
}
