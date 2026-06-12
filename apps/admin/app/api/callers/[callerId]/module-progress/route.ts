/**
 * @api GET /api/callers/:callerId/module-progress
 * @scope callers:read
 * @auth session (VIEWER+)
 * @desc Get caller's module progress across all curricula. Returns CallerModuleProgress
 *       joined with CurriculumModule (title, slug, sortOrder).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { studentAllowedToReadCaller, callerScopeMismatchResponse } from "@/lib/learner-scope";

type Params = { params: Promise<{ callerId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
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
    const progress = await prisma.callerModuleProgress.findMany({
      where: { callerId },
      include: {
        module: {
          select: {
            id: true,
            slug: true,
            title: true,
            sortOrder: true,
            curriculum: {
              select: { id: true, name: true },
            },
          },
        },
      },
      orderBy: { module: { sortOrder: "asc" } },
    });

    return NextResponse.json({ ok: true, progress });
  } catch (error: any) {
    console.error("[callers/:id/module-progress] GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
