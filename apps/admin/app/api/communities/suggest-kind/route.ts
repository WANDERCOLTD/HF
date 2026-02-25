import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import { getSuggestSettings } from "@/lib/system-settings";

/**
 * @api POST /api/communities/suggest-kind
 * @visibility internal
 * @scope communities:write
 * @auth session
 * @tags communities
 * @description AI suggests whether a community is topic-based or open-connection from its description
 * @body description string - Community description/purpose
 * @response 200 { ok: true, kind: "TOPIC_BASED" | "OPEN_CONNECTION", confidence: number }
 * @response 400 { ok: false, error: "description is required" }
 * @response 500 { ok: false, error: "..." }
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const body = await req.json().catch(() => ({}));
  const description = (body.description ?? "").trim();

  if (!description) {
    return NextResponse.json({ ok: false, error: "description is required" }, { status: 400 });
  }

  const { timeoutMs, maxInputLength } = await getSuggestSettings();
  const truncated = description.slice(0, maxInputLength);

  try {
    const response = await getConfiguredMeteredAICompletion(
      {
        callPoint: "community.suggest-kind",
        messages: [
          {
            role: "system",
            content: `You are helping set up an AI community hub. Based on a community description, decide if it is topic-based or open-connection.

TOPIC_BASED: Members call to discuss specific subjects (e.g., building maintenance, cooking classes, study groups, specific service queries).
OPEN_CONNECTION: Members call to talk freely — wellbeing support, companion calls, peer support, social connection, mental health.

Respond ONLY with JSON: { "kind": "TOPIC_BASED" | "OPEN_CONNECTION", "confidence": 0.0-1.0 }`,
          },
          { role: "user", content: truncated },
        ],
        temperature: 0.1,
        maxTokens: 60,
        timeoutMs,
      },
      { sourceOp: "community:suggest-kind" }
    );

    let parsed: { kind: string; confidence: number };
    try {
      const cleaned = response.content.replace(/```json?\n?|\n?```/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      const match = response.content.match(/"kind"\s*:\s*"([^"]+)"/);
      parsed = { kind: match?.[1] ?? "OPEN_CONNECTION", confidence: 0.5 };
    }

    const kind = parsed.kind === "TOPIC_BASED" ? "TOPIC_BASED" : "OPEN_CONNECTION";

    return NextResponse.json({
      ok: true,
      kind,
      confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.7)),
    });
  } catch (err: any) {
    console.warn("[suggest-kind] AI call failed:", err.message);
    return NextResponse.json({ ok: false, error: "AI suggestion failed" }, { status: 500 });
  }
}
