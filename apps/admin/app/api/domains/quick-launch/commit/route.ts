import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import {
  quickLaunchCommit,
  type ProgressEvent,
  type CommitOverrides,
  type AnalysisPreview,
} from "@/lib/domain/quick-launch";
import { completeTask, updateTaskProgress, failTask } from "@/lib/ai/task-guidance";
import { prisma } from "@/lib/prisma";

/**
 * @api POST /api/domains/quick-launch/commit
 * @visibility internal
 * @auth OPERATOR
 * @tags domains, quick-launch
 * @description Runs the commit phase of Quick Launch (Steps 5-7):
 *   scaffold domain, generate curriculum, create caller.
 *   Applies user overrides from the review screen.
 *   Marks the associated UserTask as completed.
 *
 * @request application/json
 *   taskId: string (optional) — UserTask ID for tracking
 *   domainId: string (required) — Domain created during analysis
 *   preview: AnalysisPreview (required) — Analysis results
 *   overrides: CommitOverrides (required) — User edits from review
 *   input: { subjectName, persona, learningGoals, qualificationRef } (required)
 *
 * @response 200 text/event-stream — progress events then final QuickLaunchResult
 */

export const maxDuration = 120; // 2 min for scaffold + curriculum

export async function POST(req: NextRequest) {
  // Auth
  const authResult = await requireAuth("OPERATOR");
  if (isAuthError(authResult)) return authResult.error;

  // Parse JSON body
  let body: {
    taskId?: string;
    domainId: string;
    preview: AnalysisPreview;
    overrides: CommitOverrides;
    input: {
      subjectName: string;
      brief?: string;
      persona: string;
      learningGoals: string[];
      qualificationRef?: string;
      mode?: "upload" | "generate";
      kind?: "INSTITUTION" | "COMMUNITY";
      behaviorTargets?: Record<string, number>;
      matrixPositions?: Record<string, { x: number; y: number }>;
    };
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Expected JSON body" },
      { status: 400 }
    );
  }

  const { taskId, domainId, preview, overrides, input } = body;

  if (!domainId) {
    return NextResponse.json(
      { ok: false, error: "domainId is required" },
      { status: 400 }
    );
  }

  // Verify domain exists
  const domain = await prisma.domain.findUnique({ where: { id: domainId } });
  if (!domain) {
    return NextResponse.json(
      { ok: false, error: "Domain not found" },
      { status: 404 }
    );
  }

  // Update task to committing phase
  if (taskId) {
    updateTaskProgress(taskId, {
      currentStep: 4,
      context: { phase: "committing", overrides },
    }).catch((err) => {
      console.error(`[quick-launch:commit] Failed to update task progress:`, err);
    });
  }

  // SSE stream
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: ProgressEvent) => {
        const data = JSON.stringify(event);
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      try {
        const userId = (authResult as any).session.user.id;
        const result = await quickLaunchCommit(
          domainId,
          preview,
          overrides,
          {
            subjectName: input.subjectName,
            brief: input.brief,
            persona: input.persona,
            learningGoals: overrides.learningGoals ?? input.learningGoals,
            qualificationRef: input.qualificationRef,
            mode: input.mode,
            kind: input.kind,
            domainId, // Forward so scaffold knows this is an existing domain
            behaviorTargets: input.behaviorTargets,
            matrixPositions: input.matrixPositions,
          },
          sendEvent,
          userId,
        );

        // Store summary + mark task as completed
        if (taskId) {
          await updateTaskProgress(taskId, {
            context: {
              phase: "result",
              result,
              summary: {
                domain: { id: result.domainId, name: result.domainName, slug: result.domainSlug },
                caller: { id: result.callerId, name: result.callerName },
                counts: {
                  assertions: result.assertionCount ?? 0,
                  modules: result.moduleCount ?? 0,
                  goals: result.goalCount ?? 0,
                },
              },
            },
          });
          completeTask(taskId).catch((e) => {
            console.error(`[quick-launch:commit] Failed to complete task:`, e);
          });
        }
      } catch (err: any) {
        console.error("[quick-launch:commit] Failed:", err);
        sendEvent({
          phase: "error",
          message: err.message || "Commit failed",
        });
        if (taskId) {
          failTask(taskId, err.message || "Commit failed").catch((e) => {
            console.error(`[quick-launch:commit] Failed to mark task as failed:`, e);
          });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
