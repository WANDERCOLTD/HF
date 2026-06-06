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
    const assistantConfig = inbound.buildAssistantConfig({
      callerId: null,
      callerName: null,
      customerPhone: null,
      voicePrompt: vs.unknownCallerPrompt,
      firstLine: "Hello! I don't think we've spoken before. What's your name?",
      toolDefinitions: [],
      knowledgePlanEnabled: false,
      serverUrlBase,
      modelConfig: { provider: vs.provider, model: vs.model },
      unknownCallerPrompt: vs.unknownCallerPrompt,
      noActivePromptFallback: vs.noActivePromptFallback,
      costSafetyKnobs,
      customLlmSecret,
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
    const callerLabel = caller.name || "a returning caller";
    const fallbackPrompt = `${vs.noActivePromptFallback} The caller is ${callerLabel}.`;
    const assistantConfig = responseProvider.buildAssistantConfig({
      callerId: caller.id,
      callerName: caller.name,
      customerPhone: caller.phone,
      voicePrompt: fallbackPrompt,
      firstLine: `Hi${caller.name ? ` ${caller.name}` : ""}! Good to hear from you.`,
      toolDefinitions: [],
      knowledgePlanEnabled: false,
      serverUrlBase,
      modelConfig: { provider: vs.provider, model: vs.model },
      unknownCallerPrompt: vs.unknownCallerPrompt,
      noActivePromptFallback: vs.noActivePromptFallback,
      costSafetyKnobs,
      customLlmSecret,
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
  });

  return {
    assistantConfig,
    providerSlug: responseProvider.slug,
    voicePromptChars: voicePrompt.length,
  };
}
