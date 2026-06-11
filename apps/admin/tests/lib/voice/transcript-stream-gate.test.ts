import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { mockLoadResolvedVoiceConfig } = vi.hoisted(() => ({
  mockLoadResolvedVoiceConfig: vi.fn(),
}));

vi.mock("@/lib/voice/load-voice-config", () => ({
  loadResolvedVoiceConfig: mockLoadResolvedVoiceConfig,
}));

import {
  _resetTranscriptGateCache,
  resolveTranscriptStreamEnabled,
} from "@/lib/voice/transcript-stream-gate";

describe("resolveTranscriptStreamEnabled — #1457 Course-layer cascade", () => {
  beforeEach(() => {
    _resetTranscriptGateCache();
    mockLoadResolvedVoiceConfig.mockReset();
  });

  afterEach(() => {
    _resetTranscriptGateCache();
  });

  test("forwards playbookId so the Course layer is queried", async () => {
    mockLoadResolvedVoiceConfig.mockResolvedValue({
      fields: {
        transcriptStreamEnabled: { value: true, source: "course" },
      },
    });

    const result = await resolveTranscriptStreamEnabled({
      callId: "call-1",
      callerId: "caller-1",
      playbookId: "playbook-1",
    });

    expect(result).toBe(true);
    expect(mockLoadResolvedVoiceConfig).toHaveBeenCalledWith({
      callerId: "caller-1",
      playbookId: "playbook-1",
    });
  });

  test("Course-layer false flips gate off even when Caller has no override", async () => {
    mockLoadResolvedVoiceConfig.mockResolvedValue({
      fields: {
        transcriptStreamEnabled: { value: false, source: "course" },
      },
    });

    const result = await resolveTranscriptStreamEnabled({
      callId: "call-2",
      callerId: "caller-2",
      playbookId: "playbook-2",
    });

    expect(result).toBe(false);
  });

  test("Course-layer true is surfaced even when callerId omitted (e.g. anonymous SSE)", async () => {
    mockLoadResolvedVoiceConfig.mockResolvedValue({
      fields: {
        transcriptStreamEnabled: { value: true, source: "course" },
      },
    });

    const result = await resolveTranscriptStreamEnabled({
      callId: "call-3",
      callerId: null,
      playbookId: "playbook-3",
    });

    expect(result).toBe(true);
    expect(mockLoadResolvedVoiceConfig).toHaveBeenCalledWith({
      callerId: undefined,
      playbookId: "playbook-3",
    });
  });

  test("playbookId omitted — preserves pre-#1457 caller-only behaviour", async () => {
    mockLoadResolvedVoiceConfig.mockResolvedValue({
      fields: {
        transcriptStreamEnabled: { value: false, source: "domain" },
      },
    });

    const result = await resolveTranscriptStreamEnabled({
      callId: "call-4",
      callerId: "caller-4",
    });

    expect(result).toBe(false);
    expect(mockLoadResolvedVoiceConfig).toHaveBeenCalledWith({
      callerId: "caller-4",
      playbookId: undefined,
    });
  });

  test("both ids null — defaults to enabled without hitting the cascade", async () => {
    const result = await resolveTranscriptStreamEnabled({
      callId: "call-5",
      callerId: null,
      playbookId: null,
    });

    expect(result).toBe(true);
    expect(mockLoadResolvedVoiceConfig).not.toHaveBeenCalled();
  });

  test("cache TTL — same callId resolves once even when fields change", async () => {
    mockLoadResolvedVoiceConfig.mockResolvedValueOnce({
      fields: {
        transcriptStreamEnabled: { value: true, source: "course" },
      },
    });

    const first = await resolveTranscriptStreamEnabled({
      callId: "call-cache",
      callerId: "caller-cache",
      playbookId: "playbook-cache",
    });

    mockLoadResolvedVoiceConfig.mockResolvedValueOnce({
      fields: {
        transcriptStreamEnabled: { value: false, source: "course" },
      },
    });

    const second = await resolveTranscriptStreamEnabled({
      callId: "call-cache",
      callerId: "caller-cache",
      playbookId: "playbook-cache",
    });

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(mockLoadResolvedVoiceConfig).toHaveBeenCalledTimes(1);
  });

  test("cascade error — fails open (gate enabled) and logs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockLoadResolvedVoiceConfig.mockRejectedValue(new Error("cascade boom"));

    const result = await resolveTranscriptStreamEnabled({
      callId: "call-err",
      callerId: "caller-err",
      playbookId: "playbook-err",
    });

    expect(result).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
