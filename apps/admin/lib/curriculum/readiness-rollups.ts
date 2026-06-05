/**
 * Readiness rollups — #1098 Slice A.
 *
 * Derived CallerAttributes that summarise a learner's progress against a
 * qualification (rather than a single Curriculum). Written by the AGGREGATE
 * pipeline stage after `updateCurriculumProgress` writes per-LO `lo_mastery:*`
 * keys; consumed by `/api/student/qualification-progress` and the qualification
 * dashboard surfaces.
 *
 * Two key shapes (both `scope: CURRICULUM`):
 *
 *   unit_readiness:{moduleSlug}
 *     { tier, losCovered, losTotal, weakestLoRef }
 *
 *   qualification_readiness:{anchor}
 *     { tier, unitsCovered, unitsTotal, weakestUnitSlug }
 *
 * Cross-course dedup (AC2): when a learner's mastery evidence lives across
 * sibling Curricula sharing the same qualificationAnchor (Revision Aid, Pop
 * Quiz, Exam Assessment all teaching the SAME LOs via the variant pattern
 * #1034), we dedup the lo_mastery rows by `loRef` taking the maximum score.
 * The Slice 2B.3 CI guard enforces module-slug + LO-ref parity across siblings
 * so the merge is safe.
 *
 * Exam Assessment isolation (AC3): mock-exam LO scores write to
 * `Call.scratchMastery` (Slice 1) rather than the long-term `lo_mastery:*`
 * store, so they never enter the dedup map by construction. The caller of
 * `computeReadinessRollups` enforces this at the boundary by skipping the
 * rollup whenever `Playbook.config.useFreshMastery === true`.
 *
 * Tier semantics:
 *   - `unit.tier` = highest tier hit by ANY covered LO in the unit
 *   - `losCovered` = # of covered LOs at unit.tier or above
 *   - `weakestLoRef` = the LO with the strictly minimum score in the unit
 *     (the natural "next focus" pick). Null when all LOs share the same score.
 *   - `qualification.tier` = max(unit.tier) across units with at least one
 *     covered LO
 *   - `unitsCovered` = # of units at qualification.tier
 *   - `weakestUnitSlug` = unit with the lowest unit.tier OR the first unit
 *     slug (lexicographic) with NO covered LOs. Null when all units are at
 *     qualification.tier.
 */

import { prisma } from "@/lib/prisma";
import { findSiblingCurricula } from "@/lib/curriculum/find-sibling-curricula";
import {
  type MasteryTier,
  TIER_RANK,
  TIER_NUMERIC_CEILING,
} from "@/lib/curriculum/mastery-tiers";

export interface UnitReadinessPayload {
  tier: MasteryTier;
  losCovered: number;
  losTotal: number;
  weakestLoRef: string | null;
}

export interface QualificationReadinessPayload {
  tier: MasteryTier;
  unitsCovered: number;
  unitsTotal: number;
  weakestUnitSlug: string | null;
}

const UNIT_KEY_PREFIX = "unit_readiness:";
const QUAL_KEY_PREFIX = "qualification_readiness:";

/**
 * Classify a numeric mastery score [0, 1] to a tier band. Returns null for
 * scores at or below zero — the rollup treats those as "no evidence" and
 * excludes them from the dedup map. The band boundaries match
 * `TIER_NUMERIC_CEILING` (inclusive upper bound per tier).
 */
export function classifyScore(score: number): MasteryTier | null {
  if (!Number.isFinite(score) || score <= 0) return null;
  if (score <= TIER_NUMERIC_CEILING.FOUNDATION) return "FOUNDATION";
  if (score <= TIER_NUMERIC_CEILING.DEVELOPING) return "DEVELOPING";
  if (score <= TIER_NUMERIC_CEILING.PRACTITIONER) return "PRACTITIONER";
  return "DISTINCTION";
}

interface UnitCatalog {
  /** module slug → set of LO refs declared on that module across all siblings */
  modulesBySlug: Map<string, Set<string>>;
}

/**
 * Read the module + LO catalog across all sibling Curricula sharing the anchor,
 * deduplicated by moduleSlug. Slice 2B.3's CI guard guarantees slug + LO-ref
 * parity across siblings, so the merge is non-lossy.
 */
async function readUnitCatalog(siblingIds: string[]): Promise<UnitCatalog> {
  const moduleRows = await prisma.curriculumModule.findMany({
    where: { curriculumId: { in: siblingIds } },
    select: {
      slug: true,
      learningObjectives: { select: { ref: true } },
    },
  });

  const modulesBySlug = new Map<string, Set<string>>();
  for (const mod of moduleRows) {
    if (!mod.slug) continue;
    let refs = modulesBySlug.get(mod.slug);
    if (!refs) {
      refs = new Set<string>();
      modulesBySlug.set(mod.slug, refs);
    }
    for (const lo of mod.learningObjectives) {
      if (lo.ref) refs.add(lo.ref);
    }
  }
  return { modulesBySlug };
}

/**
 * Read all `lo_mastery:*` CallerAttribute rows for the caller across the
 * sibling Curricula and return a deduplicated map of loRef → max score (AC2).
 *
 * Key shape we parse: `curriculum:<slug>:lo_mastery:<moduleSlug>:<loRef>`.
 * Rows under any non-sibling slug are skipped — this is the same prefix-scope
 * discipline as `buildLoMasteryMap` extended to a slug-set.
 */
async function readDedupedLoMastery(
  callerId: string,
  siblingSlugs: string[],
): Promise<Map<string, number>> {
  if (siblingSlugs.length === 0) return new Map();

  const attrs = await prisma.callerAttribute.findMany({
    where: {
      callerId,
      scope: "CURRICULUM",
      key: { contains: ":lo_mastery:" },
    },
    select: { key: true, numberValue: true },
  });

  const siblingSlugSet = new Set(siblingSlugs);
  const bestByLoRef = new Map<string, number>();

  for (const attr of attrs) {
    if (attr.numberValue == null) continue;
    if (!attr.key.startsWith("curriculum:")) continue;
    const afterPrefix = attr.key.slice("curriculum:".length);
    const loMarker = afterPrefix.indexOf(":lo_mastery:");
    if (loMarker < 0) continue;

    const slug = afterPrefix.slice(0, loMarker);
    if (!siblingSlugSet.has(slug)) continue;

    const suffix = afterPrefix.slice(loMarker + ":lo_mastery:".length);
    const lastColon = suffix.lastIndexOf(":");
    if (lastColon < 0) continue;
    const loRef = suffix.slice(lastColon + 1);
    if (!loRef) continue;

    const existing = bestByLoRef.get(loRef);
    if (existing == null || attr.numberValue > existing) {
      bestByLoRef.set(loRef, attr.numberValue);
    }
  }

  return bestByLoRef;
}

/**
 * Compute one unit's readiness payload given its LO refs and the deduped
 * mastery map. Returns null when no LO in this unit has any evidence (the
 * unit is omitted from the rollup writes entirely).
 */
export function computeUnitPayload(
  loRefs: Iterable<string>,
  bestByLoRef: ReadonlyMap<string, number>,
): UnitReadinessPayload | null {
  const refs = Array.from(loRefs).sort();
  if (refs.length === 0) return null;

  let maxTierRank = -1;
  let topTier: MasteryTier | null = null;
  let coveredCount = 0;
  let minScore = Number.POSITIVE_INFINITY;
  let maxScore = Number.NEGATIVE_INFINITY;
  let weakestLoRef: string | null = null;

  for (const ref of refs) {
    const score = bestByLoRef.get(ref) ?? 0;
    const tier = classifyScore(score);
    if (tier != null) {
      coveredCount += 1;
      const rank = TIER_RANK[tier];
      if (rank > maxTierRank) {
        maxTierRank = rank;
        topTier = tier;
      }
    }
    if (score < minScore) {
      minScore = score;
      weakestLoRef = ref;
    }
    if (score > maxScore) maxScore = score;
  }

  if (topTier == null) return null;

  // Recount: losCovered = LOs at topTier or above (not just "any evidence").
  let losAtOrAboveTopTier = 0;
  for (const ref of refs) {
    const score = bestByLoRef.get(ref) ?? 0;
    const tier = classifyScore(score);
    if (tier != null && TIER_RANK[tier] >= maxTierRank) {
      losAtOrAboveTopTier += 1;
    }
  }

  // If every LO has the same score, there is no "weakest" to surface.
  const homogenous = minScore === maxScore;

  return {
    tier: topTier,
    losCovered: losAtOrAboveTopTier,
    losTotal: refs.length,
    weakestLoRef: homogenous ? null : weakestLoRef,
  };
}

/**
 * Compute the qualification-level rollup given the per-unit payloads + the
 * full unit catalog (so unitsTotal counts units regardless of evidence).
 */
export function computeQualificationPayload(
  unitPayloads: ReadonlyMap<string, UnitReadinessPayload>,
  allUnitSlugs: readonly string[],
): QualificationReadinessPayload | null {
  if (unitPayloads.size === 0) return null;

  let maxTierRank = -1;
  let topTier: MasteryTier | null = null;
  let weakestUnitSlug: string | null = null;
  let weakestUnitRank = Number.POSITIVE_INFINITY;

  for (const [slug, payload] of unitPayloads) {
    const rank = TIER_RANK[payload.tier];
    if (rank > maxTierRank) {
      maxTierRank = rank;
      topTier = payload.tier;
    }
    if (rank < weakestUnitRank) {
      weakestUnitRank = rank;
      weakestUnitSlug = slug;
    }
  }
  if (topTier == null) return null;

  let unitsAtOrAboveTopTier = 0;
  for (const [, payload] of unitPayloads) {
    if (TIER_RANK[payload.tier] >= maxTierRank) unitsAtOrAboveTopTier += 1;
  }

  // Prefer surfacing a unit with NO evidence as the weakest, when one exists.
  // It's a stronger "focus next" signal than a unit that's already tier-ranked.
  const sortedAllSlugs = [...allUnitSlugs].sort();
  const firstUncoveredSlug = sortedAllSlugs.find((s) => !unitPayloads.has(s)) ?? null;
  const effectiveWeakest =
    firstUncoveredSlug != null
      ? firstUncoveredSlug
      : weakestUnitRank < maxTierRank
        ? weakestUnitSlug
        : null;

  return {
    tier: topTier,
    unitsCovered: unitsAtOrAboveTopTier,
    unitsTotal: allUnitSlugs.length,
    weakestUnitSlug: effectiveWeakest,
  };
}

/**
 * Top-level rollup writer. Called from `updateCurriculumProgress` after the
 * per-LO `lo_mastery:*` writes complete. No-op for Curricula without a
 * qualificationAnchor — the rollup only makes sense for qualification-family
 * Curricula (the variant pattern from #1034).
 *
 * Idempotent and eventually consistent — safe to call multiple times for the
 * same call. Failures are logged but never throw (the AGGREGATE pipeline must
 * not roll back the upstream lo_mastery writes on a derived-attribute hiccup).
 */
export async function computeReadinessRollups(
  callerId: string,
  curriculumId: string,
): Promise<void> {
  try {
    const curriculum = await prisma.curriculum.findUnique({
      where: { id: curriculumId },
      select: { qualificationAnchor: true },
    });
    const anchor = curriculum?.qualificationAnchor ?? null;
    if (!anchor) return;

    const siblings = await findSiblingCurricula(anchor);
    if (siblings.length === 0) return;
    const siblingIds = siblings.map((s) => s.id);
    const siblingSlugs = siblings.map((s) => s.slug);

    const catalog = await readUnitCatalog(siblingIds);
    if (catalog.modulesBySlug.size === 0) return;

    const bestByLoRef = await readDedupedLoMastery(callerId, siblingSlugs);

    // Compute per-unit payloads. Units with no covered LO are excluded.
    const unitPayloads = new Map<string, UnitReadinessPayload>();
    for (const [moduleSlug, loRefs] of catalog.modulesBySlug) {
      const payload = computeUnitPayload(loRefs, bestByLoRef);
      if (payload != null) unitPayloads.set(moduleSlug, payload);
    }

    const qualPayload = computeQualificationPayload(
      unitPayloads,
      Array.from(catalog.modulesBySlug.keys()),
    );

    const writes: Promise<unknown>[] = [];
    for (const [moduleSlug, payload] of unitPayloads) {
      const key = `${UNIT_KEY_PREFIX}${moduleSlug}`;
      writes.push(
        prisma.callerAttribute.upsert({
          where: {
            callerId_key_scope: { callerId, key, scope: "CURRICULUM" },
          },
          create: {
            callerId,
            key,
            scope: "CURRICULUM",
            valueType: "JSON",
            jsonValue: payload as unknown as object,
          },
          update: {
            valueType: "JSON",
            jsonValue: payload as unknown as object,
          },
        }),
      );
    }
    if (qualPayload != null) {
      const key = `${QUAL_KEY_PREFIX}${anchor}`;
      writes.push(
        prisma.callerAttribute.upsert({
          where: {
            callerId_key_scope: { callerId, key, scope: "CURRICULUM" },
          },
          create: {
            callerId,
            key,
            scope: "CURRICULUM",
            valueType: "JSON",
            jsonValue: qualPayload as unknown as object,
          },
          update: {
            valueType: "JSON",
            jsonValue: qualPayload as unknown as object,
          },
        }),
      );
    }
    await Promise.all(writes);
  } catch (err: unknown) {
    console.warn(
      `[readiness-rollups] failed for caller=${callerId} curriculum=${curriculumId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
