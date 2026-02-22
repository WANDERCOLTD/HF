-- AddColumn: Domain.kind (DomainKind enum already exists from InstitutionType migration)
ALTER TABLE "Domain" ADD COLUMN "kind" "DomainKind" NOT NULL DEFAULT 'INSTITUTION';

-- CreateIndex
CREATE INDEX "Domain_kind_idx" ON "Domain"("kind");
