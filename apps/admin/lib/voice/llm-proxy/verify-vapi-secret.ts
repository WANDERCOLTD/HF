/**
 * x-vapi-secret shared-secret verification (#1176).
 *
 * VAPI's `custom-llm` provider authenticates requests to HF using a
 * shared-secret header `x-vapi-secret` (NOT the HMAC-SHA256 signature
 * scheme VAPI uses on webhooks). We treat the secret like any other
 * credential: lookup the VoiceProvider row by slug, read
 * `credentials.webhookSecret`, compare against the request header via
 * `crypto.timingSafeEqual` after a length assertion.
 *
 * Timing-safe comparison is mandatory (TL review). Direct string `===`
 * is a fail-condition in code review.
 *
 * Local-dev safety: if `credentials.webhookSecret` is unset / empty,
 * verification passes through. This is the same convention as
 * `lib/voice/providers/vapi/auth.ts::verifyVapiRequest`. Production
 * safety is the operator's job — the deploy preflight should alert when
 * a provider is enabled but webhookSecret is empty.
 */

import * as crypto from "node:crypto";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { log } from "@/lib/logger";

const HEADER_NAME = "x-vapi-secret";

export interface SecretVerifyResult {
  /** True when verification passed (either secret matched OR no secret configured). */
  ok: boolean;
  /** When `ok === false`, a JSON 401 response ready to return. */
  response?: NextResponse;
  /** Provider slug that owned the secret, for telemetry tagging. */
  providerSlug?: string;
}

/**
 * Verify the request's `x-vapi-secret` header against the slug's
 * stored webhookSecret. Pass-through when no secret is configured.
 */
export async function verifyVapiSecret(
  request: Request,
  slug: string,
): Promise<SecretVerifyResult> {
  const headerPresent = request.headers.get(HEADER_NAME) !== null;
  const headerLen = (request.headers.get(HEADER_NAME) ?? "").length;

  const providerRow = await prisma.voiceProvider.findUnique({
    where: { slug },
    select: { slug: true, credentials: true },
  });

  if (!providerRow) {
    log("system", "voice.llm_proxy.secret.unknown_slug", {
      level: "error",
      slug,
      headerPresent,
      headerLen,
    });
    return {
      ok: false,
      response: NextResponse.json(
        { error: { message: `Unknown voice provider slug: ${slug}`, type: "auth_error" } },
        { status: 401 },
      ),
    };
  }

  const creds = (providerRow.credentials as Record<string, unknown>) ?? {};
  const expectedRaw = typeof creds.webhookSecret === "string" ? creds.webhookSecret : "";

  // Pass-through when no secret is configured (local-dev convention).
  if (!expectedRaw) {
    log("system", "voice.llm_proxy.secret.passthrough", {
      level: "warn",
      slug,
      headerPresent,
      headerLen,
      message: "No webhookSecret configured for provider — auth passthrough (dev)",
    });
    return { ok: true, providerSlug: providerRow.slug };
  }

  const presented = request.headers.get(HEADER_NAME) ?? "";
  if (!presented) {
    log("system", "voice.llm_proxy.secret.missing_header", {
      level: "error",
      slug,
      expectedLen: expectedRaw.length,
    });
    return {
      ok: false,
      response: NextResponse.json(
        { error: { message: `Missing ${HEADER_NAME} header`, type: "auth_error" } },
        { status: 401 },
      ),
    };
  }

  const expectedBuf = Buffer.from(expectedRaw);
  const presentedBuf = Buffer.from(presented);

  if (expectedBuf.length !== presentedBuf.length) {
    log("system", "voice.llm_proxy.secret.length_mismatch", {
      level: "error",
      slug,
      expectedLen: expectedBuf.length,
      presentedLen: presentedBuf.length,
    });
    return {
      ok: false,
      response: NextResponse.json(
        { error: { message: "Invalid secret", type: "auth_error" } },
        { status: 401 },
      ),
    };
  }

  if (!crypto.timingSafeEqual(expectedBuf, presentedBuf)) {
    log("system", "voice.llm_proxy.secret.value_mismatch", {
      level: "error",
      slug,
      expectedLen: expectedBuf.length,
      presentedLen: presentedBuf.length,
    });
    return {
      ok: false,
      response: NextResponse.json(
        { error: { message: "Invalid secret", type: "auth_error" } },
        { status: 401 },
      ),
    };
  }

  log("system", "voice.llm_proxy.secret.ok", {
    level: "info",
    slug,
    expectedLen: expectedBuf.length,
  });
  return { ok: true, providerSlug: providerRow.slug };
}
