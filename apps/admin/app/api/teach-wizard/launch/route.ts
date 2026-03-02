import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { randomFakeName } from "@/lib/fake-names";
import {
  startTaskTracking,
  updateTaskProgress,
  completeTask,
  failTask,
  backgroundRun,
} from "@/lib/ai/task-guidance";

/**
 * @api POST /api/teach-wizard/launch
 * @visibility internal
 * @scope teach-wizard:write
 * @auth session (OPERATOR+)
 * @tags wizard, teach
 * @description Server-side launch for the Teach wizard. Creates a UserTask that runs the
 *   full scaffold → caller → goals → compose-prompt sequence, reporting progress at each step.
 *   Client polls via useTaskPoll. On completion, task.context.callerId is the created caller.
 * @body domainId string - Domain to launch in (required)
 * @body goal string - Learning goal text (optional)
 * @body persona string - Selected persona slug (optional)
 * @body subjectIds string[] - Subject IDs for course-scoped content (optional)
 * @body behaviorTargets Record<string, number> - Behavior targets from matrix + pills (optional)
 * @response 202 { ok: true, taskId: string }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  try {
    const body = await request.json();
    const { domainId, goal, persona, subjectIds, behaviorTargets } = body;

    if (!domainId) {
      return NextResponse.json(
        { ok: false, error: "domainId is required" },
        { status: 400 }
      );
    }

    const userId = auth.session.user.id;
    // Capture cookies now — request may not be available in background
    const cookieHeader = request.headers.get("cookie") || "";
    const taskId = await startTaskTracking(userId, "teach-wizard-launch", {
      domainId,
      goal: goal || null,
      persona: persona || null,
      subjectIds: subjectIds || null,
      behaviorTargets: behaviorTargets || null,
      progress: "Setting up course...",
    });

    // Run the full launch sequence in the background
    backgroundRun(taskId, () =>
      runLaunchSequence(taskId, {
        domainId,
        goal: goal || null,
        persona: persona || null,
        subjectIds: subjectIds || null,
        behaviorTargets: behaviorTargets || null,
      }, cookieHeader)
    );

    return NextResponse.json({ ok: true, taskId }, { status: 202 });
  } catch (error: any) {
    console.error("[teach-wizard/launch] Error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Launch failed" },
      { status: 500 }
    );
  }
}

interface LaunchParams {
  domainId: string;
  goal: string | null;
  persona: string | null;
  subjectIds: string[] | null;
  behaviorTargets: Record<string, number> | null;
}

async function runLaunchSequence(taskId: string, params: LaunchParams, cookieHeader: string) {
  /** Build headers with forwarded auth cookies */
  const headers = (extra?: Record<string, string>) => ({
    "Content-Type": "application/json",
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    ...extra,
  });

  try {
    // Step 1: Scaffold domain (ensure playbook exists — idempotent)
    await updateTaskProgress(taskId, {
      context: { progress: "Setting up course infrastructure..." },
    });

    const scaffoldRes = await fetch(absoluteUrl("/api/domains/" + params.domainId + "/scaffold"), {
      method: "POST",
      headers: headers(),
    });
    const scaffoldData = await scaffoldRes.json().catch(() => null);
    const playbookId = scaffoldData?.result?.playbook?.id || null;

    // Step 1b: Link subjects to playbook
    if (playbookId && params.subjectIds?.length) {
      try {
        await fetch(absoluteUrl("/api/playbooks/" + playbookId + "/subjects"), {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ subjectIds: params.subjectIds }),
        });
      } catch (e) {
        console.warn("[teach-wizard/launch] Subject link failed (non-critical):", e);
      }
    }

    // Step 1c: Apply behavior targets
    if (playbookId && params.behaviorTargets && Object.keys(params.behaviorTargets).length > 0) {
      try {
        const targets = Object.entries(params.behaviorTargets).map(([parameterId, targetValue]) => ({
          parameterId,
          targetValue,
        }));
        await fetch(absoluteUrl("/api/playbooks/" + playbookId + "/targets"), {
          method: "PATCH",
          headers: headers(),
          body: JSON.stringify({ targets }),
        });
      } catch (e) {
        console.warn("[teach-wizard/launch] Behavior target application failed (non-critical):", e);
      }
    }

    // Step 2: Create test caller
    await updateTaskProgress(taskId, {
      context: { progress: "Creating test caller..." },
    });

    const callerRes = await fetch(absoluteUrl("/api/callers"), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        name: randomFakeName(),
        domainId: params.domainId,
        ...(playbookId && { playbookId }),
      }),
    });
    const callerData = await callerRes.json();
    if (!callerData.ok || !callerData.caller?.id) {
      throw new Error(callerData.error || "Failed to create test caller");
    }
    const callerId = callerData.caller.id;

    // Step 3: Create goal if provided
    if (params.goal) {
      await updateTaskProgress(taskId, {
        context: { progress: "Setting learning goals..." },
      });

      await fetch(absoluteUrl("/api/goals"), {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          callerId,
          name: params.goal,
          type: "LEARN",
        }),
      });
    }

    // Step 4: Compose prompt
    await updateTaskProgress(taskId, {
      context: { progress: "Preparing your tutor..." },
    });

    await fetch(absoluteUrl("/api/callers/" + callerId + "/compose-prompt"), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        triggerType: "teach-wizard",
        ...(playbookId ? { playbookIds: [playbookId] } : {}),
      }),
    });

    // Step 5: Complete — store callerId + playbookId for client redirect
    await updateTaskProgress(taskId, {
      context: {
        progress: "Ready!",
        callerId,
        playbookId,
      },
    });
    await completeTask(taskId);
  } catch (error: any) {
    console.error("[teach-wizard/launch] Sequence failed:", error);
    await failTask(taskId, error.message || "Launch failed");
  }
}

/**
 * Build absolute URL for internal fetch calls.
 * In server-side context, relative URLs don't work.
 */
function absoluteUrl(path: string): string {
  const base = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base}${path}`;
}
