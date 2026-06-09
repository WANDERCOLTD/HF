/**
 * #1343 (epic #1338 Slice 2) — operator-runnable proof script.
 *
 * Verifies the PrismaEventStore is wired correctly against a live DB
 * (hf_sandbox / hf-dev). Writes a 3-event golden chain under a
 * test-only `intentId`, reads it back, asserts `verifyChain` passes,
 * then deletes the rows. Idempotent + cleanly self-cleaning.
 *
 * What gets asserted:
 *
 *   1. `intake_event` table exists with the expected indexes
 *      (`intake_event_intentId_version_key` + `intake_event_intentId_idx`).
 *   2. `Session.intentId` column exists.
 *   3. `PrismaEventStore.buildAndAppendEvent` produces a chain whose
 *      `prevHash` linkage is correct (version 0 = null, version N =
 *      version N-1's contentHash).
 *   4. `verifyChain(readChain(intentId)).valid === true`.
 *   5. `(intentId, version)` unique constraint blocks duplicate writes
 *      (raises Prisma P2002).
 *
 * Run via:
 *   cd apps/admin && npx tsx scripts/proof-1343-eventstore.ts
 *
 * Exit codes:
 *   0 — all checks PASS
 *   1 — at least one check FAILED (report printed to stdout)
 *   2 — DB unreachable
 *
 * Read-only against existing rows. Test rows are scoped to a unique
 * `intentId` minted at run-time so concurrent runs don't collide; the
 * script deletes them at the end (and on any thrown failure).
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaEventStore } from "../lib/intake/prisma-event-store";
import { verifyChain } from "../lib/intake/tallyseal";
import type { IntentId, Tenant, Actor, SubjectId, Purpose } from "../lib/intake/tallyseal";

const prisma = new PrismaClient();

const TENANT: Tenant = {
  id: "hf-proof" as Tenant["id"],
  region: "europe-west2" as Tenant["region"],
};
const ACTOR: Actor = { kind: "human", id: "proof-1343-actor" as Actor["id"] };
const SUBJECT = "proof-1343-subject" as SubjectId;
const INTENT_ID = `proof-1343-${Date.now()}` as IntentId;

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

async function runChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Check 1 — table exists.
  const eventTable = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'intake_event'
  `;
  results.push({
    name: "intake_event table exists",
    passed: eventTable.length === 1,
    detail: eventTable.length === 1 ? "OK" : "intake_event table MISSING — migration 1343 has not applied",
  });
  if (eventTable.length !== 1) return results;

  // Check 1b — required indexes exist.
  const idxRows = await prisma.$queryRaw<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'intake_event'
  `;
  const idxNames = idxRows.map((r) => r.indexname);
  const expectedIdx = ["intake_event_pkey", "intake_event_intentId_version_key", "intake_event_intentId_idx"];
  const missingIdx = expectedIdx.filter((n) => !idxNames.includes(n));
  results.push({
    name: "intake_event indexes present",
    passed: missingIdx.length === 0,
    detail: missingIdx.length === 0 ? `Found: ${idxNames.join(", ")}` : `Missing: ${missingIdx.join(", ")}`,
  });

  // Check 2 — Session.intentId column exists.
  const intentCol = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Session' AND column_name = 'intentId'
  `;
  results.push({
    name: "Session.intentId column exists",
    passed: intentCol.length === 1,
    detail: intentCol.length === 1 ? "OK" : "Session.intentId column MISSING — migration 1343 has not applied to Session",
  });

  // Check 3 — write a 3-event chain.
  const store = new PrismaEventStore(prisma);
  for (let i = 0; i < 3; i++) {
    await store.buildAndAppendEvent({
      intentId: INTENT_ID,
      kind: i === 0 ? "SourceCaptured" : "CapturedTurn",
      tenantId: TENANT.id,
      actor: ACTOR,
      lawfulBasis: "contract",
      purpose: "course-delivery" as Purpose,
      dataSubjectIds: [SUBJECT],
      payload: { idx: i, text: `proof-event-${i}` },
    });
  }
  const chain = await store.readChain(INTENT_ID);
  results.push({
    name: "buildAndAppendEvent wrote 3 events",
    passed: chain.length === 3,
    detail: chain.length === 3 ? "OK" : `Expected 3 events, got ${chain.length}`,
  });

  // Check 4 — chain invariants.
  const linkageOk =
    chain.length === 3 &&
    chain[0].version === 1 &&
    chain[0].prevHash === null &&
    chain[1].version === 2 &&
    chain[1].prevHash === chain[0].contentHash &&
    chain[2].version === 3 &&
    chain[2].prevHash === chain[1].contentHash;
  results.push({
    name: "Chain linkage (genesis null + per-event prevHash)",
    passed: linkageOk,
    detail: linkageOk
      ? "OK"
      : `Chain shape unexpected — versions/prevHashes: ${chain
          .map((e) => `[v=${e.version}, prev=${e.prevHash ?? "<null>"}]`)
          .join(" ")}`,
  });

  // Check 5 — verifyChain.
  const verification = chain.length > 0 ? verifyChain(chain) : { valid: false, reason: "empty chain" };
  results.push({
    name: "verifyChain(readChain) returns valid=true",
    passed: verification.valid,
    detail: verification.valid ? "OK" : `verifyChain rejected: ${verification.reason ?? "<no reason>"}`,
  });

  // Check 6 — duplicate (intentId, version) blocked.
  let dupeBlocked = false;
  let dupeError = "<no error thrown>";
  if (chain.length > 0) {
    try {
      await store.appendEvent(chain[0]);
    } catch (e) {
      dupeBlocked =
        e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
      dupeError = e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e);
    }
  }
  results.push({
    name: "Duplicate (intentId, version) raises P2002",
    passed: dupeBlocked,
    detail: dupeBlocked ? "OK" : `Expected P2002 — got: ${dupeError}`,
  });

  return results;
}

async function cleanup(): Promise<void> {
  try {
    await prisma.intakeEvent.deleteMany({ where: { intentId: INTENT_ID } });
  } catch {
    // Best-effort cleanup; don't fail the proof on cleanup error.
  }
}

async function main(): Promise<void> {
  // DB reachability gate.
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (e) {
    console.error("proof-1343-eventstore: DATABASE_URL unreachable —", e);
    process.exit(2);
  }

  let results: CheckResult[] = [];
  try {
    results = await runChecks();
  } catch (e) {
    console.error("proof-1343-eventstore: thrown during checks —", e);
    await cleanup();
    process.exit(1);
  }
  await cleanup();

  console.log(`\n#1343 PrismaEventStore proof — intentId=${INTENT_ID}`);
  console.log("=".repeat(72));
  let pass = 0;
  let fail = 0;
  for (const r of results) {
    const flag = r.passed ? "PASS" : "FAIL";
    console.log(`  [${flag}] ${r.name}`);
    console.log(`         ${r.detail}`);
    if (r.passed) pass++;
    else fail++;
  }
  console.log("=".repeat(72));
  console.log(`Summary: ${pass} passed, ${fail} failed (of ${results.length}).`);

  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("proof-1343-eventstore: unhandled error —", e);
  await cleanup();
  await prisma.$disconnect();
  process.exit(1);
});
