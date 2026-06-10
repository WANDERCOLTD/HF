/**
 * VAPI custom-llm proxy — OpenAI-compatible chat completions (#1176).
 *
 * **Header-auth surface.** VAPI POSTs here once per turn during a voice
 * call when the `voiceProvider.config.voiceProvider === "custom-llm"`
 * and `assistant.model.url === "<host>/api/voice/vapi/llm-proxy"`.
 *
 * Auth: `x-vapi-secret` header verified via timing-safe compare against
 * the VAPI VoiceProvider's `credentials.webhookSecret`. Pass-through
 * when the secret is empty (local-dev convention). When the operator
 * sets a webhookSecret, VAPI must include the matching header — but
 * VAPI's custom-llm client offers no first-class way to send custom
 * headers OR a non-mangled query param.
 *
 * **For a configured secret, use the path-segment route instead:**
 * `app/api/voice/llm-proxy/auth/[secret]/chat/completions/route.ts`.
 *
 * Auth pass-through here lets a dev VAPI assistant point at the
 * plain `/llm-proxy` URL during smoke testing without setup overhead.
 *
 * Body handling, translation, and telemetry live in
 * `lib/voice/llm-proxy/run-vapi-chat-completion.ts` so both auth
 * surfaces share them.
 */

import { NextResponse } from "next/server";
import { log } from "@/lib/logger";
import { runVapiChatCompletion } from "@/lib/voice/llm-proxy/run-vapi-chat-completion";
import { verifyVapiSecret } from "@/lib/voice/llm-proxy/verify-vapi-secret";

export const runtime = "nodejs";

const VAPI_SLUG = "vapi";

/**
 * @api POST /api/voice/llm-proxy/chat/completions
 * @visibility public
 * @scope voice:llm-proxy:chat-completions
 * @auth shared-secret (`x-vapi-secret` header) — pass-through when empty
 * @tags voice, anyvoice, custom-llm
 * @description VAPI custom-llm chat completions, OpenAI-compatible
 *   request shape, Anthropic upstream. See file docblock.
 *
 * @response 200 (streamed) — SSE OpenAI deltas (`text/event-stream`)
 * @response 200 (non-streamed) — `{ id, choices, usage }`
 * @response 400 — un-parseable request body
 * @response 401 — bad / missing `x-vapi-secret`
 * @response 500 — Anthropic upstream error (OpenAI-format error body)
 */
export async function POST(request: Request): Promise<Response> {
  const callIdHeader = request.headers.get("x-vapi-call-id") ?? null;
  log("api", "voice.llm_proxy.arrive", {
    level: "info",
    callId: callIdHeader,
    userAgent: request.headers.get("user-agent") ?? null,
    hasSecretHeader: request.headers.get("x-vapi-secret") !== null,
    authSurface: "header",
  });
  const auth = await verifyVapiSecret(request, VAPI_SLUG);
  if (!auth.ok) {
    log("system", "voice.llm_proxy.auth_failed", {
      level: "error",
      callId: callIdHeader,
      authSurface: "header",
    });
    return auth.response ?? NextResponse.json(
      { error: { message: "Auth failed", type: "auth_error" } },
      { status: 401 },
    );
  }
  return runVapiChatCompletion(request);
}
