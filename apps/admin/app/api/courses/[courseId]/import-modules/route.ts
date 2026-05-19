/**
 * POST /api/courses/[courseId]/import-modules
 *
 * Parses a Course Reference markdown body for an author-declared Module
 * Catalogue (Issue #236, PR2/4) and persists the result to PlaybookConfig.
 *
 * The route is a thin wrapper around the deterministic detectAuthoredModules
 * parser (PR1) and the applyAuthoredModules merge helper. It:
 *   1. Authenticates the request (OPERATOR+).
 *   2. Validates the body shape with zod.
 *   3. Loads the Playbook (Course = Playbook in this codebase).
 *   4. Runs the parser, then merges the result into the existing config.
 *   5. Persists when the parser produced a definitive signal; warnings are
 *      preserved alongside the modules so the publish gate (PR4) can read
 *      them. Errors are also persisted but reported in the response so the
 *      caller can decide whether to surface them as blockers.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError, ROLE_LEVEL } from "@/lib/permissions";
import type { AuthoredModule, PlaybookConfig } from "@/lib/types/json-fields";
import { detectAuthoredModules } from "@/lib/wizard/detect-authored-modules";
import {
  applyAuthoredModules,
  hasBlockingErrors,
} from "@/lib/wizard/persist-authored-modules";
import { syncAuthoredModulesToCurriculum } from "@/lib/wizard/sync-authored-modules-to-curriculum";
import { reclassifyLearningObjectives } from "@/lib/curriculum/reclassify-los";
import { resolveCurriculumIdForPlaybook } from "@/lib/curriculum/resolve-module";
import { recommendNextModule } from "@/lib/curriculum/recommend-next-module";

// #495 Slice 4.2 — picker status badge. Per-module progress is returned to
// the learner picker so each tile/rail card can render Mastered / In progress
// / Not started. The presentational vocabulary mirrors SimProgressPanel
// (E5 #493 Slice 5.2): DB `COMPLETED` → presentational `MASTERED`. Anyone
// without a caller scope (admin viewing the route directly with no
// `?callerId=`) gets no `progress` field at all so the UI suppresses the
// badge — completion is per-learner, not per-course.
type PickerProgressStatus = "MASTERED" | "IN_PROGRESS" | "NOT_STARTED";
interface PickerProgress {
  status: PickerProgressStatus;
  callCount: number;
}

// ── Body schema ──────────────────────────────────────────────────────

const BodySchema = z.object({
  markdown: z.string().min(1, "markdown is required"),
  sourceRef: z
    .object({
      docId: z.string().min(1),
      version: z.string().min(1),
    })
    .optional(),
});

type Body = z.infer<typeof BodySchema>;

/**
 * @api GET /api/courses/[courseId]/import-modules
 * @visibility internal
 * @scope course:read
 * @auth session (VIEWER+)
 * @description Read the current modules catalogue for a course. Prefers
 *   author-declared modules from `Playbook.config.modules` when present
 *   (authored path), otherwise falls back to `Curriculum.modules[]` rows
 *   keyed via the playbook's primary curriculum (AI-generated path — #495
 *   Slice 4.1). The fallback maps `CurriculumModule` rows into the same
 *   `AuthoredModule` shape so the learner-facing picker is route-agnostic.
 *   The new top-level `source` field is `"authored" | "generated" | null`
 *   (null when no modules exist on either side); the legacy `moduleSource`
 *   field (`"authored" | "derived" | null`) is preserved for backwards
 *   compatibility with the admin AuthoredModulesPanel.
 * @response 200 { ok, modulesAuthored, modules, moduleDefaults, moduleSource, source, moduleSourceRef, validationWarnings, hasErrors, outcomes, detectedFrom, persisted, curriculumSync, classification, recommendedModuleId, recommendedReason }
 * @note #495 Slice 4.2 — each `modules[]` entry includes an optional
 *   `progress: { status: "MASTERED"|"IN_PROGRESS"|"NOT_STARTED", callCount }`
 *   field when the request carries a caller scope (STUDENT, or OPERATOR+
 *   with `?callerId=…`). Admins without a caller scope receive modules
 *   without `progress` — the picker suppresses the badge in that case.
 * @note #495 Slice 4.3 — top-level `recommendedModuleId` + `recommendedReason`
 *   identify the single module `recommendNextModule()` suggests the learner
 *   attempt next (or null when no caller scope / every module mastered).
 *   The picker UI surfaces a "Recommended next" badge on that tile only —
 *   no per-module mutation, so any other consumer of the response keeps a
 *   stable `progress` shape.
 * @response 404 { ok: false, error: "Course not found" }
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
): Promise<NextResponse> {
  const auth = await requireAuth("VIEWER");
  if (isAuthError(auth)) return auth.error;

  const { courseId } = await params;
  const playbook = await prisma.playbook.findUnique({
    where: { id: courseId },
    select: { id: true, config: true },
  });
  if (!playbook) {
    return NextResponse.json(
      { ok: false, error: "Course not found" },
      { status: 404 },
    );
  }

  const cfg = (playbook.config ?? {}) as PlaybookConfig;
  const warnings = cfg.validationWarnings ?? [];

  // #495 Slice 4.1 — fallback to Curriculum.modules[] when Playbook.config
  // has no authored modules so the learner picker works for AI-generated
  // courses too. The authored path remains canonical: only fall through
  // when `cfg.modules` is empty/missing AND a curriculum exists.
  const authoredModules = (cfg.modules ?? []) as AuthoredModule[];
  let modulesForResponse: AuthoredModule[] = authoredModules;
  let pickerSource: "authored" | "generated" | null =
    authoredModules.length > 0 ? "authored" : null;

  if (authoredModules.length === 0) {
    const generated = await loadGeneratedModulesAsAuthored(courseId);
    if (generated.length > 0) {
      modulesForResponse = generated;
      pickerSource = "generated";
    }
  }

  // #495 Slice 4.2 — resolve which caller's progress (if any) to enrich
  // the response with. STUDENT users get their own caller; OPERATOR+ may
  // pass `?callerId=` to inspect on a learner's behalf (same convention
  // as /api/student/module-progress). Admins without `?callerId=` get a
  // module list with NO `progress` field — the picker hides the badge.
  const callerId = await resolveCallerIdForRequest(
    auth.session.user.role,
    auth.session.user.id,
    req.nextUrl.searchParams.get("callerId"),
  );
  const progressByModuleId =
    callerId && modulesForResponse.length > 0
      ? await loadProgressForCaller(callerId, courseId)
      : null;
  const modulesWithProgress = progressByModuleId
    ? modulesForResponse.map((m) => ({
        ...m,
        progress: progressByModuleId[m.id] ?? {
          // Synthetic NOT_STARTED so the picker still shows a "Not started"
          // badge for modules the caller has never opened — beats hiding
          // the badge for the common cold-start case.
          status: "NOT_STARTED" as PickerProgressStatus,
          callCount: 0,
        },
      }))
    : modulesForResponse;

  // #495 Slice 4.3 — compute the single "Recommended next" module for the
  // resolved caller. Top-level fields so the picker can find the tile
  // without mutating per-module rows (keeps the `progress` shape stable
  // for any other consumer). Skipped entirely when there is no caller
  // scope — admins viewing the route directly get nulls, matching the
  // progress-enrichment policy.
  let recommendedModuleId: string | null = null;
  let recommendedReason: string | null = null;
  if (callerId && modulesForResponse.length > 0) {
    const curriculumIdForReco = await resolveCurriculumIdForPlaybook(courseId);
    if (curriculumIdForReco) {
      const reco = await recommendNextModule({
        callerId,
        curriculumId: curriculumIdForReco,
        playbookConfig: cfg,
      });
      if (reco) {
        // `recommendNextModule` returns the CurriculumModule slug (which
        // by convention matches AuthoredModule.id for both authored and
        // generated paths). Map back to the picker's id so the client
        // matches against `module.id`.
        const matched = modulesForResponse.find(
          (m) => m.id === reco.slug || m.id === reco.moduleId,
        );
        if (matched) {
          recommendedModuleId = matched.id;
          recommendedReason = reco.reason;
        }
      }
    }
  }

  // #281 Slice 3b: per-module ContentQuestion count so the AuthoredModules
  // panel can show a "no learner-facing content" banner for modules whose
  // outcomes have zero MCQs. Single groupBy across all module outcomes —
  // not a per-module loop. Keys outcomeRef → count, then we spread into
  // moduleId → count by summing each module's outcomesPrimary memberships.
  // Drives off `modulesForResponse` so the count works for both authored
  // and generated paths (the latter has empty outcomesPrimary today, so
  // the count is naturally zero — but the wiring is in place if generated
  // modules later get outcome refs).
  const modulesArr = modulesForResponse as Array<{ id: string; outcomesPrimary?: string[] }>;
  const allOutcomeRefs = Array.from(
    new Set(modulesArr.flatMap((m) => Array.isArray(m.outcomesPrimary) ? m.outcomesPrimary : [])),
  );
  let mcqCountsByModule: Record<string, number> = {};
  if (allOutcomeRefs.length > 0) {
    const grouped = await prisma.contentQuestion.groupBy({
      by: ["learningOutcomeRef"],
      where: { learningOutcomeRef: { in: allOutcomeRefs } },
      _count: { _all: true },
    });
    const countByRef: Record<string, number> = {};
    for (const g of grouped) {
      if (g.learningOutcomeRef) countByRef[g.learningOutcomeRef] = g._count._all;
    }
    mcqCountsByModule = Object.fromEntries(
      modulesArr.map((m) => [
        m.id,
        (m.outcomesPrimary ?? []).reduce((sum, ref) => sum + (countByRef[ref] ?? 0), 0),
      ]),
    );
  }

  // #317 — surface the audience-split fields per outcome ref so the
  // AuthoredModulesPanel can render a [hidden: ASSESSOR_RUBRIC] / etc.
  // badge alongside each LO. Same Set of refs we already collected for
  // mcqCountsByModule, so this is one extra DB hit, not N.
  let loAudienceByRef: Record<string, {
    learnerVisible: boolean;
    systemRole: string;
    performanceStatement: string | null;
    humanOverridden: boolean;
  }> = {};
  if (allOutcomeRefs.length > 0) {
    const curriculumRow = await prisma.curriculum.findFirst({
      where: { playbookId: courseId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (curriculumRow) {
      const los = await prisma.learningObjective.findMany({
        where: {
          module: { curriculumId: curriculumRow.id },
          ref: { in: allOutcomeRefs },
        },
        select: {
          ref: true,
          learnerVisible: true,
          systemRole: true,
          performanceStatement: true,
          humanOverriddenAt: true,
        },
      });
      for (const lo of los) {
        loAudienceByRef[lo.ref] = {
          learnerVisible: lo.learnerVisible,
          systemRole: lo.systemRole,
          performanceStatement: lo.performanceStatement,
          humanOverridden: lo.humanOverriddenAt !== null,
        };
      }
    }
  }

  return NextResponse.json({
    ok: true,
    modulesAuthored: cfg.modulesAuthored ?? null,
    // #495 Slice 4.1 — `modules` is the picker-ready list (authored when
    // present, generated fallback otherwise). `source` tells the UI which
    // path produced them; the legacy `moduleSource` (authored | derived)
    // is preserved unchanged for the admin AuthoredModulesPanel.
    // #495 Slice 4.2 — when a caller scope is resolvable, each module
    // gains a `progress: { status, callCount }` field so the picker can
    // render a Mastered / In progress / Not started badge.
    modules: modulesWithProgress,
    source: pickerSource,
    moduleDefaults: cfg.moduleDefaults ?? {},
    moduleSource: cfg.moduleSource ?? null,
    moduleSourceRef: cfg.moduleSourceRef ?? null,
    // #258: outcome statements parsed from `**OUT-NN: <statement>.**` headings.
    outcomes: cfg.outcomes ?? {},
    validationWarnings: warnings,
    hasErrors: warnings.some((w) => w.severity === "error"),
    // Surfaced so the learner-preview component can pick the right layout
    // (tiles for continuous, rail for structured) without a second fetch.
    lessonPlanMode: cfg.lessonPlanMode ?? null,
    // #281 Slice 3b: per-module MCQ counts so the panel can render the
    // "no learner-facing content" banner where mcqCountsByModule[id] === 0.
    mcqCountsByModule,
    // #317 — audience-split per outcome ref ({ learnerVisible, systemRole,
    // performanceStatement, humanOverridden }). Empty when no curriculum
    // exists yet (cold-start before classifier first runs).
    loAudienceByRef,
    // #495 Slice 4.3 — top-level "Recommended next" hint. null when no
    // caller scope is resolvable or `recommendNextModule()` had nothing to
    // suggest (every module mastered, or strict-prereq deadlock with no
    // IN_PROGRESS fallback). The picker highlights the matching tile.
    recommendedModuleId,
    recommendedReason,
  });
}

/**
 * #495 Slice 4.1 — load the playbook's primary `Curriculum.modules[]` and
 * project them into the `AuthoredModule` shape so the learner picker can
 * render AI-generated courses without a second code path. Returns `[]` when
 * the playbook has no curriculum attached or the curriculum has no modules.
 *
 * Defaults applied here keep generated modules safely renderable:
 *   - `learnerSelectable: true` — every generated module is offered to the learner
 *   - `mode: "tutor"`, `frequency: "repeatable"` — neutral defaults
 *   - `voiceBandReadout: false`, `sessionTerminal: false` — opt-in behaviours only
 *   - `outcomesPrimary: []`, `prerequisites: []` — generated modules don't yet
 *     declare authored outcome refs; the picker treats them as ungated
 *
 * The slug is used as the picker's stable `id` so progress rows (which key
 * by CurriculumModule.slug) line up with the picker's completed/in-progress
 * sets — same convention as the authored path.
 */
async function loadGeneratedModulesAsAuthored(
  playbookId: string,
): Promise<AuthoredModule[]> {
  const curriculumId = await resolveCurriculumIdForPlaybook(playbookId);
  if (!curriculumId) return [];

  const rows = await prisma.curriculumModule.findMany({
    where: { curriculumId, isActive: true },
    orderBy: { sortOrder: "asc" },
    select: {
      slug: true,
      title: true,
      description: true,
      sortOrder: true,
      estimatedDurationMinutes: true,
      prerequisites: true,
    },
  });

  return rows.map((row): AuthoredModule => ({
    id: row.slug,
    label: row.title,
    learnerSelectable: true,
    mode: "tutor",
    duration:
      typeof row.estimatedDurationMinutes === "number" &&
      row.estimatedDurationMinutes > 0
        ? `${row.estimatedDurationMinutes} min`
        : "Student-led",
    scoringFired: "",
    voiceBandReadout: false,
    sessionTerminal: false,
    frequency: "repeatable",
    outcomesPrimary: [],
    prerequisites: Array.isArray(row.prerequisites) ? row.prerequisites : [],
    position: row.sortOrder,
  }));
}

/**
 * #495 Slice 4.2 / 4.3 — resolve the caller whose progress + recommendation
 * the GET response should be scoped to. Returns `null` when no caller scope
 * is resolvable:
 *   - STUDENT but no LEARNER Caller linked → null (treat as no-scope; the
 *     picker simply hides the badge rather than showing every module as
 *     "Not started", which would be misleading mid-onboarding).
 *   - OPERATOR+ without `?callerId=` → null (admin-only direct view).
 *   - Lower roles (TESTER/VIEWER) without `?callerId=` → null.
 */
async function resolveCallerIdForRequest(
  role: string,
  userId: string,
  callerIdParam: string | null,
): Promise<string | null> {
  const roleLevel =
    (ROLE_LEVEL as Record<string, number | undefined>)[role] ?? 0;

  if (role === "STUDENT") {
    const caller = await prisma.caller.findFirst({
      where: { userId, role: "LEARNER" },
      select: { id: true },
    });
    return caller?.id ?? null;
  }
  if (roleLevel >= ROLE_LEVEL.OPERATOR && callerIdParam) {
    // Verify the requested caller is a LEARNER — same shape check
    // `requireStudentOrAdmin` uses. We don't 404 here; we just decline
    // to enrich, mirroring "no scope" semantics.
    const caller = await prisma.caller.findFirst({
      where: { id: callerIdParam, role: "LEARNER" },
      select: { id: true },
    });
    return caller?.id ?? null;
  }
  return null;
}

/**
 * #495 Slice 4.2 — load progress rows for `callerId` scoped to the given
 * playbook's curricula and project them into a `slug → PickerProgress`
 * map. The slug is used as the picker-key because AuthoredModule.id
 * equals CurriculumModule.slug by convention (mirrors the picker page's
 * progress-grouping logic).
 *
 * Returns `{}` (empty object) when the caller has no progress rows yet —
 * the GET handler then synthesises NOT_STARTED for each module so the
 * picker can show "Not started" everywhere.
 */
async function loadProgressForCaller(
  callerId: string,
  courseId: string,
): Promise<Record<string, PickerProgress>> {
  // Scope progress rows to this Playbook's curricula so the same slug
  // across two courses doesn't bleed in. Mirrors module-progress route.
  const rows = await prisma.callerModuleProgress.findMany({
    where: {
      callerId,
      module: { curriculum: { playbookId: courseId } },
    },
    select: {
      status: true,
      callCount: true,
      module: { select: { slug: true } },
    },
  });

  const bySlug: Record<string, PickerProgress> = {};
  for (const row of rows) {
    const slug = row.module?.slug;
    if (!slug) continue;
    bySlug[slug] = {
      // DB "COMPLETED" → presentational "MASTERED" (mirrors E5 #493).
      status: row.status === "COMPLETED"
        ? "MASTERED"
        : row.status === "IN_PROGRESS"
          ? "IN_PROGRESS"
          : "NOT_STARTED",
      callCount: row.callCount ?? 0,
    };
  }
  return bySlug;
}

/**
 * @api POST /api/courses/[courseId]/import-modules
 * @visibility internal
 * @scope course:write
 * @auth session (OPERATOR+)
 * @description Parse a Course Reference markdown body for an author-declared
 *   Module Catalogue and persist the result to PlaybookConfig. Idempotent —
 *   re-importing the same markdown yields the same result. Per-field-defaults-
 *   with-warnings policy: warnings are persisted; errors are reported in the
 *   response (`hasErrors: true`) but do not block persistence — the production
 *   publish gate is a separate concern.
 * @request { markdown: string, sourceRef?: { docId: string, version: string } }
 * @response 200 { ok, modulesAuthored, modules, validationWarnings, detectedFrom, hasErrors, persisted }
 * @response 400 { ok: false, error: "Invalid body", issues: ZodIssue[] }
 * @response 404 { ok: false, error: "Course not found" }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
): Promise<NextResponse> {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  let body: Body;
  try {
    const raw = await req.json();
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid body", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { courseId } = await params;

  const playbook = await prisma.playbook.findUnique({
    where: { id: courseId },
    select: { id: true, config: true },
  });
  if (!playbook) {
    return NextResponse.json(
      { ok: false, error: "Course not found" },
      { status: 404 },
    );
  }

  const detected = detectAuthoredModules(body.markdown);
  const existingConfig = (playbook.config ?? {}) as PlaybookConfig;
  const { config: nextConfig, changed } = applyAuthoredModules(
    existingConfig,
    detected,
    { sourceRef: body.sourceRef },
  );

  // #245: when modules were persisted, also upsert CurriculumModule rows so
  // the pipeline's slug-based `updateModuleMastery` can write progress for
  // authored modules. Wrapped in a transaction so the playbook and module
  // tables stay in sync if either write fails.
  type SyncResultT = Awaited<ReturnType<typeof syncAuthoredModulesToCurriculum>>;
  let syncResult: SyncResultT | null = null;
  if (changed) {
    syncResult = await prisma.$transaction(async (tx): Promise<SyncResultT | null> => {
      await tx.playbook.update({
        where: { id: courseId },
        data: { config: nextConfig as object },
      });
      if (detected.modulesAuthored === true && detected.modules.length > 0) {
        return await syncAuthoredModulesToCurriculum(
          tx,
          courseId,
          detected.modules,
          // Pass the outcome statements map so authored OUT-NN refs become
          // first-class LearningObjective rows. Without this, the extractor's
          // fetchCurriculumLoRefs returns whatever legacy refs exist (LO8..LO17)
          // and MCQs end up untagged because no whitelist match is possible.
          detected.outcomes,
        );
      }
      return null;
    });
  }

  // #317 — after the curriculum modules + LOs have been committed, run the
  // audience-split classifier so freshly-imported LOs get learnerVisible /
  // performanceStatement / systemRole set before the user sees the
  // curriculum tab. Best-effort: classification failures don't fail the
  // import (the curriculum is still valid; classification can be re-run
  // from the curriculum tab's "Reclassify LOs" button).
  let classification: Awaited<ReturnType<typeof reclassifyLearningObjectives>> | null = null;
  if (syncResult?.curriculumId) {
    try {
      classification = await reclassifyLearningObjectives(syncResult.curriculumId);
      console.log(
        `[import-modules] curriculum ${syncResult.curriculumId} classification: ` +
          `applied=${classification.applied} queued=${classification.queued} skipped=${classification.skipped} failed=${classification.failed}`,
      );
    } catch (err: any) {
      console.error(`[import-modules] reclassifyLearningObjectives failed for ${syncResult.curriculumId}:`, err?.message);
    }
  }

  return NextResponse.json({
    ok: true,
    modulesAuthored: detected.modulesAuthored,
    modules: detected.modules,
    moduleDefaults: detected.moduleDefaults,
    outcomes: detected.outcomes,
    validationWarnings: detected.validationWarnings,
    detectedFrom: detected.detectedFrom,
    hasErrors: hasBlockingErrors(detected),
    persisted: changed,
    curriculumSync: syncResult,
    classification, // #317 — { applied, queued, skipped, failed, byOutcome } or null
  });
}
