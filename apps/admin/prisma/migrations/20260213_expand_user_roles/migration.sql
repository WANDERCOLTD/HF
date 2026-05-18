-- Expand UserRole enum with new role values
-- Add: SUPERADMIN, SUPER_TESTER, TESTER, DEMO
-- Keep: ADMIN, OPERATOR, VIEWER (VIEWER deprecated, alias for TESTER)

-- ─────────────────────────────────────────────────────────────────────
-- 2026-05-18 — backfill for missing Domain table init.
--
-- Domain was historically created via `prisma db push` and never had a
-- corresponding CREATE TABLE in the migrations folder. Fresh CI DBs
-- (running `prisma migrate deploy` from scratch) failed at this
-- migration because the FK below references "Domain"("id").
--
-- Idempotent: CREATE TABLE IF NOT EXISTS no-ops on dev/prod where
-- Domain already exists. Later migrations (20260222 kind, 20260225
-- config) ALTER ADD their columns on top.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Domain" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "onboardingWelcome" TEXT,
  "onboardingIdentitySpecId" TEXT,
  "onboardingFlowPhases" JSONB,
  "onboardingDefaultTargets" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Domain_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Domain_slug_key" ON "Domain"("slug");

-- AnalysisSpec is a Prisma model name; the actual table is "BddFeature"
-- (see `@@map("BddFeature")` on `model AnalysisSpec` in schema.prisma).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'Domain_onboardingIdentitySpecId_fkey'
  ) THEN
    ALTER TABLE "Domain" ADD CONSTRAINT "Domain_onboardingIdentitySpecId_fkey"
      FOREIGN KEY ("onboardingIdentitySpecId") REFERENCES "BddFeature"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Create UserRole enum if it doesn't exist (may have been created via db push)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UserRole') THEN
    CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'OPERATOR', 'VIEWER');
  END IF;
END $$;

-- Add role column to User if it doesn't exist (may have been added via db push)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "role" "UserRole" NOT NULL DEFAULT 'VIEWER';

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPERADMIN';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPER_TESTER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'TESTER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'DEMO';

-- Add domain scoping for testers (null = all domains)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "assignedDomainId" TEXT;

-- Foreign key constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'User_assignedDomainId_fkey'
  ) THEN
    ALTER TABLE "User" ADD CONSTRAINT "User_assignedDomainId_fkey"
      FOREIGN KEY ("assignedDomainId") REFERENCES "Domain"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Index for domain scoping queries
CREATE INDEX IF NOT EXISTS "User_assignedDomainId_idx" ON "User"("assignedDomainId");
