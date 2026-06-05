/**
 * #1081 Slice 2B.3 — findAnchorDivergence() unit tests.
 *
 * Covers the CI guard that fails the build when two Curricula labelled with
 * the same qualificationAnchor diverge in module-slug set or LO-ref set.
 * Pure function — no database. The check-fk-consistency.ts script feeds the
 * result of one prisma.curriculum.findMany call into this function.
 *
 * Cases:
 *   1. 2 Curricula same anchor, identical modules + LOs → no divergence
 *   2. 2 Curricula same anchor, divergent module slugs → modules divergence
 *   3. 2 Curricula same anchor, same modules, divergent LO refs in a shared
 *      module → los divergence
 *   4. 1 Curriculum with anchor → no divergence (no comparison possible)
 *   5. 2 Curricula with null anchors → no divergence (silently ignored)
 *   6. 3 Curricula same anchor where canonical (oldest) disagrees with each
 *      of the other two in different ways → both pairs reported
 */

import { describe, it, expect } from "vitest";
import {
  findAnchorDivergence,
  type AnchorCurriculum,
} from "@/scripts/check-anchor-divergence";

function mk(
  partial: Partial<AnchorCurriculum> & {
    id: string;
    slug: string;
    qualificationAnchor: string | null;
    createdAt: Date;
    modules: AnchorCurriculum["modules"];
  },
): AnchorCurriculum {
  return {
    name: partial.name ?? partial.slug,
    ...partial,
  };
}

describe("findAnchorDivergence", () => {
  it("(1) two Curricula sharing an anchor with identical modules + LO refs → no divergence", () => {
    const curricula: AnchorCurriculum[] = [
      mk({
        id: "cur-a",
        slug: "course-a",
        qualificationAnchor: "sias-cio-cto-v6",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        modules: [
          { slug: "mod-1", learningObjectives: [{ ref: "LO-1.1" }, { ref: "LO-1.2" }] },
          { slug: "mod-2", learningObjectives: [{ ref: "LO-2.1" }] },
        ],
      }),
      mk({
        id: "cur-b",
        slug: "course-b",
        qualificationAnchor: "sias-cio-cto-v6",
        createdAt: new Date("2026-02-01T00:00:00Z"),
        modules: [
          { slug: "mod-1", learningObjectives: [{ ref: "LO-1.2" }, { ref: "LO-1.1" }] },
          { slug: "mod-2", learningObjectives: [{ ref: "LO-2.1" }] },
        ],
      }),
    ];

    expect(findAnchorDivergence(curricula)).toEqual([]);
  });

  it("(2) divergent module slugs surface a modules divergence (canonical = oldest)", () => {
    const curricula: AnchorCurriculum[] = [
      mk({
        id: "cur-a",
        slug: "course-a",
        qualificationAnchor: "sias-cio-cto-v6",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        modules: [
          { slug: "mod-1", learningObjectives: [{ ref: "LO-1.1" }] },
          { slug: "mod-2", learningObjectives: [{ ref: "LO-2.1" }] },
        ],
      }),
      mk({
        id: "cur-b",
        slug: "course-b",
        qualificationAnchor: "sias-cio-cto-v6",
        createdAt: new Date("2026-02-01T00:00:00Z"),
        modules: [
          { slug: "mod-1", learningObjectives: [{ ref: "LO-1.1" }] },
          { slug: "mod-3", learningObjectives: [{ ref: "LO-3.1" }] },
        ],
      }),
    ];

    const result = findAnchorDivergence(curricula);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      kind: "modules",
      anchor: "sias-cio-cto-v6",
      canonicalCurriculumId: "cur-a",
      canonicalCurriculumSlug: "course-a",
      otherCurriculumId: "cur-b",
      otherCurriculumSlug: "course-b",
      modulesOnlyInCanonical: ["mod-2"],
      modulesOnlyInOther: ["mod-3"],
    });
  });

  it("(3) same module slugs but divergent LO refs in a shared module → los divergence", () => {
    const curricula: AnchorCurriculum[] = [
      mk({
        id: "cur-a",
        slug: "course-a",
        qualificationAnchor: "sias-cio-cto-v6",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        modules: [
          { slug: "mod-1", learningObjectives: [{ ref: "LO-1.1" }, { ref: "LO-1.2" }] },
        ],
      }),
      mk({
        id: "cur-b",
        slug: "course-b",
        qualificationAnchor: "sias-cio-cto-v6",
        createdAt: new Date("2026-02-01T00:00:00Z"),
        modules: [
          { slug: "mod-1", learningObjectives: [{ ref: "LO-1.1" }, { ref: "LO-1.3" }] },
        ],
      }),
    ];

    const result = findAnchorDivergence(curricula);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      kind: "los",
      anchor: "sias-cio-cto-v6",
      canonicalCurriculumId: "cur-a",
      canonicalCurriculumSlug: "course-a",
      otherCurriculumId: "cur-b",
      otherCurriculumSlug: "course-b",
      moduleSlug: "mod-1",
      loRefsOnlyInCanonical: ["LO-1.2"],
      loRefsOnlyInOther: ["LO-1.3"],
    });
  });

  it("(4) a single Curriculum carrying an anchor → no divergence (nothing to compare)", () => {
    const curricula: AnchorCurriculum[] = [
      mk({
        id: "cur-a",
        slug: "course-a",
        qualificationAnchor: "sias-cio-cto-v6",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        modules: [{ slug: "mod-1", learningObjectives: [{ ref: "LO-1.1" }] }],
      }),
    ];

    expect(findAnchorDivergence(curricula)).toEqual([]);
  });

  it("(5) Curricula with null anchors are silently ignored (legacy data)", () => {
    const curricula: AnchorCurriculum[] = [
      mk({
        id: "cur-a",
        slug: "course-a",
        qualificationAnchor: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        modules: [{ slug: "mod-1", learningObjectives: [{ ref: "LO-1.1" }] }],
      }),
      mk({
        id: "cur-b",
        slug: "course-b",
        qualificationAnchor: null,
        createdAt: new Date("2026-02-01T00:00:00Z"),
        modules: [{ slug: "mod-9", learningObjectives: [{ ref: "LO-9.9" }] }],
      }),
    ];

    expect(findAnchorDivergence(curricula)).toEqual([]);
  });

  it("(6) 3 Curricula same anchor: canonical disagrees with each in a different way", () => {
    const curricula: AnchorCurriculum[] = [
      // canonical (oldest)
      mk({
        id: "cur-canonical",
        slug: "course-canonical",
        qualificationAnchor: "sias-cio-cto-v6",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        modules: [
          { slug: "mod-1", learningObjectives: [{ ref: "LO-1.1" }, { ref: "LO-1.2" }] },
          { slug: "mod-2", learningObjectives: [{ ref: "LO-2.1" }] },
        ],
      }),
      // other-1 — diverges on module slug
      mk({
        id: "cur-other-1",
        slug: "course-other-1",
        qualificationAnchor: "sias-cio-cto-v6",
        createdAt: new Date("2026-02-01T00:00:00Z"),
        modules: [
          { slug: "mod-1", learningObjectives: [{ ref: "LO-1.1" }, { ref: "LO-1.2" }] },
          { slug: "mod-99", learningObjectives: [{ ref: "LO-99.1" }] },
        ],
      }),
      // other-2 — same modules but LO ref diverges in mod-1
      mk({
        id: "cur-other-2",
        slug: "course-other-2",
        qualificationAnchor: "sias-cio-cto-v6",
        createdAt: new Date("2026-03-01T00:00:00Z"),
        modules: [
          { slug: "mod-1", learningObjectives: [{ ref: "LO-1.1" }, { ref: "LO-1.X" }] },
          { slug: "mod-2", learningObjectives: [{ ref: "LO-2.1" }] },
        ],
      }),
    ];

    const result = findAnchorDivergence(curricula);

    // Expect 3 divergences in total:
    //   - canonical vs other-1: modules divergence (mod-2 only in canonical, mod-99 only in other-1)
    //   - canonical vs other-2: los divergence in mod-1 (LO-1.2 only in canonical, LO-1.X only in other-2)
    //   - canonical vs other-1 in mod-1 → LOs identical, no entry
    expect(result).toHaveLength(2);

    const modulesDiv = result.find((d) => d.kind === "modules");
    expect(modulesDiv).toBeDefined();
    expect(modulesDiv).toMatchObject({
      kind: "modules",
      canonicalCurriculumId: "cur-canonical",
      otherCurriculumId: "cur-other-1",
      modulesOnlyInCanonical: ["mod-2"],
      modulesOnlyInOther: ["mod-99"],
    });

    const losDiv = result.find((d) => d.kind === "los");
    expect(losDiv).toBeDefined();
    expect(losDiv).toMatchObject({
      kind: "los",
      canonicalCurriculumId: "cur-canonical",
      otherCurriculumId: "cur-other-2",
      moduleSlug: "mod-1",
      loRefsOnlyInCanonical: ["LO-1.2"],
      loRefsOnlyInOther: ["LO-1.X"],
    });
  });
});
