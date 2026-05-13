import { logExternalAPIUsage } from "@/lib/metering";
import { config } from "@/lib/config";

const DEFAULT_BATCH_SIZE = 100;

/**
 * Call OpenAI embeddings API for a batch of texts.
 * Returns one float[] per input text, in order.
 */
export async function openAiEmbed(
  texts: string[],
  model: string = config.ai.openai.embeddingModel
): Promise<number[][]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");

  // OpenAI 400s the entire batch if any element is empty/whitespace.
  // Fail loudly here — callers must filter upstream.
  const badIndex = texts.findIndex((t) => typeof t !== "string" || t.trim() === "");
  if (badIndex !== -1) {
    throw new Error(
      `openAiEmbed: input[${badIndex}] is empty/whitespace — callers must filter before calling.`,
    );
  }

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model, input: texts }),
  });

  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`OpenAI embeddings failed: ${res.status} ${msg}`);
  }

  const json = (await res.json()) as any;
  if (!Array.isArray(json?.data) || json.data.length === 0) {
    throw new Error(`OpenAI embeddings returned no data (expected ${texts.length} embeddings)`);
  }
  const data = json.data;

  await logExternalAPIUsage({
    operation: "openai-embedding",
    metadata: { model, inputCount: texts.length, dimensions: data[0]?.embedding?.length },
  });

  return data.map((d: any) => d.embedding as number[]);
}

/** Embed a single text string. Returns the embedding vector. */
export async function embedText(
  text: string,
  model: string = config.ai.openai.embeddingModel
): Promise<number[]> {
  const [embedding] = await openAiEmbed([text], model);
  if (!embedding) throw new Error("No embedding returned");
  return embedding;
}

/**
 * Embed multiple texts in batches.
 * Returns one embedding per input text, preserving order.
 */
export async function embedTexts(
  texts: string[],
  batchSize: number = DEFAULT_BATCH_SIZE,
  model: string = config.ai.openai.embeddingModel
): Promise<number[][]> {
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const embeddings = await openAiEmbed(batch, model);
    results.push(...embeddings);
  }

  return results;
}

/**
 * Format a float[] as a pgvector literal string: "[0.1,0.2,...]"
 * Used in $queryRaw to cast to vector type.
 */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/**
 * Embed all un-embedded ContentAssertions for a given source.
 * Idempotent — skips rows that already have embeddings.
 */
export async function embedAssertionsForSource(sourceId: string): Promise<{ embedded: number; skipped: number }> {
  const { prisma } = await import("@/lib/prisma");
  const { Prisma } = await import("@prisma/client");

  // Find assertions without embeddings
  const allRows = await prisma.$queryRaw<Array<{ id: string; assertion: string }>>(
    Prisma.sql`SELECT id, assertion FROM "ContentAssertion" WHERE "sourceId" = ${sourceId} AND embedding IS NULL`
  );

  if (allRows.length === 0) return { embedded: 0, skipped: 0 };

  // Filter empty/whitespace assertions — OpenAI rejects the whole batch otherwise.
  // Filter the rows array (not texts) to keep index alignment with row IDs.
  const rows = allRows.filter((r) => typeof r.assertion === "string" && r.assertion.trim() !== "");
  const skippedEmpty = allRows.length - rows.length;
  if (skippedEmpty > 0) {
    console.warn(
      `[embeddings] embedAssertionsForSource(${sourceId}): skipped ${skippedEmpty} empty/whitespace assertion(s)`,
    );
  }
  if (rows.length === 0) return { embedded: 0, skipped: skippedEmpty };

  const texts = rows.map((r) => r.assertion);
  const embeddings = await embedTexts(texts);

  let embedded = 0;
  for (let i = 0; i < rows.length; i++) {
    const emb = embeddings[i];
    if (!emb || emb.length === 0) continue;

    await prisma.$executeRaw(
      Prisma.sql`UPDATE "ContentAssertion" SET embedding = ${toVectorLiteral(emb)}::vector WHERE id = ${rows[i].id}`
    );
    embedded++;
  }

  return { embedded, skipped: allRows.length - embedded };
}

/**
 * Embed all un-embedded KnowledgeChunks for a given doc.
 * Creates VectorEmbedding records with the native vector column.
 * Idempotent — skips chunks that already have VectorEmbedding with embedding set.
 */
export async function embedChunksForDoc(docId: string): Promise<{ embedded: number; skipped: number }> {
  const { prisma } = await import("@/lib/prisma");
  const { Prisma } = await import("@prisma/client");

  // Find chunks without vector embeddings
  const allRows = await prisma.$queryRaw<Array<{ id: string; content: string }>>(
    Prisma.sql`
      SELECT c.id, c.content FROM "KnowledgeChunk" c
      LEFT JOIN "VectorEmbedding" v ON c.id = v."chunkId" AND v.embedding IS NOT NULL
      WHERE c."docId" = ${docId} AND v.id IS NULL
    `
  );

  if (allRows.length === 0) return { embedded: 0, skipped: 0 };

  // Filter empty/whitespace chunks — OpenAI rejects the whole batch otherwise.
  // Filter the rows array (not texts) to keep index alignment with chunk IDs.
  const rows = allRows.filter((r) => typeof r.content === "string" && r.content.trim() !== "");
  const skippedEmpty = allRows.length - rows.length;
  if (skippedEmpty > 0) {
    console.warn(
      `[embeddings] embedChunksForDoc(${docId}): skipped ${skippedEmpty} empty/whitespace chunk(s)`,
    );
  }
  if (rows.length === 0) return { embedded: 0, skipped: skippedEmpty };

  const texts = rows.map((r) => r.content);
  const embeddings = await embedTexts(texts);

  let embedded = 0;
  for (let i = 0; i < rows.length; i++) {
    const emb = embeddings[i];
    if (!emb || emb.length === 0) continue;

    // Upsert VectorEmbedding: create if missing, update embedding if exists
    const existing = await prisma.vectorEmbedding.findUnique({ where: { chunkId: rows[i].id } });
    if (existing) {
      await prisma.$executeRaw(
        Prisma.sql`UPDATE "VectorEmbedding" SET embedding = ${toVectorLiteral(emb)}::vector WHERE "chunkId" = ${rows[i].id}`
      );
    } else {
      // embeddingData is nullable after migration; cast needed until Prisma client is regenerated
      const ve = await prisma.vectorEmbedding.create({
        data: {
          chunkId: rows[i].id,
          model: config.ai.openai.embeddingModel,
          dimensions: emb.length,
          embeddingData: null as any,
        },
      });
      await prisma.$executeRaw(
        Prisma.sql`UPDATE "VectorEmbedding" SET embedding = ${toVectorLiteral(emb)}::vector WHERE id = ${ve.id}`
      );
    }
    embedded++;
  }

  return { embedded, skipped: allRows.length - embedded };
}
