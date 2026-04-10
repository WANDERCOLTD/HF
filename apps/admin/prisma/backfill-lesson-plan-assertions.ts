/**
 * backfill-lesson-plan-assertions.ts
 *
 * One-time fix: For all existing curricula with lesson plans, refresh
 * assertionIds and learningOutcomeRefs to fix:
 *   1. Stale/invalid assertionIds (from re-extractions)
 *   2. Empty learningOutcomeRefs (never populated)
 *   3. Assessment/consolidate sessions missing LO context
 *   4. Cross-doc duplicate assertions in session assignments
 *
 * Run: npx tsx prisma/backfill-lesson-plan-assertions.ts
 *
 * Safe to re-run — idempotent. Does not destroy educator-curated IDs
 * that are still valid.
 */

import { PrismaClient } from "@prisma/client";
import { loRefsMatch } from "../lib/lesson-plan/lo-ref-match";
import { STRUCTURAL_SESSION_TYPES } from "../lib/lesson-plan/session-ui";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log("=== Backfill Lesson Plan Assertions ===\n");

  // Load all curricula that have a lesson plan
  const curricula = await prisma.curriculum.findMany({
    where: {
      deliveryConfig: { not: { equals: {} as any } },
    },
    select: {
      id: true,
      subjectId: true,
      deliveryConfig: true,
      modules: {
        where: { isActive: true },
        select: {
          slug: true,
          learningObjectives: {
            select: { ref: true },
            orderBy: { sortOrder: "asc" },
          },
        },
      },
    },
  });

  let totalUpdated = 0;
  let totalEntriesFixed = 0;
  let totalStaleRemoved = 0;
  let totalLOsPopulated = 0;

  for (const curriculum of curricula) {
    const dc = curriculum.deliveryConfig as any;
    const entries = dc?.lessonPlan?.entries;
    if (!Array.isArray(entries) || entries.length === 0) continue;

    // Build moduleSlug → LO refs map
    const moduleToLORefs: Record<string, string[]> = {};
    for (const m of curriculum.modules) {
      if (m.learningObjectives.length > 0) {
        moduleToLORefs[m.slug] = m.learningObjectives.map((lo) => lo.ref);
      }
    }

    // Resolve all source IDs for this curriculum
    const sourceIds = await resolveSourceIds(curriculum.id, curriculum.subjectId);
    const validAssertionIds = new Set<string>();
    const assertionsByLO = new Map<string, string[]>();

    if (sourceIds.length > 0) {
      const assertions = await prisma.contentAssertion.findMany({
        where: { sourceId: { in: sourceIds } },
        select: { id: true, learningOutcomeRef: true, contentHash: true },
        orderBy: [{ depth: "asc" }, { orderIndex: "asc" }],
      });

      // Dedup by contentHash
      const seen = new Set<string>();
      for (const a of assertions) {
        if (a.contentHash && seen.has(a.contentHash)) continue;
        if (a.contentHash) seen.add(a.contentHash);
        validAssertionIds.add(a.id);
        if (a.learningOutcomeRef) {
          if (!assertionsByLO.has(a.learningOutcomeRef)) {
            assertionsByLO.set(a.learningOutcomeRef, []);
          }
          assertionsByLO.get(a.learningOutcomeRef)!.push(a.id);
        }
      }
    }

    let modified = false;
    let entriesFixed = 0;
    let staleRemoved = 0;
    let losPopulated = 0;

    for (const entry of entries) {
      if ((STRUCTURAL_SESSION_TYPES as readonly string[]).includes(entry.type)) continue;

      // Fix #2: Populate learningOutcomeRefs from module
      if (entry.moduleId && moduleToLORefs[entry.moduleId]) {
        if (!entry.learningOutcomeRefs || entry.learningOutcomeRefs.length === 0) {
          entry.learningOutcomeRefs = moduleToLORefs[entry.moduleId];
          losPopulated++;
          modified = true;
        }
      }

      // Fix #3: Assessment/consolidate inherit LO refs from prior teaching sessions
      if ((entry.type === "assess" || entry.type === "consolidate") &&
          (!entry.learningOutcomeRefs || entry.learningOutcomeRefs.length === 0)) {
        const priorLORefs = new Set<string>();
        for (const prior of entries) {
          if (prior.session >= entry.session) break;
          if (Array.isArray(prior.learningOutcomeRefs)) {
            prior.learningOutcomeRefs.forEach((ref: string) => priorLORefs.add(ref));
          }
        }
        if (priorLORefs.size > 0) {
          entry.learningOutcomeRefs = [...priorLORefs];
          losPopulated++;
          modified = true;
        }
      }

      // Fix stale assertionIds
      if (Array.isArray(entry.assertionIds) && entry.assertionIds.length > 0) {
        const before = entry.assertionIds.length;
        entry.assertionIds = entry.assertionIds.filter((id: string) => validAssertionIds.has(id));
        const removed = before - entry.assertionIds.length;
        if (removed > 0) {
          staleRemoved += removed;
          entry.assertionCount = entry.assertionIds.length;
          modified = true;
        }
        if (entry.assertionIds.length === 0) {
          entry.assertionIds = undefined;
          entry.assertionCount = undefined;
        }
      }

      // Re-distribute if entry has LO refs but no assertionIds
      if ((!entry.assertionIds || entry.assertionIds.length === 0) &&
          Array.isArray(entry.learningOutcomeRefs) && entry.learningOutcomeRefs.length > 0) {
        const matched: string[] = [];
        for (const [loRef, ids] of assertionsByLO) {
          if (entry.learningOutcomeRefs.some((ref: string) => loRefsMatch(loRef, ref))) {
            matched.push(...ids);
          }
        }
        if (matched.length > 0) {
          entry.assertionIds = [...new Set(matched)];
          entry.assertionCount = entry.assertionIds.length;
          entriesFixed++;
          modified = true;
        }
      }
    }

    if (modified) {
      await prisma.curriculum.update({
        where: { id: curriculum.id },
        data: { deliveryConfig: dc },
      });
      totalUpdated++;
      totalEntriesFixed += entriesFixed;
      totalStaleRemoved += staleRemoved;
      totalLOsPopulated += losPopulated;
      console.log(
        `  ✓ ${curriculum.id}: ${staleRemoved} stale IDs removed, ${losPopulated} LO refs populated, ${entriesFixed} entries re-distributed`,
      );
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`  Curricula updated: ${totalUpdated} / ${curricula.length}`);
  console.log(`  Entries fixed: ${totalEntriesFixed}`);
  console.log(`  Stale IDs removed: ${totalStaleRemoved}`);
  console.log(`  LO refs populated: ${totalLOsPopulated}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveSourceIds(curriculumId: string, subjectId: string | null): Promise<string[]> {
  // Tier 1: PlaybookSubject → Subject → SubjectSource
  const playbookSubject = await prisma.playbookSubject.findFirst({
    where: { subject: { curricula: { some: { id: curriculumId } } } },
    select: {
      subject: {
        select: {
          sources: { select: { sourceId: true } },
        },
      },
    },
  });
  if (playbookSubject?.subject?.sources?.length) {
    return [...new Set(playbookSubject.subject.sources.map((s) => s.sourceId))];
  }

  // Tier 2: Direct SubjectSource
  if (subjectId) {
    const sources = await prisma.subjectSource.findMany({
      where: { subjectId },
      select: { sourceId: true },
    });
    return sources.map((s) => s.sourceId);
  }

  return [];
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
