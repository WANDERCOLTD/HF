/**
 * Tests for the VAPI end-of-call-report capture extractor.
 *
 * Pure function under test: extractVapiCapture(message) → only the fields
 * the writer can persist on the Call row. Every source field is independent
 * and optional — VAPI's analysis block depends on the assistant's analysis
 * plan config. The extractor must:
 *   • return only known-shape values (type guards on every read)
 *   • coerce successEvaluation booleans/numbers to strings for storage
 *   • read cost as either a number or `cost.total`
 *   • never throw on malformed input
 */

import { describe, it, expect } from "vitest";
import fixture from "../fixtures/vapi-end-of-call-report.json";
import { extractVapiCapture } from "@/app/api/vapi/webhook/route";

describe("extractVapiCapture", () => {
  it("extracts all fields from a full fixture payload", () => {
    const result = extractVapiCapture(fixture.message);

    expect(result).toEqual({
      recordingUrl: "https://storage.vapi.ai/recordings/abc-123-mono.mp3",
      stereoRecordingUrl: "https://storage.vapi.ai/recordings/abc-123-stereo.wav",
      voiceDurationSeconds: 187.4,
      voiceEndedReason: "customer-ended-call",
      voiceCostUsd: 0.0734,
      voiceAnalysisSummary: expect.stringContaining("IELTS speaking practice"),
      voiceStructuredData: {
        topic: "IELTS speaking",
        callType: "intake",
        fluencyIndicative: 6.5,
      },
      voiceSuccessEvaluation: "true",
    });
  });

  it("returns {} for null / undefined / non-object input", () => {
    expect(extractVapiCapture(null)).toEqual({});
    expect(extractVapiCapture(undefined)).toEqual({});
    expect(extractVapiCapture("string")).toEqual({});
    expect(extractVapiCapture(42)).toEqual({});
  });

  it("returns {} for an empty message object", () => {
    expect(extractVapiCapture({})).toEqual({});
  });

  it("omits artifact fields when artifact is missing or wrong shape", () => {
    expect(extractVapiCapture({ artifact: null })).toEqual({});
    expect(extractVapiCapture({ artifact: "not-an-object" })).toEqual({});
    expect(extractVapiCapture({ artifact: {} })).toEqual({});
  });

  it("omits recordingUrl when it's not a string", () => {
    const result = extractVapiCapture({
      artifact: { recordingUrl: 123, stereoRecordingUrl: "ok" },
    });
    expect(result.recordingUrl).toBeUndefined();
    expect(result.stereoRecordingUrl).toBe("ok");
  });

  it("omits durationSeconds when NaN / Infinity / non-number", () => {
    expect(extractVapiCapture({ durationSeconds: "100" }).voiceDurationSeconds).toBeUndefined();
    expect(extractVapiCapture({ durationSeconds: NaN }).voiceDurationSeconds).toBeUndefined();
    expect(extractVapiCapture({ durationSeconds: Infinity }).voiceDurationSeconds).toBeUndefined();
    expect(extractVapiCapture({ durationSeconds: 12.5 }).voiceDurationSeconds).toBe(12.5);
  });

  it("reads cost as a number directly", () => {
    expect(extractVapiCapture({ cost: 0.05 }).voiceCostUsd).toBe(0.05);
  });

  it("reads cost.total when cost is an object", () => {
    expect(extractVapiCapture({ cost: { total: 0.12, llm: 0.08 } }).voiceCostUsd).toBe(0.12);
  });

  it("omits cost when neither shape provides a finite number", () => {
    expect(extractVapiCapture({ cost: "0.10" }).voiceCostUsd).toBeUndefined();
    expect(extractVapiCapture({ cost: { total: "0.10" } }).voiceCostUsd).toBeUndefined();
    expect(extractVapiCapture({ cost: { other: 0.10 } }).voiceCostUsd).toBeUndefined();
    expect(extractVapiCapture({ cost: NaN }).voiceCostUsd).toBeUndefined();
  });

  it("omits analysis fields when analysis is missing or wrong shape", () => {
    expect(extractVapiCapture({ analysis: null })).toEqual({});
    expect(extractVapiCapture({ analysis: "string" })).toEqual({});
    expect(extractVapiCapture({ analysis: {} })).toEqual({});
  });

  it("omits summary when not a string", () => {
    expect(extractVapiCapture({ analysis: { summary: 42 } }).voiceAnalysisSummary).toBeUndefined();
    expect(extractVapiCapture({ analysis: { summary: null } }).voiceAnalysisSummary).toBeUndefined();
  });

  it("omits structuredData when it's an array (must be an object record)", () => {
    expect(
      extractVapiCapture({ analysis: { structuredData: [1, 2, 3] } }).voiceStructuredData,
    ).toBeUndefined();
  });

  it("accepts structuredData as a plain object", () => {
    const result = extractVapiCapture({
      analysis: { structuredData: { topic: "x", n: 1 } },
    });
    expect(result.voiceStructuredData).toEqual({ topic: "x", n: 1 });
  });

  it("coerces successEvaluation booleans to strings", () => {
    expect(extractVapiCapture({ analysis: { successEvaluation: true } }).voiceSuccessEvaluation).toBe("true");
    expect(extractVapiCapture({ analysis: { successEvaluation: false } }).voiceSuccessEvaluation).toBe("false");
  });

  it("coerces successEvaluation numbers to strings", () => {
    expect(extractVapiCapture({ analysis: { successEvaluation: 0.75 } }).voiceSuccessEvaluation).toBe("0.75");
    expect(extractVapiCapture({ analysis: { successEvaluation: 1 } }).voiceSuccessEvaluation).toBe("1");
  });

  it("preserves successEvaluation string verbatim (e.g. rubric labels)", () => {
    expect(extractVapiCapture({ analysis: { successEvaluation: "PASS" } }).voiceSuccessEvaluation).toBe("PASS");
  });

  it("omits successEvaluation for unknown shapes (object, array, null)", () => {
    expect(extractVapiCapture({ analysis: { successEvaluation: { rubric: "x" } } }).voiceSuccessEvaluation).toBeUndefined();
    expect(extractVapiCapture({ analysis: { successEvaluation: null } }).voiceSuccessEvaluation).toBeUndefined();
  });

  it("does not throw on a payload with unrelated extra keys", () => {
    expect(() =>
      extractVapiCapture({
        unknownKey: "extra",
        artifact: { recordingUrl: "x", extra: 1 },
        analysis: { summary: "ok", extra: 1 },
      }),
    ).not.toThrow();
  });
});
