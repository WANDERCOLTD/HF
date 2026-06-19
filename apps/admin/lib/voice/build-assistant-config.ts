/**
 * buildAssistantConfigForCaller — shared assistant-config builder
 * (PR voice-cost-knobs / Path B fix).
 *
 * Both the inbound assistant-request webhook AND the new Web SDK call-
 * start endpoint need the same "compose the provider's assistant config
 * for this caller" routine. This module is that routine extracted.
 *
 * Reuses every piece of upstream Logic:
 *   - `#1027 cascade` to pick the provider for this caller
 *   - TOOLS-001 enabled-tools loader (#1043)
 *   - ComposedPrompt → renderProviderPrompt with capability + runtime
 *     awareness (#1093)
 *   - VoiceSystemSettings cost-safety knobs (silenceTimeoutSeconds,
 *     maxDurationSeconds, voicemailDetectionEnabled, endCallPhrases)
 *
 * Returns `{ assistantConfig, providerSlug, voicePromptChars }` so the
 * caller can both pass it to the browser SDK AND log how many prompt
 * characters were sent (used by the telemetry span).
 */

import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";

import { getVoiceProvider } from "@/lib/voice/provider-factory";
import { resolveVoiceProviderForCaller } from "@/lib/voice/resolve-voice-provider";
import { loadToolDefinitions } from "@/lib/voice/load-tool-definitions";
import { resolveRuntimeFeatures } from "@/lib/voice/runtime-features";
import { renderProviderPrompt } from "@/lib/prompt/composition/renderPromptSummary";
import { resolvePlaybookId } from "@/lib/enrollment/resolve-playbook";
import { getVoiceCallSettings } from "@/lib/system-settings";
import { getVoiceSystemSettings } from "@/lib/voice/system-settings";
import { loadResolvedVoiceConfig } from "@/lib/voice/load-voice-config";
import { flatten as flattenVoice } from "@/lib/voice/config";
import {
  UNKNOWN_CALLER_FIRST_LINE,
  noActivePromptFirstLine,
} from "@/lib/prompt/composition/defaults/fallback-first-lines";
import type { ProviderAssistantConfig } from "@/lib/voice/types";

export interface BuildAssistantOptions {
  /** Caller this call is for. */
  callerId: string;
  /** Voice provider slug (typically resolved from the cascade by the
   *  caller, but the operator override on /api/voice/calls/start can
   *  pin a specific provider for this session). */
  slug: string;
  /** Intent hint for runtime features — drives the chat-rail flag the
   *  prompt's mid-call section branches on. */
  intent?: "chat" | "audio-only";
  /** When present, the runtime-features resolver consults the SSE
   *  registry to populate hasChatRail. For Web SDK call-start we don't
   *  yet have an SSE subscription (it opens after this call), so leave
   *  null and let `intent === "chat"` drive the flag. */
  callIdForRuntime?: string | null;
}

export interface BuildAssistantResult {
  /** The full inline assistant payload to hand to vapi.start(...) or
   *  return verbatim from /api/voice/.../assistant-request. */
  assistantConfig: ProviderAssistantConfig;
  /** Slug of the adapter that built the config (may differ from
   *  options.slug if the cascade picked something else and we honoured
   *  it — Web SDK path doesn't honour this; PSTN path does). */
  providerSlug: string;
  /** Char count of the rendered system prompt — for telemetry / size
   *  audits. */
  voicePromptChars: number;
}

export async function buildAssistantConfigForCaller(
  options: BuildAssistantOptions,
): Promise<BuildAssistantResult> {
  const { callerId, slug, intent = "chat", callIdForRuntime = null } = options;

  const inbound = await getVoiceProvider(slug);
  const vs = await getVoiceCallSettings();
  const sys = await getVoiceSystemSettings();
  const serverUrlBase = `${config.app.url}/api/voice/${slug}`;
  const enabledTools = await loadToolDefinitions();

  // #1185 follow-up — pull the webhookSecret out of the VoiceProvider
  // credentials JSON so we can pass it to the custom-llm `model.secret`
  // field. VAPI uses this exact value as `x-vapi-secret` on the chat-
  // completions POST, and the proxy timing-safe-compares against the
  // SAME row's webhookSecret. One credential, two purposes (webhook
  // HMAC + custom-llm shared secret).
  const providerRow = await prisma.voiceProvider.findUnique({
    where: { slug },
    select: { credentials: true },
  });
  const providerCreds = (providerRow?.credentials ?? {}) as Record<string, unknown>;
  const customLlmSecret =
    typeof providerCreds.webhookSecret === "string" &&
    providerCreds.webhookSecret.length > 0
      ? providerCreds.webhookSecret
      : undefined;

  const costSafetyKnobs = {
    silenceTimeoutSeconds: sys.silenceTimeoutSeconds,
    maxDurationSeconds: sys.maxDurationSeconds,
    voicemailDetectionEnabled: sys.voicemailDetectionEnabled,
    endCallPhrases: sys.endCallPhrases,
  };

  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { id: true, name: true, phone: true },
  });
  if (!caller) {
    // Unknown caller — return the same fallback shape the webhook uses
    // for callers VAPI dialed but we haven't seen. Cost-safety knobs
    // still applied so a wandering caller can't burn minutes.
    // #1271 — also pull system+VP-default voice config so the unknown
    // caller gets the correct voiceId / transcriber / etc. (no Domain or
    // Course layer available without a caller).
    const unknownVoiceConfig = flattenVoice(
      await loadResolvedVoiceConfig({ callerId: null, playbookId: null }),
    );
    const assistantConfig = inbound.buildAssistantConfig({
      callerId: null,
      callerName: null,
      customerPhone: null,
      voicePrompt: vs.unknownCallerPrompt,
      firstLine: UNKNOWN_CALLER_FIRST_LINE,
      toolDefinitions: [],
      knowledgePlanEnabled: false,
      serverUrlBase,
      modelConfig: { provider: vs.provider, model: vs.model },
      unknownCallerPrompt: vs.unknownCallerPrompt,
      noActivePromptFallback: vs.noActivePromptFallback,
      costSafetyKnobs,
      customLlmSecret,
      voiceConfig: unknownVoiceConfig,
    });
    return {
      assistantConfig,
      providerSlug: slug,
      voicePromptChars: vs.unknownCallerPrompt.length,
    };
  }

  // Cascade resolver — only honoured when it agrees with the URL-bound
  // slug. The Web SDK path treats `options.slug` as authoritative; the
  // PSTN/webhook path keeps the same discipline.
  const resolved = await resolveVoiceProviderForCaller(caller.id);
  const responseProvider =
    resolved.slug === slug ? await getVoiceProvider(resolved.slug) : inbound;

  const defaultPlaybookId = await resolvePlaybookId(caller.id);

  // #1271 — Pull the resolved voice config (System → enabled VP → Domain
  // → Course) so the adapter can apply per-course voiceId, transcriber,
  // backgroundSound, recordingEnabled overrides. Cross-cutting knobs
  // (silenceTimeoutSeconds etc.) ALSO flow through here so a course-level
  // override actually reaches VAPI's inline assistant config — previously
  // costSafetyKnobs were pinned to system level only.
  const voiceResolved = await loadResolvedVoiceConfig({
    callerId: caller.id,
    playbookId: defaultPlaybookId,
  });
  const flatVoiceConfig = flattenVoice(voiceResolved);

  // #2053 — `interruptSensitivity` lives at the top-level
  // `Playbook.config.interruptSensitivity` (NOT inside the nested
  // `config.voice` blob the voice cascade walks), so it's invisible to
  // `resolveVoiceConfig`. Read it directly and merge onto the flat
  // voiceConfig blob handed to the adapter. The adapter's pure mapper
  // (`mapInterruptSensitivityToVapi`) translates it into VAPI's
  // `stopSpeakingPlan` barge-in knob. Sub-epic D of #2049.
  if (defaultPlaybookId) {
    const playbookRow = await prisma.playbook.findUnique({
      where: { id: defaultPlaybookId },
      select: { config: true },
    });
    const pbConfig = (playbookRow?.config ?? {}) as Record<string, unknown>;
    if (pbConfig.interruptSensitivity !== undefined) {
      flatVoiceConfig.interruptSensitivity = pbConfig.interruptSensitivity;
    }
  }
  const composedPrompt = await prisma.composedPrompt.findFirst({
    where: {
      callerId: caller.id,
      status: "active",
      ...(defaultPlaybookId ? { playbookId: defaultPlaybookId } : {}),
    },
    orderBy: { composedAt: "desc" },
    select: { id: true, llmPrompt: true, prompt: true },
  });

  if (!composedPrompt?.llmPrompt) {
    // #1420 — structured CRITICAL log. After this fix the fallback
    // should never fire for a fresh-enrolment caller: the post-tx
    // `autoComposeForCaller` hook + the `reconcileMissingBootstrap`
    // backstop populate `ComposedPrompt(status='active')` for every
    // ACTIVE enrollment within 5 minutes of enrolment. A hit here means
    // EITHER (a) the caller has zero ACTIVE enrollments and dialled the
    // system anyway, OR (b) both the post-tx hook AND the reconciler
    // failed for >5 minutes — a real telemetry signal worth waking
    // someone up for. After 7 days clean this branch becomes a hard
    // error (TL revision: defence-in-depth keep-the-fallback-but-log
    // approach is correct for the staged-rollout window).
    console.error(
      `[CRITICAL][build-assistant-config] fallback fired — composed-prompt cascade returned null. ` +
        `callerId=${caller.id.slice(0, 8)} playbookId=${defaultPlaybookId?.slice(0, 8) ?? "null"} ` +
        `cause=no-active-composed-prompt — see #1420 for the I-CT2 bootstrap gap. ` +
        `Either the post-tx auto-compose hook AND the reconciler both failed for >5min, ` +
        `or this caller has zero ACTIVE enrollments.`,
    );
    const callerLabel = caller.name || "a returning caller";
    const fallbackPrompt = `${vs.noActivePromptFallback} The caller is ${callerLabel}.`;
    const assistantConfig = responseProvider.buildAssistantConfig({
      callerId: caller.id,
      callerName: caller.name,
      customerPhone: caller.phone,
      voicePrompt: fallbackPrompt,
      firstLine: noActivePromptFirstLine(caller.name),
      toolDefinitions: [],
      knowledgePlanEnabled: false,
      serverUrlBase,
      modelConfig: { provider: vs.provider, model: vs.model },
      unknownCallerPrompt: vs.unknownCallerPrompt,
      noActivePromptFallback: vs.noActivePromptFallback,
      costSafetyKnobs,
      customLlmSecret,
      voiceConfig: flatVoiceConfig,
    });
    return {
      assistantConfig,
      providerSlug: responseProvider.slug,
      voicePromptChars: fallbackPrompt.length,
    };
  }

  const llmPrompt = composedPrompt.llmPrompt as Record<string, unknown>;
  const responseCaps = responseProvider.getCapabilities();
  const runtime = await resolveRuntimeFeatures({
    callId: callIdForRuntime,
    callerId: caller.id,
    intent,
  });
  const voicePrompt = renderProviderPrompt(
    llmPrompt as Parameters<typeof renderProviderPrompt>[0],
    responseCaps,
    runtime,
  );
  const firstLine =
    ((llmPrompt._quickStart as Record<string, unknown> | undefined)
      ?.first_line as string | null | undefined) ?? null;

  const assistantConfig = responseProvider.buildAssistantConfig({
    callerId: caller.id,
    callerName: caller.name,
    customerPhone: caller.phone,
    voicePrompt,
    firstLine,
    toolDefinitions: enabledTools,
    knowledgePlanEnabled: vs.knowledgePlanEnabled,
    serverUrlBase,
    modelConfig: { provider: vs.provider, model: vs.model },
    unknownCallerPrompt: vs.unknownCallerPrompt,
    noActivePromptFallback: vs.noActivePromptFallback,
    costSafetyKnobs,
    customLlmSecret,
    voiceConfig: flatVoiceConfig,
  });

  return {
    assistantConfig,
    providerSlug: responseProvider.slug,
    voicePromptChars: voicePrompt.length,
  };
}
