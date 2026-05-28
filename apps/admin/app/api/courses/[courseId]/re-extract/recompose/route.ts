import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { executeComposition, loadComposeConfig, persistComposedPrompt } from "@/lib/prompt/composition";
import { renderPromptSummary } from "@/lib/prompt/composition/renderPromptSummary";
import pLimit from "p-limit";

/**
 * @api POST /api/courses/:courseId/re-extract/recompose
 * @visibility public
 * @scope courses:write
 * @auth OPERATOR
 * @tags composition, prompts, courses
 * @description Recompose prompts for all active callers enrolled in a course.
 *   Call after re-extraction completes to push fresh content into caller prompts.
 *
 * @pathParam courseId string - Playbook UUID
 * @response 200 { ok, composed, failed, total }
 * @response 404 { ok: false, error }
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
) {
  try {
    const user = await requireAuth("OPERATOR");
    if (isAuthError(user)) return user.error;

    const { courseId } = await params;

    // Find all active callers enrolled in this course
    const enrollments = await prisma.callerPlaybook.findMany({
      where: {
        playbookId: courseId,
        caller: { archivedAt: null },
      },
      select: { callerId: true },
    });

    if (enrollments.length === 0) {
      return NextResponse.json({
        ok: true,
        composed: 0,
        failed: 0,
        total: 0,
        message: "No active callers enrolled in this course",
      });
    }

    // Deduplicate callers
    const callerIds = [...new Set(enrollments.map((e) => e.callerId))];

    // Load compose config once (shared across all callers)
    const { fullSpecConfig, sections, specSlug } = await loadComposeConfig({
      playbookIds: [courseId],
    });

    const limit = pLimit(3);
    let composed = 0;
    let failed = 0;

    await Promise.all(
      callerIds.map((callerId) =>
        limit(async () => {
          try {
            const composition = await executeComposition(
              callerId,
              sections,
              fullSpecConfig,
              "re-extract",
            );
            const promptSummary = renderPromptSummary(composition.llmPrompt);
            await persistComposedPrompt(composition, promptSummary, {
              callerId,
              playbookId: courseId,
              triggerType: "re-extract",
              composeSpecSlug: specSlug,
              specConfig: fullSpecConfig,
            });
            composed++;
          } catch (err) {
            console.error(`[recompose] Failed for caller ${callerId}:`, err);
            failed++;
          }
        }),
      ),
    );

    return NextResponse.json({
      ok: true,
      composed,
      failed,
      total: callerIds.length,
    });
  } catch (err) {
    console.error("[recompose] Error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to recompose prompts" },
      { status: 500 },
    );
  }
}
