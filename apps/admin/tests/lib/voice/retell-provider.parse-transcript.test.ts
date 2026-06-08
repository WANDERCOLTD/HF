/**
 * Contract lock for `RetellProvider.parseTranscriptUpdate` (#1337).
 *
 * Retell's transport adapter is still a skeleton — the real parser
 * for `transcript_updated` events ships with the rest of the Retell
 * transport story. Until then, the adapter's method returns null so
 * the dispatch path exercises the interface without false-positives.
 *
 * This test pins two things:
 *   1. The method EXISTS on the adapter (refactor-safety — if someone
 *      drops the method by accident the route handler silently stops
 *      broadcasting Retell transcripts again).
 *   2. The method returns null for every plausible webhook shape, so
 *      we know the dispatch is safe to wire BEFORE the real parser
 *      lands.
 */

import { describe, it, expect } from "vitest";

import { RetellProvider } from "@/lib/voice/providers/retell";

describe("RetellProvider.parseTranscriptUpdate — contract exercise (stub returns null)", () => {
  const p = new RetellProvider({}, {});

  it("method exists on the adapter", () => {
    expect(typeof p.parseTranscriptUpdate).toBe("function");
  });

  it("returns null for a plausible Retell `transcript_updated` body", () => {
    const body = {
      event: "transcript_updated",
      call: {
        call_id: "call_abc",
        transcript: "hi how can I help",
      },
    };
    expect(p.parseTranscriptUpdate(body)).toBeNull();
  });

  it("returns null for unrelated event bodies", () => {
    expect(p.parseTranscriptUpdate({ event: "call_started" })).toBeNull();
    expect(p.parseTranscriptUpdate({ event: "call_ended" })).toBeNull();
    expect(p.parseTranscriptUpdate(null)).toBeNull();
    expect(p.parseTranscriptUpdate(undefined)).toBeNull();
  });
});

describe("RetellProvider.getCapabilities — orchestrationMode (#1337)", () => {
  const p = new RetellProvider({}, {});
  const caps = p.getCapabilities();

  it("declares vendor-cloud orchestration mode", () => {
    expect(caps.orchestrationMode).toBe("vendor-cloud");
  });

  it("keeps existing capability flags intact (no accidental drift)", () => {
    expect(caps.endOfCallEvents).toBe("split");
    expect(caps.hasKnowledgeCallback).toBe(false);
    expect(caps.toolCallsOverWebSocket).toBe(true);
    expect(caps.supportsRequestEndCall).toBe(true);
  });
});
