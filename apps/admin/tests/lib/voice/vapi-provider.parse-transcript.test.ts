/**
 * Lock test for `VapiProvider.parseTranscriptUpdate` (#1337).
 *
 * Pre-#1337 this logic lived as a `slug === "vapi"` switch inside
 * `lib/voice/route-handlers.ts::parseTranscriptUpdate`. The behaviour
 * is now hosted on the adapter and dispatched via
 * `provider.parseTranscriptUpdate?.(body)`. These tests pin both shapes
 * VAPI emits at runtime (`transcript` chunks + `conversation-update`
 * full-history snapshots) plus the gotchas the original implementation
 * accumulated (#922):
 *   - `transcript` event has the chunk at `message.transcript`
 *   - `conversation-update` event drops the chunk INSIDE `message.messages`
 *     and has no `transcript` field — pre-#922 the route handler missed
 *     this and silently dropped 100% of conversation-update broadcasts
 *   - role normalisation: VAPI emits `user`/`assistant`/`bot`; we map to
 *     `learner`/`assistant`
 *
 * Companion: `tests/lib/voice/retell-provider.parse-transcript.test.ts`
 * (Retell stub returns null today — the contract is exercised, the
 * payload-parsing TODO is captured in the adapter).
 */

import { describe, it, expect } from "vitest";

import { VapiProvider } from "@/lib/voice/providers/vapi";

describe("VapiProvider.parseTranscriptUpdate — `transcript` event (chunk)", () => {
  const p = new VapiProvider({}, {});

  it("extracts learner role + text from a user transcript chunk", () => {
    const body = {
      message: {
        type: "transcript",
        transcript: "hello can you hear me",
        role: "user",
        call: { id: "vapi_call_abc" },
      },
    };
    expect(p.parseTranscriptUpdate(body)).toEqual({
      externalCallId: "vapi_call_abc",
      role: "learner",
      text: "hello can you hear me",
      hfCallId: null,
    });
  });

  it("maps `assistant` role to assistant (no remap needed)", () => {
    const body = {
      message: {
        type: "transcript",
        transcript: "yes I can hear you fine",
        role: "assistant",
        call: { id: "vapi_call_xyz" },
      },
    };
    const out = p.parseTranscriptUpdate(body);
    expect(out?.role).toBe("assistant");
  });

  it("maps `bot` role (legacy VAPI shape) to assistant", () => {
    const body = {
      message: {
        type: "transcript",
        transcript: "hi",
        role: "bot",
        call: { id: "vapi_call_legacy" },
      },
    };
    expect(p.parseTranscriptUpdate(body)?.role).toBe("assistant");
  });

  it("returns null when no externalCallId present (defensive — VAPI ought to send one)", () => {
    const body = {
      message: { type: "transcript", transcript: "hi", role: "user" },
    };
    expect(p.parseTranscriptUpdate(body)).toBeNull();
  });

  it("returns null when transcript text is empty (heartbeat / silence chunk)", () => {
    const body = {
      message: {
        type: "transcript",
        transcript: "",
        role: "user",
        call: { id: "vapi_call_empty" },
      },
    };
    expect(p.parseTranscriptUpdate(body)).toBeNull();
  });
});

describe("VapiProvider.parseTranscriptUpdate — `conversation-update` event (#922 fix)", () => {
  const p = new VapiProvider({}, {});

  it("extracts the most recent non-system turn from `messages` array", () => {
    // Pre-#922: route handler read `message.transcript` only and so
    // dropped every conversation-update event silently. The fix walks
    // the messages array bottom-up to find the latest non-system/
    // non-tool turn.
    const body = {
      message: {
        type: "conversation-update",
        call: { id: "vapi_call_history" },
        messages: [
          { role: "system", content: "You are a tutor." },
          { role: "user", content: "what is past tense?" },
          { role: "assistant", content: "past tense describes actions that have already happened" },
        ],
      },
    };
    expect(p.parseTranscriptUpdate(body)).toEqual({
      externalCallId: "vapi_call_history",
      role: "assistant",
      text: "past tense describes actions that have already happened",
      hfCallId: null,
    });
  });

  it("skips `system` and `tool` roles when walking the history", () => {
    const body = {
      message: {
        type: "conversation-update",
        call: { id: "vapi_call_skip" },
        messages: [
          { role: "user", content: "what time is it" },
          { role: "tool", content: '{"time":"15:42"}' },
          { role: "system", content: "(internal)" },
        ],
      },
    };
    // After filtering system + tool, the most-recent non-skipped is `user`.
    expect(p.parseTranscriptUpdate(body)?.role).toBe("learner");
  });

  it("accepts the alternate `messagesOpenAIFormatted` key VAPI sometimes uses", () => {
    const body = {
      message: {
        type: "conversation-update",
        call: { id: "vapi_call_alt" },
        messagesOpenAIFormatted: [
          { role: "user", content: "hi" },
        ],
      },
    };
    expect(p.parseTranscriptUpdate(body)?.text).toBe("hi");
  });

  it("returns null when no non-system content found", () => {
    const body = {
      message: {
        type: "conversation-update",
        call: { id: "vapi_call_only_system" },
        messages: [{ role: "system", content: "..." }],
      },
    };
    expect(p.parseTranscriptUpdate(body)).toBeNull();
  });
});

describe("VapiProvider.getCapabilities — orchestrationMode (#1337)", () => {
  const p = new VapiProvider({}, {});
  const caps = p.getCapabilities();

  it("declares vendor-cloud orchestration mode", () => {
    expect(caps.orchestrationMode).toBe("vendor-cloud");
  });

  it("keeps existing capability flags intact (no accidental drift)", () => {
    expect(caps.endOfCallEvents).toBe("single");
    expect(caps.hasKnowledgeCallback).toBe(true);
    expect(caps.toolCallsOverWebSocket).toBe(false);
    expect(caps.supportsRequestEndCall).toBe(true);
  });
});

describe("VapiProvider.parseTranscriptUpdate — hfCallId extraction (#1361)", () => {
  const p = new VapiProvider({}, {});

  it("extracts hfCallId from assistant.metadata (canonical WebRTC path)", () => {
    const body = {
      message: {
        type: "transcript",
        transcript: "hi",
        role: "user",
        call: { id: "vapi_call_xyz" },
        assistant: { metadata: { hfCallId: "hf_placeholder_123" } },
      },
    };
    const out = p.parseTranscriptUpdate(body);
    expect(out?.hfCallId).toBe("hf_placeholder_123");
  });

  it("extracts hfCallId from call.metadata (alternate VAPI nest)", () => {
    const body = {
      message: {
        type: "transcript",
        transcript: "hi",
        role: "user",
        call: { id: "vapi_call_xyz", metadata: { hfCallId: "hf_alt_456" } },
      },
    };
    expect(p.parseTranscriptUpdate(body)?.hfCallId).toBe("hf_alt_456");
  });

  it("extracts hfCallId from call.assistantOverrides.metadata (override nest)", () => {
    const body = {
      message: {
        type: "transcript",
        transcript: "hi",
        role: "user",
        call: {
          id: "vapi_call_xyz",
          assistantOverrides: { metadata: { hfCallId: "hf_override_789" } },
        },
      },
    };
    expect(p.parseTranscriptUpdate(body)?.hfCallId).toBe("hf_override_789");
  });

  it("returns hfCallId: null when no metadata anywhere (PSTN / legacy)", () => {
    const body = {
      message: {
        type: "transcript",
        transcript: "hi",
        role: "user",
        call: { id: "vapi_call_xyz" },
      },
    };
    expect(p.parseTranscriptUpdate(body)?.hfCallId).toBeNull();
  });

  it("ignores empty-string hfCallId (treated as missing)", () => {
    const body = {
      message: {
        type: "transcript",
        transcript: "hi",
        role: "user",
        call: { id: "vapi_call_xyz" },
        assistant: { metadata: { hfCallId: "" } },
      },
    };
    expect(p.parseTranscriptUpdate(body)?.hfCallId).toBeNull();
  });
});

describe("VapiProvider.parseTranscriptUpdate — non-transcript events", () => {
  const p = new VapiProvider({}, {});

  it("returns null for status-update events", () => {
    const body = {
      message: {
        type: "status-update",
        call: { id: "vapi_call_status" },
        cost: 0.07,
      },
    };
    expect(p.parseTranscriptUpdate(body)).toBeNull();
  });

  it("returns null for end-of-call-report events", () => {
    const body = {
      message: {
        type: "end-of-call-report",
        call: { id: "vapi_call_end" },
        transcript: "full transcript here",
      },
    };
    // type isn't "transcript" / "conversation-update" — return null even
    // though there happens to be a transcript field on the message.
    expect(p.parseTranscriptUpdate(body)).toBeNull();
  });

  it("returns null for non-object bodies", () => {
    expect(p.parseTranscriptUpdate(null)).toBeNull();
    expect(p.parseTranscriptUpdate(undefined)).toBeNull();
    expect(p.parseTranscriptUpdate("string")).toBeNull();
  });
});
