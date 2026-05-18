/**
 * #447 data correction — delete `Goal` rows projected from
 * `COURSE_REFERENCE_ASSESSOR_RUBRIC` sources.
 *
 * Before #447, the projection orchestrator (`run-projection-for-playbook.ts`)
 * and the sync-from-reference path (`sync-goals-from-reference.ts`) both
 * accepted rubric documents. The rubric's band-descriptor lines and
 * skill-definition prose got materialised as standalone Goal rows on the
 * caller's What tab — e.g.
 *   "Band 2 LR: Only produces isolated words or memorised utterances"
 *   "Band 4 LR: Uses a limited range of pronunciation features..."
 * These are scoring-calibration material, not learner goals. The MEASURE
 * spec is the correct downstream consumer (via ContentAssertion rows).
 *
 * The code fix lands in the same PR so re-projection doesn't recreate
 * these rows. This script wipes the existing pollution.
 *
 * Pre-flight: lists any playbook whose ONLY linked `COURSE_REFERENCE*`
 * source is a rubric. Removing the rubric from projection leaves these
 * playbooks degenerate (no goals/BehaviorTargets/CurriculumModules). The
 * fix is to upload a canonical course-reference doc to those playbooks
 * before re-projecting — this script flags them, never mutates them.
 *
 * Goal deletion safety: Goal has no inbound FK (`CallScore`,
 * `CallerModuleProgress`, `CallerPlaybook` do not reference Goal.id).
 * `Goal.callerId` cascades from Caller, not the other direction. So a
 * plain delete is safe — no orphaned rows, no FK violations.
 *
 * Run from `apps/admin/`:
 *   npx tsx scripts/cleanup-rubric-projected-goals.ts            # dry-run (default)
 *   npx tsx scripts/cleanup-rubric-projected-goals.ts --commit   # actually delete
 */

import { prisma } from "@/lib/prisma";

async function main() {
  const commit = process.argv.includes("--commit");

  // 1. Find all rubric sources
  const rubricSources = await prisma.contentSource.findMany({
    where: { documentType: "COURSE_REFERENCE_ASSESSOR_RUBRIC" },
    select: { id: true, name: true },
  });

  console.log(
    `[cleanup-rubric-projected-goals] Found ${rubricSources.length} COURSE_REFERENCE_ASSESSOR_RUBRIC source(s).`,
  );

  if (rubricSources.length === 0) {
    console.log("[cleanup-rubric-projected-goals] Nothing to do.");
    return;
  }

  const rubricSourceIds = rubricSources.map((s) => s.id);

  // 2. Pre-flight — list playbooks whose only COURSE_REFERENCE* link is a rubric.
  // These would go degenerate (no goals projected) once the rubric is no longer
  // consumed by run-projection-for-playbook.
  const playbookLinks = await prisma.playbookSource.findMany({
    where: {
      source: {
        documentType: {
          in: [
            "COURSE_REFERENCE",
            "COURSE_REFERENCE_CANONICAL",
            "COURSE_REFERENCE_TUTOR_BRIEFING",
            "COURSE_REFERENCE_ASSESSOR_RUBRIC",
          ],
        },
      },
    },
    select: {
      playbookId: true,
      source: { select: { id: true, name: true, documentType: true } },
    },
  });

  const byPlaybook = new Map<string, typeof playbookLinks>();
  for (const link of playbookLinks) {
    const arr = byPlaybook.get(link.playbookId) ?? [];
    arr.push(link);
    byPlaybook.set(link.playbookId, arr);
  }

  const degenerateRisk: { playbookId: string; rubricName: string }[] = [];
  for (const [playbookId, links] of byPlaybook) {
    const rubricLinks = links.filter(
      (l) => l.source.documentType === "COURSE_REFERENCE_ASSESSOR_RUBRIC",
    );
    if (rubricLinks.length > 0 && rubricLinks.length === links.length) {
      degenerateRisk.push({
        playbookId,
        rubricName: rubricLinks[0].source.name,
      });
    }
  }

  if (degenerateRisk.length > 0) {
    console.warn(
      `[cleanup-rubric-projected-goals] WARNING — ${degenerateRisk.length} playbook(s) have ONLY a rubric source linked. After #447 they will have zero goals/BehaviorTargets. Upload a canonical course-reference doc before re-projecting:`,
    );
    for (const d of degenerateRisk) {
      console.warn(`  - playbook=${d.playbookId} rubric="${d.rubricName}"`);
    }
  }

  // 3. Identify goals projected from a rubric source.
  const goals = await prisma.goal.findMany({
    where: { sourceContentId: { in: rubricSourceIds } },
    select: {
      id: true,
      callerId: true,
      playbookId: true,
      type: true,
      name: true,
      sourceContentId: true,
    },
  });

  console.log(
    `[cleanup-rubric-projected-goals] ${goals.length} Goal row(s) projected from a rubric source.`,
  );

  if (goals.length === 0) {
    console.log("[cleanup-rubric-projected-goals] No goals to delete.");
    return;
  }

  const byType = goals.reduce<Record<string, number>>((acc, g) => {
    acc[g.type] = (acc[g.type] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    "[cleanup-rubric-projected-goals] By type:",
    Object.entries(byType)
      .map(([k, v]) => `${k}=${v}`)
      .join(" "),
  );

  for (const g of goals.slice(0, 10)) {
    console.log(
      `  - goal=${g.id} caller=${g.callerId} playbook=${g.playbookId ?? "-"} type=${g.type} name="${g.name.slice(0, 80)}"`,
    );
  }
  if (goals.length > 10) console.log(`  ... and ${goals.length - 10} more`);

  // 4. Also strip rubric-derived templates from Playbook.config.goals so
  // re-enrollment doesn't reinstate them via instantiatePlaybookGoals().
  const rubricSourceNames = new Set(rubricSources.map((s) => s.name));
  const playbookIds = [...new Set(goals.map((g) => g.playbookId).filter((p): p is string => !!p))];
  const playbooks = await prisma.playbook.findMany({
    where: { id: { in: playbookIds } },
    select: { id: true, config: true },
  });

  type GoalTemplate = { name?: string; type?: string; [k: string]: unknown };
  type PlaybookConfigShape = { goals?: GoalTemplate[]; [k: string]: unknown };

  const templateUpdates: { id: string; before: number; after: number }[] = [];
  for (const pb of playbooks) {
    const config = (pb.config ?? {}) as PlaybookConfigShape;
    const templates: GoalTemplate[] = Array.isArray(config.goals) ? config.goals : [];
    if (templates.length === 0) continue;

    // Match goals by name against the materialised rogue goals on this playbook.
    const rogueNames = new Set(
      goals.filter((g) => g.playbookId === pb.id).map((g) => g.name),
    );
    const kept = templates.filter(
      (t) => typeof t.name !== "string" || !rogueNames.has(t.name),
    );
    if (kept.length !== templates.length) {
      templateUpdates.push({ id: pb.id, before: templates.length, after: kept.length });
      if (commit) {
        await prisma.playbook.update({
          where: { id: pb.id },
          data: { config: { ...config, goals: kept } as never },
        });
      }
    }
  }
  if (templateUpdates.length > 0) {
    console.log(
      `[cleanup-rubric-projected-goals] Playbook.config.goals templates to prune: ${templateUpdates.length} playbook(s)`,
    );
    for (const u of templateUpdates) {
      console.log(`  - playbook=${u.id} ${u.before} -> ${u.after}`);
    }
  }

  // Note rubric source names for log breadcrumb (helps post-hoc audit)
  console.log(
    `[cleanup-rubric-projected-goals] Rubric sources scanned: ${[...rubricSourceNames].join(", ")}`,
  );

  if (!commit) {
    console.log("[cleanup-rubric-projected-goals] --commit not passed: no writes performed. Re-run with --commit to delete.");
    return;
  }

  const deleted = await prisma.goal.deleteMany({
    where: { id: { in: goals.map((g) => g.id) } },
  });

  console.log(
    `[cleanup-rubric-projected-goals] Deleted ${deleted.count} Goal row(s) projected from rubric sources.`,
  );
}

main()
  .catch((err) => {
    console.error("[cleanup-rubric-projected-goals] FAILED:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
