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

export interface ToolRouterContext {
  callerId: string | null;
  /** Customer phone — required for outbound reach-ins
   *  (send_text_to_caller, share_content) when a live channel is in
   *  play. SIM passes null; the handler falls back to inline rendering. */
  customerPhone: string | null;
}

export interface ToolRouterResult {
  /** Stringified result to feed back to the LLM as a tool-result message. */
  content: string;
  /** Raw handler return value — useful for assertions / observability. */
  raw: unknown;
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
  const args = tool.args as any;
  const { callerId, customerPhone } = ctx;

  try {
    let raw: unknown;
    switch (tool.funcName) {
      case "lookup_teaching_point":
        raw = await handleLookupTeachingPoint(args, callerId);
        break;
      case "check_mastery":
        raw = await handleCheckMastery(args, callerId);
        break;
      case "record_observation":
        raw = await handleRecordObservation(args, callerId);
        break;
      case "get_practice_question":
        raw = await handleGetPracticeQuestion(args, callerId);
        break;
      case "get_next_module":
        raw = await handleGetNextModule(args, callerId);
        break;
      case "log_activity_result":
        raw = await handleLogActivityResult(args, callerId);
        break;
      case "send_text_to_caller":
        // Outbound reach-in — uses customerPhone when present, falls
        // back to SIM inline rendering otherwise.
        raw = await handleSendTextToCaller(args, callerId, customerPhone);
        break;
      case "request_artifact":
        raw = await handleRequestArtifact(args, callerId);
        break;
      case "share_content":
        // Outbound reach-in — same SIM/live branching as send_text.
        raw = await handleShareContent(args, callerId, customerPhone);
        break;
      case "lookup_vocabulary":
        raw = await handleLookupVocabulary(args, callerId);
        break;
      default:
        return {
          content: JSON.stringify({ error: `Unknown tool: ${tool.funcName}` }),
          raw: { error: `Unknown tool: ${tool.funcName}` },
        };
    }
    return { content: JSON.stringify(raw), raw };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[voice/tool-router] ${tool.funcName} threw:`, message);
    return {
      content: JSON.stringify({ error: `Tool ${tool.funcName} failed: ${message}` }),
      raw: { error: message },
    };
  }
}
