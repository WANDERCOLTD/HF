import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { TEACH_METHOD_CONFIG } from "@/lib/content-trust/resolve-config";

const VALID_CATEGORIES = ["fact", "definition", "threshold", "rule", "process", "example"];
const VALID_TEACH_METHODS = Object.keys(TEACH_METHOD_CONFIG);

/**
 * @api PATCH /api/content-sources/:sourceId/assertions/:assertionId
 * @visibility public
 * @scope content-sources:write
 * @auth session (OPERATOR+)
 * @tags content-trust
 * @description Update an individual content assertion. Can modify text, category, tags, location,
 *   validity, exam relevance, and review status. When markReviewed is true, sets reviewedBy and reviewedAt.
 * @body assertion string - Updated assertion text (5-5000 chars)
 * @body category string - Category (fact, definition, threshold, rule, process, example)
 * @body tags string[] - Tag array
 * @body chapter string|null - Chapter reference
 * @body section string|null - Section reference
 * @body pageRef string|null - Page reference
 * @body validFrom string|null - ISO date
 * @body validUntil string|null - ISO date
 * @body taxYear string|null - Tax year string
 * @body examRelevance number|null - Exam relevance 0.0-1.0
 * @body learningOutcomeRef string|null - Learning outcome reference
 * @body markReviewed boolean - When true, sets reviewedBy/reviewedAt from session
 * @response 200 { ok: true, assertion: ContentAssertion }
 * @response 400 { ok: false, error: "..." }
 * @response 404 { ok: false, error: "Assertion not found" }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sourceId: string; assertionId: string }> }
) {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const { sourceId, assertionId } = await params;

  try {
    // Verify assertion exists and belongs to this source
    const existing = await prisma.contentAssertion.findUnique({
      where: { id: assertionId },
    });

    if (!existing || existing.sourceId !== sourceId) {
      return NextResponse.json(
        { ok: false, error: "Assertion not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const updates: Record<string, any> = {};

    // Validate and collect field updates
    if (body.assertion !== undefined) {
      const text = String(body.assertion).trim();
      if (text.length < 5 || text.length > 5000) {
        return NextResponse.json(
          { ok: false, error: "Assertion text must be 5-5000 characters" },
          { status: 400 }
        );
      }
      updates.assertion = text;
    }

    if (body.category !== undefined) {
      if (!VALID_CATEGORIES.includes(body.category)) {
        return NextResponse.json(
          { ok: false, error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}` },
          { status: 400 }
        );
      }
      updates.category = body.category;
    }

    if (body.tags !== undefined) {
      if (!Array.isArray(body.tags)) {
        return NextResponse.json(
          { ok: false, error: "Tags must be an array" },
          { status: 400 }
        );
      }
      updates.tags = body.tags.map((t: any) => String(t).trim()).filter(Boolean).slice(0, 20);
    }

    if (body.chapter !== undefined) updates.chapter = body.chapter || null;
    if (body.section !== undefined) updates.section = body.section || null;
    if (body.pageRef !== undefined) updates.pageRef = body.pageRef || null;

    if (body.validFrom !== undefined) {
      updates.validFrom = body.validFrom ? new Date(body.validFrom) : null;
    }
    if (body.validUntil !== undefined) {
      updates.validUntil = body.validUntil ? new Date(body.validUntil) : null;
    }
    if (body.taxYear !== undefined) updates.taxYear = body.taxYear || null;

    if (body.examRelevance !== undefined) {
      if (body.examRelevance !== null) {
        const val = Number(body.examRelevance);
        if (isNaN(val) || val < 0 || val > 1) {
          return NextResponse.json(
            { ok: false, error: "examRelevance must be between 0.0 and 1.0" },
            { status: 400 }
          );
        }
        updates.examRelevance = val;
      } else {
        updates.examRelevance = null;
      }
    }

    if (body.learningOutcomeRef !== undefined) {
      updates.learningOutcomeRef = body.learningOutcomeRef || null;
    }

    if (body.teachMethod !== undefined) {
      if (body.teachMethod !== null && !VALID_TEACH_METHODS.includes(body.teachMethod)) {
        return NextResponse.json(
          { ok: false, error: `Invalid teachMethod. Must be one of: ${VALID_TEACH_METHODS.join(", ")}` },
          { status: 400 }
        );
      }
      updates.teachMethod = body.teachMethod || null;
    }

    // Mark as reviewed
    if (body.markReviewed) {
      if (!auth.session.user?.id) {
        return NextResponse.json({ ok: false, error: "Session user ID missing" }, { status: 401 });
      }
      updates.reviewedBy = auth.session.user.id;
      updates.reviewedAt = new Date();
    }

    const updated = await prisma.contentAssertion.update({
      where: { id: assertionId },
      data: updates,
    });

    return NextResponse.json({ ok: true, assertion: updated });
  } catch (error: any) {
    console.error("[assertions/:id] PATCH error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Update failed" },
      { status: 500 }
    );
  }
}

/**
 * @api DELETE /api/content-sources/:sourceId/assertions/:assertionId
 * @visibility public
 * @scope content-sources:delete
 * @auth session (ADMIN+)
 * @tags content-trust
 * @description Delete an individual content assertion. Refuses if assertion has children in the hierarchy.
 * @response 200 { ok: true, deleted: { id: string } }
 * @response 400 { ok: false, error: "Cannot delete assertion with children" }
 * @response 404 { ok: false, error: "Assertion not found" }
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ sourceId: string; assertionId: string }> }
) {
  const auth = await requireAuth("ADMIN");
  if (isAuthError(auth)) return auth.error;

  const { sourceId, assertionId } = await params;

  try {
    const existing = await prisma.contentAssertion.findUnique({
      where: { id: assertionId },
      include: { _count: { select: { children: true } } },
    });

    if (!existing || existing.sourceId !== sourceId) {
      return NextResponse.json(
        { ok: false, error: "Assertion not found" },
        { status: 404 }
      );
    }

    if (existing._count.children > 0) {
      return NextResponse.json(
        { ok: false, error: `Cannot delete assertion with ${existing._count.children} children. Remove children first.` },
        { status: 400 }
      );
    }

    await prisma.contentAssertion.delete({ where: { id: assertionId } });

    return NextResponse.json({ ok: true, deleted: { id: assertionId } });
  } catch (error: any) {
    console.error("[assertions/:id] DELETE error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Delete failed" },
      { status: 500 }
    );
  }
}
