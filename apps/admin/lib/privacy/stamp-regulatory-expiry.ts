/**
 * stamp-regulatory-expiry — derive `Call.regulatoryExpiresAt` at create-time.
 *
 * Closes the I-PR3 invariant from `docs/CHAIN-CONTRACTS.md §6a` (epic
 * #1915 child #1917). Every code path that creates a `Call` row routes
 * through here so the regulatory expiry is stamped at write-time, not
 * computed later when the original preset is unknowable.
 *
 * Layered resolution (highest precedence first):
 *
 *   1. **Preset retention days** — when the per-Playbook `privacyPresetId`
 *      cascade ships (#1925), `resolvePrivacyPreset(presetId)` returns
 *      the preset's `retentionDays`. Not wired yet — call sites pass
 *      `presetRetentionDays: null` until #1925.
 *   2. **Env fallback** — `config.retention.callerDataDays` (env
 *      `RETENTION_CALLER_DATA_DAYS`, default 0 = disabled). When `> 0`,
 *      stamp `regulatoryExpiresAt = now + N days`.
 *   3. **NULL** — when neither layer resolves, the column stays NULL.
 *      Retention cleanup skips NULL rows; the legacy caller-level
 *      cleanup keeps working for those callers.
 *
 * **Backfill discipline:** existing rows MUST stay NULL (see migration
 * `20260618120000_1917_call_regulatory_expires_at/migration.sql` for the
 * three reasons computed-date backfill is structurally wrong).
 *
 * @see docs/CHAIN-CONTRACTS.md §6a I-PR3
 * @see #1917 (this enforcer) · #1915 (epic)
 * @see lib/privacy/policy-presets.ts (#1924, deferred — presetRetentionDays plumbed there when it lands)
 */

import { config } from "@/lib/config";

export interface StampRegulatoryExpiryArgs {
  /**
   * Preset-derived retention in days, when the cascade resolves a non-Basic
   * preset. NULL during the pre-#1925 window or when the preset is "Basic".
   * When NULL, the env fallback `RETENTION_CALLER_DATA_DAYS` takes over.
   */
  presetRetentionDays: number | null;
  /** Override `now()` for tests. */
  now?: Date;
}

/**
 * Compute the regulatory expiry timestamp for a new `Call` row.
 *
 * Returns `null` when no retention policy resolves — caller spreads the
 * field optionally (`...(expiry ? { regulatoryExpiresAt: expiry } : {})`)
 * so the row write doesn't carry an explicit NULL when nothing was decided.
 */
export function stampRegulatoryExpiry({
  presetRetentionDays,
  now,
}: StampRegulatoryExpiryArgs): Date | null {
  const days =
    presetRetentionDays !== null && presetRetentionDays > 0
      ? presetRetentionDays
      : config.retention.callerDataDays > 0
        ? config.retention.callerDataDays
        : null;

  if (days === null) return null;

  const base = now ?? new Date();
  return new Date(base.getTime() + days * 86400000);
}

// #1917 — re-trigger CI 2026-06-18 (GH Actions stuck on this branch)
