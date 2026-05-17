/**
 * #308: Module-balanced MCQ generation — helper tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    playbookSource: {
      findFirst: vi.fn(),
    },
    learningObjective: {
      // #317 exclusion query — default to empty (no system-only LOs filtered).
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  resolveModuleGroupsForSource,
  computeModuleBudget,
  TARGET_PER_MODULE,
  MAX_TOTAL_COUNT,
} from "@/lib/assessment/module-groups";

describe("computeModuleBudget", () => {
  it("4 modules → [5, 5, 5, 5]", () => {
    expect(computeModuleBudget(4)).toEqual([5, 5, 5, 5]);
  });

  it("1 module → [5]", () => {
    expect(computeModuleBudget(1)).toEqual([5]);
  });

  it("matches the IELTS Speaking v2 shape", () => {
    const budget = computeModuleBudget(4);
    expect(budget).toHaveLength(4);
    expect(budget.reduce((s, n) => s + n, 0)).toBe(20);
  });

  it("returns [] for zero modules", () => {
    expect(computeModuleBudget(0)).toEqual([]);
  });

  it("caps total at MAX_TOTAL_COUNT for many-module courses", () => {
    const budget = computeModuleBudget(10); // 10 × 5 = 50, exceeds cap of 40
    expect(budget.reduce((s, n) => s + n, 0)).toBeLessThanOrEqual(MAX_TOTAL_COUNT);
    expect(budget.every((n) => n >= 1)).toBe(true);
    expect(budget).toHaveLength(10);
  });

  it("uses target = TARGET_PER_MODULE when sum fits under cap", () => {
    expect(computeModuleBudget(3).every((n) => n === TARGET_PER_MODULE)).toBe(true);
  });
});

describe("resolveModuleGroupsForSource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns groups when playbook has authored modules with outcomesPrimary", async () => {
    vi.mocked(prisma.playbookSource.findFirst).mockResolvedValue({
      playbook: {
        config: {
          modules: [
            { id: "part1", label: "Part 1: Familiar Topics", outcomesPrimary: ["OUT-01", "OUT-06"] },
            { id: "part2", label: "Part 2: Cue Card", outcomesPrimary: ["OUT-08", "OUT-10"] },
          ],
        },
        curricula: [{ id: "curr-1" }],
      },
    } as never);

    const groups = await resolveModuleGroupsForSource("src-1");

    expect(groups).toHaveLength(2);
    expect(groups![0]).toEqual({
      moduleId: "part1",
      moduleLabel: "Part 1: Familiar Topics",
      outcomeRefs: ["OUT-01", "OUT-06"],
    });
  });

  it("skips modules with empty outcomesPrimary (e.g. baseline)", async () => {
    vi.mocked(prisma.playbookSource.findFirst).mockResolvedValue({
      playbook: {
        config: {
          modules: [
            { id: "baseline", label: "Baseline", outcomesPrimary: [] },
            { id: "part1", label: "Part 1", outcomesPrimary: ["OUT-01"] },
          ],
        },
        curricula: [{ id: "curr-1" }],
      },
    } as never);

    const groups = await resolveModuleGroupsForSource("src-1");

    expect(groups).toHaveLength(1);
    expect(groups![0].moduleId).toBe("part1");
  });

  it("returns null when source has no playbook link", async () => {
    vi.mocked(prisma.playbookSource.findFirst).mockResolvedValue(null);
    expect(await resolveModuleGroupsForSource("src-x")).toBeNull();
  });

  it("returns null when playbook config has no modules array", async () => {
    vi.mocked(prisma.playbookSource.findFirst).mockResolvedValue({
      playbook: { config: { modules: [] }, curricula: [{ id: "curr-1" }] },
    } as never);

    expect(await resolveModuleGroupsForSource("src-1")).toBeNull();
  });

  it("returns null when all modules have empty outcomesPrimary", async () => {
    vi.mocked(prisma.playbookSource.findFirst).mockResolvedValue({
      playbook: {
        config: {
          modules: [
            { id: "baseline", label: "Baseline", outcomesPrimary: [] },
          ],
        },
        curricula: [{ id: "curr-1" }],
      },
    } as never);

    expect(await resolveModuleGroupsForSource("src-1")).toBeNull();
  });

  it("filters out non-string entries in outcomesPrimary", async () => {
    vi.mocked(prisma.playbookSource.findFirst).mockResolvedValue({
      playbook: {
        config: {
          modules: [
            { id: "part1", label: "Part 1", outcomesPrimary: ["OUT-01", null, undefined, ""] as unknown as string[] },
          ],
        },
        curricula: [{ id: "curr-1" }],
      },
    } as never);

    const groups = await resolveModuleGroupsForSource("src-1");
    expect(groups).toHaveLength(1);
    expect(groups![0].outcomeRefs).toEqual(["OUT-01"]);
  });
});
