/**
 * @api POST /api/student/onboarding
 * @visibility internal
 * @scope student:write
 * @auth session (STUDENT | OPERATOR+)
 * @tags student, onboarding
 * @description Mark onboarding as complete for a caller.
 * @query callerId — required for OPERATOR+ (admin viewing student)
 * @response 200 { ok: true }
 * @response 404 { ok: false, error: "..." }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStudentOrAdmin, isStudentAuthError } from "@/lib/student-access";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireStudentOrAdmin(request);
  if (isStudentAuthError(auth)) return auth.error;

  const { callerId } = auth;

  // Find the caller's domain to locate the OnboardingSession
  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { domainId: true },
  });

  if (!caller?.domainId) {
    return NextResponse.json(
      { ok: false, error: "Caller has no domain" },
      { status: 404 },
    );
  }

  await prisma.onboardingSession.upsert({
    where: { callerId_domainId: { callerId, domainId: caller.domainId } },
    create: {
      callerId,
      domainId: caller.domainId,
      isComplete: true,
      completedAt: new Date(),
    },
    update: {
      isComplete: true,
      completedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true });
}
