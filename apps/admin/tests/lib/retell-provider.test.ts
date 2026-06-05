/**
 * Tests for RetellProvider (AnyVoice #1079).
 *
 * Validates the split end-of-call normalisation contract: `call_ended`
 * → eventKind "basic" with no analysis fields; `call_analyzed` →
 * eventKind "analysis" with analysis fields populated. Plus capability
 * declaration matches the routing contract the webhook route relies on.
 */

import { describe, it, expect } from "vitest";
import { RetellProvider } from "@/lib/voice/providers/retell";

describe("RetellProvider — capabilities", () => {
  it("declares split end-of-call + WSS tools + no knowledge callback", () => {
    const p = new RetellProvider({}, {});
    const caps = p.getCapabilities();
    expect(caps.endOfCallEvents).toBe("split");
    expect(caps.toolCallsOverWebSocket).toBe(true);
    expect(caps.hasKnowledgeCallback).toBe(false);
    expect(caps.supportsRequestEndCall).toBe(true);
  });

  it("declares a config schema covering apiKey, webhookSecret, agentId, voiceId", () => {
    const p = new RetellProvider({}, {});
    const schema = p.getConfigSchema();
    const keys = schema.fields.map((f) => f.key);
    expect(keys).toContain("apiKey");
    expect(keys).toContain("webhookSecret");
    expect(keys).toContain("agentId");
    expect(keys).toContain("voiceId");
    const apiKey = schema.fields.find((f) => f.key === "apiKey");
    expect(apiKey?.sensitive).toBe(true);
  });
});

describe("RetellProvider.normaliseEndOfCallEvent — split events", () => {
  it("returns null for non-end events", () => {
    const p = new RetellProvider({}, {});
    expect(p.normaliseEndOfCallEvent({ event: "call_started" })).toBeNull();
    expect(p.normaliseEndOfCallEvent({})).toBeNull();
    expect(p.normaliseEndOfCallEvent(null)).toBeNull();
  });

  it("call_ended → eventKind 'basic' with basic capture, no analysis fields", () => {
    const p = new RetellProvider({}, {});
    const body = {
      event: "call_ended",
      call: {
        call_id: "ret_abc123",
        from_number: "+441234567890",
        transcript: "Hello world",
        recording_url: "https://recordings.example/abc",
        disconnect_reason: "user_hangup",
        start_timestamp: 1717000000000,
        end_timestamp: 1717000180000,
      },
    };
    const evt = p.normaliseEndOfCallEvent(body);
    expect(evt).not.toBeNull();
    expect(evt!.eventKind).toBe("basic");
    expect(evt!.externalCallId).toBe("ret_abc123");
    expect(evt!.customerPhone).toBe("+441234567890");
    expect(evt!.transcript).toBe("Hello world");
    expect(evt!.capture.recordingUrl).toBe("https://recordings.example/abc");
    expect(evt!.capture.endedReason).toBe("user_hangup");
    expect(evt!.capture.durationSeconds).toBe(180);
    // Analysis fields MUST be absent on a basic event
    expect(evt!.capture.analysisSummary).toBeUndefined();
    expect(evt!.capture.structuredData).toBeUndefined();
    expect(evt!.capture.successEvaluation).toBeUndefined();
  });

  it("call_analyzed → eventKind 'analysis' with analysis fields populated", () => {
    const p = new RetellProvider({}, {});
    const body = {
      event: "call_analyzed",
      call: {
        call_id: "ret_abc123",
        call_analysis: {
          call_summary: "Caller asked about pricing.",
          custom_analysis_data: { sentiment: "positive" },
          call_successful: true,
        },
      },
    };
    const evt = p.normaliseEndOfCallEvent(body);
    expect(evt).not.toBeNull();
    expect(evt!.eventKind).toBe("analysis");
    expect(evt!.externalCallId).toBe("ret_abc123");
    expect(evt!.capture.analysisSummary).toBe("Caller asked about pricing.");
    expect(evt!.capture.structuredData).toEqual({ sentiment: "positive" });
    expect(evt!.capture.successEvaluation).toBe("true");
  });

  it("rejects events with no call_id", () => {
    const p = new RetellProvider({}, {});
    expect(
      p.normaliseEndOfCallEvent({ event: "call_ended", call: {} }),
    ).toBeNull();
  });
});

describe("RetellProvider.normaliseToolCallList — HTTP path is a no-op for WSS providers", () => {
  it("always returns an empty batch", () => {
    const p = new RetellProvider({}, {});
    const batch = p.normaliseToolCallList({ any: "payload" });
    expect(batch.toolCalls).toEqual([]);
    expect(batch.customerPhone).toBeNull();
  });
});

describe("RetellProvider.parseKnowledgeBaseRequest — returns null (no HTTP callback)", () => {
  it("returns null for any body", () => {
    const p = new RetellProvider({}, {});
    expect(p.parseKnowledgeBaseRequest({ messages: [] })).toBeNull();
  });
});

describe("RetellProvider.buildKnowledgeResponse — throws if invoked", () => {
  it("throws (capability guard should prevent this being called)", () => {
    const p = new RetellProvider({}, {});
    expect(() => p.buildKnowledgeResponse([])).toThrow(
      /no HTTP knowledge callback/i,
    );
  });
});
