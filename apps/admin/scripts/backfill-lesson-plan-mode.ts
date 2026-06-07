/**
 * Backfill — #1253 — persist `Playbook.config.lessonPlanMode = "structured"`
 * for every published Playbook that LOOKS structured but doesn't have the
 * field set explicitly.
 *
 * Why this exists: #1252 promotes `lessonPlanMode` from an authoring hint
 * (read by the V5 wizard system prompt) to a load-bearing runtime field
 * (read by the pipeline `getCourseStyle` helper). The new helper is
 * default-deny — absence resolves to `"continuous"`. Without this backfill,
 * every existing playbook that should be STRUCTURED would silently degrade
 * to topic-pool conversations on the deploy that wires the helper.
 *
 * Rule (conservative — only writes STRUCTURED, never CONTINUOUS):
 *   - If `config.lessonPlanMode` is already set → no-op.
 *   - Else if the playbook has a primary Curriculum AND
 *     `config.modulesAuthored === true` → write `"structured"`.
 *   - Else → leave unset. Runtime resolves to CONTINUOUS by default-deny.
 *     Operator can re-publish to override.
 *
 * We never write `"continuous"` here — the absence of the field already
 * means continuous, and writing it would defeat the operator's ability
 * to override by editing config directly without bumping the playbook.
 *
 * Idempotent — re-runs find the field already set and report "no-op".
 *
 * Usage:
 *   npx tsx scripts/backfill-lesson-plan-mode.ts          # dry-run (default)
 *   npx tsx scripts/backfill-lesson-plan-mode.ts --apply  # write
 *
 * Exit codes: 0 success / no-op, 1 unexpected error.
 */

import { prisma } from "../lib/prisma";
import { updatePlaybookConfig } from "../lib/playbook/update-playbook-config";
import type { PlaybookConfig } from "../lib/types/json-fields";

const APPLY = process.argv.includes("--apply");

interface RowResult {
  playbookId: string;
  name: string;
  before: "structured" | "continuous" | "unset";
  resolved: "structured" | "leave-unset";
  reason: string;
}

async function main() {
  const playbooks = await prisma.playbook.findMany({
    where: { status: "PUBLISHED" },
    select: {
      id: true,
      name: true,
      config: true,
      // #1177 — Curriculum is reached via PlaybookCurriculum (role:'primary').
      playbookCurricula: {
        where: { role: "primary" },
        select: { curriculumId: true },
        take: 1,
      },
    },
  });

  const results: RowResult[] = [];

  for (const pb of playbooks) {
    const config = (pb.config ?? {}) as PlaybookConfig;
    const before = config.lessonPlanMode ?? "unset";

    if (config.lessonPlanMode !== undefined) {
      results.push({
        playbookId: pb.id,
        name: pb.name,
        before,
        resolved: config.lessonPlanMode === "structured" ? "structured" : "leave-unset",
        reason: "already set — no-op",
      });
      continue;
    }

    const primaryCurriculumId = pb.playbookCurricula[0]?.curriculumId ?? null;
    if (primaryCurriculumId && config.modulesAuthored === true) {
      results.push({
        playbookId: pb.id,
        name: pb.name,
        before,
        resolved: "structured",
        reason: "curriculumId + modulesAuthored=true",
      });
      if (APPLY) {
        await updatePlaybookConfig(
          pb.id,
          (current) => ({
            ...(current as PlaybookConfig),
            lessonPlanMode: "structured",
          }),
          { reason: "backfill-lesson-plan-mode #1253" },
        );
      }
    } else {
      results.push({
        playbookId: pb.id,
        name: pb.name,
        before,
        resolved: "leave-unset",
        reason: "no curriculumId or modulesAuthored != true — runtime → continuous by default",
      });
    }
  }

  const counts = {
    alreadySet: results.filter((r) => r.reason === "already set — no-op").length,
    structuredWrites: results.filter(
      (r) => r.resolved === "structured" && r.reason !== "already set — no-op",
    ).length,
    leftUnset: results.filter((r) => r.resolved === "leave-unset" && r.reason !== "already set — no-op").length,
  };

  console.log(`[backfill-lesson-plan-mode] ${APPLY ? "APPLIED" : "DRY RUN"}`);
  console.log(`  total published playbooks: ${results.length}`);
  console.log(`  already set (no-op):       ${counts.alreadySet}`);
  console.log(`  → structured:              ${counts.structuredWrites}`);
  console.log(`  ↻ left unset:              ${counts.leftUnset} (runtime → continuous by default)`);
  console.log();

  for (const r of results) {
    if (r.reason === "already set — no-op") continue;
    console.log(`  ${r.playbookId}  ${r.name}`);
    console.log(`    → ${r.resolved}   (${r.reason})`);
  }

  if (!APPLY && counts.structuredWrites > 0) {
    console.log();
    console.log(`Re-run with --apply to write ${counts.structuredWrites} row(s).`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
