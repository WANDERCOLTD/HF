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
import { requireAuth, isAuthError } from "@/lib/permissions";
import type { PlaybookConfig } from "@/lib/types/json-fields";
import { detectAuthoredModules } from "@/lib/wizard/detect-authored-modules";
import {
  applyAuthoredModules,
  hasBlockingErrors,
} from "@/lib/wizard/persist-authored-modules";
import { syncAuthoredModulesToCurriculum } from "@/lib/wizard/sync-authored-modules-to-curriculum";
import { reclassifyLearningObjectives } from "@/lib/curriculum/reclassify-los";

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
 * @description Read the current authored-modules state from PlaybookConfig.
 *   Used by the Authored Modules panel in the Curriculum tab to render the
 *   catalogue without re-parsing the source document. Returns nulls/empties
 *   when no authored modules exist yet (derived path is in use).
 * @response 200 { ok, modulesAuthored, modules, moduleDefaults, moduleSource, moduleSourceRef, validationWarnings, hasErrors, lessonPlanMode }
 * @response 404 { ok: false, error: "Course not found" }
 */
export async function GET(
  _req: NextRequest,
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

  // #281 Slice 3b: per-module ContentQuestion count so the AuthoredModules
  // panel can show a "no learner-facing content" banner for modules whose
  // outcomes have zero MCQs. Single groupBy across all module outcomes —
  // not a per-module loop. Keys outcomeRef → count, then we spread into
  // moduleId → count by summing each module's outcomesPrimary memberships.
  const modulesArr = (cfg.modules ?? []) as Array<{ id: string; outcomesPrimary?: string[] }>;
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
    modules: cfg.modules ?? [],
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
  });
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
