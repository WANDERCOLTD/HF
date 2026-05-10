/**
 * @api GET /api/curricula/lo-review-queue
 * @visibility internal
 * @scope curricula:read
 * @auth OPERATOR
 * @tags curriculum, content-review
 * @description Returns LO classification rows that the AI-to-DB guard
 *   queued for human review (#317). A row is in the queue when its
 *   `applied=false` AND the parent LO has no `humanOverriddenAt`. Latest
 *   classification per LO wins (so re-runs don't show stale rows).
 * @query limit number (default 50, max 200)
 * @response 200 { ok, items: [{ classificationId, lo: { id, ref, description, originalText, learnerVisible, performanceStatement, systemRole }, proposal: { proposedLearnerVisible, proposedPerformanceStatement, proposedSystemRole, confidence, rationale, classifierVersion, runAt }, module: { id, slug, title }, curriculum: { id, name } }] }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth("OPERATOR");
    if (isAuthError(auth)) return auth.error;

    const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? 50);
    const limit = Math.max(1, Math.min(200, Number.isFinite(limitParam) ? limitParam : 50));

    // Pull queued classifications, latest per LO. Sorting by confidence ASC
    // surfaces the most uncertain first — that's where the operator's review
    // adds the most value.
    const queued = await prisma.loClassification.findMany({
      where: { applied: false, lo: { humanOverriddenAt: null } },
      orderBy: [{ confidence: "asc" }, { runAt: "desc" }],
      include: {
        lo: {
          select: {
            id: true,
            ref: true,
            description: true,
            originalText: true,
            learnerVisible: true,
            performanceStatement: true,
            systemRole: true,
            module: {
              select: {
                id: true,
                slug: true,
                title: true,
                curriculum: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      take: limit * 4, // over-fetch so the per-LO dedup below still returns up to `limit` rows
    });

    // Dedup: keep newest classification per LO.
    const seen = new Set<string>();
    const items: unknown[] = [];
    for (const c of queued) {
      if (seen.has(c.loId)) continue;
      seen.add(c.loId);
      items.push({
        classificationId: c.id,
        lo: {
          id: c.lo.id,
          ref: c.lo.ref,
          description: c.lo.description,
          originalText: c.lo.originalText,
          learnerVisible: c.lo.learnerVisible,
          performanceStatement: c.lo.performanceStatement,
          systemRole: c.lo.systemRole,
        },
        proposal: {
          proposedLearnerVisible: c.proposedLearnerVisible,
          proposedPerformanceStatement: c.proposedPerformanceStatement,
          proposedSystemRole: c.proposedSystemRole,
          confidence: c.confidence,
          rationale: c.rationale,
          classifierVersion: c.classifierVersion,
          runAt: c.runAt,
        },
        module: c.lo.module
          ? { id: c.lo.module.id, slug: c.lo.module.slug, title: c.lo.module.title }
          : null,
        curriculum: c.lo.module?.curriculum
          ? { id: c.lo.module.curriculum.id, name: c.lo.module.curriculum.name }
          : null,
      });
      if (items.length >= limit) break;
    }

    return NextResponse.json({ ok: true, items });
  } catch (error: any) {
    console.error("[lo-review-queue] GET error:", error);
    return NextResponse.json({ error: error?.message ?? "unknown error" }, { status: 500 });
  }
}
