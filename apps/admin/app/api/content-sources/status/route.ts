import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api GET /api/content-sources/status
 * @visibility internal
 * @scope content-sources:read
 * @auth VIEWER
 * @tags content-trust, status
 * @description Batch status for multiple content sources. Returns per-source
 *   processing stage indicators (extraction, embedding, structuring) derived
 *   from existing data — no new columns needed.
 *
 * @query ids string — comma-separated ContentSource UUIDs
 *
 * @response 200 { ok, sources: Record<string, SourceStatus> }
 */

/** Max sources per batch request */
const MAX_STATUS_BATCH = 50;

export interface SourceStatus {
  assertionCount: number;
  embeddedCount: number;
  structuredCount: number;
  jobStatus: "pending" | "extracting" | "importing" | "done" | "error" | null;
  jobError?: string;
}

export async function GET(req: NextRequest) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const ids = req.nextUrl.searchParams.get("ids");
    if (!ids) {
      return NextResponse.json({ ok: false, error: "Missing ids parameter" }, { status: 400 });
    }

    const sourceIds = ids.split(",").map((id) => id.trim()).filter(Boolean);
    if (sourceIds.length === 0) {
      return NextResponse.json({ ok: true, sources: {} });
    }
    if (sourceIds.length > MAX_STATUS_BATCH) {
      return NextResponse.json({ ok: false, error: `Max ${MAX_STATUS_BATCH} sources per request` }, { status: 400 });
    }

    // 1. Assertion counts per source
    const assertionCounts = await prisma.contentAssertion.groupBy({
      by: ["sourceId"],
      where: { sourceId: { in: sourceIds } },
      _count: { id: true },
    });
    const countMap = new Map(assertionCounts.map((r) => [r.sourceId, r._count.id]));

    // 2. Embedded assertion counts (assertions with embedding IS NOT NULL)
    const embeddedCounts = await prisma.$queryRaw<Array<{ sourceId: string; cnt: bigint }>>`
      SELECT "sourceId", COUNT(*) as cnt
      FROM "ContentAssertion"
      WHERE "sourceId" = ANY(${sourceIds}::text[])
        AND embedding IS NOT NULL
      GROUP BY "sourceId"
    `;
    const embeddedMap = new Map(embeddedCounts.map((r) => [r.sourceId, Number(r.cnt)]));

    // 3. Structured assertion counts (depth > 0 means part of pyramid)
    const structuredCounts = await prisma.contentAssertion.groupBy({
      by: ["sourceId"],
      where: { sourceId: { in: sourceIds }, depth: { gt: 0 } },
      _count: { id: true },
    });
    const structuredMap = new Map(structuredCounts.map((r) => [r.sourceId, r._count.id]));

    // 4. Latest extraction job status per source (from UserTask)
    // TaskStatus enum: in_progress | completed | abandoned
    // Error info is stored in the context JSON, not a separate column
    const tasks = await prisma.userTask.findMany({
      where: {
        taskType: { in: ["extraction", "content_extraction"] },
        status: { not: "abandoned" },
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        status: true,
        context: true,
        currentStep: true,
        updatedAt: true,
      },
    });

    // Build a map: sourceId → latest job status
    const jobMap = new Map<string, { status: string; error?: string }>();
    for (const task of tasks) {
      const ctx = task.context as Record<string, unknown> | null;
      const taskSourceId = ctx?.sourceId as string | undefined;
      if (taskSourceId && sourceIds.includes(taskSourceId) && !jobMap.has(taskSourceId)) {
        let jobStatus: string;
        const ctxError = ctx?.error as string | undefined;
        if (task.status === "completed" && ctxError) jobStatus = "error";
        else if (task.status === "completed") jobStatus = "done";
        else jobStatus = task.currentStep >= 2 ? "importing" : "extracting";
        jobMap.set(taskSourceId, {
          status: jobStatus,
          error: ctxError || undefined,
        });
      }
    }

    // Build response
    const sources: Record<string, SourceStatus> = {};
    for (const id of sourceIds) {
      const assertionCount = countMap.get(id) || 0;
      const job = jobMap.get(id);
      sources[id] = {
        assertionCount,
        embeddedCount: embeddedMap.get(id) || 0,
        structuredCount: structuredMap.get(id) || 0,
        jobStatus: (job?.status as SourceStatus["jobStatus"]) || (assertionCount > 0 ? "done" : null),
        jobError: job?.error,
      };
    }

    return NextResponse.json({ ok: true, sources });
  } catch (error: unknown) {
    console.error("[content-sources/status] Error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Status check failed" },
      { status: 500 },
    );
  }
}
