/**
 * @api GET /api/callers/:callerId/actions
 * @visibility public
 * @scope callers:read
 * @auth session
 * @tags callers, actions
 * @description List call actions for a caller. Optionally filter by status, assignee, or callId.
 * @pathParam callerId string - The caller ID
 * @queryParam callId string - Filter by specific call (optional)
 * @queryParam status string - Filter by status: PENDING, IN_PROGRESS, COMPLETED, CANCELLED (optional)
 * @queryParam assignee string - Filter by assignee: CALLER, OPERATOR, AGENT (optional)
 * @queryParam limit number - Max results (default 50, max 200)
 * @response 200 { ok: true, actions: CallAction[], counts: { pending, completed, total } }
 * @response 404 { ok: false, error: "Caller not found" }
 */

/**
 * @api POST /api/callers/:callerId/actions
 * @visibility public
 * @scope callers:write
 * @auth session
 * @tags callers, actions
 * @description Create a manual action for a caller (operator drops something in).
 * @pathParam callerId string - The caller ID
 * @body { type, title, description?, assignee, priority?, dueAt?, mediaUrl?, mediaType?, artifactId?, notes? }
 * @response 201 { ok: true, action: CallAction }
 * @response 400 { ok: false, error: string }
 * @response 404 { ok: false, error: "Caller not found" }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { studentAllowedToReadCaller, callerScopeMismatchResponse } from "@/lib/learner-scope";
import { CallActionStatus, CallActionAssignee, CallActionType, CallActionPriority } from "@prisma/client";

export async function GET(
  request: NextRequest,
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
  const { searchParams } = new URL(request.url);
  const callId = searchParams.get("callId");
  const status = searchParams.get("status") as CallActionStatus | null;
  const assignee = searchParams.get("assignee") as CallActionAssignee | null;
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 200);

  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { id: true },
  });

  if (!caller) {
    return NextResponse.json(
      { ok: false, error: "Caller not found" },
      { status: 404 }
    );
  }

  const where: any = { callerId };
  if (callId) where.callId = callId;
  if (status && Object.values(CallActionStatus).includes(status)) {
    where.status = status;
  }
  if (assignee && Object.values(CallActionAssignee).includes(assignee)) {
    where.assignee = assignee;
  }

  const [actions, pending, completed, total] = await Promise.all([
    prisma.callAction.findMany({
      where,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: limit,
    }),
    prisma.callAction.count({ where: { callerId, status: "PENDING" } }),
    prisma.callAction.count({ where: { callerId, status: "COMPLETED" } }),
    prisma.callAction.count({ where: { callerId } }),
  ]);

  return NextResponse.json({
    ok: true,
    actions,
    counts: { pending, completed, total },
  });
}

const VALID_TYPES = Object.values(CallActionType);
const VALID_ASSIGNEES = Object.values(CallActionAssignee);
const VALID_PRIORITIES = Object.values(CallActionPriority);

export async function POST(
  request: NextRequest,
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
  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { id: true },
  });

  if (!caller) {
    return NextResponse.json(
      { ok: false, error: "Caller not found" },
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

  const { type, title, description, assignee, priority, dueAt, mediaUrl, mediaType, artifactId, notes, callId } = body;

  if (!type || !VALID_TYPES.includes(type)) {
    return NextResponse.json(
      { ok: false, error: `Invalid type. Must be one of: ${VALID_TYPES.join(", ")}` },
      { status: 400 }
    );
  }
  if (!title || typeof title !== "string" || title.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: "Title is required" },
      { status: 400 }
    );
  }
  if (!assignee || !VALID_ASSIGNEES.includes(assignee)) {
    return NextResponse.json(
      { ok: false, error: `Invalid assignee. Must be one of: ${VALID_ASSIGNEES.join(", ")}` },
      { status: 400 }
    );
  }
  if (priority && !VALID_PRIORITIES.includes(priority)) {
    return NextResponse.json(
      { ok: false, error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(", ")}` },
      { status: 400 }
    );
  }

  const action = await prisma.callAction.create({
    data: {
      callerId,
      callId: callId || null,
      type,
      title: title.trim(),
      description: description || null,
      assignee,
      priority: priority || "MEDIUM",
      dueAt: dueAt ? new Date(dueAt) : null,
      mediaUrl: mediaUrl || null,
      mediaType: mediaType || null,
      artifactId: artifactId || null,
      notes: notes || null,
      source: "MANUAL",
      confidence: 1.0,
      createdBy: authResult.session?.user?.id || null,
    },
  });

  return NextResponse.json({ ok: true, action }, { status: 201 });
}
