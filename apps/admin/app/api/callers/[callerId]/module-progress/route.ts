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

type Params = { params: Promise<{ callerId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { callerId } = await params;

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
