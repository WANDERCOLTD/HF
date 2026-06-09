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
import { buildAssistantConfigForCaller } from "@/lib/voice/build-assistant-config";
import { startVoiceSpan, logVoiceEvent } from "@/lib/voice/telemetry";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

const bodySchema = z
  .object({
    callerId: z.string().min(1),
    overrideProviderSlug: z.string().min(1).max(64).optional(),
  })
  .strict();

/**
 * @api POST /api/voice/calls/outbound-dial
 * @visibility internal
 * @scope voice:calls:outbound-dial
 * @auth session ANY (STUDENT scoped to own caller)
 * @tags voice, calls, anyvoice
 * @description PSTN outbound dial — VAPI rings `Caller.phone` and the
 *   learner picks up on their actual phone. Different surface from
 *   `/api/voice/calls/start` (which is browser WebRTC).
 *
 *   Cost-bearing: every dial burns PSTN minutes (~$0.05/min on top of
 *   LLM cost). Operator confirms on the UI side; this route is the
 *   trigger.
 *
 *   The assistant config (prompt, tools, knowledge, cost-safety knobs)
 *   is built by the same shared helper as the WebRTC path. VAPI calls
 *   our `/api/voice/vapi/assistant-request` webhook at call-start, so
 *   PSTN gets the same per-caller composed prompt the Web SDK does.
 *
 *   STUDENT-scope guard ensures a learner can only dial themselves.
 *
 * @body { callerId: string, overrideProviderSlug?: string }
 * @response 200 { ok: true, callId, vapiCallId, providerSlug, status }
 * @response 400 { ok: false, error: zod issues }
 * @response 403 { ok: false, error: "Forbidden" } (STUDENT cross-caller)
 * @response 404 { ok: false, error: "Caller not found" }
 * @response 409 { ok: false, error: "Caller has no phone on file" }
 * @response 502 { ok: false, error: "VAPI returned …" }
 * @response 503 { ok: false, error: "Provider not configured for outbound dial" }
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

  // STUDENT-scope guard — same shape as `/api/voice/calls/start`.
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

  const endSpan = startVoiceSpan({
    slug: parsed.data.overrideProviderSlug ?? "auto",
    operation: "voice:calls:outbound-dial",
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

    if (!caller.phone) {
      endSpan({ errorMessage: "Caller has no phone on file" });
      return NextResponse.json(
        {
          ok: false,
          error:
            "We don't have a phone number for this caller. Capture one before dialling.",
        },
        { status: 409 },
      );
    }

    // Pick provider — operator override beats #1027 cascade.
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

    const creds = (providerRow.credentials ?? {}) as Record<string, unknown>;
    const conf = (providerRow.config ?? {}) as Record<string, unknown>;
    const apiKey = typeof creds.apiKey === "string" ? creds.apiKey : null;
    // phoneNumberId is declared `sensitive: false` so the admin page writes
    // it to `config`, not `credentials`. Read from config first, fall back
    // to credentials for older rows.
    const phoneNumberId =
      typeof conf.phoneNumberId === "string"
        ? conf.phoneNumberId
        : typeof creds.phoneNumberId === "string"
          ? creds.phoneNumberId
          : null;
    if (!apiKey || !phoneNumberId) {
      endSpan({ errorMessage: "Provider missing apiKey or phoneNumberId" });
      return NextResponse.json(
        {
          ok: false,
          error:
            "This provider isn't configured for outbound dial — set `apiKey` AND `phoneNumberId` in the admin (the phoneNumberId is the VAPI phone number used to dial from).",
        },
        { status: 503 },
      );
    }

    // Pre-create the Call row so we have a stable id even before VAPI
    // sends its first webhook. Mirrors the WebRTC call-start flow.
    const placeholderCall = await prisma.call.create({
      data: {
        callerId: caller.id,
        source: providerSlug,
        voiceProvider: providerSlug,
        transcript: "",
      },
      select: { id: true },
    });

    // Build the inline assistant config so VAPI's PSTN call uses the
    // same per-caller prompt + tools + knowledge + cost-safety knobs
    // the WebRTC path uses. The assistant-request webhook is not used
    // when we send `assistant` inline.
    const built = await buildAssistantConfigForCaller({
      callerId: caller.id,
      slug: providerRow.slug,
      intent: "audio-only",
      callIdForRuntime: placeholderCall.id,
    });
    const inlineAssistant =
      (built.assistantConfig as { assistant?: Record<string, unknown> })
        .assistant ?? built.assistantConfig;

    // Fire the dial. VAPI's outbound dial API expects
    // `phoneNumberId` (the VAPI number to dial FROM), `customer.number`
    // (the learner's phone), and either `assistantId` or inline
    // `assistant`. We always send inline.
    let vapiCallId: string | null = null;
    try {
      // Defence-in-depth E.164 — storage paths normalise (#1141 follow-up),
      // but legacy rows pre-date that fix and may still hold `07…` UK
      // domestic format. VAPI requires strict E.164 (400 otherwise).
      const { toE164, isE164 } = await import("@/lib/voice/phone-format");
      const e164 = toE164(caller.phone) ?? caller.phone;
      if (!isE164(e164)) {
        await prisma.call.delete({ where: { id: placeholderCall.id } });
        endSpan({ errorMessage: `Caller phone not in E.164: ${caller.phone}` });
        return NextResponse.json(
          {
            ok: false,
            error: "Caller's phone number is not in a valid international format.",
          },
          { status: 400 },
        );
      }
      // #922 — log the model block we're about to send so the next
      // VAPI rejection is debuggable from /x/logs without a repro.
      const modelBlock = (inlineAssistant as { model?: Record<string, unknown> })?.model ?? null;
      log("api", "voice.outbound_dial.assistant", {
        level: "info",
        callId: placeholderCall.id,
        callerIdShort: caller.id.slice(0, 8),
        providerSlug: providerRow.slug,
        modelProvider: modelBlock?.provider ?? null,
        modelName: modelBlock?.model ?? null,
        modelUrl: modelBlock?.url ?? null,
        hasModelSecret: typeof modelBlock?.secret === "string" && (modelBlock.secret as string).length > 0,
        firstLine: (inlineAssistant as { firstMessage?: string })?.firstMessage ?? null,
        serverUrl: (inlineAssistant as { serverUrl?: string })?.serverUrl ?? null,
      });
      const vapiResp = await fetch("https://api.vapi.ai/call", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          phoneNumberId,
          customer: { number: e164 },
          assistant: inlineAssistant,
        }),
      });
      const vapiBody = (await vapiResp.json().catch(() => null)) as
        | { id?: string; error?: string; message?: string }
        | null;
      if (!vapiResp.ok || !vapiBody?.id) {
        const message =
          vapiBody?.error ||
          vapiBody?.message ||
          `VAPI HTTP ${vapiResp.status}`;
        // #922 — log the full VAPI rejection BEFORE we delete the
        // placeholder. The placeholder delete used to take the only
        // forensic trail with it.
        log("system", "voice.outbound_dial.vapi_rejected", {
          level: "error",
          callId: placeholderCall.id,
          callerIdShort: caller.id.slice(0, 8),
          providerSlug: providerRow.slug,
          httpStatus: vapiResp.status,
          vapiError: vapiBody?.error ?? null,
          vapiMessage: vapiBody?.message ?? null,
          vapiBody: vapiBody ? JSON.stringify(vapiBody).slice(0, 1500) : null,
        });
        await prisma.call.delete({ where: { id: placeholderCall.id } });
        endSpan({ errorMessage: message });
        return NextResponse.json(
          { ok: false, error: `VAPI returned: ${message}` },
          { status: 502 },
        );
      }
      vapiCallId = vapiBody.id;
    } catch (err) {
      await prisma.call.delete({ where: { id: placeholderCall.id } });
      const message = err instanceof Error ? err.message : String(err);
      endSpan({ errorMessage: message });
      return NextResponse.json(
        { ok: false, error: `Failed to call VAPI: ${message}` },
        { status: 502 },
      );
    }

    // Stamp the externalId so the webhook handler can merge by it.
    //
    // #1345 — Wrap in its own try/catch. Pre-fix this update sat OUTSIDE
    // the surrounding try/catch (which ends at the `} catch (err)` block
    // above wrapping the VAPI fetch). Any exception here silently
    // orphaned the placeholder — exactly Bertie's 10:06:02 ghost on
    // hf_sandbox 2026-06-08, where the placeholder lingered with
    // externalId=NULL and the webhook 47s later created a duplicate row.
    //
    // On exception: log structured context + explicitly delete the
    // placeholder (today's behaviour — keeps the DB clean) + return 502
    // so the operator knows the dial didn't complete cleanly.
    try {
      await prisma.call.update({
        where: { id: placeholderCall.id },
        data: { externalId: vapiCallId },
      });
    } catch (stampErr) {
      const stampMessage =
        stampErr instanceof Error ? stampErr.message : String(stampErr);
      log("system", "voice.outbound_dial.externalid_stamp_failed", {
        level: "error",
        callerId: caller.id,
        placeholderId: placeholderCall.id,
        vapiCallId,
        providerSlug: providerRow.slug,
        error: stampMessage,
      });
      // TODO(#1338-slice-1): replace delete with FailureLog write once
      // Slice 1 ships the FailureLog table. Today we delete the orphan
      // to keep the DB clean — without it the row sits with no
      // externalId, no endedAt, and is exactly the #1345 ghost class
      // that the poll-stale reconciler can't fix (it only polls rows
      // that HAVE an externalId).
      try {
        await prisma.call.delete({ where: { id: placeholderCall.id } });
      } catch (cleanupErr) {
        log("system", "voice.outbound_dial.placeholder_cleanup_failed", {
          level: "error",
          placeholderId: placeholderCall.id,
          error:
            cleanupErr instanceof Error
              ? cleanupErr.message
              : String(cleanupErr),
        });
      }
      endSpan({ errorMessage: `externalId stamp failed: ${stampMessage}` });
      return NextResponse.json(
        {
          ok: false,
          error: `Failed to stamp externalId on placeholder: ${stampMessage}`,
        },
        { status: 502 },
      );
    }

    logVoiceEvent({
      slug: providerRow.slug,
      operation: `voice:${providerRow.slug}:calls:outbound-dial`,
      durationMs: 0,
      callerId: caller.id,
      callId: placeholderCall.id,
      metadata: {
        vapiCallId,
        toMasked: caller.phone.replace(/(.{3})(.+)(.{4})/, "$1***$3"),
      },
    });
    endSpan({
      callerId: caller.id,
      callId: placeholderCall.id,
      metadata: { providerSlug: providerRow.slug },
    });

    return NextResponse.json({
      ok: true,
      callId: placeholderCall.id,
      vapiCallId,
      providerSlug: providerRow.slug,
      status: "dialing",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    endSpan({ errorMessage: message });
    return NextResponse.json(
      { ok: false, error: message || "Outbound dial failed" },
      { status: 500 },
    );
  }
}
