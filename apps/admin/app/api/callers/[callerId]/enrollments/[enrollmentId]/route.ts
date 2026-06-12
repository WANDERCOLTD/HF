/* eslint-disable hf-security/no-unscoped-caller-id-route --
 * HF-M.2 rule audit: handler is OPERATOR-only at the auth gate; STUDENT cannot
 * reach. The studentAllowedToReadCaller guard would be a no-op here; the
 * disable + this comment is the documented trust chain. If the auth gate
 * ever loosens to admit STUDENT (e.g. requireAuth("VIEWER")), remove this
 * disable AND add the guard call.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import {
  unenrollCaller,
  completeEnrollment,
  pauseEnrollment,
  resumeEnrollment,
} from "@/lib/enrollment";

/**
 * @api PATCH /api/callers/:callerId/enrollments/:enrollmentId
 * @visibility internal
 * @auth session
 * @tags callers, enrollments
 * @description Update an enrollment status (pause, resume, complete, drop).
 * @pathParam callerId string - The caller ID
 * @pathParam enrollmentId string - The enrollment ID
 * @body status string - New status: ACTIVE, PAUSED, COMPLETED, DROPPED
 * @response 200 { ok: true, enrollment: CallerPlaybook }
 * @response 400 { ok: false, error: "Invalid status" }
 * @response 404 { ok: false, error: "Enrollment not found" }
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ callerId: string; enrollmentId: string }> }
) {
  const authResult = await requireAuth("OPERATOR");
  if (isAuthError(authResult)) return authResult.error;

  const { callerId, enrollmentId } = await params;
  const body = await req.json();
  const { status } = body;

  // Find enrollment to get playbookId
  const existing = await prisma.callerPlaybook.findUnique({
    where: { id: enrollmentId },
  });

  if (!existing || existing.callerId !== callerId) {
    return NextResponse.json(
      { ok: false, error: "Enrollment not found" },
      { status: 404 }
    );
  }

  let enrollment;
  switch (status) {
    case "ACTIVE":
      enrollment = await resumeEnrollment(callerId, existing.playbookId);
      break;
    case "PAUSED":
      enrollment = await pauseEnrollment(callerId, existing.playbookId);
      break;
    case "COMPLETED":
      enrollment = await completeEnrollment(callerId, existing.playbookId);
      break;
    case "DROPPED":
      enrollment = await unenrollCaller(callerId, existing.playbookId);
      break;
    default:
      return NextResponse.json(
        { ok: false, error: "Invalid status. Must be ACTIVE, PAUSED, COMPLETED, or DROPPED" },
        { status: 400 }
      );
  }

  return NextResponse.json({ ok: true, enrollment });
}

/**
 * @api DELETE /api/callers/:callerId/enrollments/:enrollmentId
 * @visibility internal
 * @auth session
 * @tags callers, enrollments
 * @description Remove an enrollment entirely (hard delete).
 * @pathParam callerId string - The caller ID
 * @pathParam enrollmentId string - The enrollment ID
 * @response 200 { ok: true }
 * @response 404 { ok: false, error: "Enrollment not found" }
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ callerId: string; enrollmentId: string }> }
) {
  const authResult = await requireAuth("OPERATOR");
  if (isAuthError(authResult)) return authResult.error;

  const { callerId, enrollmentId } = await params;

  const existing = await prisma.callerPlaybook.findUnique({
    where: { id: enrollmentId },
  });

  if (!existing || existing.callerId !== callerId) {
    return NextResponse.json(
      { ok: false, error: "Enrollment not found" },
      { status: 404 }
    );
  }

  await prisma.callerPlaybook.delete({
    where: { id: enrollmentId },
  });

  return NextResponse.json({ ok: true });
}
