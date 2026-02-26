import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import { getSuggestSettings } from "@/lib/system-settings";

/**
 * @api POST /api/educator/classrooms/suggest-name
 * @visibility internal
 * @scope educator
 * @auth session
 * @tags classrooms
 * @description AI suggests cohort names from institution and optional department context
 * @body domainName string - Institution name
 * @body groupName string? - Optional department name for more specific suggestions
 * @response 200 { ok: true, names: string[] }
 * @response 400 { ok: false, error: "domainName is required" }
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const body = await req.json().catch(() => ({}));
  const domainName = (body.domainName ?? "").trim();
  const groupName = (body.groupName ?? "").trim();

  if (!domainName) {
    return NextResponse.json({ ok: false, error: "domainName is required" }, { status: 400 });
  }

  const { timeoutMs, maxInputLength } = await getSuggestSettings();
  const context = groupName
    ? `Institution: ${domainName.slice(0, maxInputLength)}, Department: ${groupName.slice(0, 100)}`
    : `Institution: ${domainName.slice(0, maxInputLength)}`;

  try {
    const response = await getConfiguredMeteredAICompletion(
      {
        callPoint: "classroom.suggest-name",
        messages: [
          {
            role: "system",
            content: `You suggest realistic cohort names for an educational classroom. Generate 3 short, practical cohort name suggestions based on the institution and optional department. Each name should be concise (2–5 words), concrete, and follow patterns like "Year 10 English", "Tuesday Coaching Group", "Advanced Maths – Block B". Respond ONLY with JSON: { "names": ["...", "...", "..."] }`,
          },
          { role: "user", content: context },
        ],
        temperature: 0.5,
        maxTokens: 120,
        timeoutMs,
      },
      { sourceOp: "classroom:suggest-name" }
    );

    let names: string[] = [];
    try {
      const cleaned = response.content.replace(/```json?\n?|\n?```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      names = Array.isArray(parsed.names)
        ? parsed.names.filter((n: unknown) => typeof n === "string").slice(0, 4)
        : [];
    } catch {
      const matches = response.content.match(/"([^"]{3,50})"/g);
      names = matches ? matches.map((m) => m.replace(/"/g, "")).slice(0, 4) : [];
    }

    return NextResponse.json({ ok: true, names });
  } catch (err: any) {
    console.warn("[classroom/suggest-name] AI call failed:", err.message);
    return NextResponse.json({ ok: true, names: [] });
  }
}
