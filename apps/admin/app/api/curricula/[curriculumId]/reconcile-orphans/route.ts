import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { reconcileAssertionLOs } from "@/lib/content-trust/reconcile-lo-linkage";

/**
 * @api POST /api/curricula/:curriculumId/reconcile-orphans
 * @visibility internal
 * @scope curricula:write
 * @auth OPERATOR
 * @tags curricula, content-trust
 * @description Run Pass 2 (AI retag) reconciliation for orphan teaching
 *   points on this curriculum. Passes 1 and 2 auto-fire on curriculum save —
 *   this route is the on-demand force trigger from the UI.
 *   Rate-limited: 60s in-memory cooldown per curriculumId to prevent hot-loops.
 * @pathParam curriculumId string
 * @response 200 { ok, scanned, matched, unmatched, invalidRefs }
 * @response 429 { ok: false, error, retryAfter }
 */

// In-memory cooldown map. Keyed by curriculumId → last-run timestamp (ms).
// One instance per server process — this is best-effort anti-hot-loop, not
// a distributed lock. The frontend also rate-limits via localStorage.
const COOLDOWN_MS = 60_000;
const lastRunByCurriculum = new Map<string, number>();

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ curriculumId: string }> },
) {
  try {
    const auth = await requireAuth("OPERATOR");
    if (isAuthError(auth)) return auth.error;

    const { curriculumId } = await params;

    const now = Date.now();
    const lastRun = lastRunByCurriculum.get(curriculumId);
    if (lastRun && now - lastRun < COOLDOWN_MS) {
      const retryAfter = Math.ceil((COOLDOWN_MS - (now - lastRun)) / 1000);
      return NextResponse.json(
        {
          ok: false,
          error: "Reconcile recently ran for this curriculum",
          retryAfter,
        },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }
    lastRunByCurriculum.set(curriculumId, now);

    const result = await reconcileAssertionLOs(curriculumId, { runAiRetagPass: true });

    return NextResponse.json({
      ok: true,
      scanned: result.assertionsScanned,
      matched: result.aiRetagMatched,
      unmatched: result.aiRetagUnmatched,
      invalidRefs: result.aiRetagInvalidRefs,
    });
  } catch (err: any) {
    console.error("[reconcile-orphans] Error:", err);
    return NextResponse.json(
      { ok: false, error: err.message || "Internal error" },
      { status: 500 },
    );
  }
}
