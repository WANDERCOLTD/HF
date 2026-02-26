import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import { getSuggestSettings } from "@/lib/system-settings";

/**
 * @api POST /api/educator/classrooms/suggest-description
 * @visibility internal
 * @scope educator
 * @auth session
 * @tags classrooms
 * @description AI drafts a short cohort description from its name and institution
 * @body cohortName string - Cohort name (min 3 chars)
 * @body domainName string? - Institution name for context
 * @response 200 { ok: true, description: string }
 * @response 400 { ok: false, error: "cohortName must be at least 3 characters" }
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const body = await req.json().catch(() => ({}));
  const cohortName = (body.cohortName ?? "").trim();
  const domainName = (body.domainName ?? "").trim();

  if (cohortName.length < 3) {
    return NextResponse.json({ ok: false, error: "cohortName must be at least 3 characters" }, { status: 400 });
  }

  const { timeoutMs, maxInputLength } = await getSuggestSettings();
  const context = domainName
    ? `Cohort: ${cohortName.slice(0, maxInputLength)}, Institution: ${domainName.slice(0, 100)}`
    : cohortName.slice(0, maxInputLength);

  try {
    const response = await getConfiguredMeteredAICompletion(
      {
        callPoint: "classroom.suggest-description",
        messages: [
          {
            role: "system",
            content: `Write ONE short, practical sentence describing what this classroom cohort is for. Plain language. No quotes. Don't start with "This cohort". Respond with only the sentence.`,
          },
          { role: "user", content: context },
        ],
        temperature: 0.4,
        maxTokens: 80,
        timeoutMs,
      },
      { sourceOp: "classroom:suggest-description" }
    );

    const description = response.content.trim().replace(/^["']|["']$/g, "");
    return NextResponse.json({ ok: true, description });
  } catch (err: any) {
    console.warn("[classroom/suggest-description] AI call failed:", err.message);
    return NextResponse.json({ ok: true, description: "" }); // graceful fail
  }
}
