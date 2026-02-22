/**
 * @api {get} /api/demonstrate/suggest Get AI goal suggestions
 * @apiName GetDemonstrateSuggestions
 * @apiGroup Demonstrate
 * @apiPermission OPERATOR
 *
 * @apiQuery {String} domainId - Domain to suggest goals for
 * @apiQuery {String} [callerId] - Caller to suggest goals for (optional — enriches suggestions with learner history)
 * @apiQuery {String} [currentGoal] - Partial goal text for refinement
 *
 * @apiSuccess {Boolean} ok=true
 * @apiSuccess {String[]} suggestions - Array of suggested goal strings
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { suggestGoals } from "@/lib/demonstrate/suggest-goals";

export async function GET(req: NextRequest) {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const { searchParams } = new URL(req.url);
  const domainId = searchParams.get("domainId");
  const callerId = searchParams.get("callerId");
  const currentGoal = searchParams.get("currentGoal") || undefined;

  if (!domainId) {
    return NextResponse.json(
      { ok: false, error: "domainId is required" },
      { status: 400 },
    );
  }

  const suggestions = await suggestGoals({ domainId, callerId: callerId || undefined, currentGoal });

  return NextResponse.json({ ok: true, suggestions });
}
