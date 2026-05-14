/**
 * Tests for applyBehaviorTargets() — lib/domain/agent-tuning.ts
 *
 * Creates/updates PLAYBOOK-scoped BehaviorTarget records from a parameterMap.
 * Mirrors the PATCH handler pattern from playbooks/[playbookId]/targets/route.ts.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mocks (vi.hoisted to avoid TDZ with vi.mock hoisting) ──

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    parameter: { findMany: vi.fn() },
    behaviorTarget: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma, db: (tx?: unknown) => tx ?? mockPrisma }));

// ── Import under test ──────────────────────────────────

import { applyBehaviorTargets } from "@/lib/domain/agent-tuning";

// ── Test data ──────────────────────────────────────────

const PLAYBOOK_ID = "pb-test-123";

const validParams = [
  { parameterId: "BEH-WARMTH" },
  { parameterId: "BEH-FORMALITY" },
  { parameterId: "BEH-PATIENCE" },
];

// ── Tests ──────────────────────────────────────────────

describe("applyBehaviorTargets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.parameter.findMany.mockResolvedValue(validParams);
    mockPrisma.behaviorTarget.findFirst.mockResolvedValue(null);
    mockPrisma.behaviorTarget.create.mockResolvedValue({ id: "bt-new" });
    mockPrisma.behaviorTarget.update.mockResolvedValue({ id: "bt-updated" });
  });

  it("returns 0 for empty parameter map", async () => {
    const result = await applyBehaviorTargets(PLAYBOOK_ID, {});
    expect(result).toBe(0);
    expect(mockPrisma.parameter.findMany).not.toHaveBeenCalled();
  });

  it("creates new BehaviorTarget records for valid parameters", async () => {
    const result = await applyBehaviorTargets(PLAYBOOK_ID, {
      "BEH-WARMTH": 0.8,
      "BEH-FORMALITY": 0.6,
    });

    expect(result).toBe(2);
    expect(mockPrisma.behaviorTarget.create).toHaveBeenCalledTimes(2);

    expect(mockPrisma.behaviorTarget.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        parameterId: "BEH-WARMTH",
        playbookId: PLAYBOOK_ID,
        scope: "PLAYBOOK",
        targetValue: 0.8,
        source: "MANUAL",
      }),
    });
  });

  it("supersedes existing targets with effectiveUntil", async () => {
    const existingTarget = {
      id: "bt-existing",
      parameterId: "BEH-WARMTH",
      targetValue: 0.5,
    };
    mockPrisma.behaviorTarget.findFirst.mockResolvedValue(existingTarget);

    const result = await applyBehaviorTargets(PLAYBOOK_ID, {
      "BEH-WARMTH": 0.9,
    });

    expect(result).toBe(1);

    // Should set effectiveUntil on the old record
    expect(mockPrisma.behaviorTarget.update).toHaveBeenCalledWith({
      where: { id: "bt-existing" },
      data: { effectiveUntil: expect.any(Date) },
    });

    // Should create a new record
    expect(mockPrisma.behaviorTarget.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        parameterId: "BEH-WARMTH",
        targetValue: 0.9,
        scope: "PLAYBOOK",
      }),
    });
  });

  it("skips update when existing value is effectively the same", async () => {
    mockPrisma.behaviorTarget.findFirst.mockResolvedValue({
      id: "bt-existing",
      parameterId: "BEH-WARMTH",
      targetValue: 0.8,
    });

    const result = await applyBehaviorTargets(PLAYBOOK_ID, {
      "BEH-WARMTH": 0.802, // Within 0.005 tolerance
    });

    expect(result).toBe(0);
    expect(mockPrisma.behaviorTarget.update).not.toHaveBeenCalled();
    expect(mockPrisma.behaviorTarget.create).not.toHaveBeenCalled();
  });

  it("clamps values to 0-1 range", async () => {
    await applyBehaviorTargets(PLAYBOOK_ID, {
      "BEH-WARMTH": 1.5,
      "BEH-FORMALITY": -0.3,
    });

    const calls = mockPrisma.behaviorTarget.create.mock.calls;
    expect(calls[0][0].data.targetValue).toBe(1);
    expect(calls[1][0].data.targetValue).toBe(0);
  });

  it("skips unknown parameter IDs with warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await applyBehaviorTargets(PLAYBOOK_ID, {
      "BEH-WARMTH": 0.8,
      "BEH-NONEXISTENT": 0.5,
    });

    expect(result).toBe(1);
    expect(mockPrisma.behaviorTarget.create).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("BEH-NONEXISTENT")
    );

    warnSpy.mockRestore();
  });

  it("uses custom confidence when provided", async () => {
    await applyBehaviorTargets(PLAYBOOK_ID, { "BEH-WARMTH": 0.7 }, 0.8);

    expect(mockPrisma.behaviorTarget.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        confidence: 0.8,
      }),
    });
  });

  it("uses default confidence of 0.5", async () => {
    await applyBehaviorTargets(PLAYBOOK_ID, { "BEH-WARMTH": 0.7 });

    expect(mockPrisma.behaviorTarget.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        confidence: 0.5,
      }),
    });
  });

  it("handles mixed scenario: create, update, and skip", async () => {
    mockPrisma.behaviorTarget.findFirst.mockImplementation(
      async ({ where }: any) => {
        if (where.parameterId === "BEH-WARMTH") {
          return { id: "bt-warmth", parameterId: "BEH-WARMTH", targetValue: 0.3 };
        }
        return null;
      }
    );

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await applyBehaviorTargets(PLAYBOOK_ID, {
      "BEH-WARMTH": 0.9,
      "BEH-FORMALITY": 0.6,
      "BEH-UNKNOWN": 0.5,
    });

    expect(result).toBe(2); // Warmth superseded+created, Formality created, Unknown skipped
    expect(mockPrisma.behaviorTarget.update).toHaveBeenCalledTimes(1); // Warmth superseded
    expect(mockPrisma.behaviorTarget.create).toHaveBeenCalledTimes(2); // Warmth new + Formality new

    warnSpy.mockRestore();
  });

  it("validates only BEHAVIOR type parameters", async () => {
    await applyBehaviorTargets(PLAYBOOK_ID, { "BEH-WARMTH": 0.7 });

    expect(mockPrisma.parameter.findMany).toHaveBeenCalledWith({
      where: {
        parameterId: { in: ["BEH-WARMTH"] },
        parameterType: "BEHAVIOR",
      },
      select: { parameterId: true },
    });
  });
});
