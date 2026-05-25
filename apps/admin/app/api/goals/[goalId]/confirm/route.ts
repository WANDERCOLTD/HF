/**
 * @api POST /api/goals/:goalId/confirm
 * @visibility internal
 * @auth session
 * @tags goals
 * @description Confirm or dismiss a goal completion signal. On confirm: marks goal COMPLETED.
 *   On dismiss: marks the CallerAttribute signal as dismissed (booleanValue: false).
 * @pathParam goalId string - The goal ID
 * @body action "confirm" | "dismiss" - Whether to confirm or dismiss the completion
 * @response 200 { ok: true, goal?: Goal, message: string }
 * @response 400 { ok: false, error: string }
 * @response 404 { ok: false, error: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { bumpCallerComposeTimestamp } from "@/lib/compose/bump-timestamp";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ goalId: string }> }
) {
  const authResult = await requireAuth("OPERATOR");
  if (isAuthError(authResult)) return authResult.error;

  const { goalId } = await params;

  const goal = await prisma.goal.findUnique({
    where: { id: goalId },
    select: { id: true, name: true, callerId: true, isAssessmentTarget: true, status: true },
  });

  if (!goal) {
    return NextResponse.json({ ok: false, error: "Goal not found" }, { status: 404 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action as string;
  if (action !== "confirm" && action !== "dismiss") {
    return NextResponse.json(
      { ok: false, error: 'action must be "confirm" or "dismiss"' },
      { status: 400 }
    );
  }

  // Find the pending completion signal
  const signal = await prisma.callerAttribute.findFirst({
    where: {
      callerId: goal.callerId,
      key: `goal_completion_signal:${goalId}`,
      scope: "GOAL_EVENT",
      booleanValue: null,
    },
  });

  if (action === "confirm") {
    // Mark goal as completed
    const updatedGoal = await prisma.goal.update({
      where: { id: goalId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        progress: 1.0,
      },
    });

    // Mark signal as confirmed (if exists)
    if (signal) {
      await prisma.callerAttribute.update({
        where: { id: signal.id },
        data: { booleanValue: true },
      });
    }

    // #830 — goals are read by COMPOSE (renderPromptSummary, simple,
    // offboarding transforms). Out-of-band confirmation means the
    // cached prompt's learner_goals block is now stale.
    await bumpCallerComposeTimestamp(goal.callerId);

    return NextResponse.json({
      ok: true,
      goal: updatedGoal,
      message: `Goal "${goal.name}" marked as completed`,
    });
  }

  // action === "dismiss"
  if (!signal) {
    return NextResponse.json(
      { ok: false, error: "No pending completion signal to dismiss" },
      { status: 404 }
    );
  }

  await prisma.callerAttribute.update({
    where: { id: signal.id },
    data: { booleanValue: false },
  });

  // #830 — dismissal flips the completion booleanValue read by COMPOSE.
  await bumpCallerComposeTimestamp(goal.callerId);

  return NextResponse.json({
    ok: true,
    message: `Completion signal for "${goal.name}" dismissed`,
  });
}
