/**
 * Voice tool router (AnyVoice #1023).
 *
 * Provider-agnostic dispatcher: maps a canonical NormalisedToolCall to
 * the matching handler in app/api/vapi/tools/route.ts (which exports the
 * 10 handle* functions). SIM uses this to exercise the tool surface
 * end-to-end so a regression in any tool definition or handler is
 * caught before it reaches a live voice call.
 *
 * Closes the I-VP5 outbound-half gap flagged by the TL during the
 * #1015 epic review: the inbound side (tool-callback shape parsing)
 * landed with #1017's NormalisedToolCallBatch; this router gives the
 * outbound side (handler dispatch) a provider-agnostic entry point.
 *
 * The handlers themselves are already provider-agnostic — they take
 * typed args + a callerId, not a VAPI-shaped request body. The only
 * VAPI-specific concern (parsing toolCallList) lives in
 * VapiProvider.normaliseToolCallList; by the time we get here, the
 * tool call is canonical.
 */

import type { NormalisedToolCall } from "./types";
import {
  handleLookupTeachingPoint,
  handleCheckMastery,
  handleRecordObservation,
  handleGetPracticeQuestion,
  handleGetNextModule,
  handleLogActivityResult,
  handleSendTextToCaller,
  handleRequestArtifact,
  handleShareContent,
  handleLookupVocabulary,
} from "@/app/api/vapi/tools/route";
import {
  hasSubscriberForCall,
  broadcastToCall,
} from "@/lib/voice/sse-registry";

export interface ToolRouterContext {
  callerId: string | null;
  /** Customer phone — required for outbound reach-ins
   *  (send_text_to_caller, share_content) when a live channel is in
   *  play. SIM passes null; the handler falls back to inline rendering. */
  customerPhone: string | null;
  /** Local `Call.id` (NOT the provider's externalCallId) for the active
   *  call (#1092). Resolved by the tools route from
   *  `NormalisedToolCallBatch.externalCallId` via
   *  `prisma.call.findFirst({externalId, source: slug})`. Used by the
   *  rail router to decide chat-via-SSE vs SMS/WhatsApp delivery for
   *  `share_content` / `send_text_to_caller` / `request_artifact`.
   *  Optional so SIM and unit-test call-sites that have no in-flight
   *  voice call don't need to thread null explicitly — but if null,
   *  rail-routing falls through to the legacy SMS / inline path. */
  callId?: string | null;
  /** Voice provider slug for the active call (#1092). The rail router
   *  emits SSE events keyed on slug so cross-provider audit stays
   *  consistent with telemetry's `engine` field. */
  voiceProviderSlug?: string | null;
}

export interface ToolRouterResult {
  /** Stringified result to feed back to the LLM as a tool-result message. */
  content: string;
  /** Raw handler return value — useful for assertions / observability. */
  raw: unknown;
  /** Which rail the result was delivered over (#1092). The webhook
   *  handler logs this on the per-tool UsageEvent so dashboards can
   *  see rail-routing decisions per call. */
  rail?: "chat" | "sms" | "whatsapp" | "inline" | "none";
}

/**
 * Dispatch a normalised tool call to the matching handler. Returns a
 * stringified result the LLM can consume in its next turn.
 *
 * Unknown tool name → returns a standardised diagnostic string; never
 * throws. Voice call must continue even if a tool fails — surface the
 * error to the LLM and let the conversation handle it.
 */
export async function routeToolCall(
  tool: NormalisedToolCall,
  ctx: ToolRouterContext,
): Promise<ToolRouterResult> {
  const args = tool.args as Record<string, unknown>;
  const { callerId, customerPhone } = ctx;
  const callId = ctx.callId ?? null;

  try {
    let raw: unknown;
    let rail: ToolRouterResult["rail"] = "inline";
    switch (tool.funcName) {
      case "lookup_teaching_point":
        raw = await handleLookupTeachingPoint(args as never, callerId);
        break;
      case "check_mastery":
        raw = await handleCheckMastery(args as never, callerId);
        break;
      case "record_observation":
        raw = await handleRecordObservation(args as never, callerId);
        break;
      case "get_practice_question":
        raw = await handleGetPracticeQuestion(args as never, callerId);
        break;
      case "get_next_module":
        raw = await handleGetNextModule(args as never, callerId);
        break;
      case "log_activity_result":
        raw = await handleLogActivityResult(args as never, callerId);
        break;
      case "send_text_to_caller": {
        // #1092 — rail routing: chat surface open (SSE subscriber for
        // this Call.id) takes precedence over SMS. Tool result carries
        // the chosen rail so the AI's next utterance can match ("look
        // at the chat" vs "I'm texting you").
        const dispatch = await dispatchSendText(
          args as { message: string; purpose?: string },
          callerId,
          customerPhone,
          callId,
        );
        raw = dispatch.raw;
        rail = dispatch.rail;
        break;
      }
      case "request_artifact": {
        const dispatch = await dispatchRequestArtifact(
          args as never,
          callerId,
          callId,
        );
        raw = dispatch.raw;
        rail = dispatch.rail;
        break;
      }
      case "share_content": {
        const dispatch = await dispatchShareContent(
          args as { media_id: string; caption?: string },
          callerId,
          customerPhone,
          callId,
        );
        raw = dispatch.raw;
        rail = dispatch.rail;
        break;
      }
      case "lookup_vocabulary":
        raw = await handleLookupVocabulary(args as never, callerId);
        break;
      default:
        return {
          content: JSON.stringify({ error: `Unknown tool: ${tool.funcName}` }),
          raw: { error: `Unknown tool: ${tool.funcName}` },
          rail: "none",
        };
    }
    return { content: JSON.stringify(raw), raw, rail };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[voice/tool-router] ${tool.funcName} threw:`, message);
    return {
      content: JSON.stringify({ error: `Tool ${tool.funcName} failed: ${message}` }),
      raw: { error: message },
      rail: "none",
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// Rail dispatchers (#1092)
// ═══════════════════════════════════════════════════════════════════

/**
 * #1092 — chat-rail dispatch for `share_content`. When the SimChat
 * surface is subscribed to the SSE channel for this call, broadcast the
 * media inline. Otherwise delegate to the existing `handleShareContent`
 * (which routes SMS/WhatsApp/inline per the caller's reachability).
 *
 * Tool result includes `rail` so the AI's next utterance matches:
 *   - rail=chat → "Take a look at the chat — I just dropped a diagram"
 *   - rail=sms → "I'm texting you the diagram now"
 *   - rail=inline (SIM) → "Here's the diagram on screen"
 */
async function dispatchShareContent(
  args: { media_id: string; caption?: string },
  callerId: string | null,
  customerPhone: string | null,
  callId: string | null,
): Promise<{ raw: unknown; rail: ToolRouterResult["rail"] }> {
  if (callId && hasSubscriberForCall(callId)) {
    await broadcastToCall({
      type: "share-content",
      callId,
      mediaId: args.media_id,
      caption: args.caption ?? null,
      rail: "chat",
      timestampMs: Date.now(),
    });
    return {
      raw: {
        delivered: true,
        rail: "chat",
        mediaId: args.media_id,
        caption: args.caption ?? null,
      },
      rail: "chat",
    };
  }
  // Fallback path — keeps SMS / WhatsApp / SIM-inline behaviour intact.
  const raw = await handleShareContent(
    args as never,
    callerId,
    customerPhone,
  );
  return {
    raw,
    rail: customerPhone ? "sms" : "inline",
  };
}

async function dispatchSendText(
  args: { message: string; purpose?: string },
  callerId: string | null,
  customerPhone: string | null,
  callId: string | null,
): Promise<{ raw: unknown; rail: ToolRouterResult["rail"] }> {
  if (callId && hasSubscriberForCall(callId)) {
    await broadcastToCall({
      type: "send-text",
      callId,
      message: args.message,
      rail: "chat",
      timestampMs: Date.now(),
    });
    return {
      raw: { delivered: true, rail: "chat", message: args.message },
      rail: "chat",
    };
  }
  const raw = await handleSendTextToCaller(
    args as never,
    callerId,
    customerPhone,
  );
  return {
    raw,
    rail: customerPhone ? "sms" : "inline",
  };
}

async function dispatchRequestArtifact(
  args: { type: string; title: string; content: string; reason?: string },
  callerId: string | null,
  callId: string | null,
): Promise<{ raw: unknown; rail: ToolRouterResult["rail"] }> {
  // Artifacts are persisted regardless of rail — the AI is asking us
  // to remember an artifact, not just to deliver it. Run the existing
  // handler (which persists + queues post-call delivery), then announce
  // over the chat rail if it's live so the chat surface can show
  // "[artifact requested: …]" inline.
  const raw = await handleRequestArtifact(args as never, callerId);
  let rail: ToolRouterResult["rail"] = "inline";
  if (callId && hasSubscriberForCall(callId)) {
    const artifactId =
      (raw as { artifactId?: string } | null)?.artifactId ?? "";
    await broadcastToCall({
      type: "request-artifact",
      callId,
      artifactId,
      title: args.title ?? null,
      timestampMs: Date.now(),
    });
    rail = "chat";
  }
  return { raw, rail };
}
