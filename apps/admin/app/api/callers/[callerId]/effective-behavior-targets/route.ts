import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getEffectiveBehaviorTargetsForCaller } from "@/lib/tolerance/getEffectiveBehaviorTargetsForCaller";

export const runtime = "nodejs";

/**
 * @api GET /api/callers/:callerId/effective-behavior-targets
 * @visibility internal
 * @scope callers:read
 * @auth session
 * @tags callers, targets
 * @description Return the fully-merged SYSTEM → PLAYBOOK → CALLER cascade for
 *   every adjustable BEHAVIOR parameter, in the context of one playbook. The
 *   Tune sidebar consumes this so the slider's effectiveValue includes the
 *   learner's per-caller override — chain-contract Link 3a (authoring-side
 *   read parity, epic #909 / fix #911). DO NOT extend the existing
 *   `/api/playbooks/[id]/targets` endpoint with a `?callerId=` query param —
 *   `TolerancesSettings.tsx` depends on that endpoint staying SYSTEM+PLAYBOOK
 *   only. Read-only: no compose-timestamp bump, no writes.
 * @pathParam callerId string - Caller UUID
 * @queryParam playbookId string - Required. Playbook UUID to scope SYSTEM + PLAYBOOK reads.
 * @response 200 { ok: true, callerId, playbookId, parameters: Array<{ parameterId, effectiveValue, sourceScope, systemValue, playbookValue, callerValue }> }
 * @response 400 { ok: false, error: "playbookId is required" }
 * @response 401/403 (handled by requireAuth)
 * @response 500 { ok: false, error: "..." }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ callerId: string }> },
) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { callerId } = await params;
    const playbookId = request.nextUrl.searchParams.get("playbookId");
    if (!playbookId) {
      return NextResponse.json(
        { ok: false, error: "playbookId is required" },
        { status: 400 },
      );
    }

    const parameters = await getEffectiveBehaviorTargetsForCaller(playbookId, callerId);

    return NextResponse.json({
      ok: true,
      callerId,
      playbookId,
      parameters,
    });
  } catch (error: any) {
    console.error("Error reading effective behavior targets:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to read effective behavior targets" },
      { status: 500 },
    );
  }
}
