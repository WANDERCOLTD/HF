import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * @api GET /api/content-review/counts
 * @visibility internal
 * @scope content-review:read
 * @auth OPERATOR
 * @tags content-review
 * @description Returns lightweight counts for the content review queue.
 *   Used by the sidebar counter pill to show items needing attention.
 * @response 200 { ok: true, counts: { unreviewed: number, dirty: number, errors: number, loReviewQueue: number, total: number } }
 * @response 401 Unauthorized
 */
export async function GET() {
  const authResult = await requireAuth("OPERATOR");
  if (isAuthError(authResult)) return authResult.error;

  const [unreviewed, dirty, errors, loReviewQueue, total] = await Promise.all([
    // L0/L1 sources that need human review
    prisma.contentSource.count({
      where: {
        isActive: true,
        trustLevel: { in: ["UNVERIFIED", "AI_ASSISTED"] },
        mediaAssets: { some: {} }, // Only sources that have files (not empty placeholders)
      },
    }),
    // Content specs with isDirty (new assertions arrived since last generation)
    prisma.analysisSpec.count({
      where: {
        specRole: "CONTENT",
        isDirty: true,
        isActive: true,
      },
    }),
    // Failed extraction jobs (last 7 days — status "abandoned" with error in context)
    prisma.userTask.count({
      where: {
        taskType: "extraction",
        status: "abandoned",
        startedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
    }),
    // #317 — LO classifications needing human review: applied=false AND
    // the LO row hasn't been human-overridden yet. We count distinct
    // loIds so re-runs of the classifier on the same LO don't inflate
    // the queue badge.
    prisma.loClassification
      .findMany({
        where: { applied: false, lo: { humanOverriddenAt: null } },
        select: { loId: true },
        distinct: ["loId"],
      })
      .then((rows) => rows.length),
    // Total active sources
    prisma.contentSource.count({
      where: { isActive: true },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    counts: { unreviewed, dirty, errors, loReviewQueue, total },
  });
}
