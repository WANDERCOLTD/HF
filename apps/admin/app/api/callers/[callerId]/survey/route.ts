/**
 * @api GET /api/callers/:callerId/survey
 * @visibility public
 * @scope callers:read
 * @auth OPERATOR
 * @tags callers, survey
 * @description Fetch all survey + assessment answers for a caller (stored as CallerAttribute records).
 *   Returns pre/post survey answers, personality profile answers, and pre/post test scores.
 * @pathParam callerId string - The caller ID
 * @response 200 { ok: true, pre: Record, post: Record, personality: Record, preTest: Record, postTest: Record }
 * @response 500 { ok: false, error: string }
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { SURVEY_SCOPES } from "@/lib/learner/survey-keys";

const ALL_SCOPES = [
  SURVEY_SCOPES.PRE, SURVEY_SCOPES.POST,
  SURVEY_SCOPES.PERSONALITY, SURVEY_SCOPES.PRE_TEST, SURVEY_SCOPES.POST_TEST,
];

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ callerId: string }> }
): Promise<NextResponse> {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const { callerId } = await params;

  try {
    const attributes = await prisma.callerAttribute.findMany({
      where: { callerId, scope: { in: ALL_SCOPES } },
      select: {
        key: true,
        scope: true,
        valueType: true,
        stringValue: true,
        numberValue: true,
        booleanValue: true,
        updatedAt: true,
      },
    });

    const buckets: Record<string, Record<string, string | number | boolean | null>> = {
      [SURVEY_SCOPES.PRE]: {},
      [SURVEY_SCOPES.POST]: {},
      [SURVEY_SCOPES.PERSONALITY]: {},
      [SURVEY_SCOPES.PRE_TEST]: {},
      [SURVEY_SCOPES.POST_TEST]: {},
    };

    for (const attr of attributes) {
      const value = attr.valueType === "NUMBER" ? attr.numberValue
        : attr.valueType === "BOOLEAN" ? attr.booleanValue
        : attr.stringValue;
      const bucket = buckets[attr.scope];
      if (bucket) bucket[attr.key] = value ?? null;
    }

    return NextResponse.json({
      ok: true,
      pre: buckets[SURVEY_SCOPES.PRE],
      post: buckets[SURVEY_SCOPES.POST],
      personality: buckets[SURVEY_SCOPES.PERSONALITY],
      preTest: buckets[SURVEY_SCOPES.PRE_TEST],
      postTest: buckets[SURVEY_SCOPES.POST_TEST],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
