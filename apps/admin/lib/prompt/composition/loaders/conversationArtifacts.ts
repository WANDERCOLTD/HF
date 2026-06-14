/**
 * conversationArtifacts loader (#1642 — Epic #1606 Group A.5).
 *
 * Surfaces quote-worthy lines + artifacts the AI already extracted from the
 * caller's most-recent prior call so the next call's composed prompt can
 * reference them ("From last call you shared: <title>").
 *
 * **No new AI call at compose time.** `lib/artifacts/extract-artifacts.ts`
 * runs inside the pipeline EXTRACT stage and writes `ConversationArtifact`
 * rows. This loader just reads what's already there.
 *
 * Filter contract (BA decision, baked in #1642 body):
 *  - `status IN ('DELIVERED', 'READ')` — PENDING / SENT / FAILED excluded.
 *  - Scope: most-recent prior call only (not the current call we're
 *    composing for).
 *
 * Staleness contract (BA decision, baked in #1642 body): this is a
 * caller-scoped section. It is NOT registered in `PlaybookSectionStaleness`.
 * `bumpCallerComposeTimestamp` (`lib/compose/bump-timestamp.ts`) acts as
 * the staleness proxy via end-of-call.
 */

import type { PrismaClient } from "@prisma/client";

export interface ConversationArtifactSummary {
  id: string;
  type: string;
  title: string;
  /** Truncated to keep prompt budget tight; full content lives in the renderer */
  snippet: string;
  confidence: number;
  deliveredAt: string | null;
}

export interface ConversationArtifactsData {
  hasArtifacts: boolean;
  lastCallId: string | null;
  lastCallAt: string | null;
  artifacts: ConversationArtifactSummary[];
}

export interface LoadConversationArtifactsOptions {
  callerId: string;
  /** Current call id — excluded from the prior-call lookup so we never self-reference */
  currentCallId?: string | null;
}

export const EMPTY_CONVERSATION_ARTIFACTS: ConversationArtifactsData = {
  hasArtifacts: false,
  lastCallId: null,
  lastCallAt: null,
  artifacts: [],
};

const SNIPPET_MAX_CHARS = 200;
const ARTIFACT_LIMIT = 6;

type PrismaForLoader = Pick<PrismaClient, "call" | "conversationArtifact">;

export async function loadConversationArtifacts(
  prisma: PrismaForLoader,
  opts: LoadConversationArtifactsOptions,
): Promise<ConversationArtifactsData> {
  const { callerId, currentCallId } = opts;
  if (!callerId) return EMPTY_CONVERSATION_ARTIFACTS;

  const priorCall = await prisma.call.findFirst({
    where: {
      callerId,
      endedAt: { not: null },
      ...(currentCallId ? { id: { not: currentCallId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true },
  });

  if (!priorCall) return EMPTY_CONVERSATION_ARTIFACTS;

  const artifactRows = await prisma.conversationArtifact.findMany({
    where: {
      callId: priorCall.id,
      status: { in: ["DELIVERED", "READ"] },
    },
    orderBy: [{ deliveredAt: "desc" }, { createdAt: "desc" }],
    take: ARTIFACT_LIMIT,
    select: {
      id: true,
      type: true,
      title: true,
      content: true,
      confidence: true,
      deliveredAt: true,
    },
  });

  if (artifactRows.length === 0) {
    return {
      hasArtifacts: false,
      lastCallId: priorCall.id,
      lastCallAt: priorCall.createdAt.toISOString(),
      artifacts: [],
    };
  }

  return {
    hasArtifacts: true,
    lastCallId: priorCall.id,
    lastCallAt: priorCall.createdAt.toISOString(),
    artifacts: artifactRows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      snippet: truncate(row.content, SNIPPET_MAX_CHARS),
      confidence: row.confidence,
      deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
    })),
  };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}
