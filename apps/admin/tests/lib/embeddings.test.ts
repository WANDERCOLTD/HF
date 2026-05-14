/**
 * Tests for lib/embeddings/index.ts — shared embedding utilities
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock fetch (OpenAI API) ──────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Mock metering ────────────────────────────────────
vi.mock("@/lib/metering", () => ({
  logExternalAPIUsage: vi.fn().mockResolvedValue(null),
}));

// ── Mock @prisma/client (for Prisma.sql tagged template) ──
vi.mock("@prisma/client", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual };
});

// ── Mock prisma ──────────────────────────────────────
const mockQueryRaw = vi.fn();
const mockExecuteRaw = vi.fn();
const mockFindUnique = vi.fn();
const mockCreate = vi.fn();
const mockCount = vi.fn();

vi.mock("@/lib/prisma", () => {
  const _p = {
  prisma: {
    $queryRaw: (...args: any[]) => mockQueryRaw(...args),
    $executeRaw: (...args: any[]) => mockExecuteRaw(...args),
    contentAssertion: {
      count: (...args: any[]) => mockCount(...args),
    },
    vectorEmbedding: {
      findUnique: (...args: any[]) => mockFindUnique(...args),
      create: (...args: any[]) => mockCreate(...args),
    },
    knowledgeChunk: {
      count: (...args: any[]) => mockCount(...args),
    },
  },
};
  return { ..._p, db: (tx?: unknown) => tx ?? _p.prisma };
});

import {
  openAiEmbed,
  embedText,
  embedTexts,
  toVectorLiteral,
  embedAssertionsForSource,
  embedChunksForDoc,
} from "@/lib/embeddings";

function mockEmbeddingResponse(embeddings: number[][]) {
  return {
    ok: true,
    json: () => Promise.resolve({
      data: embeddings.map((e, i) => ({ embedding: e, index: i })),
    }),
    text: () => Promise.resolve(""),
  };
}

describe("embeddings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
  });

  describe("openAiEmbed", () => {
    it("calls OpenAI API with correct parameters", async () => {
      const emb = [[0.1, 0.2, 0.3]];
      mockFetch.mockResolvedValue(mockEmbeddingResponse(emb));

      const result = await openAiEmbed(["hello world"]);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.openai.com/v1/embeddings",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            authorization: "Bearer test-key",
          }),
        }),
      );
      expect(result).toEqual(emb);
    });

    it("throws when OPENAI_API_KEY is not set", async () => {
      delete process.env.OPENAI_API_KEY;
      await expect(openAiEmbed(["test"])).rejects.toThrow("OPENAI_API_KEY is not set");
    });

    it("throws on API error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve("rate limited"),
      });

      await expect(openAiEmbed(["test"])).rejects.toThrow("OpenAI embeddings failed: 429");
    });

    it("throws if any input is an empty string (does not call API)", async () => {
      await expect(openAiEmbed(["valid", "", "also valid"])).rejects.toThrow(
        /input\[1\] is empty\/whitespace/,
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("throws if any input is whitespace-only (does not call API)", async () => {
      await expect(openAiEmbed(["valid", "   \n\t  "])).rejects.toThrow(
        /input\[1\] is empty\/whitespace/,
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("handles multiple texts", async () => {
      const embs = [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]];
      mockFetch.mockResolvedValue(mockEmbeddingResponse(embs));

      const result = await openAiEmbed(["a", "b", "c"]);
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual([0.1, 0.2]);
    });
  });

  describe("embedText", () => {
    it("returns single embedding", async () => {
      mockFetch.mockResolvedValue(mockEmbeddingResponse([[0.1, 0.2, 0.3]]));
      const result = await embedText("hello");
      expect(result).toEqual([0.1, 0.2, 0.3]);
    });

    it("throws if no embedding returned", async () => {
      mockFetch.mockResolvedValue(mockEmbeddingResponse([]));
      await expect(embedText("test")).rejects.toThrow(/no data|No embedding returned/);
    });
  });

  describe("embedTexts", () => {
    it("processes texts in batches", async () => {
      // First batch
      mockFetch.mockResolvedValueOnce(mockEmbeddingResponse([[0.1], [0.2]]));
      // Second batch
      mockFetch.mockResolvedValueOnce(mockEmbeddingResponse([[0.3]]));

      const result = await embedTexts(["a", "b", "c"], 2);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual([[0.1], [0.2], [0.3]]);
    });

    it("handles single batch", async () => {
      mockFetch.mockResolvedValue(mockEmbeddingResponse([[0.1], [0.2]]));
      const result = await embedTexts(["a", "b"]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(2);
    });
  });

  describe("toVectorLiteral", () => {
    it("formats embedding as pgvector literal", () => {
      expect(toVectorLiteral([0.1, 0.2, 0.3])).toBe("[0.1,0.2,0.3]");
    });

    it("handles empty array", () => {
      expect(toVectorLiteral([])).toBe("[]");
    });
  });

  describe("embedAssertionsForSource", () => {
    it("returns early when no un-embedded assertions", async () => {
      mockQueryRaw.mockResolvedValueOnce([]);

      const result = await embedAssertionsForSource("source-1");
      expect(result).toEqual({ embedded: 0, skipped: 0 });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("embeds assertions and stores via raw SQL", async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { id: "a1", assertion: "Test assertion 1" },
        { id: "a2", assertion: "Test assertion 2" },
      ]);
      mockFetch.mockResolvedValue(mockEmbeddingResponse([[0.1, 0.2], [0.3, 0.4]]));
      mockExecuteRaw.mockResolvedValue(undefined);

      const result = await embedAssertionsForSource("source-1");

      expect(result.embedded).toBe(2);
      expect(mockExecuteRaw).toHaveBeenCalledTimes(2);
    });

    it("filters empty/whitespace assertions and preserves index alignment", async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { id: "a1", assertion: "Valid one" },
        { id: "a2", assertion: "" },
        { id: "a3", assertion: "Valid two" },
        { id: "a4", assertion: "   \n  " },
      ]);
      // After filter, only 2 texts go to the API
      mockFetch.mockResolvedValue(mockEmbeddingResponse([[0.1, 0.2], [0.3, 0.4]]));
      mockExecuteRaw.mockResolvedValue(undefined);

      const result = await embedAssertionsForSource("source-1");

      expect(result.embedded).toBe(2);
      // skipped accounts for 2 empty rows
      expect(result.skipped).toBe(2);
      // API called once with only the non-empty texts
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.input).toEqual(["Valid one", "Valid two"]);
      // Writes go to the non-empty row IDs (a1, a3), not a2 or a4
      expect(mockExecuteRaw).toHaveBeenCalledTimes(2);
    });

    it("returns skipped count and does not call API when all assertions empty", async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { id: "a1", assertion: "" },
        { id: "a2", assertion: "   " },
      ]);

      const result = await embedAssertionsForSource("source-1");

      expect(result).toEqual({ embedded: 0, skipped: 2 });
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockExecuteRaw).not.toHaveBeenCalled();
    });
  });

  describe("embedChunksForDoc", () => {
    it("returns early when no un-embedded chunks", async () => {
      mockQueryRaw.mockResolvedValueOnce([]);

      const result = await embedChunksForDoc("doc-1");
      expect(result).toEqual({ embedded: 0, skipped: 0 });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("creates VectorEmbedding records for new chunks", async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { id: "c1", content: "Chunk content 1" },
      ]);
      mockFetch.mockResolvedValue(mockEmbeddingResponse([[0.1, 0.2]]));
      mockFindUnique.mockResolvedValue(null); // No existing VectorEmbedding
      mockCreate.mockResolvedValue({ id: "ve-1" });
      mockExecuteRaw.mockResolvedValue(undefined);

      const result = await embedChunksForDoc("doc-1");

      expect(result.embedded).toBe(1);
      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          chunkId: "c1",
          model: "text-embedding-3-small",
        }),
      });
    });

    it("updates existing VectorEmbedding records", async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { id: "c1", content: "Chunk content 1" },
      ]);
      mockFetch.mockResolvedValue(mockEmbeddingResponse([[0.1, 0.2]]));
      mockFindUnique.mockResolvedValue({ id: "ve-1", chunkId: "c1" }); // Existing record
      mockExecuteRaw.mockResolvedValue(undefined);

      const result = await embedChunksForDoc("doc-1");

      expect(result.embedded).toBe(1);
      expect(mockCreate).not.toHaveBeenCalled(); // Shouldn't create new
      expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    });

    it("filters empty/whitespace chunks before calling API", async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { id: "c1", content: "Real content" },
        { id: "c2", content: "" },
        { id: "c3", content: "  \t\n  " },
      ]);
      mockFetch.mockResolvedValue(mockEmbeddingResponse([[0.1, 0.2]]));
      mockFindUnique.mockResolvedValue(null);
      mockCreate.mockResolvedValue({ id: "ve-1" });
      mockExecuteRaw.mockResolvedValue(undefined);

      const result = await embedChunksForDoc("doc-1");

      expect(result.embedded).toBe(1);
      expect(result.skipped).toBe(2);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.input).toEqual(["Real content"]);
      // Only the non-empty chunk gets a VectorEmbedding row
      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ chunkId: "c1" }),
      });
    });
  });
});
