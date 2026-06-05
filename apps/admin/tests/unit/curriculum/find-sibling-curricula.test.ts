/**
 * #1081 Slice 2B.2 — findCurriculumByAnchor() unit tests.
 *
 * Behaviour contract:
 *   - returns null when anchor or domainId is null/empty
 *   - returns null when no Curriculum matches the anchor in the domain
 *   - returns the Curriculum when exactly one matches
 *   - throws QualificationAnchorAmbiguity when 2+ match (no guess)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    curriculum: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  findCurriculumByAnchor,
  QualificationAnchorAmbiguity,
} from "@/lib/curriculum/find-sibling-curricula";

// Cast for test access (typed `Mock` rather than the real PrismaClient method).
const mockFindMany = prisma.curriculum.findMany as unknown as ReturnType<typeof vi.fn>;

describe("findCurriculumByAnchor", () => {
  beforeEach(() => {
    mockFindMany.mockReset();
  });

  it("returns null when anchor is null", async () => {
    const result = await findCurriculumByAnchor(null, "domain-1");
    expect(result).toBeNull();
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("returns null when anchor is empty string", async () => {
    const result = await findCurriculumByAnchor("", "domain-1");
    expect(result).toBeNull();
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("returns null when domainId is null", async () => {
    const result = await findCurriculumByAnchor("sias-cio-cto-v6", null);
    expect(result).toBeNull();
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("returns null when no Curriculum matches anchor in domain", async () => {
    mockFindMany.mockResolvedValueOnce([]);
    const result = await findCurriculumByAnchor("sias-cio-cto-v6", "domain-1");
    expect(result).toBeNull();
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          qualificationAnchor: "sias-cio-cto-v6",
          playbookLinks: {
            some: { playbook: { domainId: "domain-1" } },
          },
        }),
      }),
    );
  });

  it("returns the matching Curriculum when exactly one matches", async () => {
    const match = {
      id: "curr-1",
      slug: "the-standard",
      name: "The Standard",
      qualificationAnchor: "sias-cio-cto-v6",
      qualificationBody: "Ofqual",
      qualificationNumber: "SIAS/v6",
      qualificationLevel: null,
    };
    mockFindMany.mockResolvedValueOnce([match]);

    const result = await findCurriculumByAnchor("sias-cio-cto-v6", "domain-1");
    expect(result).toEqual(match);
  });

  it("throws QualificationAnchorAmbiguity when 2+ Curricula match", async () => {
    mockFindMany.mockResolvedValueOnce([
      { id: "curr-a", slug: "a", name: "A", qualificationAnchor: "sias-cio-cto-v6", qualificationBody: null, qualificationNumber: null, qualificationLevel: null },
      { id: "curr-b", slug: "b", name: "B", qualificationAnchor: "sias-cio-cto-v6", qualificationBody: null, qualificationNumber: null, qualificationLevel: null },
    ]);

    await expect(
      findCurriculumByAnchor("sias-cio-cto-v6", "domain-1"),
    ).rejects.toThrow(QualificationAnchorAmbiguity);
  });

  it("ambiguity error exposes the matched IDs for operator triage", async () => {
    mockFindMany.mockResolvedValueOnce([
      { id: "curr-a", slug: "a", name: "A", qualificationAnchor: "x", qualificationBody: null, qualificationNumber: null, qualificationLevel: null },
      { id: "curr-b", slug: "b", name: "B", qualificationAnchor: "x", qualificationBody: null, qualificationNumber: null, qualificationLevel: null },
      { id: "curr-c", slug: "c", name: "C", qualificationAnchor: "x", qualificationBody: null, qualificationNumber: null, qualificationLevel: null },
    ]);

    try {
      await findCurriculumByAnchor("x", "domain-1");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(QualificationAnchorAmbiguity);
      const e = err as QualificationAnchorAmbiguity;
      expect(e.anchor).toBe("x");
      expect(e.domainId).toBe("domain-1");
      expect(e.matchedCurriculumIds).toEqual(["curr-a", "curr-b", "curr-c"]);
    }
  });
});
