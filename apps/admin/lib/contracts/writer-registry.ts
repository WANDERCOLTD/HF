/**
 * writer-registry.ts (#1619 / Epic #1618 Slice 2)
 *
 * Static registry pairing every nullable schema field that has a UI/API
 * reader with the writer function + pipeline stage + invocation
 * trigger that's expected to populate it. The arch-checker agent walks
 * this registry, greps the codebase for readers of each field, and
 * fails CI when a reader exists for a field whose registered writer
 * has zero callers from the expected stage.
 *
 * The audit on 2026-06-14 found four silent-writer gaps with identical
 * fingerprints (#1608, #1609, #1614, #1615) — all four had a reader
 * surfacing the field in the Attainment / Adaptations tabs while NO
 * writer populated it. The fingerprint:
 *
 *   1. Schema field is nullable (Json? / String[]?)
 *   2. A UI/API reader exists
 *   3. Writer is absent / unwired / triggers on a field the model
 *      never returns
 *   4. UI degrades gracefully to empty state ("No evidence captured")
 *   5. No alarm fires
 *
 * Slice 1 (PR #1625 #1622) added 24h runtime detection. Slice 2 (THIS
 * file + the arch-checker integration) shifts the detection LEFT to
 * PR-time — a reader newly added without a registered writer fails
 * the build before reaching production.
 *
 * Maintenance contract
 * --------------------
 *
 *   - When you add a UI/API reader for a nullable Prisma field, ADD A
 *     ROW to WRITER_REGISTRY pointing at the writer function that
 *     populates it.
 *   - When you add a writer for an existing reader-only field, UPDATE
 *     THE EXISTING ROW so the `writer` and `expectedTrigger` are
 *     accurate.
 *   - When you delete a reader, REMOVE THE ROW (or the registry's
 *     reverse audit will flag the orphan writer).
 *   - When you delete a writer without removing the reader, the
 *     reverse audit fails — this is the gap class the layer exists
 *     to prevent.
 *
 *   The 4 bootstrap rows below cover the exact audit gaps. Add new
 *   rows opportunistically as features land.
 */

/** Where this writer lives in the runtime. */
export type WriterStage =
  | "EXTRACT"
  | "SCORE_AGENT"
  | "AGGREGATE"
  | "REWARD"
  | "ADAPT"
  | "SUPERVISE"
  | "COMPOSE"
  | "ENROLLMENT"
  | "EXTRACTION"
  | "CLI_OR_OPS";

/** When the writer is expected to fire. */
export type WriterTrigger =
  | "per-call"
  | "per-enrollment"
  | "per-content-upload"
  | "operator-action"
  | "scheduled";

export interface WriterRegistryEntry {
  /**
   * The nullable Prisma field this entry pairs. Dotted path:
   * `{Model}.{field}` or `{Model}.{field}.{nestedKey}` when the field
   * is JSON with a contractually-required inner key.
   */
  field: string;

  /**
   * The writer function (or call site) that populates the field.
   * Symbol form (`file::symbol`), NOT line numbers — files drift.
   */
  writer: string;

  /** Where in the pipeline / system lifecycle this writer fires. */
  stage: WriterStage;

  /** Cadence the writer is expected to run at. */
  expectedTrigger: WriterTrigger;

  /**
   * Stable identifier for the reader that consumes this field —
   * usually a route + symbol or a component path. Used by the
   * reverse audit (orphan-writer detector).
   */
  reader: string;

  /**
   * Short description of WHAT the field carries, so a reviewer
   * landing here knows why the row exists.
   */
  description: string;

  /**
   * The issue / PR that closed the original silent-writer gap for
   * this field. Helpful for archaeology when the registry grows.
   */
  closedBy: string;
}

export const WRITER_REGISTRY: readonly WriterRegistryEntry[] = [
  // ── #1608 — BehaviorMeasurement.evidence ────────────────────────
  // Pre-fix: 4,259 rows DB-wide carried the literal `["AI analysis"]`
  // placeholder because the SCORE_AGENT batch prompt never asked for
  // evidence quotes. PR #1613 closed it by requesting `e:["..."]`.
  {
    field: "BehaviorMeasurement.evidence",
    writer: "app/api/calls/[callId]/pipeline/route.ts::buildBatchedAgentPrompt + lib/pipeline/normalize-score-agent-evidence.ts::normalizeScoreAgentEvidence",
    stage: "SCORE_AGENT",
    expectedTrigger: "per-call",
    reader: "components/callers/caller-detail/AttainmentTab.tsx::SkillEvidencePanel",
    description: "Verbatim learner quotes from transcript supporting each behavior score (SP4-A evidence trail).",
    closedBy: "#1608 / PR #1613",
  },

  // ── #1609 — RewardScore.targetUpdatesApplied ────────────────────
  // Pre-fix: 73 rows DB-wide had NULL targetUpdatesApplied because
  // `updateTargets` was admin-ops-only. PR #1629 wired it into ADAPT
  // sub-op 8.
  {
    field: "RewardScore.targetUpdatesApplied",
    writer: "lib/ops/update-targets.ts::updateTargets",
    stage: "ADAPT",
    expectedTrigger: "per-call",
    reader: "app/api/callers/[callerId]/adaptations/route.ts",
    description: "Per-call reward-feedback loop closure: BehaviorTarget adjustments applied, or `[]` sentinel when within tolerance.",
    closedBy: "#1609 / PR #1629",
  },

  // ── #1614 — Goal.progressMetrics ────────────────────────────────
  // Pre-fix: 1,000 NULL + 113 frozen-at-extraction rows. PR #1627
  // wired the writer into `trackGoalProgress`.
  {
    field: "Goal.progressMetrics",
    writer: "lib/goals/append-progress-entry.ts::appendGoalProgressEntry (invoked from lib/goals/track-progress.ts::trackGoalProgress)",
    stage: "ADAPT",
    expectedTrigger: "per-call",
    reader: "app/api/callers/[callerId]/attainment/route.ts::buildGoalTrail",
    description: "Per-call evidence trail + mentionCount + lastMentionedAt for each goal (SP4-D evidence trail).",
    closedBy: "#1614 / PR #1627",
  },

  // ── #1641 — RewardScore.effectiveTargets ────────────────────────
  // Pre-fix: NEVER written. updateTargets filtered findMany on
  // `effectiveTargets: { not: DbNull }` and read per-param `{target,
  // confidence, scope}`. PR #1648 closed it.
  {
    field: "RewardScore.effectiveTargets",
    writer: "app/api/calls/[callId]/pipeline/route.ts::computeReward",
    stage: "REWARD",
    expectedTrigger: "per-call",
    reader: "lib/ops/update-targets.ts::updateTargets",
    description: "Snapshot of the SYSTEM+PLAYBOOK cascade-merged targets at REWARD time. Required by updateTargets to compute adjustments downstream.",
    closedBy: "#1641 / PR #1648",
  },
] as const;

/**
 * Lookup an entry by its canonical field path. Throws when not found
 * — the registry is meant to be exhaustive for actively-monitored
 * fields. `null` would silently hide a missing row.
 */
export function getRegistryEntry(field: string): WriterRegistryEntry {
  const entry = WRITER_REGISTRY.find((r) => r.field === field);
  if (!entry) {
    throw new Error(
      `WRITER_REGISTRY has no entry for "${field}". If you added a reader for this field, register its writer in lib/contracts/writer-registry.ts.`,
    );
  }
  return entry;
}

/** Stable list of every registered field — used by arch-checker. */
export const REGISTERED_FIELDS: readonly string[] = WRITER_REGISTRY.map((r) => r.field);
