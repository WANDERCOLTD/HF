import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { resolveActivePlaybookId } from "@/lib/caller/resolve-active-playbook";

/**
 * @api GET /api/callers/:callerId/active-playbook
 * @visibility public
 * @scope callers:read
 * @auth session
 * @tags callers, enrollments
 * @description Resolve the active playbookId for a caller via the canonical
 *   L9 fallback chain (URL override → single ACTIVE enrollment → most-recently
 *   enrolled ACTIVE → null). Wraps `lib/caller/resolve-active-playbook.ts` so
 *   client-side learner-facing pages have a single endpoint to call instead
 *   of duplicating the pick rule. See `docs/CHAIN-CONTRACTS.md` Link L9.
 * @pathParam callerId string - The caller ID
 * @queryParam playbookId string? - Optional URL override; wins when non-empty
 * @response 200 { ok: true, playbookId: string | null }
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ callerId: string }> }
) {
  const authResult = await requireAuth("VIEWER");
  if (isAuthError(authResult)) return authResult.error;

  const { callerId } = await params;
  const url = new URL(req.url);
  const override = url.searchParams.get("playbookId");

  const playbookId = await resolveActivePlaybookId(callerId, override);

  return NextResponse.json({ ok: true, playbookId });
}
