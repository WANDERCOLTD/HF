/**
 * @api GET /api/callers/:callerId/exam-mode-check?moduleSlug=mock
 * @visibility public
 * @scope callers:read
 * @auth session (VIEWER+ — STUDENT scoped to own caller)
 * @tags callers, voice
 * @description Returns whether the supplied module slug should mount the
 *   IELTS Mock exam shell (Epic #1700 Theme 4 / #1745). Discriminator:
 *   `CurriculumModule.coversModules.length > 0` — the canonical multi-part
 *   Mock signal already established in #1702 / #1785 / #1840. The sim
 *   surface uses this response to flip into the dark dual-waveform shell
 *   for the Mock learner.
 *
 *   No moduleSlug → `{ examMode: false }`. Unknown module → same fallback.
 *
 * @pathParam callerId string - Caller.id
 * @queryParam moduleSlug string - CurriculumModule.slug
 * @response 200 { ok: true, examMode: boolean }
 * @response 403 { ok: false, error: string }
 * @response 500 { ok: false, error: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { studentAllowedToReadCaller, callerScopeMismatchResponse } from "@/lib/learner-scope";
import { PlaybookCurriculumRole } from "@prisma/client";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ callerId: string }> },
): Promise<NextResponse> {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { callerId } = await params;
    if (!studentAllowedToReadCaller(authResult.session, callerId)) {
      return callerScopeMismatchResponse();
    }

    const moduleSlug = req.nextUrl.searchParams.get("moduleSlug");
    if (!moduleSlug) {
      return NextResponse.json({ ok: true, examMode: false });
    }

    // Resolve the caller's active enrollment → curriculum → module.
    // Mirrors the same path the call-start pipeline takes (single
    // CallerPlaybook with status ACTIVE; primary Curriculum link).
    const enrollment = await prisma.callerPlaybook.findFirst({
      where: { callerId, status: "ACTIVE" },
      orderBy: { enrolledAt: "desc" },
      select: {
        playbook: {
          select: {
            playbookCurricula: {
              where: { role: PlaybookCurriculumRole.primary },
              select: { curriculumId: true },
            },
          },
        },
      },
    });
    const curriculumId = enrollment?.playbook?.playbookCurricula[0]?.curriculumId;
    if (!curriculumId) {
      return NextResponse.json({ ok: true, examMode: false });
    }

    const targetModule = await prisma.curriculumModule.findFirst({
      where: { curriculumId, slug: moduleSlug },
      select: { coversModules: true },
    });
    const examMode = (targetModule?.coversModules?.length ?? 0) > 0;

    return NextResponse.json({ ok: true, examMode });
  } catch (err) {
    console.error("[/api/callers/[callerId]/exam-mode-check] error", err);
    return NextResponse.json(
      { ok: false, error: "Failed to resolve exam mode" },
      { status: 500 },
    );
  }
}
