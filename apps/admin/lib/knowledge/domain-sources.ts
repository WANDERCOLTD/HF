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
 * Get all ContentSource IDs linked to a playbook (course) via PlaybookSubject.
 * Falls back to domain-wide sources if no PlaybookSubject records exist.
 * Returns deduplicated array. Returns empty array if no sources found.
 */
export async function getSourceIdsForPlaybook(playbookId: string): Promise<string[]> {
  // 1. PRIMARY: PlaybookSource (direct link — Phase 3a)
  const playbookSources = await prisma.playbookSource.findMany({
    where: { playbookId },
    select: { sourceId: true },
  });

  if (playbookSources.length > 0) {
    return [...new Set(playbookSources.map((ps) => ps.sourceId))];
  }

  // 2. FALLBACK: Legacy Subject chain (pre-migration courses without PlaybookSource rows)
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

  // 3. Fallback: domain-wide (backward compat for pre-scoping courses).
  // ⚠️ See the matching warning in getSubjectsForPlaybook below — this
  // path is unbounded and should only fire for legacy/un-scoped playbooks.
  const playbook = await prisma.playbook.findUnique({
    where: { id: playbookId },
    select: { domainId: true },
  });
  if (!playbook?.domainId) return [];

  console.error(
    `[domain-sources] ⚠️ DOMAIN-WIDE FALLBACK fired for getSourceIdsForPlaybook(${playbookId}) ` +
      `(domain ${playbook.domainId}). Scope unbounded — backfill PlaybookSource to lock scope.`,
  );

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
  // 1. PRIMARY: PlaybookSource for content + PlaybookSubject for metadata
  const playbookSources = await prisma.playbookSource.findMany({
    where: { playbookId },
    select: {
      sourceId: true,
      sortOrder: true,
      tags: true,
      source: { select: { documentType: true } },
    },
    orderBy: { sortOrder: "asc" },
  });

  if (playbookSources.length > 0) {
    // Get subject metadata from PlaybookSubject (taxonomy, teachingDepth)
    const playbookSubjects = await prisma.playbookSubject.findMany({
      where: { playbookId },
      select: { subject: { select: { id: true, teachingDepth: true } } },
    });

    // Build subjects with sources from PlaybookSource, metadata from PlaybookSubject
    // All sources belong to the playbook (not a specific subject), so we attach them
    // to the first subject for backward compat with transforms that read subjects[0].sources
    const subjects = playbookSubjects.map((ps, idx) => ({
      ...ps.subject,
      sources: idx === 0
        ? playbookSources.map((s) => ({
            subjectSourceId: "", // Not applicable for PlaybookSource path
            sourceId: s.sourceId,
            documentType: s.source?.documentType ?? null,
            sortOrder: s.sortOrder,
            tags: s.tags,
          }))
        : [], // Only first subject carries sources (content is course-scoped, not subject-scoped)
    }));

    // If no PlaybookSubject exists (edge case), synthesize a minimal subject entry
    if (subjects.length === 0) {
      return {
        subjects: [{
          id: "",
          teachingDepth: null,
          sources: playbookSources.map((s) => ({
            subjectSourceId: "",
            sourceId: s.sourceId,
            documentType: s.source?.documentType ?? null,
            sortOrder: s.sortOrder,
            tags: s.tags,
          })),
        }],
        scoped: true,
      };
    }

    return { subjects, scoped: true };
  }

  // 2. FALLBACK: Legacy Subject chain (pre-migration courses)
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

  const playbookSubjectsLegacy = await prisma.playbookSubject.findMany({
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

  if (playbookSubjectsLegacy.length > 0) {
    return {
      subjects: playbookSubjectsLegacy.map((ps) => ({
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

  // 3. Fallback: domain-wide.
  // ⚠️ This path is the source-bleed risk identified in #317 follow-up
  // investigation. It pulls EVERY source attached to ANY subject in the
  // domain — which means sibling courses sharing the domain cross-pollute
  // every prompt the pipeline composes. Log loudly so this surfaces in
  // production traces; the right fix is to populate PlaybookSource for
  // every playbook (see scripts/audit-playbook-scope.ts).
  console.error(
    `[domain-sources] ⚠️ DOMAIN-WIDE FALLBACK fired for playbook ${playbookId} ` +
      `(domain ${domainId}). Scope is unbounded — all subjects in this domain ` +
      `will contribute sources to the prompt pipeline. Backfill PlaybookSource ` +
      `or PlaybookSubject to lock scope. See lib/knowledge/domain-sources.ts.`,
  );

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
