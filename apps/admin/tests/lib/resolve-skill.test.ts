/**
 * Tests for `lib/curriculum/resolve-skill.ts` — the canonical
 * skill-ref resolver (Stream A invariant A1 from the Skills Framework
 * heatmap handoff doc).
 *
 * Mirrors the test shape of `resolve-module.ts` (the sibling helper)
 * and pins the load-bearing properties:
 *
 *   1. Refuses unscoped lookup (throws on empty `playbookId`)
 *   2. Returns `null` for "not part of this playbook's framework"
 *      (never throws, lets heatmap render empty rows)
 *   3. Per-skill `tierScheme` flows through from `Parameter.config`
 *      and falls back to the 3-tier default
 *   4. Bulk variant returns rows ordered by skillRef
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    behaviorTarget: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

import {
  resolveSkillByLogicalId,
  resolveAllSkillsForPlaybook,
} from "@/lib/curriculum/resolve-skill";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveSkillByLogicalId", () => {
  it("throws when playbookId is empty (unscoped lookup refused)", async () => {
    await expect(resolveSkillByLogicalId("", "SKILL-01")).rejects.toThrow(
      /playbookId is required/i,
    );
  });

  it("returns null when skillRef is empty", async () => {
    const result = await resolveSkillByLogicalId("pb-1", "");
    expect(result).toBeNull();
    expect(mockPrisma.behaviorTarget.findFirst).not.toHaveBeenCalled();
  });

  it("returns null when skill is not part of this playbook's framework", async () => {
    mockPrisma.behaviorTarget.findFirst.mockResolvedValueOnce(null);
    const result = await resolveSkillByLogicalId("pb-1", "SKILL-99");
    expect(result).toBeNull();
  });

  it("returns the resolved tuple with all four required fields", async () => {
    mockPrisma.behaviorTarget.findFirst.mockResolvedValueOnce({
      id: "bt-1",
      parameterId: "skill_stakeholder_anticipation",
      skillRef: "SKILL-01",
      targetValue: 0.7,
      parameter: { config: null },
    });
    const result = await resolveSkillByLogicalId("pb-1", "SKILL-01");
    expect(result).toEqual({
      behaviorTargetId: "bt-1",
      parameterId: "skill_stakeholder_anticipation",
      skillRef: "SKILL-01",
      targetValue: 0.7,
      tierScheme: ["emerging", "developing", "secure"],
    });
  });

  it("flows per-skill tierScheme through from Parameter.config", async () => {
    mockPrisma.behaviorTarget.findFirst.mockResolvedValueOnce({
      id: "bt-1",
      parameterId: "skill_stakeholder_anticipation",
      skillRef: "SKILL-01",
      targetValue: 1.0,
      parameter: {
        config: {
          tierScheme: ["foundation", "developing", "practitioner", "distinction"],
        },
      },
    });
    const result = await resolveSkillByLogicalId("pb-cto", "SKILL-01");
    expect(result?.tierScheme).toEqual([
      "foundation",
      "developing",
      "practitioner",
      "distinction",
    ]);
  });

  it("falls back to the 3-tier default when Parameter.config has no tierScheme", async () => {
    mockPrisma.behaviorTarget.findFirst.mockResolvedValueOnce({
      id: "bt-1",
      parameterId: "skill_x",
      skillRef: "SKILL-01",
      targetValue: 1.0,
      parameter: { config: { somethingElse: true } },
    });
    const result = await resolveSkillByLogicalId("pb-1", "SKILL-01");
    expect(result?.tierScheme).toEqual(["emerging", "developing", "secure"]);
  });

  it("scopes the lookup by playbookId + skillRef + effectiveUntil:null", async () => {
    mockPrisma.behaviorTarget.findFirst.mockResolvedValueOnce(null);
    await resolveSkillByLogicalId("pb-1", "SKILL-01");
    expect(mockPrisma.behaviorTarget.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          playbookId: "pb-1",
          skillRef: "SKILL-01",
          effectiveUntil: null,
        },
      }),
    );
  });
});

describe("resolveAllSkillsForPlaybook", () => {
  it("throws when playbookId is empty", async () => {
    await expect(resolveAllSkillsForPlaybook("")).rejects.toThrow(
      /playbookId is required/i,
    );
  });

  it("returns [] when the playbook has zero SKILL-* targets", async () => {
    mockPrisma.behaviorTarget.findMany.mockResolvedValueOnce([]);
    const result = await resolveAllSkillsForPlaybook("pb-no-skills");
    expect(result).toEqual([]);
  });

  it("returns rows ordered by skillRef ascending", async () => {
    mockPrisma.behaviorTarget.findMany.mockResolvedValueOnce([
      {
        id: "bt-1",
        parameterId: "skill_a",
        skillRef: "SKILL-01",
        targetValue: 1.0,
        parameter: { config: null },
      },
      {
        id: "bt-2",
        parameterId: "skill_b",
        skillRef: "SKILL-02",
        targetValue: 1.0,
        parameter: { config: null },
      },
    ]);
    const result = await resolveAllSkillsForPlaybook("pb-1");
    expect(result.map((s) => s.skillRef)).toEqual(["SKILL-01", "SKILL-02"]);
    expect(mockPrisma.behaviorTarget.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          playbookId: "pb-1",
          skillRef: { startsWith: "SKILL-" },
          effectiveUntil: null,
        }),
        orderBy: { skillRef: "asc" },
      }),
    );
  });

  it("per-skill tierScheme is preserved per row — different skills can use different schemes", async () => {
    // Tech-lead correction: tierScheme is PER-SKILL, not per-playbook.
    // Two skills inside ONE playbook can use different schemes.
    mockPrisma.behaviorTarget.findMany.mockResolvedValueOnce([
      {
        id: "bt-1",
        parameterId: "skill_cefr",
        skillRef: "SKILL-01",
        targetValue: 1.0,
        parameter: { config: { tierScheme: ["a1", "a2", "b1", "b2", "c1", "c2"] } },
      },
      {
        id: "bt-2",
        parameterId: "skill_cto",
        skillRef: "SKILL-02",
        targetValue: 1.0,
        parameter: {
          config: { tierScheme: ["foundation", "developing", "practitioner", "distinction"] },
        },
      },
    ]);
    const result = await resolveAllSkillsForPlaybook("pb-mixed");
    expect(result[0].tierScheme).toEqual(["a1", "a2", "b1", "b2", "c1", "c2"]);
    expect(result[1].tierScheme).toEqual([
      "foundation",
      "developing",
      "practitioner",
      "distinction",
    ]);
  });
});
