/**
 * Backfill teachMethod for existing ContentAssertions.
 *
 * For each assertion with null teachMethod, resolves the playbook's teachingMode
 * via: ContentAssertion.sourceId → SubjectSource → PlaybookSubject → Playbook.config
 * then calls categoryToTeachMethod(category, teachingMode) to assign.
 *
 * Run on VM:
 *   npx tsx scripts/backfill-teach-method.ts
 *
 * Options:
 *   --dry-run                    Count without updating
 *   --default-mode=<mode>        Fallback for orphan sources (default: recall)
 *                                Valid: recall, comprehension, practice, syllabus
 */

import { prisma } from "@/lib/prisma";
import {
  categoryToTeachMethod,
  type TeachingMode,
} from "@/lib/content-trust/resolve-config";

const VALID_MODES: TeachingMode[] = [
  "recall",
  "comprehension",
  "practice",
  "syllabus",
];

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const modeArg = args
    .find((a) => a.startsWith("--default-mode="))
    ?.split("=")[1];
  const defaultMode: TeachingMode =
    modeArg && VALID_MODES.includes(modeArg as TeachingMode)
      ? (modeArg as TeachingMode)
      : "recall";

  console.log(
    `\n=== Backfill teachMethod ===\n  dry-run: ${dryRun}\n  default-mode: ${defaultMode}\n`,
  );

  // ── Count ──────────────────────────────────────────
  const total = await prisma.contentAssertion.count();
  const nullCount = await prisma.contentAssertion.count({
    where: { teachMethod: null },
  });
  const alreadySet = total - nullCount;

  console.log(
    `Total assertions: ${total}\nAlready set: ${alreadySet}\nNeed backfill: ${nullCount}\n`,
  );

  if (nullCount === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  // ── Build source → teachingMode map ────────────────
  // Get all unique sourceIds that have null teachMethod assertions
  const sources = await prisma.contentAssertion.groupBy({
    by: ["sourceId"],
    where: { teachMethod: null },
    _count: { id: true },
  });

  console.log(`Sources with null teachMethod: ${sources.length}`);

  // For each source, find the playbook's teachingMode
  const sourceTeachingModeMap = new Map<string, TeachingMode>();

  for (const src of sources) {
    // Trace: source → SubjectSource → PlaybookSubject → Playbook.config
    const subjectSource = await prisma.subjectSource.findFirst({
      where: { sourceId: src.sourceId },
      select: { subjectId: true },
    });

    if (!subjectSource) {
      sourceTeachingModeMap.set(src.sourceId, defaultMode);
      continue;
    }

    const playbookSubject = await prisma.playbookSubject.findFirst({
      where: { subjectId: subjectSource.subjectId },
      select: {
        playbook: { select: { config: true } },
      },
    });

    if (!playbookSubject) {
      // Try domain fallback: subject → domain → playbook
      const domainLink = await prisma.subjectDomain.findFirst({
        where: { subjectId: subjectSource.subjectId },
        select: { domainId: true },
      });
      if (domainLink) {
        const playbook = await prisma.playbook.findFirst({
          where: { domainId: domainLink.domainId, status: "PUBLISHED" },
          select: { config: true },
        });
        const pbConfig = (playbook?.config as Record<string, any>) || {};
        const mode = pbConfig.teachingMode as TeachingMode | undefined;
        sourceTeachingModeMap.set(
          src.sourceId,
          mode && VALID_MODES.includes(mode) ? mode : defaultMode,
        );
      } else {
        sourceTeachingModeMap.set(src.sourceId, defaultMode);
      }
      continue;
    }

    const pbConfig =
      (playbookSubject.playbook?.config as Record<string, any>) || {};
    const mode = pbConfig.teachingMode as TeachingMode | undefined;
    sourceTeachingModeMap.set(
      src.sourceId,
      mode && VALID_MODES.includes(mode) ? mode : defaultMode,
    );
  }

  // Log source → mode mapping
  for (const [sourceId, mode] of sourceTeachingModeMap) {
    const count =
      sources.find((s) => s.sourceId === sourceId)?._count.id || 0;
    console.log(`  source ${sourceId.slice(0, 8)}… → ${mode} (${count} assertions)`);
  }

  if (dryRun) {
    console.log("\n(dry run — no updates made)");
    return;
  }

  // ── Update assertions ──────────────────────────────
  console.log("\nUpdating...");
  let updated = 0;

  for (const [sourceId, mode] of sourceTeachingModeMap) {
    // Get all null-teachMethod assertions for this source
    const assertions = await prisma.contentAssertion.findMany({
      where: { sourceId, teachMethod: null },
      select: { id: true, category: true },
    });

    // Group by resulting teachMethod for batch updates
    const methodGroups = new Map<string, string[]>();
    for (const a of assertions) {
      const method = categoryToTeachMethod(a.category, mode);
      const ids = methodGroups.get(method) || [];
      ids.push(a.id);
      methodGroups.set(method, ids);
    }

    for (const [method, ids] of methodGroups) {
      await prisma.contentAssertion.updateMany({
        where: { id: { in: ids } },
        data: { teachMethod: method },
      });
      updated += ids.length;
    }

    console.log(
      `  source ${sourceId.slice(0, 8)}… — ${assertions.length} assertions updated`,
    );
  }

  console.log(`\nDone. Updated ${updated} assertions.`);
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
