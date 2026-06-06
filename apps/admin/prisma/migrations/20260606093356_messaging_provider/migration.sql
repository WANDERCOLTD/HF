-- CreateTable
CREATE TABLE "MessagingProvider" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "adapterKey" TEXT NOT NULL,
    "secretRef" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "institutionId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessagingProvider_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MessagingProvider_slug_key" ON "MessagingProvider"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "MessagingProvider_institutionId_adapterKey_key"
    ON "MessagingProvider"("institutionId", "adapterKey");

-- CreateIndex
CREATE INDEX "MessagingProvider_adapterKey_enabled_idx"
    ON "MessagingProvider"("adapterKey", "enabled");

-- CreateIndex
CREATE INDEX "MessagingProvider_institutionId_idx"
    ON "MessagingProvider"("institutionId");

-- CreateIndex
CREATE INDEX "MessagingProvider_isDefault_idx"
    ON "MessagingProvider"("isDefault");

-- #1141 TL review: the @@unique above doesn't constrain rows where
-- `institutionId IS NULL` (Postgres treats NULLs as distinct), so without
-- this partial index two admin browser tabs can both POST the same SYSTEM
-- default for an adapterKey, both pass the application-layer 409 check,
-- and both commit. This partial index makes that race impossible.
CREATE UNIQUE INDEX "MessagingProvider_system_default_adapterKey_unique"
    ON "MessagingProvider"("adapterKey")
    WHERE "institutionId" IS NULL;

-- #1141 seed: SYSTEM-default email-resend provider. Idempotent via
-- ON CONFLICT — if a row already exists with the same (slug) it's left
-- alone. This keeps existing #1101 PIN email working with zero config
-- change required at deploy time.
INSERT INTO "MessagingProvider" (
    "id", "slug", "displayName", "adapterKey", "secretRef",
    "fromAddress", "institutionId", "isDefault", "enabled",
    "createdAt", "updatedAt"
) VALUES (
    gen_random_uuid()::text,
    'system-email-resend',
    'System Email (Resend)',
    'email-resend',
    'RESEND_API_KEY',
    'HF Dev <noreply@thewanders.com>',
    NULL,
    true,
    true,
    NOW(),
    NOW()
)
ON CONFLICT ("slug") DO NOTHING;
