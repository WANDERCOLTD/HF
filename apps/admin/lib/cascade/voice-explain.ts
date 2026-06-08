/**
 * Voice cascade explainer (Cascade Lens v1 — issue #1348).
 *
 * Two-step pattern intentionally local to voice:
 *
 *   1. `resolveVoiceConfig` (lib/voice/config.ts) is the canonical
 *      cascade — it returns WINNERS only (the `source` tag identifies
 *      which layer of System / Provider / Domain / Course supplied the
 *      value).
 *   2. This file independently reads each of the four raw blobs so the
 *      per-layer `chain` entries can faithfully report `value` + `present`
 *      for the NON-winning layers — the resolver doesn't surface that and
 *      we don't want to fold the reconstruction into the hot path of
 *      end-of-call config build.
 *
 * v2 (extraction-explain.ts / module-selection-explain.ts) will get
 * SIBLING files in this directory — each cascade has a different layer
 * stack and a different "what's a raw blob" shape. Do NOT prematurely
 * collapse this into a generic `explain.ts` until we have at least three
 * concrete cascades to triangulate against. See issue #1348 §1.
 *
 * Secret keys (`SECRET_KEYS` from lib/voice/config.ts) are hard-stripped
 * from the returned `fields[]` — even as `present: false` — so the
 * shape never leaks key existence to a reader. Defence-in-depth: the
 * cascadeable key set already excludes them, but if `provider` / `model`
 * shift in future, the filter still holds.
 */

import { prisma } from "@/lib/prisma";
import {
  getVoiceCallSettings,
  type VoiceCallSettings,
} from "@/lib/system-settings";
import { getVoiceSystemSettings } from "@/lib/voice/system-settings";
import { getVoiceProvider } from "@/lib/voice/provider-factory";
import {
  cascadeableKeys,
  resolveVoiceConfig,
  LOCKED_KEYS,
  SECRET_KEYS,
  type ResolvedVoiceConfig,
  type VoiceConfigSource,
} from "@/lib/voice/config";

export interface CascadeLayerEntry {
  layer: "system" | "provider" | "domain" | "course";
  /** Raw value this layer supplied (or null when absent). */
  value: unknown;
  /** false when this layer did not supply a value for the key. */
  present: boolean;
}

export interface CascadeField {
  key: string;
  resolvedValue: unknown;
  winningSource: "system" | "provider" | "domain" | "course";
  /** True for keys in LOCKED_KEYS (`provider`, `model`). Domain / Course
   *  layers will always be `present: false` for these — the resolver
   *  refuses overrides above the system level. */
  locked: boolean;
  /** Always 4 entries in fixed order: system / provider / domain / course. */
  chain: CascadeLayerEntry[];
}

export interface VoiceCascadeExplanation {
  cascade: "voice";
  callerId: string;
  /** Null when caller has no active CallerPlaybook enrollment. */
  playbookId: string | null;
  /** Mirrors playbookId — Playbook IS the course in this codebase
   *  (there is no separate `courseId` column). Kept distinct in the
   *  return shape because the UI / API consumer wants intent-led naming. */
  courseId: string | null;
  /** Resolved VoiceProvider row id (for deep-link to provider editor).
   *  Null when the configured slug doesn't resolve to a row (operator
   *  setting drift) — the resolver still returns a valid cascade via
   *  the synthetic empty-schema fallback. */
  providerId: string | null;
  resolvedAt: string;
  fields: CascadeField[];
}

interface RawInputs {
  systemSettings: VoiceCallSettings;
  sys: Awaited<ReturnType<typeof getVoiceSystemSettings>>;
  enabledSlug: string;
  vpRow: { id: string; slug: string; config: Record<string, unknown> } | null;
  schema: ReturnType<
    Awaited<ReturnType<typeof getVoiceProvider>>["getConfigSchema"]
  >;
  domainConfig: Record<string, unknown> | null;
  courseConfig: Record<string, unknown> | null;
}

function extractVoiceBlob(blob: unknown): Record<string, unknown> | null {
  if (!blob || typeof blob !== "object" || Array.isArray(blob)) return null;
  const voice = (blob as Record<string, unknown>).voice;
  if (!voice || typeof voice !== "object" || Array.isArray(voice)) return null;
  return voice as Record<string, unknown>;
}

/** Mirrors `readKey` in lib/voice/config.ts — null is treated as
 *  "cleared, fall back" (NOT "explicitly set to null"), so present === false
 *  whenever the layer would NOT contribute to the cascade. */
function readLayer(
  blob: Record<string, unknown> | null,
  key: string,
): { present: boolean; value: unknown } {
  if (!blob || !(key in blob)) return { present: false, value: null };
  const v = blob[key];
  if (v === undefined || v === null) return { present: false, value: null };
  return { present: true, value: v };
}

/** Returns the system-default for any key the resolver knows about.
 *  Mirrors lib/voice/config.ts::systemDefaultFor for cross-cutting keys
 *  + adds `provider` and `model` (which are NOT cross-cutting but live
 *  exclusively at the system layer). */
function systemValueFor(
  key: string,
  inputs: RawInputs,
): { present: boolean; value: unknown } {
  switch (key) {
    case "provider":
      return { present: true, value: inputs.enabledSlug };
    case "model":
      return inputs.systemSettings.model
        ? { present: true, value: inputs.systemSettings.model }
        : { present: false, value: null };
    case "autoPipeline":
      return { present: true, value: inputs.systemSettings.autoPipeline };
    case "silenceTimeoutSeconds":
      return { present: true, value: inputs.sys.silenceTimeoutSeconds };
    case "maxDurationSeconds":
      return { present: true, value: inputs.sys.maxDurationSeconds };
    case "voicemailDetectionEnabled":
      return { present: true, value: inputs.sys.voicemailDetectionEnabled };
    case "endCallPhrases":
      return { present: true, value: inputs.sys.endCallPhrases };
    case "maxCostPerCallUsd":
      return inputs.sys.maxCostPerCallUsd === null
        ? { present: false, value: null }
        : { present: true, value: inputs.sys.maxCostPerCallUsd };
    default:
      return { present: false, value: null };
  }
}

async function resolvePlaybookForCaller(
  callerId: string,
): Promise<{ playbookId: string | null }> {
  // `CallerPlaybook` uses `status` enum, not a boolean `active` column.
  // Mirror the canonical pick rule in resolve-active-playbook.ts:
  // most-recently enrolled ACTIVE wins.
  const enrollment = await prisma.callerPlaybook.findFirst({
    where: { callerId, status: "ACTIVE" },
    orderBy: { enrolledAt: "desc" },
    select: { playbookId: true },
  });
  return { playbookId: enrollment?.playbookId ?? null };
}

async function loadRawInputs(
  callerId: string,
  playbookId: string | null,
): Promise<RawInputs> {
  const vs = await getVoiceCallSettings();
  const sys = await getVoiceSystemSettings();
  // Same enabled-slug rule as load-voice-config.ts (#1271).
  const explicit = sys.defaultProviderSlug?.trim();
  const enabledSlug = explicit && explicit.length > 0 ? explicit : "vapi";

  const [vpRow, adapter, caller, playbook] = await Promise.all([
    prisma.voiceProvider.findUnique({
      where: { slug: enabledSlug },
      select: { id: true, slug: true, config: true },
    }),
    getVoiceProvider(enabledSlug).catch((err) => {
      console.warn(
        `[voice-explain] adapter resolve failed for slug=${enabledSlug}:`,
        err instanceof Error ? err.message : String(err),
      );
      return {
        slug: enabledSlug,
        getConfigSchema: () => ({ fields: [] }),
      } as unknown as Awaited<ReturnType<typeof getVoiceProvider>>;
    }),
    prisma.caller.findUnique({
      where: { id: callerId },
      select: { domain: { select: { config: true } } },
    }),
    playbookId
      ? prisma.playbook.findUnique({
          where: { id: playbookId },
          select: { config: true },
        })
      : Promise.resolve(null),
  ]);

  return {
    systemSettings: vs,
    sys,
    enabledSlug,
    vpRow: vpRow
      ? {
          id: vpRow.id,
          slug: vpRow.slug,
          config: (vpRow.config as Record<string, unknown>) ?? {},
        }
      : null,
    schema: adapter.getConfigSchema(),
    domainConfig: extractVoiceBlob(caller?.domain?.config),
    courseConfig: extractVoiceBlob(playbook?.config),
  };
}

function buildResolved(inputs: RawInputs): ResolvedVoiceConfig {
  return resolveVoiceConfig({
    systemSettings: {
      defaultProviderSlug: inputs.enabledSlug,
      autoPipeline: inputs.systemSettings.autoPipeline,
      silenceTimeoutSeconds: inputs.sys.silenceTimeoutSeconds,
      maxDurationSeconds: inputs.sys.maxDurationSeconds,
      voicemailDetectionEnabled: inputs.sys.voicemailDetectionEnabled,
      endCallPhrases: inputs.sys.endCallPhrases,
      maxCostPerCallUsd: inputs.sys.maxCostPerCallUsd ?? null,
    },
    enabledProvider: {
      slug: inputs.enabledSlug,
      config: inputs.vpRow?.config ?? {},
      schema: inputs.schema,
      model: inputs.systemSettings.model ?? null,
    },
    domainConfig: inputs.domainConfig,
    courseConfig: inputs.courseConfig,
  });
}

function chainFor(
  key: string,
  inputs: RawInputs,
  hasPlaybook: boolean,
  locked: boolean,
): CascadeLayerEntry[] {
  const sys = systemValueFor(key, inputs);
  const prov = locked
    ? { present: false, value: null } // locked keys never read from provider blob
    : readLayer(inputs.vpRow?.config ?? null, key);
  const dom = locked
    ? { present: false, value: null }
    : readLayer(inputs.domainConfig, key);
  const crs = locked || !hasPlaybook
    ? { present: false, value: null }
    : readLayer(inputs.courseConfig, key);

  // Special: `model` may have a per-VP default surfaced through
  // enabledProvider.config in future, but today the cascade pulls it
  // exclusively from VoiceCallSettings.model. Provider blob carrying a
  // `model` key isn't read by the resolver — leave as not-present so
  // the UI doesn't suggest a layer can override it.
  return [
    { layer: "system", value: sys.value, present: sys.present },
    { layer: "provider", value: prov.value, present: prov.present },
    { layer: "domain", value: dom.value, present: dom.present },
    { layer: "course", value: crs.value, present: crs.present },
  ];
}

export async function explainVoiceCascade(
  callerId: string,
): Promise<VoiceCascadeExplanation> {
  const { playbookId } = await resolvePlaybookForCaller(callerId);
  const inputs = await loadRawInputs(callerId, playbookId);
  const resolved = buildResolved(inputs);

  const keys = [
    "provider",
    "model",
    ...cascadeableKeys(inputs.schema),
  ];
  // Dedupe defensively in case cascadeableKeys ever surfaces `provider`
  // or `model` (it shouldn't — they're in LOCKED_KEYS — but the explainer
  // is read-only and a duplicate row would confuse the UI silently).
  const seen = new Set<string>();
  const dedupedKeys = keys.filter((k) => {
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const fields: CascadeField[] = [];
  for (const key of dedupedKeys) {
    // Hard secret filter — defence-in-depth on top of cascadeableKeys'
    // sensitive-field exclusion.
    if (SECRET_KEYS.includes(key)) continue;

    const locked = LOCKED_KEYS.includes(key);
    let resolvedValue: unknown = undefined;
    let winningSource: VoiceConfigSource;

    if (key === "provider") {
      resolvedValue = resolved.provider.value;
      winningSource = resolved.provider.source;
    } else if (key === "model") {
      resolvedValue = resolved.model.value;
      winningSource = resolved.model.source;
    } else {
      const f = resolved.fields[key];
      if (!f) {
        // Resolver omitted the key (no value at any layer). Surface
        // an entry anyway so the lens shows the field exists — chain
        // tells the UI nobody supplied a value.
        resolvedValue = null;
        winningSource = "system";
      } else {
        resolvedValue = f.value;
        winningSource = f.source;
      }
    }

    fields.push({
      key,
      resolvedValue,
      winningSource,
      locked,
      chain: chainFor(key, inputs, playbookId !== null, locked),
    });
  }

  return {
    cascade: "voice",
    callerId,
    playbookId,
    // courseId === playbookId in this codebase (Playbook IS the course).
    // Surfaced separately so the route + UI can use intent-led naming
    // without re-deriving the mapping at the call site.
    courseId: playbookId,
    providerId: inputs.vpRow?.id ?? null,
    resolvedAt: new Date().toISOString(),
    fields,
  };
}
