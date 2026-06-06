-- #1140 Phase 2a — admin-authored IntakeSpec (CrawcusSpec) storage layer.
-- See lib/intake/spec-store.ts for read/write helpers.

-- CreateEnum
CREATE TYPE "IntakeSpecStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "IntakeSpec" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "status" "IntakeSpecStatus" NOT NULL DEFAULT 'DRAFT',
    "parentKey" TEXT,
    "createdById" TEXT,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntakeSpec_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntakeSpec_key_version_key" ON "IntakeSpec"("key", "version");

-- CreateIndex
CREATE INDEX "IntakeSpec_key_status_idx" ON "IntakeSpec"("key", "status");

-- CreateIndex
CREATE INDEX "IntakeSpec_status_updatedAt_idx" ON "IntakeSpec"("status", "updatedAt");

-- AddForeignKey
ALTER TABLE "IntakeSpec"
    ADD CONSTRAINT "IntakeSpec_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeSpec"
    ADD CONSTRAINT "IntakeSpec_publishedById_fkey"
    FOREIGN KEY ("publishedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- #1140 immutable-published-row guard. PUBLISHED rows must not have
-- their `body` or `key`/`version` mutated post-publish — only `status`
-- transitions DRAFT → PUBLISHED are allowed (one-way). Application
-- layer enforces this via spec-store helpers (lib/intake/spec-store.ts);
-- this trigger is the structural belt-and-braces fallback that catches
-- any direct SQL or out-of-band write.
CREATE OR REPLACE FUNCTION intake_spec_published_immutable()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD."status" = 'PUBLISHED' THEN
        IF NEW."status" != OLD."status" THEN
            RAISE EXCEPTION 'IntakeSpec %/% is PUBLISHED — status transitions are one-way (DRAFT→PUBLISHED).', OLD."key", OLD."version";
        END IF;
        IF NEW."body" != OLD."body" THEN
            RAISE EXCEPTION 'IntakeSpec %/% is PUBLISHED — body is immutable.', OLD."key", OLD."version";
        END IF;
        IF NEW."key" != OLD."key" OR NEW."version" != OLD."version" THEN
            RAISE EXCEPTION 'IntakeSpec %/% is PUBLISHED — key/version are immutable.', OLD."key", OLD."version";
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER intake_spec_published_immutable_trigger
    BEFORE UPDATE ON "IntakeSpec"
    FOR EACH ROW
    EXECUTE FUNCTION intake_spec_published_immutable();
