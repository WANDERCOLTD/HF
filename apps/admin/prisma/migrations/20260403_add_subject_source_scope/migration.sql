-- Add subjectSourceId FK to ContentAssertion, ContentQuestion, ContentVocabulary
-- for subject-scoped extraction (epic #94).

-- ContentAssertion
ALTER TABLE "ContentAssertion" ADD COLUMN "subjectSourceId" TEXT;
ALTER TABLE "ContentAssertion" ADD CONSTRAINT "ContentAssertion_subjectSourceId_fkey"
  FOREIGN KEY ("subjectSourceId") REFERENCES "SubjectSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ContentAssertion_sourceId_subjectSourceId_idx" ON "ContentAssertion"("sourceId", "subjectSourceId");
CREATE INDEX "ContentAssertion_subjectSourceId_idx" ON "ContentAssertion"("subjectSourceId");

-- ContentQuestion
ALTER TABLE "ContentQuestion" ADD COLUMN "subjectSourceId" TEXT;
ALTER TABLE "ContentQuestion" ADD CONSTRAINT "ContentQuestion_subjectSourceId_fkey"
  FOREIGN KEY ("subjectSourceId") REFERENCES "SubjectSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ContentQuestion_subjectSourceId_idx" ON "ContentQuestion"("subjectSourceId");

-- ContentVocabulary
ALTER TABLE "ContentVocabulary" ADD COLUMN "subjectSourceId" TEXT;
ALTER TABLE "ContentVocabulary" ADD CONSTRAINT "ContentVocabulary_subjectSourceId_fkey"
  FOREIGN KEY ("subjectSourceId") REFERENCES "SubjectSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ContentVocabulary_subjectSourceId_idx" ON "ContentVocabulary"("subjectSourceId");

-- Update unique constraint on ContentVocabulary (sourceId, term) -> (sourceId, subjectSourceId, term)
ALTER TABLE "ContentVocabulary" DROP CONSTRAINT IF EXISTS "ContentVocabulary_sourceId_term_key";
CREATE UNIQUE INDEX "ContentVocabulary_sourceId_subjectSourceId_term_key" ON "ContentVocabulary"("sourceId", "subjectSourceId", "term");
