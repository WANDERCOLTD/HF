// ── Institution resolution ──────────────────────────────

export interface ResolvedCourse {
  id: string;
  name: string;
  interactionPattern?: string;
}

export interface ResolvedSubject {
  id: string;
  name: string;
  courses: ResolvedCourse[];
}

export interface ResolvedInstitution {
  institutionId: string;
  name: string;
  typeSlug: string | null;
  domainId: string;
  domainKind: string;
  subjects: ResolvedSubject[];
  /** true = exact name match, false = partial (contains) match needing confirmation */
  exactMatch: boolean;
}

/**
 * Look up an existing institution by name.
 * Strategy: exact match first, then partial (contains) for 3+ char inputs.
 * Returns the best match with its type, primary domain, subjects, and courses.
 *
 * Uses two direct Domain relations (both naturally domain-scoped):
 *   Domain → subjects (SubjectDomain) — what subjects are taught here
 *   Domain → playbooks (Playbook) → subjects (PlaybookSubject) — courses + their subjects
 * Then merges in JS: subjects as keys, courses attached to each.
 */
export async function resolveInstitutionByName(name: string): Promise<ResolvedInstitution | null> {
  try {
    const { prisma } = await import("@/lib/prisma");

    const includeClause = {
      type: { select: { slug: true } },
      domains: {
        take: 1,
        orderBy: { createdAt: "asc" as const },
        select: {
          id: true,
          kind: true,
          subjects: {
            select: {
              subject: { select: { id: true, name: true } },
            },
          },
          playbooks: {
            select: {
              id: true,
              name: true,
              config: true,
              subjects: {
                select: {
                  subject: { select: { id: true } },
                },
              },
            },
          },
        },
      },
    };

    // 1. Try exact match first (fast, unambiguous)
    let institution = await prisma.institution.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      include: includeClause,
    });
    let exactMatch = !!institution;

    // 2. No exact match — try partial match (minimum 3 chars to avoid noise)
    if (!institution && name.trim().length >= 3) {
      const candidates = await prisma.institution.findMany({
        where: { name: { contains: name, mode: "insensitive" } },
        include: includeClause,
        take: 5,
      });
      if (candidates.length > 0) {
        // Pick shortest name — best match ratio (e.g. "riverside" → "Riverside Academy" over "Riverside Community Training Centre")
        institution = candidates.sort((a, b) => a.name.length - b.name.length)[0];
        exactMatch = false;
      }
    }

    if (!institution || institution.domains.length === 0) return null;

    const domain = institution.domains[0];

    // Build subject map from SubjectDomain (includes subjects with no courses)
    const subjectMap = new Map<string, ResolvedSubject>();
    for (const sd of domain.subjects) {
      subjectMap.set(sd.subject.id, {
        id: sd.subject.id,
        name: sd.subject.name,
        courses: [],
      });
    }

    // Attach courses to their subjects via PlaybookSubject
    for (const pb of domain.playbooks) {
      const config = pb.config as Record<string, unknown> | null;
      const course: ResolvedCourse = {
        id: pb.id,
        name: pb.name,
        interactionPattern: config?.interactionPattern as string | undefined,
      };
      for (const ps of pb.subjects) {
        const subject = subjectMap.get(ps.subject.id);
        if (subject) subject.courses.push(course);
      }
    }

    return {
      institutionId: institution.id,
      name: institution.name,
      typeSlug: institution.type?.slug ?? null,
      domainId: domain.id,
      domainKind: domain.kind,
      subjects: Array.from(subjectMap.values()),
      exactMatch,
    };
  } catch (err) {
    console.warn("[wizard-tools] Institution resolution failed:", err);
    return null;
  }
}
