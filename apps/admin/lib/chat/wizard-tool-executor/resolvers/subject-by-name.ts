import type { ResolvedPlaybook } from "./course-by-name";

// ── Subject resolution ──────────────────────────────────

export interface ResolvedSubjectMatch {
  id: string;
  name: string;
  /** Courses (playbooks) linked to this subject in this domain */
  courses: ResolvedPlaybook[];
}

export interface SubjectResolution {
  subjects: ResolvedSubjectMatch[];
  /** true if single exact match or single partial match (auto-commit) */
  autoCommit: boolean;
}

/**
 * Look up existing subjects in a domain by name.
 * Strategy: exact match first, then partial (contains) for 3+ char inputs.
 * Scoped to domain via SubjectDomain join. Includes courses for each subject.
 */
export async function resolveSubjectByName(name: string, domainId: string): Promise<SubjectResolution | null> {
  try {
    const { prisma } = await import("@/lib/prisma");

    const subjectSelect = {
      subject: {
        select: {
          id: true,
          name: true,
          playbooks: {
            where: { playbook: { domainId } },
            select: {
              playbook: { select: { id: true, name: true, config: true } },
            },
          },
        },
      },
    } as const;

    function toSubjectMatch(link: { subject: { id: string; name: string; playbooks: Array<{ playbook: { id: string; name: string; config: unknown } }> } }): ResolvedSubjectMatch {
      return {
        id: link.subject.id,
        name: link.subject.name,
        courses: link.subject.playbooks.map((ps) => {
          const config = ps.playbook.config as Record<string, unknown> | null;
          return { id: ps.playbook.id, name: ps.playbook.name, interactionPattern: config?.interactionPattern as string | undefined };
        }),
      };
    }

    // 1. Try exact match (domain-scoped via SubjectDomain)
    const exactLink = await prisma.subjectDomain.findFirst({
      where: { domainId, subject: { name: { equals: name, mode: "insensitive" } } },
      select: subjectSelect,
    });
    if (exactLink) {
      return {
        subjects: [toSubjectMatch(exactLink)],
        autoCommit: true,
      };
    }

    // 2. Partial match (3+ chars, domain-scoped)
    if (name.trim().length >= 3) {
      const candidateLinks = await prisma.subjectDomain.findMany({
        where: { domainId, subject: { name: { contains: name, mode: "insensitive" } } },
        select: subjectSelect,
        take: 5,
      });
      if (candidateLinks.length > 0) {
        const subjects = candidateLinks
          .sort((a, b) => a.subject.name.length - b.subject.name.length)
          .map(toSubjectMatch);
        return {
          subjects,
          autoCommit: subjects.length === 1,
        };
      }
    }

    return null;
  } catch (err) {
    console.warn("[wizard-tools] Subject resolution failed:", err);
    return null;
  }
}
