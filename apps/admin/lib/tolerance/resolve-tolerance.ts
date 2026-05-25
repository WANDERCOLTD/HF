/**
 * Tolerance resolver — central read path for the mastery / spacing / decay
 * cascade defined in `docs/decisions/2026-05-22-tolerance-placement.md`.
 *
 * Every read site that previously had a bare `0.7` literal for the mastery
 * threshold should go through `resolveMasteryThreshold()` instead. The cascade
 * has 7 layers; the first non-null wins. The winning layer is logged so a
 * future debug session can see exactly which knob took effect.
 *
 * Why a cascade and not a flat lookup: each layer has a different audit /
 * authoring profile (bucket 1 = course author, bucket 2 = system commit,
 * bucket 3 = per-learner adaptation). Mixing them into a single field would
 * lose that provenance. See the ADR for the full reasoning.
 *
 * Layer order (highest precedence first):
 *
 *   1. BehaviorTarget(scope=CALLER, parameterId="TOL-MASTERY-THRESHOLD")
 *      — bucket 3, per-learner adaptive override
 *   2. BehaviorTarget(scope=PLAYBOOK, parameterId="TOL-MASTERY-THRESHOLD")
 *      — bucket 1, declarative course parameter (alt write path)
 *   3. Playbook.config.tolerances?.masteryThreshold
 *      — bucket 1, declarative course parameter (preferred write path)
 *   4. SchedulerPolicy.masteryThresholdOverride (from scheduler-presets)
 *      — bucket 2-ish (preset is system-shipped, but the picker is bucket 1)
 *   5. specConfig.metadata.curriculum.masteryThreshold
 *      — bucket 2, contract-driven content spec default
 *   6. ContractRegistry.getThresholds('CURRICULUM_PROGRESS_V1').masteryComplete
 *      — bucket 2, contract registry default
 *   7. Hardcoded 0.7
 *      — bucket 2, last-resort literal so the resolver never returns null
 *
 * @see docs/decisions/2026-05-22-tolerance-placement.md
 */

import { prisma } from "@/lib/prisma";
import { ContractRegistry } from "@/lib/contracts/registry";
import { getPresetForPlaybook } from "@/lib/pipeline/scheduler-presets";
import type { PlaybookConfig } from "@/lib/types/json-fields";

/** Parameter slug used for both per-caller and per-playbook BehaviorTarget rows. */
export const TOLERANCE_MASTERY_THRESHOLD_PARAM_ID = "TOL-MASTERY-THRESHOLD";

/** Bucket-2 last-resort literal. Keep in sync with the ADR. */
export const MASTERY_THRESHOLD_FALLBACK = 0.7;

export type MasteryThresholdSource =
  | "caller-behavior-target"
  | "playbook-behavior-target"
  | "playbook-config"
  | "scheduler-preset"
  | "spec-curriculum-metadata"
  | "contract-registry"
  | "hardcoded-default";

export interface ResolvedMasteryThreshold {
  value: number;
  source: MasteryThresholdSource;
}

interface ResolverInputs {
  callerId?: string | null;
  playbookId?: string | null;
  playbookConfig?: PlaybookConfig | Record<string, unknown> | null;
  specConfig?: Record<string, unknown> | null;
}

interface ResolverOptions {
  /** Set true to suppress the winning-layer log line (used in hot loops + tests). */
  silent?: boolean;
}

async function readBehaviorTargetValue(args: {
  scope: "CALLER" | "PLAYBOOK";
  callerId?: string | null;
  playbookId?: string | null;
}): Promise<number | null> {
  try {
    const row = await prisma.behaviorTarget.findFirst({
      where: {
        parameterId: TOLERANCE_MASTERY_THRESHOLD_PARAM_ID,
        scope: args.scope,
        effectiveUntil: null,
        ...(args.scope === "CALLER" ? { callerIdentityId: args.callerId ?? undefined } : {}),
        ...(args.scope === "PLAYBOOK" ? { playbookId: args.playbookId ?? undefined } : {}),
      },
      select: { targetValue: true },
      orderBy: { effectiveFrom: "desc" },
    });
    return row?.targetValue ?? null;
  } catch (err) {
    // Non-blocking: a missing parameter row or empty DB shouldn't kill the
    // composition. Fall through to lower-precedence layers.
    console.warn(
      `[tolerance] BehaviorTarget(${args.scope}) read failed for ${TOLERANCE_MASTERY_THRESHOLD_PARAM_ID} — falling through.`,
      err,
    );
    return null;
  }
}

/**
 * Resolve the active mastery threshold for a given caller / playbook / spec
 * context. Returns the winning value AND the layer it came from so callers
 * can log or audit when needed. The shorthand `resolveMasteryThreshold` (with
 * a `Value` suffix on the typed export) returns just the number.
 */
export async function resolveMasteryThresholdDetailed(
  inputs: ResolverInputs,
  options: ResolverOptions = {},
): Promise<ResolvedMasteryThreshold> {
  const { callerId, playbookId, playbookConfig, specConfig } = inputs;

  // Layer 1 — per-caller behavior target (bucket 3, adaptive override).
  if (callerId) {
    const v = await readBehaviorTargetValue({ scope: "CALLER", callerId });
    if (v != null) return logAndReturn("caller-behavior-target", v, options);
  }

  // Layer 2 — per-playbook behavior target (bucket 1, alt write path).
  if (playbookId) {
    const v = await readBehaviorTargetValue({ scope: "PLAYBOOK", playbookId });
    if (v != null) return logAndReturn("playbook-behavior-target", v, options);
  }

  // Layer 3 — Playbook.config.tolerances.masteryThreshold (bucket 1, preferred).
  const tolerancesField = (playbookConfig as PlaybookConfig | null | undefined)?.tolerances;
  if (typeof tolerancesField?.masteryThreshold === "number") {
    return logAndReturn("playbook-config", tolerancesField.masteryThreshold, options);
  }

  // Layer 4 — SchedulerPolicy.masteryThresholdOverride (preset-driven).
  // `getPresetForPlaybook` accepts a loose `{ config?: unknown }` shape; pass
  // the playbookConfig directly under that key so the preset picker can read
  // `teachingMode` etc.
  const policy = getPresetForPlaybook({ config: playbookConfig ?? {} });
  if (policy.masteryThresholdOverride != null) {
    return logAndReturn("scheduler-preset", policy.masteryThresholdOverride, options);
  }

  // Layer 5 — specConfig.metadata.curriculum.masteryThreshold (bucket 2).
  const specMetadata = (specConfig as Record<string, unknown> | null | undefined)?.metadata as
    | { curriculum?: { masteryThreshold?: unknown } }
    | undefined;
  const specMasteryThreshold = specMetadata?.curriculum?.masteryThreshold;
  if (typeof specMasteryThreshold === "number") {
    return logAndReturn("spec-curriculum-metadata", specMasteryThreshold, options);
  }

  // Layer 6 — ContractRegistry CURRICULUM_PROGRESS_V1.masteryComplete (bucket 2).
  try {
    const thresholds = await ContractRegistry.getThresholds("CURRICULUM_PROGRESS_V1");
    const contractMasteryComplete = thresholds?.masteryComplete;
    if (typeof contractMasteryComplete === "number") {
      return logAndReturn("contract-registry", contractMasteryComplete, options);
    }
  } catch (err) {
    console.warn(
      "[tolerance] ContractRegistry.getThresholds('CURRICULUM_PROGRESS_V1') failed — falling through to hardcoded default.",
      err,
    );
  }

  // Layer 7 — hardcoded bucket-2 default (cannot be null).
  return logAndReturn("hardcoded-default", MASTERY_THRESHOLD_FALLBACK, options);
}

/**
 * Shorthand for the common case where only the numeric value is needed. Reads
 * the same cascade as `resolveMasteryThresholdDetailed` and logs the winning
 * layer per the ADR.
 */
export async function resolveMasteryThreshold(
  inputs: ResolverInputs,
  options: ResolverOptions = {},
): Promise<number> {
  const resolved = await resolveMasteryThresholdDetailed(inputs, options);
  return resolved.value;
}

function logAndReturn(
  source: MasteryThresholdSource,
  value: number,
  options: ResolverOptions,
): ResolvedMasteryThreshold {
  if (!options.silent) {
    console.log(`[tolerance] masteryThreshold=${value} (source=${source})`);
  }
  return { value, source };
}
