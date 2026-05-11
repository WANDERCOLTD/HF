/**
 * Playbook scope audit — finds playbooks at risk of domain-wide source bleed
 * and (with --backfill) explicitly locks them to their resolved scope by
 * inserting PlaybookSource rows.
 *
 * Per-playbook decision tree:
 *
 *   ✅  PlaybookSource ≥ 1                   → already scoped explicitly
 *   ⚠️  PlaybookSubject ≥ 1                  → scoped via legacy chain; safe but indirect
 *   🚨  Both empty + domain hosts ONE        → domain-wide bleed but contained (safe)
 *                                              → backfill: copy domain's subjects' sources to PlaybookSource
 *   🛑  Both empty + domain hosts MANY       → ACTIVE BLEED across courses
 *                                              → flag for operator decision; do NOT auto-fix
 *
 * Run modes:
 *   npx tsx scripts/audit-playbook-scope.ts            (read-only audit)
 *   npx tsx scripts/audit-playbook-scope.ts --backfill (apply safe fixes; never auto-fixes 🛑)
 */
import { prisma } from "@/lib/prisma";

interface DomainOccupancy {
  domainId: string;
  playbookIds: string[];
}

interface PlaybookRow {
  id: string;
  name: string;
  domainId: string | null;
  playbookSourceCount: number;
  playbookSubjectCount: number;
  domainSiblings: number; // other playbooks sharing this domain
  domainSourceCount: number;
}

const args = process.argv.slice(2);
const BACKFILL = args.includes("--backfill");

async function main() {
  const playbooks = await prisma.playbook.findMany({ select: { id: true, name: true, domainId: true } });

  // Map domain → playbook IDs (so we know which playbooks share a domain)
  const occupancyByDomain = new Map<string, DomainOccupancy>();
  for (const pb of playbooks) {
    if (!pb.domainId) continue;
    const o = occupancyByDomain.get(pb.domainId) ?? { domainId: pb.domainId, playbookIds: [] };
    o.playbookIds.push(pb.id);
    occupancyByDomain.set(pb.domainId, o);
  }

  // Per-playbook stats
  const rows: PlaybookRow[] = [];
  for (const pb of playbooks) {
    const [psCount, psjCount] = await Promise.all([
      prisma.playbookSource.count({ where: { playbookId: pb.id } }),
      prisma.playbookSubject.count({ where: { playbookId: pb.id } }),
    ]);
    let domainSourceCount = 0;
    let domainSiblings = 0;
    if (pb.domainId) {
      const occupancy = occupancyByDomain.get(pb.domainId);
      domainSiblings = (occupancy?.playbookIds.length ?? 1) - 1;
      const subjects = await prisma.subjectDomain.findMany({
        where: { domainId: pb.domainId },
        select: { subject: { select: { sources: { select: { sourceId: true } } } } },
      });
      domainSourceCount = new Set(subjects.flatMap((sd) => sd.subject.sources.map((s) => s.sourceId))).size;
    }
    rows.push({
      id: pb.id,
      name: pb.name,
      domainId: pb.domainId,
      playbookSourceCount: psCount,
      playbookSubjectCount: psjCount,
      domainSiblings,
      domainSourceCount,
    });
  }

  // Bucket
  const explicit = rows.filter((r) => r.playbookSourceCount > 0);
  const legacy = rows.filter((r) => r.playbookSourceCount === 0 && r.playbookSubjectCount > 0);
  const safeFallback = rows.filter(
    (r) => r.playbookSourceCount === 0 && r.playbookSubjectCount === 0 && r.domainSiblings === 0,
  );
  const activeBleed = rows.filter(
    (r) => r.playbookSourceCount === 0 && r.playbookSubjectCount === 0 && r.domainSiblings > 0,
  );
  const noDomain = rows.filter((r) => !r.domainId && r.playbookSourceCount === 0 && r.playbookSubjectCount === 0);

  console.log(`Playbook scope audit — ${rows.length} playbooks total\n`);
  console.log(`  ✅ Explicit (PlaybookSource):              ${explicit.length}`);
  console.log(`  ⚠️  Legacy (PlaybookSubject):              ${legacy.length}`);
  console.log(`  ✅ Safe fallback (domain has 1 playbook):  ${safeFallback.length}`);
  console.log(`  🛑 Active bleed (domain has siblings):     ${activeBleed.length}`);
  console.log(`  ✋ No domain (no scope at all):            ${noDomain.length}`);
  console.log("");

  if (activeBleed.length > 0) {
    console.log("🛑 ACTIVE BLEED — playbooks sharing a domain with other playbooks AND missing scope:");
    for (const r of activeBleed) {
      console.log(`  ${r.name}`);
      console.log(`    domain ${r.domainId} hosts ${r.domainSiblings + 1} playbooks, ${r.domainSourceCount} sources currently bleeding into prompts`);
    }
    console.log("");
  }

  if (safeFallback.length > 0) {
    console.log("Safe-fallback playbooks (domain-wide but isolated — backfill will lock scope):");
    for (const r of safeFallback) {
      console.log(`  ${r.name} (domain ${r.domainId}, ${r.domainSourceCount} sources)`);
    }
    console.log("");
  }

  // ── Backfill ────────────────────────────────────────────────────────
  if (!BACKFILL) {
    console.log("(Read-only mode. Pass --backfill to apply safe fixes.)");
    return;
  }

  if (safeFallback.length === 0) {
    console.log("Nothing to backfill safely. ");
    return;
  }

  console.log(`\n=== BACKFILL — populating PlaybookSource for ${safeFallback.length} safe-fallback playbook(s) ===`);
  console.log("(Active-bleed playbooks are NOT auto-fixed. Operator decision required.)\n");

  for (const r of safeFallback) {
    if (!r.domainId) continue;
    const subjects = await prisma.subjectDomain.findMany({
      where: { domainId: r.domainId },
      select: { subject: { select: { sources: { select: { sourceId: true, sortOrder: true, tags: true, trustLevelOverride: true } } } } },
    });
    const flat = subjects.flatMap((sd) => sd.subject.sources);
    const seen = new Set<string>();
    let attached = 0;
    for (const s of flat) {
      if (seen.has(s.sourceId)) continue;
      seen.add(s.sourceId);
      await prisma.playbookSource.upsert({
        where: { playbookId_sourceId: { playbookId: r.id, sourceId: s.sourceId } },
        create: {
          playbookId: r.id,
          sourceId: s.sourceId,
          sortOrder: s.sortOrder,
          tags: s.tags,
          trustLevelOverride: s.trustLevelOverride,
        },
        update: {},
      });
      attached++;
    }
    console.log(`  ${r.name}: attached ${attached} PlaybookSource row(s)`);
  }

  console.log("\nBackfill complete. Re-run without --backfill to verify all rows now resolve via the explicit path.");
}

main()
  .catch((e) => {
    console.error("ERR:", e?.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
