/**
 * Voice config loader (#1269 / #1270 Slice A).
 *
 * Bridges the pure `resolveVoiceConfig` cascade with Prisma reads. Two
 * entry points to keep call sites tidy:
 *
 *   `loadResolvedVoiceConfig({ callerId?, playbookId? })` — resolves the
 *   full 4-layer cascade for an end-of-call gate or assistant-config
 *   build. Caller / playbook nullable so unknown-caller paths get a
 *   sane (system-default) shape.
 *
 *   `loadCascadeInputs({...})` — exposes the raw inputs so existing
 *   callers that already fetched the VP row don't double-read. Falls
 *   back to fetching anything not supplied.
 *
 * Call frequency: one call per end-of-call event (route-handlers
 * autoPipeline gate) and per assistant-config build. Both are infrequent
 * enough to absorb 3-4 small Prisma reads without batching concerns.
 */

import { prisma } from "@/lib/prisma";
import { getVoiceCallSettings, type VoiceCallSettings } from "@/lib/system-settings";
import { getVoiceSystemSettings } from "@/lib/voice/system-settings";
import { getVoiceProvider } from "@/lib/voice/provider-factory";
import { resolveVoiceConfig, type ResolvedVoiceConfig } from "@/lib/voice/config";

interface LoadArgs {
  callerId?: string | null;
  playbookId?: string | null;
}

function extractVoiceBlob(blob: unknown): Record<string, unknown> | null {
  if (!blob || typeof blob !== "object" || Array.isArray(blob)) return null;
  const voice = (blob as Record<string, unknown>).voice;
  if (!voice || typeof voice !== "object" || Array.isArray(voice)) return null;
  return voice as Record<string, unknown>;
}

export async function loadResolvedVoiceConfig(args: LoadArgs): Promise<ResolvedVoiceConfig> {
  const vs = await getVoiceCallSettings();
  const sys = await getVoiceSystemSettings();
  // #1271 — `vs.provider` is the LLM provider (openai / anthropic /
  // custom-llm), NOT the voice provider slug. Falling back to it caused
  // `getVoiceProvider("custom-llm")` 500s on any system where
  // `VoiceSystemSettings.defaultProviderSlug` is blank but a VAPI row
  // exists. Pick a real voice provider: explicit setting → vapi default.
  const explicit = sys.defaultProviderSlug?.trim();
  const enabledSlug = explicit && explicit.length > 0 ? explicit : "vapi";

  const [vpRow, adapter, domainConfig, courseConfig] = await Promise.all([
    prisma.voiceProvider.findUnique({
      where: { slug: enabledSlug },
      select: { slug: true, config: true },
    }),
    getVoiceProvider(enabledSlug).catch((err) => {
      // If the configured slug doesn't resolve (operator setting drift)
      // surface a synthetic empty-schema adapter so the resolver still
      // returns a valid cascade — the caller will see system defaults.
      console.warn(`[voice-config] adapter resolve failed for slug=${enabledSlug}:`, err instanceof Error ? err.message : String(err));
      return {
        slug: enabledSlug,
        getConfigSchema: () => ({ fields: [] }),
      } as Awaited<ReturnType<typeof getVoiceProvider>>;
    }),
    args.callerId ? loadDomainVoice(args.callerId) : Promise.resolve(null),
    args.playbookId ? loadPlaybookVoice(args.playbookId) : Promise.resolve(null),
  ]);

  return resolveVoiceConfig({
    systemSettings: normaliseSystemSettings(vs, sys, enabledSlug),
    enabledProvider: {
      slug: enabledSlug,
      config: (vpRow?.config as Record<string, unknown>) ?? {},
      schema: adapter.getConfigSchema(),
      model: vs.model ?? null,
    },
    domainConfig,
    courseConfig,
  });
}

async function loadDomainVoice(callerId: string): Promise<Record<string, unknown> | null> {
  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { domain: { select: { config: true } } },
  });
  return extractVoiceBlob(caller?.domain?.config);
}

async function loadPlaybookVoice(playbookId: string): Promise<Record<string, unknown> | null> {
  const playbook = await prisma.playbook.findUnique({
    where: { id: playbookId },
    select: { config: true },
  });
  return extractVoiceBlob(playbook?.config);
}

/** Maps the two existing system-level settings rows into the shape
 *  `resolveVoiceConfig` expects. Single source of truth for the system
 *  layer so every loader produces the same shape. */
function normaliseSystemSettings(
  vs: VoiceCallSettings,
  sys: { silenceTimeoutSeconds: number; maxDurationSeconds: number; voicemailDetectionEnabled: boolean; endCallPhrases: string[]; maxCostPerCallUsd: number | null },
  enabledSlug: string,
) {
  return {
    defaultProviderSlug: enabledSlug,
    autoPipeline: vs.autoPipeline,
    silenceTimeoutSeconds: sys.silenceTimeoutSeconds,
    maxDurationSeconds: sys.maxDurationSeconds,
    voicemailDetectionEnabled: sys.voicemailDetectionEnabled,
    endCallPhrases: sys.endCallPhrases,
    maxCostPerCallUsd: sys.maxCostPerCallUsd ?? null,
  };
}
