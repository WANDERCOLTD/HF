/**
 * VAPI custom-llm proxy — path-segment auth surface (#1441).
 *
 * VAPI's custom-llm client APPENDS `/chat/completions` to whatever URL
 * the assistant config provides. Both `model.secret` (rejected by
 * schema) and `?secret=…` (mangled into the appended suffix) failed
 * (#922). The path-segment scheme survives intact:
 *
 *   assistant.model.url = "<host>/api/voice/vapi/llm-proxy/auth/<HEX>"
 *   VAPI appends "/chat/completions"
 *   ─────────────────────────────────────────────────────────────────
 *   final POST → "<host>/api/voice/vapi/llm-proxy/auth/<HEX>/chat/completions"
 *
 * Next.js matches the `[secret]` dynamic segment, hands it as
 * `params.secret`. We hex-validate (defence against `..` traversal),
 * timing-safe-compare against `credentials.webhookSecret`, then call
 * the shared body handler.
 *
 * Format gate: only `[A-Fa-f0-9]` accepted in the path param. Any other
 * character class returns 400 BEFORE the timing-safe compare runs —
 * this stops path-traversal probes (`..`, slashes) and reserves the URL
 * shape for the hex secrets the operator actually generates via
 * `openssl rand -hex 32`.
 */

import { NextResponse } from "next/server";
import { log } from "@/lib/logger";
import { runVapiChatCompletion } from "@/lib/voice/llm-proxy/run-vapi-chat-completion";
import { verifyVapiSecretFromPath } from "@/lib/voice/llm-proxy/verify-vapi-secret";

export const runtime = "nodejs";

const VAPI_SLUG = "vapi";

const HEX_ONLY = /^[A-Fa-f0-9]+$/;
/** Defensive lower + upper bounds. `openssl rand -hex 32` → 64 chars.
 *  A short token (e.g. 16 chars hex = 64 bits of entropy) is weak but
 *  not invalid; reject below 8 chars and above 256. */
const MIN_SECRET_LEN = 8;
const MAX_SECRET_LEN = 256;

/**
 * @api POST /api/voice/llm-proxy/auth/[secret]/chat/completions
 * @visibility public
 * @scope voice:llm-proxy:chat-completions
 * @auth path-segment shared-secret
 * @tags voice, anyvoice, custom-llm, path-segment-auth
 * @description VAPI custom-llm proxy with auth via URL path segment.
 *   Companion to `/api/voice/llm-proxy/chat/completions` (header auth /
 *   pass-through). Both share the same body handler.
 *
 * @response 200 — same shape as the header-auth route
 * @response 400 — invalid secret format in path (non-hex / too short / too long)
 * @response 401 — path secret doesn't match stored webhookSecret
 * @response 500 — Anthropic upstream error
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ secret: string }> },
): Promise<Response> {
  const { secret } = await params;
  const callIdHeader = request.headers.get("x-vapi-call-id") ?? null;
  log("api", "voice.llm_proxy.arrive", {
    level: "info",
    callId: callIdHeader,
    userAgent: request.headers.get("user-agent") ?? null,
    authSurface: "path-segment",
    secretLen: secret?.length ?? 0,
  });

  if (!secret || typeof secret !== "string") {
    log("system", "voice.llm_proxy.path.empty", {
      level: "error",
      callId: callIdHeader,
    });
    return NextResponse.json(
      { error: { message: "Empty path secret", type: "invalid_request_error" } },
      { status: 400 },
    );
  }
  if (secret.length < MIN_SECRET_LEN || secret.length > MAX_SECRET_LEN) {
    log("system", "voice.llm_proxy.path.bad_length", {
      level: "error",
      callId: callIdHeader,
      secretLen: secret.length,
    });
    return NextResponse.json(
      {
        error: {
          message: `Path secret length out of bounds (${MIN_SECRET_LEN}–${MAX_SECRET_LEN})`,
          type: "invalid_request_error",
        },
      },
      { status: 400 },
    );
  }
  if (!HEX_ONLY.test(secret)) {
    log("system", "voice.llm_proxy.path.non_hex", {
      level: "error",
      callId: callIdHeader,
      secretLen: secret.length,
    });
    return NextResponse.json(
      {
        error: {
          message: "Path secret must be hexadecimal characters only",
          type: "invalid_request_error",
        },
      },
      { status: 400 },
    );
  }

  const auth = await verifyVapiSecretFromPath(secret, VAPI_SLUG);
  if (!auth.ok) {
    log("system", "voice.llm_proxy.auth_failed", {
      level: "error",
      callId: callIdHeader,
      authSurface: "path-segment",
    });
    return auth.response ?? NextResponse.json(
      { error: { message: "Auth failed", type: "auth_error" } },
      { status: 401 },
    );
  }
  return runVapiChatCompletion(request);
}
