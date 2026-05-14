/**
 * Tests for app/api/vapi/knowledge/route.ts — VAPI knowledge retrieval
 *
 * Tests hybrid search (vector + keyword), assertion retrieval,
 * and the merge/deduplication logic.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

// ── Mock VAPI auth ─────────────────────────────────
vi.mock("@/lib/vapi/auth", () => ({
  verifyVapiRequest: vi.fn().mockReturnValue(null), // Auth passes
}));

// ── Mock @prisma/client (for Prisma.sql) ───────────
vi.mock("@prisma/client", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual };
});

// ── Mock embeddings ────────────────────────────────
const mockEmbedText = vi.fn();
vi.mock("@/lib/embeddings", () => ({
  embedText: (...args: any[]) => mockEmbedText(...args),
  toVectorLiteral: (emb: number[]) => `[${emb.join(",")}]`,
}));

// ── Mock prisma ────────────────────────────────────
const mockFindFirst = vi.fn();
const mockFindMany = vi.fn();
const mockQueryRaw = vi.fn();
const mockMemoryFindMany = vi.fn().mockResolvedValue([]);

vi.mock("@/lib/prisma", () => {
  const _p = {
  prisma: {
    caller: { findFirst: (...args: any[]) => mockFindFirst(...args) },
    contentAssertion: { findMany: (...args: any[]) => mockFindMany(...args) },
    callerMemory: { findMany: (...args: any[]) => mockMemoryFindMany(...args) },
    $queryRaw: (...args: any[]) => mockQueryRaw(...args),
  },
};
  return { ..._p, db: (tx?: unknown) => tx ?? _p.prisma };
});

// ── Mock retriever ─────────────────────────────────
const mockRetrieve = vi.fn();
vi.mock("@/lib/knowledge/retriever", () => ({
  retrieveKnowledgeForPrompt: (...args: any[]) => mockRetrieve(...args),
}));

// ── Mock assertion search functions ─────────────────
const mockSearchAssertionsHybrid = vi.fn();
const mockSearchAssertions = vi.fn();
const mockSearchCallerMemories = vi.fn();
const mockSearchQuestions = vi.fn();
const mockSearchVocabulary = vi.fn();
vi.mock("@/lib/knowledge/assertions", () => ({
  searchAssertionsHybrid: (...args: any[]) => mockSearchAssertionsHybrid(...args),
  searchAssertions: (...args: any[]) => mockSearchAssertions(...args),
  searchCallerMemories: (...args: any[]) => mockSearchCallerMemories(...args),
  searchQuestions: (...args: any[]) => mockSearchQuestions(...args),
  searchVocabulary: (...args: any[]) => mockSearchVocabulary(...args),
  formatAssertion: (a: any) => `[${a.category}] ${a.assertion}`,
  formatQuestion: (q: any) => `[QUESTION] ${q.questionText}`,
  formatVocabulary: (v: any) => `[VOCAB] ${v.term}: ${v.definition}`,
}));

// ── Mock system settings ─────────────────────────────
vi.mock("@/lib/system-settings", () => ({
  getKnowledgeRetrievalSettings: vi.fn().mockResolvedValue({
    queryMessageCount: 3,
    topResults: 10,
    chunkLimit: 5,
    assertionLimit: 5,
    memoryLimit: 3,
    minRelevance: 0.3,
  }),
}));

// ── Mock resolvePlaybookId ───────────────────────────
vi.mock("@/lib/enrollment/resolve-playbook", () => ({
  resolvePlaybookId: vi.fn().mockResolvedValue(null),
}));

// ── Mock domain-sources ──────────────────────────────
vi.mock("@/lib/knowledge/domain-sources", () => ({
  getTeachingSourceIdsForDomain: vi.fn().mockResolvedValue([]),
  getTeachingSourceIdsForPlaybook: vi.fn().mockResolvedValue([]),
}));

import { POST } from "@/app/api/vapi/knowledge/route";

function makeRequest(messages: Array<{ role: string; content: string }>) {
  const body = JSON.stringify({
    message: {
      messages,
      call: { id: "call-1", customer: { number: "+447700000000" } },
    },
  });

  return new NextRequest("http://localhost:3000/api/vapi/knowledge", {
    method: "POST",
    body,
    headers: { "content-type": "application/json" },
  });
}

describe("VAPI knowledge endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindFirst.mockResolvedValue({ id: "caller-1", domainId: "dom-1" });
    mockRetrieve.mockResolvedValue([]);
    mockFindMany.mockResolvedValue([]);
    mockQueryRaw.mockResolvedValue([]);
    mockMemoryFindMany.mockResolvedValue([]);
    mockSearchAssertionsHybrid.mockResolvedValue([]);
    mockSearchAssertions.mockResolvedValue([]);
    mockSearchCallerMemories.mockResolvedValue([]);
    mockSearchQuestions.mockResolvedValue([]);
    mockSearchVocabulary.mockResolvedValue([]);
  });

  it("returns empty results for no user messages", async () => {
    const req = makeRequest([{ role: "assistant", content: "Hello" }]);
    const res = await POST(req);
    const data = await res.json();

    expect(data.results).toEqual([]);
  });

  it("embeds query text and passes to retriever", async () => {
    const embedding = [0.1, 0.2, 0.3];
    mockEmbedText.mockResolvedValue(embedding);
    mockRetrieve.mockResolvedValue([]);

    const req = makeRequest([{ role: "user", content: "What is an ISA?" }]);
    await POST(req);

    expect(mockEmbedText).toHaveBeenCalledWith("What is an ISA?");
    expect(mockRetrieve).toHaveBeenCalledWith(
      expect.objectContaining({
        queryEmbedding: embedding,
        queryText: "What is an ISA?",
      }),
    );
  });

  it("falls back to keyword-only when embedding fails", async () => {
    mockEmbedText.mockRejectedValue(new Error("API key missing"));
    mockRetrieve.mockResolvedValue([]);
    mockFindMany.mockResolvedValue([]);

    const req = makeRequest([{ role: "user", content: "tax rules" }]);
    const res = await POST(req);
    const data = await res.json();

    // Should not throw — returns results
    expect(data.results).toBeDefined();
    // Retriever called without embedding
    expect(mockRetrieve).toHaveBeenCalledWith(
      expect.objectContaining({
        queryEmbedding: undefined,
      }),
    );
  });

  it("merges and sorts results by similarity", async () => {
    mockEmbedText.mockResolvedValue([0.1]);

    // Hybrid assertion results (from searchAssertionsHybrid)
    mockSearchAssertionsHybrid.mockResolvedValue([
      {
        assertion: "ISA limit is £20,000",
        category: "fact",
        chapter: "Ch 3",
        tags: ["isa"],
        trustLevel: "L3",
        examRelevance: 0.9,
        sourceName: "CII R04",
        relevanceScore: 0.95,
      },
      {
        assertion: "ISA is tax-free",
        category: "fact",
        chapter: null,
        tags: ["isa", "tax"],
        trustLevel: "L2",
        examRelevance: 0.7,
        sourceName: "CII R04",
        relevanceScore: 0.7,
      },
    ]);

    // Knowledge chunks
    mockRetrieve.mockResolvedValue([
      {
        id: "chunk-1",
        title: "ISA Guide",
        content: "ISA details...",
        relevanceScore: 0.8,
        sourcePath: "/docs/isa.md",
        chunkIndex: 0,
      },
    ]);

    // Questions and vocabulary
    mockSearchQuestions.mockResolvedValue([]);
    mockSearchVocabulary.mockResolvedValue([]);

    const req = makeRequest([{ role: "user", content: "What is an ISA allowance?" }]);
    const res = await POST(req);
    const data = await res.json();

    expect(data.results.length).toBeGreaterThan(0);
    // Results should be sorted by similarity (descending)
    for (let i = 1; i < data.results.length; i++) {
      expect(data.results[i - 1].similarity).toBeGreaterThanOrEqual(data.results[i].similarity);
    }
  });

  it("limits results to top 10", async () => {
    mockEmbedText.mockResolvedValue([0.1]);

    // Return many assertion results
    const manyResults = Array.from({ length: 15 }, (_, i) => ({
      assertion: `Assertion ${i}`,
      category: "fact",
      chapter: null,
      tags: [],
      depth: null,
      examRelevance: 0.5,
      trustLevel: null,
      source: { name: "Test", trustLevel: null },
    }));
    mockFindMany.mockResolvedValue(manyResults);
    mockQueryRaw.mockResolvedValue([]);
    mockRetrieve.mockResolvedValue([]);

    const req = makeRequest([{ role: "user", content: "lots of content" }]);
    const res = await POST(req);
    const data = await res.json();

    expect(data.results.length).toBeLessThanOrEqual(10);
  });

  it("uses last 3 user messages as query context", async () => {
    mockEmbedText.mockResolvedValue([0.1]);
    mockRetrieve.mockResolvedValue([]);

    const req = makeRequest([
      { role: "user", content: "first" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "second" },
      { role: "assistant", content: "right" },
      { role: "user", content: "third" },
      { role: "assistant", content: "sure" },
      { role: "user", content: "fourth" },
    ]);
    await POST(req);

    // Should use last 3 user messages joined
    expect(mockEmbedText).toHaveBeenCalledWith("second third fourth");
  });

  it("returns empty results on error without throwing", async () => {
    mockEmbedText.mockRejectedValue(new Error("boom"));
    mockRetrieve.mockRejectedValue(new Error("db down"));

    const req = makeRequest([{ role: "user", content: "test" }]);
    const res = await POST(req);
    const data = await res.json();

    expect(data.results).toEqual([]);
  });
});
