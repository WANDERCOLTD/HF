/**
 * Tests for VAPI adapter sayMessage (#1742 Theme 2a).
 *
 * Pinned acceptance:
 *   1. `extractControlUrl` pulls `monitor.controlUrl` from VAPI's nested
 *      payload shapes (top-level, message-nested, message.call-nested)
 *   2. `sayMessage` returns `{status:"skipped"}` when no controlUrl on
 *      Call.voiceProviderRaw (call created before #1742)
 *   3. `sayMessage` POSTs `{type:"say", content, endCallAfterSpoken:false}`
 *      to the controlUrl when `queueOnly: false`
 *   4. `sayMessage` POSTs `{type:"add-message", message:{role,content},
 *      triggerResponseEnabled:false}` when `queueOnly: true`
 *   5. Returns `{status:"failed"}` on non-2xx response — no throw
 *   6. Returns `{status:"failed"}` on network error — no throw
 *   7. `buildAssistantConfig` adds `monitorPlan.controlEnabled = true` so
 *      VAPI returns the controlUrl on the call response
 *   8. Capability flag `supportsProactiveSpeech: true` is declared
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    call: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logger", () => ({ log: vi.fn() }));

import { VapiProvider, extractControlUrl } from "@/lib/voice/providers/vapi";

const CONTROL_URL = "https://vapi.daily.co/control/abc";

const buildCtx = (overrides: Partial<Record<string, unknown>> = {}) =>
  ({
    voicePrompt: "Be helpful.",
    serverUrlBase: "https://hf-dev.example/api/voice/vapi",
    customLlmSecret: undefined,
    toolDefinitions: [],
    modelConfig: { provider: "anthropic", model: "claude-sonnet-4-6" },
    firstLine: undefined,
    knowledgePlanEnabled: false,
    costSafetyKnobs: null,
    voiceConfig: undefined,
    ...overrides,
  }) as Parameters<VapiProvider["buildAssistantConfig"]>[0];

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.call.findFirst.mockReset();
});

describe("extractControlUrl", () => {
  it("returns null for non-objects / empty inputs", () => {
    expect(extractControlUrl(null)).toBeNull();
    expect(extractControlUrl(undefined)).toBeNull();
    expect(extractControlUrl({})).toBeNull();
    expect(extractControlUrl("not an object")).toBeNull();
  });

  it("reads top-level monitor.controlUrl (POST /call response shape)", () => {
    const payload = { monitor: { controlUrl: CONTROL_URL } };
    expect(extractControlUrl(payload)).toBe(CONTROL_URL);
  });

  it("reads message.monitor.controlUrl (webhook envelope variant)", () => {
    const payload = { message: { monitor: { controlUrl: CONTROL_URL } } };
    expect(extractControlUrl(payload)).toBe(CONTROL_URL);
  });

  it("reads message.call.monitor.controlUrl (nested-call webhook variant)", () => {
    const payload = { message: { call: { monitor: { controlUrl: CONTROL_URL } } } };
    expect(extractControlUrl(payload)).toBe(CONTROL_URL);
  });

  it("reads call.monitor.controlUrl (root-call shape)", () => {
    const payload = { call: { monitor: { controlUrl: CONTROL_URL } } };
    expect(extractControlUrl(payload)).toBe(CONTROL_URL);
  });

  it("returns null when monitor exists but controlUrl is absent (pre-#1742 call)", () => {
    const payload = { monitor: { listenUrl: "wss://..." } };
    expect(extractControlUrl(payload)).toBeNull();
  });
});

describe("VapiProvider — capabilities + buildAssistantConfig", () => {
  it("declares supportsProactiveSpeech: true", () => {
    const provider = new VapiProvider({}, {});
    expect(provider.getCapabilities().supportsProactiveSpeech).toBe(true);
  });

  it("sets assistant.monitorPlan.controlEnabled = true on every call", () => {
    const provider = new VapiProvider({}, {});
    const config = provider.buildAssistantConfig(buildCtx()) as {
      assistant: { monitorPlan?: { controlEnabled?: boolean; listenEnabled?: boolean } };
    };
    expect(config.assistant.monitorPlan?.controlEnabled).toBe(true);
    expect(config.assistant.monitorPlan?.listenEnabled).toBe(false);
  });
});

describe("VapiProvider.sayMessage", () => {
  let provider: VapiProvider;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new VapiProvider({}, {});
    fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
  });

  it("returns {status:'skipped'} when no Call row exists for the externalCallId", async () => {
    mockPrisma.call.findFirst.mockResolvedValue(null);
    const result = await provider.sayMessage("ext-1", { content: "hi" });
    expect(result).toEqual({ status: "skipped" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns {status:'skipped'} when voiceProviderRaw has no monitor.controlUrl (pre-#1742)", async () => {
    mockPrisma.call.findFirst.mockResolvedValue({ voiceProviderRaw: { call: { id: "ext-1" } } });
    const result = await provider.sayMessage("ext-1", { content: "hi" });
    expect(result).toEqual({ status: "skipped" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs {type:'say', content, endCallAfterSpoken:false} when queueOnly false", async () => {
    mockPrisma.call.findFirst.mockResolvedValue({
      voiceProviderRaw: { monitor: { controlUrl: CONTROL_URL } },
    });
    fetchSpy.mockResolvedValue({ ok: true, status: 200 } as Response);

    const result = await provider.sayMessage("ext-1", { content: "fifteen seconds left" });

    expect(result).toEqual({ status: "spoken" });
    expect(fetchSpy).toHaveBeenCalledWith(
      CONTROL_URL,
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(sentBody).toEqual({
      type: "say",
      content: "fifteen seconds left",
      endCallAfterSpoken: false,
    });
  });

  it("POSTs {type:'add-message', …} when queueOnly true", async () => {
    mockPrisma.call.findFirst.mockResolvedValue({
      voiceProviderRaw: { monitor: { controlUrl: CONTROL_URL } },
    });
    fetchSpy.mockResolvedValue({ ok: true, status: 200 } as Response);

    const result = await provider.sayMessage("ext-1", {
      content: "Note for next turn",
      queueOnly: true,
    });

    expect(result).toEqual({ status: "queued" });
    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(sentBody).toEqual({
      type: "add-message",
      message: { role: "assistant", content: "Note for next turn" },
      triggerResponseEnabled: false,
    });
  });

  it("returns {status:'failed'} on non-2xx response — no throw", async () => {
    mockPrisma.call.findFirst.mockResolvedValue({
      voiceProviderRaw: { monitor: { controlUrl: CONTROL_URL } },
    });
    fetchSpy.mockResolvedValue({ ok: false, status: 503 } as Response);

    const result = await provider.sayMessage("ext-1", { content: "hi" });
    expect(result).toEqual({ status: "failed" });
  });

  it("returns {status:'failed'} on fetch network error — no throw", async () => {
    mockPrisma.call.findFirst.mockResolvedValue({
      voiceProviderRaw: { monitor: { controlUrl: CONTROL_URL } },
    });
    fetchSpy.mockRejectedValue(new Error("network down"));

    const result = await provider.sayMessage("ext-1", { content: "hi" });
    expect(result).toEqual({ status: "failed" });
  });
});
