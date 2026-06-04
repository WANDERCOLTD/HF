/**
 * Tests for lib/voice/tool-router.ts (AnyVoice #1023).
 *
 * The TL #1015 review fixed the I-VP5 scope at "3/10 tools through the
 * adapter — INCLUDING 1 outbound reach-in". This file pins:
 *   - lookup_teaching_point (inbound — content lookup)
 *   - check_mastery (inbound — caller-scoped read)
 *   - send_text_to_caller (outbound reach-in — the TL-required one)
 *
 * Plus: unknown tool returns the standardised diagnostic (no throw),
 * handler-throw is caught and surfaced as a tool-result error string
 * so the voice call keeps moving.
 *
 * Handlers are mocked at module level — these tests verify the
 * router's dispatch + error handling, not the handler internals
 * (those have their own integration tests on the VAPI tools route).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted to the top of the file; mock factories can't see
// closure variables defined below. vi.hoisted hoists the variable
// definition alongside the mock so we can both stub and assert on the
// same handler set.
const handlers = vi.hoisted(() => ({
  handleLookupTeachingPoint: vi.fn(),
  handleCheckMastery: vi.fn(),
  handleRecordObservation: vi.fn(),
  handleGetPracticeQuestion: vi.fn(),
  handleGetNextModule: vi.fn(),
  handleLogActivityResult: vi.fn(),
  handleSendTextToCaller: vi.fn(),
  handleRequestArtifact: vi.fn(),
  handleShareContent: vi.fn(),
  handleLookupVocabulary: vi.fn(),
}));

vi.mock("@/app/api/vapi/tools/route", () => handlers);
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { routeToolCall } from "@/lib/voice/tool-router";
import type { NormalisedToolCall } from "@/lib/voice/types";

describe("routeToolCall (#1023)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches lookup_teaching_point with args + callerId (inbound)", async () => {
    handlers.handleLookupTeachingPoint.mockResolvedValue({
      found: true,
      count: 1,
      points: [{ content: "Part 2 is a 2-minute long-turn task." }],
    });

    const result = await routeToolCall(
      { toolCallId: "tc-1", funcName: "lookup_teaching_point", args: { topic: "Part 2", limit: 3 } },
      { callerId: "caller-1", customerPhone: null },
    );

    expect(handlers.handleLookupTeachingPoint).toHaveBeenCalledWith(
      { topic: "Part 2", limit: 3 },
      "caller-1",
    );
    expect(JSON.parse(result.content).found).toBe(true);
    expect(result.raw).toMatchObject({ count: 1 });
  });

  it("dispatches check_mastery and returns the mastery summary (inbound)", async () => {
    handlers.handleCheckMastery.mockResolvedValue({
      mastered: false,
      score: 0.42,
      module: "Part 2",
      message: "Caller is still learning \"Part 2\" (score: 42%)",
    });

    const result = await routeToolCall(
      { toolCallId: "tc-2", funcName: "check_mastery", args: { module: "Part 2" } },
      { callerId: "caller-1", customerPhone: null },
    );

    expect(handlers.handleCheckMastery).toHaveBeenCalledWith({ module: "Part 2" }, "caller-1");
    expect(JSON.parse(result.content).mastered).toBe(false);
  });

  it("dispatches send_text_to_caller and propagates customerPhone (OUTBOUND reach-in — TL-required)", async () => {
    handlers.handleSendTextToCaller.mockResolvedValue({
      sent: true,
      channel: "sms",
      message: "Sent",
    });

    const result = await routeToolCall(
      {
        toolCallId: "tc-3",
        funcName: "send_text_to_caller",
        args: { message: "Practice these 5 connectives tonight", purpose: "practice" },
      },
      { callerId: "caller-1", customerPhone: "+447700900123" },
    );

    // Outbound handlers MUST receive customerPhone so the channel
    // dispatcher can route SMS / WhatsApp. The TL flagged that the
    // current code branched on `!!externalId` for this dispatch —
    // this test pins that the router forwards customerPhone instead.
    expect(handlers.handleSendTextToCaller).toHaveBeenCalledWith(
      { message: "Practice these 5 connectives tonight", purpose: "practice" },
      "caller-1",
      "+447700900123",
    );
    expect(JSON.parse(result.content).sent).toBe(true);
  });

  it("send_text_to_caller passes customerPhone=null when SIM is on the wire", async () => {
    // SIM context: no customer phone. Handler should fall back to
    // inline rendering (CallMessage row + SimChat displays it).
    handlers.handleSendTextToCaller.mockResolvedValue({ sent: true, channel: "sim" });

    await routeToolCall(
      {
        toolCallId: "tc-4",
        funcName: "send_text_to_caller",
        args: { message: "hi" },
      },
      { callerId: "caller-1", customerPhone: null },
    );

    expect(handlers.handleSendTextToCaller).toHaveBeenCalledWith(
      { message: "hi" },
      "caller-1",
      null,
    );
  });

  it("returns a standardised error string for an unknown tool — never throws", async () => {
    const result = await routeToolCall(
      { toolCallId: "tc-x", funcName: "nonexistent_tool", args: {} },
      { callerId: "caller-1", customerPhone: null },
    );

    expect(JSON.parse(result.content).error).toMatch(/Unknown tool: nonexistent_tool/);
  });

  it("catches handler throws and surfaces them as a tool-result error string", async () => {
    handlers.handleCheckMastery.mockRejectedValue(new Error("temporary DB blip"));

    const result = await routeToolCall(
      { toolCallId: "tc-fail", funcName: "check_mastery", args: { module: "x" } },
      { callerId: "caller-1", customerPhone: null },
    );

    const parsed = JSON.parse(result.content);
    expect(parsed.error).toMatch(/Tool check_mastery failed/);
    expect(parsed.error).toMatch(/temporary DB blip/);
  });
});
