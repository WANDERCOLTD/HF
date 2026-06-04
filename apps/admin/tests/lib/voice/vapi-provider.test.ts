/**
 * Tests for VapiProvider (AnyVoice #1017).
 *
 * Covers each VoiceProvider interface method against the VAPI wire shape:
 *   - verifyInboundRequest      (HMAC verification)
 *   - buildAssistantConfig      (assistant-request response)
 *   - normaliseEndOfCallEvent   (webhook payload extraction)
 *   - normaliseToolCallList     (tools-route payload extraction)
 *   - buildKnowledgeResponse    (RAG response envelope)
 *
 * Together with `tests/lib/vapi-extract-capture.test.ts` (which exercises
 * the canonical capture helper via the route's back-compat shim), this
 * suite locks down the adapter contract so a future second provider can
 * implement the same interface confidently.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import crypto from "node:crypto";

// The tools/route module imports a wide dep graph; mock it to a minimal
// shape so the test only loads what it needs.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { VapiProvider, extractVapiCapture } from "@/lib/voice/providers/vapi";
import type { AssistantRequestContext, KnowledgeResult } from "@/lib/voice/types";

// Tests construct fresh instances. The singleton export from #1017 was
// dropped in #1031 because the factory now instantiates per slug-cache-
// window with DB-stored credentials/config. Passing {} for both args
// works for the pure-function methods (build*, normalise*) which don't
// touch credentials; HMAC tests pass an explicit secret.
const provider = new VapiProvider({}, {});

describe("VapiProvider", () => {
  describe("slug + instance", () => {
    it("exposes the canonical slug", () => {
      expect(provider.slug).toBe("vapi");
      expect(new VapiProvider({}, {}).slug).toBe("vapi");
    });
  });

  describe("buildAssistantConfig", () => {
    const baseCtx: AssistantRequestContext = {
      callerId: "caller-1",
      callerName: "Maya",
      customerPhone: "+447700900123",
      voicePrompt: "## You are Maya's tutor\n...",
      firstLine: "Hi Maya!",
      toolDefinitions: [],
      knowledgePlanEnabled: false,
      serverUrlBase: "https://example.test/api/vapi",
      modelConfig: { provider: "openai", model: "gpt-4o" },
      unknownCallerPrompt: "Hello — who is this?",
      noActivePromptFallback: "Sorry, your prompt is still being prepared.",
    };

    it("returns a VAPI-shaped assistant config wrapped in `assistant`", () => {
      const result = provider.buildAssistantConfig(baseCtx) as any;
      expect(result.assistant).toBeDefined();
      expect(result.assistant.model.provider).toBe("openai");
      expect(result.assistant.model.model).toBe("gpt-4o");
      expect(result.assistant.model.messages[0].content).toBe(baseCtx.voicePrompt);
      expect(result.assistant.firstMessage).toBe("Hi Maya!");
      expect(result.assistant.serverUrl).toBe("https://example.test/api/vapi/webhook");
    });

    it("omits tools key when no tool definitions provided", () => {
      const result = provider.buildAssistantConfig(baseCtx) as any;
      expect(result.assistant.model.tools).toBeUndefined();
    });

    it("attaches per-tool server URL when tools are present", () => {
      const result = provider.buildAssistantConfig({
        ...baseCtx,
        toolDefinitions: [
          {
            type: "function",
            function: {
              name: "lookup_teaching_point",
              description: "Look up content",
              parameters: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] },
            },
          },
        ],
      }) as any;
      expect(result.assistant.model.tools).toHaveLength(1);
      expect(result.assistant.model.tools[0].server.url).toBe("https://example.test/api/vapi/tools");
      expect(result.assistant.model.tools[0].function.name).toBe("lookup_teaching_point");
    });

    it("includes knowledgePlan when RAG is enabled", () => {
      const result = provider.buildAssistantConfig({
        ...baseCtx,
        knowledgePlanEnabled: true,
      }) as any;
      expect(result.assistant.knowledgePlan).toEqual({
        provider: "custom-knowledge-base",
        server: { url: "https://example.test/api/vapi/knowledge" },
      });
    });

    it("omits firstMessage when firstLine is null", () => {
      const result = provider.buildAssistantConfig({
        ...baseCtx,
        firstLine: null,
      }) as any;
      expect(result.assistant.firstMessage).toBeUndefined();
    });
  });

  describe("normaliseEndOfCallEvent", () => {
    it("extracts canonical fields from a full payload", () => {
      const result = provider.normaliseEndOfCallEvent({
        message: {
          type: "end-of-call-report",
          endedReason: "customer-ended-call",
          durationSeconds: 120,
          cost: 0.05,
          call: {
            id: "vapi-call-1",
            customer: { number: "+447700900123", name: "Maya" },
            // Real VAPI payloads carry transcript inside `call`, not on
            // the outer `message`. Mirrors the existing webhook route's
            // `call.transcript || ...` read path.
            transcript: "Hello\nHi there",
          },
        },
      });
      expect(result).not.toBeNull();
      expect(result!.externalCallId).toBe("vapi-call-1");
      expect(result!.customerPhone).toBe("+447700900123");
      expect(result!.customerName).toBe("Maya");
      expect(result!.transcript).toBe("Hello\nHi there");
      expect(result!.capture.durationSeconds).toBe(120);
      expect(result!.capture.endedReason).toBe("customer-ended-call");
      expect(result!.capture.costUsd).toBe(0.05);
    });

    it("returns null when the payload lacks a call id", () => {
      expect(provider.normaliseEndOfCallEvent({})).toBeNull();
      expect(provider.normaliseEndOfCallEvent({ message: {} })).toBeNull();
      expect(provider.normaliseEndOfCallEvent({ message: { call: {} } })).toBeNull();
      expect(provider.normaliseEndOfCallEvent(null)).toBeNull();
    });

    it("builds transcript from messages array when transcript field is empty", () => {
      const result = provider.normaliseEndOfCallEvent({
        message: {
          call: {
            id: "vapi-call-2",
            messages: [
              { role: "assistant", content: "Hello" },
              { role: "user", content: "Hi" },
            ],
          },
        },
      });
      expect(result!.transcript).toBe("assistant: Hello\nuser: Hi");
    });

    it("handles minimal payload (id only)", () => {
      const result = provider.normaliseEndOfCallEvent({
        message: { call: { id: "vapi-call-3" } },
      });
      expect(result).not.toBeNull();
      expect(result!.externalCallId).toBe("vapi-call-3");
      expect(result!.customerPhone).toBeNull();
      expect(result!.customerName).toBeNull();
      expect(result!.transcript).toBe("");
      expect(result!.capture).toEqual({});
    });
  });

  describe("normaliseToolCallList", () => {
    it("returns an empty batch for a payload without toolCallList", () => {
      const result = provider.normaliseToolCallList({});
      expect(result.toolCalls).toEqual([]);
      expect(result.customerPhone).toBeNull();
    });

    it("extracts a single tool call in VAPI's current function shape", () => {
      const result = provider.normaliseToolCallList({
        message: {
          call: { customer: { number: "+447700900123" } },
          toolCallList: [
            {
              id: "tc-1",
              function: {
                name: "lookup_teaching_point",
                arguments: { topic: "IELTS Part 2" },
              },
            },
          ],
        },
      });
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]).toEqual({
        toolCallId: "tc-1",
        funcName: "lookup_teaching_point",
        args: { topic: "IELTS Part 2" },
      });
      expect(result.customerPhone).toBe("+447700900123");
    });

    it("extracts multiple tool calls and tolerates legacy functionCall shape", () => {
      const result = provider.normaliseToolCallList({
        message: {
          toolCallList: [
            {
              id: "tc-1",
              function: { name: "check_mastery", arguments: '{"module":"part2"}' },
            },
            {
              toolCallId: "tc-2",
              functionCall: { name: "record_observation", parameters: { key: "anxious", value: "yes" } },
            },
          ],
        },
      });
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].funcName).toBe("check_mastery");
      expect(result.toolCalls[0].args).toEqual({ module: "part2" });
      expect(result.toolCalls[1].toolCallId).toBe("tc-2");
      expect(result.toolCalls[1].funcName).toBe("record_observation");
      expect(result.toolCalls[1].args).toEqual({ key: "anxious", value: "yes" });
    });

    it("skips entries without a function name (defensive)", () => {
      const result = provider.normaliseToolCallList({
        message: { toolCallList: [{ id: "tc-bad" }, { id: "tc-ok", function: { name: "check_mastery", arguments: {} } }] },
      });
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].funcName).toBe("check_mastery");
    });
  });

  describe("buildKnowledgeResponse", () => {
    it("wraps results in VAPI's `{ results }` envelope", () => {
      const results: KnowledgeResult[] = [
        { content: "Part 2 is a 2-minute long-turn task.", similarity: 0.91 },
        { content: "Use connectives like 'firstly' and 'in conclusion'.", similarity: 0.78 },
      ];
      expect(provider.buildKnowledgeResponse(results)).toEqual({ results });
    });

    it("returns an empty envelope for empty results", () => {
      expect(provider.buildKnowledgeResponse([])).toEqual({ results: [] });
    });
  });

  describe("verifyInboundRequest (HMAC)", () => {
    const SECRET = "test-secret-do-not-use-in-prod";

    function makeRequestStub(rawBody: string, signature: string | null) {
      return {
        headers: {
          get(name: string) {
            if (name === "x-vapi-signature") return signature;
            return null;
          },
        },
      } as unknown as import("next/server").NextRequest;
    }

    // After #1031 the secret comes from constructor credentials (the DB
    // row), not from lib/config. Tests instantiate with explicit args and
    // unset VAPI_WEBHOOK_SECRET so the env fallback can't mask the test.
    const origEnv = process.env.VAPI_WEBHOOK_SECRET;
    beforeEach(() => {
      delete process.env.VAPI_WEBHOOK_SECRET;
    });
    afterAll(() => {
      if (origEnv !== undefined) process.env.VAPI_WEBHOOK_SECRET = origEnv;
    });

    it("returns null (pass-through) when no secret is configured", () => {
      const p = new VapiProvider({}, {});
      const req = makeRequestStub("{}", null);
      expect(p.verifyInboundRequest(req, "{}")).toBeNull();
    });

    it("rejects when secret is configured but signature header is missing", () => {
      const p = new VapiProvider({ webhookSecret: SECRET }, {});
      const req = makeRequestStub("{}", null);
      const result = p.verifyInboundRequest(req, "{}") as any;
      expect(result).not.toBeNull();
      expect(result.status).toBe(401);
    });

    it("accepts a request with a valid HMAC signature", () => {
      const p = new VapiProvider({ webhookSecret: SECRET }, {});
      const body = '{"hello":"world"}';
      const sig = crypto.createHmac("sha256", SECRET).update(body).digest("hex");
      const req = makeRequestStub(body, sig);
      expect(p.verifyInboundRequest(req, body)).toBeNull();
    });

    it("falls back to VAPI_WEBHOOK_SECRET env var with a console.warn (cutover-window safety)", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      process.env.VAPI_WEBHOOK_SECRET = SECRET;
      const p = new VapiProvider({}, {});
      // Warn fires at constructor time
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("falling back to env var"),
      );
      // And the env-resolved secret still verifies
      const body = '{"x":1}';
      const sig = crypto.createHmac("sha256", SECRET).update(body).digest("hex");
      const req = makeRequestStub(body, sig);
      expect(p.verifyInboundRequest(req, body)).toBeNull();
      warnSpy.mockRestore();
    });
  });

  describe("extractVapiCapture (canonical extractor)", () => {
    // Sibling coverage of the same helper used by the back-compat shim
    // in app/api/vapi/webhook/route.ts; lets a future test refactor
    // import from the adapter directly without crossing the route layer.
    it("returns empty object for null / non-object input", () => {
      expect(extractVapiCapture(null)).toEqual({});
      expect(extractVapiCapture(undefined)).toEqual({});
      expect(extractVapiCapture("string")).toEqual({});
    });

    it("extracts artifact + duration + cost + analysis fields", () => {
      const result = extractVapiCapture({
        artifact: { recordingUrl: "https://r.test/x.mp3", stereoRecordingUrl: "https://r.test/x.wav" },
        durationSeconds: 90.5,
        endedReason: "customer-ended-call",
        cost: 0.04,
        analysis: {
          summary: "Brief session",
          structuredData: { topic: "Part 1" },
          successEvaluation: true,
        },
      });
      expect(result).toEqual({
        recordingUrl: "https://r.test/x.mp3",
        stereoRecordingUrl: "https://r.test/x.wav",
        durationSeconds: 90.5,
        endedReason: "customer-ended-call",
        costUsd: 0.04,
        analysisSummary: "Brief session",
        structuredData: { topic: "Part 1" },
        successEvaluation: "true",
      });
    });
  });
});
