/**
 * Playbook.config writer — #826 (Story 2 of EPIC #832).
 *
 * Central enforcement point for writes to `Playbook.config`. Every route
 * / chat tool / lib that mutates `Playbook.config` MUST go through this
 * helper. The ESLint rule `hf-playbook/no-direct-config-write` blocks
 * `prisma.playbook.update({ data: { config: ... } })` calls outside the
 * allowlist (this file + seed/migration scripts + recompose-all).
 *
 * Mechanism — stamp on write, check on read (NOT eager fan-out, see
 * `docs/CHAIN-CONTRACTS.md` §3 Link 3 sub-contract):
 *
 *   1. findUnique current config
 *   2. apply transformer to a deep clone
 *   3. diff against COMPOSE_AFFECTING_PLAYBOOK_CONFIG_KEYS
 *   4. write new config; if any compose-affecting key changed AND
 *      `skipTimestamp` is not set, ALSO write
 *      `composeInputsUpdatedAt = new Date()`
 *   5. return updated playbook
 *
 * Downstream consumers see the staleness via
 * `lib/compose/staleness.ts::isPromptStale` at COMPOSE-entry points
 * (autoComposeForCaller, compose-prompt route). Pipeline COMPOSE has its
 * own carve-out — it always recomposes.
 *
 * ## skipTimestamp
 *
 * Default `false`. Set to `true` for:
 *   - Seed scripts (no callers exist yet)
 *   - Migration scripts (config is being established before enrolment)
 *   - The course-setup scaffold path (pre-enrolment course creation)
 *   - The `create_course` new-playbook branch of `wizard-tool-executor`
 *
 * Do NOT use `skipTimestamp: true` to "save the write" on educator
 * tuning paths — the timestamp bump is the entire point of the helper.
 */

import { prisma } from "@/lib/prisma";
import type { Playbook, Prisma } from "@prisma/client";
import {
  composeAffectingChanged,
  COMPOSE_AFFECTING_PLAYBOOK_CONFIG_KEYS,
} from "@/lib/compose/affecting-keys";
import { triggerEagerRepromptForDemoCallers } from "@/lib/compose/eager-reprompt-on-bump";
import { invalidateAll } from "@/lib/cascade/effective-value";
import type { PlaybookConfig } from "@/lib/types/json-fields";

export interface UpdatePlaybookConfigOptions {
  /**
   * When true, suppresses the `composeInputsUpdatedAt` bump even when
   * compose-affecting keys changed. Use for seed/migration/pre-enrolment
   * writers only.
   */
  skipTimestamp?: boolean;
  /**
   * Diagnostic label written to the log line. Helps trace which writer
   * is responsible for a given timestamp bump.
   */
  reason?: string;
  /**
   * Recompose fan-out scope for this write. Read by the pending-changes
   * tray (epic #854) to set toggle defaults.
   *
   *   'none'   — stamp timestamp only; no immediate recompose (default).
   *              Lazy-auto recompose still fires on next caller touchpoint
   *              via `autoComposeForCaller` + `isPromptStale`.
   *   'caller' — recompose the single caller in context (human OR AI may set).
   *   'all'    — fan out to every active caller on this playbook.
   *              **Human UI only — AI tool executors MUST NOT pass this.**
   *
   * Enforced at AI call sites by the ESLint rule
   * `hf-recompose/no-ai-fanout-all`. This helper does NOT fan out itself;
   * the value is surfaced in the result for upstream code to act on.
   */
  fanoutScope?: 'none' | 'caller' | 'all';
  /**
   * #1078 — Optional Prisma interactive-transaction client.
   *
   * When the V6 wizard projector runs, the trigger-required
   * `SET LOCAL hf.v6_projector = ...` marker is transaction-scoped. The
   * marker write, the snapshot write, and the event write must all
   * happen on the SAME transaction client or the marker is invisible to
   * the Playbook.config write — the DB trigger then (correctly) rejects
   * the snapshot write.
   *
   * Default (undefined) keeps the existing behaviour — uses the global
   * `prisma` client, no transaction. Pass `tx` to participate in an
   * outer transaction.
   */
  tx?: Prisma.TransactionClient;
}

export interface UpdatePlaybookConfigResult {
  playbook: Playbook;
  /** True when at least one COMPOSE-affecting key differed from the prior config. */
  composeAffectingChanged: boolean;
  /** True when the timestamp was bumped (composeAffectingChanged && !skipTimestamp). */
  timestampBumped: boolean;
  /** Echoes the requested fanout scope so callers can branch (default 'none'). */
  fanoutScope: 'none' | 'caller' | 'all';
}

export type PlaybookConfigTransformer = (
  current: PlaybookConfig,
) => PlaybookConfig;

export async function updatePlaybookConfig(
  playbookId: string,
  transformer: PlaybookConfigTransformer,
  options: UpdatePlaybookConfigOptions = {},
): Promise<UpdatePlaybookConfigResult> {
  if (!playbookId) {
    throw new Error("updatePlaybookConfig: playbookId is required");
  }

  // #1078 — read + write through the provided tx client when one is
  // supplied (so V6 `SET LOCAL hf.v6_projector` marker is visible to
  // the DB trigger). Fall through to the global client otherwise.
  const db = options.tx ?? prisma;

  const current = await db.playbook.findUnique({
    where: { id: playbookId },
    select: { config: true },
  });
  if (!current) {
    throw new Error(`updatePlaybookConfig: playbook ${playbookId} not found`);
  }

  const currentConfig = (current.config ?? {}) as PlaybookConfig;
  // Deep-clone so the transformer can mutate freely without surprising
  // the caller's reference to the original config object.
  const nextConfig = transformer(
    JSON.parse(JSON.stringify(currentConfig)) as PlaybookConfig,
  );

  const composeAffected = composeAffectingChanged(
    currentConfig as Record<string, unknown>,
    nextConfig as Record<string, unknown>,
  );
  const shouldBumpTimestamp = composeAffected && !options.skipTimestamp;

  const playbook = await db.playbook.update({
    where: { id: playbookId },
    data: {
      config: nextConfig as object,
      ...(shouldBumpTimestamp && { composeInputsUpdatedAt: new Date() }),
    },
  });

  if (shouldBumpTimestamp) {
    console.log(
      `[updatePlaybookConfig] composeInputsUpdatedAt bumped for ${playbookId}${options.reason ? ` (reason: ${options.reason})` : ""}`,
    );
    // #1429 — eager reprompt for demo callers. Fire-and-forget; runs
    // after the playbook UPDATE commits so the demo callers'
    // `autoComposeForCaller` re-reads the fresh
    // `composeInputsUpdatedAt`. Production callers are untouched —
    // the helper filters on `policyMode='demo'`.
    void triggerEagerRepromptForDemoCallers(playbookId);
  }

  // #1454 Slice 2 — drop every cascade-cache entry so the next
  // `resolveEffective` re-reads fresh. Coarse invalidation: cheaper than
  // diffing the JSON blob to identify exactly which knob keys changed,
  // and the cache rebuilds lazily on demand. Safe even when this writer
  // is called from a non-cascade code path (e.g. wizard, AI tray).
  invalidateAll();

  return {
    playbook,
    composeAffectingChanged: composeAffected,
    timestampBumped: shouldBumpTimestamp,
    fanoutScope: options.fanoutScope ?? 'none',
  };
}

// Re-export the keys list so callers / tests can introspect.
export { COMPOSE_AFFECTING_PLAYBOOK_CONFIG_KEYS };
