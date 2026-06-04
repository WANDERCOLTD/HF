/**
 * Tests for VapiProvider knowledge-base methods (AnyVoice #1022).
 *
 * Locks the contract app/api/vapi/knowledge/route.ts depends on at
 * every conversation turn: the adapter parses VAPI's knowledge-base
 * request shape into a canonical KnowledgeBaseRequest and formats
 * results back into VAPI's expected envelope.
 *
 * The retrieval logic in the route (pgvector + keyword hybrid) is
 * provider-agnostic and not exercised here — see the route's
 * integration test for that surface.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { VapiProvider } from "@/lib/voice/providers/vapi";
import type { KnowledgeResult } from "@/lib/voice/types";

const provider = new VapiProvider({}, {});

describe("VapiProvider knowledge-base (#1022)", () => {
  describe("parseKnowledgeBaseRequest", () => {
    it("parses a canonical VAPI knowledge-base-request body", () => {
      const result = provider.parseKnowledgeBaseRequest({
        message: {
          type: "knowledge-base-request",
          messages: [
            { role: "user", content: "What is Part 2?" },
            { role: "assistant", content: "Let me explain..." },
          ],
          call: {
            id: "vapi-call-kb-1",
            customer: { number: "+447700900123" },
          },
        },
      });

      expect(result).not.toBeNull();
      expect(result!.messages).toHaveLength(2);
      expect(result!.messages[0]).toEqual({ role: "user", content: "What is Part 2?" });
      expect(result!.callId).toBe("vapi-call-kb-1");
      expect(result!.customerPhone).toBe("+447700900123");
    });

    it("tolerates root-level body (no message wrapper) per VAPI quirks", () => {
      const result = provider.parseKnowledgeBaseRequest({
        type: "knowledge-base-request",
        messages: [{ role: "user", content: "hi" }],
      });
      expect(result).not.toBeNull();
      expect(result!.messages).toEqual([{ role: "user", content: "hi" }]);
      expect(result!.callId).toBeNull();
      expect(result!.customerPhone).toBeNull();
    });

    it("returns null when type is set but not knowledge-base-request", () => {
      expect(
        provider.parseKnowledgeBaseRequest({
          message: { type: "end-of-call-report", messages: [] },
        }),
      ).toBeNull();
    });

    it("returns null when messages is missing or non-array", () => {
      expect(
        provider.parseKnowledgeBaseRequest({
          message: { type: "knowledge-base-request" },
        }),
      ).toBeNull();
      expect(
        provider.parseKnowledgeBaseRequest({
          message: { type: "knowledge-base-request", messages: "not-an-array" },
        }),
      ).toBeNull();
    });

    it("returns null for null / non-object input", () => {
      expect(provider.parseKnowledgeBaseRequest(null)).toBeNull();
      expect(provider.parseKnowledgeBaseRequest(undefined)).toBeNull();
      expect(provider.parseKnowledgeBaseRequest("string")).toBeNull();
      expect(provider.parseKnowledgeBaseRequest(42)).toBeNull();
    });

    it("skips messages without role+content (defensive filter)", () => {
      const result = provider.parseKnowledgeBaseRequest({
        message: {
          type: "knowledge-base-request",
          messages: [
            { role: "user", content: "valid" },
            { role: "assistant" }, // missing content
            { content: "no role" }, // missing role
            { role: "user", content: 42 }, // content not a string
            { role: "user", content: "also valid" },
          ],
        },
      });
      expect(result!.messages).toHaveLength(2);
      expect(result!.messages.map((m) => m.content)).toEqual(["valid", "also valid"]);
    });

    it("tolerates missing type when messages is present (some providers omit it)", () => {
      // type is only validated when present — missing type passes through
      // so the route can still serve results for non-strict providers.
      const result = provider.parseKnowledgeBaseRequest({
        message: { messages: [{ role: "user", content: "hello" }] },
      });
      expect(result).not.toBeNull();
      expect(result!.messages).toHaveLength(1);
    });
  });

  describe("buildKnowledgeResponse", () => {
    it("wraps results in VAPI's { results } envelope", () => {
      const results: KnowledgeResult[] = [
        { content: "Part 2 is a 2-minute long-turn task.", similarity: 0.91 },
        { content: "Use connectives like 'firstly' and 'in conclusion'.", similarity: 0.78 },
      ];
      expect(provider.buildKnowledgeResponse(results)).toEqual({ results });
    });

    it("returns { results: [] } for empty input — never null or absent envelope", () => {
      expect(provider.buildKnowledgeResponse([])).toEqual({ results: [] });
    });
  });
});
