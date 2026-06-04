import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { retrieveKnowledgeForPrompt } from "@/lib/knowledge/retriever";
import { getVoiceProvider } from "@/lib/voice/provider-factory";
import { embedText } from "@/lib/embeddings";
import { getKnowledgeRetrievalSettings } from "@/lib/system-settings";
import { getTeachingSourceIdsForDomain, getTeachingSourceIdsForPlaybook } from "@/lib/knowledge/domain-sources";
import { resolvePlaybookId } from "@/lib/enrollment/resolve-playbook";
import {
  searchAssertionsHybrid,
  searchAssertions,
  searchCallerMemories,
  searchQuestions,
  searchVocabulary,
  formatAssertion,
  formatQuestion,
  formatVocabulary,
} from "@/lib/knowledge/assertions";

export const runtime = "nodejs";

/**
 * @api POST /api/vapi/knowledge
 * @visibility public
 * @scope vapi:knowledge
 * @auth webhook-secret
 * @tags vapi, knowledge, rag
 * @description VAPI Custom Knowledge Base endpoint. Called every conversation turn.
 *   Receives conversation history, returns relevant teaching assertions,
 *   knowledge chunks, and caller memories.
 *
 *   Uses hybrid search: pgvector cosine similarity + keyword fallback.
 *   Target: <50ms response time.
 *
 *   VAPI Custom KB format:
 *   - Request: { type: "knowledge-base-request", messages: [...] }
 *   - Response: { results: [{ content, similarity }] } or { message: { content } }
 *
 *   Ref: https://docs.vapi.ai/knowledge-base/custom-knowledge-base
 */
export async function POST(request: NextRequest) {
  const startMs = Date.now();

  try {
    const rawBody = await request.text();
    const provider = await getVoiceProvider("vapi");
    const authError = provider.verifyInboundRequest(request, rawBody);
    if (authError) return authError;

    const body = JSON.parse(rawBody);
    const messages = body.message?.messages || body.messages || [];
    const callId = body.message?.call?.id || body.call?.id;
    const customerPhone =
      body.message?.call?.customer?.number ||
      body.call?.customer?.number;

    // Load retrieval settings (30s cache)
    const ks = await getKnowledgeRetrievalSettings();

    // Extract last N user messages as query context
    const userMessages = messages
      .filter((m: any) => m.role === "user" && m.content)
      .slice(-ks.queryMessageCount);

    const queryText = userMessages.map((m: any) => m.content).join(" ");

    if (!queryText) {
      return NextResponse.json(provider.buildKnowledgeResponse([]));
    }

    // Find caller for personalized retrieval + course-scoped content
    let callerId: string | null = null;
    let sourceIds: string[] | undefined;
    if (customerPhone) {
      const caller = await prisma.caller.findFirst({
        where: { phone: customerPhone.replace(/\s+/g, "") },
        select: { id: true, domainId: true },
      });
      callerId = caller?.id || null;

      if (callerId) {
        // Resolve active playbook for course-scoped content retrieval
        const playbookId = await resolvePlaybookId(callerId);
        if (playbookId) {
          sourceIds = await getTeachingSourceIdsForPlaybook(playbookId);
        } else if (caller?.domainId) {
          // No single playbook resolved — fall back to domain-wide
          sourceIds = await getTeachingSourceIdsForDomain(caller.domainId);
        }
      }
    }

    // Embed query text for vector search (runs in parallel with DB lookups below)
    let queryEmbedding: number[] | undefined;
    try {
      queryEmbedding = await embedText(queryText);
    } catch (err) {
      console.warn("[vapi/knowledge] Embedding failed, falling back to keyword search:", err);
    }

    // Run retrieval strategies in parallel — scoped to caller's course (or domain fallback)
    const [knowledgeResults, assertionResults, memoryResults, questionResults, vocabularyResults] = await Promise.all([
      // 1. Knowledge chunks (vector + keyword hybrid)
      // NOTE: KnowledgeChunk has no domain FK — stays unscoped until schema migration
      retrieveKnowledgeForPrompt({
        queryText,
        queryEmbedding,
        callerId: callerId || undefined,
        limit: ks.chunkLimit,
        minRelevance: ks.minRelevance,
      }),

      // 2. Teaching assertions (vector + tag/keyword hybrid) — course-scoped
      queryEmbedding
        ? searchAssertionsHybrid(queryText, queryEmbedding, ks.assertionLimit, ks.minRelevance, sourceIds)
        : searchAssertions(queryText, ks.assertionLimit, sourceIds),

      // 3. Caller memories relevant to current topic (already caller-scoped)
      callerId ? searchCallerMemories(callerId, queryText, ks.memoryLimit) : Promise.resolve([]),

      // 4. Questions (for practice/assessment) — course-scoped
      searchQuestions(queryText, 5, sourceIds),

      // 5. Vocabulary (for term definitions) — course-scoped
      searchVocabulary(queryText, 5, sourceIds),
    ]);

    // Merge and rank results
    const results: Array<{ content: string; similarity: number }> = [];

    // Add teaching assertions (highest value for tutoring)
    for (const a of assertionResults) {
      results.push({
        content: formatAssertion(a),
        similarity: a.relevanceScore,
      });
    }

    // Add knowledge chunks
    for (const k of knowledgeResults) {
      results.push({
        content: k.title ? `[${k.title}] ${k.content}` : k.content,
        similarity: k.relevanceScore,
      });
    }

    // Add caller memories
    for (const m of memoryResults) {
      results.push({
        content: `[Caller Memory] ${m.key}: ${m.value}`,
        similarity: m.relevanceScore,
      });
    }

    // Add questions (slightly lower base relevance — used when topic matches)
    for (const q of questionResults) {
      results.push({
        content: formatQuestion(q),
        similarity: q.relevanceScore * 0.9,
      });
    }

    // Add vocabulary (slightly lower base relevance)
    for (const v of vocabularyResults) {
      results.push({
        content: formatVocabulary(v),
        similarity: v.relevanceScore * 0.85,
      });
    }

    // Sort by similarity, take top N
    results.sort((a, b) => b.similarity - a.similarity);
    const topResults = results.slice(0, ks.topResults);

    const elapsed = Date.now() - startMs;
    console.log(
      `[vapi/knowledge] ${topResults.length} results in ${elapsed}ms ` +
        `(assertions: ${assertionResults.length}, chunks: ${knowledgeResults.length}, memories: ${memoryResults.length}, questions: ${questionResults.length}, vocab: ${vocabularyResults.length}, vector: ${!!queryEmbedding})`,
    );

    return NextResponse.json(provider.buildKnowledgeResponse(topResults));
  } catch (error: any) {
    console.error("[vapi/knowledge] Error:", error);
    // Return empty results on error — don't break the call.
    // Use a fresh provider lookup since the outer try-block may have failed
    // before `provider` was assigned (very unlikely but defensive).
    return NextResponse.json((await getVoiceProvider("vapi")).buildKnowledgeResponse([]));
  }
}
