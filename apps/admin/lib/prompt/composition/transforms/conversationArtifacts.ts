/**
 * conversationArtifacts transform (#1642 — Epic #1606 Group A.5).
 *
 * Pure shape mapper. The loader already filtered + truncated; this just
 * shapes the payload the renderer + the LLM prompt section consume.
 *
 * Returns `null` when there are no delivered artifacts so the section's
 * `fallback: "omit"` drops it from the emitted prompt entirely (Call 1
 * path + no-DELIVERED-artifacts path collapse to the same empty state).
 */

import { registerTransform } from "../TransformRegistry";
import type { ConversationArtifactsData } from "../loaders/conversationArtifacts";

export interface ConversationArtifactsSection {
  hasArtifacts: true;
  lastCallId: string;
  lastCallAt: string;
  totalCount: number;
  byType: Record<string, number>;
  artifacts: Array<{
    id: string;
    type: string;
    title: string;
    snippet: string;
    confidence: number;
    deliveredAt: string | null;
  }>;
  summary: string;
}

registerTransform("renderConversationArtifacts", (rawData: ConversationArtifactsData) => {
  if (!rawData || !rawData.hasArtifacts || rawData.artifacts.length === 0) {
    return null;
  }

  const byType = rawData.artifacts.reduce<Record<string, number>>((acc, a) => {
    acc[a.type] = (acc[a.type] ?? 0) + 1;
    return acc;
  }, {});

  const totalCount = rawData.artifacts.length;
  const typeBreakdown = Object.entries(byType)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, n]) => `${n} ${type}`)
    .join(", ");

  const summary = `From your last call: ${totalCount} item${totalCount === 1 ? "" : "s"} shared (${typeBreakdown}).`;

  const section: ConversationArtifactsSection = {
    hasArtifacts: true,
    lastCallId: rawData.lastCallId!,
    lastCallAt: rawData.lastCallAt!,
    totalCount,
    byType,
    artifacts: rawData.artifacts.map((a) => ({
      id: a.id,
      type: a.type,
      title: a.title,
      snippet: a.snippet,
      confidence: a.confidence,
      deliveredAt: a.deliveredAt,
    })),
    summary,
  };
  return section;
});
