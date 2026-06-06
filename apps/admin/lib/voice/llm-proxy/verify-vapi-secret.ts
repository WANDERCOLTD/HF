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

  // #922 — VAPI's inline custom-llm spec rejects `model.secret`, so the
  // assistant config encodes the secret as `?secret=` on the URL instead.
  // Accept from EITHER the header (long-term preferred) OR the query
  // param (current VAPI-compatible path).
  const headerVal = request.headers.get(HEADER_NAME) ?? "";
  let queryVal = "";
  let urlParseError: string | null = null;
  try {
    queryVal = new URL(request.url).searchParams.get("secret") ?? "";
  } catch (e) {
    urlParseError = e instanceof Error ? e.message : String(e);
  }
  const presented = headerVal || queryVal;
  log("system", "voice.llm_proxy.secret.debug", {
    level: "info",
    slug,
    requestUrl: request.url,
    headerValLen: headerVal.length,
    queryValLen: queryVal.length,
    presentedLen: presented.length,
    urlParseError,
    expectedLen: expectedRaw.length,
    expectedHead: expectedRaw.slice(0, 2),
    queryValHead: queryVal.slice(0, 4),
  });
  if (!presented) {
    log("system", "voice.llm_proxy.secret.missing_header", {
      level: "error",
      slug,
      expectedLen: expectedRaw.length,
    });
    return {
      ok: false,
      response: NextResponse.json(
        { error: { message: `Missing secret (header ${HEADER_NAME} or ?secret query)`, type: "auth_error" } },
        { status: 401 },
      ),
    };
  }

  // #922 — Accept if EITHER header OR query matches. VAPI may send its
  // own `x-vapi-secret` value (call signature) at a different length, so
  // we can't pick one source-of-truth. Validate both candidates with a
  // timing-safe compare against the expected value.
  const expectedBuf = Buffer.from(expectedRaw);
  const candidates: Array<{ source: "header" | "query"; value: string }> = [];
  if (headerVal) candidates.push({ source: "header", value: headerVal });
  if (queryVal) candidates.push({ source: "query", value: queryVal });

  for (const { source, value } of candidates) {
    const buf = Buffer.from(value);
    if (buf.length === expectedBuf.length && crypto.timingSafeEqual(expectedBuf, buf)) {
      log("system", "voice.llm_proxy.secret.ok", {
        level: "info",
        slug,
        expectedLen: expectedBuf.length,
        source,
      });
      return { ok: true, providerSlug: providerRow.slug };
    }
  }

  log("system", "voice.llm_proxy.secret.no_match", {
    level: "error",
    slug,
    expectedLen: expectedBuf.length,
    candidateSources: candidates.map((c) => c.source),
    candidateLens: candidates.map((c) => c.value.length),
  });
  return {
    ok: false,
    response: NextResponse.json(
      { error: { message: "Invalid secret", type: "auth_error" } },
      { status: 401 },
    ),
  };
}
