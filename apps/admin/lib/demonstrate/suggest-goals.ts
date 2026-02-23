/**
 * AI Goal Suggestions for Demonstrate Flow
 *
 * Generates session goal suggestions based on domain curriculum and caller history.
 * Uses metered AI completion via the standard instrumented-ai pattern.
 *
 * callerId is optional — when absent, suggestions are domain-only (no learner context).
 */

import { prisma } from "@/lib/prisma";
import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";

interface SuggestGoalsParams {
  domainId: string;
  callerId?: string;
  currentGoal?: string;
}

export async function suggestGoals(params: SuggestGoalsParams): Promise<string[]> {
  const { domainId, callerId, currentGoal } = params;

  // Load domain + caller context in parallel (caller queries skipped when no callerId)
  const [domain, caller, recentCalls, memorySummary] = await Promise.all([
    prisma.domain.findUnique({
      where: { id: domainId },
      select: { name: true, slug: true, description: true },
    }),
    callerId
      ? prisma.caller.findUnique({
          where: { id: callerId },
          select: { name: true, email: true },
        })
      : null,
    callerId
      ? prisma.call.findMany({
          where: { callerId },
          orderBy: { createdAt: "desc" },
          take: 3,
          select: {
            id: true,
            createdAt: true,
            _count: { select: { artifacts: true } },
          },
        })
      : [],
    callerId
      ? prisma.callerMemorySummary.findFirst({
          where: { callerId },
          orderBy: { updatedAt: "desc" },
          select: { keyFacts: true, topTopics: true, factCount: true, topicCount: true },
        })
      : null,
  ]);

  if (!domain) {
    console.warn("[suggest-goals] Domain not found:", domainId);
    return [];
  }

  // Build the prompt context
  const contextParts: string[] = [
    `Domain: ${domain.name} (${domain.slug})`,
    domain.description ? `Description: ${domain.description}` : "",
  ];

  if (caller) {
    contextParts.push(`Learner: ${caller.name || caller.email || "Unknown"}`);
  } else {
    contextParts.push("No specific learner selected (generic session)");
  }

  if (memorySummary) {
    contextParts.push(`Learner has ${memorySummary.factCount} known facts and ${memorySummary.topicCount} topics`);
    if (memorySummary.keyFacts && Array.isArray(memorySummary.keyFacts)) {
      const facts = (memorySummary.keyFacts as Array<{ key?: string; value?: string }>)
        .slice(0, 3)
        .map((f) => `${f.key}: ${f.value}`)
        .join(", ");
      if (facts) contextParts.push(`Key facts: ${facts}`);
    }
    if (memorySummary.topTopics && Array.isArray(memorySummary.topTopics)) {
      const topics = (memorySummary.topTopics as Array<{ topic?: string }>)
        .slice(0, 3)
        .map((t) => t.topic)
        .filter(Boolean)
        .join(", ");
      if (topics) contextParts.push(`Top topics: ${topics}`);
    }
  }

  if (recentCalls.length > 0) {
    contextParts.push(`Recent sessions: ${recentCalls.length}`);
    const totalArtifacts = recentCalls.reduce((sum, c) => sum + c._count.artifacts, 0);
    if (totalArtifacts > 0) {
      contextParts.push(`Artifacts from recent sessions: ${totalArtifacts}`);
    }
  } else {
    contextParts.push("No previous sessions (first time)");
  }

  const context = contextParts.filter(Boolean).join("\n");

  const prompt = currentGoal
    ? `Given this context:\n${context}\n\nThe admin has started writing their goal: "${currentGoal}"\n\nSuggest 3 specific, actionable session goals that refine or build on their idea. Each should be 1 short sentence. Return ONLY a JSON array of strings, nothing else.`
    : `Given this context:\n${context}\n\nSuggest 3 specific, actionable session goals the admin could demonstrate. Consider the learner's history and domain curriculum. Each should be 1 short sentence. Return ONLY a JSON array of strings, nothing else.`;

  try {
    // @ai-call demonstrate.suggest — Suggest session goals for demonstrate flow | config: /x/ai-config
    const result = await getConfiguredMeteredAICompletion(
      {
        callPoint: "demonstrate.suggest",
        messages: [
          { role: "system", content: "You are a teaching assistant. Suggest concise session goals. Respond with ONLY a JSON array of strings." },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        maxTokens: 300,
      },
      { sourceOp: "demonstrate.suggest" },
    );

    const text = typeof result.content === "string"
      ? result.content
      : Array.isArray(result.content)
        ? (result.content as Array<{ text?: string }>).map((c) => c.text || "").join("")
        : "";

    // Extract JSON array from response
    const match = text.match(/\[[\s\S]*?\]/);
    if (match) {
      const parsed: unknown = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        const results = (parsed as unknown[]).filter((s): s is string => typeof s === "string").slice(0, 4);
        if (results.length === 0) {
          console.warn("[suggest-goals] AI returned empty array. Raw:", text.slice(0, 200));
        }
        return results;
      }
    }
    console.warn("[suggest-goals] Could not parse suggestions from AI response:", text.slice(0, 200));
  } catch (e) {
    console.warn("[suggest-goals] AI suggestion failed:", e);
  }

  return [];
}
