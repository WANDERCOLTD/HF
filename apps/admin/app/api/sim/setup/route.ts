import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { resolveAndEnrollSingle } from "@/lib/enrollment";

/**
 * @api POST /api/sim/setup
 * @visibility internal
 * @auth session
 * @tags sim
 * @description Creates a Caller record linked to the authenticated user in the specified domain. Auto-enrolls in a single playbook if available. Used on first sim access.
 * @body domainId string - Domain to create caller in (required)
 * @body playbookId string - Specific playbook to enroll in (optional, auto-resolves if omitted)
 * @response 200 { ok: true, caller: { id, name, domainId, playbookId? } }
 * @response 400 { ok: false, error: "..." }
 * @response 401 { ok: false, error: "Unauthorized" }
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAuth("VIEWER");
  if (isAuthError(authResult)) return authResult.error;
  const { session } = authResult;

  const body = await request.json();
  const { domainId, playbookId } = body;

  if (!domainId) {
    return NextResponse.json(
      { ok: false, error: "Domain ID is required" },
      { status: 400 }
    );
  }

  // Verify domain exists
  const domain = await prisma.domain.findUnique({
    where: { id: domainId },
  });

  if (!domain) {
    return NextResponse.json(
      { ok: false, error: "Invalid domain" },
      { status: 400 }
    );
  }

  // Check if caller already exists for this user
  const existingCaller = await prisma.caller.findFirst({
    where: { userId: session.user.id },
  });

  if (existingCaller) {
    // Already set up — return existing caller
    return NextResponse.json({
      ok: true,
      caller: {
        id: existingCaller.id,
        name: existingCaller.name,
        domainId: existingCaller.domainId,
      },
    });
  }

  // Create caller linked to user
  const caller = await prisma.caller.create({
    data: {
      userId: session.user.id,
      email: session.user.email,
      name: session.user.name || "Tester",
      domainId,
      externalId: `sim-${session.user.id}`,
    },
  });

  // Auto-enroll: specific playbook > smart single resolve
  const enrollment = await resolveAndEnrollSingle(caller.id, domainId, "sim-setup", playbookId);

  return NextResponse.json({
    ok: true,
    caller: {
      id: caller.id,
      name: caller.name,
      domainId: caller.domainId,
      playbookId: enrollment?.playbookId || null,
    },
  });
}
