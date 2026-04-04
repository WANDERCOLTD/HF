/**
 * @api GET /api/student/survey
 * @auth session (STUDENT | OPERATOR+)
 * @query scope — PRE_SURVEY | POST_SURVEY | PERSONALITY | PRE_TEST | etc.
 * @query callerId — required for OPERATOR+ (admin viewing student)
 * @desc Load existing survey answers for the caller
 *
 * @api POST /api/student/survey
 * @auth session (STUDENT | OPERATOR+)
 * @query callerId — required for OPERATOR+ (admin viewing student)
 * @body { scope: "PRE_SURVEY" | "POST_SURVEY", answers: Record<string, string | number> }
 * @desc Save (upsert) survey answers as CallerAttributes
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStudentOrAdmin, isStudentAuthError } from "@/lib/student-access";
import { SURVEY_SCOPES } from "@/lib/learner/survey-keys";

const VALID_SCOPES = new Set(Object.values(SURVEY_SCOPES));

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireStudentOrAdmin(request);
  if (isStudentAuthError(auth)) return auth.error;

  const scope = request.nextUrl.searchParams.get("scope");
  if (!scope || !VALID_SCOPES.has(scope)) {
    return NextResponse.json(
      { ok: false, error: "Invalid or missing scope parameter" },
      { status: 400 },
    );
  }

  const { callerId } = auth;

  const attrs = await prisma.callerAttribute.findMany({
    where: { callerId, scope },
    select: { key: true, valueType: true, stringValue: true, numberValue: true },
  });

  const answers: Record<string, string | number> = {};
  for (const attr of attrs) {
    if (attr.valueType === "NUMBER" && attr.numberValue != null) {
      answers[attr.key] = attr.numberValue;
    } else if (attr.stringValue != null) {
      answers[attr.key] = attr.stringValue;
    }
  }

  return NextResponse.json({ ok: true, answers });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireStudentOrAdmin(request);
  if (isStudentAuthError(auth)) return auth.error;

  const body = await request.json() as {
    scope?: string;
    answers?: Record<string, string | number>;
  };

  const { scope, answers } = body;

  if (!scope || !VALID_SCOPES.has(scope)) {
    return NextResponse.json(
      { ok: false, error: "Invalid or missing scope" },
      { status: 400 },
    );
  }
  if (!answers || typeof answers !== "object") {
    return NextResponse.json(
      { ok: false, error: "Missing answers object" },
      { status: 400 },
    );
  }

  const { callerId } = auth;

  const upserts = Object.entries(answers).map(([key, value]) => {
    const isNum = typeof value === "number";
    return prisma.callerAttribute.upsert({
      where: { callerId_key_scope: { callerId, key, scope } },
      create: {
        callerId,
        key,
        scope,
        valueType: isNum ? "NUMBER" : "STRING",
        numberValue: isNum ? value : null,
        stringValue: isNum ? null : String(value),
      },
      update: {
        valueType: isNum ? "NUMBER" : "STRING",
        numberValue: isNum ? value : null,
        stringValue: isNum ? null : String(value),
      },
    });
  });

  // Always upsert submitted_at timestamp
  upserts.push(
    prisma.callerAttribute.upsert({
      where: { callerId_key_scope: { callerId, key: "submitted_at", scope } },
      create: {
        callerId,
        key: "submitted_at",
        scope,
        valueType: "STRING",
        stringValue: new Date().toISOString(),
      },
      update: {
        stringValue: new Date().toISOString(),
      },
    }),
  );

  await prisma.$transaction(upserts);

  return NextResponse.json({ ok: true });
}
