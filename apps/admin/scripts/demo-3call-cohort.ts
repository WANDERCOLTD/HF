/**
 * demo-3call-cohort.ts
 *
 * Live-DB demonstration that the full adaptive loop closes end-to-end against
 * real services. Catalog entry: docs/TEST-BANK.md "D002".
 *
 * How it works:
 *   1. Creates a fresh LEARNER caller with externalId `e2e-demo-d002-<ts>`
 *      and enrolls them in IELTS Speaking Practice V1.0
 *      (playbookId hardcoded to the seeded UUID; exits non-zero if absent).
 *   2. Bootstraps the first `ComposedPrompt` via `autoComposeForCaller`.
 *   3. Runs 3 calls in sequence by shell-spawning `scripts/sim-drive-call.ts`
 *      with `--module=part1`, `--module=part2`, `--module=part3` and a Polish
 *      B2 IELTS persona, 5 turns each.
 *   4. Between calls: polls for a fresh `ComposedPrompt` whose
 *      `triggerCallId === <just-ended call.id>` AND `status === 'active'`.
 *      Poll every 3s, timeout after 90s. This is required because the
 *      cohort script's fixed 3s pause is too short for the pipeline to
 *      finish writing the next prompt — the next call would otherwise run
 *      against a stale ComposedPrompt.
 *   5. Retries the current call up to 2 times if sim-drive-call exits
 *      non-zero AND the stderr matches the Anthropic 529 "Overloaded" pattern
 *      (30s backoff between retries). Other failures abort the cohort.
 *   6. After all 3 calls + final COMPOSE land, snapshots state and asserts:
 *        - 3 `Call` rows with `endedAt` set,
 *        - 3 pipeline-trigger `ComposedPrompt` rows whose `triggerCallId`s
 *          match the 3 calls in order,
 *        - per-module `CallerModuleProgress.mastery > 0` AND
 *          `status === 'IN_PROGRESS'` (the #950 invariant),
 *        - at least one `CallerAttribute lo_mastery:*` row per module that
 *          received scorable turns.
 *   7. Prints a human-readable summary + verdict line and exits 0 (PASS)
 *      or 1 (FAIL).
 *
 * Run:
 *   On the VM: `cd ~/HF/apps/admin && npx tsx scripts/demo-3call-cohort.ts`
 *   Optional: `--persona="..."` to override the default Polish-B2 persona.
 *
 * Safety:
 *   Each run creates a fresh caller with a unique `externalId` prefix
 *   `e2e-demo-d002-`. Old runs accumulate as garbage rows but are harmless
 *   — never overwritten, never queried, no FK pressure. Cleanup is not
 *   automated; manual SQL by externalId prefix if storage is constrained.
 *
 * Related:
 *   - scripts/sim-drive-call.ts — per-call driver (spawned 3x)
 *   - scripts/sim-cohort.ts — generic N-call cohort orchestrator (this
 *     script is purpose-built for the 3-module IELTS smoke; the polling
 *     between calls is tighter than sim-cohort's fixed pause)
 *   - lib/enrollment/auto-compose.ts — bootstrap prompt persister
 *   - #950 — status-promotion bug this demo first surfaced
 *   - #948 — separate learner-page reachability gap (not covered here)
 *   - docs/TEST-BANK.md D002 — catalog entry
 */

import { spawn } from "node:child_process";
import * as path from "node:path";

import { Prisma } from "@prisma/client";

import { prisma } from "../lib/prisma";
import { autoComposeForCaller } from "../lib/enrollment/auto-compose";
import { enrollCaller } from "../lib/enrollment";

// --- Constants ----------------------------------------------------------

const IELTS_PLAYBOOK_ID = "eb6bc79e-3168-49e5-90a0-d732a37fe294";
const EXTERNAL_ID_PREFIX = "e2e-demo-d002-";
const MODULE_SLUGS = ["part1", "part2", "part3"] as const;
const TURNS_PER_CALL = 5;
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 90_000;
const RETRY_BACKOFF_MS = 30_000;
const MAX_529_RETRIES = 2;

const DEFAULT_PERSONA =
  "Polish 28-year-old, B2 English, keen IELTS candidate aiming for Band 7. " +
  "Speaks in full sentences but occasionally fumbles word choice or grammar " +
  "under pressure. Friendly, curious, willing to attempt complex structures.";

// --- Types --------------------------------------------------------------

type ModuleSlug = (typeof MODULE_SLUGS)[number];

interface Args {
  persona: string;
}

interface SpawnResult {
  exitCode: number;
  stdoutTail: string;
  stderrTail: string;
}

type ComposedPromptSummary = Prisma.ComposedPromptGetPayload<{
  select: {
    id: true;
    composedAt: true;
    status: true;
    triggerType: true;
    triggerSessionId: true;
  };
}>;

type CallSummary = Prisma.CallGetPayload<{
  select: {
    id: true;
    sessionId: true;
    session: { select: { sequenceNumber: true; learnerFacingNumber: true } };
    requestedModuleId: true;
    curriculumModuleId: true;
    endedAt: true;
    createdAt: true;
  };
}>;

type ModuleProgressSummary = Prisma.CallerModuleProgressGetPayload<{
  select: {
    moduleId: true;
    mastery: true;
    status: true;
    callCount: true;
    module: { select: { slug: true; title: true } };
  };
}>;

// --- Helpers ------------------------------------------------------------

function parseArgs(): Args {
  let persona = DEFAULT_PERSONA;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--persona=")) persona = a.slice("--persona=".length);
  }
  return { persona };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isAnthropic529(stderr: string, stdout: string): boolean {
  const text = `${stderr}\n${stdout}`;
  return /\b529\b/.test(text) && /overloaded/i.test(text);
}

/**
 * Spawn `npx tsx scripts/sim-drive-call.ts ...` and capture exit code +
 * tail of stdout/stderr for retry-classification.
 */
function runSimDriveCall(
  callerId: string,
  label: string,
  moduleSlug: ModuleSlug,
  persona: string,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.resolve(__dirname, "sim-drive-call.ts");
    const args: string[] = [
      "tsx",
      scriptPath,
      `--module=${moduleSlug}`,
      `--persona=${persona}`,
      `--turns=${TURNS_PER_CALL}`,
      callerId,
      label,
    ];

    const child = spawn("npx", args, {
      cwd: path.resolve(__dirname, ".."),
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdoutBuf = "";
    let stderrBuf = "";

    child.stdout.on("data", (chunk: Buffer) => {
      const s = chunk.toString();
      stdoutBuf += s;
      process.stdout.write(s);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const s = chunk.toString();
      stderrBuf += s;
      process.stderr.write(s);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      // Keep just the tails — the parent process already streamed everything.
      resolve({
        exitCode: code ?? -1,
        stdoutTail: stdoutBuf.slice(-2000),
        stderrTail: stderrBuf.slice(-2000),
      });
    });
  });
}

/**
 * Run one call with up to MAX_529_RETRIES retries if Anthropic returns 529.
 * Returns true on eventual success; false if all retries are exhausted.
 */
async function runOneCallWithRetries(
  callerId: string,
  label: string,
  moduleSlug: ModuleSlug,
  persona: string,
): Promise<boolean> {
  for (let attempt = 1; attempt <= MAX_529_RETRIES + 1; attempt++) {
    const attemptLabel = attempt === 1 ? label : `${label} (retry ${attempt - 1})`;
    console.log(
      `\n┌─ ${attemptLabel} ─ module=${moduleSlug} ─ persona=${persona.slice(0, 40)}…`,
    );
    const result = await runSimDriveCall(callerId, attemptLabel, moduleSlug, persona);
    if (result.exitCode === 0) {
      console.log(`└─ ${attemptLabel} ✓ exit 0\n`);
      return true;
    }
    const overloaded = isAnthropic529(result.stderrTail, result.stdoutTail);
    console.log(
      `└─ ${attemptLabel} ✗ exit ${result.exitCode}${overloaded ? " (Anthropic 529)" : ""}\n`,
    );
    if (!overloaded) {
      // Fail fast on anything other than a transient overload.
      console.error(
        `[demo-d002] ${attemptLabel} failed with non-retryable error. Stderr tail:\n${result.stderrTail}`,
      );
      return false;
    }
    if (attempt > MAX_529_RETRIES) {
      console.error(
        `[demo-d002] ${attemptLabel} hit 529 ${MAX_529_RETRIES} times — giving up.`,
      );
      return false;
    }
    console.log(
      `   waiting ${RETRY_BACKOFF_MS}ms before retry (Anthropic overload backoff)...`,
    );
    await sleep(RETRY_BACKOFF_MS);
  }
  return false;
}

/**
 * Look up the most recent Call.id for this caller — the one sim-drive-call
 * just created. We use it as the trigger anchor when polling for the next
 * ComposedPrompt.
 */
async function findLastCallId(callerId: string): Promise<string> {
  const last = await prisma.call.findFirst({
    where: { callerId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!last) {
    throw new Error(`No Call rows found for caller ${callerId} after a sim run`);
  }
  return last.id;
}

/**
 * Poll until a fresh ComposedPrompt with triggerSessionId === justEndedCall.sessionId
 * AND status === 'active' appears, or timeout. (#1344 Slice 4 — walks
 * via Session FK; pre-Slice 4 used `triggerCallId` directly.)
 */
async function pollForFreshComposedPrompt(
  callerId: string,
  justEndedCallId: string,
): Promise<ComposedPromptSummary | null> {
  const callRow = await prisma.call.findUnique({
    where: { id: justEndedCallId },
    select: { sessionId: true },
  });
  const triggerSessionId = callRow?.sessionId ?? null;
  if (!triggerSessionId) {
    console.error(
      `   ✗ Call ${justEndedCallId.slice(0, 8)} has no sessionId — pre-Slice-3 row or write failed.`,
    );
    return null;
  }
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts++;
    const fresh = await prisma.composedPrompt.findFirst({
      where: {
        callerId,
        triggerSessionId,
        status: "active",
      },
      orderBy: { composedAt: "desc" },
      select: {
        id: true,
        composedAt: true,
        status: true,
        triggerType: true,
        triggerSessionId: true,
      },
    });
    if (fresh) {
      console.log(
        `   ✓ Fresh ComposedPrompt ${fresh.id.slice(0, 8)} (trigger=${fresh.triggerType}, ` +
          `attempt ${attempts}, ~${Math.round((Date.now() - (deadline - POLL_TIMEOUT_MS)) / 1000)}s)`,
      );
      return fresh;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  console.error(
    `   ✗ Timed out after ${POLL_TIMEOUT_MS / 1000}s waiting for ComposedPrompt with ` +
      `triggerSessionId=${triggerSessionId} (attempts=${attempts})`,
  );
  return null;
}

// --- Main ---------------------------------------------------------------

async function main(): Promise<void> {
  const { persona } = parseArgs();
  const startedAt = Date.now();
  const runStamp = Math.floor(startedAt / 1000);
  const externalId = `${EXTERNAL_ID_PREFIX}${runStamp}`;

  console.log("\n┌─────────────────────────────────────────────────────────────");
  console.log("│  D002 — 3-call learner progression smoke");
  console.log("├─────────────────────────────────────────────────────────────");
  console.log(`│  externalId    ${externalId}`);
  console.log(`│  playbook      ${IELTS_PLAYBOOK_ID}  (IELTS Speaking Practice V1.0)`);
  console.log(`│  modules       ${MODULE_SLUGS.join(", ")}`);
  console.log(`│  turns/call    ${TURNS_PER_CALL}`);
  console.log(`│  persona       ${persona.slice(0, 60)}…`);
  console.log("└─────────────────────────────────────────────────────────────\n");

  // 1. Verify playbook exists — exit non-zero if not (no silent fallback).
  const playbook = await prisma.playbook.findUnique({
    where: { id: IELTS_PLAYBOOK_ID },
    select: { id: true, name: true, domainId: true, status: true },
  });
  if (!playbook) {
    console.error(
      `[demo-d002] FAIL — playbook ${IELTS_PLAYBOOK_ID} (IELTS Speaking Practice V1.0) not found in this DB.\n` +
        `Seed it first (npm run db:seed) or run the demo on a DB that has it.`,
    );
    await prisma.$disconnect();
    process.exit(1);
  }
  if (!playbook.domainId) {
    console.error(
      `[demo-d002] FAIL — playbook ${IELTS_PLAYBOOK_ID} has no domainId. Cannot create a caller without a domain.`,
    );
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(`[demo-d002] Playbook found: "${playbook.name}" (status=${playbook.status})`);

  // 2. Create fresh learner.
  const caller = await prisma.caller.create({
    data: {
      name: `D002 Demo Learner ${runStamp}`,
      externalId,
      role: "LEARNER",
      domainId: playbook.domainId,
    },
    select: { id: true, name: true },
  });
  console.log(`[demo-d002] Created caller ${caller.id} (${caller.name})`);

  // 3. Enroll in IELTS Speaking Practice V1.0. Use skipAutoCompose so we own
  //    the bootstrap composition call below — clearer for the demo.
  await enrollCaller(caller.id, IELTS_PLAYBOOK_ID, "demo-d002", undefined, {
    skipAutoCompose: true,
  });
  console.log(`[demo-d002] Enrolled in playbook ${IELTS_PLAYBOOK_ID}`);

  // 4. Bootstrap the first ComposedPrompt.
  await autoComposeForCaller(caller.id, IELTS_PLAYBOOK_ID);
  console.log(`[demo-d002] Bootstrap ComposedPrompt persisted`);

  // 5. Run 3 calls sequentially. After each call, poll for the
  //    pipeline-triggered ComposedPrompt before launching the next.
  const callPlan: Array<{ index: number; moduleSlug: ModuleSlug; label: string }> = MODULE_SLUGS.map(
    (m, i) => ({
      index: i + 1,
      moduleSlug: m,
      label: `D002 Call ${i + 1} — ${m}`,
    }),
  );

  for (const c of callPlan) {
    const ok = await runOneCallWithRetries(caller.id, c.label, c.moduleSlug, persona);
    if (!ok) {
      console.error(
        `[demo-d002] FAIL — Call ${c.index} (module=${c.moduleSlug}) failed beyond retries. Aborting cohort.`,
      );
      await prisma.$disconnect();
      process.exit(1);
    }

    if (c.index < callPlan.length) {
      const justEnded = await findLastCallId(caller.id);
      console.log(
        `   polling for ComposedPrompt with triggerCallId=${justEnded.slice(0, 8)}…`,
      );
      const fresh = await pollForFreshComposedPrompt(caller.id, justEnded);
      if (!fresh) {
        console.error(
          `[demo-d002] FAIL — pipeline did not produce a fresh ComposedPrompt after call ${c.index}. Aborting.`,
        );
        await prisma.$disconnect();
        process.exit(1);
      }
    } else {
      // Final call — still poll so the closing COMPOSE actually lands before
      // we snapshot module-progress + lo_mastery (those writes happen in
      // AGGREGATE upstream of COMPOSE, so by the time the final pipeline-
      // triggered ComposedPrompt exists, AGGREGATE is guaranteed done).
      const justEnded = await findLastCallId(caller.id);
      console.log(
        `   polling for final ComposedPrompt with triggerCallId=${justEnded.slice(0, 8)}…`,
      );
      const fresh = await pollForFreshComposedPrompt(caller.id, justEnded);
      if (!fresh) {
        console.error(
          `[demo-d002] FAIL — final COMPOSE never produced a fresh ComposedPrompt. Aborting.`,
        );
        await prisma.$disconnect();
        process.exit(1);
      }
    }
  }

  // 6. Snapshot + assert.
  console.log("\n┌─ SNAPSHOT ──────────────────────────────────────────────────");

  const calls: CallSummary[] = await prisma.call.findMany({
    where: { callerId: caller.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      sessionId: true,
      session: { select: { sequenceNumber: true, learnerFacingNumber: true } },
      requestedModuleId: true,
      curriculumModuleId: true,
      endedAt: true,
      createdAt: true,
    },
  });
  console.log(`│  Calls           ${calls.length}`);
  for (const c of calls) {
    const n = c.session?.learnerFacingNumber ?? c.session?.sequenceNumber ?? "?";
    console.log(
      `│    #${String(n).padStart(2)} ${c.id.slice(0, 8)} ` +
        `module=${c.requestedModuleId ?? "?"} ended=${c.endedAt ? "yes" : "no"}`,
    );
  }

  const pipelinePrompts: ComposedPromptSummary[] = await prisma.composedPrompt.findMany({
    where: { callerId: caller.id, triggerType: "pipeline" },
    orderBy: { composedAt: "asc" },
    select: {
      id: true,
      composedAt: true,
      status: true,
      triggerType: true,
      triggerSessionId: true,
    },
  });
  console.log(`│  Pipeline prompts ${pipelinePrompts.length}`);
  for (const p of pipelinePrompts) {
    console.log(
      `│    ${p.id.slice(0, 8)} trigger=${p.triggerSessionId?.slice(0, 8) ?? "—"} status=${p.status}`,
    );
  }

  const moduleProgress: ModuleProgressSummary[] = await prisma.callerModuleProgress.findMany({
    where: { callerId: caller.id },
    select: {
      moduleId: true,
      mastery: true,
      status: true,
      callCount: true,
      module: { select: { slug: true, title: true } },
    },
  });
  console.log(`│  Module progress ${moduleProgress.length}`);
  for (const mp of moduleProgress) {
    console.log(
      `│    [${mp.module.slug}] mastery=${mp.mastery.toFixed(2)} status=${mp.status} calls=${mp.callCount}`,
    );
  }

  // CallerAttribute lo_mastery rows per module.
  const loMasteryRows = await prisma.callerAttribute.findMany({
    where: {
      callerId: caller.id,
      key: { contains: ":lo_mastery:" },
      scope: "CURRICULUM",
      OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
    },
    select: { key: true, numberValue: true },
  });
  const loByModuleSlug = new Map<string, number>();
  for (const a of loMasteryRows) {
    // key shape: curriculum:<spec-slug>:lo_mastery:<moduleSlug>:<loRef>
    const parts = a.key.split(":");
    if (parts.length >= 5 && parts[2] === "lo_mastery") {
      const ms = parts[3];
      loByModuleSlug.set(ms, (loByModuleSlug.get(ms) ?? 0) + 1);
    }
  }
  console.log(`│  lo_mastery rows  ${loMasteryRows.length}`);
  for (const [slug, count] of loByModuleSlug.entries()) {
    console.log(`│    [${slug}] ${count} LO row(s)`);
  }

  console.log("└─────────────────────────────────────────────────────────────\n");

  // --- Assertions ---
  const failures: string[] = [];

  // (i) 3 Call rows with endedAt set.
  if (calls.length !== 3) {
    failures.push(`expected 3 Call rows, got ${calls.length}`);
  }
  const callsMissingEnd = calls.filter((c) => !c.endedAt);
  if (callsMissingEnd.length > 0) {
    failures.push(
      `${callsMissingEnd.length} Call row(s) missing endedAt: ${callsMissingEnd.map((c) => c.id.slice(0, 8)).join(", ")}`,
    );
  }

  // (ii) 3 pipeline-trigger ComposedPrompt rows whose triggerSessionIds match
  //      the 3 calls' parent Sessions in order. (#1344 Slice 4.)
  if (pipelinePrompts.length < 3) {
    failures.push(
      `expected at least 3 pipeline-triggered ComposedPrompts, got ${pipelinePrompts.length}`,
    );
  } else {
    const expectedTriggerIds = calls
      .slice(0, 3)
      .map((c) => c.sessionId ?? null);
    const actualTriggerIds = pipelinePrompts.slice(0, 3).map((p) => p.triggerSessionId);
    for (let i = 0; i < expectedTriggerIds.length; i++) {
      if (actualTriggerIds[i] !== expectedTriggerIds[i]) {
        failures.push(
          `ComposedPrompt #${i + 1} triggerSessionId mismatch: expected ${expectedTriggerIds[i]?.slice(0, 8) ?? "null"}, ` +
            `got ${actualTriggerIds[i]?.slice(0, 8) ?? "null"}`,
        );
      }
    }
  }

  // (iii) For each module credited: mastery > 0 AND status NOT stuck at
  //       NOT_STARTED. The #950 invariant is "mastery > 0 implies the
  //       status writer fired" — both IN_PROGRESS and COMPLETED satisfy it
  //       (COMPLETED can legitimately happen when a module is credited
  //       twice with high mastery before all 3 calls finish). The bug
  //       #950 catches is the stuck row: mastery > 0 + status = NOT_STARTED.
  //       Modules that received no scorable turns may legitimately have no
  //       CallerModuleProgress row — we only assert against rows that exist
  //       AND are linked to one of the 3 modules we drove.
  const drivenModuleSlugs = new Set<string>(MODULE_SLUGS);
  const drivenProgress = moduleProgress.filter((mp) => drivenModuleSlugs.has(mp.module.slug));
  if (drivenProgress.length === 0) {
    failures.push("no CallerModuleProgress rows for any of part1/part2/part3 — pipeline never credited a module");
  }
  for (const mp of drivenProgress) {
    if (mp.mastery <= 0) {
      failures.push(`[${mp.module.slug}] mastery=${mp.mastery} (expected > 0)`);
    }
    if (mp.status === "NOT_STARTED") {
      failures.push(
        `[${mp.module.slug}] mastery=${mp.mastery.toFixed(2)} but status=NOT_STARTED — #950 status-promotion bug`,
      );
    }
  }

  // (iv) For each module that has a CallerModuleProgress row, at least one
  //      lo_mastery CallerAttribute row should exist under that module slug.
  for (const mp of drivenProgress) {
    const loCount = loByModuleSlug.get(mp.module.slug) ?? 0;
    if (loCount === 0) {
      failures.push(`[${mp.module.slug}] no lo_mastery CallerAttribute rows (expected ≥1)`);
    }
  }

  const wallSec = Math.round((Date.now() - startedAt) / 1000);
  console.log("┌─ VERDICT ──────────────────────────────────────────────────");
  console.log(`│  Wall time      ${wallSec}s`);
  console.log(`│  Caller         ${caller.id}  (admin URL: /x/callers/${caller.id})`);
  console.log(`│  Failures       ${failures.length}`);
  for (const f of failures) {
    console.log(`│    ✗ ${f}`);
  }
  if (failures.length === 0) {
    console.log("│");
    console.log("│  ✓ PASS — adaptive loop closed end-to-end across 3 calls");
  } else {
    console.log("│");
    console.log(`│  ✗ FAIL: ${failures[0]}${failures.length > 1 ? ` (+${failures.length - 1} more)` : ""}`);
  }
  console.log("└─────────────────────────────────────────────────────────────\n");

  await prisma.$disconnect();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("[demo-d002] crash:", err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
