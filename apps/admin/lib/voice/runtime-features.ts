/**
 * Voice runtime features (#1092 / #1093) — adaptive rail snapshot.
 *
 * Resolves which delivery rails are live for an inbound voice call at
 * assistant-request time. Consumed by:
 *   - `renderProviderPrompt(prompt, capabilities, runtime)` (#1093) —
 *     selects mid-call reach-in fragments based on which rails the AI
 *     can actually use
 *   - The tools handler (#1092) — uses `hasChatRail` to route
 *     share_content / send_text_to_caller / request_artifact to the
 *     SSE channel before falling back to SMS / WhatsApp
 *
 * Pure read-only helper. Database reads come from `@/lib/prisma`;
 * never instantiates its own PrismaClient.
 */

import { prisma } from "@/lib/prisma";
import { hasSubscriberForCall } from "@/lib/voice/sse-registry";

export interface VoiceRuntimeFeatures {
  /** Local call id this snapshot is for. */
  callId: string | null;
  /** A browser is subscribed to the SSE channel for this call right now —
   *  share_content / send_text / request_artifact will deliver inline. */
  hasChatRail: boolean;
  /** Caller has a phone reachable via SMS. */
  hasSmsRail: boolean;
  /** Caller has WhatsApp opt-in. (Stub for v1 — wired alongside the
   *  WhatsApp delivery rail story.) */
  hasWhatsAppRail: boolean;
}

interface ResolveOptions {
  /** Local Call.id (the in-flight call). */
  callId: string | null;
  /** Caller.id — used to look up SMS / WhatsApp eligibility. */
  callerId: string | null;
  /** Optional intent hint from `/api/voice/calls/start` — when the
   *  client requested chat-mode we optimistically set `hasChatRail`
   *  true so the AI's first turn is correct, even if the SSE has
   *  not connected by the time the assistant-request fires. The SSE
   *  registry is still the source of truth for the tools router at
   *  delivery time. */
  intent?: "chat" | "audio-only" | null;
}

export async function resolveRuntimeFeatures(
  options: ResolveOptions,
): Promise<VoiceRuntimeFeatures> {
  const { callId, callerId, intent } = options;
  const chatRailLive = callId ? hasSubscriberForCall(callId) : false;
  const hasChatRail = chatRailLive || intent === "chat";

  let hasSmsRail = false;
  if (callerId) {
    try {
      const c = await prisma.caller.findUnique({
        where: { id: callerId },
        select: { phone: true },
      });
      hasSmsRail = !!c?.phone;
    } catch {
      // Best-effort; surface as no-rail rather than 500
      hasSmsRail = false;
    }
  }

  return {
    callId,
    hasChatRail,
    hasSmsRail,
    // Wired alongside the WhatsApp rail story. Defaults to "off" so
    // the prompt doesn't promise something we can't deliver.
    hasWhatsAppRail: false,
  };
}

/** For tests + sim callers without a live call. Defaults represent the
 *  SIM-text path: chat rail is live (the chat surface is the SIM itself),
 *  no SMS, no WhatsApp. */
export const DEFAULT_RUNTIME_FEATURES: VoiceRuntimeFeatures = {
  callId: null,
  hasChatRail: true,
  hasSmsRail: false,
  hasWhatsAppRail: false,
};
