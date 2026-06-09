import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { executeComposition, loadComposeConfig, persistComposedPrompt } from "@/lib/prompt/composition";
import { renderPromptSummary } from "@/lib/prompt/composition/renderPromptSummary";
import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import { isSessionModelV2Enabled } from "@/lib/voice/session-flag";
import { createSession } from "@/lib/voice/create-session";

/**
 * @api POST /api/test-harness/onboarding-call
 * @visibility internal
 * @auth ADMIN
 * @tags test-harness
 * @description Compose an onboarding prompt and create the first call record for a caller.
 *   Optionally generates the AI's opening greeting.
 * @body callerId string - Caller to onboard (required)
 * @body runInitialGreeting boolean - Generate AI's opening message (default true)
 * @response 200 { ok: true, prompt: object, call: object, greeting?: string }
 * @response 400 { ok: false, error: "..." }
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth("ADMIN");
  if (isAuthError(authResult)) return authResult.error;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { callerId, runInitialGreeting = true } = body;

  if (!callerId) {
    return NextResponse.json({ ok: false, error: "callerId is required" }, { status: 400 });
  }

  try {
    // Verify caller exists with domain
    const caller = await prisma.caller.findUnique({
      where: { id: callerId },
      include: { domain: true },
    });
    if (!caller) {
      return NextResponse.json({ ok: false, error: "Caller not found" }, { status: 404 });
    }

    // Step 1: Compose prompt
    const { fullSpecConfig, sections, specSlug } = await loadComposeConfig({});
    const composition = await executeComposition(callerId, sections, fullSpecConfig);
    const promptSummary = renderPromptSummary(composition.llmPrompt);

    const composedPrompt = await persistComposedPrompt(composition, promptSummary, {
      callerId,
      triggerType: "sim",
    });

    console.log(`[test-harness/onboarding-call] Prompt composed for caller ${callerId}: ${composedPrompt.id}`);

    // Step 2: Create call record
    const lastCall = await prisma.call.findFirst({
      where: { callerId },
      orderBy: { callSequence: "desc" },
    });
    const nextSequence = (lastCall?.callSequence ?? 0) + 1;

    // #1342 — when the Session Model V2 flag is on, write a VOICE_CALL
    // Session parent for the harness call so its narrative card lands in
    // the Tune tab. Source "harness" so the proof script can distinguish.
    let sessionParentId: string | null = null;
    if (isSessionModelV2Enabled()) {
      const result = await createSession({
        callerId,
        kind: "VOICE_CALL",
        source: "harness",
        voiceProvider: null,
      });
      sessionParentId = result.session.id;
    }

    const call = await prisma.call.create({
      data: {
        callerId,
        source: "ai-simulation",
        callSequence: nextSequence,
        transcript: "",
        usedPromptId: composedPrompt.id,
        previousCallId: lastCall?.id || null,
        ...(sessionParentId ? { sessionId: sessionParentId } : {}),
      },
    });

    console.log(`[test-harness/onboarding-call] Call #${nextSequence} created for caller ${callerId}: ${call.id}`);

    // Step 3: Optionally generate AI greeting
    let greeting: string | undefined;
    if (runInitialGreeting) {
      try {
        const systemPrompt = promptSummary || "You are a helpful AI assistant. Greet the caller warmly.";
        // @ai-call test-harness.greeting — Generate initial greeting for onboarding call | config: /x/ai-config
        const result = await getConfiguredMeteredAICompletion(
          {
            callPoint: "test-harness.greeting",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: "[Call begins — this is the caller's first session. Introduce yourself warmly.]" },
            ],
            maxTokens: 300,
            temperature: 0.85,
          },
          { callerId, callId: call.id, sourceOp: "test-harness.onboarding" }
        );
        greeting = result.content;
      } catch (err: any) {
        console.error("[test-harness/onboarding-call] Greeting generation failed:", err.message);
        // Non-fatal — return result without greeting
      }
    }

    return NextResponse.json({
      ok: true,
      prompt: {
        id: composedPrompt.id,
        summary: promptSummary?.slice(0, 200) + (promptSummary && promptSummary.length > 200 ? "..." : ""),
        status: composedPrompt.status,
        composedAt: composedPrompt.composedAt,
      },
      call: {
        id: call.id,
        callSequence: call.callSequence,
        source: call.source,
      },
      greeting,
    });
  } catch (err: any) {
    console.error("[test-harness/onboarding-call] Error:", err);
    return NextResponse.json(
      { ok: false, error: err.message || "Failed to create onboarding call" },
      { status: 500 }
    );
  }
}
