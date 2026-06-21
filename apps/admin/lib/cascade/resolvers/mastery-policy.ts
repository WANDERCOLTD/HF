/**
 * Mastery-policy cascade resolver — covers the genuinely cascade-eligible
 * mastery + scoring knobs:
 *
 *   - `skillTierMapping` (Sprint 1 SP1-D, 2026-06-13) — full tier-threshold +
 *     tierBands override (IELTS-style 9-band vs CEFR vs custom). Institution
 *     may want a domain-wide default so individual courses inherit a single
 *     rubric style across the institution.
 *
 *   - `skillScoringEmaHalfLifeDays` (Sprint 1 SP1-D, 2026-06-13) — mastery
 *     responsiveness in days (default 14). Short-demo institutions may want
 *     4d at the Domain level; year-long programmes may want 30d. Per-course
 *     override stays available.
 *
 *   - `tierPresetId` (#2174 S3, 2026-06-21) — banding preset id
 *     (`generic` / `ielts-speaking` / `cefr` / `5-level` / `custom`). Per
 *     Q2 in `docs/SCORING-EDITABILITY.md`: a Domain that hosts many courses
 *     sharing one preset (e.g. a CEFR-shaped Domain with 6 CEFR courses)
 *     should be able to set the preset once at Domain level.
 *
 *   - `loMasteryThreshold` (#2174 S3 / #2052 sub-epic C) — mastery score
 *     required to mark a Learning Objective as passed. Range [0,1].
 *     Read by `lib/prompt/composition/scoring-config.ts::resolveScoringConfig`.
 *
 *   - `assessmentReadinessThreshold` (#2174 S3 / #2052) — mastery the
 *     learner must reach before a post-test/assessment stop fires. Read by
 *     `transforms/instructions.ts` for the assessment_readiness_directive.
 *
 *   - `progressSignals` (#2174 S3 / #2052) — `{lowWater?, highWater?}`
 *     watermarks on engagement-mastery rollup. Object-valued knob — the
 *     resolver treats it as `unknown` and returns the winning layer's
 *     blob untouched; consumers cherry-pick `lowWater`/`highWater` from
 *     the resolved value. NO per-field merging across layers (consistent
 *     with `skillTierMapping`, which is also object-valued and "last
 *     non-null layer wins").
 *
 * These knobs are READ today from `Playbook.config` only — by
 * `lib/banding/presets.ts`, `lib/pipeline/aggregate-runner.ts`,
 * `lib/goals/track-progress.ts`, `lib/prompt/composition/scoring-config.ts`,
 * `transforms/instructions.ts`. The cascade layer adds Domain → Playbook
 * resolution + provenance for the educator UI. The underlying readers can
 * stay Playbook-only until a follow-on slice wires them through this
 * resolver.
 *
 * The other three mastery knobs are NOT cascade-eligible by design:
 *   - `useFreshMastery` — variant-preset intrinsic ("Exam Assessment" identity)
 *   - `maxMasteryTier` — variant-preset intrinsic ("Pop Quiz" cap)
 *   - `scoringMode` — Playbook-only for now; no institutional precedent
 *
 * The Rubric Calibration lens (SP3-A) renders these three with a small
 * variant-preset pill instead of a cascade chip.
 *
 * `Domain.config` is already a `Json?` field — no schema migration. The
 * institution operator writes the override via the existing Domain
 * settings surface (or via the future Cmd+K NLP lane).
 *
 * Sister of:
 *   - `welcome-message.ts` — same Domain-column-vs-Playbook-blob pattern
 *   - `voice-config.ts`    — thin adapter over a domain-specific resolver
 */

// TODO(cascade-provenance): there is no per-key authorship metadata for
// `Playbook.config.*` or `Domain.config.*`. Adding `configUpdatedBy` /
// `configUpdatedAt` columns to both tables would let us surface real
// "Set by Paul on 2026-05-22" provenance. Until then the tray renders
// "Set by (unknown)" for these knobs. Tracked in the same TODO as
// `welcome-message.ts`.

import { prisma } from "@/lib/prisma";

import type { Effective, LayerHit } from "../layer-types";
import type { ScopeChain } from "../effective-value";

const SUPPORTED_KEYS = [
  "skillTierMapping",
  "skillScoringEmaHalfLifeDays",
  // #2174 S3 — 4 additional scoring knobs promoted to Domain → Course
  // cascade (Q2 + Q3 from docs/SCORING-EDITABILITY.md).
  "tierPresetId",
  "loMasteryThreshold",
  "assessmentReadinessThreshold",
  "progressSignals",
] as const;
type MasteryPolicyKey = (typeof SUPPORTED_KEYS)[number];

function isMasteryPolicyKey(k: string): k is MasteryPolicyKey {
  return (SUPPORTED_KEYS as readonly string[]).includes(k);
}

/**
 * Resolver entry called from `FAMILIES` in `effective-value.ts`. Reads
 * Playbook.config + Domain.config and returns the cascade envelope in
 * SYSTEM→CALL order (Domain before Playbook).
 *
 * Throws when:
 *   - `scope.playbookId` missing (every mastery knob is per-course)
 *   - the playbook row isn't found
 *   - the knob key isn't one of the SUPPORTED_KEYS (defence-in-depth;
 *     `pickResolver` in `effective-value.ts` should never dispatch here
 *     for other keys, but better to fail loudly than return stale data)
 */
export async function resolveMasteryPolicyKnob(
  scope: ScopeChain,
  knobKey: string,
): Promise<Effective<unknown>> {
  if (!isMasteryPolicyKey(knobKey)) {
    throw new Error(
      `resolveMasteryPolicyKnob: unsupported knob "${knobKey}". ` +
        `Supported: ${SUPPORTED_KEYS.join(", ")}.`,
    );
  }
  if (!scope.playbookId) {
    throw new Error(
      `resolveMasteryPolicyKnob requires \`playbookId\` in scopeChain (got: ${JSON.stringify(
        scope,
      )})`,
    );
  }

  const playbook = await prisma.playbook.findUnique({
    where: { id: scope.playbookId },
    select: {
      id: true,
      name: true,
      config: true,
      domainId: true,
    },
  });
  if (!playbook) {
    throw new Error(`Playbook not found: ${scope.playbookId}`);
  }

  const domain = await prisma.domain.findUnique({
    where: { id: playbook.domainId },
    select: { id: true, name: true, config: true },
  });

  const pbConfig = (playbook.config ?? {}) as Record<string, unknown>;
  const domainConfig = (domain?.config ?? {}) as Record<string, unknown>;

  // Build `layers` in SYSTEM→CALL order — DOMAIN before PLAYBOOK — so
  // the inspector tray can iterate top-to-bottom without re-sorting.
  const layers: LayerHit<unknown>[] = [];

  const domainValue = domainConfig[knobKey];
  if (domainValue !== undefined && domainValue !== null) {
    layers.push({
      layer: "DOMAIN",
      scopeId: domain!.id,
      scopeLabel: domain!.name,
      value: domainValue,
      setAt: null, // TODO(cascade-provenance)
      setBy: null,
    });
  }

  const playbookValue = pbConfig[knobKey];
  if (playbookValue !== undefined && playbookValue !== null) {
    layers.push({
      layer: "PLAYBOOK",
      scopeId: playbook.id,
      scopeLabel: playbook.name,
      value: playbookValue,
      setAt: null, // TODO(cascade-provenance)
      setBy: null,
    });
  }

  // Deepest (innermost) layer wins — the last entry in SYSTEM→CALL order.
  const winner = layers.length > 0 ? layers[layers.length - 1] : null;

  if (!winner) {
    return {
      value: null,
      source: "SYSTEM",
      layers: [],
      isInherited: false,
      recommendedLayerForEdit: "PLAYBOOK",
    };
  }

  return {
    value: winner.value,
    source: winner.layer,
    layers,
    isInherited: winner.layer !== "PLAYBOOK",
    recommendedLayerForEdit: "PLAYBOOK",
  };
}
