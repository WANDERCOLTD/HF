/**
 * Skill resolver — single helper for converting logical skill identifiers
 * (`SKILL-NN` stable refs) into verified `BehaviorTarget` + `Parameter` +
 * `ParsedSkill` data scoped to a specific playbook.
 *
 * Why a dedicated resolver?
 *
 * Skill refs (`SKILL-01`, `SKILL-02`, ...) are NOT globally unique. They are
 * per-playbook stable IDs emitted by `parseSkillsFramework` and persisted on
 * `BehaviorTarget.skillRef` at PLAYBOOK scope. A different playbook (CTO Pop
 * Quiz vs CTO Revision Aid) can independently declare `SKILL-01` with a
 * different meaning. Unscoped `findFirst({ where: { skillRef } })` would
 * pick non-deterministically across all playbooks in the DB — the same
 * failure class as the slug-scope bug epic #407.
 *
 * Every code path that needs to resolve a skill ref to its concrete data
 * (target value, parameter id, tier descriptors) MUST go through this
 * helper. Direct unscoped Prisma lookups are rejected at runtime (the
 * helper throws on empty `playbookId`).
 *
 * Sister of `resolve-module.ts::resolveModuleByLogicalId`. See
 * `docs/draft-issues/handoff-skills-framework-heatmap.md` invariant 1 +
 * Stream A-B.
 */
import { prisma } from "@/lib/prisma";

export interface ResolvedSkill {
  /** The persisted `BehaviorTarget.id`. */
  behaviorTargetId: string;
  /** The persisted `BehaviorTarget.parameterId` — points at a `skill_*` Parameter. */
  parameterId: string;
  /** `BehaviorTarget.skillRef` echoed for caller convenience. */
  skillRef: string;
  /** Target value (`band / 10` for IELTS-style courses; 1.0 fallback). */
  targetValue: number;
  /**
   * Per-skill `tierScheme` if the skill's owning Parameter carries it on its
   * config. Empty when the skill predates the table-form projection or the
   * Parameter wasn't seeded with a `tierScheme` value.
   *
   * Per the handoff doc invariant 2 (corrected 2026-06-13): `tierScheme` is
   * PER-SKILL, not per-playbook. Two skills in the same playbook MAY use
   * different schemes.
   */
  tierScheme: readonly string[];
}

/**
 * Resolve a logical skill identifier to a verified `(behaviorTargetId,
 * parameterId, targetValue, tierScheme)` tuple scoped to the given playbook.
 *
 * Returns null when the skill ref isn't declared on this playbook (the
 * heatmap renderer treats null as "skill not part of this course's
 * framework" — render an empty row, don't throw).
 *
 * Throws when `playbookId` is falsy. The throw is intentional and matches
 * `resolveModuleByLogicalId` semantics — unscoped lookups corrupt
 * cross-playbook reads.
 */
export async function resolveSkillByLogicalId(
  playbookId: string,
  skillRef: string,
): Promise<ResolvedSkill | null> {
  if (!playbookId) {
    throw new Error(
      "resolveSkillByLogicalId: playbookId is required. " +
        "Unscoped skill-ref lookups corrupt cross-playbook reads — see #407 (slug-scope) lineage.",
    );
  }
  if (!skillRef) return null;

  const bt = await prisma.behaviorTarget.findFirst({
    where: {
      playbookId,
      skillRef,
      effectiveUntil: null,
    },
    select: {
      id: true,
      parameterId: true,
      skillRef: true,
      targetValue: true,
      parameter: {
        select: { config: true },
      },
    },
  });
  if (!bt) return null;

  // Per-skill `tierScheme` lives on `Parameter.config.tierScheme` (written
  // by `apply-projection.ts` when the table-form parser emits it).
  // Heading-form skills predate this field — they fall back to the default
  // 3-tier scheme `["emerging", "developing", "secure"]` consumed by the
  // renderer.
  const cfg = (bt.parameter?.config as Record<string, unknown> | null) ?? {};
  const tierScheme =
    Array.isArray(cfg.tierScheme) && cfg.tierScheme.every((t) => typeof t === "string")
      ? (cfg.tierScheme as string[])
      : ["emerging", "developing", "secure"];

  return {
    behaviorTargetId: bt.id,
    parameterId: bt.parameterId,
    skillRef: bt.skillRef ?? skillRef,
    targetValue: bt.targetValue ?? 1.0,
    tierScheme,
  };
}

/**
 * Bulk variant — resolves every `SKILL-*` BehaviorTarget on a playbook in
 * one query. The Skills Framework Inspector's Framework Map lens calls
 * this once per render to populate the rows.
 *
 * Returns `[]` (not null) when the playbook has zero `SKILL-*` targets —
 * typical of courses without a parseable Skills Framework (the
 * `PROJECTION_NO_SKILLS_FRAMEWORK` blocker flagged at create time).
 */
export async function resolveAllSkillsForPlaybook(
  playbookId: string,
): Promise<ResolvedSkill[]> {
  if (!playbookId) {
    throw new Error(
      "resolveAllSkillsForPlaybook: playbookId is required.",
    );
  }
  const rows = await prisma.behaviorTarget.findMany({
    where: {
      playbookId,
      skillRef: { startsWith: "SKILL-" },
      effectiveUntil: null,
    },
    select: {
      id: true,
      parameterId: true,
      skillRef: true,
      targetValue: true,
      parameter: {
        select: { config: true },
      },
    },
    orderBy: { skillRef: "asc" },
  });
  return rows.map((bt) => {
    const cfg = (bt.parameter?.config as Record<string, unknown> | null) ?? {};
    const tierScheme =
      Array.isArray(cfg.tierScheme) && cfg.tierScheme.every((t) => typeof t === "string")
        ? (cfg.tierScheme as string[])
        : ["emerging", "developing", "secure"];
    return {
      behaviorTargetId: bt.id,
      parameterId: bt.parameterId,
      skillRef: bt.skillRef ?? "",
      targetValue: bt.targetValue ?? 1.0,
      tierScheme,
    };
  });
}
