/**
 * Backfill embeddings for existing ContentAssertions and KnowledgeChunks.
 *
 * Processes in batches, skips rows that already have embeddings.
 * Run on VM after deploying pgvector migration:
 *   npx tsx scripts/backfill-embeddings.ts
 *
 * Options:
 *   --assertions-only  Only backfill ContentAssertions
 *   --chunks-only      Only backfill KnowledgeChunks
 *   --batch-size=N     Batch size for OpenAI API calls (default: 100)
 *   --dry-run          Count without embedding
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { embedTexts, toVectorLiteral } from "@/lib/embeddings";

const DEFAULT_MODEL = "text-embedding-3-small";

async function backfillAssertions(batchSize: number, dryRun: boolean) {
  console.log("\n=== ContentAssertions ===");

  const total = await prisma.contentAssertion.count();
  const withEmbedding = await prisma.$queryRaw<[{ count: bigint }]>(
    Prisma.sql`SELECT COUNT(*) as count FROM "ContentAssertion" WHERE embedding IS NOT NULL`
  );
  const alreadyDone = Number(withEmbedding[0].count);
  const remaining = total - alreadyDone;

  console.log(`Total: ${total}, Already embedded: ${alreadyDone}, Remaining: ${remaining}`);

  if (remaining === 0) {
    console.log("All assertions already have embeddings. Skipping.");
    return;
  }

  if (dryRun) {
    console.log("(dry run — skipping embedding)");
    return;
  }

  let processed = 0;
  const offset = 0;

  while (processed < remaining) {
    const rows = await prisma.$queryRaw<Array<{ id: string; assertion: string }>>(
      Prisma.sql`
        SELECT id, assertion FROM "ContentAssertion"
        WHERE embedding IS NULL
        ORDER BY "createdAt" ASC
        LIMIT ${batchSize}
        OFFSET ${offset}
      `
    );

    if (rows.length === 0) break;

    const texts = rows.map((r) => r.assertion);
    const embeddings = await embedTexts(texts, batchSize);

    for (let i = 0; i < rows.length; i++) {
      const emb = embeddings[i];
      if (!emb || emb.length === 0) continue;

      await prisma.$executeRaw(
        Prisma.sql`UPDATE "ContentAssertion" SET embedding = ${toVectorLiteral(emb)}::vector WHERE id = ${rows[i].id}`
      );
      processed++;
    }

    console.log(`  Embedded ${processed}/${remaining} assertions...`);
  }

  console.log(`Done. Embedded ${processed} assertions.`);
}

async function backfillChunks(batchSize: number, dryRun: boolean) {
  console.log("\n=== KnowledgeChunks ===");

  const totalChunks = await prisma.knowledgeChunk.count();
  const withEmbedding = await prisma.$queryRaw<[{ count: bigint }]>(
    Prisma.sql`
      SELECT COUNT(*) as count FROM "KnowledgeChunk" c
      JOIN "VectorEmbedding" v ON c.id = v."chunkId"
      WHERE v.embedding IS NOT NULL
    `
  );
  const alreadyDone = Number(withEmbedding[0].count);
  const remaining = totalChunks - alreadyDone;

  console.log(`Total chunks: ${totalChunks}, Already embedded: ${alreadyDone}, Remaining: ${remaining}`);

  if (remaining === 0) {
    console.log("All chunks already have embeddings. Skipping.");
    return;
  }

  if (dryRun) {
    console.log("(dry run — skipping embedding)");
    return;
  }

  let processed = 0;

  while (true) {
    const rows = await prisma.$queryRaw<Array<{ id: string; content: string }>>(
      Prisma.sql`
        SELECT c.id, c.content FROM "KnowledgeChunk" c
        LEFT JOIN "VectorEmbedding" v ON c.id = v."chunkId" AND v.embedding IS NOT NULL
        WHERE v.id IS NULL
        ORDER BY c."createdAt" ASC
        LIMIT ${batchSize}
      `
    );

    if (rows.length === 0) break;

    const texts = rows.map((r) => r.content);
    const embeddings = await embedTexts(texts, batchSize);

    for (let i = 0; i < rows.length; i++) {
      const emb = embeddings[i];
      if (!emb || emb.length === 0) continue;

      // Upsert VectorEmbedding
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
            model: DEFAULT_MODEL,
            dimensions: emb.length,
            embeddingData: null as any,
          },
        });
        await prisma.$executeRaw(
          Prisma.sql`UPDATE "VectorEmbedding" SET embedding = ${toVectorLiteral(emb)}::vector WHERE id = ${ve.id}`
        );
      }
      processed++;
    }

    console.log(`  Embedded ${processed}/${remaining} chunks...`);
  }

  console.log(`Done. Embedded ${processed} chunks.`);
}

async function main() {
  const args = process.argv.slice(2);
  const assertionsOnly = args.includes("--assertions-only");
  const chunksOnly = args.includes("--chunks-only");
  const dryRun = args.includes("--dry-run");
  const batchSizeArg = args.find((a) => a.startsWith("--batch-size="));
  const batchSize = batchSizeArg ? parseInt(batchSizeArg.split("=")[1], 10) : 100;

  console.log("=== Backfill Embeddings ===");
  console.log(`Batch size: ${batchSize}, Dry run: ${dryRun}`);

  if (!process.env.OPENAI_API_KEY && !dryRun) {
    console.error("OPENAI_API_KEY not set. Use --dry-run to see counts without embedding.");
    process.exit(1);
  }

  if (!chunksOnly) await backfillAssertions(batchSize, dryRun);
  if (!assertionsOnly) await backfillChunks(batchSize, dryRun);

  console.log("\nBackfill complete.");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
