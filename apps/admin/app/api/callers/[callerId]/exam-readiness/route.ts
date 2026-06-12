import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { studentAllowedToReadCaller, callerScopeMismatchResponse } from "@/lib/learner-scope";
import {
  computeExamReadiness,
  getAllExamReadiness,
  updateFormativeScore,
  recordExamResult,
} from "@/lib/curriculum/exam-readiness";

/**
 * @api GET /api/callers/:callerId/exam-readiness
 * @visibility public
 * @scope callers:read
 * @auth session
 * @tags callers, exam-readiness
 * @description Compute exam readiness for a caller across all active curricula (or one specific)
 * @pathParam callerId string - The caller ID
 * @queryParam specSlug string - Optional: specific curriculum slug to check
 * @response 200 { ok: true, curricula: ExamReadinessResult[] }
 * @response 404 { ok: false, error: "Caller not found" }
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ callerId: string }> },
) {
  try {
    const authResult = await requireAuth("VIEWER");
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
      return NextResponse.json({ ok: false, error: "Caller not found" }, { status: 404 });
    }

    const url = new URL(req.url);
    const specSlug = url.searchParams.get("specSlug");

    let curricula;
    if (specSlug) {
      const result = await computeExamReadiness(callerId, specSlug);
      curricula = [result];
    } else {
      curricula = await getAllExamReadiness(callerId);
    }

    return NextResponse.json({
      ok: true,
      curricula,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[exam-readiness] GET error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to compute exam readiness" },
      { status: 500 },
    );
  }
}

/**
 * @api POST /api/callers/:callerId/exam-readiness
 * @visibility public
 * @scope callers:write
 * @auth session
 * @tags callers, exam-readiness
 * @description Submit formative assessment results or record an exam result
 * @pathParam callerId string - The caller ID
 * @body { specSlug: string, action: "formative" | "exam_result", moduleScores?: Record<string, number>, score?: number, totalQuestions?: number, correctAnswers?: number }
 * @response 200 { ok: true, readiness: ExamReadinessResult }
 * @response 400 { ok: false, error: string }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ callerId: string }> },
) {
  try {
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
      return NextResponse.json({ ok: false, error: "Caller not found" }, { status: 404 });
    }

    const body = await req.json();
    const { specSlug, action } = body;

    if (!specSlug || !action) {
      return NextResponse.json(
        { ok: false, error: "specSlug and action are required" },
        { status: 400 },
      );
    }

    if (action === "formative") {
      const { moduleScores } = body;
      if (!moduleScores || typeof moduleScores !== "object") {
        return NextResponse.json(
          { ok: false, error: "moduleScores (Record<string, number>) required for formative action" },
          { status: 400 },
        );
      }

      const readiness = await updateFormativeScore(callerId, specSlug, moduleScores);
      return NextResponse.json({
        ok: true,
        readiness,
        timestamp: new Date().toISOString(),
      });
    }

    if (action === "exam_result") {
      const { score, totalQuestions, correctAnswers } = body;
      if (score === undefined || totalQuestions === undefined || correctAnswers === undefined) {
        return NextResponse.json(
          { ok: false, error: "score, totalQuestions, and correctAnswers required for exam_result action" },
          { status: 400 },
        );
      }

      const readiness = await recordExamResult(callerId, specSlug, score, totalQuestions, correctAnswers);
      return NextResponse.json({
        ok: true,
        readiness,
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json(
      { ok: false, error: `Unknown action: ${action}. Use "formative" or "exam_result"` },
      { status: 400 },
    );
  } catch (error: any) {
    console.error("[exam-readiness] POST error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to process exam readiness" },
      { status: 500 },
    );
  }
}
