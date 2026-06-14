/**
 * @api GET /api/courses/[courseId]/conversation-artifacts-preview
 *
 * Inspector preview of the `conversationArtifacts` composer section
 * (#1643 — Epic #1606 Group A.5). Caller-scoped section, so the route
 * picks a representative learner from the course — the most-recent
 * active CallerPlaybook enrollment — and runs the loader shipped in
 * #1642 against their state.
 *
 * Auth: OPERATOR+. Read-only. Returns the empty shape when the course
 * has no enrolled learners yet.
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import {
  loadConversationArtifacts,
  type ConversationArtifactsData,
} from "@/lib/prompt/composition/loaders/conversationArtifacts";

interface ConversationArtifactsPreviewResponse {
  ok: boolean;
  previewCallerName: string | null;
  data: ConversationArtifactsData;
}

const EMPTY_DATA: ConversationArtifactsData = {
  hasArtifacts: false,
  lastCallId: null,
  lastCallAt: null,
  artifacts: [],
};

export async function GET(
  _req: Request,
  context: { params: Promise<{ courseId: string }> },
): Promise<NextResponse<ConversationArtifactsPreviewResponse>> {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) {
    return auth.error as NextResponse<ConversationArtifactsPreviewResponse>;
  }
  const { courseId } = await context.params;

  const playbook = await prisma.playbook.findUnique({
    where: { id: courseId },
    select: { id: true },
  });
  if (!playbook) {
    return NextResponse.json(
      { ok: false, previewCallerName: null, data: EMPTY_DATA },
      { status: 404 },
    );
  }

  const enrollment = await prisma.callerPlaybook.findFirst({
    where: { playbookId: courseId, status: "ACTIVE" },
    orderBy: { startedAt: "desc" },
    select: {
      caller: { select: { id: true, name: true } },
    },
  });

  if (!enrollment?.caller) {
    return NextResponse.json({
      ok: true,
      previewCallerName: null,
      data: EMPTY_DATA,
    });
  }

  const data = await loadConversationArtifacts(prisma, {
    callerId: enrollment.caller.id,
  });

  return NextResponse.json({
    ok: true,
    previewCallerName: enrollment.caller.name ?? null,
    data,
  });
}
