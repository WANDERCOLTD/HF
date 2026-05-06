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
  return NextResponse.json({
    ok: true,
    modulesAuthored: cfg.modulesAuthored ?? null,
    modules: cfg.modules ?? [],
    moduleDefaults: cfg.moduleDefaults ?? {},
    moduleSource: cfg.moduleSource ?? null,
    moduleSourceRef: cfg.moduleSourceRef ?? null,
    validationWarnings: warnings,
    hasErrors: warnings.some((w) => w.severity === "error"),
    // Surfaced so the learner-preview component can pick the right layout
    // (tiles for continuous, rail for structured) without a second fetch.
    lessonPlanMode: cfg.lessonPlanMode ?? null,
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
  let syncResult: Awaited<ReturnType<typeof syncAuthoredModulesToCurriculum>> | null = null;
  if (changed) {
    await prisma.$transaction(async (tx) => {
      await tx.playbook.update({
        where: { id: courseId },
        data: { config: nextConfig as object },
      });
      if (detected.modulesAuthored === true && detected.modules.length > 0) {
        syncResult = await syncAuthoredModulesToCurriculum(
          tx,
          courseId,
          detected.modules,
        );
      }
    });
  }

  return NextResponse.json({
    ok: true,
    modulesAuthored: detected.modulesAuthored,
    modules: detected.modules,
    moduleDefaults: detected.moduleDefaults,
    validationWarnings: detected.validationWarnings,
    detectedFrom: detected.detectedFrom,
    hasErrors: hasBlockingErrors(detected),
    persisted: changed,
    curriculumSync: syncResult,
  });
}
