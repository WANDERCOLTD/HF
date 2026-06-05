-- CreateTable
CREATE TABLE "CallerIdentityChallenge" (
    "id" TEXT NOT NULL,
    "callerId" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "recipient" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "resendCount" INTEGER NOT NULL DEFAULT 0,
    "lastResentAt" TIMESTAMP(3),

    CONSTRAINT "CallerIdentityChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CallerIdentityChallenge_callerId_issuedAt_idx" ON "CallerIdentityChallenge"("callerId", "issuedAt");

-- CreateIndex
CREATE INDEX "CallerIdentityChallenge_callerId_verifiedAt_idx" ON "CallerIdentityChallenge"("callerId", "verifiedAt");

-- AddForeignKey
ALTER TABLE "CallerIdentityChallenge" ADD CONSTRAINT "CallerIdentityChallenge_callerId_fkey" FOREIGN KEY ("callerId") REFERENCES "Caller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- #1101 — Backfill existing LEARNER Callers as verified so they don't hit the
-- PIN gate on their next sim visit. Each Caller gets a single pre-verified
-- challenge row with verifiedAt = NOW(). pinHash is a marker that cannot
-- match a real bcrypt result, so verify-pin would never accept it; expiresAt
-- is NOW() so it's also already expired. These rows exist solely to satisfy
-- the challenge-status query's `verifiedAt IS NULL` check — they're seen as
-- "already verified" and the gate stays closed for legacy callers.
INSERT INTO "CallerIdentityChallenge" (
    "id", "callerId", "pinHash", "channel", "recipient",
    "issuedAt", "expiresAt", "verifiedAt", "attemptCount", "resendCount"
)
SELECT
    gen_random_uuid()::text,
    c."id",
    'backfill-not-a-bcrypt-hash',
    'email',
    COALESCE(c."email", ''),
    NOW(),
    NOW(),
    NOW(),
    0,
    0
FROM "Caller" c
WHERE c."role" = 'LEARNER';
