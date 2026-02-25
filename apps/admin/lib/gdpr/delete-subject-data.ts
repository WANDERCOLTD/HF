/**
 * Shared subject data deletion utility.
 *
 * Handles ALL FK relationships for hard-deleting a Subject.
 * All direct FKs have proper CASCADE or SetNull in the schema,
 * but we delete explicitly for count tracking and audit.
 *
 * NOTE: ContentSources linked via SubjectSource are NOT deleted —
 * they may be shared across subjects. The caller should use
 * findOrphanedSources() to detect and optionally clean up.
 *
 * Used by:
 * - POST /api/admin/bulk-delete (bulk delete)
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export interface SubjectDeletionCounts {
  subjectSources: number;
  subjectDomains: number;
  playbookSubjects: number;
  subjectMedia: number;
  curriculaNullified: number;
}

/**
 * Find ContentSource IDs that are only linked to the given subject(s)
 * and no others. These become orphaned after subject deletion.
 */
export async function findOrphanedSources(
  subjectIds: string[]
): Promise<string[]> {
  // Get all source IDs linked to these subjects
  const linkedSources = await prisma.subjectSource.findMany({
    where: { subjectId: { in: subjectIds } },
    select: { sourceId: true },
  });
  const sourceIds = [...new Set(linkedSources.map((s) => s.sourceId))];

  if (sourceIds.length === 0) return [];

  // Find which of those sources are also linked to other subjects
  const sharedSources = await prisma.subjectSource.findMany({
    where: {
      sourceId: { in: sourceIds },
      subjectId: { notIn: subjectIds },
    },
    select: { sourceId: true },
  });
  const sharedSet = new Set(sharedSources.map((s) => s.sourceId));

  // Return sources NOT shared with other subjects
  return sourceIds.filter((id) => !sharedSet.has(id));
}

/**
 * Delete a subject and handle ALL FK relationships in a single transaction.
 *
 * - CASCADE-covered: SubjectSource, SubjectDomain, PlaybookSubject, SubjectMedia
 * - SetNull: Curriculum.subjectId
 *
 * ContentSources are NOT deleted (may be shared). Use findOrphanedSources()
 * to detect orphans before calling this.
 *
 * @param subjectId - The subject ID to delete
 * @param tx - Optional transaction client (for use within an outer transaction)
 */
export async function deleteSubjectData(
  subjectId: string,
  tx?: Prisma.TransactionClient
): Promise<SubjectDeletionCounts> {
  const counts: SubjectDeletionCounts = {
    subjectSources: 0,
    subjectDomains: 0,
    playbookSubjects: 0,
    subjectMedia: 0,
    curriculaNullified: 0,
  };

  const run = async (client: Prisma.TransactionClient) => {
    // 1. Nullify Curriculum.subjectId (SetNull — curriculum survives without subject)
    counts.curriculaNullified = (
      await client.curriculum.updateMany({
        where: { subjectId },
        data: { subjectId: null },
      })
    ).count;

    // 2. Delete junction tables (Prisma CASCADE handles these, but explicit for count)
    counts.subjectSources = (
      await client.subjectSource.deleteMany({ where: { subjectId } })
    ).count;
    counts.subjectDomains = (
      await client.subjectDomain.deleteMany({ where: { subjectId } })
    ).count;
    counts.playbookSubjects = (
      await client.playbookSubject.deleteMany({ where: { subjectId } })
    ).count;
    counts.subjectMedia = (
      await client.subjectMedia.deleteMany({ where: { subjectId } })
    ).count;

    // 3. Delete the subject itself
    await client.subject.delete({ where: { id: subjectId } });
  };

  if (tx) {
    await run(tx);
  } else {
    await prisma.$transaction(run, { timeout: 30000 });
  }

  return counts;
}
