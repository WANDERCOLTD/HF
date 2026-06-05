import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import {
  resolveCallerScopeForReading,
  isScopeError,
} from "@/lib/learner-scope";
import {
  resolveVoiceProviderForCaller,
} from "@/lib/voice/resolve-voice-provider";
import { startVoiceSpan } from "@/lib/voice/telemetry";

export const runtime = "nodejs";

const bodySchema = z
  .object({
    callerId: z.string().min(1),
    /** Intent hint — populates `runtime.hasChatRail` optimistically at
     *  assistant-request time before the SSE has actually connected. The
     *  SSE registry is still the source of truth for the tools router. */
    intent: z.enum(["chat", "audio-only"]).optional().default("chat"),
    /** When provided, the operator-side override picks a specific
     *  provider for this session (overrides #1027 cascade). The
     *  per-session override is NOT persisted on Caller — that's
     *  what the per-caller setting is for. */
    overrideProviderSlug: z.string().min(1).max(64).optional(),
  })
  .strict();

/**
 * @api POST /api/voice/calls/start
 * @visibility internal
 * @scope voice:calls:start
 * @auth session ANY
 * @tags voice, calls, anyvoice
 * @description Start a provider call (#1092). Resolves the active voice
 *   provider via #1027 cascade (or the operator-supplied
 *   `overrideProviderSlug`), creates a placeholder `Call` row so the
 *   SSE channel has a stable id, and returns a token shape suitable for
 *   the browser's WebRTC SDK (`@vapi-ai/web` today).
 *
 *   The returned `callId` is HF's local id — the provider's external id
 *   isn't known until the provider's webhook fires. The SSE registry
 *   keys on `callId`, not the external one.
 *
 *   STUDENT sessions can only start calls for their own linked Caller.
 *   OPERATOR+ sessions can start for any callerId.
 *
 * @body {
 *   callerId: string,
 *   intent?: "chat" | "audio-only",
 *   overrideProviderSlug?: string,
 * }
 * @response 200 {
 *   ok: true,
 *   callId: string,
 *   providerSlug: string,
 *   adapterKey: string,
 *   mode: "webrtc",
 *   webrtcConfig: { sdk: "vapi" | "retell", publicKey?: string,
 *                   assistantOverridesUrl?: string },
 *   expiresAt: string (ISO),
 * }
 * @response 400 { ok: false, error: zod issues }
 * @response 401 { ok: false, error: "Unauthorized" }
 * @response 403 { ok: false, error: "No learner profile" }
 * @response 404 { ok: false, error: "Caller not found" }
 */
export async function POST(request: Request) {
  const auth = await requireAuth("VIEWER");
  if (isAuthError(auth)) return auth.error;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.message },
      { status: 400 },
    );
  }

  // STUDENT-scope guard (#977 leak-class). A STUDENT can only start a
  // call for their own learner Caller; OPERATOR+ passes through.
  const scope = await resolveCallerScopeForReading(
    auth.session,
    parsed.data.callerId,
  );
  if (isScopeError(scope)) return scope.error;
  const callerId = scope.scopedCallerId;
  if (!callerId) {
    return NextResponse.json(
      { ok: false, error: "callerId missing after scope resolution" },
      { status: 400 },
    );
  }
  if (callerId !== parsed.data.callerId) {
    // Operator passed a foreign callerId on a STUDENT session — already
    // remapped to the STUDENT's own caller; nothing further to do, but
    // log so the audit trail captures the attempted scope escape.
    console.warn(
      `[voice/calls/start] STUDENT remapped requested callerId from ${parsed.data.callerId} to own ${callerId}`,
    );
  }

  const endSpan = startVoiceSpan({
    slug: parsed.data.overrideProviderSlug ?? "auto",
    operation: "voice:calls:start",
  });

  try {
    const caller = await prisma.caller.findUnique({
      where: { id: callerId },
      select: { id: true, phone: true, name: true },
    });
    if (!caller) {
      endSpan({ errorMessage: "Caller not found" });
      return NextResponse.json(
        { ok: false, error: "Caller not found" },
        { status: 404 },
      );
    }

    // Resolve provider — operator override beats #1027 cascade.
    let providerSlug: string;
    if (parsed.data.overrideProviderSlug) {
      providerSlug = parsed.data.overrideProviderSlug;
    } else {
      const resolved = await resolveVoiceProviderForCaller(caller.id);
      providerSlug = resolved.slug;
    }

    const providerRow = await prisma.voiceProvider.findUnique({
      where: { slug: providerSlug },
      select: {
        id: true,
        slug: true,
        adapterKey: true,
        enabled: true,
        credentials: true,
      },
    });
    if (!providerRow || !providerRow.enabled) {
      endSpan({ errorMessage: `Provider ${providerSlug} unavailable` });
      return NextResponse.json(
        {
          ok: false,
          error: `Voice provider "${providerSlug}" is not enabled`,
        },
        { status: 503 },
      );
    }

    // Pre-create the Call row so the SSE channel has a stable id. The
    // provider's webhook will update this row's externalId / capture
    // fields when the call actually ends.
    const placeholderCall = await prisma.call.create({
      data: {
        callerId: caller.id,
        source: providerSlug,
        voiceProvider: providerSlug,
        // externalId is filled in by the webhook handler once the
        // provider sends its first event. Leaving it null is fine —
        // the field is indexed but not unique on Call.
        transcript: "",
      },
      select: { id: true },
    });

    // Surface the provider's public key for the browser SDK. Marketing-
    // safe credentials only; HMAC secret + private api key stay in the
    // VoiceProvider row and are never sent to the client.
    const creds = (providerRow.credentials ?? {}) as Record<string, unknown>;
    const publicKey =
      typeof creds.publicKey === "string" ? creds.publicKey : undefined;

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const sdk =
      providerRow.adapterKey === "vapi"
        ? "vapi"
        : providerRow.adapterKey === "retell"
          ? "retell"
          : "vapi";

    const response = NextResponse.json({
      ok: true,
      callId: placeholderCall.id,
      providerSlug: providerRow.slug,
      adapterKey: providerRow.adapterKey,
      mode: "webrtc" as const,
      webrtcConfig: {
        sdk,
        publicKey,
        // The Vapi Web SDK can take an assistantId or an in-line
        // assistant override. For our model the prompt is per-caller
        // and resolved at the provider's `assistant-request` webhook,
        // so the SDK only needs the publicKey + caller metadata.
        callerName: caller.name,
      },
      expiresAt,
    });
    endSpan({
      callerId: caller.id,
      callId: placeholderCall.id,
      metadata: { providerSlug: providerRow.slug, intent: parsed.data.intent },
    });
    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    endSpan({ errorMessage: message });
    return NextResponse.json(
      { ok: false, error: message || "Call start failed" },
      { status: 500 },
    );
  }
}
