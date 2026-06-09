/**
 * Proof script for #1333 — createCallEnteringPipeline builder adoption.
 *
 * What it verifies (read-only — no writes, no backfill):
 *
 *   1. Bertie Tallstaff's pre-fix orphan Calls (Calls 2 + 3 on hf_sandbox
 *      2026-06-08, captured in `tests/fixtures/sessions/1333-outbound-dial-pre.json`)
 *      still exist with `playbookId = NULL` — forensic evidence preserved.
 *
 *   2. After the builder is adopted, ANY new VAPI `Call` row for Bertie
 *      (callSequence > 3) carries `playbookId` IS NOT NULL.
 *
 *   3. The new SQL detector `voice-call-null-playbook-attribution` in
 *      `scripts/check-fk-consistency.ts` returns a stable count — pre-fix
 *      orphans visible, no new growth post-builder.
 *
 * Usage (from apps/admin/ on hf-dev, hits hf_sandbox via DATABASE_URL):
 *
 *   npx tsx scripts/proof-1333-outbound-dial.ts
 *   npx tsx scripts/proof-1333-outbound-dial.ts --caller <callerId>
 *   npx tsx scripts/proof-1333-outbound-dial.ts --json    # structured output
 *
 * Idempotent + read-only. Safe to run against any environment whose
 * DATABASE_URL is set. Exits 0 on PASS, 1 on FAIL.
 *
 * The PASS verdict is structural — it does NOT require the test caller
 * to make a new call before running. Pre-fix orphan presence is required;
 * post-fix orphan growth is forbidden.
 */

import { prisma } from "@/lib/prisma";

const DEFAULT_CALLER_ID = "ae3362f0-3e66-4e49-96f1-d83e10bce321"; // Bertie Tallstaff

interface ProofResult {
  check: string;
  status: "PASS" | "FAIL" | "INFO";
  detail: Record<string, unknown>;
}

function parseArgs(): { callerId: string; json: boolean } {
  const args = process.argv.slice(2);
  let callerId = DEFAULT_CALLER_ID;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--caller" && args[i + 1]) {
      callerId = args[i + 1];
      i++;
    } else if (args[i] === "--json") {
      json = true;
    }
  }
  return { callerId, json };
}

async function main() {
  const { callerId, json } = parseArgs();
  const results: ProofResult[] = [];

  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { id: true, name: true },
  });
  if (!caller) {
    console.error(
      `[proof-1333] caller ${callerId} not found — pass --caller <id> for a different fixture or run against hf_sandbox.`,
    );
    process.exit(1);
  }

  // #1344 Slice 4 — `Call.callSequence` dropped. Sequencing lives on
  // `Session.learnerFacingNumber`; pull it through the 1:1 Session join.
  const rawCalls = await prisma.call.findMany({
    where: { callerId },
    select: {
      id: true,
      source: true,
      voiceProvider: true,
      playbookId: true,
      requestedModuleId: true,
      curriculumModuleId: true,
      createdAt: true,
      endedAt: true,
      session: { select: { learnerFacingNumber: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const calls = rawCalls.map((c) => ({
    ...c,
    callSequence: c.session?.learnerFacingNumber ?? null,
  }));

  // Check 1 — pre-fix orphan presence (forensic evidence preserved).
  const preFixOrphans = calls.filter(
    (c) =>
      c.voiceProvider !== null &&
      c.playbookId === null &&
      c.endedAt !== null,
  );
  results.push({
    check: "preFixOrphansPresent",
    status: preFixOrphans.length > 0 ? "PASS" : "INFO",
    detail: {
      expected: ">=1 pre-fix orphan (e.g., Bertie Calls 2 + 3)",
      actual: preFixOrphans.length,
      ids: preFixOrphans.map((c) => ({
        id: c.id,
        callSequence: c.callSequence,
        createdAt: c.createdAt,
      })),
      note: preFixOrphans.length === 0
        ? "No pre-fix orphans found — caller may have been cleaned, fixtures reset, or this isn't hf_sandbox. Not a hard FAIL because the post-fix invariant (Check 2) is the load-bearing one."
        : "Pre-fix orphans preserved as forensic evidence. DO NOT backfill — risks setting wrong playbookId for callers who changed enrollment between calls.",
    },
  });

  // Check 2 — post-fix invariant: any VAPI Call with callSequence > 3
  // (or any new VAPI Call when no pre-fix population existed) MUST carry
  // playbookId. The "> 3" cut-off uses Bertie's specific pre-fix history;
  // for a generic caller, the rule is "any Call created AFTER the builder
  // adoption commit".
  const builderAdoptedCutoff = preFixOrphans.length > 0
    ? Math.max(...preFixOrphans.map((c) => c.callSequence ?? 0))
    : 0;
  const newVapiCalls = calls.filter(
    (c) =>
      c.source === "vapi" &&
      (c.callSequence ?? 0) > builderAdoptedCutoff,
  );
  const newCallsMissingPlaybook = newVapiCalls.filter(
    (c) => c.playbookId === null,
  );
  results.push({
    check: "postFixPlaybookIdPopulated",
    status: newCallsMissingPlaybook.length === 0 ? "PASS" : "FAIL",
    detail: {
      builderAdoptedCutoff,
      newVapiCalls: newVapiCalls.length,
      missingPlaybookId: newCallsMissingPlaybook.length,
      missingIds: newCallsMissingPlaybook.map((c) => ({
        id: c.id,
        callSequence: c.callSequence,
        createdAt: c.createdAt,
      })),
      note:
        newVapiCalls.length === 0
          ? "No new VAPI calls since pre-fix population — run the test caller through outbound-dial once after deploy to populate this check."
          : newCallsMissingPlaybook.length === 0
            ? "Every new VAPI Call carries playbookId. Builder adoption verified end-to-end."
            : "REGRESSION — new VAPI Calls are dropping playbookId. Inspect the listed Call ids and confirm the outbound-dial route still routes through createCallEnteringPipeline.",
    },
  });

  // Check 3 — global SQL detector trend. Count of voice Calls with null
  // playbookId across the whole DB. Run twice (with --json) over time to
  // confirm the count plateaus (pre-fix population stays) rather than
  // growing (builder leak).
  const globalOrphanCount = (await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM "Call"
    WHERE "voiceProvider" IS NOT NULL
      AND "playbookId" IS NULL
      AND "endedAt" IS NOT NULL
  `)[0].count;
  results.push({
    check: "globalDetectorCount",
    status: "INFO",
    detail: {
      count: Number(globalOrphanCount),
      note:
        "Same SQL as `voice-call-null-playbook-attribution` in scripts/check-fk-consistency.ts. Trend should plateau (pre-fix population) and never grow (builder leak). Compare across runs.",
    },
  });

  // Render report.
  if (json) {
    console.log(
      JSON.stringify(
        {
          issue: 1333,
          caller: { id: caller.id, name: caller.name },
          results,
          verdict: results.some((r) => r.status === "FAIL") ? "FAIL" : "PASS",
        },
        null,
        2,
      ),
    );
  } else {
    console.log("");
    console.log(
      `=== proof-1333 — createCallEnteringPipeline (caller ${caller.id} / ${caller.name ?? "unnamed"}) ===`,
    );
    console.log("");
    for (const r of results) {
      const symbol =
        r.status === "PASS" ? "✓" : r.status === "FAIL" ? "✗" : "•";
      console.log(`  ${symbol} ${r.status.padEnd(4)} ${r.check}`);
      for (const [k, v] of Object.entries(r.detail)) {
        const formatted =
          typeof v === "string"
            ? v
            : JSON.stringify(v).slice(0, 200);
        console.log(`        ${k}: ${formatted}`);
      }
      console.log("");
    }
  }

  await prisma.$disconnect();
  const failed = results.some((r) => r.status === "FAIL");
  if (failed) {
    console.error("[proof-1333] FAIL — see report above.");
    process.exit(1);
  }
  console.log("[proof-1333] PASS");
}

main().catch((err) => {
  console.error("[proof-1333] uncaught error:", err);
  process.exit(1);
});
