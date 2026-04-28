/**
 * @api PUT /api/courses/[courseId]/design
 * @visibility internal
 * @scope course:write
 * @auth session (OPERATOR+)
 * @tags course, design, welcome, nps
 * @description Save student experience design config (welcome flow phases + NPS settings).
 *   Writes to Playbook.config.welcome and Playbook.config.nps. Pre-survey gating
 *   is now computed from welcome.* via isPreSurveyEnabled — no surveys.pre write.
 *   surveys.post.enabled is mirrored from nps.enabled (post-survey has no
 *   welcome-side mirror yet).
 * @request { welcome?: WelcomeConfig, nps?: NpsConfig }
 * @response 200 { ok: true }
 * @response 404 { ok: false, error: "Course not found" }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import type { WelcomeConfig, NpsConfig, PlaybookConfig } from "@/lib/types/json-fields";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
): Promise<NextResponse> {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  try {
    const { courseId } = await params;
    const body = (await req.json()) as {
      welcome?: WelcomeConfig;
      nps?: NpsConfig;
    };

    const playbook = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: { config: true },
    });

    if (!playbook) {
      return NextResponse.json({ ok: false, error: "Course not found" }, { status: 404 });
    }

    const pbConfig = (playbook.config ?? {}) as PlaybookConfig;

    if (body.welcome) {
      pbConfig.welcome = body.welcome;
    }

    if (body.nps) {
      pbConfig.nps = body.nps;
    }

    // surveys.pre.enabled is now COMPUTED-ONLY from welcome.* (see isPreSurveyEnabled);
    // do NOT write it. surveys.post.enabled has no welcome-side mirror yet, so
    // mirror from nps.enabled when nps is being saved.
    if (body.nps) {
      const n = pbConfig.nps;
      pbConfig.surveys = {
        ...pbConfig.surveys,
        post: { enabled: !!n?.enabled, questions: pbConfig.surveys?.post?.questions ?? [] },
      };
    }

    await prisma.playbook.update({
      where: { id: courseId },
      data: { config: JSON.parse(JSON.stringify(pbConfig)) },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[design PUT]", err);
    return NextResponse.json(
      { ok: false, error: "Failed to save design config" },
      { status: 500 },
    );
  }
}
