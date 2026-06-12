/* eslint-disable hf-security/no-unscoped-caller-id-route --
 * HF-M.2 rule audit: handler is OPERATOR + ADMIN-only at the auth gate; STUDENT cannot
 * reach. The studentAllowedToReadCaller guard would be a no-op here; the
 * disable + this comment is the documented trust chain. If the auth gate
 * ever loosens to admit STUDENT (e.g. requireAuth("VIEWER")), remove this
 * disable AND add the guard call.
 */
/**
 * @api PATCH /api/callers/:callerId/actions/:actionId
 * @visibility public
 * @scope callers:write
 * @auth session
 * @tags callers, actions
 * @description Update a call action (status, notes, assignee, priority, dueAt).
 * @pathParam callerId string - The caller ID
 * @pathParam actionId string - The action ID
 * @body { status?, notes?, assignee?, priority?, dueAt? }
 * @response 200 { ok: true, action: CallAction }
 * @response 404 { ok: false, error: string }
 */

/**
 * @api DELETE /api/callers/:callerId/actions/:actionId
 * @visibility public
 * @scope callers:write
 * @auth session
 * @tags callers, actions
 * @description Delete a call action.
 * @pathParam callerId string - The caller ID
 * @pathParam actionId string - The action ID
 * @response 200 { ok: true }
 * @response 404 { ok: false, error: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { CallActionStatus, CallActionAssignee, CallActionPriority } from "@prisma/client";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ callerId: string; actionId: string }> }
) {
  const authResult = await requireAuth("OPERATOR");
  if (isAuthError(authResult)) return authResult.error;

  const { callerId, actionId } = await params;

  const existing = await prisma.callAction.findFirst({
    where: { id: actionId, callerId },
  });

  if (!existing) {
    return NextResponse.json(
      { ok: false, error: "Action not found" },
      { status: 404 }
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const update: any = {};

  if (body.status !== undefined) {
    if (!Object.values(CallActionStatus).includes(body.status)) {
      return NextResponse.json(
        { ok: false, error: `Invalid status. Must be one of: ${Object.values(CallActionStatus).join(", ")}` },
        { status: 400 }
      );
    }
    update.status = body.status;
    if (body.status === "COMPLETED") {
      update.completedAt = new Date();
      update.completedBy = authResult.session?.user?.id || "system";
    }
    if (body.status === "PENDING" || body.status === "IN_PROGRESS") {
      update.completedAt = null;
      update.completedBy = null;
    }
  }

  if (body.notes !== undefined) update.notes = body.notes;
  if (body.assignee !== undefined) {
    if (!Object.values(CallActionAssignee).includes(body.assignee)) {
      return NextResponse.json(
        { ok: false, error: `Invalid assignee. Must be one of: ${Object.values(CallActionAssignee).join(", ")}` },
        { status: 400 }
      );
    }
    update.assignee = body.assignee;
  }
  if (body.priority !== undefined) {
    if (!Object.values(CallActionPriority).includes(body.priority)) {
      return NextResponse.json(
        { ok: false, error: `Invalid priority. Must be one of: ${Object.values(CallActionPriority).join(", ")}` },
        { status: 400 }
      );
    }
    update.priority = body.priority;
  }
  if (body.dueAt !== undefined) {
    update.dueAt = body.dueAt ? new Date(body.dueAt) : null;
  }

  const action = await prisma.callAction.update({
    where: { id: actionId },
    data: update,
  });

  return NextResponse.json({ ok: true, action });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ callerId: string; actionId: string }> }
) {
  const authResult = await requireAuth("ADMIN");
  if (isAuthError(authResult)) return authResult.error;

  const { callerId, actionId } = await params;

  const existing = await prisma.callAction.findFirst({
    where: { id: actionId, callerId },
  });

  if (!existing) {
    return NextResponse.json(
      { ok: false, error: "Action not found" },
      { status: 404 }
    );
  }

  await prisma.callAction.delete({ where: { id: actionId } });

  return NextResponse.json({ ok: true });
}
