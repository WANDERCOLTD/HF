/**
 * Domain / Playbook → Content Source Resolution
 *
 * Resolves content source IDs:
 *
 * Course-scoped:  Playbook → PlaybookSource → ContentSource    (Phase 6: authoritative)
 * Domain-wide:    Domain   → SubjectDomain → Subject → SubjectSource → ContentSource
 *
 * Used by VAPI knowledge endpoint, call sim, prompt composition, and
 * content-breakdown API to scope content retrieval.
 *
 * Phase 6 (this file): Course-scoped resolution uses PlaybookSource only.
 * No fallback to the legacy PlaybookSubject → Subject → SubjectSource chain
 * and no fallback to domain-wide. A course without PlaybookSource rows is
 * treated as having no content scope (returns empty).
 *
 * Domain-wide resolution still uses the Subject taxonomy chain — that is
 * the only way to express "all sources in this domain regardless of course".
 */

import { prisma } from "@/lib/prisma";
import { isStudentVisibleDefault } from "@/lib/doc-type-icons";

/**
 * Sync PlaybookSource rows for a playbook from its SubjectSource chain.
 * Call after creating/updating PlaybookSubject or SubjectSource links.
 * Idempotent — upserts with ON CONFLICT DO NOTHING semantics.
 */
export async function syncPlaybookSources(playbookId: string, subjectId: string): Promise<number> {
  const subjectSources = await prisma.subjectSource.findMany({
    where: { subjectId },
    select: { sourceId: true, sortOrder: true, tags: true, trustLevelOverride: true },
  });

  let synced = 0;
  for (const ss of subjectSources) {
    await prisma.playbookSource.upsert({
      where: { playbookId_sourceId: { playbookId, sourceId: ss.sourceId } },
      create: {
        playbookId,
        sourceId: ss.sourceId,
        sortOrder: ss.sortOrder,
        tags: ss.tags,
        trustLevelOverride: ss.trustLevelOverride,
      },
      update: {},
    });
    synced++;
  }
  return synced;
}

/**
 * Upsert a single PlaybookSource row. Call when a new SubjectSource is created
 * and the playbookId is known.
 */
export async function upsertPlaybookSource(
  playbookId: string,
  sourceId: string,
  opts?: { sortOrder?: number; tags?: string[]; trustLevelOverride?: string | null },
): Promise<void> {
  await prisma.playbookSource.upsert({
    where: { playbookId_sourceId: { playbookId, sourceId } },
    create: {
      playbookId,
      sourceId,
      sortOrder: opts?.sortOrder ?? 0,
      tags: opts?.tags ?? ["content"],
      trustLevelOverride: opts?.trustLevelOverride as any,
    },
    update: {},
  });
}

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
 * Get all ContentSource IDs linked to a playbook (course) via PlaybookSource.
 * Returns deduplicated array. Returns empty array if the course has no
 * PlaybookSource rows — no fallback to Subject chain or domain-wide.
 */
export async function getSourceIdsForPlaybook(playbookId: string): Promise<string[]> {
  const playbookSources = await prisma.playbookSource.findMany({
    where: { playbookId },
    select: { sourceId: true },
  });

  return [...new Set(playbookSources.map((ps) => ps.sourceId))];
}

/**
 * Resolve subject scope for a playbook.
 *
 * Phase 6: PlaybookSource is the authoritative content scope. PlaybookSubject
 * is read only for taxonomy metadata (subject.id, teachingDepth). No fallback
 * to the legacy Subject → SubjectSource chain and no fallback to domain-wide.
 * A course without PlaybookSource rows returns no sources.
 *
 * Returns:
 *   - subjects: taxonomy entries from PlaybookSubject; sources are attached
 *     to the first subject for backward compat with transforms that read
 *     subjects[0].sources. If a course has PlaybookSource but no
 *     PlaybookSubject, a synthetic empty-id subject carries the sources.
 *   - scoped: always true when sources exist (kept in the return shape for
 *     compatibility with callers that check it).
 */
export async function getSubjectsForPlaybook(
  playbookId: string,
  _domainId: string,
): Promise<{
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
  const [playbookSources, playbookSubjects] = await Promise.all([
    prisma.playbookSource.findMany({
      where: { playbookId },
      select: {
        sourceId: true,
        sortOrder: true,
        tags: true,
        source: { select: { documentType: true } },
      },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.playbookSubject.findMany({
      where: { playbookId },
      select: { subject: { select: { id: true, teachingDepth: true } } },
    }),
  ]);

  if (playbookSources.length === 0 && playbookSubjects.length === 0) {
    return { subjects: [], scoped: true };
  }

  const sources = playbookSources.map((s) => ({
    subjectSourceId: "", // No SubjectSource hop in Phase 6
    sourceId: s.sourceId,
    documentType: s.source?.documentType ?? null,
    sortOrder: s.sortOrder,
    tags: s.tags,
  }));

  // Attach all sources to the first subject for backward compat with
  // transforms that read subjects[0].sources. If no PlaybookSubject, synthesize one.
  if (playbookSubjects.length === 0) {
    return {
      subjects: [{ id: "", teachingDepth: null, sources }],
      scoped: true,
    };
  }

  return {
    subjects: playbookSubjects.map((ps, idx) => ({
      ...ps.subject,
      sources: idx === 0 ? sources : [],
    })),
    scoped: true,
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
