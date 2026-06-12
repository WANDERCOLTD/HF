import { NextResponse } from "next/server";
import { runAggregateSpecs } from "@/lib/pipeline/aggregate-runner";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { studentAllowedToReadCaller, callerScopeMismatchResponse } from "@/lib/learner-scope";

/**
 * @api POST /api/callers/:callerId/aggregate
 * @visibility public
 * @scope pipeline:execute
 * @auth session
 * @tags callers, pipeline, aggregate
 * @description Run all active AGGREGATE specs to compute derived attributes from measurements for a caller. Finds active AGGREGATE specs, reads aggregationRules from spec config, queries recent CallScores for source parameters, applies aggregation logic (thresholds, averages), and updates CallerAttribute (e.g., learner profile).
 * @pathParam callerId string - The caller ID to run aggregation for
 * @response 200 { ok: true, callerId: string, specsRun: number, profileUpdates: object[], errors: string[], timestamp: string }
 * @response 500 { ok: false, error: "Failed to run aggregate specs" }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ callerId: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { callerId } = await params;


    // HF-M IDOR (2026-06-12): STUDENT-as-bearer routes that admit STUDENT must reject
    // a foreign callerId — without this, a STUDENT can read any caller's PII by supplying
    // their callerId in the URL path. See docs/audit/HF-M-evidence-path-param-idor.md.
    if (!studentAllowedToReadCaller(authResult.session, callerId)) {
      return callerScopeMismatchResponse();
    }
    console.log(`[aggregate-api] Running AGGREGATE specs for caller ${callerId}`);

    const results = await runAggregateSpecs(callerId);

    return NextResponse.json({
      ok: true,
      callerId,
      specsRun: results.specsRun,
      profileUpdates: results.profileUpdates,
      errors: results.errors,
      timestamp: new Date().toISOString(),
    });

  } catch (error: any) {
    console.error("[aggregate-api] Error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Failed to run aggregate specs",
      },
      { status: 500 }
    );
  }
}

/**
 * @api GET /api/callers/:callerId/aggregate
 * @visibility public
 * @scope callers:read
 * @auth session
 * @tags callers, pipeline, aggregate
 * @description Get available AGGREGATE specs for a caller. Returns all active specs with outputType AGGREGATE that can be run.
 * @pathParam callerId string - The caller ID to query aggregate specs for
 * @response 200 { ok: true, callerId: string, availableSpecs: { slug: string, name: string, description: string }[] }
 * @response 500 { ok: false, error: "Failed to get aggregate specs" }
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ callerId: string }> }
) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { callerId } = await params;


    // HF-M IDOR (2026-06-12): STUDENT-as-bearer routes that admit STUDENT must reject
    // a foreign callerId — without this, a STUDENT can read any caller's PII by supplying
    // their callerId in the URL path. See docs/audit/HF-M-evidence-path-param-idor.md.
    if (!studentAllowedToReadCaller(authResult.session, callerId)) {
      return callerScopeMismatchResponse();
    }
    // TODO: Track aggregation runs in a table if needed
    // For now, just return available specs

    const { prisma } = await import("@/lib/prisma");

    const aggregateSpecs = await prisma.analysisSpec.findMany({
      where: {
        outputType: 'AGGREGATE',
        isActive: true,
      },
      select: {
        slug: true,
        name: true,
        description: true,
      },
    });

    return NextResponse.json({
      ok: true,
      callerId,
      availableSpecs: aggregateSpecs,
    });

  } catch (error: any) {
    console.error("[aggregate-api] Error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Failed to get aggregate specs",
      },
      { status: 500 }
    );
  }
}
