/**
 * Sibling Curriculum lookup by qualificationAnchor (#1081 Slice 2B.2).
 *
 * When a create-course route declares qualification metadata (body + ref) that
 * derives to a non-null anchor, we look in the SAME DOMAIN for an existing
 * Curriculum carrying that anchor. If one exists, the new Playbook is linked
 * to it via PlaybookCurriculum(role: PlaybookCurriculumRole.linked) rather than minting a fresh
 * Curriculum — that is the variant pattern from #1034 applied to ingest paths.
 *
 * Domain scope: a Curriculum's domain is reached via any of its linked
 * Playbooks' Domain. Cross-domain anchor reuse is deferred (a course taught
 * in two domains should be a single Curriculum linked from two Playbooks,
 * one per domain — to be modelled if/when needed).
 *
 * Returns:
 *   - null if no Curriculum matches (caller should mint fresh)
 *   - the matching Curriculum if exactly one matches (caller should link via
 *     PlaybookCurriculum)
 *   - throws QualificationAnchorAmbiguity if 2+ Curricula match — data
 *     integrity is broken and runtime must refuse to guess. The CI guard in
 *     Slice 2B.3 will prevent this at build time but a runtime check is the
 *     last line of defence.
 */
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { PlaybookCurriculumRole } from "@prisma/client";

export class QualificationAnchorAmbiguity extends Error {
  public readonly anchor: string;
  public readonly domainId: string;
  public readonly matchedCurriculumIds: string[];
  constructor(anchor: string, domainId: string, matchedCurriculumIds: string[]) {
    super(
      `Multiple Curricula (${matchedCurriculumIds.length}) share ` +
        `qualificationAnchor="${anchor}" in domain=${domainId}. This is a data ` +
        `integrity violation; operator must investigate before new courses can ` +
        `be created with this anchor.`,
    );
    this.name = "QualificationAnchorAmbiguity";
    this.anchor = anchor;
    this.domainId = domainId;
    this.matchedCurriculumIds = matchedCurriculumIds;
  }
}

export type SiblingCurriculum = Prisma.CurriculumGetPayload<{
  select: {
    id: true;
    slug: true;
    name: true;
    qualificationAnchor: true;
    qualificationBody: true;
    qualificationNumber: true;
    qualificationLevel: true;
  };
}>;

/**
 * Find an existing Curriculum sharing the given anchor in the given domain.
 *
 * @returns null when nothing matches; the Curriculum when exactly one matches.
 * @throws QualificationAnchorAmbiguity when 2+ Curricula match — runtime
 *   refuses to guess which sibling to link to.
 */
export async function findCurriculumByAnchor(
  anchor: string | null | undefined,
  domainId: string | null | undefined,
): Promise<SiblingCurriculum | null> {
  if (!anchor || !domainId) return null;

  const matches = await prisma.curriculum.findMany({
    where: {
      qualificationAnchor: anchor,
      // Curriculum is "in this domain" if ANY of its linked Playbooks belong
      // to this domain. Variant Playbooks share a Curriculum so this works
      // out-of-the-box for the funnel pattern.
      playbookLinks: {
        some: {
          playbook: { domainId },
        },
      },
    },
    select: {
      id: true,
      slug: true,
      name: true,
      qualificationAnchor: true,
      qualificationBody: true,
      qualificationNumber: true,
      qualificationLevel: true,
    },
  });

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  throw new QualificationAnchorAmbiguity(
    anchor,
    domainId,
    matches.map((c) => c.id),
  );
}

/**
 * Find ALL Curricula sharing the given anchor across ALL domains (#1098 Slice A).
 *
 * Used by the readiness-rollups writer (`computeReadinessRollups`) for the
 * AC2 cross-course dedup: a learner whose `lo_mastery:*` evidence lives under
 * one Curriculum slug must still contribute to `unit_readiness` / `qualification_readiness`
 * keyed by the qualification anchor, not the Curriculum slug. The rollup
 * reader enumerates sibling Curricula via this helper, then merges their
 * `CurriculumModule + LearningObjective` sets to compute the readiness shape.
 *
 * Domain scope is intentionally NOT applied here. The rollup reader runs in
 * the AGGREGATE pipeline stage which already has a single learner's
 * playbookId/curriculumId context; cross-domain anchor reuse is a
 * separate concern (see findCurriculumByAnchor for the domain-scoped variant
 * used by ingest paths).
 *
 * @returns empty array if `anchor` is falsy or no Curricula match.
 *   Order is unspecified.
 */
export async function findSiblingCurricula(
  anchor: string | null | undefined,
): Promise<SiblingCurriculum[]> {
  if (!anchor) return [];

  return prisma.curriculum.findMany({
    where: { qualificationAnchor: anchor },
    select: {
      id: true,
      slug: true,
      name: true,
      qualificationAnchor: true,
      qualificationBody: true,
      qualificationNumber: true,
      qualificationLevel: true,
    },
  });
}
