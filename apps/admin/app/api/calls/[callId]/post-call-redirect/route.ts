/**
 * @api GET /api/calls/:callId/post-call-redirect
 * @visibility public
 * @scope calls:read
 * @auth session (VIEWER+ — STUDENT scoped to own caller)
 * @tags calls
 * @description Resolves the URL a STUDENT learner should land on after
 *   a call ends. Closes the Epic #1700 missing-surface gap on Theme
 *   13a (Mock Results, #1751): pre-this-route Mock learners were
 *   redirected to the generic `/x/student` home and never saw the
 *   per-session Mock Results screen.
 *
 *   Returns `{ target: "/x/student/<playbookId>/results/<sessionId>" }`
 *   for Mock-style calls (bound `CurriculumModule.coversModules.length > 0`
 *   — the canonical multi-part Mock discriminator from #1702 / #1785).
 *   Returns `{ target: "/x/student" }` otherwise.
 *
 *   STUDENT scope: enforced via `studentAllowedToReadCaller` against
 *   the Call's `callerId` (mirrors the precedent at
 *   `/api/calls/[callId]/route.ts`).
 *
 * @pathParam callId string - Call.id
 * @response 200 { ok: true, target: string }
 * @response 403 { ok: false, error: string }
 * @response 404 { ok: false, error: string }
 * @response 500 { ok: false, error: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { studentAllowedToReadCaller, callerScopeMismatchResponse } from "@/lib/learner-scope";

const FALLBACK_TARGET = "/x/student";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ callId: string }> },
): Promise<NextResponse> {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { callId } = await params;

    const call = await prisma.call.findUnique({
      where: { id: callId },
      select: {
        callerId: true,
        playbookId: true,
        sessionId: true,
        curriculumModule: { select: { coversModules: true } },
      },
    });
    if (!call) {
      return NextResponse.json({ ok: false, error: "Call not found" }, { status: 404 });
    }

    if (!studentAllowedToReadCaller(authResult.session, call.callerId)) {
      return callerScopeMismatchResponse();
    }

    const coversCount = call.curriculumModule?.coversModules?.length ?? 0;
    const target =
      call.playbookId && call.sessionId && coversCount > 0
        ? `/x/student/${call.playbookId}/results/${call.sessionId}`
        : FALLBACK_TARGET;

    return NextResponse.json({ ok: true, target });
  } catch (err) {
    console.error("[/api/calls/[callId]/post-call-redirect] error", err);
    return NextResponse.json(
      { ok: false, error: "Failed to resolve post-call redirect" },
      { status: 500 },
    );
  }
}
