/**
 * @api GET /api/curricula/:curriculumId/modules/:moduleId
 * @scope curricula:read
 * @auth session (VIEWER+)
 * @desc Single module detail with learning objectives and assertion count. Use ?audience=learner to filter to learner-visible LOs and project performanceStatement into description; default is the full author view.
 * @query audience "learner" | "author" (default: "author")
 *
 * @api PATCH /api/curricula/:curriculumId/modules/:moduleId
 * @scope curricula:write
 * @auth session (OPERATOR+)
 * @desc Update module fields. When learningObjectives[] is provided, upserts LOs by ref (preserving classifier-owned columns: originalText, learnerVisible, performanceStatement, systemRole, humanOverriddenAt). Refs absent from the payload are deleted.
 *
 * @api DELETE /api/curricula/:curriculumId/modules/:moduleId
 * @scope curricula:write
 * @auth session (OPERATOR+)
 * @desc Delete module (cascades LOs via FK)
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { isValidLoPair, sanitiseLORef } from "@/lib/content-trust/validate-lo-linkage";
import { reconcileAssertionLOs } from "@/lib/content-trust/reconcile-lo-linkage";
import {
  AUDIENCE_AWARE_LO_SELECT,
  filterLOsForAudience,
  parseAudience,
  projectLoForAudience,
} from "@/lib/curriculum/lo-audience";

type Params = { params: Promise<{ curriculumId: string; moduleId: string }> };

// ---------------------------------------------------------------------------
// GET — single module detail
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { curriculumId, moduleId } = await params;
    const audience = parseAudience(req.nextUrl.searchParams.get("audience"));

    const mod = await prisma.curriculumModule.findFirst({
      where: { id: moduleId, curriculumId },
      include: {
        learningObjectives: {
          orderBy: { sortOrder: "asc" },
          select: {
            ...AUDIENCE_AWARE_LO_SELECT,
            _count: { select: { assertions: true } },
          },
        },
        _count: { select: { callerProgress: true, calls: true } },
      },
    });

    if (!mod) {
      return NextResponse.json({ error: "Module not found" }, { status: 404 });
    }

    // #317 — audience-aware shaping. learner view drops hidden LOs and
    // projects performanceStatement; author view returns the full record.
    const shaped = {
      ...mod,
      learningObjectives: filterLOsForAudience(mod.learningObjectives as never[], audience).map(
        (lo: any) => ({
          ...projectLoForAudience(lo, audience),
          _count: lo._count,
        }),
      ),
    };

    return NextResponse.json({ ok: true, audience, module: shaped });
  } catch (error: any) {
    console.error("[curricula/:id/modules/:id] GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH — update module (including LOs via full-replace)
// ---------------------------------------------------------------------------

interface LOInput {
  ref: string;
  description: string;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { curriculumId, moduleId } = await params;
    const body = await req.json();

    // Verify module belongs to this curriculum
    const existing = await prisma.curriculumModule.findFirst({
      where: { id: moduleId, curriculumId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Module not found" }, { status: 404 });
    }

    // Build update data from provided fields only
    const updateData: Record<string, any> = {};
    if (body.title !== undefined) updateData.title = body.title;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.sortOrder !== undefined) updateData.sortOrder = body.sortOrder;
    if (body.estimatedDurationMinutes !== undefined) updateData.estimatedDurationMinutes = body.estimatedDurationMinutes;
    if (body.masteryThreshold !== undefined) updateData.masteryThreshold = body.masteryThreshold;
    if (body.prerequisites !== undefined) updateData.prerequisites = body.prerequisites;
    if (body.keyTerms !== undefined) updateData.keyTerms = body.keyTerms;
    if (body.assessmentCriteria !== undefined) updateData.assessmentCriteria = body.assessmentCriteria;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    const learningObjectives: LOInput[] | undefined = body.learningObjectives;

    // Epic #131 — validate LO pairs before write. Reject garbage like
    // `{ref: "LO-1", description: "LO1"}` so CurriculumEditor cannot
    // silently re-introduce the incident #137 data corruption.
    if (learningObjectives !== undefined) {
      const invalid: { index: number; ref: string; reason: string }[] = [];
      for (let i = 0; i < learningObjectives.length; i++) {
        const lo = learningObjectives[i];
        const sanitised = sanitiseLORef(lo.ref);
        if (!sanitised) {
          invalid.push({ index: i, ref: lo.ref, reason: "ref is not a valid structured LO ref (expected LO1, LO-1, AC2.3, etc.)" });
          continue;
        }
        if (!isValidLoPair(sanitised, lo.description)) {
          invalid.push({ index: i, ref: lo.ref, reason: "description is empty, too short, or equals the ref" });
        }
      }
      if (invalid.length > 0) {
        return NextResponse.json(
          {
            error: "Invalid learning objectives",
            invalid,
            message: "Each LO must have a structured ref (LO1, LO-1, AC2.3) and a non-empty description that differs from the ref.",
          },
          { status: 400 },
        );
      }
    }

    // Transaction: update module + full-replace LOs if provided
    const updated = await prisma.$transaction(async (tx) => {
      const mod = await tx.curriculumModule.update({
        where: { id: moduleId },
        data: updateData,
      });

      if (learningObjectives !== undefined) {
        // #317 — upsert-by-ref instead of deleteMany+create. The author UI edits
        // `description` only; classifier-owned columns (originalText,
        // learnerVisible, performanceStatement, systemRole, humanOverriddenAt)
        // and per-LO mastery overrides MUST survive a re-save. Refs absent from
        // the incoming array are still deleted — the author is authoritative
        // about presence, the classifier is authoritative about audience split.
        const incomingRefs = new Set(
          learningObjectives.map((lo) => sanitiseLORef(lo.ref) ?? lo.ref),
        );
        const existingRows = await tx.learningObjective.findMany({
          where: { moduleId },
          select: { id: true, ref: true },
        });
        const removedIds = existingRows
          .filter((row) => !incomingRefs.has(row.ref))
          .map((row) => row.id);
        if (removedIds.length > 0) {
          await tx.learningObjective.deleteMany({ where: { id: { in: removedIds } } });
        }

        for (let i = 0; i < learningObjectives.length; i++) {
          const lo = learningObjectives[i];
          const ref = sanitiseLORef(lo.ref) ?? lo.ref;
          const description = lo.description.trim();
          await tx.learningObjective.upsert({
            where: { moduleId_ref: { moduleId, ref } },
            create: {
              moduleId,
              ref,
              description,
              // Capture originalText on first create so future author edits can
              // overwrite `description` without losing the verbatim source.
              originalText: description,
              sortOrder: i,
            },
            update: {
              description,
              sortOrder: i,
              // Intentionally NOT updating originalText, learnerVisible,
              // performanceStatement, systemRole, humanOverriddenAt, masteryThreshold.
            },
          });
        }
      }

      return mod;
    });

    // Epic #131 A4 — reconcile assertion FKs if LOs changed. Idempotent.
    if (learningObjectives !== undefined) {
      try {
        await reconcileAssertionLOs(curriculumId);
      } catch (err) {
        console.error(`[curricula/:id/modules/:id] reconcileAssertionLOs failed for ${curriculumId}:`, err);
      }
    }

    // Re-fetch with includes for response
    const result = await prisma.curriculumModule.findUnique({
      where: { id: updated.id },
      include: {
        learningObjectives: { orderBy: { sortOrder: "asc" } },
      },
    });

    return NextResponse.json({ ok: true, module: result });
  } catch (error: any) {
    console.error("[curricula/:id/modules/:id] PATCH error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE — remove module (LOs cascade via FK)
// ---------------------------------------------------------------------------

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { curriculumId, moduleId } = await params;

    // Verify module belongs to this curriculum
    const existing = await prisma.curriculumModule.findFirst({
      where: { id: moduleId, curriculumId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Module not found" }, { status: 404 });
    }

    await prisma.curriculumModule.delete({ where: { id: moduleId } });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[curricula/:id/modules/:id] DELETE error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
