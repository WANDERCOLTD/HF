/**
 * Cleanup Duplicate Playbooks
 *
 * Finds Playbook records with identical names within the same domain,
 * keeps the oldest (or the one with most enrollments), and reassigns
 * all CohortPlaybook + CallerPlaybook references from duplicates to the keeper.
 *
 * Usage:
 *   npx tsx scripts/cleanup-duplicate-playbooks.ts --dry-run  # Preview changes
 *   npx tsx scripts/cleanup-duplicate-playbooks.ts             # Execute cleanup
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const isDryRun = process.argv.includes("--dry-run");

async function main() {
  console.log(`\nScanning for duplicate playbooks... ${isDryRun ? "(DRY RUN)" : "(LIVE)"}\n`);

  // Find all playbooks grouped by domain + name
  const allPlaybooks = await prisma.playbook.findMany({
    select: {
      id: true,
      name: true,
      domainId: true,
      status: true,
      createdAt: true,
      _count: {
        select: {
          enrollments: true,
          cohortAssignments: true,
          composedPrompts: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // Group by domain + name
  const groups = new Map<string, typeof allPlaybooks>();
  for (const pb of allPlaybooks) {
    const key = `${pb.domainId}::${pb.name}`;
    const group = groups.get(key) ?? [];
    group.push(pb);
    groups.set(key, group);
  }

  // Filter to only groups with duplicates
  const duplicateGroups = [...groups.entries()].filter(([, pbs]) => pbs.length > 1);

  if (duplicateGroups.length === 0) {
    console.log("No duplicate playbooks found.\n");
    return;
  }

  console.log(`Found ${duplicateGroups.length} group(s) with duplicates:\n`);

  let totalRemoved = 0;
  let totalReassigned = 0;

  for (const [key, playbooks] of duplicateGroups) {
    // Pick keeper: prefer PUBLISHED, then most enrollments, then oldest
    const sorted = [...playbooks].sort((a, b) => {
      if (a.status === "PUBLISHED" && b.status !== "PUBLISHED") return -1;
      if (b.status === "PUBLISHED" && a.status !== "PUBLISHED") return 1;
      if (a._count.enrollments !== b._count.enrollments)
        return b._count.enrollments - a._count.enrollments;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    const keeper = sorted[0];
    const duplicates = sorted.slice(1);
    const dupIds = duplicates.map((d) => d.id);

    console.log(`  "${keeper.name}" in domain ${key.split("::")[0].slice(0, 8)}...`);
    console.log(`     Keeper: ${keeper.id.slice(0, 8)}... (${keeper.status}, ${keeper._count.enrollments} enrollments, ${keeper._count.cohortAssignments} cohort links)`);
    console.log(`     Duplicates: ${duplicates.length}`);
    for (const dup of duplicates) {
      console.log(`       - ${dup.id.slice(0, 8)}... (${dup.status}, ${dup._count.enrollments} enrollments, ${dup._count.cohortAssignments} cohort links, ${dup._count.composedPrompts} prompts)`);
    }

    if (!isDryRun) {
      await prisma.$transaction(async (tx) => {
        // 1. Reassign CohortPlaybook: point duplicates to keeper (skip if already exists)
        for (const dupId of dupIds) {
          const cohortLinks = await tx.cohortPlaybook.findMany({
            where: { playbookId: dupId },
            select: { id: true, cohortGroupId: true },
          });
          for (const link of cohortLinks) {
            const existing = await tx.cohortPlaybook.findUnique({
              where: { cohortGroupId_playbookId: { cohortGroupId: link.cohortGroupId, playbookId: keeper.id } },
            });
            if (!existing) {
              await tx.cohortPlaybook.update({
                where: { id: link.id },
                data: { playbookId: keeper.id },
              });
              totalReassigned++;
            } else {
              await tx.cohortPlaybook.delete({ where: { id: link.id } });
            }
          }
        }

        // 2. Reassign CallerPlaybook: point duplicates to keeper (skip if already exists)
        for (const dupId of dupIds) {
          const callerLinks = await tx.callerPlaybook.findMany({
            where: { playbookId: dupId },
            select: { id: true, callerId: true },
          });
          for (const link of callerLinks) {
            const existing = await tx.callerPlaybook.findUnique({
              where: { callerId_playbookId: { callerId: link.callerId, playbookId: keeper.id } },
            });
            if (!existing) {
              await tx.callerPlaybook.update({
                where: { id: link.id },
                data: { playbookId: keeper.id },
              });
              totalReassigned++;
            } else {
              await tx.callerPlaybook.delete({ where: { id: link.id } });
            }
          }
        }

        // 3. Reassign ComposedPrompts to keeper
        await tx.composedPrompt.updateMany({
          where: { playbookId: { in: dupIds } },
          data: { playbookId: keeper.id },
        });

        // 4. Reassign PlaybookSubject links (deduplicate by subjectId)
        for (const dupId of dupIds) {
          const subjectLinks = await tx.playbookSubject.findMany({
            where: { playbookId: dupId },
          });
          for (const link of subjectLinks) {
            const existing = await tx.playbookSubject.findFirst({
              where: { playbookId: keeper.id, subjectId: link.subjectId },
            });
            if (!existing) {
              await tx.playbookSubject.update({
                where: { id: link.id },
                data: { playbookId: keeper.id },
              });
            } else {
              await tx.playbookSubject.delete({ where: { id: link.id } });
            }
          }
        }

        // 5. Reassign PlaybookItems (specs/templates linked to playbook)
        await tx.playbookItem.updateMany({
          where: { playbookId: { in: dupIds } },
          data: { playbookId: keeper.id },
        });

        // 6. Reassign Goals linked to duplicate playbooks
        await tx.goal.updateMany({
          where: { playbookId: { in: dupIds } },
          data: { playbookId: keeper.id },
        });

        // 7. Reassign Calls to keeper
        await tx.call.updateMany({
          where: { playbookId: { in: dupIds } },
          data: { playbookId: keeper.id },
        });

        // 8. Reassign Invites to keeper
        await tx.invite.updateMany({
          where: { playbookId: { in: dupIds } },
          data: { playbookId: keeper.id },
        });

        // 9. Delete the duplicate playbooks
        await tx.playbook.deleteMany({
          where: { id: { in: dupIds } },
        });
      });

      totalRemoved += duplicates.length;
      console.log(`     Merged ${duplicates.length} duplicates into keeper\n`);
    } else {
      totalRemoved += duplicates.length;
      console.log(`     Would merge ${duplicates.length} duplicates into keeper\n`);
    }
  }

  console.log(`\n${isDryRun ? "Would remove" : "Removed"}: ${totalRemoved} duplicate playbooks`);
  if (!isDryRun) console.log(`Reassigned: ${totalReassigned} enrollment/cohort links`);
  console.log();
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
