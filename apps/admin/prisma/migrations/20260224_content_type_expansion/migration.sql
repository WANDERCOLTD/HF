-- Content Type Expansion: READING_PASSAGE, QUESTION_BANK, TUTOR_QUESTION
-- Adds new document types for standalone reading passages and tiered question banks,
-- source pairing (passage ↔ question bank), and skill-mapped tutor questions.

-- 1. Add new DocumentType enum values
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'READING_PASSAGE';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'QUESTION_BANK';

-- 2. Add new QuestionType enum value
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'TUTOR_QUESTION';

-- 3. Add linkedSourceId to ContentSource (passage ↔ question bank pairing)
ALTER TABLE "ContentSource" ADD COLUMN IF NOT EXISTS "linkedSourceId" TEXT;

-- FK constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ContentSource_linkedSourceId_fkey'
  ) THEN
    ALTER TABLE "ContentSource"
      ADD CONSTRAINT "ContentSource_linkedSourceId_fkey"
      FOREIGN KEY ("linkedSourceId") REFERENCES "ContentSource"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Index for pairing lookups
CREATE INDEX IF NOT EXISTS "ContentSource_linkedSourceId_idx" ON "ContentSource"("linkedSourceId");

-- 4. Add skillRef and metadata to ContentQuestion
ALTER TABLE "ContentQuestion" ADD COLUMN IF NOT EXISTS "skillRef" TEXT;
ALTER TABLE "ContentQuestion" ADD COLUMN IF NOT EXISTS "metadata" JSONB;

-- Index for skill-based queries
CREATE INDEX IF NOT EXISTS "ContentQuestion_skillRef_idx" ON "ContentQuestion"("skillRef");
