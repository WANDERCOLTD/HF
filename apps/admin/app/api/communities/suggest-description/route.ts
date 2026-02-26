import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import { getSuggestSettings } from "@/lib/system-settings";

/**
 * @api POST /api/communities/suggest-description
 * @visibility internal
 * @scope communities:write
 * @auth session
 * @tags communities
 * @description AI drafts a one-sentence description for a new community hub from its name
 * @body hubName string - Community hub name
 * @body communityKind string? - "TOPIC_BASED" | "OPEN_CONNECTION" for context
 * @response 200 { ok: true, description: string }
 * @response 400 { ok: false, error: "hubName must be at least 3 characters" }
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const body = await req.json().catch(() => ({}));
  const hubName = (body.hubName ?? "").trim();
  const communityKind = (body.communityKind ?? "").trim();

  if (hubName.length < 3) {
    return NextResponse.json({ ok: false, error: "hubName must be at least 3 characters" }, { status: 400 });
  }

  const { timeoutMs, maxInputLength } = await getSuggestSettings();
  const truncated = hubName.slice(0, maxInputLength);

  const kindHint =
    communityKind === "TOPIC_BASED"
      ? "This is a topic-based community where members discuss specific subjects."
      : communityKind === "OPEN_CONNECTION"
        ? "This is an open connection community for companionship and social support."
        : "";

  try {
    const response = await getConfiguredMeteredAICompletion(
      {
        callPoint: "community.suggest-description",
        messages: [
          {
            role: "system",
            content: `You are helping set up a community hub. Write ONE short, friendly, concrete sentence describing what this community is for. ${kindHint} Use plain language. Do not use quotes. Do not start with "This community". Respond with only the sentence.`,
          },
          { role: "user", content: truncated },
        ],
        temperature: 0.4,
        maxTokens: 80,
        timeoutMs,
      },
      { sourceOp: "community:suggest-description" }
    );

    const description = response.content.trim().replace(/^["']|["']$/g, "");
    return NextResponse.json({ ok: true, description });
  } catch (err: any) {
    console.warn("[suggest-description] AI call failed:", err.message);
    return NextResponse.json({ ok: true, description: "" }); // graceful fail — chip just won't appear
  }
}
