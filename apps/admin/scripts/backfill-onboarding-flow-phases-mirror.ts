/**
 * Backfill the legacy `Playbook.config.onboardingFlowPhases` field from the
 * canonical `Playbook.config.sessionFlow.onboarding` shape so that during the
 * SESSION_FLOW_RESOLVER_ENABLED dual-read window both reader paths produce
 * byte-equal output.
 *
 * Why this script exists:
 *   The session-flow PUT route (`/api/courses/[courseId]/session-flow`)
 *   wrote `sessionFlow.onboarding` without mirroring to the legacy field
 *   prior to the fix in this branch. Educator edits via that route since
 *   Phase 4 (#219) have created silent drift between the two shapes.
 *   `scripts/session-flow-drift.ts` flagged Persuasion Literacy on hf_sandbox.
 *
 * What it does:
 *   For every Playbook where `sessionFlow.onboarding` is set, force
 *   `onboardingFlowPhases` to match. Resolver semantics: the new shape is
 *   canonical, so the new shape wins.
 *
 * What it does NOT do:
 *   - Touch playbooks that only have the legacy field set (no drift possible)
 *   - Touch `welcome`, `surveys`, `assessment`, or `nps` legacy mirrors
 *     (those have their own backfill stories in Phase 5 / #220)
 *   - Run when sessionFlow.onboarding.phases is missing/empty (defensive)
 *
 * Idempotent. Re-run safely. Logs per-row before/after.
 *
 * Usage:
 *   npx tsx scripts/backfill-onboarding-flow-phases-mirror.ts [--dry-run]
 *
 * Removed in Phase 5 (#220) once legacy field is dropped.
 */
import { prisma } from "@/lib/prisma";
import type { PlaybookConfig } from "@/lib/types/json-fields";

const DRY = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  const playbooks = await prisma.playbook.findMany({
    select: { id: true, name: true, config: true },
  });

  let scanned = 0;
  let updated = 0;
  let skippedNoNewShape = 0;
  let skippedAlreadyInSync = 0;
  let skippedEmptyPhases = 0;

  for (const pb of playbooks) {
    scanned += 1;
    const cfg = (pb.config ?? {}) as PlaybookConfig;
    const newOnboarding = cfg.sessionFlow?.onboarding;
    if (!newOnboarding) {
      skippedNoNewShape += 1;
      continue;
    }
    const newPhases = newOnboarding.phases ?? [];
    if (newPhases.length === 0) {
      skippedEmptyPhases += 1;
      continue;
    }

    const legacy = cfg.onboardingFlowPhases as { phases?: unknown } | undefined | null;
    const legacyPhases = Array.isArray(legacy)
      ? legacy
      : Array.isArray(legacy?.phases)
        ? legacy?.phases
        : null;

    const newJson = JSON.stringify(newPhases);
    const legacyJson = legacyPhases ? JSON.stringify(legacyPhases) : null;
    if (newJson === legacyJson) {
      skippedAlreadyInSync += 1;
      continue;
    }

    console.log(`[backfill] ${pb.id}  ${pb.name}`);
    console.log(`           legacy phases (before): ${legacyJson ?? "(unset)"}`);
    console.log(`           sessionFlow phases:     ${newJson}`);
    if (DRY) {
      console.log(`           DRY-RUN — would overwrite legacy with sessionFlow shape`);
      continue;
    }

    const merged: PlaybookConfig = {
      ...cfg,
      onboardingFlowPhases: { phases: newPhases },
    };
    await prisma.playbook.update({
      where: { id: pb.id },
      data: { config: merged as object },
    });
    updated += 1;
    console.log(`           ✓ legacy mirrored`);
  }

  console.log("");
  console.log("=== Backfill summary ===");
  console.log(`scanned:                 ${scanned}`);
  console.log(`updated:                 ${updated}${DRY ? "  (DRY-RUN — no writes)" : ""}`);
  console.log(`skipped (no new shape):  ${skippedNoNewShape}`);
  console.log(`skipped (empty phases):  ${skippedEmptyPhases}`);
  console.log(`skipped (already sync):  ${skippedAlreadyInSync}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
