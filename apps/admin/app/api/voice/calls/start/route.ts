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
import { buildAssistantConfigForCaller } from "@/lib/voice/build-assistant-config";
import { createSession } from "@/lib/voice/create-session";

export const runtime = "nodejs";

export const bodySchema = z
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
    /** #1391 — module slug the learner picked (via `?requestedModuleId=`
     *  in the sim URL or `Caller.lastSelectedModuleId`). Forwarded to
     *  `createCallEnteringPipeline` so the placeholder Call carries the
     *  picked module from creation. Without this the WebRTC path
     *  dropped the param at the SimChat boundary and the call entered
     *  the pipeline with `requestedModuleId = null`. */
    requestedModuleId: z.string().min(1).max(128).optional(),
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
 *   requestedModuleId?: string,
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
        config: true,
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

    // G6 / #1154 / #1333 — pre-resolve playbook + default module BEFORE the
    // call row is created and attribute the placeholder so COMPOSE has a
    // scope from the very first event.
    //
    // #1344 Slice 4 — `createCallEnteringPipeline` wrapper deleted; we
    // now call `createSession({kind:VOICE_CALL})` directly and create
    // the Call child here. createSession owns the chain-contract cascade
    // (resolveActivePlaybookId → requestedModuleId → CurriculumModule)
    // plus the atomic Session sequencer + voiceConfigSnapshot.
    const sessionResult = await createSession({
      callerId: caller.id,
      kind: "VOICE_CALL",
      source: providerSlug,
      voiceProvider: providerSlug,
      // #1391 — explicit module hint beats the
      // `Caller.lastSelectedModuleId` fallback inside the builder, so a
      // mid-session URL change picks up the new module on the very next
      // [Talk Here] click rather than the previous pick.
      ...(parsed.data.requestedModuleId
        ? { requestedModuleId: parsed.data.requestedModuleId }
        : {}),
    });
    const placeholderCall = await prisma.call.create({
      data: {
        callerId: caller.id,
        source: providerSlug,
        voiceProvider: providerSlug,
        transcript: "",
        sessionId: sessionResult.session.id,
        ...(sessionResult.playbookId ? { playbookId: sessionResult.playbookId } : {}),
        ...(sessionResult.requestedModuleId
          ? { requestedModuleId: sessionResult.requestedModuleId }
          : {}),
        ...(sessionResult.curriculumModuleId
          ? { curriculumModuleId: sessionResult.curriculumModuleId }
          : {}),
        ...(sessionResult.usedPromptId
          ? { usedPromptId: sessionResult.usedPromptId }
          : {}),
      },
      select: { id: true },
    });
    if (sessionResult.playbookId && sessionResult.requestedModuleId) {
      console.log(
        `[voice/calls/start] G6 auto-resolved module for caller=${caller.id.slice(0, 8)} playbook=${sessionResult.playbookId.slice(0, 8)} → ${sessionResult.requestedModuleId}`,
      );
    }

    // Surface the provider's public key for the browser SDK. Marketing-
    // safe credentials only; HMAC secret + private api key stay in the
    // VoiceProvider row and are never sent to the client.
    //
    // publicKey is declared `sensitive: false` so the admin page writes it
    // to `config`, not `credentials`. Read from config first, fall back to
    // credentials for older rows.
    const creds = (providerRow.credentials ?? {}) as Record<string, unknown>;
    const conf = (providerRow.config ?? {}) as Record<string, unknown>;
    const publicKey =
      typeof conf.publicKey === "string"
        ? conf.publicKey
        : typeof creds.publicKey === "string"
          ? creds.publicKey
          : undefined;

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const sdk =
      providerRow.adapterKey === "vapi"
        ? "vapi"
        : providerRow.adapterKey === "retell"
          ? "retell"
          : "vapi";

    // Path B: build the full inline assistant config server-side and
    // hand it to the browser. The Web SDK doesn't trigger our
    // assistant-request webhook — it expects an inline config — so the
    // browser passes this object straight to vapi.start(assistantConfig).
    // Includes cost-safety knobs from VoiceSystemSettings (silence
    // timeout, max duration, voicemail detection, end-call phrases).
    const built = await buildAssistantConfigForCaller({
      callerId: caller.id,
      slug: providerRow.slug,
      intent: parsed.data.intent,
      callIdForRuntime: placeholderCall.id,
    });

    // #1361 — Inject HF placeholder id into assistant.metadata so the
    // provider echoes it on every webhook (transcript_update, status,
    // end-of-call). Without this, the WebRTC path has no way for the
    // webhook handler to map provider call-id → our placeholder Call row,
    // and the SimChat SSE subscription receives no transcript-partial
    // events. PSTN doesn't need this — outbound-dial captures the VAPI
    // call.id synchronously from the POST /call response — but passing
    // metadata on both paths is harmless and uniform.
    const assistantConfigWithMeta = injectAssistantMetadata(
      built.assistantConfig,
      { hfCallId: placeholderCall.id },
    );

    const response = NextResponse.json({
      ok: true,
      callId: placeholderCall.id,
      providerSlug: providerRow.slug,
      adapterKey: providerRow.adapterKey,
      mode: "webrtc" as const,
      webrtcConfig: {
        sdk,
        publicKey,
        callerName: caller.name,
        // Inline assistant config — Web SDK consumes this directly.
        // PSTN dial-in uses the assistant-request webhook instead;
        // both paths share the same builder so behaviour is identical.
        assistantConfig: assistantConfigWithMeta,
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

/**
 * Inject `metadata` onto the assistant object inside a provider-shaped
 * assistant config (#1361). Adapters return `{ assistant: {...} }` (VAPI
 * shape) — write the metadata on the inner object so VAPI echoes it back
 * on every webhook (transcript / status-update / end-of-call). When the
 * adapter doesn't wrap (`{...}` directly), merge at the root. Pure;
 * doesn't mutate the input.
 */
function injectAssistantMetadata(
  assistantConfig: Record<string, unknown>,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const inner = (assistantConfig as { assistant?: Record<string, unknown> })
    .assistant;
  if (inner && typeof inner === "object") {
    const existing = (inner.metadata as Record<string, unknown> | undefined) ?? {};
    return {
      ...assistantConfig,
      assistant: {
        ...inner,
        metadata: { ...existing, ...metadata },
      },
    };
  }
  const existing = (assistantConfig.metadata as Record<string, unknown> | undefined) ?? {};
  return {
    ...assistantConfig,
    metadata: { ...existing, ...metadata },
  };
}
