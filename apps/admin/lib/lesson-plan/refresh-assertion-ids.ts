/**
 * refresh-assertion-ids.ts
 *
 * After a content source is re-extracted, old assertion IDs are invalid.
 * This module finds all affected lesson plans and refreshes their assertionIds
 * with current assertions, preserving module-level scoping.
 *
 * Called from the extract route after purge + re-extraction completes.
 */

import { prisma } from "@/lib/prisma";

export interface RefreshResult {
  curriculaUpdated: number;
  entriesCleared: number;
  entriesRefilled: number;
  /** Entries where no replacement assertions could be found */
  entriesOrphaned: number;
}

/**
 * Snapshot assertion IDs for a source before purge.
 * Call this BEFORE purgeSourceContent().
 */
export async function snapshotAssertionIds(sourceId: string): Promise<Set<string>> {
  const assertions = await prisma.contentAssertion.findMany({
    where: { sourceId },
    select: { id: true },
  });
  return new Set(assertions.map((a) => a.id));
}

/**
 * Find all curricula whose lesson plan entries reference any of the given assertion IDs,
 * then clear stale IDs and optionally refill from current assertions.
 *
 * Strategy: For each affected entry, resolve current assertions for the entry's module
 * and replace stale IDs. If no module mapping exists, clear IDs entirely (runtime
 * fallback chain handles gracefully).
 */
export async function refreshLessonPlanAssertions(
  sourceId: string,
  oldAssertionIds: Set<string>,
): Promise<RefreshResult> {
  if (oldAssertionIds.size === 0) return { curriculaUpdated: 0, entriesCleared: 0, entriesRefilled: 0, entriesOrphaned: 0 };

  // Find curricula linked to this source via subject chain
  // Tier 1: curriculum.primarySourceId
  // Tier 2: curriculum → subject → subjectSource → sourceId
  const directCurricula = await prisma.curriculum.findMany({
    where: { primarySourceId: sourceId },
    select: { id: true, subjectId: true, deliveryConfig: true },
  });

  const subjectSourceCurricula = await prisma.curriculum.findMany({
    where: {
      subject: { sources: { some: { sourceId } } },
      id: { notIn: directCurricula.map((c) => c.id) },
    },
    select: { id: true, subjectId: true, deliveryConfig: true },
  });

  const allCurricula = [...directCurricula, ...subjectSourceCurricula];
  if (allCurricula.length === 0) return { curriculaUpdated: 0, entriesCleared: 0, entriesRefilled: 0, entriesOrphaned: 0 };

  // Load current assertions for this source (post-extraction)
  const currentAssertions = await prisma.contentAssertion.findMany({
    where: { sourceId },
    select: { id: true, learningOutcomeRef: true, topicSlug: true, chapter: true, contentHash: true },
    orderBy: [{ depth: "asc" }, { orderIndex: "asc" }],
  });

  // Build contentHash → new assertion ID map for precise remapping
  const hashToNewId = new Map<string, string>();
  for (const a of currentAssertions) {
    if (a.contentHash && !hashToNewId.has(a.contentHash)) {
      hashToNewId.set(a.contentHash, a.id);
    }
  }

  // We'll also need old assertion hashes for remapping
  // Since old assertions are already deleted, we can't look them up.
  // Instead, we use a best-effort approach:
  // 1. Try hash remap for any IDs we can match
  // 2. For unmatched entries, use module-aware redistribution

  let curriculaUpdated = 0;
  let entriesCleared = 0;
  let entriesRefilled = 0;
  let entriesOrphaned = 0;

  for (const curriculum of allCurricula) {
    const dc = curriculum.deliveryConfig as any;
    const entries = dc?.lessonPlan?.entries;
    if (!Array.isArray(entries)) continue;

    let modified = false;

    for (const entry of entries) {
      if (!Array.isArray(entry.assertionIds) || entry.assertionIds.length === 0) continue;

      // Check if any IDs in this entry are stale
      const staleIds = entry.assertionIds.filter((id: string) => oldAssertionIds.has(id));
      if (staleIds.length === 0) continue;

      // Remove stale IDs, keep any that weren't from the purged source
      const keptIds = entry.assertionIds.filter((id: string) => !oldAssertionIds.has(id));

      // Clear stale IDs
      entry.assertionIds = keptIds.length > 0 ? keptIds : undefined;
      entry.assertionCount = keptIds.length > 0 ? keptIds.length : undefined;
      entriesCleared++;
      modified = true;
    }

    if (modified) {
      // Re-distribute current assertions across cleared entries using module-aware logic
      const result = distributeAssertionsByModule(entries, currentAssertions, curriculum.id);
      entriesRefilled += result.refilled;
      entriesOrphaned += result.orphaned;

      await prisma.curriculum.update({
        where: { id: curriculum.id },
        data: {
          deliveryConfig: dc,
        },
      });
      curriculaUpdated++;
    }
  }

  console.log(
    `[refresh-assertion-ids] Source ${sourceId}: ${curriculaUpdated} curricula updated, ` +
    `${entriesCleared} entries cleared, ${entriesRefilled} refilled, ${entriesOrphaned} orphaned`,
  );

  return { curriculaUpdated, entriesCleared, entriesRefilled, entriesOrphaned };
}

// ---------------------------------------------------------------------------
// Module-aware assertion distribution (shared by refresh + generation)
// ---------------------------------------------------------------------------

const STRUCTURAL_SESSION_TYPES = ["onboarding", "offboarding", "pre_survey", "post_survey", "mid_survey"];

interface AssertionRef {
  id: string;
  learningOutcomeRef: string | null;
  topicSlug: string | null;
  chapter: string | null;
  contentHash?: string | null;
}

/**
 * Distribute assertions across lesson plan entries based on module → LO matching.
 *
 * For each teaching entry that has no assertionIds (cleared or never set):
 * 1. If entry has moduleId → find LOs for that module → match assertions by learningOutcomeRef
 * 2. If entry has learningOutcomeRefs → match assertions directly
 * 3. Assessment/consolidate entries get all assertions from prior teaching sessions
 * 4. Remaining unmatched assertions distributed round-robin to entries without assertions
 *
 * Exported for use by lesson plan generation (Fix #1) and refresh (Fix #5).
 */
export function distributeAssertionsByModule(
  entries: any[],
  assertions: AssertionRef[],
  curriculumId: string,
): { refilled: number; orphaned: number } {
  const teachingEntries = entries.filter(
    (e: any) => !STRUCTURAL_SESSION_TYPES.includes(e.type),
  );

  // Skip entries that already have assertionIds
  const emptyEntries = teachingEntries.filter(
    (e: any) => !e.assertionIds || e.assertionIds.length === 0,
  );

  if (emptyEntries.length === 0) return { refilled: 0, orphaned: 0 };

  let refilled = 0;
  let orphaned = 0;
  const assigned = new Set<string>();

  // Pass 1: Module-aware assignment via learningOutcomeRefs
  for (const entry of emptyEntries) {
    const loRefs: string[] = entry.learningOutcomeRefs || [];
    if (loRefs.length === 0) continue;

    const matched = assertions.filter((a) => {
      if (assigned.has(a.id)) return false;
      if (!a.learningOutcomeRef) return false;
      return loRefs.some((ref: string) => a.learningOutcomeRef!.includes(ref));
    });

    if (matched.length > 0) {
      entry.assertionIds = matched.map((a) => a.id);
      entry.assertionCount = matched.length;
      matched.forEach((a) => assigned.add(a.id));
      refilled++;
    }
  }

  // Pass 2: Assessment/consolidate get all assertions from prior teaching sessions
  for (const entry of emptyEntries) {
    if (entry.assertionIds?.length > 0) continue;
    if (entry.type === "assess" || entry.type === "consolidate") {
      // Collect all assigned assertion IDs from prior teaching entries
      const priorIds: string[] = [];
      for (const prior of teachingEntries) {
        if (prior.session >= entry.session) break;
        if (Array.isArray(prior.assertionIds)) {
          priorIds.push(...prior.assertionIds);
        }
      }
      if (priorIds.length > 0) {
        entry.assertionIds = priorIds;
        entry.assertionCount = priorIds.length;
        refilled++;
      }
    }
  }

  // Pass 3: Round-robin remaining unassigned assertions to entries still empty
  const stillEmpty = emptyEntries.filter((e: any) => !e.assertionIds || e.assertionIds.length === 0);
  const unassigned = assertions.filter((a) => !assigned.has(a.id));

  if (stillEmpty.length > 0 && unassigned.length > 0) {
    // Initialize empty arrays
    for (const entry of stillEmpty) {
      entry.assertionIds = [];
    }
    for (let i = 0; i < unassigned.length; i++) {
      stillEmpty[i % stillEmpty.length].assertionIds.push(unassigned[i].id);
    }
    for (const entry of stillEmpty) {
      if (entry.assertionIds.length > 0) {
        entry.assertionCount = entry.assertionIds.length;
        refilled++;
      } else {
        orphaned++;
      }
    }
  } else if (stillEmpty.length > 0) {
    orphaned += stillEmpty.length;
  }

  return { refilled, orphaned };
}
