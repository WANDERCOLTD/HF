// ── Course resolution ───────────────────────────────────

export interface ResolvedPlaybook {
  id: string;
  name: string;
  interactionPattern?: string;
}

export interface CourseResolution {
  playbooks: ResolvedPlaybook[];
  /** true if single exact match or single partial match (auto-commit) */
  autoCommit: boolean;
}

/**
 * Look up existing courses (playbooks) in a domain by name.
 * Strategy: exact match first, then partial (contains) for 3+ char inputs.
 * Returns all candidates with auto-commit flag.
 */
export async function resolveCourseByName(name: string, domainId: string): Promise<CourseResolution | null> {
  try {
    const { prisma } = await import("@/lib/prisma");

    const selectClause = { id: true, name: true, config: true } as const;

    // #929 Slice B2 — drop playbooks a previous wizard attempt marked
    // abandoned via /api/wizard/discard-draft. The marker lives at
    // `config.wizardAbandonedAt`; the name is also suffixed "[abandoned ...]"
    // so exact-match would miss it anyway, but partial match still
    // substring-hits the new attempt's name. Filtered in JS because Prisma
    // JSON filters for "key absent" require `Prisma.DbNull`/`AnyNull`
    // helpers and the semantics differ subtly across versions; iterating a
    // small candidate set (`take: 5`) keeps things explicit.
    const isAbandoned = (config: Record<string, unknown> | null): boolean =>
      !!(config && (config as { wizardAbandonedAt?: unknown }).wizardAbandonedAt);

    // 1. Try exact match. Ordered by createdAt so collisions resolve to the
    //    oldest match deterministically (rare — names are ~unique per domain).
    const exactCandidates = await prisma.playbook.findMany({
      where: { domainId, name: { equals: name, mode: "insensitive" } },
      orderBy: { createdAt: "asc" },
      select: selectClause,
      take: 5,
    });
    const exact = exactCandidates.find((c) => !isAbandoned(c.config as Record<string, unknown> | null));
    if (exact) {
      const config = exact.config as Record<string, unknown> | null;
      return {
        playbooks: [{ id: exact.id, name: exact.name, interactionPattern: config?.interactionPattern as string | undefined }],
        autoCommit: true,
      };
    }

    // 2. Partial match (3+ chars)
    if (name.trim().length >= 3) {
      const rawCandidates = await prisma.playbook.findMany({
        where: { domainId, name: { contains: name, mode: "insensitive" } },
        select: selectClause,
        take: 10, // widened to leave headroom after filter; trimmed below
      });
      const candidates = rawCandidates
        .filter((c) => !isAbandoned(c.config as Record<string, unknown> | null))
        .slice(0, 5);
      if (candidates.length > 0) {
        const playbooks = candidates
          .sort((a, b) => a.name.length - b.name.length)
          .map((c) => {
            const config = c.config as Record<string, unknown> | null;
            return { id: c.id, name: c.name, interactionPattern: config?.interactionPattern as string | undefined };
          });
        return {
          playbooks,
          autoCommit: playbooks.length === 1,
        };
      }
    }

    return null;
  } catch (err) {
    console.warn("[wizard-tools] Course resolution failed:", err);
    return null;
  }
}
