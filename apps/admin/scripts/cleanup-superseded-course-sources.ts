/**
 * Delete superseded ContentSource rows on a playbook.
 *
 * Every re-upload of the same filename via course-pack ingest creates a NEW
 * ContentSource (slug = `${domain}-${baseSlug}-${Date.now()}` — see
 * `app/api/course-pack/ingest/route.ts::~670`). The old row + its
 * PlaybookSource link stay attached, so an iterated course-ref builds up
 * stale source rows. The intelligence tab shows them all; the extraction
 * pipeline may still target them.
 *
 * This script groups a playbook's sources by their slug *without* the
 * trailing `-<timestamp>` (which collapses re-uploads of the same filename
 * into one group while keeping genuinely different files separate). Within
 * each group, the newest source by `createdAt` is kept; the older rows are
 * hard-deleted (Prisma onDelete: Cascade removes the PlaybookSource link
 * automatically). Sources with no detectable timestamp suffix and no
 * siblings are left untouched.
 *
 * Run on hf-dev VM (script needs DB access):
 *   npx tsx scripts/cleanup-superseded-course-sources.ts                              # dry-run, ALL playbooks
 *   npx tsx scripts/cleanup-superseded-course-sources.ts --execute                    # apply, ALL playbooks
 *   npx tsx scripts/cleanup-superseded-course-sources.ts --playbook-id <id>           # dry-run, one playbook
 *   npx tsx scripts/cleanup-superseded-course-sources.ts --playbook-id <id> --execute # apply, one playbook
 *
 * Idempotent: re-running on a clean playbook reports 0 deletes.
 */

import { prisma } from "@/lib/prisma";

const TIMESTAMP_SUFFIX = /-\d{10,}$/;

interface SourceRow {
  contentSourceId: string;
  slug: string;
  name: string;
  documentType: string;
  createdAt: Date;
  contentAssertionCount: number;
}

function groupKey(slug: string): string {
  return slug.replace(TIMESTAMP_SUFFIX, "");
}

async function processPlaybook(
  playbookId: string,
  playbookName: string,
  dryRun: boolean,
): Promise<{ kept: number; deleted: number }> {
  const links = await prisma.playbookSource.findMany({
    where: { playbookId },
    select: {
      source: {
        select: {
          id: true,
          slug: true,
          name: true,
          documentType: true,
          createdAt: true,
          _count: { select: { assertions: true } },
        },
      },
    },
  });

  if (links.length === 0) {
    return { kept: 0, deleted: 0 };
  }

  const rows: SourceRow[] = links.map((l) => ({
    contentSourceId: l.source.id,
    slug: l.source.slug,
    name: l.source.name,
    documentType: l.source.documentType,
    createdAt: l.source.createdAt,
    contentAssertionCount: l.source._count.assertions,
  }));

  const groups = new Map<string, SourceRow[]>();
  for (const row of rows) {
    const key = groupKey(row.slug);
    const arr = groups.get(key) ?? [];
    arr.push(row);
    groups.set(key, arr);
  }

  const toDelete: SourceRow[] = [];
  const toKeep: SourceRow[] = [];
  for (const [, group] of groups) {
    if (group.length === 1) {
      toKeep.push(group[0]);
      continue;
    }
    const sorted = [...group].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const [newest, ...older] = sorted;
    toKeep.push(newest);
    toDelete.push(...older);
  }

  if (toDelete.length === 0) {
    console.log(`  ${playbookName} (${playbookId}) — ${rows.length} source(s), nothing to dedup.`);
    return { kept: rows.length, deleted: 0 };
  }

  console.log(`\n  ${playbookName} (${playbookId})`);
  console.log(`    ${rows.length} source(s) → keep ${toKeep.length}, delete ${toDelete.length}`);
  for (const row of toDelete) {
    const keptSibling = toKeep.find((k) => groupKey(k.slug) === groupKey(row.slug));
    console.log(
      `      ✗ ${row.documentType.padEnd(28)} ${row.name}  [${row.contentAssertionCount} assertion(s), ${row.createdAt.toISOString()}]` +
        (keptSibling ? `  ← superseded by ${keptSibling.createdAt.toISOString()}` : ""),
    );
  }

  if (!dryRun) {
    const ids = toDelete.map((r) => r.contentSourceId);
    const result = await prisma.contentSource.deleteMany({ where: { id: { in: ids } } });
    console.log(`      deleted ${result.count} ContentSource row(s) (PlaybookSource links cascade)`);
  }

  return { kept: toKeep.length, deleted: toDelete.length };
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const idIdx = args.indexOf("--playbook-id");
  const playbookId = idIdx >= 0 ? args[idIdx + 1] : null;
  const dryRun = !execute;

  console.log(
    `\n=== Cleanup: superseded ContentSource rows ===\n` +
      `  mode:   ${dryRun ? "DRY-RUN" : "EXECUTE"}\n` +
      `  scope:  ${playbookId ? `playbookId = ${playbookId}` : "ALL playbooks"}\n`,
  );

  const playbooks = await prisma.playbook.findMany({
    where: playbookId ? { id: playbookId } : undefined,
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  if (playbooks.length === 0) {
    console.log("No matching playbooks found. Nothing to do.\n");
    return;
  }

  let totalKept = 0;
  let totalDeleted = 0;
  for (const p of playbooks) {
    const { kept, deleted } = await processPlaybook(p.id, p.name, dryRun);
    totalKept += kept;
    totalDeleted += deleted;
  }

  console.log(
    `\nSummary: ${playbooks.length} playbook(s) scanned, ${totalKept} source(s) kept, ${totalDeleted} source(s) ${dryRun ? "WOULD BE" : ""} deleted.\n`,
  );
  if (dryRun && totalDeleted > 0) {
    console.log("Re-run with --execute to apply.\n");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
