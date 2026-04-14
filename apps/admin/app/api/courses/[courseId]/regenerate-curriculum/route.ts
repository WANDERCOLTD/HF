import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { extractCurriculumFromAssertions } from "@/lib/content-trust/extract-curriculum";
import { syncModulesToDB } from "@/lib/curriculum/sync-modules";
import { INSTRUCTION_CATEGORIES } from "@/lib/content-trust/resolve-config";
import type { LegacyCurriculumModuleJSON } from "@/lib/types/json-fields";

type Params = { params: Promise<{ courseId: string }> };

/**
 * @api POST /api/courses/:courseId/regenerate-curriculum
 * @visibility internal
 * @scope courses:write
 * @auth OPERATOR
 * @tags courses, curriculum, content-trust
 * @description Regenerates the curriculum structure (modules + learning objectives)
 *   for an existing course using the content already extracted from its source
 *   documents. This is the only way to fix garbage LO descriptions on a course
 *   that was extracted before epic #131 shipped (PW: Secret Garden, incident #137).
 *
 *   Flow:
 *     1. Load all non-instruction ContentAssertions for the course's sources
 *     2. Call extractCurriculumFromAssertions (uses A3-hardened prompt)
 *     3. syncModulesToDB upserts modules + LOs via the A1 parseLoLine guard
 *     4. reconcileAssertionLOs auto-fires from syncModulesToDB and rebinds FKs
 *
 *   The lesson plan is NOT regenerated here. Session `learningOutcomeRefs` arrays
 *   may go stale if module structure changes substantially — the response includes
 *   a `staleWarning` flag so the Curriculum tab can surface a banner pointing at
 *   the Journey tab.
 *
 *   Architectural note: this is a NEW code path, not a wrapper around
 *   POST /api/courses/generate-plan. generate-plan creates a new Subject +
 *   Curriculum (wizard flow) and would produce orphan rows on each regen.
 *
 * @pathParam courseId string - Playbook UUID
 * @response 200 { ok, curriculumId, moduleCount, warnings, staleWarning }
 * @response 404 { ok: false, error }
 * @response 500 { ok: false, error }
 */
export async function POST(
  _req: NextRequest,
  { params }: Params,
): Promise<NextResponse> {
  try {
    const auth = await requireAuth("OPERATOR");
    if (isAuthError(auth)) return auth.error;

    const { courseId } = await params;

    // 1. Resolve course → subject → sources → existing curriculum
    const playbook = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: { id: true, name: true, domainId: true },
    });
    if (!playbook) {
      return NextResponse.json(
        { ok: false, error: "Course not found" },
        { status: 404 },
      );
    }

    const playbookSubjects = await prisma.playbookSubject.findMany({
      where: { playbookId: courseId },
      select: {
        subjectId: true,
        subject: {
          select: {
            id: true,
            name: true,
            qualificationRef: true,
            sources: { select: { sourceId: true } },
          },
        },
      },
    });

    if (playbookSubjects.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Course has no linked subject — upload content first" },
        { status: 404 },
      );
    }

    // For the MVP of the Curriculum tab we regenerate the primary subject's
    // curriculum only. Multi-subject courses will need a UI selector later.
    const primarySubject = playbookSubjects[0].subject;
    const sourceIds = [...new Set(primarySubject.sources.map((s) => s.sourceId))];

    if (sourceIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Subject has no content sources — upload content first" },
        { status: 404 },
      );
    }

    // 2. Load content assertions (exclude instruction categories — those describe
    // how to teach, not what to teach)
    const assertions = await prisma.contentAssertion.findMany({
      where: {
        sourceId: { in: sourceIds },
        category: { notIn: [...INSTRUCTION_CATEGORIES] },
      },
      select: {
        id: true, // required for in-extractor LO-ref write-back
        assertion: true,
        category: true,
        chapter: true,
        section: true,
        tags: true,
      },
      orderBy: [{ depth: "asc" }, { orderIndex: "asc" }],
    });

    if (assertions.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No content-bearing assertions found — upload and extract a document first",
        },
        { status: 404 },
      );
    }

    // 3. Find existing curriculum for this subject (we upsert onto it, not create)
    const existingCurriculum = await prisma.curriculum.findFirst({
      where: { subjectId: primarySubject.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, deliveryConfig: true },
    });

    if (!existingCurriculum) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No curriculum exists for this subject yet — use the course setup wizard to create one first",
        },
        { status: 404 },
      );
    }

    // 4. Snapshot module slugs before regen so we can detect orphan risk
    const priorModules = await prisma.curriculumModule.findMany({
      where: { curriculumId: existingCurriculum.id, isActive: true },
      select: { slug: true, _count: { select: { callerProgress: true } } },
    });
    const priorSlugSet = new Set(priorModules.map((m) => m.slug));
    const priorSlugsWithProgress = priorModules
      .filter((m) => m._count.callerProgress > 0)
      .map((m) => m.slug);

    // Build the index→id map in the SAME order used to build the prompt.
    // extractCurriculumFromAssertions indexes assertions starting at 1.
    const assertionIdByIndex = new Map<number, string>();
    assertions.forEach((a, i) => assertionIdByIndex.set(i + 1, a.id));

    // 5. Call the curriculum extractor (A3-hardened prompt)
    const extracted = await extractCurriculumFromAssertions(
      assertions,
      primarySubject.name,
      primarySubject.qualificationRef ?? undefined,
    );

    if (!extracted.ok || extracted.modules.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: extracted.error || "Curriculum extraction returned no modules",
          warnings: extracted.warnings,
        },
        { status: 500 },
      );
    }

    // 6. syncModulesToDB — upserts by slug, runs A1 parseLoLine guard, fires A4
    // reconciler at the end automatically
    const newModules: LegacyCurriculumModuleJSON[] = extracted.modules.map((m) => ({
      id: m.id,
      title: m.title,
      description: m.description,
      sortOrder: m.sortOrder,
      estimatedDurationMinutes: m.estimatedDurationMinutes ?? undefined,
      learningOutcomes: m.learningOutcomes,
      assessmentCriteria: m.assessmentCriteria,
      keyTerms: m.keyTerms,
    }));

    // Explicit educator-triggered regenerate — use 'replace' mode so modules
    // no longer in the new curriculum are deactivated. All other callers use
    // the safer default 'merge' to avoid clobbering on AI non-determinism.
    // Pass assertion tags so the in-transaction apply can write LO refs back
    // to the source assertions before reconcile runs.
    const syncResult = await syncModulesToDB(existingCurriculum.id, newModules, {
      mode: "replace",
      assertionTags: extracted.assertionTags,
      assertionIdByIndex,
    });

    // 7. Detect orphan-progress risk — modules that had progress but are no
    // longer in the new curriculum (by slug)
    const newSlugSet = new Set(newModules.map((m, i) => m.id || `MOD-${i + 1}`));
    const orphanedProgressSlugs = priorSlugsWithProgress.filter((slug) => !newSlugSet.has(slug));

    // 8. Detect lesson plan staleness — if the module slugs changed, the
    // lesson plan's learningOutcomeRefs arrays may reference LO refs that no
    // longer exist
    const dc = existingCurriculum.deliveryConfig as Record<string, unknown> | null;
    const lessonPlan = dc?.lessonPlan as { entries?: unknown[] } | undefined;
    const hasLessonPlan = Array.isArray(lessonPlan?.entries) && lessonPlan.entries.length > 0;
    const slugsChanged = [...newSlugSet].some((s) => !priorSlugSet.has(s)) ||
      [...priorSlugSet].some((s) => !newSlugSet.has(s));
    const lessonPlanStaleWarning = hasLessonPlan && slugsChanged;

    // 9. The reconciler already ran inside syncModulesToDB — we surface its
    // stats from syncResult rather than firing a second call.

    return NextResponse.json({
      ok: true,
      curriculumId: existingCurriculum.id,
      moduleCount: syncResult.count,
      warnings: extracted.warnings,
      reconcile: syncResult.reconcile
        ? {
            assertionsScanned: syncResult.reconcile.assertionsScanned,
            fkWritten: syncResult.reconcile.fkWritten,
          }
        : { assertionsScanned: 0, fkWritten: 0 },
      lessonPlanStaleWarning,
      orphanedProgressSlugs,
    });
  } catch (error) {
    console.error(
      "[courses/:id/regenerate-curriculum] POST error:",
      error,
    );
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
