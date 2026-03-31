-- Institution-scoped content dedup: same file can exist in different institutions
-- so the global unique constraint on contentHash must go.

-- Backfill contentHash from linked MediaAssets (populate for existing sources)
UPDATE "ContentSource" cs
SET "contentHash" = ma."contentHash"
FROM "MediaAsset" ma
WHERE ma."sourceId" = cs.id
  AND cs."contentHash" IS NULL
  AND ma."contentHash" IS NOT NULL;

-- Drop unique constraint, add regular index for lookup performance
DROP INDEX IF EXISTS "ContentSource_contentHash_key";
CREATE INDEX "ContentSource_contentHash_idx" ON "ContentSource"("contentHash");
