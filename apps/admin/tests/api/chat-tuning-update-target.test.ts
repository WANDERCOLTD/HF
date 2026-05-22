/**
 * Tests for the update_behavior_target chat tool handler (#603 Option B).
 *
 * The tool is wired into the TUNING chat mode and dispatched by executeAdminTool.
 * Validation lives in lib/agent-tuner/write-target.ts (whitelist + clamp) so this
 * suite checks the handler's contract: shape validation, role gate, error surfacing.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const adjustableParams = [
  { parameterId: "BEH-WARMTH" },
  { parameterId: "BEH-CHALLENGE-LEVEL" },
];

const mockPrisma = {
  parameter: { findMany: vi.fn() },
  playbook: { findUnique: vi.fn() },
  behaviorTarget: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

describe("update_behavior_target chat tool handler", () => {
  let executeAdminTool: typeof import("../../lib/chat/admin-tool-handlers").executeAdminTool;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma.parameter.findMany.mockResolvedValue(adjustableParams);
    mockPrisma.playbook.findUnique.mockResolvedValue({ id: "pb-1" });
    mockPrisma.behaviorTarget.findFirst.mockResolvedValue(null);
    mockPrisma.behaviorTarget.create.mockResolvedValue({ id: "bt-new" });
    mockPrisma.behaviorTarget.update.mockResolvedValue({ id: "bt-upd" });
    mockPrisma.behaviorTarget.delete.mockResolvedValue({ id: "bt-del" });

    const mod = await import("../../lib/chat/admin-tool-handlers");
    executeAdminTool = mod.executeAdminTool;
  });

  it("creates a BehaviorTarget when called with a valid catalogue parameterId", async () => {
    const raw = await executeAdminTool(
      "update_behavior_target",
      {
        playbook_id: "pb-1",
        parameter_id: "BEH-WARMTH",
        target_value: 0.4,
        reason: "Educator asked for less friendly tone",
      },
      "OPERATOR",
      { userId: "u-1" },
    );
    const parsed = JSON.parse(raw);

    expect(parsed.ok).toBe(true);
    expect(parsed.action).toBe("created");
    expect(parsed.new_value).toBe(0.4);
    expect(parsed.parameter_id).toBe("BEH-WARMTH");
    expect(mockPrisma.behaviorTarget.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        parameterId: "BEH-WARMTH",
        playbookId: "pb-1",
        scope: "PLAYBOOK",
        targetValue: 0.4,
        source: "MANUAL",
      }),
    });
  });

  it("rejects parameterIds that are not in the adjustable catalogue", async () => {
    const raw = await executeAdminTool(
      "update_behavior_target",
      {
        playbook_id: "pb-1",
        parameter_id: "BEH-MADE-UP",
        target_value: 0.5,
        reason: "trying to invent an ID",
      },
      "OPERATOR",
    );
    const parsed = JSON.parse(raw);

    expect(parsed.error).toContain("not an adjustable BEHAVIOR parameter");
    expect(mockPrisma.behaviorTarget.create).not.toHaveBeenCalled();
  });

  it("clamps target_value into [0, 1]", async () => {
    await executeAdminTool(
      "update_behavior_target",
      {
        playbook_id: "pb-1",
        parameter_id: "BEH-WARMTH",
        target_value: 1.7,
        reason: "out of range",
      },
      "OPERATOR",
    );

    expect(mockPrisma.behaviorTarget.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ targetValue: 1 }),
    });
  });

  it("removes the override when target_value is null", async () => {
    mockPrisma.behaviorTarget.findFirst.mockResolvedValueOnce({ id: "bt-existing" });

    const raw = await executeAdminTool(
      "update_behavior_target",
      {
        playbook_id: "pb-1",
        parameter_id: "BEH-WARMTH",
        target_value: null,
        reason: "fall back to system default",
      },
      "OPERATOR",
    );
    const parsed = JSON.parse(raw);

    expect(parsed.ok).toBe(true);
    expect(parsed.action).toBe("removed");
    expect(mockPrisma.behaviorTarget.delete).toHaveBeenCalledWith({
      where: { id: "bt-existing" },
    });
  });

  it("returns a 'playbook not found' error for an unknown playbookId", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValueOnce(null);

    const raw = await executeAdminTool(
      "update_behavior_target",
      {
        playbook_id: "pb-missing",
        parameter_id: "BEH-WARMTH",
        target_value: 0.5,
        reason: "stale UUID",
      },
      "OPERATOR",
    );
    const parsed = JSON.parse(raw);

    expect(parsed.error).toContain("not found");
    expect(mockPrisma.behaviorTarget.create).not.toHaveBeenCalled();
  });

  it("requires playbook_id and parameter_id strings", async () => {
    const raw1 = await executeAdminTool(
      "update_behavior_target",
      { playbook_id: "", parameter_id: "BEH-WARMTH", target_value: 0.5, reason: "x" },
      "OPERATOR",
    );
    expect(JSON.parse(raw1).error).toContain("playbook_id");

    const raw2 = await executeAdminTool(
      "update_behavior_target",
      { playbook_id: "pb-1", parameter_id: "", target_value: 0.5, reason: "x" },
      "OPERATOR",
    );
    expect(JSON.parse(raw2).error).toContain("parameter_id");

    expect(mockPrisma.behaviorTarget.create).not.toHaveBeenCalled();
  });

  it("rejects target_value that is not a number or null", async () => {
    const raw = await executeAdminTool(
      "update_behavior_target",
      {
        playbook_id: "pb-1",
        parameter_id: "BEH-WARMTH",
        target_value: "high",
        reason: "wrong type",
      },
      "OPERATOR",
    );
    expect(JSON.parse(raw).error).toContain("target_value");
    expect(mockPrisma.behaviorTarget.create).not.toHaveBeenCalled();
  });

  it("blocks callers below the OPERATOR role", async () => {
    const raw = await executeAdminTool(
      "update_behavior_target",
      {
        playbook_id: "pb-1",
        parameter_id: "BEH-WARMTH",
        target_value: 0.5,
        reason: "lower-role attempt",
      },
      "TESTER",
    );
    expect(JSON.parse(raw).error).toContain("Insufficient permissions");
    expect(mockPrisma.behaviorTarget.create).not.toHaveBeenCalled();
  });
});
