/**
 * @api PUT /api/courses/[courseId]/design
 * @visibility internal
 * @scope course:write
 * @auth session (OPERATOR+)
 * @tags course, design, welcome, nps, felt-progress
 * @description Save student experience design config. Writes to
 *   Playbook.config.welcome, Playbook.config.nps, the #417 skill-banding
 *   overrides, and the #779 Felt Progress `progressNarrative` namespace.
 *   Pre-survey gating is computed from welcome.* via isPreSurveyEnabled
 *   (no surveys.pre write); surveys.post.enabled mirrors nps.enabled.
 *   Pass `null` for any optional override field to clear it (falls back
 *   to defaults / contract).
 * @request { welcome?: WelcomeConfig, nps?: NpsConfig, skillTierMapping?, skillScoringEmaHalfLifeDays?, skillMinCallsToFull?, progressNarrative? }
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
      // #417 Story C — per-playbook banding override.
      skillTierMapping?: PlaybookConfig["skillTierMapping"] | null;
      skillScoringEmaHalfLifeDays?: number | null;
      skillMinCallsToFull?: number | null;
      // #779 — Felt Progress S1. Object writes the fields; null clears the
      // namespace (falls back to all defaults from the transform).
      progressNarrative?: PlaybookConfig["progressNarrative"] | null;
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

    // #417 Story C — banding override. Pass `null` to clear (fall back
    // to the SKILL_MEASURE_V1 contract defaults).
    if (body.skillTierMapping !== undefined) {
      if (body.skillTierMapping === null) {
        delete pbConfig.skillTierMapping;
      } else {
        pbConfig.skillTierMapping = body.skillTierMapping;
      }
    }
    if (body.skillScoringEmaHalfLifeDays !== undefined) {
      if (body.skillScoringEmaHalfLifeDays === null) {
        delete pbConfig.skillScoringEmaHalfLifeDays;
      } else {
        pbConfig.skillScoringEmaHalfLifeDays = body.skillScoringEmaHalfLifeDays;
      }
    }
    if (body.skillMinCallsToFull !== undefined) {
      if (body.skillMinCallsToFull === null) {
        delete pbConfig.skillMinCallsToFull;
      } else {
        pbConfig.skillMinCallsToFull = body.skillMinCallsToFull;
      }
    }

    // #779 — Felt Progress progressNarrative. Pass `null` to clear (fall back
    // to transform defaults). Object writes the namespace verbatim.
    if (body.progressNarrative !== undefined) {
      if (body.progressNarrative === null) {
        delete pbConfig.progressNarrative;
      } else {
        pbConfig.progressNarrative = body.progressNarrative;
      }
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
