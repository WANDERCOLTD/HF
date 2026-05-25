/**
 * #598 Slice 1 — mastery threshold cascade resolver.
 *
 * Verifies each cascade layer wins against everything beneath it, and that
 * the fallthrough returns the bucket-2 default. Mocks prisma + ContractRegistry
 * at the module boundary; uses typed `Mock` casts (see resetMocks)
 * to match the codebase convention (`vi.mocked()` causes tsc errors here).
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    behaviorTarget: {
      findFirst: vi.fn(),
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
const getThresholdsMock = ContractRegistry.getThresholds as unknown as Mock;

const noBehaviorTarget = () => null;

function resetMocks() {
  findFirstMock.mockReset();
  findFirstMock.mockResolvedValue(noBehaviorTarget());
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
    const value = await resolveMasteryThreshold(
      {
        playbookConfig: { teachingMode: "syllabus" },
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
          teachingMode: "syllabus", // EXAM_PREP preset (override 0.6)
          tolerances: { masteryThreshold: 0.88 },
        },
      },
      { silent: true },
    );
    expect(value).toBe(0.88);
  });

  it("layer 2 — BehaviorTarget(PLAYBOOK) beats Playbook.config.tolerances", async () => {
    findFirstMock.mockImplementation((args: { where: { scope: string } }) => {
      if (args.where.scope === "PLAYBOOK") return Promise.resolve({ targetValue: 0.42 });
      return Promise.resolve(null);
    });
    const value = await resolveMasteryThreshold(
      {
        playbookId: "pb-1",
        playbookConfig: { tolerances: { masteryThreshold: 0.88 } },
      },
      { silent: true },
    );
    expect(value).toBe(0.42);
  });

  it("layer 1 — BehaviorTarget(CALLER) beats all other layers", async () => {
    findFirstMock.mockImplementation((args: { where: { scope: string } }) => {
      if (args.where.scope === "CALLER") return Promise.resolve({ targetValue: 0.95 });
      if (args.where.scope === "PLAYBOOK") return Promise.resolve({ targetValue: 0.42 });
      return Promise.resolve(null);
    });
    const value = await resolveMasteryThreshold(
      {
        callerId: "c-1",
        playbookId: "pb-1",
        playbookConfig: { tolerances: { masteryThreshold: 0.88 } },
        specConfig: { metadata: { curriculum: { masteryThreshold: 0.55 } } },
      },
      { silent: true },
    );
    expect(value).toBe(0.95);
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

  it("survives a thrown BehaviorTarget read (DB hiccup) and falls through to next layer", async () => {
    findFirstMock.mockRejectedValue(new Error("db unreachable"));
    const value = await resolveMasteryThreshold(
      {
        callerId: "c-1",
        playbookId: "pb-1",
        playbookConfig: { tolerances: { masteryThreshold: 0.33 } },
      },
      { silent: true },
    );
    expect(value).toBe(0.33);
  });
});
