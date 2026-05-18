/**
 * #447 data correction — delete LEARN goal rows and Playbook.config.goals
 * templates that were written by the wizard's AI learning-outcome extraction
 * when the AI returned rubric calibration prose (band descriptors, tier-name
 * lines) as "learning outcomes".
 *
 * Originally targeted COURSE_REFERENCE_ASSESSOR_RUBRIC subtype sources, but
 * dry-run on hf-dev revealed 0 sources of that subtype — the rubric docs
 * are classified as plain COURSE_REFERENCE. The actual writer is
 * wizard-tool-executor.ts::create_course (see lib/chat/wizard-ai-output-guard.ts).
 *
 * The rogue rows have a distinctive shape:
 *   { type: "LEARN", isDefault: true, priority: 5, ref: null, sourceContentId: null }
 * Whereas projection-written LEARN templates carry `ref: "OUT-NN"` and
 * `sourceContentId`. Hand-authored LEARN templates may have neither, so we
 * scope the matcher to playbooks where projection IS authoritative (i.e.
 * has at least one OUT-NN LEARN template). On those playbooks, a bare LEARN
 * template with no ref + no sourceContentId is definitionally rogue.
 *
 * Run from `apps/admin/`:
 *   npx tsx scripts/cleanup-rubric-projected-goals.ts            # dry-run (default)
 *   npx tsx scripts/cleanup-rubric-projected-goals.ts --commit   # actually delete
 *
 * Pre-flight: lists each affected playbook and the rogue template names.
 *
 * Goal FK safety: no model has an inbound FK to Goal.id (CallScore,
 * CallerModuleProgress, CallerPlaybook all reference Caller, not Goal). So
 * `prisma.goal.deleteMany` is safe — no orphaned rows.
 */

import { prisma } from "@/lib/prisma";

type AnyGoalTemplate = {
  name?: string;
  type?: string;
  ref?: string | null;
  sourceContentId?: string | null;
  isAssessmentTarget?: boolean;
  [k: string]: unknown;
};

type PlaybookConfigShape = {
  goals?: AnyGoalTemplate[];
  [k: string]: unknown;
};

const OUT_REF_PATTERN = /^OUT-\d+$/i;

function isProjectionAuthoritative(templates: AnyGoalTemplate[]): boolean {
  return templates.some(
    (t) => t.type === "LEARN" && typeof t.ref === "string" && OUT_REF_PATTERN.test(t.ref),
  );
}

function isRogueLearnTemplate(t: AnyGoalTemplate): boolean {
  if (t.type !== "LEARN") return false;
  if (typeof t.ref === "string" && t.ref.length > 0) return false;
  if (typeof t.sourceContentId === "string" && t.sourceContentId.length > 0) return false;
  return true;
}

async function main() {
  const commit = process.argv.includes("--commit");

  // 1. Scan every playbook with a config.goals array.
  const playbooks = await prisma.playbook.findMany({
    where: { config: { not: undefined } },
    select: { id: true, name: true, version: true, config: true },
  });

  console.log(`[cleanup] Scanned ${playbooks.length} playbook(s).`);

  const affected: Array<{
    id: string;
    name: string;
    version: string | null;
    rogueTemplates: AnyGoalTemplate[];
    keptTemplates: AnyGoalTemplate[];
    nextConfig: PlaybookConfigShape;
  }> = [];

  for (const pb of playbooks) {
    const config = (pb.config ?? {}) as PlaybookConfigShape;
    const templates: AnyGoalTemplate[] = Array.isArray(config.goals) ? config.goals : [];
    if (templates.length === 0) continue;
    if (!isProjectionAuthoritative(templates)) continue;

    const rogue = templates.filter(isRogueLearnTemplate);
    if (rogue.length === 0) continue;

    affected.push({
      id: pb.id,
      name: pb.name,
      version: (pb as { version?: string | null }).version ?? null,
      rogueTemplates: rogue,
      keptTemplates: templates.filter((t) => !rogue.includes(t)),
      nextConfig: { ...config, goals: templates.filter((t) => !rogue.includes(t)) },
    });
  }

  if (affected.length === 0) {
    console.log("[cleanup] No projection-authoritative playbooks have rogue LEARN templates. Nothing to do.");
    return;
  }

  console.log(`[cleanup] ${affected.length} projection-authoritative playbook(s) carry rogue LEARN templates:`);
  for (const a of affected) {
    console.log(`  - playbook="${a.name}" v${a.version ?? "?"} (id=${a.id})`);
    console.log(`    rogue templates (${a.rogueTemplates.length}):`);
    for (const t of a.rogueTemplates.slice(0, 8)) {
      console.log(`      • ${String(t.name ?? "").slice(0, 110)}`);
    }
    if (a.rogueTemplates.length > 8) console.log(`      … and ${a.rogueTemplates.length - 8} more`);
    console.log(`    kept templates (${a.keptTemplates.length}):`);
    for (const t of a.keptTemplates.slice(0, 4)) {
      console.log(
        `      ✓ type=${t.type} ref=${t.ref ?? "-"} | ${String(t.name ?? "").slice(0, 70)}`,
      );
    }
    if (a.keptTemplates.length > 4) console.log(`      … and ${a.keptTemplates.length - 4} more`);
  }

  // 2. Find materialised Goal rows matching the rogue pattern, scoped by playbook.
  const playbookIds = affected.map((a) => a.id);
  const rogueNamesByPlaybook = new Map<string, Set<string>>();
  for (const a of affected) {
    rogueNamesByPlaybook.set(a.id, new Set(a.rogueTemplates.map((t) => String(t.name ?? ""))));
  }

  const candidateGoals = await prisma.goal.findMany({
    where: {
      playbookId: { in: playbookIds },
      type: "LEARN",
      ref: null,
      sourceContentId: null,
    },
    select: { id: true, callerId: true, playbookId: true, name: true, status: true },
  });

  // Filter to only those whose name is in the rogue-template name set for their playbook.
  const rogueGoals = candidateGoals.filter((g) => {
    const names = rogueNamesByPlaybook.get(g.playbookId ?? "");
    return names ? names.has(g.name) : false;
  });

  console.log(`[cleanup] Matched ${rogueGoals.length} materialised Goal row(s) for deletion.`);
  if (rogueGoals.length > 0) {
    const byPlaybook = rogueGoals.reduce<Record<string, number>>((acc, g) => {
      acc[g.playbookId ?? ""] = (acc[g.playbookId ?? ""] ?? 0) + 1;
      return acc;
    }, {});
    for (const [pbId, count] of Object.entries(byPlaybook)) {
      const pb = affected.find((a) => a.id === pbId);
      console.log(`  - playbook="${pb?.name ?? pbId}": ${count} caller goal(s)`);
    }
  }

  if (!commit) {
    console.log("[cleanup] --commit not passed: no writes performed. Re-run with --commit to delete.");
    return;
  }

  // 3. Delete materialised rows first, then prune templates.
  let goalDeleteCount = 0;
  if (rogueGoals.length > 0) {
    const result = await prisma.goal.deleteMany({
      where: { id: { in: rogueGoals.map((g) => g.id) } },
    });
    goalDeleteCount = result.count;
  }

  let templateDeleteCount = 0;
  for (const a of affected) {
    await prisma.playbook.update({
      where: { id: a.id },
      data: { config: a.nextConfig as never },
    });
    templateDeleteCount += a.rogueTemplates.length;
  }

  console.log(
    `[cleanup] Done. Deleted ${goalDeleteCount} Goal row(s) and pruned ${templateDeleteCount} template(s) across ${affected.length} playbook(s).`,
  );
}

main()
  .catch((err) => {
    console.error("[cleanup] FAILED:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
