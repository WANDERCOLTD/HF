import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getAllEnrollments, enrollCaller } from "@/lib/enrollment";
import { studentAllowedToReadCaller, callerScopeMismatchResponse } from "@/lib/learner-scope";

/**
 * @api GET /api/callers/:callerId/enrollments
 * @visibility public
 * @scope callers:read
 * @auth session
 * @tags callers, enrollments
 * @description List all playbook enrollments for a caller.
 * @pathParam callerId string - The caller ID
 * @response 200 { ok: true, enrollments: CallerPlaybook[] }
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ callerId: string }> }
) {
  const authResult = await requireAuth("VIEWER");
  if (isAuthError(authResult)) return authResult.error;

  const { callerId } = await params;

  // HF-M IDOR (2026-06-12): STUDENT-as-bearer routes that admit STUDENT must reject
  // a foreign callerId — without this, a STUDENT can read any caller's PII by supplying
  // their callerId in the URL path. See docs/audit/HF-M-evidence-path-param-idor.md.
  if (!studentAllowedToReadCaller(authResult.session, callerId)) {
    return callerScopeMismatchResponse();
  }
  const enrollments = await getAllEnrollments(callerId);

  return NextResponse.json({ ok: true, enrollments });
}

/**
 * @api POST /api/callers/:callerId/enrollments
 * @visibility public
 * @scope callers:write
 * @auth session
 * @tags callers, enrollments
 * @description Enroll a caller in a playbook.
 * @pathParam callerId string - The caller ID
 * @body playbookId string - Playbook to enroll in (required)
 * @response 200 { ok: true, enrollment: CallerPlaybook }
 * @response 400 { ok: false, error: "playbookId is required" }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ callerId: string }> }
) {
  const authResult = await requireAuth("OPERATOR");
  if (isAuthError(authResult)) return authResult.error;

  const { callerId } = await params;

  // HF-M IDOR (2026-06-12): STUDENT-as-bearer routes that admit STUDENT must reject
  // a foreign callerId — without this, a STUDENT can read any caller's PII by supplying
  // their callerId in the URL path. See docs/audit/HF-M-evidence-path-param-idor.md.
  if (!studentAllowedToReadCaller(authResult.session, callerId)) {
    return callerScopeMismatchResponse();
  }
  const body = await req.json();
  const { playbookId } = body;

  if (!playbookId) {
    return NextResponse.json(
      { ok: false, error: "playbookId is required" },
      { status: 400 }
    );
  }

  const enrollment = await enrollCaller(callerId, playbookId, "manual");

  return NextResponse.json({ ok: true, enrollment });
}
