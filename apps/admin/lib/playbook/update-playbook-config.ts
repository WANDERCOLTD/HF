/**
 * Central enforcement point for `Playbook.config` writes.
 *
 * Every route, wizard tool, or programmatic mutation that writes to
 * `Playbook.config` MUST go through this helper. The chain-contract
 * invariant (Link 3 sub-contract in `docs/CHAIN-CONTRACTS.md`):
 *
 *   When an educator / wizard / programmatic action changes a
 *   COMPOSE-affecting playbook namespace, every active caller's
 *   ComposedPrompt row MUST be refreshed before their next call.
 *   Never stale-on-save.
 *
 * The helper:
 *   1. Reads the current config row.
 *   2. Applies the transformer (oldConfig -> newConfig).
 *   3. Diffs top-level keys against `COMPOSE_AFFECTING_KEYS`.
 *   4. Writes the new config to DB.
 *   5. If any compose-affecting key changed, fires `autoComposeForCaller`
 *      across every ACTIVE roster entry (fire-and-forget, pLimit 5).
 *
 * Direct `prisma.playbook.update({ data: { config: ... } })` calls are
 * blocked by the ESLint rule `hf-playbook/no-direct-config-write` —
 * use this helper.
 *
 * @see docs/CHAIN-CONTRACTS.md §3 Link 3 sub-contract (TUNER -> COMPOSE)
 */

import { prisma } from "@/lib/prisma";
import type { PlaybookConfig } from "@/lib/types/json-fields";

/**
 * Top-level keys on `Playbook.config` whose change MUST trigger a
 * recompose-all fan-out. Add a key here when its value flows into
 * `transforms/*` and ends up in `ComposedPrompt.llmPrompt`.
 *
 * Keys that DON'T need to be here:
 *   - `welcome` / `nps` — read by the student portal at runtime, not
 *     baked into the deterministic ComposedPrompt.
 *   - `skillTierMapping` / `skillScoringEmaHalfLifeDays` /
 *     `skillMinCallsToFull` — read via the SKILL_MEASURE_V1 contract
 *     registry at score time, not at compose time.
 *   - `surveys` — same as welcome/nps.
 */
export const COMPOSE_AFFECTING_KEYS = [
  "progressNarrative",        // #779 Felt Progress S1
  "offboardingSummary",       // #780 Felt Progress S2
  "firstSessionTargets",      // #784 S6 — first-call BEH overrides
  "firstCallMode",            // #790 S8 — onboarding / teach_immediately / baseline_assessment
  "sessionFlow",              // session-flow editor — drives the whole flow
  "welcomeMessage",           // injected verbatim into preamble / first-call intro
  "onboardingFlowPhases",     // explicit override of domain onboarding phases
  "teachingMode",             // recall / application / practice — read by pedagogy transform
  "lessonPlanMode",           // continuous / structured — gates lesson-plan loaders
  "skillTierMapping",         // banding labels surface in the prompt (#417 Story C)
  "audience",                 // selects audience-default targets cascade
  "goals",                    // goal templates seed the goals section
] as const;

export type ComposeAffectingKey = (typeof COMPOSE_AFFECTING_KEYS)[number];

/**
 * Internal byte-level comparison of two playbook config values.
 * Uses JSON.stringify because the values are JSON-shaped already
 * (this is what we persist).
 */
function configKeyChanged(
  oldConfig: PlaybookConfig,
  newConfig: PlaybookConfig,
  key: string,
): boolean {
  const oldVal = (oldConfig as Record<string, unknown>)[key];
  const newVal = (newConfig as Record<string, unknown>)[key];
  if (oldVal === undefined && newVal === undefined) return false;
  if (oldVal === undefined || newVal === undefined) return true;
  return JSON.stringify(oldVal) !== JSON.stringify(newVal);
}

export interface UpdatePlaybookConfigResult {
  /** Whether any COMPOSE-affecting key changed (and fan-out fired). */
  composeAffected: boolean;
  /** Which COMPOSE-affecting keys changed. Empty if `composeAffected=false`. */
  changedKeys: ComposeAffectingKey[];
  /** Resulting config after the transform. */
  config: PlaybookConfig;
}

export interface UpdatePlaybookConfigOpts {
  /**
   * When true, skip the recompose fan-out even if compose-affecting
   * keys changed. Use ONLY for migration scripts / seed data where you
   * know no callers are enrolled yet. Default false — the safe choice
   * is to ALWAYS fan out so educators never see stale prompts.
   */
  skipFanOut?: boolean;
  /**
   * Reason string written to the fan-out log line. Helps trace which
   * writer triggered a given recompose burst.
   */
  reason?: string;
}

/**
 * Update a playbook's config via a transformer function. Compute diff
 * against COMPOSE_AFFECTING_KEYS, write, optionally fan out
 * recompose-all to every active caller.
 *
 * Use this instead of `prisma.playbook.update({ data: { config: ... } })`.
 *
 * @example
 *   await updatePlaybookConfig(courseId, (cfg) => {
 *     cfg.firstCallMode = "baseline_assessment";
 *     return cfg;
 *   }, { reason: "design-route:PUT" });
 */
export async function updatePlaybookConfig(
  playbookId: string,
  transform: (cfg: PlaybookConfig) => PlaybookConfig,
  opts: UpdatePlaybookConfigOpts = {},
): Promise<UpdatePlaybookConfigResult> {
  const playbook = await prisma.playbook.findUnique({
    where: { id: playbookId },
    select: { config: true },
  });
  if (!playbook) {
    throw new Error(`updatePlaybookConfig: playbook ${playbookId} not found`);
  }

  const oldConfig = (playbook.config ?? {}) as PlaybookConfig;
  // Deep-clone via JSON round-trip so the transformer can mutate freely
  // without aliasing the DB row's deserialised object.
  const newConfig = transform(JSON.parse(JSON.stringify(oldConfig)) as PlaybookConfig);

  const changedKeys = COMPOSE_AFFECTING_KEYS.filter((k) =>
    configKeyChanged(oldConfig, newConfig, k),
  );
  const composeAffected = changedKeys.length > 0;

  await prisma.playbook.update({
    where: { id: playbookId },
    // JSON.parse(JSON.stringify(...)) is the canonical Prisma escape hatch
    // for Json columns — strips undefined and Date instances.
    data: { config: JSON.parse(JSON.stringify(newConfig)) },
  });

  if (composeAffected && !opts.skipFanOut) {
    // Fire-and-forget — the caller (route handler / wizard tool) returns
    // immediately. Errors are logged but don't propagate.
    fanOutRecompose(playbookId, changedKeys, opts.reason).catch((err) => {
      console.error(
        `[updatePlaybookConfig] fan-out failed for playbook ${playbookId}:`,
        err instanceof Error ? err.message : err,
      );
    });
  }

  return { composeAffected, changedKeys, config: newConfig };
}

/**
 * Internal fan-out helper. Dynamically imports the enrollment +
 * auto-compose modules so they can be mocked at test time without
 * pulling them through the static dependency graph.
 */
async function fanOutRecompose(
  playbookId: string,
  changedKeys: ComposeAffectingKey[],
  reason?: string,
): Promise<void> {
  const { autoComposeForCaller } = await import("@/lib/enrollment/auto-compose");
  const { getPlaybookRoster } = await import("@/lib/enrollment");
  const pLimit = (await import("p-limit")).default;

  const roster = await getPlaybookRoster(playbookId, "ACTIVE");
  const callerIds = roster
    .map((r) => r.caller?.id)
    .filter((id): id is string => !!id);

  if (callerIds.length === 0) {
    console.log(
      `[updatePlaybookConfig] fan-out: playbook ${playbookId} has no active callers — skipping. changed=[${changedKeys.join(",")}] reason=${reason ?? "(none)"}`,
    );
    return;
  }

  const limit = pLimit(5);
  await Promise.all(
    callerIds.map((cid) => limit(() => autoComposeForCaller(cid, playbookId))),
  );
  console.log(
    `[updatePlaybookConfig] fan-out complete: playbook ${playbookId}, ${callerIds.length} callers, changed=[${changedKeys.join(",")}] reason=${reason ?? "(none)"}`,
  );
}
