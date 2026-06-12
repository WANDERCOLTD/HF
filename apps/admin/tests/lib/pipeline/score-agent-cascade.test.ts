/**
 * #1513 Slice 3 — BehaviorTarget cascade for SCORE_AGENT.
 *
 * Pins the contract:
 *   1. PLAYBOOK rows present → cascade resolves at PLAYBOOK, NO I-AL5 emit.
 *   2. PLAYBOOK empty + SYSTEM populated → cascade resolves at SYSTEM,
 *      I-AL5 emitted with systemDefaultsEmpty=false (WARN).
 *   3. PLAYBOOK empty + SYSTEM empty → cascade resolves to NONE,
 *      I-AL5 emitted with systemDefaultsEmpty=true (ERROR).
 *   4. resolvedScope correctly reports the cascade layer that supplied targets.
 *   5. DB errors swallowed — function never throws, pipeline continues.
 *   6. Null playbookId + populated SYSTEM (harness path) does NOT emit.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    behaviorTarget: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
}));

const mockRecordIAL5 = vi.fn();
vi.mock("@/lib/pipeline/adaptive-loop-invariants", () => ({
  recordIAL5ZeroTargets: (...args: unknown[]) => mockRecordIAL5(...args),
}));

import { loadBehaviorTargetsWithCascade } from "@/lib/pipeline/score-agent-cascade";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadBehaviorTargetsWithCascade — PLAYBOOK hit", () => {
  it("returns PLAYBOOK rows when present and does NOT emit I-AL5", async () => {
    mockFindMany.mockResolvedValueOnce([
      { parameterId: "BEH-WARMTH", targetValue: 0.7 },
      { parameterId: "BEH-RESPONSE-LEN", targetValue: 0.3 },
    ]);

    const result = await loadBehaviorTargetsWithCascade({
      playbookId: "pb-cio-cto",
      callerId: "caller-1",
      callId: "call-1",
    });

    expect(result.resolvedScope).toBe("PLAYBOOK");
    expect(result.targets).toHaveLength(2);
    expect(result.targets[0]).toMatchObject({
      parameterId: "BEH-WARMTH",
      targetValue: 0.7,
      scope: "PLAYBOOK",
    });
    expect(result.emitted).toBe(false);
    expect(mockRecordIAL5).not.toHaveBeenCalled();

    // Only the PLAYBOOK query — never queries SYSTEM when PLAYBOOK hits.
    expect(mockFindMany).toHaveBeenCalledTimes(1);
    const [arg] = mockFindMany.mock.calls[0];
    expect(arg.where).toMatchObject({
      playbookId: "pb-cio-cto",
      scope: "PLAYBOOK",
    });
  });
});

describe("loadBehaviorTargetsWithCascade — PLAYBOOK empty, SYSTEM hit", () => {
  it("falls back to SYSTEM defaults and emits I-AL5 with systemDefaultsEmpty=false", async () => {
    mockFindMany
      .mockResolvedValueOnce([]) // PLAYBOOK empty
      .mockResolvedValueOnce([
        { parameterId: "BEH-WARMTH", targetValue: 0.5 },
        { parameterId: "BEH-FORMALITY", targetValue: 0.5 },
      ]); // SYSTEM populated

    const result = await loadBehaviorTargetsWithCascade({
      playbookId: "pb-cio-cto",
      callerId: "caller-1",
      callId: "call-1",
    });

    expect(result.resolvedScope).toBe("SYSTEM");
    expect(result.targets).toHaveLength(2);
    expect(result.targets[0].scope).toBe("SYSTEM");
    expect(result.targets[0].targetValue).toBe(0.5);
    expect(result.emitted).toBe(true);

    expect(mockRecordIAL5).toHaveBeenCalledTimes(1);
    expect(mockRecordIAL5).toHaveBeenCalledWith({
      playbookId: "pb-cio-cto",
      callerId: "caller-1",
      callId: "call-1",
      systemDefaultsEmpty: false,
    });
  });
});

describe("loadBehaviorTargetsWithCascade — both empty", () => {
  it("escalates I-AL5 to systemDefaultsEmpty=true and returns NONE", async () => {
    mockFindMany
      .mockResolvedValueOnce([]) // PLAYBOOK empty
      .mockResolvedValueOnce([]); // SYSTEM empty

    const result = await loadBehaviorTargetsWithCascade({
      playbookId: "pb-broken",
      callerId: "caller-1",
      callId: "call-1",
    });

    expect(result.resolvedScope).toBe("NONE");
    expect(result.targets).toEqual([]);
    expect(result.emitted).toBe(true);

    expect(mockRecordIAL5).toHaveBeenCalledTimes(1);
    expect(mockRecordIAL5).toHaveBeenCalledWith({
      playbookId: "pb-broken",
      callerId: "caller-1",
      callId: "call-1",
      systemDefaultsEmpty: true,
    });
  });
});

describe("loadBehaviorTargetsWithCascade — null playbookId (harness path)", () => {
  it("skips the PLAYBOOK query, hits SYSTEM, does NOT emit when SYSTEM populated", async () => {
    mockFindMany.mockResolvedValueOnce([
      { parameterId: "BEH-WARMTH", targetValue: 0.5 },
    ]);

    const result = await loadBehaviorTargetsWithCascade({
      playbookId: null,
      callerId: "caller-fresh",
    });

    expect(result.resolvedScope).toBe("SYSTEM");
    expect(result.targets).toHaveLength(1);
    expect(result.emitted).toBe(false);
    expect(mockRecordIAL5).not.toHaveBeenCalled();

    // Only ONE findMany call — the SYSTEM one. PLAYBOOK is skipped when
    // there's no playbookId to scope by.
    expect(mockFindMany).toHaveBeenCalledTimes(1);
    const [arg] = mockFindMany.mock.calls[0];
    expect(arg.where).toMatchObject({ scope: "SYSTEM", playbookId: null });
  });

  it("DOES emit when both null-playbook and SYSTEM are empty (cascade root gone)", async () => {
    mockFindMany.mockResolvedValueOnce([]);

    const result = await loadBehaviorTargetsWithCascade({
      playbookId: null,
      callerId: "caller-fresh",
    });

    expect(result.resolvedScope).toBe("NONE");
    expect(result.emitted).toBe(true);
    expect(mockRecordIAL5).toHaveBeenCalledTimes(1);
    expect(mockRecordIAL5).toHaveBeenCalledWith({
      playbookId: "",
      callerId: "caller-fresh",
      callId: undefined,
      systemDefaultsEmpty: true,
    });
  });
});

describe("loadBehaviorTargetsWithCascade — non-blocking durability", () => {
  it("swallows PLAYBOOK query errors and falls through to SYSTEM", async () => {
    mockFindMany
      .mockRejectedValueOnce(new Error("DB hiccup on PLAYBOOK"))
      .mockResolvedValueOnce([
        { parameterId: "BEH-WARMTH", targetValue: 0.5 },
      ]);

    const result = await loadBehaviorTargetsWithCascade({
      playbookId: "pb-cio-cto",
      callerId: "caller-1",
    });

    expect(result.resolvedScope).toBe("SYSTEM");
    expect(result.targets).toHaveLength(1);
    // Emit fires because PLAYBOOK was effectively empty (error → []).
    expect(mockRecordIAL5).toHaveBeenCalledWith(
      expect.objectContaining({ systemDefaultsEmpty: false }),
    );
  });

  it("swallows SYSTEM query errors and returns NONE without throwing", async () => {
    mockFindMany
      .mockResolvedValueOnce([]) // PLAYBOOK empty
      .mockRejectedValueOnce(new Error("DB hiccup on SYSTEM"));

    await expect(
      loadBehaviorTargetsWithCascade({
        playbookId: "pb-cio-cto",
        callerId: "caller-1",
      }),
    ).resolves.toMatchObject({
      resolvedScope: "NONE",
      targets: [],
      emitted: true,
    });
    expect(mockRecordIAL5).toHaveBeenCalledWith(
      expect.objectContaining({ systemDefaultsEmpty: true }),
    );
  });
});
