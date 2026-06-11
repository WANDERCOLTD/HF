import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import {
  resolveCallerScopeForReading,
  isScopeError,
} from "@/lib/learner-scope";
import {
  registerSubscriber,
  type VoiceCallSseEvent,
} from "@/lib/voice/sse-registry";
import { resolveTranscriptStreamEnabled } from "@/lib/voice/transcript-stream-gate";
import { logVoiceEvent } from "@/lib/voice/telemetry";

export const runtime = "nodejs";
// SSE responses must not be buffered by Next's response cache.
export const dynamic = "force-dynamic";

/**
 * @api GET /api/voice/calls/[callId]/stream
 * @visibility internal
 * @scope voice:calls:stream
 * @auth session ANY (STUDENT scoped to own caller via learner-scope)
 * @tags voice, calls, anyvoice, sse
 * @description Server-Sent Events stream for a live provider call (#1092).
 *   The webhook handler broadcasts incremental transcripts; the tool
 *   router broadcasts `share_content` / `send_text` / `request_artifact`
 *   when the chat rail is active.
 *
 *   **STUDENT-scope guard** (same leak class as #977): a STUDENT can
 *   only subscribe to their own linked Caller's calls. OPERATOR+
 *   passes through.
 *
 *   Event taxonomy is documented in `lib/voice/sse-registry.ts` and
 *   the chain-contract for clip-on clients (mobile / embed).
 *
 * @response 200 (event-stream)
 * @response 401 (unauthenticated)
 * @response 403 (STUDENT subscribing to another caller's call)
 * @response 404 (Call not found)
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ callId: string }> },
) {
  const auth = await requireAuth("VIEWER");
  if (isAuthError(auth)) return auth.error;

  const { callId } = await params;
  const call = await prisma.call.findUnique({
    where: { id: callId },
    select: { id: true, callerId: true, playbookId: true, voiceProvider: true },
  });
  if (!call) {
    return NextResponse.json(
      { ok: false, error: "Call not found" },
      { status: 404 },
    );
  }

  // STUDENT-scope guard. resolveCallerScopeForReading rewrites the
  // STUDENT's requested callerId to their own; we then compare to the
  // call's actual callerId. OPERATOR+ short-circuits true.
  const scope = await resolveCallerScopeForReading(
    auth.session,
    call.callerId,
  );
  if (isScopeError(scope)) return scope.error;
  if (
    auth.session.user.role === "STUDENT" &&
    scope.scopedCallerId !== call.callerId
  ) {
    return NextResponse.json(
      { ok: false, error: "Forbidden: not your call" },
      { status: 403 },
    );
  }

  logVoiceEvent({
    slug: call.voiceProvider ?? "auto",
    operation: `voice:${call.voiceProvider ?? "auto"}:sse:subscriber-connect`,
    durationMs: 0,
    callId: call.id,
    callerId: call.callerId,
  });

  // #1373 — Resolve the cascade once at connection-open so the initial
  // `call-started` event carries the gate state. Browser uses it to
  // render a "Bubbles on/off" pill, distinguishing "config says off"
  // from silent VAPI / multi-instance transport drop.
  const transcriptStreamEnabled = await resolveTranscriptStreamEnabled({
    callId: call.id,
    callerId: call.callerId,
    playbookId: call.playbookId,
  });

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: VoiceCallSseEvent) => {
        if (closed) return;
        try {
          const line = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(line));
        } catch {
          // Stream closed mid-write — let the abort path do the cleanup.
        }
      };

      // Initial heartbeat so the client sees the connection succeed.
      send({
        type: "call-started",
        callId: call.id,
        durationLimitMs: null,
        transcriptStreamEnabled,
        timestampMs: Date.now(),
      });

      const unregister = registerSubscriber(call.id, send);

      // Keep-alive every 15s — Cloud Run idles long connections after
      // a few minutes; the comment-only ping resets the inactivity
      // timer without becoming a real event.
      const keepalive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          // Closed
        }
      }, 15_000);

      // Browser disconnect → controller close → run unregister.
      const abort = request.signal;
      abort.addEventListener("abort", () => {
        closed = true;
        clearInterval(keepalive);
        unregister();
        logVoiceEvent({
          slug: call.voiceProvider ?? "auto",
          operation: `voice:${call.voiceProvider ?? "auto"}:sse:subscriber-disconnect`,
          durationMs: 0,
          callId: call.id,
          callerId: call.callerId,
        });
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
