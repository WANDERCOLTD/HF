/**
 * Transcript-stream-enabled cascade gate (#1373).
 *
 * Single resolver shared by:
 *   - `route-handlers.ts::processTranscriptUpdate` — suppresses
 *     `broadcastToCall({type: "transcript-partial"})` upstream when
 *     the cascade resolves to false.
 *   - `/api/voice/calls/[callId]/stream/route.ts` — stamps the resolved
 *     value into the initial `call-started` SSE event so the client
 *     can surface it as a header pill ("💬 Bubbles" / "🔇 Post-call").
 *
 * Default = true (pre-#1373 behaviour). Only flips when the cascade
 * resolves to an explicit `false`.
 *
 * Per-call in-process cache (5-min TTL) keyed on `callId` — both the
 * webhook and the SSE handler hit the same map, so the cascade
 * resolves once per call regardless of which call site arrives first.
 */

import { loadResolvedVoiceConfig } from "@/lib/voice/load-voice-config";

const transcriptGateCache = new Map<
  string,
  { value: boolean; expiresAt: number }
>();
const TRANSCRIPT_GATE_TTL_MS = 5 * 60 * 1000;

export async function resolveTranscriptStreamEnabled(args: {
  callId: string;
  callerId: string | null;
  /**
   * #1457 — Course (Playbook) layer of the cascade. Without this, an
   * operator's "Live transcript stream = On / Set at Course" override
   * is invisible to the gate because `loadResolvedVoiceConfig` only
   * loads the Playbook layer when `playbookId` is explicitly passed.
   */
  playbookId?: string | null;
}): Promise<boolean> {
  const now = Date.now();
  const cached = transcriptGateCache.get(args.callId);
  if (cached && cached.expiresAt > now) return cached.value;

  let value = true;
  try {
    if (args.callerId || args.playbookId) {
      const resolved = await loadResolvedVoiceConfig({
        callerId: args.callerId ?? undefined,
        playbookId: args.playbookId ?? undefined,
      });
      const flat = resolved.fields["transcriptStreamEnabled"];
      if (flat?.value === false) value = false;
    }
  } catch (err) {
    console.warn(
      `[voice/transcript-gate] cascade resolve failed for callId=${args.callId} — defaulting to enabled:`,
      err instanceof Error ? err.message : String(err),
    );
  }
  transcriptGateCache.set(args.callId, {
    value,
    expiresAt: now + TRANSCRIPT_GATE_TTL_MS,
  });
  return value;
}

export function _resetTranscriptGateCache(): void {
  transcriptGateCache.clear();
}
