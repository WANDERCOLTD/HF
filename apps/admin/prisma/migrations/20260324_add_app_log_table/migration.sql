-- CreateTable
CREATE TABLE "AppLog" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "level" TEXT,
    "message" TEXT,
    "promptPreview" TEXT,
    "promptLength" INTEGER,
    "responsePreview" TEXT,
    "responseLength" INTEGER,
    "durationMs" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "callId" TEXT,
    "callerId" TEXT,
    "userId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppLog_createdAt_idx" ON "AppLog"("createdAt");

-- CreateIndex
CREATE INDEX "AppLog_type_idx" ON "AppLog"("type");

-- CreateIndex
CREATE INDEX "AppLog_type_createdAt_idx" ON "AppLog"("type", "createdAt");

-- CreateIndex
CREATE INDEX "AppLog_callId_idx" ON "AppLog"("callId");

-- CreateIndex
CREATE INDEX "AppLog_callerId_idx" ON "AppLog"("callerId");

-- CreateIndex
CREATE INDEX "AppLog_stage_idx" ON "AppLog"("stage");
