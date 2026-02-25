import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { startTaskTracking, updateTaskProgress, failTask } from "@/lib/ai/task-guidance";
import { courseSetup } from "@/lib/domain/course-setup";
import type { CourseSetupInput, CourseSetupResult } from "@/lib/domain/course-setup";

/**
 * @api POST /api/courses/setup
 * @visibility internal
 * @auth OPERATOR+
 * @tags courses
 * @description Create a course via the setup wizard. Returns a task ID immediately; actual setup runs non-blocking.
 * @body {object} { courseName, learningOutcomes, teachingStyle, sessionCount, durationMins, emphasis, welcomeMessage, studentEmails, domainId?, sourceId?, interactionPattern? }
 * @response 200 { ok: true, taskId: string }
 * @response 400 { ok: false, error: string }
 * @response 500 { ok: false, error: string }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth("OPERATOR");
    if (isAuthError(auth)) return auth.error;

    const body = (await request.json()) as CourseSetupInput;
    const userId = (auth as any).session.user.id;

    // Validate required fields
    if (!body.courseName || !body.learningOutcomes || !body.teachingStyle) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing required fields: courseName, learningOutcomes, teachingStyle",
        },
        { status: 400 }
      );
    }

    // Reuse wizard task if provided (one task, two phases: wizard → execution)
    // Otherwise create a new task (backward compat / API calls without wizard)
    let taskId: string;
    if (body.wizardTaskId) {
      taskId = body.wizardTaskId;
      await updateTaskProgress(taskId, {
        currentStep: 1,
        context: { courseName: body.courseName, phase: "initializing" },
      });
    } else {
      taskId = await startTaskTracking(userId, "course_setup", {
        courseName: body.courseName,
        phase: "initializing",
      });
    }

    // Fire executor non-blocking (don't await)
    courseSetup(body, userId, taskId, async (event) => {
      // Update task progress as executor runs
      await updateTaskProgress(taskId, {
        context: {
          phase: event.phase,
          message: event.message,
          stepIndex: event.stepIndex,
          totalSteps: event.totalSteps,
          data: event.data,
        },
      });
    }).catch(async (err) => {
      console.error("[courses-setup] Executor failed:", err);
      await failTask(taskId, err.message);
    });

    return NextResponse.json({
      ok: true,
      taskId,
    });
  } catch (error: any) {
    console.error("[courses-setup] Error starting course setup:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to start course setup" },
      { status: 500 }
    );
  }
}
