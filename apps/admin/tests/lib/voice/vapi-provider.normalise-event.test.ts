/**
 * Tests for VapiProvider.normaliseEndOfCallEvent (AnyVoice #1021).
 *
 * Locks the contract that handleEndOfCallReport in
 * app/api/vapi/webhook/route.ts depends on: the adapter parses every
 * VAPI body shape into a NormalisedEndOfCallEvent with canonical field
 * names. Each test fixture exercises one anti-shape so a regression
 * surfaces with a specific failure message, not a generic "test broke".
 *
 * Complements tests/lib/voice/vapi-provider.test.ts (which covers the
 * happy-path scenarios) and tests/lib/vapi-extract-capture.test.ts
 * (which exercises the canonical capture extractor at the column-name
 * layer via the route's back-compat shim).
 */

import { describe, it, expect, vi } from "vitest";

// Avoid pulling the prisma client into this pure-function test.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { VapiProvider } from "@/lib/voice/providers/vapi";

const provider = new VapiProvider({}, {});

describe("VapiProvider.normaliseEndOfCallEvent (#1021)", () => {
  it("populates every canonical capture field from a full payload", () => {
    const body = {
      message: {
        type: "end-of-call-report",
        endedReason: "customer-ended-call",
        durationSeconds: 187.4,
        cost: 0.0734,
        call: {
          id: "vapi-call-abc",
          customer: { number: "+447700900123", name: "Maya" },
          transcript: "User: hi\nAssistant: hello",
        },
        artifact: {
          recordingUrl: "https://r.test/x.mp3",
          stereoRecordingUrl: "https://r.test/x.wav",
        },
        analysis: {
          summary: "Brief IELTS session",
          structuredData: { topic: "Part 1", fluency: 6.5 },
          successEvaluation: true,
        },
      },
    };
    const ev = provider.normaliseEndOfCallEvent(body);
    expect(ev).not.toBeNull();
    expect(ev!.externalCallId).toBe("vapi-call-abc");
    expect(ev!.customerPhone).toBe("+447700900123");
    expect(ev!.customerName).toBe("Maya");
    expect(ev!.transcript).toBe("User: hi\nAssistant: hello");
    expect(ev!.capture.recordingUrl).toBe("https://r.test/x.mp3");
    expect(ev!.capture.stereoRecordingUrl).toBe("https://r.test/x.wav");
    expect(ev!.capture.durationSeconds).toBe(187.4);
    expect(ev!.capture.endedReason).toBe("customer-ended-call");
    expect(ev!.capture.costUsd).toBe(0.0734);
    expect(ev!.capture.analysisSummary).toBe("Brief IELTS session");
    expect(ev!.capture.structuredData).toEqual({ topic: "Part 1", fluency: 6.5 });
    expect(ev!.capture.successEvaluation).toBe("true");
  });

  it("populates providerRaw with the verbatim inbound message body (#1021)", () => {
    const body = {
      message: {
        call: { id: "vapi-call-raw" },
        nonCanonicalVapiOnlyField: { rubric: "x", weights: [1, 2, 3] },
      },
    };
    const ev = provider.normaliseEndOfCallEvent(body);
    expect(ev).not.toBeNull();
    expect(ev!.providerRaw).toBeDefined();
    // Verbatim — provider-specific extras the canonical capture didn't
    // touch must still be reachable via providerRaw for forensic use.
    expect((ev!.providerRaw as any).nonCanonicalVapiOnlyField).toEqual({
      rubric: "x",
      weights: [1, 2, 3],
    });
  });

  it("handles a minimal payload (no analysis, no artifact) — nullable fields are absent", () => {
    const ev = provider.normaliseEndOfCallEvent({
      message: { call: { id: "vapi-call-minimal" } },
    });
    expect(ev).not.toBeNull();
    expect(ev!.externalCallId).toBe("vapi-call-minimal");
    expect(ev!.customerPhone).toBeNull();
    expect(ev!.capture.durationSeconds).toBeUndefined();
    expect(ev!.capture.endedReason).toBeUndefined();
    expect(ev!.capture.analysisSummary).toBeUndefined();
    expect(ev!.capture.recordingUrl).toBeUndefined();
  });

  it("handles cost as an object with .total (VAPI sometimes nests)", () => {
    const ev = provider.normaliseEndOfCallEvent({
      message: {
        call: { id: "vapi-call-cost-obj" },
        cost: { total: 0.12, llm: 0.08, transport: 0.04 },
      },
    });
    expect(ev!.capture.costUsd).toBe(0.12);
  });

  it("returns null when call.id is absent (tampered/malformed body)", () => {
    expect(provider.normaliseEndOfCallEvent({ message: {} })).toBeNull();
    expect(provider.normaliseEndOfCallEvent({ message: { call: {} } })).toBeNull();
    expect(provider.normaliseEndOfCallEvent(null)).toBeNull();
    expect(provider.normaliseEndOfCallEvent("string")).toBeNull();
  });

  it("does not throw on unexpected types in sensitive fields", () => {
    expect(() =>
      provider.normaliseEndOfCallEvent({
        message: {
          call: { id: "vapi-call-weird" },
          durationSeconds: "not-a-number",
          endedReason: { unexpected: "object" },
          analysis: { summary: 42 },
        },
      }),
    ).not.toThrow();
  });

  it("coerces successEvaluation: number → string (rubric variants)", () => {
    const ev = provider.normaliseEndOfCallEvent({
      message: {
        call: { id: "vapi-call-eval-num" },
        analysis: { successEvaluation: 0.75 },
      },
    });
    expect(ev!.capture.successEvaluation).toBe("0.75");
  });
});
