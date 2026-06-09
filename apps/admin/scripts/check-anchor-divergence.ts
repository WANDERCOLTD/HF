// KB: catalogued in docs/kb/guard-registry.md (CI check scripts). See for class + why.
/**
 * #1081 Slice 2B.3 — qualificationAnchor slug-set divergence detector.
 *
 * Pure function extracted from `check-fk-consistency.ts` so the divergence
 * logic can be unit-tested without a live database. The CI script feeds in
 * the result of a single `prisma.curriculum.findMany` and gets back a flat
 * list of divergences ready for reporting.
 *
 * Invariant being enforced:
 *   For every distinct non-null `qualificationAnchor`, all Curricula that
 *   carry that anchor must agree on
 *     (a) their CurriculumModule.slug set, and
 *     (b) their LearningObjective.ref set within each shared module slug.
 *
 * The "canonical" Curriculum in each anchor group is the oldest by
 * `createdAt`; every other Curriculum in the group is diffed against it.
 *
 * Null-anchor Curricula must NOT be passed in — the caller filters them
 * out at the Prisma query layer. This keeps the function pure.
 *
 * NOT a sharing mechanism — sibling Curricula sharing an anchor remain
 * independent for mastery purposes. Mastery sharing comes from
 * PlaybookCurriculum(role: linked). See `docs/ENTITIES.md` §3.
 */

export interface AnchorCurriculum {
  id: string;
  slug: string;
  name?: string | null;
  qualificationAnchor: string | null;
  createdAt: Date;
  modules: Array<{
    slug: string;
    learningObjectives: Array<{ ref: string }>;
  }>;
}

export type AnchorDivergence =
  | {
      kind: "modules";
      anchor: string;
      canonicalCurriculumId: string;
      canonicalCurriculumSlug: string;
      otherCurriculumId: string;
      otherCurriculumSlug: string;
      modulesOnlyInCanonical: string[];
      modulesOnlyInOther: string[];
    }
  | {
      kind: "los";
      anchor: string;
      canonicalCurriculumId: string;
      canonicalCurriculumSlug: string;
      otherCurriculumId: string;
      otherCurriculumSlug: string;
      moduleSlug: string;
      loRefsOnlyInCanonical: string[];
      loRefsOnlyInOther: string[];
    };

/**
 * Find every divergence in module-slug-set or LO-ref-set across pairs of
 * Curricula sharing a non-null `qualificationAnchor`. Each pair is reported
 * (canonical = oldest by createdAt; other = each remaining member of the group).
 *
 * A single Curriculum carrying an anchor produces no divergences. So does a
 * group of 2+ where every Curriculum agrees on both sets.
 *
 * @param curricula Curricula with non-null qualificationAnchor. Callers must
 *   filter null anchors at the source. If a null slips through it is silently
 *   ignored.
 * @returns flat list of divergences, ordered by anchor then by other.createdAt.
 */
export function findAnchorDivergence(curricula: AnchorCurriculum[]): AnchorDivergence[] {
  const divergences: AnchorDivergence[] = [];

  // Group by non-null anchor.
  const byAnchor = new Map<string, AnchorCurriculum[]>();
  for (const c of curricula) {
    if (!c.qualificationAnchor) continue;
    const arr = byAnchor.get(c.qualificationAnchor) ?? [];
    arr.push(c);
    byAnchor.set(c.qualificationAnchor, arr);
  }

  for (const [anchor, group] of byAnchor) {
    if (group.length < 2) continue;

    // Canonical = oldest by createdAt. Stable secondary sort on id so ties
    // are deterministic.
    const sorted = [...group].sort((a, b) => {
      const t = a.createdAt.getTime() - b.createdAt.getTime();
      return t !== 0 ? t : a.id.localeCompare(b.id);
    });
    const canonical = sorted[0];
    const canonicalModuleSlugs = new Set(canonical.modules.map((m) => m.slug));
    const canonicalLoRefsByModule = new Map<string, Set<string>>(
      canonical.modules.map((m) => [m.slug, new Set(m.learningObjectives.map((lo) => lo.ref))]),
    );

    for (const other of sorted.slice(1)) {
      const otherModuleSlugs = new Set(other.modules.map((m) => m.slug));

      const modulesOnlyInCanonical = [...canonicalModuleSlugs]
        .filter((s) => !otherModuleSlugs.has(s))
        .sort();
      const modulesOnlyInOther = [...otherModuleSlugs]
        .filter((s) => !canonicalModuleSlugs.has(s))
        .sort();

      if (modulesOnlyInCanonical.length || modulesOnlyInOther.length) {
        divergences.push({
          kind: "modules",
          anchor,
          canonicalCurriculumId: canonical.id,
          canonicalCurriculumSlug: canonical.slug,
          otherCurriculumId: other.id,
          otherCurriculumSlug: other.slug,
          modulesOnlyInCanonical,
          modulesOnlyInOther,
        });
      }

      // For modules present in BOTH Curricula, diff their LO ref sets.
      for (const m of other.modules) {
        if (!canonicalModuleSlugs.has(m.slug)) continue;
        const otherLoRefs = new Set(m.learningObjectives.map((lo) => lo.ref));
        const canonicalLoRefs = canonicalLoRefsByModule.get(m.slug) ?? new Set<string>();
        const loRefsOnlyInCanonical = [...canonicalLoRefs]
          .filter((r) => !otherLoRefs.has(r))
          .sort();
        const loRefsOnlyInOther = [...otherLoRefs].filter((r) => !canonicalLoRefs.has(r)).sort();
        if (loRefsOnlyInCanonical.length || loRefsOnlyInOther.length) {
          divergences.push({
            kind: "los",
            anchor,
            canonicalCurriculumId: canonical.id,
            canonicalCurriculumSlug: canonical.slug,
            otherCurriculumId: other.id,
            otherCurriculumSlug: other.slug,
            moduleSlug: m.slug,
            loRefsOnlyInCanonical,
            loRefsOnlyInOther,
          });
        }
      }
    }
  }

  return divergences;
}
