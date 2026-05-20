import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    callerAttribute: {
      findUnique: vi.fn(),
    },
  },
}));

// #566 Step 3 — mock includes the new evidenceFirst* fields. Hoisted so
// vi.mock can reference it (vi.mock factories are hoisted above imports).
const { mockSchedulerConfig } = vi.hoisted(() => ({
  mockSchedulerConfig: {
    assessmentModes: ["assess", "practice"],
    placeholderMode: "teach",
    evidenceFirstEnabled: false,
    evidenceFirstPlaybooks: [] as string[],
  },
}));
vi.mock("@/lib/config", () => ({
  config: {
    scheduler: mockSchedulerConfig,
  },
}));

import { prisma } from "@/lib/prisma";
import { shouldRunCallerAnalysis, isEvidenceFirstPlaybook } from "@/lib/pipeline/event-gate";

const mockFindUnique = prisma.callerAttribute.findUnique as ReturnType<typeof vi.fn>;

describe("event-gate.shouldRunCallerAnalysis", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
  });

  it("allows scoring when no prior SchedulerDecision exists", async () => {
    mockFindUnique.mockResolvedValue(null);
    const result = await shouldRunCallerAnalysis("caller-1");
    expect(result.allow).toBe(true);
    expect(result.mode).toBe("unknown");
    expect(result.reason).toMatch(/no prior/i);
  });

  it("denies scoring when prior decision was teach mode", async () => {
    mockFindUnique.mockResolvedValue({
      jsonValue: { mode: "teach", reason: "", writtenAt: "" },
    });
    const result = await shouldRunCallerAnalysis("caller-1");
    expect(result.allow).toBe(false);
    expect(result.mode).toBe("teach");
    expect(result.reason).toMatch(/no assessment evidence/);
  });

  it("denies scoring when prior decision was review mode", async () => {
    mockFindUnique.mockResolvedValue({
      jsonValue: { mode: "review", reason: "", writtenAt: "" },
    });
    const result = await shouldRunCallerAnalysis("caller-1");
    expect(result.allow).toBe(false);
  });

  it("allows scoring when prior decision was assess mode", async () => {
    mockFindUnique.mockResolvedValue({
      jsonValue: { mode: "assess", reason: "", writtenAt: "" },
    });
    const result = await shouldRunCallerAnalysis("caller-1");
    expect(result.allow).toBe(true);
    expect(result.mode).toBe("assess");
  });

  it("allows scoring when prior decision was practice mode", async () => {
    mockFindUnique.mockResolvedValue({
      jsonValue: { mode: "practice", reason: "", writtenAt: "" },
    });
    const result = await shouldRunCallerAnalysis("caller-1");
    expect(result.allow).toBe(true);
    expect(result.mode).toBe("practice");
  });
});

// =============================================================================
// Mode-kill epic #566 — Step 3: evidence-first override
// =============================================================================

describe("event-gate — evidence-first playbook override (#566 Step 3)", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockSchedulerConfig.evidenceFirstEnabled = false;
    mockSchedulerConfig.evidenceFirstPlaybooks = [];
  });

  it("isEvidenceFirstPlaybook returns false when flag is off", () => {
    mockSchedulerConfig.evidenceFirstEnabled = false;
    mockSchedulerConfig.evidenceFirstPlaybooks = ["pb-1"];
    expect(isEvidenceFirstPlaybook("pb-1")).toBe(false);
  });

  it("isEvidenceFirstPlaybook returns false when playbook not in list", () => {
    mockSchedulerConfig.evidenceFirstEnabled = true;
    mockSchedulerConfig.evidenceFirstPlaybooks = ["pb-1"];
    expect(isEvidenceFirstPlaybook("pb-2")).toBe(false);
  });

  it("isEvidenceFirstPlaybook returns true when flag is on AND playbook is listed", () => {
    mockSchedulerConfig.evidenceFirstEnabled = true;
    mockSchedulerConfig.evidenceFirstPlaybooks = ["pb-1"];
    expect(isEvidenceFirstPlaybook("pb-1")).toBe(true);
  });

  it("isEvidenceFirstPlaybook returns false for null/undefined playbookId", () => {
    mockSchedulerConfig.evidenceFirstEnabled = true;
    mockSchedulerConfig.evidenceFirstPlaybooks = ["pb-1"];
    expect(isEvidenceFirstPlaybook(null)).toBe(false);
    expect(isEvidenceFirstPlaybook(undefined)).toBe(false);
  });

  it("evidence-first playbook short-circuits the mode gate even when prior is teach", async () => {
    mockSchedulerConfig.evidenceFirstEnabled = true;
    mockSchedulerConfig.evidenceFirstPlaybooks = ["pb-evidence-first"];
    // Even if the prior decision is teach (which would normally block), the
    // evidence-first override allows the call through. The downstream
    // per-parameter Boaz guard decides whether each score is persisted.
    mockFindUnique.mockResolvedValue({
      jsonValue: { mode: "teach", reason: "", writtenAt: "" },
    });
    const result = await shouldRunCallerAnalysis("caller-1", "pb-evidence-first");
    expect(result.allow).toBe(true);
    expect(result.mode).toBe("evidence-first");
    expect(result.reason).toMatch(/evidence-first/i);
    // Verify the prior lookup was NOT consulted (gate short-circuited)
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("non-listed playbook still uses mode gate when evidence-first flag is on", async () => {
    mockSchedulerConfig.evidenceFirstEnabled = true;
    mockSchedulerConfig.evidenceFirstPlaybooks = ["pb-evidence-first"];
    mockFindUnique.mockResolvedValue({
      jsonValue: { mode: "teach", reason: "", writtenAt: "" },
    });
    const result = await shouldRunCallerAnalysis("caller-1", "pb-legacy");
    expect(result.allow).toBe(false); // mode gate denies teach
    expect(result.mode).toBe("teach");
  });

  it("no playbookId passed → mode gate applies (legacy callers)", async () => {
    mockSchedulerConfig.evidenceFirstEnabled = true;
    mockSchedulerConfig.evidenceFirstPlaybooks = ["pb-evidence-first"];
    mockFindUnique.mockResolvedValue({
      jsonValue: { mode: "practice", reason: "", writtenAt: "" },
    });
    const result = await shouldRunCallerAnalysis("caller-1");
    expect(result.allow).toBe(true);
    expect(result.mode).toBe("practice");
  });
});
