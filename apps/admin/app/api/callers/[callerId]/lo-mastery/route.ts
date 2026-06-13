/**
 * @api GET /api/callers/[callerId]/lo-mastery
 *
 * Per-LO mastery drill for one module. Lazy-fetched by the Attainment
 * tab's Module Mastery section when a learner clicks a module row, so we
 * never N+1 across the module grid.
 *
 * Returns every `learnerVisible: true` LearningObjective for the module
 * (in `sortOrder` order) with the learner's current mastery score —
 * including LOs with no mastery row yet, surfaced as
 * `status: "not_started"`. Educators asked for "INCOMPLETE / YET TO DO"
 * visibility so they can see what the learner has not touched, not just
 * what scored low.
 *
 * Read-source branches on `useFreshMastery`:
 *
 *   - `false` (default) — `CallerAttribute` rows keyed
 *     `…:lo_mastery:{moduleSlug}:{loRef}` (the long-term monotonic
 *     ratchet written by AGGREGATE).
 *   - `true` (Exam Assessment / mock-exam mode) — `Call.scratchMastery`
 *     on the most recent call for this caller+playbook (per-call
 *     scratch, not the long-term store). When no scoring call exists yet,
 *     all LOs surface as `not_started` and the UI flags the mock-exam
 *     reset semantic.
 *
 * Sprint 4 SP4-C. Sister of:
 *   - `/api/callers/[callerId]/attainment` (parent — module-grain rollup)
 *   - `/api/callers/[callerId]/skills-evidence` (skill-grain evidence)
 *
 * Auth: VIEWER + path-param scope (`studentAllowedToReadCaller`).
 * STUDENT may read OWN data only; OPERATOR+ may read any caller.
 * Locked per master epic #1577 (Attainment is STUDENT-readable).
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import {
  studentAllowedToReadCaller,
  callerScopeMismatchResponse,
} from "@/lib/learner-scope";
import { isUseFreshMastery } from "@/lib/curriculum/playbook-mastery-config";
import { getAllScratchMastery } from "@/lib/curriculum/scratch-mastery";
import { getSkillTierMapping, scoreToTier } from "@/lib/goals/track-progress";

export type LoMasteryStatus =
  | "mastered"
  | "in_progress"
  | "not_started";

export interface LoMasteryEntry {
  /** Stable LO ref (e.g. "LO1", "R04-LO2-AC2.3"). Same shape used in the
   *  `lo_mastery:*` storage key. */
  ref: string;
  /** Educator-facing description (or `performanceStatement` when set —
   *  learner-friendly rewrite). */
  description: string;
  /** 0–1 ratchet (or scratch value for useFreshMastery playbooks).
   *  `null` when no mastery row exists yet (`status: "not_started"`). */
  mastery: number | null;
  /** Resolved tier band — same `scoreToTier` mapping as Skill Bands so the
   *  cold→hot palette is consistent across Attainment sections. `null`
   *  when no mastery row exists. */
  tier: string | null;
  bandLabel: number | null;
  /** Per-LO mastery criterion. Null → inherit module-level threshold. */
  masteryThreshold: number | null;
  status: LoMasteryStatus;
  /** When the mastery row was last updated. ISO string; null for
   *  not_started entries. */
  updatedAt: string | null;
}

export interface LoMasteryResponse {
  callerId: string;
  playbookId: string | null;
  moduleId: string;
  moduleSlug: string;
  moduleTitle: string;
  useFreshMastery: boolean;
  /** When `useFreshMastery: true`, the call we drew the scratch read
   *  from. `null` when no scoring call has happened yet. */
  scratchSourceCallId: string | null;
  learningObjectives: LoMasteryEntry[];
}

const LO_MASTERY_KEY_RE = /:lo_mastery:([^:]+):(.+)$/;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ callerId: string }> },
) {
  const { callerId } = await params;
  const { searchParams } = new URL(request.url);
  const moduleId = searchParams.get("moduleId");

  if (!moduleId) {
    return NextResponse.json(
      { error: "moduleId query param required" },
      { status: 400 },
    );
  }

  const auth = await requireAuth("VIEWER");
  if (isAuthError(auth)) return auth.error;

  if (!studentAllowedToReadCaller(auth.session, callerId)) {
    return callerScopeMismatchResponse();
  }

  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { id: true },
  });
  if (!caller) {
    return NextResponse.json({ error: "Caller not found" }, { status: 404 });
  }

  const enrolment = await prisma.callerPlaybook.findFirst({
    where: { callerId },
    select: { playbookId: true },
    orderBy: { createdAt: "desc" },
  });
  if (!enrolment) {
    return NextResponse.json(
      { error: "Caller has no playbook enrolment" },
      { status: 404 },
    );
  }
  const playbookId = enrolment.playbookId;

  // Resolve curriculumId via PlaybookCurriculum(primary) — canonical join
  // post-#1177. Mirrors `lib/curriculum/resolve-playbook-for-curriculum.ts`.
  const playbookCurriculum = await prisma.playbookCurriculum.findFirst({
    where: { playbookId, role: "primary" },
    select: { curriculumId: true },
  });
  if (!playbookCurriculum) {
    return NextResponse.json(
      { error: "Playbook has no primary curriculum" },
      { status: 404 },
    );
  }
  const curriculumId = playbookCurriculum.curriculumId;

  // Verify the requested module belongs to this curriculum — refuses to
  // succeed with a module from another curriculum (slug-scope #407
  // discipline applied to the UUID path too).
  const moduleRow = await prisma.curriculumModule.findFirst({
    where: { id: moduleId, curriculumId },
    select: { id: true, slug: true, title: true, masteryThreshold: true },
  });
  if (!moduleRow) {
    return NextResponse.json(
      { error: "Module not found in this caller's curriculum" },
      { status: 404 },
    );
  }
  const moduleSlug = moduleRow.slug;

  // Pull every learner-visible LO for the module. `learnerVisible: false`
  // entries (audience-split #317 — assessor-only / item-gen-only) are
  // hidden from the Attainment lens.
  const loRows = await prisma.learningObjective.findMany({
    where: { moduleId, learnerVisible: true },
    select: {
      ref: true,
      description: true,
      performanceStatement: true,
      sortOrder: true,
      masteryThreshold: true,
    },
    orderBy: [{ sortOrder: "asc" }, { ref: "asc" }],
  });

  const useFreshMastery = await isUseFreshMastery(playbookId);
  const tierMapping = await getSkillTierMapping(playbookId);

  // Build a `{ loRef → { mastery, updatedAt } }` map from whichever store
  // is active for this playbook.
  const masteryByRef = new Map<
    string,
    { mastery: number; updatedAt: string | null }
  >();
  let scratchSourceCallId: string | null = null;

  if (useFreshMastery) {
    // Pull mastery from the most recent scoring call for this caller in
    // this playbook. `Call.scratchMastery` is keyed
    // `lo_mastery:{moduleSlug}:{loRef}` (same shape as CallerAttribute).
    const latestCall = await prisma.call.findFirst({
      where: {
        callerId,
        playbookId,
        scratchMastery: { not: { equals: null as never } },
      },
      select: { id: true, endedAt: true },
      orderBy: { endedAt: "desc" },
    });
    if (latestCall) {
      scratchSourceCallId = latestCall.id;
      const map = await getAllScratchMastery(latestCall.id);
      for (const [key, value] of Object.entries(map)) {
        const m = key.match(/^lo_mastery:([^:]+):(.+)$/);
        if (!m) continue;
        if (m[1] !== moduleSlug) continue;
        const score =
          typeof value === "number"
            ? value
            : typeof value === "string"
              ? Number.parseFloat(value)
              : null;
        if (score == null || Number.isNaN(score)) continue;
        masteryByRef.set(m[2], {
          mastery: score,
          updatedAt: latestCall.endedAt?.toISOString() ?? null,
        });
      }
    }
  } else {
    // Long-term ratchet path — CallerAttribute rows tolerant-matched on
    // `:lo_mastery:{moduleSlug}:{loRef}` (mirrors the
    // `learning-trajectory` route's reader pattern). Filter on the slug
    // suffix server-side so we don't fan the result set with foreign
    // modules.
    const masteryAttrs = await prisma.callerAttribute.findMany({
      where: {
        callerId,
        key: { contains: `:lo_mastery:${moduleSlug}:` },
        validUntil: null,
      },
      select: { key: true, numberValue: true, updatedAt: true },
    });
    for (const a of masteryAttrs) {
      const match = a.key.match(LO_MASTERY_KEY_RE);
      if (!match) continue;
      if (match[1] !== moduleSlug) continue;
      masteryByRef.set(match[2], {
        mastery: a.numberValue ?? 0,
        updatedAt: a.updatedAt.toISOString(),
      });
    }
  }

  const learningObjectives: LoMasteryEntry[] = loRows.map((lo) => {
    const entry = masteryByRef.get(lo.ref);
    const score = entry?.mastery ?? null;
    const effectiveThreshold = lo.masteryThreshold ?? moduleRow.masteryThreshold;

    let tier: string | null = null;
    let bandLabel: number | null = null;
    let status: LoMasteryStatus = "not_started";
    if (score != null) {
      const banded = scoreToTier(score, tierMapping);
      tier = banded.tier.toLowerCase();
      bandLabel = banded.band ?? null;
      if (effectiveThreshold != null && score >= effectiveThreshold) {
        status = "mastered";
      } else {
        status = "in_progress";
      }
    }

    return {
      ref: lo.ref,
      description: lo.performanceStatement ?? lo.description,
      mastery: score,
      tier,
      bandLabel,
      masteryThreshold: lo.masteryThreshold,
      status,
      updatedAt: entry?.updatedAt ?? null,
    };
  });

  return NextResponse.json({
    callerId,
    playbookId,
    moduleId: moduleRow.id,
    moduleSlug,
    moduleTitle: moduleRow.title,
    useFreshMastery,
    scratchSourceCallId,
    learningObjectives,
  } satisfies LoMasteryResponse);
}
