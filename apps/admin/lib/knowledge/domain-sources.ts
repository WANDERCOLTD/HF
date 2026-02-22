/**
 * Domain → Content Source Resolution
 *
 * Resolves a domain's linked content source IDs via the join path:
 * Domain → SubjectDomain → Subject → SubjectSource → ContentSource
 *
 * Used by VAPI knowledge endpoint, call sim, and prompt composition
 * to scope content retrieval to the caller's domain.
 */

import { prisma } from "@/lib/prisma";

/**
 * Get all ContentSource IDs linked to a domain via its subjects.
 * Returns deduplicated array. Returns empty array if no sources found.
 */
export async function getSourceIdsForDomain(domainId: string): Promise<string[]> {
  const subjectDomains = await prisma.subjectDomain.findMany({
    where: { domainId },
    select: {
      subject: {
        select: {
          sources: { select: { sourceId: true } },
        },
      },
    },
  });

  const sourceIds = subjectDomains.flatMap((sd) =>
    sd.subject.sources.map((s) => s.sourceId)
  );

  return [...new Set(sourceIds)];
}
