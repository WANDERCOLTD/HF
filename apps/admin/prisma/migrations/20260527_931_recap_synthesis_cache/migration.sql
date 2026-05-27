-- #931 — AI-synthesized prior-call recap cache.
--
-- Backfills the migration missing from PR #915 (#599 Slice 1), which added
-- ComposedPrompt.recapSynthesisCache to schema.prisma without committing the
-- corresponding migration file. Compose-prompt endpoint was 500ing with
-- Prisma P2022 (column does not exist) on environments where #915 shipped
-- without `migrate dev` regenerating the migration list.
--
-- Shape: { depth: "minimal" | "standard" | "rich"; text: string; cachedAt: string }
-- See lib/prompt/composition/loaders/synthesizePriorCallRecap.ts
--
-- Non-destructive: nullable column, no backfill required. Postgres ADD COLUMN
-- of a nullable column with no default is a metadata-only operation, safe on
-- non-empty tables.

ALTER TABLE "ComposedPrompt" ADD COLUMN "recapSynthesisCache" JSONB;
