/**
 * Voice configuration cascade resolver (#1269 / #1270 Slice A).
 *
 * Four-layer cascade — System → enabled VoiceProvider → Domain → Course —
 * with provenance tracking on every field. Pure function: every input is
 * passed in, no DB calls, fully unit-testable. Callers (adapter wiring at
 * `buildAssistantConfigForCaller`, end-of-call gates at `persistEndOfCall`)
 * are responsible for the Prisma reads.
 *
 * The available override SURFACE flips with the system-enabled VoiceProvider:
 * each adapter's `getConfigSchema()` declares its editable per-VP fields.
 * Cross-cutting HF concepts (autoPipeline, silenceTimeoutSeconds, etc.)
 * are orthogonal to the per-VP schema and cascade across providers.
 *
 * Two fields are **locked at system level** and explicitly excluded from
 * Domain / Course overrides: `provider` (the enabled slug) and `model`.
 * This is the spike decision recorded on #1270 — overriding the model
 * provider at course level could silently bypass the HF custom-llm
 * metering proxy. Locked here, in the chat tool ALLOWED set, and in the
 * UI override surface.
 */

import type { ProviderConfigSchema } from "./types";

/** Which layer supplied a resolved value. */
export type VoiceConfigSource = "system" | "provider" | "domain" | "course";

/** A single resolved field carries both value and provenance so callers
 *  can render "comes from System / Provider / Domain / Course" without
 *  re-running the cascade. */
export interface ResolvedField<T = unknown> {
  value: T;
  source: VoiceConfigSource;
}

export interface ResolvedVoiceConfig {
  /** Locked at system level — never overrideable at Domain or Course. */
  provider: ResolvedField<string>;
  /** Locked at system level — see header for rationale. */
  model: ResolvedField<string | null>;
  /** Every other cascadeable field, keyed by storage key. */
  fields: Record<string, ResolvedField<unknown>>;
}

/** Cross-cutting HF fields that cascade across every voice provider. The
 *  source-of-truth for default values is the System layer; per-provider
 *  schemas don't redeclare these. Order doesn't matter — Set lookup. */
const CROSS_CUTTING_KEYS = [
  "autoPipeline",
  "silenceTimeoutSeconds",
  "maxDurationSeconds",
  "voicemailDetectionEnabled",
  "endCallPhrases",
  "maxCostPerCallUsd",
  "pollIntervalMs",
  "endedReasonOverride",
] as const;

/** Keys that MUST NOT appear in Domain or Course override surfaces. The
 *  Zod schema for the AI-writable surface and the admin tool ALLOWED set
 *  both filter against this list. */
export const LOCKED_KEYS: readonly string[] = ["provider", "model"];

/** Keys that MUST NEVER be exposed to any reader — defence-in-depth on
 *  top of the credentials/config split. */
export const SECRET_KEYS: readonly string[] = ["modelSecret", "secret", "apiKey", "webhookSecret"];

export interface ResolveVoiceConfigArgs {
  /** Shape mirroring `VoiceSystemSettings` + the `voice.auto_pipeline`
   *  SystemSetting. Callers normalise their reads into this object so the
   *  resolver stays portable across the two storage locations. */
  systemSettings: {
    defaultProviderSlug: string;
    autoPipeline: boolean;
    silenceTimeoutSeconds: number;
    maxDurationSeconds: number;
    voicemailDetectionEnabled: boolean;
    endCallPhrases: readonly string[];
    maxCostPerCallUsd: number | null;
    /** Optional — VoiceSystemSettings doesn't currently expose this; the
     *  field is here so resolver tests can override the cascade default. */
    pollIntervalMs?: number;
  };
  /** The VoiceProvider row + its declared schema. The schema is fetched
   *  from `adapter.getConfigSchema()` at the call site. */
  enabledProvider: {
    slug: string;
    /** Plain JSON from `VoiceProvider.config`. Per-VP defaults like
     *  `voiceId`, `transcriber`, etc. land here once Slice B writes them
     *  via `/x/settings/voice-providers/[id]`. */
    config: Record<string, unknown>;
    schema: ProviderConfigSchema;
    /** Optional pinned model from `VoiceProvider.config.model` or the
     *  adapter's own default. Locked here, not overrideable. */
    model?: string | null;
  };
  /** `Domain.config.voice` blob — null if the domain hasn't set any
   *  overrides yet. The resolver only reads keys that survive the
   *  per-VP and cross-cutting whitelist. */
  domainConfig?: Record<string, unknown> | null;
  /** `Playbook.config.voice` blob — null when the course hasn't set any
   *  overrides yet. Course wins over Domain wins over Provider wins over
   *  System. */
  courseConfig?: Record<string, unknown> | null;
}

/** Returns the set of cascadeable keys for the enabled VP. = cross-cutting
 *  HF fields + per-VP schema fields, minus locked + sensitive + secret. */
export function cascadeableKeys(schema: ProviderConfigSchema): string[] {
  const perVp = schema.fields
    .filter((f) => !f.sensitive)
    .filter((f) => !LOCKED_KEYS.includes(f.key))
    .filter((f) => !SECRET_KEYS.includes(f.key))
    .map((f) => f.key);
  return Array.from(new Set([...CROSS_CUTTING_KEYS, ...perVp]));
}

/** Look a key up in a raw config blob, returning undefined when absent
 *  AND when the stored value is explicitly null (treat null as "cleared,
 *  fall back to next layer" — supports the Clear-override UX). */
function readKey(
  blob: Record<string, unknown> | null | undefined,
  key: string,
): { found: boolean; value: unknown } {
  if (!blob || !(key in blob)) return { found: false, value: undefined };
  const v = blob[key];
  if (v === undefined || v === null) return { found: false, value: undefined };
  return { found: true, value: v };
}

/** Returns the resolved system-default for a cross-cutting key. */
function systemDefaultFor(
  key: string,
  systemSettings: ResolveVoiceConfigArgs["systemSettings"],
): unknown {
  switch (key) {
    case "autoPipeline":
      return systemSettings.autoPipeline;
    case "silenceTimeoutSeconds":
      return systemSettings.silenceTimeoutSeconds;
    case "maxDurationSeconds":
      return systemSettings.maxDurationSeconds;
    case "voicemailDetectionEnabled":
      return systemSettings.voicemailDetectionEnabled;
    case "endCallPhrases":
      return systemSettings.endCallPhrases;
    case "maxCostPerCallUsd":
      return systemSettings.maxCostPerCallUsd;
    case "pollIntervalMs":
      return systemSettings.pollIntervalMs;
    default:
      return undefined;
  }
}

export function resolveVoiceConfig(args: ResolveVoiceConfigArgs): ResolvedVoiceConfig {
  const { systemSettings, enabledProvider, domainConfig, courseConfig } = args;

  const provider: ResolvedField<string> = {
    value: enabledProvider.slug,
    source: "system",
  };

  const model: ResolvedField<string | null> = enabledProvider.model
    ? { value: enabledProvider.model, source: "provider" }
    : { value: null, source: "system" };

  const fields: Record<string, ResolvedField<unknown>> = {};
  const keys = cascadeableKeys(enabledProvider.schema);

  for (const key of keys) {
    const fromCourse = readKey(courseConfig, key);
    if (fromCourse.found) {
      fields[key] = { value: fromCourse.value, source: "course" };
      continue;
    }
    const fromDomain = readKey(domainConfig, key);
    if (fromDomain.found) {
      fields[key] = { value: fromDomain.value, source: "domain" };
      continue;
    }
    const fromProvider = readKey(enabledProvider.config, key);
    if (fromProvider.found) {
      fields[key] = { value: fromProvider.value, source: "provider" };
      continue;
    }
    const sysVal = systemDefaultFor(key, systemSettings);
    if (sysVal !== undefined) {
      fields[key] = { value: sysVal, source: "system" };
      continue;
    }
    // Last resort — schema-declared default for a per-VP field.
    const schemaField = enabledProvider.schema.fields.find((f) => f.key === key);
    if (schemaField?.default !== undefined) {
      fields[key] = { value: schemaField.default, source: "provider" };
    }
    // Else: no value at any layer — omit the key. Callers tolerant via
    // optional access.
  }

  return { provider, model, fields };
}

/** Convenience accessor — returns the raw value, dropping provenance. */
export function flatten(resolved: ResolvedVoiceConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {
    provider: resolved.provider.value,
    model: resolved.model.value,
  };
  for (const [k, v] of Object.entries(resolved.fields)) {
    out[k] = v.value;
  }
  return out;
}
