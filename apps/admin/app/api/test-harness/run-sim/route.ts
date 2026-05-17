import { NextRequest } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { runSimulation, type SimProgressEvent } from "@/lib/test-harness/sim-runner";

/**
 * @api POST /api/test-harness/run-sim
 * @visibility internal
 * @auth ADMIN
 * @tags test-harness
 * @description Run a fully automated AI-simulated call where AI plays both system and caller roles.
 *   Returns SSE stream of conversation turns and pipeline results.
 * @body callerId string - Caller to simulate (required)
 * @body turnCount number - Number of conversation turns (2-20, default 6)
 * @body runPipeline boolean - Run end-call pipeline after sim (default true)
 * @response 200 text/event-stream
 * @response 400 { ok: false, error: "..." }
 */

export const maxDuration = 300; // 5 min for long sims with pipeline

export async function POST(req: NextRequest) {
  const authResult = await requireAuth("ADMIN");
  if (isAuthError(authResult)) return authResult.error;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: "Invalid JSON body" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { callerId, turnCount = 6, runPipeline = true } = body;

  if (!callerId) {
    return new Response(
      JSON.stringify({ ok: false, error: "callerId is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const numTurns = Math.max(2, Math.min(20, Number(turnCount) || 6));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: SimProgressEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        const result = await runSimulation({
          callerId,
          turnCount: numTurns,
          runPipeline,
          onProgress: sendEvent,
          forwardCookies: req.headers.get("cookie") ?? undefined,
        });

        sendEvent({
          phase: "complete",
          message: `Simulation complete — ${result.turns.length} turns`,
          detail: {
            callId: result.callId,
            turnCount: result.turns.length,
            transcriptLength: result.transcript.length,
            pipelineResult: result.pipelineResult,
          },
        });
      } catch (err: any) {
        console.error("[test-harness/run-sim] Error:", err);
        sendEvent({
          phase: "error",
          message: err.message || "Simulation failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
