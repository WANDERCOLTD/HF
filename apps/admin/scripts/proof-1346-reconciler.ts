#!/usr/bin/env npx tsx
/**
 * #1346 Slice 5 proof script — reconciler + I-CT1/I-CT2 invariants.
 *
 * Reads the configured DB (sandbox/dev/test) and asserts:
 *
 *   A. lib/voice/reconciler.ts::reconcileCarryThrough exists + the API
 *      route exists at /api/voice/reconcile-carry-through (information_schema
 *      proxy: ensures the migration didn't drop the Session columns
 *      reconciler depends on).
 *   B. I-CT1 — for every Session(endedAt < NOW() - 60s, countsTowardPipelineNumber)
 *      there exists either a producedComposedPromptId or the orphan was
 *      logged for the reconciler to pick up next pass. Reports the
 *      population for trend monitoring.
 *   C. I-CT2 — no recent Session (last 60s) has usedPromptId IS NULL while
 *      the caller has prior history. Structural break — ERROR.
 *   D. The "carry-through" badge surface exists: any ComposedPrompt rows
 *      written by the reconciler have inputs.partialFailureMode === "minimal"
 *      and triggerType === "reconciler".
 *   E. The reconciler module can be loaded without throwing (proxy for
 *      the deployment having the new lib code in scope).
 *
 * Idempotent — any operator can run this against hf_sandbox / dev / test
 * to verify "the fix is live" without re-reading the PR.
 *
 * Exit non-zero on failure (D, E), structured diff on stdout.
 * I-CT1 (B) does NOT fail the script during the 3-week soak window —
 * reports as INFO.
 *
 * Usage:
 *   npx tsx scripts/proof-1346-reconciler.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface CheckResult {
  id: string;
  pass: boolean;
  severity: "error" | "warn" | "info";
  detail: string;
}

async function checkSessionColumnsPresent(): Promise<CheckResult> {
  const rows = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'Session'
       AND column_name IN ('producedComposedPromptId', 'usedPromptId', 'countsTowardPipelineNumber', 'endedAt')`,
  );
  const expected = [
    "producedComposedPromptId",
    "usedPromptId",
    "countsTowardPipelineNumber",
    "endedAt",
  ];
  const present = new Set(rows.map((r) => r.column_name));
  const missing = expected.filter((c) => !present.has(c));
  if (missing.length > 0) {
    return {
      id: "A",
      pass: false,
      severity: "error",
      detail: `Session columns missing: ${missing.join(", ")} — reconciler cannot run without these`,
    };
  }
  return {
    id: "A",
    pass: true,
    severity: "info",
    detail: "All required Session columns present (Slice 0 + 3 + 4 migrations applied)",
  };
}

async function checkICT1OrphanPopulation(): Promise<CheckResult> {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count
     FROM "Session"
     WHERE "endedAt" IS NOT NULL
       AND "endedAt" < NOW() - INTERVAL '60 seconds'
       AND "producedComposedPromptId" IS NULL
       AND "countsTowardPipelineNumber" = true`,
  );
  const count = Number(rows[0]?.count ?? 0);
  if (count === 0) {
    return {
      id: "B",
      pass: true,
      severity: "info",
      detail: "I-CT1 — 0 orphan Sessions older than 60s with no producedComposedPromptId. Reconciler is converging.",
    };
  }
  return {
    id: "B",
    pass: true, // WARN-only during 3-week soak
    severity: "warn",
    detail: `I-CT1 — ${count} orphan Session(s) older than 60s with no producedComposedPromptId. WARN-only during 3-week soak window. Promote to ERROR once this is consistently 0.`,
  };
}

async function checkICT2NoCascadeNullForReturningCaller(): Promise<CheckResult> {
  // Recent Sessions (last 60s) with null usedPromptId, then for each
  // check whether the caller has any earlier Session — if so, I-CT2 was
  // expected to resolve a usedPromptId.
  const recent = await prisma.session.findMany({
    where: {
      startedAt: { gte: new Date(Date.now() - 60_000) },
      usedPromptId: null,
    },
    select: { id: true, callerId: true, startedAt: true },
    take: 200,
  });
  let violating = 0;
  const sampleIds: string[] = [];
  for (const candidate of recent) {
    const prior = await prisma.session.findFirst({
      where: {
        callerId: candidate.callerId,
        startedAt: { lt: candidate.startedAt },
      },
      select: { id: true },
    });
    if (prior) {
      violating += 1;
      if (sampleIds.length < 5) sampleIds.push(candidate.id);
    }
  }
  if (violating === 0) {
    return {
      id: "C",
      pass: true,
      severity: "info",
      detail: "I-CT2 — 0 recent Sessions for returning Callers with null usedPromptId. Cascade is converging.",
    };
  }
  return {
    id: "C",
    pass: false,
    severity: "error",
    detail: `I-CT2 — ${violating} recent Session(s) for returning Callers have null usedPromptId. Samples: ${sampleIds.join(", ")}. Structural break — investigate resolve-used-prompt.ts.`,
  };
}

async function checkReconciledRowsCorrectShape(): Promise<CheckResult> {
  // Any ComposedPrompt with triggerType="reconciler" MUST have inputs.partialFailureMode = "minimal".
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; partialFailureMode: string | null }>>(
    `SELECT id, (inputs->>'partialFailureMode') AS "partialFailureMode"
     FROM "ComposedPrompt"
     WHERE "triggerType" = 'reconciler'
     LIMIT 200`,
  );
  if (rows.length === 0) {
    return {
      id: "D",
      pass: true,
      severity: "info",
      detail: "No reconciler-written ComposedPrompts in DB — nothing to check. PASS by vacuity.",
    };
  }
  const bad = rows.filter((r) => r.partialFailureMode !== "minimal");
  if (bad.length === 0) {
    return {
      id: "D",
      pass: true,
      severity: "info",
      detail: `${rows.length} reconciler-written ComposedPrompts in DB — all carry inputs.partialFailureMode = "minimal".`,
    };
  }
  return {
    id: "D",
    pass: false,
    severity: "error",
    detail: `${bad.length} / ${rows.length} reconciler-written ComposedPrompts missing inputs.partialFailureMode = "minimal". Sample ids: ${bad.slice(0, 5).map((r) => r.id).join(", ")}.`,
  };
}

async function checkReconcilerModuleLoads(): Promise<CheckResult> {
  try {
    const mod = await import("@/lib/voice/reconciler");
    if (typeof mod.reconcileCarryThrough !== "function") {
      return {
        id: "E",
        pass: false,
        severity: "error",
        detail: "lib/voice/reconciler.ts loaded but reconcileCarryThrough export is missing",
      };
    }
    return {
      id: "E",
      pass: true,
      severity: "info",
      detail: "lib/voice/reconciler.ts loads and exports reconcileCarryThrough",
    };
  } catch (err) {
    return {
      id: "E",
      pass: false,
      severity: "error",
      detail: `lib/voice/reconciler.ts failed to load: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function main(): Promise<void> {
  console.log("[proof-1346] Running #1346 Slice 5 reconciler proof...\n");

  const checks = await Promise.all([
    checkSessionColumnsPresent(),
    checkICT1OrphanPopulation(),
    checkICT2NoCascadeNullForReturningCaller(),
    checkReconciledRowsCorrectShape(),
    checkReconcilerModuleLoads(),
  ]);

  let pass = true;
  for (const c of checks) {
    const marker = c.pass ? (c.severity === "warn" ? "⚠" : "✓") : "✗";
    console.log(`  ${marker} [${c.id}] ${c.detail}`);
    if (!c.pass && c.severity === "error") pass = false;
  }
  console.log();
  if (pass) {
    console.log("[proof-1346] PASS — reconciler structurally healthy");
    await prisma.$disconnect();
    process.exit(0);
  }
  console.log("[proof-1346] FAIL — at least one ERROR-severity check failed");
  await prisma.$disconnect();
  process.exit(1);
}

main().catch((err) => {
  console.error("[proof-1346] fatal error:", err);
  prisma.$disconnect().finally(() => process.exit(1));
});
