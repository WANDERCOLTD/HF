/**
 * #599 Slice 1 — priorCallFeedback synthesis gate tests.
 *
 * Covers the wrap-around-the-templated-path that turns a brief AI-synthesized
 * recap on when every safety gate passes. The templated path itself is
 * covered by `prior-call-feedback.test.ts` (#492 Slice 3.5).
 *
 * Mocks `synthesizePriorCallRecap` directly so the gates can be exercised
 * without any real AI plumbing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/prompt/composition/loaders/synthesizePriorCallRecap", () => ({
  synthesizePriorCallRecap: vi.fn(async (input: {
    feedback: { weakestParameterName: string | null };
    depth: string;
    callerName?: string | null;
  }) => ({
    text: `synth(${input.depth}):${input.feedback.weakestParameterName ?? "no-weak"}:${input.callerName ?? "anon"}`,
    tokensUsed: 42,
    latencyMs: 17,
  })),
  RICH_TRANSCRIPT_SLICE_LIMIT: 6000,
}));

import { loadPriorCallFeedback } from "@/lib/prompt/composition/loaders/priorCallFeedback";
import { synthesizePriorCallRecap } from "@/lib/prompt/composition/loaders/synthesizePriorCallRecap";
import type { PlaybookConfig } from "@/lib/types/json-fields";

const synthMock = synthesizePriorCallRecap as unknown as ReturnType<typeof vi.fn>;

const NOW = new Date("2026-05-26T10:00:00Z");
const PRIOR_CALL_AT = new Date("2026-05-25T09:00:00Z");
const PLAYBOOK_ID = "pb-1";
const CALLER_ID = "caller-1";
const MODULE_ID = "mod-1";
const CURRENT_CALL_ID = "call-current";
const PRIOR_CALL_ID = "call-prior";

interface StubOptions {
  allowlist?: string | null; // JSON string, or null = row absent
  usageEventsToday?: Array<Record<string, unknown>>;
  cachedRecap?: { depth: string; text: string; cachedAt: string } | null;
  callerName?: string | null;
  transcript?: string | null;
}

function makePrismaStub(stub: StubOptions = {}) {
  const auditWrites: Array<Record<string, unknown>> = [];
  return {
    auditWrites,
    call: {
      findFirst: vi.fn(async () => ({ id: PRIOR_CALL_ID, createdAt: PRIOR_CALL_AT })),
      findUnique: vi.fn(async () => (stub.transcript !== undefined ? { transcript: stub.transcript } : null)),
    },
    callScore: {
      findMany: vi.fn(async () => [
        { score: 0.55, moduleId: MODULE_ID, parameterId: "skill_fluency", parameter: { name: "Fluency", parameterId: "skill_fluency" } },
        { score: 0.72, moduleId: MODULE_ID, parameterId: "skill_grammar", parameter: { name: "Grammar", parameterId: "skill_grammar" } },
      ]),
    },
    systemSetting: {
      findUnique: vi.fn(async () =>
        stub.allowlist === null || stub.allowlist === undefined ? null : { value: stub.allowlist },
      ),
    },
    usageEvent: {
      findMany: vi.fn(async () => stub.usageEventsToday ?? []),
    },
    composedPrompt: {
      findFirst: vi.fn(async () =>
        stub.cachedRecap ? { recapSynthesisCache: stub.cachedRecap } : null,
      ),
    },
    auditLog: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        auditWrites.push(data);
        return data;
      }),
    },
    caller: {
      findUnique: vi.fn(async () => (stub.callerName !== undefined ? { name: stub.callerName } : null)),
    },
  } as unknown as Parameters<typeof loadPriorCallFeedback>[0] & {
    auditWrites: Array<Record<string, unknown>>;
    systemSetting: { findUnique: ReturnType<typeof vi.fn> };
  };
}

function withRecap(
  recap: NonNullable<PlaybookConfig["priorCallRecap"]>,
): PlaybookConfig {
  return { priorCallRecap: recap } as PlaybookConfig;
}

beforeEach(() => {
  synthMock.mockClear();
});

afterEach(() => {
  delete process.env.PRIOR_CALL_RECAP_SYNTHESIS_ENABLED;
});

describe("priorCallFeedback synthesis — kill-switch gate", () => {
  it("env var absent → no synth, no AI call, no audit row", async () => {
    const prisma = makePrismaStub({ allowlist: JSON.stringify([PLAYBOOK_ID]) });
    const result = await loadPriorCallFeedback(prisma, {
      callerId: CALLER_ID,
      moduleId: MODULE_ID,
      currentCallId: CURRENT_CALL_ID,
      now: NOW,
      playbookId: PLAYBOOK_ID,
      playbookConfig: withRecap({ enabled: true, depth: "standard" }),
    });
    expect(result.hasFeedback).toBe(true);
    expect(result.synthesizedRecap).toBeNull();
    expect(synthMock).not.toHaveBeenCalled();
    expect(prisma.auditWrites).toHaveLength(0);
  });

  it("env var === 'false' (string) → still no synth", async () => {
    process.env.PRIOR_CALL_RECAP_SYNTHESIS_ENABLED = "false";
    const prisma = makePrismaStub({ allowlist: JSON.stringify([PLAYBOOK_ID]) });
    const result = await loadPriorCallFeedback(prisma, {
      callerId: CALLER_ID,
      moduleId: MODULE_ID,
      currentCallId: CURRENT_CALL_ID,
      now: NOW,
      playbookId: PLAYBOOK_ID,
      playbookConfig: withRecap({ enabled: true, depth: "standard" }),
    });
    expect(result.synthesizedRecap).toBeNull();
    expect(synthMock).not.toHaveBeenCalled();
  });
});

describe("priorCallFeedback synthesis — enabled flag", () => {
  it("enabled: false → no synth even with env var on and allowlist match", async () => {
    process.env.PRIOR_CALL_RECAP_SYNTHESIS_ENABLED = "true";
    const prisma = makePrismaStub({ allowlist: JSON.stringify([PLAYBOOK_ID]) });
    const result = await loadPriorCallFeedback(prisma, {
      callerId: CALLER_ID,
      moduleId: MODULE_ID,
      currentCallId: CURRENT_CALL_ID,
      now: NOW,
      playbookId: PLAYBOOK_ID,
      playbookConfig: withRecap({ enabled: false, depth: "standard" }),
    });
    expect(result.synthesizedRecap).toBeNull();
    expect(synthMock).not.toHaveBeenCalled();
  });

  it("missing priorCallRecap block → no synth (default off)", async () => {
    process.env.PRIOR_CALL_RECAP_SYNTHESIS_ENABLED = "true";
    const prisma = makePrismaStub({ allowlist: JSON.stringify([PLAYBOOK_ID]) });
    const result = await loadPriorCallFeedback(prisma, {
      callerId: CALLER_ID,
      moduleId: MODULE_ID,
      currentCallId: CURRENT_CALL_ID,
      now: NOW,
      playbookId: PLAYBOOK_ID,
      playbookConfig: {} as PlaybookConfig,
    });
    expect(result.synthesizedRecap).toBeNull();
    expect(synthMock).not.toHaveBeenCalled();
  });
});

describe("priorCallFeedback synthesis — depth dispatch", () => {
  beforeEach(() => {
    process.env.PRIOR_CALL_RECAP_SYNTHESIS_ENABLED = "true";
  });

  it("depth: minimal → no AI call, no allowlist query, no audit row", async () => {
    const prisma = makePrismaStub({ allowlist: JSON.stringify([PLAYBOOK_ID]) });
    const result = await loadPriorCallFeedback(prisma, {
      callerId: CALLER_ID,
      moduleId: MODULE_ID,
      currentCallId: CURRENT_CALL_ID,
      now: NOW,
      playbookId: PLAYBOOK_ID,
      playbookConfig: withRecap({ enabled: true, depth: "minimal" }),
    });
    expect(result.synthesizedRecap).toBeNull();
    expect(synthMock).not.toHaveBeenCalled();
    expect(prisma.systemSetting.findUnique).not.toHaveBeenCalled();
  });

  it("depth absent on enabled: true → defaults to minimal (no AI)", async () => {
    const prisma = makePrismaStub({ allowlist: JSON.stringify([PLAYBOOK_ID]) });
    const result = await loadPriorCallFeedback(prisma, {
      callerId: CALLER_ID,
      moduleId: MODULE_ID,
      currentCallId: CURRENT_CALL_ID,
      now: NOW,
      playbookId: PLAYBOOK_ID,
      playbookConfig: withRecap({ enabled: true }),
    });
    expect(result.synthesizedRecap).toBeNull();
    expect(synthMock).not.toHaveBeenCalled();
  });
});

describe("priorCallFeedback synthesis — allowlist gate", () => {
  beforeEach(() => {
    process.env.PRIOR_CALL_RECAP_SYNTHESIS_ENABLED = "true";
  });

  it("SystemSetting row absent → blocked, audit row 'row-absent' once per day", async () => {
    const prisma = makePrismaStub({ allowlist: null });
    const result = await loadPriorCallFeedback(prisma, {
      callerId: CALLER_ID,
      moduleId: MODULE_ID,
      currentCallId: CURRENT_CALL_ID,
      now: NOW,
      playbookId: PLAYBOOK_ID,
      playbookConfig: withRecap({ enabled: true, depth: "standard" }),
    });
    expect(result.synthesizedRecap).toBeNull();
    expect(synthMock).not.toHaveBeenCalled();
    expect(prisma.auditWrites).toHaveLength(1);
    expect(prisma.auditWrites[0]).toMatchObject({
      action: "prior-call-recap-allowlist-empty",
      entityType: "Playbook",
      entityId: PLAYBOOK_ID,
    });
    expect((prisma.auditWrites[0].metadata as { cause: string }).cause).toBe("row-absent");
  });

  it("empty array → blocked with cause 'empty-array'", async () => {
    const prisma = makePrismaStub({ allowlist: "[]" });
    const result = await loadPriorCallFeedback(prisma, {
      callerId: CALLER_ID,
      moduleId: MODULE_ID,
      currentCallId: CURRENT_CALL_ID,
      now: NOW,
      playbookId: PLAYBOOK_ID,
      playbookConfig: withRecap({ enabled: true, depth: "standard" }),
    });
    expect(result.synthesizedRecap).toBeNull();
    expect(prisma.auditWrites[0]).toMatchObject({ action: "prior-call-recap-allowlist-empty" });
    expect((prisma.auditWrites[0].metadata as { cause: string }).cause).toBe("empty-array");
  });

  it("non-empty allowlist without playbookId → blocked, no audit row needed", async () => {
    const prisma = makePrismaStub({ allowlist: JSON.stringify(["other-pb"]) });
    const result = await loadPriorCallFeedback(prisma, {
      callerId: CALLER_ID,
      moduleId: MODULE_ID,
      currentCallId: CURRENT_CALL_ID,
      now: NOW,
      playbookId: PLAYBOOK_ID,
      playbookConfig: withRecap({ enabled: true, depth: "standard" }),
    });
    expect(result.synthesizedRecap).toBeNull();
    expect(synthMock).not.toHaveBeenCalled();
  });

  it("playbookId present in allowlist → proceeds to synth", async () => {
    const prisma = makePrismaStub({ allowlist: JSON.stringify([PLAYBOOK_ID]) });
    const result = await loadPriorCallFeedback(prisma, {
      callerId: CALLER_ID,
      moduleId: MODULE_ID,
      currentCallId: CURRENT_CALL_ID,
      now: NOW,
      playbookId: PLAYBOOK_ID,
      playbookConfig: withRecap({ enabled: true, depth: "standard" }),
    });
    expect(synthMock).toHaveBeenCalledTimes(1);
    expect(result.synthesizedRecap?.text).toContain("synth(standard)");
    expect(result.synthesizedRecap?.cachedHit).toBe(false);
  });
});

describe("priorCallFeedback synthesis — daily cap", () => {
  beforeEach(() => {
    process.env.PRIOR_CALL_RECAP_SYNTHESIS_ENABLED = "true";
  });

  it("over cap → blocked + audit 'prior-call-recap-cap-exceeded'", async () => {
    const usage = Array.from({ length: 50 }, () => ({ metadata: { playbookId: PLAYBOOK_ID } }));
    const prisma = makePrismaStub({
      allowlist: JSON.stringify([PLAYBOOK_ID]),
      usageEventsToday: usage,
    });
    const result = await loadPriorCallFeedback(prisma, {
      callerId: CALLER_ID,
      moduleId: MODULE_ID,
      currentCallId: CURRENT_CALL_ID,
      now: NOW,
      playbookId: PLAYBOOK_ID,
      playbookConfig: withRecap({ enabled: true, depth: "standard" }),
    });
    expect(result.synthesizedRecap).toBeNull();
    expect(synthMock).not.toHaveBeenCalled();
    expect(prisma.auditWrites[0]).toMatchObject({ action: "prior-call-recap-cap-exceeded" });
  });

  it("under cap → proceeds; metadata-filtered count ignores other playbooks", async () => {
    const usage = [
      ...Array.from({ length: 49 }, () => ({ metadata: { playbookId: PLAYBOOK_ID } })),
      ...Array.from({ length: 999 }, () => ({ metadata: { playbookId: "other" } })),
    ];
    const prisma = makePrismaStub({
      allowlist: JSON.stringify([PLAYBOOK_ID]),
      usageEventsToday: usage,
    });
    const result = await loadPriorCallFeedback(prisma, {
      callerId: CALLER_ID,
      moduleId: MODULE_ID,
      currentCallId: CURRENT_CALL_ID,
      now: NOW,
      playbookId: PLAYBOOK_ID,
      playbookConfig: withRecap({ enabled: true, depth: "standard" }),
    });
    expect(synthMock).toHaveBeenCalledTimes(1);
    expect(result.synthesizedRecap?.cachedHit).toBe(false);
  });

  it("custom dailyCap honoured", async () => {
    const usage = Array.from({ length: 3 }, () => ({ metadata: { playbookId: PLAYBOOK_ID } }));
    const prisma = makePrismaStub({
      allowlist: JSON.stringify([PLAYBOOK_ID]),
      usageEventsToday: usage,
    });
    const result = await loadPriorCallFeedback(prisma, {
      callerId: CALLER_ID,
      moduleId: MODULE_ID,
      currentCallId: CURRENT_CALL_ID,
      now: NOW,
      playbookId: PLAYBOOK_ID,
      playbookConfig: withRecap({ enabled: true, depth: "standard", dailyCap: 3 }),
    });
    expect(result.synthesizedRecap).toBeNull();
    expect(prisma.auditWrites[0]).toMatchObject({ action: "prior-call-recap-cap-exceeded" });
  });
});

describe("priorCallFeedback synthesis — cache layer", () => {
  beforeEach(() => {
    process.env.PRIOR_CALL_RECAP_SYNTHESIS_ENABLED = "true";
  });

  it("cache hit on matching depth → returns cached text, no AI call", async () => {
    const prisma = makePrismaStub({
      allowlist: JSON.stringify([PLAYBOOK_ID]),
      cachedRecap: { depth: "standard", text: "cached recap text", cachedAt: "2026-05-26T09:00:00Z" },
    });
    const result = await loadPriorCallFeedback(prisma, {
      callerId: CALLER_ID,
      moduleId: MODULE_ID,
      currentCallId: CURRENT_CALL_ID,
      now: NOW,
      playbookId: PLAYBOOK_ID,
      playbookConfig: withRecap({ enabled: true, depth: "standard" }),
    });
    expect(synthMock).not.toHaveBeenCalled();
    expect(result.synthesizedRecap?.cachedHit).toBe(true);
    expect(result.synthesizedRecap?.text).toBe("cached recap text");
    // No audit row on cache hit
    expect(prisma.auditWrites).toHaveLength(0);
  });

  it("cache exists at wrong depth → MISS, synth runs again", async () => {
    const prisma = makePrismaStub({
      allowlist: JSON.stringify([PLAYBOOK_ID]),
      cachedRecap: { depth: "minimal", text: "stale", cachedAt: "2026-05-26T08:00:00Z" },
    });
    const result = await loadPriorCallFeedback(prisma, {
      callerId: CALLER_ID,
      moduleId: MODULE_ID,
      currentCallId: CURRENT_CALL_ID,
      now: NOW,
      playbookId: PLAYBOOK_ID,
      playbookConfig: withRecap({ enabled: true, depth: "standard" }),
    });
    expect(synthMock).toHaveBeenCalledTimes(1);
    expect(result.synthesizedRecap?.cachedHit).toBe(false);
  });
});

describe("priorCallFeedback synthesis — audit log on success", () => {
  beforeEach(() => {
    process.env.PRIOR_CALL_RECAP_SYNTHESIS_ENABLED = "true";
  });

  it("writes 'prior-call-recap-synthesized' with telemetry metadata", async () => {
    const prisma = makePrismaStub({
      allowlist: JSON.stringify([PLAYBOOK_ID]),
      callerName: "Aria Test",
    });
    await loadPriorCallFeedback(prisma, {
      callerId: CALLER_ID,
      moduleId: MODULE_ID,
      currentCallId: CURRENT_CALL_ID,
      now: NOW,
      playbookId: PLAYBOOK_ID,
      playbookConfig: withRecap({ enabled: true, depth: "standard" }),
    });
    expect(prisma.auditWrites).toHaveLength(1);
    const row = prisma.auditWrites[0];
    expect(row.action).toBe("prior-call-recap-synthesized");
    expect(row.entityType).toBe("Call");
    expect(row.entityId).toBe(CURRENT_CALL_ID);
    expect(row.metadata).toMatchObject({
      depth: "standard",
      playbookId: PLAYBOOK_ID,
      cachedHit: false,
      tokensUsed: 42,
      latencyMs: 17,
    });
    expect((row.metadata as { outputText: string }).outputText).toContain("synth(standard)");
  });

  it("rich depth passes transcript slice; caller's first name extracted", async () => {
    const longTranscript = "x".repeat(8000);
    const prisma = makePrismaStub({
      allowlist: JSON.stringify([PLAYBOOK_ID]),
      callerName: "Bryn Test-User",
      transcript: longTranscript,
    });
    await loadPriorCallFeedback(prisma, {
      callerId: CALLER_ID,
      moduleId: MODULE_ID,
      currentCallId: CURRENT_CALL_ID,
      now: NOW,
      playbookId: PLAYBOOK_ID,
      playbookConfig: withRecap({ enabled: true, depth: "rich" }),
    });
    expect(synthMock).toHaveBeenCalledTimes(1);
    const callArgs = synthMock.mock.calls[0][0] as {
      depth: string;
      callerName: string;
      transcript: string;
    };
    expect(callArgs.depth).toBe("rich");
    expect(callArgs.callerName).toBe("Bryn");
    expect(callArgs.transcript).toBeTruthy();
    expect(callArgs.transcript.length).toBeLessThanOrEqual(6000);
  });
});

describe("priorCallFeedback synthesis — no playbook context", () => {
  beforeEach(() => {
    process.env.PRIOR_CALL_RECAP_SYNTHESIS_ENABLED = "true";
  });

  it("playbookId omitted → falls through to templated path", async () => {
    const prisma = makePrismaStub({ allowlist: JSON.stringify([PLAYBOOK_ID]) });
    const result = await loadPriorCallFeedback(prisma, {
      callerId: CALLER_ID,
      moduleId: MODULE_ID,
      currentCallId: CURRENT_CALL_ID,
      now: NOW,
      // intentionally no playbookId
      playbookConfig: withRecap({ enabled: true, depth: "standard" }),
    });
    expect(result.hasFeedback).toBe(true);
    expect(result.synthesizedRecap).toBeNull();
    expect(synthMock).not.toHaveBeenCalled();
  });

  it("playbookConfig omitted → templated path; no DB lookups for synth gates", async () => {
    const prisma = makePrismaStub({ allowlist: JSON.stringify([PLAYBOOK_ID]) });
    const result = await loadPriorCallFeedback(prisma, {
      callerId: CALLER_ID,
      moduleId: MODULE_ID,
      currentCallId: CURRENT_CALL_ID,
      now: NOW,
      playbookId: PLAYBOOK_ID,
    });
    expect(result.synthesizedRecap).toBeNull();
    expect(prisma.systemSetting.findUnique).not.toHaveBeenCalled();
  });
});
