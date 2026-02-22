-- AddColumn: Domain.kind (DomainKind enum already exists from InstitutionType migration)
-- Idempotent: column may already exist from prisma db push
DO $$ BEGIN
    ALTER TABLE "Domain" ADD COLUMN "kind" "DomainKind" NOT NULL DEFAULT 'INSTITUTION';
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "Domain_kind_idx" ON "Domain"("kind");
