import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { resolveCallerScopeForReading, isScopeError } from "@/lib/learner-scope";
import {
  loadQualificationCatalog,
  getCourseTypeDisplayName,
  type QualificationCatalog,
} from "@/lib/curriculum/display-names";
import {
  classifyScore,
  type UnitReadinessPayload,
  type QualificationReadinessPayload,
} from "@/lib/curriculum/readiness-rollups";
import { TIER_RANK, type MasteryTier } from "@/lib/curriculum/mastery-tiers";

/**
 * @api GET /api/student/qualification-progress
 * @visibility public
 * @scope progress:read
 * @auth session
 * @tags student, progress, qualification
 * @description Returns the learner's progress against their active qualification —
 *   the qualification dashboard's data source. Composed from the AGGREGATE-written
 *   `unit_readiness:*` + `qualification_readiness:*` CallerAttributes (#1098 Slice A)
 *   plus per-LO `lo_mastery:*` for the expandable view.
 *
 *   Scope: STUDENT sessions are pinned to their own LEARNER Caller (per #977
 *   invariant `resolveCallerScopeForReading`). OPERATOR+ can request any caller
 *   via `?callerId=`.
 * @query callerId string — Target Caller id (OPERATOR+ only; STUDENT requests are
 *   pinned to their own caller).
 * @response 200 { ok: true, qualification: Qualification | null, units: Unit[],
 *   skills: Skill[], recentActivity: Activity[], nextBestStep: NextBestStep | null }
 *
 *   `qualification: null` indicates the learner's active enrollment is on a
 *   Curriculum without a `qualificationAnchor` — the existing generic progress
 *   page is the correct surface.
 * @response 401 { ok: false, error: "Unauthorized" }
 * @response 404 { ok: false, error: "no active enrollment" }
 */
export async function GET(req: Request) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const url = new URL(req.url);
    const requestedCallerId = url.searchParams.get("callerId");
    const scope = await resolveCallerScopeForReading(authResult.session, requestedCallerId);
    if (isScopeError(scope)) return scope.error;
    const callerId = scope.scopedCallerId;
    if (!callerId) {
      return NextResponse.json(
        { ok: false, error: "no callerId in session" },
        { status: 404 },
      );
    }

    const activeEnrollment = await prisma.callerPlaybook.findFirst({
      where: { callerId, status: "ACTIVE" },
      orderBy: [{ isDefault: "desc" }, { enrolledAt: "desc" }],
      include: {
        playbook: {
          select: {
            id: true,
            config: true,
            // #1034 — many-to-many via PlaybookCurriculum, NOT the deprecated
            // direct `curricula` relation (which is the Curriculum.playbookId
            // back-reference, dropped in #1038).
            playbookCurricula: {
              select: {
                role: true,
                curriculum: {
                  select: {
                    id: true,
                    slug: true,
                    name: true,
                    qualificationAnchor: true,
                    qualificationBody: true,
                    qualificationNumber: true,
                    qualificationLevel: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!activeEnrollment?.playbook) {
      return NextResponse.json(
        { ok: false, error: "no active enrollment" },
        { status: 404 },
      );
    }

    const links = activeEnrollment.playbook.playbookCurricula;
    const primaryLink = links.find((l) => l.role === "primary") ?? links[0];
    const curriculum = primaryLink?.curriculum ?? null;
    const anchor = curriculum?.qualificationAnchor ?? null;

    // Non-anchored Curriculum — caller of the API should fall back to the
    // existing generic progress surface. We still return 200 to keep clients
    // simple; just the qualification field is null.
    if (!anchor || !curriculum) {
      return NextResponse.json({
        ok: true,
        qualification: null,
        units: [],
        skills: [],
        recentActivity: [],
        nextBestStep: null,
      });
    }

    const [catalog, allAttrs] = await Promise.all([
      loadQualificationCatalog(anchor),
      prisma.callerAttribute.findMany({
        where: {
          callerId,
          scope: "CURRICULUM",
          OR: [
            { key: { startsWith: "unit_readiness:" } },
            { key: { startsWith: "qualification_readiness:" } },
            { key: { contains: ":lo_mastery:" } },
            { key: { startsWith: "skill_mastery:" } },
          ],
        },
        select: { key: true, jsonValue: true, numberValue: true },
      }),
    ]);

    if (!catalog) {
      return NextResponse.json({
        ok: true,
        qualification: null,
        units: [],
        skills: [],
        recentActivity: [],
        nextBestStep: null,
      });
    }

    const unitReadinessByKey = new Map<string, UnitReadinessPayload>();
    let qualificationReadiness: QualificationReadinessPayload | null = null;
    const loMasteryByRef = new Map<string, number>();
    const skillTierByRef = new Map<string, MasteryTier>();

    for (const attr of allAttrs) {
      if (attr.key.startsWith("unit_readiness:")) {
        const moduleSlug = attr.key.slice("unit_readiness:".length);
        if (isUnitReadinessPayload(attr.jsonValue)) {
          unitReadinessByKey.set(moduleSlug, attr.jsonValue);
        }
        continue;
      }
      if (attr.key === `qualification_readiness:${anchor}`) {
        if (isQualificationReadinessPayload(attr.jsonValue)) {
          qualificationReadiness = attr.jsonValue;
        }
        continue;
      }
      if (attr.key.startsWith("skill_mastery:")) {
        const skillRef = attr.key.slice("skill_mastery:".length);
        const tier = classifyScore(attr.numberValue ?? 0);
        if (tier) skillTierByRef.set(skillRef, tier);
        continue;
      }
      // lo_mastery:* — key shape curriculum:<slug>:lo_mastery:<moduleSlug>:<loRef>
      const lastColon = attr.key.lastIndexOf(":");
      if (lastColon > 0) {
        const loRef = attr.key.slice(lastColon + 1);
        const score = attr.numberValue ?? 0;
        const prev = loMasteryByRef.get(loRef);
        if (prev == null || score > prev) loMasteryByRef.set(loRef, score);
      }
    }

    const units = composeUnits(catalog, unitReadinessByKey, loMasteryByRef);
    const skills = composeSkills(catalog, skillTierByRef);

    const qualificationOut = composeQualification(
      curriculum,
      qualificationReadiness,
      units,
    );

    const nextBestStep = composeNextBestStep(
      qualificationReadiness,
      unitReadinessByKey,
      activeEnrollment.playbook.config,
    );

    return NextResponse.json({
      ok: true,
      qualification: qualificationOut,
      units,
      skills,
      // Recent activity feed is wired in Slice B (#1098 C5+). For Slice A we
      // return the shape with an empty list so clients can render the section
      // header without branching on its presence.
      recentActivity: [],
      nextBestStep,
    });
  } catch (error: unknown) {
    console.error("[qualification-progress] failed:", error);
    return NextResponse.json(
      { ok: false, error: "failed to load qualification progress" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Composers
// ---------------------------------------------------------------------------

interface UnitResponse {
  moduleSlug: string;
  displayName: string;
  tier: MasteryTier | null;
  losCovered: number;
  losTotal: number;
  weakestLoRef: string | null;
  learningObjectives: Array<{
    ref: string;
    displayName: string;
    learnerStatement: string;
    tier: MasteryTier | null;
    score: number;
  }>;
}

function composeUnits(
  catalog: QualificationCatalog,
  unitReadiness: ReadonlyMap<string, UnitReadinessPayload>,
  loMastery: ReadonlyMap<string, number>,
): UnitResponse[] {
  const out: UnitResponse[] = [];
  for (const [slug, entry] of catalog.units) {
    const readiness = unitReadiness.get(slug) ?? null;
    out.push({
      moduleSlug: slug,
      displayName: entry.title,
      tier: readiness?.tier ?? null,
      losCovered: readiness?.losCovered ?? 0,
      losTotal: entry.learningObjectives.length,
      weakestLoRef: readiness?.weakestLoRef ?? null,
      learningObjectives: entry.learningObjectives.map((lo) => {
        const score = loMastery.get(lo.ref) ?? 0;
        return {
          ref: lo.ref,
          displayName: lo.description?.trim() || lo.ref,
          learnerStatement: lo.performanceStatement?.trim() || lo.description?.trim() || lo.ref,
          tier: classifyScore(score),
          score,
        };
      }),
    });
  }
  return out;
}

function composeSkills(
  catalog: QualificationCatalog,
  skillTiers: ReadonlyMap<string, MasteryTier>,
): Array<{ ref: string; name: string; tier: MasteryTier | null }> {
  const out: Array<{ ref: string; name: string; tier: MasteryTier | null }> = [];
  for (const [ref, entry] of catalog.skills) {
    out.push({ ref, name: entry.name, tier: skillTiers.get(ref) ?? null });
  }
  return out;
}

function composeQualification(
  curriculum: {
    qualificationAnchor: string | null;
    name: string;
    qualificationBody: string | null;
    qualificationNumber: string | null;
    qualificationLevel: string | null;
  },
  qualReadiness: QualificationReadinessPayload | null,
  units: readonly UnitResponse[],
) {
  let losAtTierOrAbove = 0;
  let losTotal = 0;
  if (qualReadiness?.tier) {
    const targetRank = TIER_RANK[qualReadiness.tier];
    for (const unit of units) {
      for (const lo of unit.learningObjectives) {
        losTotal += 1;
        if (lo.tier != null && TIER_RANK[lo.tier] >= targetRank) {
          losAtTierOrAbove += 1;
        }
      }
    }
  } else {
    for (const unit of units) losTotal += unit.losTotal;
  }
  return {
    anchor: curriculum.qualificationAnchor,
    displayName: curriculum.name,
    qualificationBody: curriculum.qualificationBody,
    qualificationNumber: curriculum.qualificationNumber,
    qualificationLevel: curriculum.qualificationLevel,
    tier: qualReadiness?.tier ?? null,
    unitsCovered: qualReadiness?.unitsCovered ?? 0,
    unitsTotal: qualReadiness?.unitsTotal ?? units.length,
    weakestUnitSlug: qualReadiness?.weakestUnitSlug ?? null,
    losAtTierOrAbove,
    losTotal,
  };
}

function composeNextBestStep(
  qualReadiness: QualificationReadinessPayload | null,
  unitReadiness: ReadonlyMap<string, UnitReadinessPayload>,
  playbookConfig: unknown,
): { courseType: string; moduleSlug: string; loRef: string | null; reason: string } | null {
  const weakestUnitSlug = qualReadiness?.weakestUnitSlug ?? null;
  if (!weakestUnitSlug) return null;

  const unitPayload = unitReadiness.get(weakestUnitSlug) ?? null;
  const courseType = getCourseTypeDisplayName(playbookConfig);
  return {
    courseType,
    moduleSlug: weakestUnitSlug,
    loRef: unitPayload?.weakestLoRef ?? null,
    reason: unitPayload
      ? "weakest LO in your weakest Unit"
      : "you haven't started this Unit yet",
  };
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function isUnitReadinessPayload(value: unknown): value is UnitReadinessPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.tier === "string" &&
    typeof v.losCovered === "number" &&
    typeof v.losTotal === "number" &&
    (v.weakestLoRef === null || typeof v.weakestLoRef === "string")
  );
}

function isQualificationReadinessPayload(value: unknown): value is QualificationReadinessPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.tier === "string" &&
    typeof v.unitsCovered === "number" &&
    typeof v.unitsTotal === "number" &&
    (v.weakestUnitSlug === null || typeof v.weakestUnitSlug === "string")
  );
}
