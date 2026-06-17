/**
 * Voice system-wide settings helper (AnyVoice #1044).
 *
 * Reads + writes the single-row `VoiceSystemSettings` table that holds
 * cross-provider voice configuration: cost cap, default provider, audit
 * retention, fallback-on-error policy. Distinct from VoiceCallSettings
 * (model + prompts; applies to inbound prompt rendering) and from
 * VoiceProvider rows (per-adapter credentials + config).
 *
 * Cache: 30s TTL in-process, mirrors the cache shape used by other
 * settings helpers. Invalidated automatically by the PATCH route after
 * a successful write.
 *
 * Single row: the table's `id` column has a fixed default of
 * "singleton" so the upsert path is trivial.
 */

import { prisma } from "@/lib/prisma";

export interface VoiceSystemSettings {
  /** "silent" | "throw" | "escalate" — adapter dispatch error handling. */
  fallbackOnAdapterError: "silent" | "throw" | "escalate";
  /** Hard cap consumed by #1080 cost-cap watcher. null = disabled. */
  maxCostPerCallUsd: number | null;
  /** UsageEvent retention before rollup-and-purge. */
  auditRetentionDays: number;
  /** Fallback when Caller.voiceProvider is null AND no row has
   *  isDefault: true. Empty string disables the fallback. */
  defaultProviderSlug: string;
  /** Per-call cost-safety knobs injected into the VAPI assistant config
   *  (PR voice-cost-knobs). VAPI's defaults can run a call for up to 10
   *  minutes of silence if undetected; tightening these in code stops
   *  runaway calls from burning the per-minute budget. */
  silenceTimeoutSeconds: number;
  maxDurationSeconds: number;
  voicemailDetectionEnabled: boolean;
  endCallPhrases: string[];
  /** #1119 — Vendor scoring timeout used by the PROSODY pipeline stage
   *  when calling SpeechAce / SpeechSuper. Default 30s leaves headroom
   *  inside Cloud Run's 60s request budget. */
  vendorTimeoutMs: number;
  /** #1870 — Per-call cap on segmented PROSODY scoring. When a call has
   *  more than this many `Session.metadata.phaseBoundaries[]`, the
   *  runner falls back to whole-call scoring and logs
   *  `voice.prosody.segments_capped`. Default 5 covers IELTS Mock's
   *  4 phases plus headroom. */
  maxSegmentsPerCall: number;
}

export const VOICE_SYSTEM_DEFAULTS: VoiceSystemSettings = {
  fallbackOnAdapterError: "throw",
  maxCostPerCallUsd: null,
  auditRetentionDays: 90,
  defaultProviderSlug: "",
  silenceTimeoutSeconds: 30,
  maxDurationSeconds: 600,
  voicemailDetectionEnabled: true,
  endCallPhrases: [
    "goodbye",
    "bye",
    "talk to you later",
    "see you later",
    "have a nice day",
  ],
  vendorTimeoutMs: 30000,
  maxSegmentsPerCall: 5,
};

const SINGLETON_ID = "singleton";
const CACHE_TTL_MS = 30 * 1000;
let cache: { value: VoiceSystemSettings; expiresAt: number } | null = null;

function rowToSettings(
  row: Awaited<ReturnType<typeof prisma.voiceSystemSettings.findUnique>>,
): VoiceSystemSettings {
  if (!row) return VOICE_SYSTEM_DEFAULTS;
  const fallback = row.fallbackOnAdapterError as
    | "silent"
    | "throw"
    | "escalate";
  return {
    fallbackOnAdapterError: ["silent", "throw", "escalate"].includes(fallback)
      ? fallback
      : VOICE_SYSTEM_DEFAULTS.fallbackOnAdapterError,
    maxCostPerCallUsd: row.maxCostPerCallUsd,
    auditRetentionDays: row.auditRetentionDays,
    defaultProviderSlug: row.defaultProviderSlug,
    silenceTimeoutSeconds: row.silenceTimeoutSeconds,
    maxDurationSeconds: row.maxDurationSeconds,
    voicemailDetectionEnabled: row.voicemailDetectionEnabled,
    endCallPhrases: row.endCallPhrases,
    vendorTimeoutMs: row.vendorTimeoutMs,
    maxSegmentsPerCall: row.maxSegmentsPerCall,
  };
}

/**
 * Read the cross-provider voice settings, with a 30s TTL cache. Safe
 * for hot paths (called from the #1080 status-update handler on every
 * trickle event).
 */
export async function getVoiceSystemSettings(): Promise<VoiceSystemSettings> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;
  try {
    const row = await prisma.voiceSystemSettings.findUnique({
      where: { id: SINGLETON_ID },
    });
    const value = rowToSettings(row);
    cache = { value, expiresAt: now + CACHE_TTL_MS };
    return value;
  } catch (err) {
    console.warn(
      "[voice/system-settings] read failed, returning defaults:",
      err instanceof Error ? err.message : String(err),
    );
    return VOICE_SYSTEM_DEFAULTS;
  }
}

/**
 * Update one or more cross-provider settings. Upserts the singleton row.
 * Invalidates the read cache so the next call sees the update.
 */
export async function updateVoiceSystemSettings(
  patch: Partial<VoiceSystemSettings>,
): Promise<VoiceSystemSettings> {
  const merged: VoiceSystemSettings = { ...VOICE_SYSTEM_DEFAULTS, ...patch };
  const row = await prisma.voiceSystemSettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, ...merged },
    update: merged,
  });
  const value = rowToSettings(row);
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

/** For tests + admin "force refresh" actions. */
export function invalidateVoiceSystemSettingsCache(): void {
  cache = null;
}
