/**
 * @api GET /api/callers/:callerId/survey
 * @visibility public
 * @scope callers:read
 * @auth OPERATOR
 * @tags callers, survey
 * @description Fetch pre-, mid-, and post-survey answers for a caller (stored as CallerAttribute records)
 * @pathParam callerId string - The caller ID
 * @response 200 { ok: true, pre: Record, mid: Record, post: Record }
 * @response 500 { ok: false, error: string }
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { SURVEY_SCOPES } from "@/lib/learner/survey-keys";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ callerId: string }> }
): Promise<NextResponse> {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const { callerId } = await params;

  try {
    const attributes = await prisma.callerAttribute.findMany({
      where: {
        callerId,
        scope: { in: [SURVEY_SCOPES.PRE, SURVEY_SCOPES.MID, SURVEY_SCOPES.POST] },
      },
      select: {
        key: true,
        scope: true,
        valueType: true,
        stringValue: true,
        numberValue: true,
        updatedAt: true,
      },
    });

    const pre: Record<string, string | number | null> = {};
    const mid: Record<string, string | number | null> = {};
    const post: Record<string, string | number | null> = {};

    for (const attr of attributes) {
      const value = attr.valueType === "NUMBER" ? attr.numberValue : attr.stringValue;
      const bucket = attr.scope === SURVEY_SCOPES.PRE ? pre
        : attr.scope === SURVEY_SCOPES.MID ? mid : post;
      bucket[attr.key] = value ?? null;
    }

    return NextResponse.json({ ok: true, pre, mid, post });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
