/**
 * @api POST /api/student/assessment
 * @visibility internal
 * @scope student:write
 * @auth session (STUDENT | OPERATOR+)
 * @tags student, assessment
 * @description Submit pre-test or post-test answers. Stores each answer + correctness
 *   as CallerAttributes, computes score, and for post-test also computes uplift vs pre-test.
 * @query callerId — required for OPERATOR+ (admin viewing student)
 * @body { scope: "PRE_TEST" | "POST_TEST", answers: Record<questionId, { answer: string, correct: boolean }>, questionIds: string[] }
 * @response 200 { ok, score, totalQuestions, correctCount, uplift? }
 * @response 400 { ok: false, error: "..." }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStudentOrAdmin, isStudentAuthError } from "@/lib/student-access";
import { SURVEY_SCOPES } from "@/lib/learner/survey-keys";

const VALID_SCOPES = new Set([SURVEY_SCOPES.PRE_TEST, SURVEY_SCOPES.POST_TEST]);

interface AnswerEntry {
  answer: string;
  correct: boolean;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireStudentOrAdmin(request);
  if (isStudentAuthError(auth)) return auth.error;

  const body = await request.json() as {
    scope?: string;
    answers?: Record<string, AnswerEntry>;
    questionIds?: string[];
  };

  const { scope, answers, questionIds } = body;

  if (!scope || !VALID_SCOPES.has(scope)) {
    return NextResponse.json({ ok: false, error: "Invalid scope. Must be PRE_TEST or POST_TEST." }, { status: 400 });
  }
  if (!answers || typeof answers !== "object" || Object.keys(answers).length === 0) {
    return NextResponse.json({ ok: false, error: "Missing answers" }, { status: 400 });
  }

  const { callerId } = auth;
  const totalQuestions = Object.keys(answers).length;
  const correctCount = Object.values(answers).filter((a) => a.correct).length;
  const score = totalQuestions > 0 ? correctCount / totalQuestions : 0;

  // Build upserts for each answer
  const upserts = [];

  for (const [questionId, entry] of Object.entries(answers)) {
    // Store the selected answer
    upserts.push(
      prisma.callerAttribute.upsert({
        where: { callerId_key_scope: { callerId, key: `${questionId}_answer`, scope } },
        create: { callerId, key: `${questionId}_answer`, scope, valueType: "STRING", stringValue: entry.answer },
        update: { stringValue: entry.answer },
      }),
    );
    // Store correctness
    upserts.push(
      prisma.callerAttribute.upsert({
        where: { callerId_key_scope: { callerId, key: `${questionId}_correct`, scope } },
        create: { callerId, key: `${questionId}_correct`, scope, valueType: "BOOLEAN", booleanValue: entry.correct },
        update: { booleanValue: entry.correct },
      }),
    );
  }

  // Store aggregate score
  upserts.push(
    prisma.callerAttribute.upsert({
      where: { callerId_key_scope: { callerId, key: "score", scope } },
      create: { callerId, key: "score", scope, valueType: "NUMBER", numberValue: score },
      update: { numberValue: score },
    }),
  );

  // Store question IDs (for post-test mirroring)
  if (questionIds && questionIds.length > 0) {
    upserts.push(
      prisma.callerAttribute.upsert({
        where: { callerId_key_scope: { callerId, key: "question_ids", scope } },
        create: { callerId, key: "question_ids", scope, valueType: "JSON", jsonValue: questionIds as any },
        update: { jsonValue: questionIds as any },
      }),
    );
  }

  // Store submitted_at
  upserts.push(
    prisma.callerAttribute.upsert({
      where: { callerId_key_scope: { callerId, key: "submitted_at", scope } },
      create: { callerId, key: "submitted_at", scope, valueType: "STRING", stringValue: new Date().toISOString() },
      update: { stringValue: new Date().toISOString() },
    }),
  );

  // For POST_TEST: compute uplift
  let uplift: { absolute: number; normalised: number } | undefined;

  if (scope === SURVEY_SCOPES.POST_TEST) {
    const preTestScore = await prisma.callerAttribute.findFirst({
      where: { callerId, scope: SURVEY_SCOPES.PRE_TEST, key: "score" },
      select: { numberValue: true },
    });

    if (preTestScore?.numberValue != null) {
      const pre = preTestScore.numberValue;
      const absolute = score - pre;
      const normalised = pre < 1.0 ? ((score - pre) / (1.0 - pre)) * 100 : 0;

      uplift = { absolute: Math.round(absolute * 1000) / 1000, normalised: Math.round(normalised * 10) / 10 };

      upserts.push(
        prisma.callerAttribute.upsert({
          where: { callerId_key_scope: { callerId, key: "uplift_absolute", scope } },
          create: { callerId, key: "uplift_absolute", scope, valueType: "NUMBER", numberValue: uplift.absolute },
          update: { numberValue: uplift.absolute },
        }),
        prisma.callerAttribute.upsert({
          where: { callerId_key_scope: { callerId, key: "uplift_normalised", scope } },
          create: { callerId, key: "uplift_normalised", scope, valueType: "NUMBER", numberValue: uplift.normalised },
          update: { numberValue: uplift.normalised },
        }),
      );
    }
  }

  await prisma.$transaction(upserts);

  return NextResponse.json({
    ok: true,
    score: Math.round(score * 1000) / 1000,
    totalQuestions,
    correctCount,
    uplift,
  });
}
