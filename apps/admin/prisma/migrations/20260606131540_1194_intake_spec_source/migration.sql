-- #1194 Phase 2b — IntakeSpec.source column.
--
-- Editor's internal representation is @tallyseal/spec-emitter's
-- `EditableSpec`, built via parse(source: string). HF stores TS source
-- in this column; body JSON stays as a fast read cache for the list
-- page (no parse needed to render fieldCount / status / etc.).
--
-- Nullable so existing Phase 2a rows (created via PR #1163, source
-- predates this migration) keep working. Re-running
-- `scripts/seed-intake-specs.ts` populates source for the demo specs
-- idempotently. Real new rows from the editor (saveDraft) always
-- write source.

ALTER TABLE "IntakeSpec" ADD COLUMN "source" TEXT;
