import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import { getSuggestSettings } from "@/lib/system-settings";
import {
  INTERACTION_PATTERN_ORDER,
  type InteractionPattern,
} from "@/lib/content-trust/resolve-config";

/**
 * @api POST /api/communities/suggest-pattern
 * @visibility internal
 * @scope communities:write
 * @auth session
 * @tags communities
 * @description AI suggests an interaction pattern from a hub or topic description
 * @body text string - Hub or topic description to analyse
 * @body context string - "hub" or "topic" (affects prompt framing)
 * @response 200 { ok: true, pattern: InteractionPattern, confidence: number }
 * @response 400 { ok: false, error: "text is required" }
 * @response 500 { ok: false, error: "..." }
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const body = await req.json().catch(() => ({}));
  const text = (body.text ?? "").trim();
  const context: "hub" | "topic" = body.context === "hub" ? "hub" : "topic";

  if (!text) {
    return NextResponse.json({ ok: false, error: "text is required" }, { status: 400 });
  }

  const { timeoutMs, maxInputLength } = await getSuggestSettings();
  const truncated = text.slice(0, maxInputLength);

  const patternList = INTERACTION_PATTERN_ORDER
    .map((p) => {
      const LABELS: Record<InteractionPattern, string> = {
        socratic:    "socratic — guide their thinking via questions",
        directive:   "directive — explain and check understanding",
        advisory:    "advisory — give clear answers from knowledge",
        coaching:    "coaching — set goals and drive accountability",
        companion:   "companion — listen, empathise, just be there",
        facilitation:"facilitation — help organise and coordinate",
        reflective:  "reflective — explore experiences, find meaning",
        open:        "open — follow wherever the caller leads",
        "conversational-guide": "conversational-guide — guided 1:1 topic conversations",
      };
      return `- ${LABELS[p]}`;
    })
    .join("\n");

  const systemPrompt = context === "hub"
    ? `You are helping set up an AI community hub. Given a description of the community's purpose, pick the single best interaction pattern for the hub AI.`
    : `You are helping set up an AI community topic. Given a topic name, pick the single best interaction pattern for the AI when members discuss this topic.`;

  try {
    // @ai-call community.suggest-pattern — AI suggests interaction pattern from hub or topic description | config: /x/ai-config
    const response = await getConfiguredMeteredAICompletion(
      {
        callPoint: "community.suggest-pattern",
        messages: [
          { role: "system", content: `${systemPrompt}\n\nAvailable patterns:\n${patternList}\n\nRespond with ONLY a JSON object: { "pattern": "<pattern value>", "confidence": 0.0-1.0 }` },
          { role: "user", content: truncated },
        ],
        temperature: 0.2,
        maxTokens: 60,
        timeoutMs,
      },
      {
        sourceOp: "community:suggest-pattern",
        userId: auth.session.user.id,
        userName: auth.session.user.name || undefined,
        entityLabel: text.slice(0, 40),
        wizardName: "Community",
        wizardStep: "Suggest Pattern",
      }
    );

    let parsed: { pattern: string; confidence: number };
    try {
      // Strip markdown code fences if present
      const cleaned = response.content.replace(/```json?\n?|\n?```/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      // Fallback: extract pattern value from text
      const match = response.content.match(/"pattern"\s*:\s*"([^"]+)"/);
      parsed = { pattern: match?.[1] ?? "companion", confidence: 0.5 };
    }

    const pattern = (INTERACTION_PATTERN_ORDER as string[]).includes(parsed.pattern)
      ? (parsed.pattern as InteractionPattern)
      : "companion";

    return NextResponse.json({
      ok: true,
      pattern,
      confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.7)),
    });
  } catch (err: any) {
    console.warn("[suggest-pattern] AI call failed:", err.message);
    return NextResponse.json({ ok: false, error: "AI suggestion failed" }, { status: 500 });
  }
}
