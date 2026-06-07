/**
 * #598 Slice 1 — mastery threshold cascade resolver.
 *
 * Verifies each cascade layer wins against everything beneath it, and that
 * the fallthrough returns the bucket-2 default. Mocks prisma + ContractRegistry
 * at the module boundary; uses typed `Mock` casts to match the codebase
 * convention (`vi.mocked()` causes tsc errors here).
 *
 * #836 — layer 1 reads BehaviorTarget(scope=CALLER) by `callerIdentityId`,
 * which references `CallerIdentity.id` (NOT `Caller.id`). The resolver fans
 * out via `prisma.caller.findUnique({ select: { callerIdentities } })` and
 * picks the MAX `targetValue` across identities. Tests cover the fanout.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    behaviorTarget: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    caller: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/contracts/registry", () => ({
  ContractRegistry: {
    getThresholds: vi.fn(),
  },
}));

import { prisma } from "@/lib/prisma";
import { ContractRegistry } from "@/lib/contracts/registry";
import {
  resolveMasteryThreshold,
  resolveMasteryThresholdDetailed,
  MASTERY_THRESHOLD_FALLBACK,
} from "@/lib/tolerance/resolve-tolerance";

const findFirstMock = prisma.behaviorTarget.findFirst as unknown as Mock;
const findManyMock = prisma.behaviorTarget.findMany as unknown as Mock;
const callerFindUniqueMock = prisma.caller.findUnique as unknown as Mock;
const getThresholdsMock = ContractRegistry.getThresholds as unknown as Mock;

function resetMocks() {
  findFirstMock.mockReset();
  findFirstMock.mockResolvedValue(null);
  findManyMock.mockReset();
  findManyMock.mockResolvedValue([]);
  callerFindUniqueMock.mockReset();
  callerFindUniqueMock.mockResolvedValue(null);
  getThresholdsMock.mockReset();
  getThresholdsMock.mockResolvedValue(null);
}

describe("resolveMasteryThreshold cascade", () => {
  beforeEach(resetMocks);

  it("layer 7 — falls back to hardcoded 0.7 when all layers are null", async () => {
    const value = await resolveMasteryThreshold({}, { silent: true });
    expect(value).toBe(MASTERY_THRESHOLD_FALLBACK);
  });

  it("layer 6 — uses ContractRegistry.masteryComplete when no upstream layer set", async () => {
    getThresholdsMock.mockResolvedValue({ masteryComplete: 0.66 });
    const value = await resolveMasteryThreshold({}, { silent: true });
    expect(value).toBe(0.66);
  });

  it("layer 5 — specConfig.metadata.curriculum.masteryThreshold beats layer 6", async () => {
    getThresholdsMock.mockResolvedValue({ masteryComplete: 0.66 });
    const value = await resolveMasteryThreshold(
      {
        specConfig: { metadata: { curriculum: { masteryThreshold: 0.55 } } },
      },
      { silent: true },
    );
    expect(value).toBe(0.55);
  });

  it("layer 4 — SchedulerPolicy.masteryThresholdOverride beats spec / contract", async () => {
    getThresholdsMock.mockResolvedValue({ masteryComplete: 0.66 });
    // `teachingMode: "syllabus"` selects EXAM_PREP whose masteryThresholdOverride = 0.6.
    // #1257 — STRUCTURED required, else default-deny routes to FREE_FLOW (override null).
    const value = await resolveMasteryThreshold(
      {
        playbookConfig: { lessonPlanMode: "structured", teachingMode: "syllabus" },
        specConfig: { metadata: { curriculum: { masteryThreshold: 0.55 } } },
      },
      { silent: true },
    );
    expect(value).toBe(0.6);
  });

  it("layer 3 — Playbook.config.tolerances.masteryThreshold beats layer 4 preset", async () => {
    const value = await resolveMasteryThreshold(
      {
        playbookConfig: {
          lessonPlanMode: "structured",
          teachingMode: "syllabus", // EXAM_PREP preset (override 0.6)
          tolerances: { masteryThreshold: 0.88 },
        },
      },
      { silent: true },
    );
    expect(value).toBe(0.88);
  });

  it("layer 2 — BehaviorTarget(PLAYBOOK) beats Playbook.config.tolerances", async () => {
    findFirstMock.mockResolvedValue({ targetValue: 0.42 });
    const value = await resolveMasteryThreshold(
      {
        playbookId: "pb-1",
        playbookConfig: { tolerances: { masteryThreshold: 0.88 } },
      },
      { silent: true },
    );
    expect(value).toBe(0.42);
  });

  describe("layer 1 — BehaviorTarget(CALLER) via CallerIdentity fanout (#836)", () => {
    it("fans out via the single CallerIdentity row when the caller has one", async () => {
      callerFindUniqueMock.mockResolvedValue({
        callerIdentities: [{ id: "ident-1" }],
      });
      findManyMock.mockResolvedValue([{ targetValue: 0.95 }]);
      findFirstMock.mockResolvedValue({ targetValue: 0.42 });

      const value = await resolveMasteryThreshold(
        {
          callerId: "caller-A",
          playbookId: "pb-1",
          playbookConfig: { tolerances: { masteryThreshold: 0.88 } },
        },
        { silent: true },
      );
      expect(value).toBe(0.95);
      expect(callerFindUniqueMock).toHaveBeenCalledWith({
        where: { id: "caller-A" },
        select: { callerIdentities: { select: { id: true } } },
      });
      expect(findManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            scope: "CALLER",
            callerIdentityId: { in: ["ident-1"] },
          }),
        }),
      );
    });

    it("fans out across multiple identities and picks the MAX targetValue", async () => {
      callerFindUniqueMock.mockResolvedValue({
        callerIdentities: [{ id: "ident-1" }, { id: "ident-2" }, { id: "ident-3" }],
      });
      // Three identities, three different overrides — 0.8 should win.
      findManyMock.mockResolvedValue([
        { targetValue: 0.55 },
        { targetValue: 0.8 },
        { targetValue: 0.72 },
      ]);
      const value = await resolveMasteryThreshold(
        { callerId: "caller-B", playbookId: "pb-1" },
        { silent: true },
      );
      expect(value).toBe(0.8);
    });

    it("falls through to layer 2 when the caller has no identities", async () => {
      callerFindUniqueMock.mockResolvedValue({ callerIdentities: [] });
      findFirstMock.mockResolvedValue({ targetValue: 0.42 });

      const value = await resolveMasteryThreshold(
        { callerId: "caller-C", playbookId: "pb-1" },
        { silent: true },
      );
      expect(value).toBe(0.42);
      // findMany must NOT be called when there are no identities to query against.
      expect(findManyMock).not.toHaveBeenCalled();
    });

    it("falls through to layer 2 when identities exist but none has a BehaviorTarget row", async () => {
      callerFindUniqueMock.mockResolvedValue({
        callerIdentities: [{ id: "ident-1" }, { id: "ident-2" }],
      });
      findManyMock.mockResolvedValue([]);
      findFirstMock.mockResolvedValue({ targetValue: 0.42 });

      const value = await resolveMasteryThreshold(
        { callerId: "caller-D", playbookId: "pb-1" },
        { silent: true },
      );
      expect(value).toBe(0.42);
    });

    it("falls through cleanly when the Caller row itself is missing", async () => {
      callerFindUniqueMock.mockResolvedValue(null);
      findFirstMock.mockResolvedValue({ targetValue: 0.42 });

      const value = await resolveMasteryThreshold(
        { callerId: "caller-MISSING", playbookId: "pb-1" },
        { silent: true },
      );
      expect(value).toBe(0.42);
    });
  });

  it("reports the winning source via the detailed variant", async () => {
    const detailed = await resolveMasteryThresholdDetailed(
      {
        playbookConfig: { tolerances: { masteryThreshold: 0.42 } },
      },
      { silent: true },
    );
    expect(detailed).toEqual({ value: 0.42, source: "playbook-config" });
  });

  it("survives a thrown BehaviorTarget(CALLER) read and falls through to layer 2", async () => {
    callerFindUniqueMock.mockResolvedValue({ callerIdentities: [{ id: "ident-1" }] });
    findManyMock.mockRejectedValue(new Error("db unreachable"));
    findFirstMock.mockResolvedValue({ targetValue: 0.33 });

    const value = await resolveMasteryThreshold(
      {
        callerId: "caller-E",
        playbookId: "pb-1",
        playbookConfig: { tolerances: { masteryThreshold: 0.88 } },
      },
      { silent: true },
    );
    expect(value).toBe(0.33);
  });
});
