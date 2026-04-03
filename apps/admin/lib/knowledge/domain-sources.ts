/**
 * Domain / Playbook → Content Source Resolution
 *
 * Resolves content source IDs via two join paths:
 *
 * Domain-wide:  Domain → SubjectDomain → Subject → SubjectSource → ContentSource
 * Course-scoped: Playbook → PlaybookSubject → Subject → SubjectSource → ContentSource
 *
 * Used by VAPI knowledge endpoint, call sim, prompt composition, and
 * content-breakdown API to scope content retrieval.
 *
 * Playbook-scoped functions fall back to domain-wide when no
 * PlaybookSubject records exist (backward compat for older courses).
 */

import { prisma } from "@/lib/prisma";
import { isStudentVisibleDefault } from "@/lib/doc-type-icons";

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

/**
 * Get all ContentSource IDs linked to a playbook (course) via PlaybookSubject.
 * Falls back to domain-wide sources if no PlaybookSubject records exist.
 * Returns deduplicated array. Returns empty array if no sources found.
 */
export async function getSourceIdsForPlaybook(playbookId: string): Promise<string[]> {
  // 1. Try course-scoped: Playbook → PlaybookSubject → Subject → SubjectSource
  const playbookSubjects = await prisma.playbookSubject.findMany({
    where: { playbookId },
    select: {
      subject: {
        select: {
          sources: { select: { sourceId: true } },
        },
      },
    },
  });

  if (playbookSubjects.length > 0) {
    const sourceIds = playbookSubjects.flatMap((ps) =>
      ps.subject.sources.map((s) => s.sourceId)
    );
    return [...new Set(sourceIds)];
  }

  // 2. Fallback: domain-wide (backward compat for pre-scoping courses)
  const playbook = await prisma.playbook.findUnique({
    where: { id: playbookId },
    select: { domainId: true },
  });
  if (!playbook?.domainId) return [];

  return getSourceIdsForDomain(playbook.domainId);
}

/**
 * Resolve subject scope for a playbook: course-scoped with domain fallback.
 * Returns subject data with sources, teachingDepth, and whether scoping was applied.
 */
export async function getSubjectsForPlaybook(playbookId: string, domainId: string): Promise<{
  subjects: Array<{
    id: string;
    teachingDepth: number | null;
    sources: Array<{
      subjectSourceId: string;
      sourceId: string;
      documentType: string | null;
      sortOrder: number;
      tags: string[];
    }>;
  }>;
  scoped: boolean;
}> {
  const sourceSelect = {
    select: {
      id: true,
      sourceId: true,
      sortOrder: true,
      tags: true,
      source: { select: { documentType: true } },
    },
    orderBy: { sortOrder: "asc" as const },
  } as const;

  // 1. Try course-scoped
  const playbookSubjects = await prisma.playbookSubject.findMany({
    where: { playbookId },
    select: {
      subject: {
        select: {
          id: true,
          teachingDepth: true,
          sources: sourceSelect,
        },
      },
    },
  });

  if (playbookSubjects.length > 0) {
    return {
      subjects: playbookSubjects.map((ps) => ({
        ...ps.subject,
        sources: ps.subject.sources.map((s) => ({
          subjectSourceId: s.id,
          sourceId: s.sourceId,
          documentType: s.source?.documentType ?? null,
          sortOrder: s.sortOrder,
          tags: s.tags,
        })),
      })),
      scoped: true,
    };
  }

  // 2. Fallback: domain-wide
  const subjectDomains = await prisma.subjectDomain.findMany({
    where: { domainId },
    select: {
      subject: {
        select: {
          id: true,
          teachingDepth: true,
          sources: sourceSelect,
        },
      },
    },
  });

  return {
    subjects: subjectDomains.map((sd) => ({
      ...sd.subject,
      sources: sd.subject.sources.map((s) => ({
        subjectSourceId: s.id,
        sourceId: s.sourceId,
        documentType: s.source?.documentType ?? null,
        sortOrder: s.sortOrder,
        tags: s.tags,
      })),
    })),
    scoped: false,
  };
}

/**
 * Get teaching source IDs for a domain, EXCLUDING teacher-only documents.
 * Uses isStudentVisibleDefault() to filter — only READING_PASSAGE, WORKSHEET,
 * COMPREHENSION, and EXAMPLE documents are included.
 * Used by VAPI knowledge retrieval to prevent teacher materials from
 * being served as student content during calls.
 */
export async function getTeachingSourceIdsForDomain(domainId: string): Promise<string[]> {
  const allSourceIds = await getSourceIdsForDomain(domainId);
  if (allSourceIds.length === 0) return [];

  const sources = await prisma.contentSource.findMany({
    where: { id: { in: allSourceIds } },
    select: { id: true, documentType: true },
  });
  return sources
    .filter((s) => !s.documentType || isStudentVisibleDefault(s.documentType))
    .map((s) => s.id);
}

/**
 * Get teaching source IDs for a playbook, EXCLUDING teacher-only documents.
 * Uses isStudentVisibleDefault() to filter — only READING_PASSAGE, WORKSHEET,
 * COMPREHENSION, and EXAMPLE documents are included.
 * Used by VAPI knowledge retrieval to prevent teacher materials from
 * being served as student content during calls.
 */
export async function getTeachingSourceIdsForPlaybook(playbookId: string): Promise<string[]> {
  const allSourceIds = await getSourceIdsForPlaybook(playbookId);
  if (allSourceIds.length === 0) return [];

  const sources = await prisma.contentSource.findMany({
    where: { id: { in: allSourceIds } },
    select: { id: true, documentType: true },
  });
  return sources
    .filter((s) => !s.documentType || isStudentVisibleDefault(s.documentType))
    .map((s) => s.id);
}
