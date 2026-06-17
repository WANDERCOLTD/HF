/**
 * #1743 (epic #1700 Theme 2b) — register-module-cues helper.
 *
 * Pinned acceptance:
 *   1. flag-off returns `flag_off` reason, writes nothing
 *   2. missing externalCallId returns `no_external_call_id`
 *   3. missing playbookId / moduleSlug returns `no_playbook`
 *   4. existing cue row for the same externalCallId short-circuits with
 *      `already_registered` (idempotence — webhook re-delivery safe)
 *   5. module slug not in Playbook.config.modules returns `no_module_match`
 *   6. module without scheduledCues returns `no_cues`
 *   7. each valid cue persisted via scheduleCue with scheduledFor =
 *      startedAt + at*1000
 *   8. malformed entries (non-finite `at`, blank `text`) are skipped
 *      without aborting siblings
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, mockScheduleCue } = vi.hoisted(() => ({
  mockPrisma: {
    cueScheduleEntry: {
      findFirst: vi.fn(),
    },
    playbook: {
      findUnique: vi.fn(),
    },
  },
  mockScheduleCue: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logger", () => ({ log: vi.fn() }));
vi.mock("@/lib/voice/cue-scheduler", () => ({
  scheduleCue: mockScheduleCue,
}));

import { registerModuleScheduledCues } from "@/lib/voice/register-module-cues";

const NOW = new Date("2026-06-17T12:00:00Z");

function withModuleSettings(scheduledCues: unknown): {
  config: { modules: Array<{ id: string; settings?: { scheduledCues?: unknown } }> };
} {
  return {
    config: {
      modules: [
        {
          id: "part2",
          settings: scheduledCues === undefined ? {} : { scheduledCues },
        },
      ],
    },
  };
}

describe("registerModuleScheduledCues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.HF_FLAG_IELTS_MODULE_SETTINGS;
  });

  it("(1) flag-off returns flag_off and writes nothing", async () => {
    const result = await registerModuleScheduledCues({
      externalCallId: "vapi-x",
      callId: "hf-x",
      playbookId: "pb-1",
      moduleSlug: "part2",
      startedAt: NOW,
    });
    expect(result).toEqual({ registered: 0, reason: "flag_off" });
    expect(mockScheduleCue).not.toHaveBeenCalled();
    expect(mockPrisma.cueScheduleEntry.findFirst).not.toHaveBeenCalled();
  });

  it("(2) missing externalCallId returns no_external_call_id", async () => {
    process.env.HF_FLAG_IELTS_MODULE_SETTINGS = "true";
    const result = await registerModuleScheduledCues({
      externalCallId: "",
      callId: "hf-x",
      playbookId: "pb-1",
      moduleSlug: "part2",
      startedAt: NOW,
    });
    expect(result.reason).toBe("no_external_call_id");
    expect(mockScheduleCue).not.toHaveBeenCalled();
  });

  it("(3) missing playbookId returns no_playbook", async () => {
    process.env.HF_FLAG_IELTS_MODULE_SETTINGS = "true";
    const result = await registerModuleScheduledCues({
      externalCallId: "vapi-x",
      callId: "hf-x",
      playbookId: null,
      moduleSlug: "part2",
      startedAt: NOW,
    });
    expect(result.reason).toBe("no_playbook");
    expect(mockScheduleCue).not.toHaveBeenCalled();
  });

  it("(4) existing cue row short-circuits with already_registered", async () => {
    process.env.HF_FLAG_IELTS_MODULE_SETTINGS = "true";
    mockPrisma.cueScheduleEntry.findFirst.mockResolvedValue({ id: "existing-1" });
    const result = await registerModuleScheduledCues({
      externalCallId: "vapi-x",
      callId: "hf-x",
      playbookId: "pb-1",
      moduleSlug: "part2",
      startedAt: NOW,
    });
    expect(result.reason).toBe("already_registered");
    expect(result.registered).toBe(0);
    expect(mockScheduleCue).not.toHaveBeenCalled();
    expect(mockPrisma.playbook.findUnique).not.toHaveBeenCalled();
  });

  it("(5) module slug not found returns no_module_match", async () => {
    process.env.HF_FLAG_IELTS_MODULE_SETTINGS = "true";
    mockPrisma.cueScheduleEntry.findFirst.mockResolvedValue(null);
    mockPrisma.playbook.findUnique.mockResolvedValue(withModuleSettings([{ at: 45, text: "x" }]));
    const result = await registerModuleScheduledCues({
      externalCallId: "vapi-x",
      callId: "hf-x",
      playbookId: "pb-1",
      moduleSlug: "part-DOES-NOT-EXIST",
      startedAt: NOW,
    });
    expect(result.reason).toBe("no_module_match");
    expect(mockScheduleCue).not.toHaveBeenCalled();
  });

  it("(6) module without scheduledCues returns no_cues", async () => {
    process.env.HF_FLAG_IELTS_MODULE_SETTINGS = "true";
    mockPrisma.cueScheduleEntry.findFirst.mockResolvedValue(null);
    mockPrisma.playbook.findUnique.mockResolvedValue(withModuleSettings(undefined));
    const result = await registerModuleScheduledCues({
      externalCallId: "vapi-x",
      callId: "hf-x",
      playbookId: "pb-1",
      moduleSlug: "part2",
      startedAt: NOW,
    });
    expect(result.reason).toBe("no_cues");
    expect(mockScheduleCue).not.toHaveBeenCalled();
  });

  it("(7) each cue persisted with scheduledFor = startedAt + at*1000", async () => {
    process.env.HF_FLAG_IELTS_MODULE_SETTINGS = "true";
    mockPrisma.cueScheduleEntry.findFirst.mockResolvedValue(null);
    mockPrisma.playbook.findUnique.mockResolvedValue(
      withModuleSettings([
        { at: 45, text: "15 seconds left" },
        { at: 60, text: "Begin now" },
      ]),
    );
    mockScheduleCue.mockResolvedValue({});
    const result = await registerModuleScheduledCues({
      externalCallId: "vapi-x",
      callId: "hf-x",
      playbookId: "pb-1",
      moduleSlug: "part2",
      startedAt: NOW,
    });
    expect(result.registered).toBe(2);
    expect(result.reason).toBeUndefined();
    expect(mockScheduleCue).toHaveBeenCalledTimes(2);
    expect(mockScheduleCue).toHaveBeenNthCalledWith(1, {
      externalCallId: "vapi-x",
      callId: "hf-x",
      scheduledFor: new Date(NOW.getTime() + 45_000),
      content: "15 seconds left",
    });
    expect(mockScheduleCue).toHaveBeenNthCalledWith(2, {
      externalCallId: "vapi-x",
      callId: "hf-x",
      scheduledFor: new Date(NOW.getTime() + 60_000),
      content: "Begin now",
    });
  });

  it("(8) malformed entries skipped without aborting siblings", async () => {
    process.env.HF_FLAG_IELTS_MODULE_SETTINGS = "true";
    mockPrisma.cueScheduleEntry.findFirst.mockResolvedValue(null);
    mockPrisma.playbook.findUnique.mockResolvedValue(
      withModuleSettings([
        { at: 30, text: "" }, // blank text — skipped
        { at: -5, text: "negative at" }, // negative at — skipped
        { at: 45, text: "good cue" }, // kept
        { at: Number.NaN, text: "nan at" }, // skipped
      ]),
    );
    mockScheduleCue.mockResolvedValue({});
    const result = await registerModuleScheduledCues({
      externalCallId: "vapi-x",
      callId: "hf-x",
      playbookId: "pb-1",
      moduleSlug: "part2",
      startedAt: NOW,
    });
    expect(result.registered).toBe(1);
    expect(mockScheduleCue).toHaveBeenCalledTimes(1);
    expect(mockScheduleCue).toHaveBeenCalledWith(
      expect.objectContaining({ content: "good cue" }),
    );
  });
});
