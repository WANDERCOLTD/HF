/**
 * Institution-Scoped Content Source Deduplication
 *
 * Checks whether a file (by SHA-256 contentHash) has already been uploaded
 * and extracted within the same institution scope.
 *
 * Scoping rules:
 * - Demo domains (institutionId = null): dedup across all demo content
 * - Production domains (real institutionId): dedup within that institution only
 */

import { prisma } from "@/lib/prisma";

export interface DedupResult {
  /** Existing source to reuse, or null if no match */
  existingSource: {
    id: string;
    slug: string;
    name: string;
    documentType: string | null;
    trustLevel: string;
  } | null;
  /** true = has assertions for this specific subject, safe to skip extraction */
  deduplicated: boolean;
  /** Number of assertions on the existing source scoped to this subject (0 = needs extraction) */
  assertionCount: number;
  /** The SubjectSource id that already has assertions (null if not deduplicated) */
  subjectSourceId: string | null;
}

/**
 * Resolve the institutionId for a subject by traversing:
 * Subject → SubjectDomain → Domain.institutionId
 *
 * Returns null for demo/system subjects (no domain link or domain has no institution).
 */
export async function resolveInstitutionId(subjectId: string): Promise<string | null> {
  const link = await prisma.subjectDomain.findFirst({
    where: { subjectId },
    select: { domain: { select: { institutionId: true } } },
  });
  return link?.domain?.institutionId ?? null;
}

/**
 * Find an existing ContentSource with the same file hash within the same
 * institution scope. Returns dedup info including whether extraction completed.
 */
export async function findDuplicateSource(
  contentHash: string,
  subjectId: string,
): Promise<DedupResult> {
  const institutionId = await resolveInstitutionId(subjectId);

  const match = await prisma.contentSource.findFirst({
    where: {
      contentHash,
      subjects: {
        some: {
          subject: {
            domains: {
              some: {
                domain: institutionId
                  ? { institutionId }
                  : { institutionId: null },
              },
            },
          },
        },
      },
    },
    select: {
      id: true,
      slug: true,
      name: true,
      documentType: true,
      trustLevel: true,
      subjects: {
        where: { subjectId },
        select: { id: true },
      },
      _count: { select: { assertions: true } },
    },
  });

  if (!match) {
    return { existingSource: null, deduplicated: false, assertionCount: 0, subjectSourceId: null };
  }

  // Check if this specific subject already has a SubjectSource link with extracted assertions
  const subjectSourceForThisSubject = match.subjects[0] ?? null;
  let scopedAssertionCount = 0;

  if (subjectSourceForThisSubject) {
    // Count assertions scoped to this specific SubjectSource
    scopedAssertionCount = await prisma.contentAssertion.count({
      where: {
        sourceId: match.id,
        subjectSourceId: subjectSourceForThisSubject.id,
      },
    });

    // If no subject-scoped assertions, check for legacy (null) assertions
    if (scopedAssertionCount === 0) {
      scopedAssertionCount = await prisma.contentAssertion.count({
        where: {
          sourceId: match.id,
          subjectSourceId: null,
        },
      });
    }
  }

  return {
    existingSource: {
      id: match.id,
      slug: match.slug,
      name: match.name,
      documentType: match.documentType,
      trustLevel: match.trustLevel,
    },
    deduplicated: scopedAssertionCount > 0,
    assertionCount: scopedAssertionCount,
    subjectSourceId: subjectSourceForThisSubject?.id ?? null,
  };
}
