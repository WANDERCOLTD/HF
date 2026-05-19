/**
 * Backfill PlaybookSource rows from the legacy Subject chain (#481).
 *
 * Prerequisite for the #478 deprecation track — removing the Subject-chain
 * read fallbacks (#482, #485) is only safe once every active Playbook has
 * direct PlaybookSource rows. Without backfill, legacy courses created
 * before the PlaybookSource migration (2026-04-17) would silently empty
 * their prompts on the fallback removal.
 *
 * Decision rule per playbook:
 *   - PlaybookSource ≥ 1  → skip (already explicit)
 *   - PlaybookSubject = 0 → skip (no legacy chain to backfill from)
 *   - PlaybookSubject ≥ 1 → for each linked Subject, call
 *                            syncPlaybookSources(pb.id, subjId,
 *                              { includePreExisting: true })
 *
 * The `includePreExisting: true` flag bypasses the #478 boundary guard
 * for this one explicit administrative use — we DO want historical
 * SubjectSource rows to land in PlaybookSource for legacy playbooks
 * (they're the only record of what content the playbook should have).
 *
 * Run modes:
 *   npx tsx scripts/backfill-playbook-sources-from-subjects.ts             # dry-run
 *   npx tsx scripts/backfill-playbook-sources-from-subjects.ts --execute   # apply
 *
 * Idempotent: re-running on a clean playbook reports 0 writes.
 */

import { prisma } from "@/lib/prisma";
import { syncPlaybookSources } from "@/lib/knowledge/domain-sources";

interface Candidate {
  playbookId: string;
  playbookName: string;
  subjectIds: string[];
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const dryRun = !execute;

  console.log(
    `\n=== Backfill PlaybookSource from Subject chain (#481) ===\n` +
      `  mode: ${dryRun ? "DRY-RUN" : "EXECUTE"}\n`,
  );

  const playbooks = await prisma.playbook.findMany({
    select: {
      id: true,
      name: true,
      _count: { select: { playbookSources: true } },
      subjects: { select: { subjectId: true } },
    },
  });

  const candidates: Candidate[] = playbooks
    .filter((pb) => pb._count.playbookSources === 0 && pb.subjects.length > 0)
    .map((pb) => ({
      playbookId: pb.id,
      playbookName: pb.name,
      subjectIds: pb.subjects.map((s) => s.subjectId),
    }));

  const skippedExplicit = playbooks.filter((pb) => pb._count.playbookSources > 0).length;
  const skippedNoSubject = playbooks.filter(
    (pb) => pb._count.playbookSources === 0 && pb.subjects.length === 0,
  ).length;

  console.log(`  ${playbooks.length} total playbook(s)`);
  console.log(`    ${skippedExplicit} already have PlaybookSource — skip`);
  console.log(`    ${skippedNoSubject} have neither PlaybookSource nor PlaybookSubject — skip`);
  console.log(`    ${candidates.length} candidates (PlaybookSubject ≥ 1, PlaybookSource = 0)\n`);

  if (candidates.length === 0) {
    console.log("Nothing to backfill.\n");
    return;
  }

  let totalSynced = 0;
  for (const c of candidates) {
    console.log(`  ${c.playbookName} (${c.playbookId}) — ${c.subjectIds.length} subject(s)`);
    if (dryRun) {
      console.log(`    DRY-RUN: would call syncPlaybookSources for each subject`);
      continue;
    }
    for (const subjectId of c.subjectIds) {
      const synced = await syncPlaybookSources(c.playbookId, subjectId, { includePreExisting: true });
      console.log(`    subject ${subjectId} → synced ${synced} source(s)`);
      totalSynced += synced;
    }
  }

  console.log(
    `\nSummary: ${candidates.length} playbook(s) ${dryRun ? "would be" : "were"} backfilled, ${
      dryRun ? "(dry-run — no writes)" : `${totalSynced} PlaybookSource row(s) written`
    }.\n`,
  );
  if (dryRun) {
    console.log("Re-run with --execute to apply.\n");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
