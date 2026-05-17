/**
 * Smoke test for #409 — runs the new scoped resolver against live data for
 * the 3 callers whose CallerModuleProgress got corrupted by the old
 * unscoped `findFirst({where:{slug}})`. Prints what the new resolver would
 * write for each, so you can compare against the corrupt rows in the DB.
 *
 * Read-only — no writes. Run on the VM:
 *   cd apps/admin && npx tsx scripts/verify-409-resolution.ts
 */
import { prisma } from "@/lib/prisma";
import {
  resolveCurriculumIdForPlaybook,
  resolveModuleByLogicalId,
} from "@/lib/curriculum/resolve-module";

const CALLERS = [
  { id: "b9ad0217-9202-4f32-b358-6a79783170ef", name: "Opal Jensen" },
  { id: "2c512e96-1082-4194-a59b-3973996f632a", name: "Freya Valdez" },
  { id: "c06e332c-3e73-4bab-9ded-3c81b33f0c94", name: "Tessa Xiong" },
];

async function main() {
  for (const caller of CALLERS) {
    const enrollment = await prisma.callerPlaybook.findFirst({
      where: { callerId: caller.id, status: "ACTIVE" },
      select: { playbookId: true, playbook: { select: { name: true } } },
    });
    const corruptProgress = await prisma.callerModuleProgress.findFirst({
      where: { callerId: caller.id },
      select: {
        moduleId: true,
        module: {
          select: { slug: true, curriculumId: true, curriculum: { select: { playbookId: true } } },
        },
      },
    });

    console.log(`\n=== ${caller.name} (${caller.id}) ===`);
    console.log(
      `Enrolled playbook: ${enrollment?.playbookId ?? "<none>"} (${enrollment?.playbook?.name ?? ""})`,
    );
    console.log(
      `EXISTING CallerModuleProgress: moduleId=${corruptProgress?.moduleId ?? "<none>"} slug=${corruptProgress?.module.slug ?? ""} module-owner-playbook=${corruptProgress?.module.curriculum.playbookId ?? "<none>"}`,
    );

    if (!enrollment?.playbookId) {
      console.log("  → skipping; no active enrollment");
      continue;
    }

    const curriculumId = await resolveCurriculumIdForPlaybook(enrollment.playbookId);
    console.log(`  → resolveCurriculumIdForPlaybook = ${curriculumId ?? "<null>"}`);

    if (!curriculumId) continue;

    const resolved = await resolveModuleByLogicalId(curriculumId, "part1");
    console.log(
      `  → resolveModuleByLogicalId(curriculumId, "part1") = ${resolved?.id ?? "<null>"}`,
    );
    if (resolved) {
      const verdict =
        resolved.id === corruptProgress?.moduleId
          ? "MATCHES existing (no scope leak in this caller's data)"
          : "DIFFERS — existing row is corrupt; new writes would go to the correct module";
      console.log(`  VERDICT: ${verdict}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
