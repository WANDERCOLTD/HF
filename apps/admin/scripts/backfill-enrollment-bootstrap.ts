/**
 * Backfill: ensure every ACTIVE `CallerPlaybook` enrollment has a
 * `ComposedPrompt(callerId, playbookId, status='active')` row — the
 * bootstrap prompt that closes the #1420 I-CT2 step 3 gap.
 *
 * Why: pre-#1420 the `/api/join/[token]` new-user path and
 * `/api/invite/accept` enrolled inside `prisma.$transaction`, which
 * trips the `!tx` guard in `lib/enrollment/index.ts::enrollCaller` and
 * silently skips `autoComposeForCaller`. Every brand-new caller enrolled
 * via those paths got an ACTIVE enrollment with no bootstrap prompt;
 * their Call 1 fell through to the hardcoded
 * `build-assistant-config.ts` fallback ("Welcome, Blush" hallucination,
 * 2026-06-09 live).
 *
 * Idempotent: re-running after a clean pass is a near-no-op. Every
 * call goes through `autoComposeForCaller`, which has its own
 * staleness short-circuit via `isPromptStale`.
 *
 * Safety: `--dry-run` is the DEFAULT. Pass `--execute` to write. Logs
 * a row count before/after. Per TL revision #1420: writes ONLY happen
 * with explicit `--execute`.
 *
 * Run:
 *   npx tsx scripts/backfill-enrollment-bootstrap.ts            (dry-run, default)
 *   npx tsx scripts/backfill-enrollment-bootstrap.ts --execute  (apply changes)
 *   npx tsx scripts/backfill-enrollment-bootstrap.ts --execute --caller <callerId>
 *   npx tsx scripts/backfill-enrollment-bootstrap.ts --execute --delay-ms 200
 *
 * @see github.com/.../issues/1420 (this story)
 * @see lib/enrollment/auto-compose.ts (the helper this script invokes)
 */

import { prisma } from "@/lib/prisma";
import { autoComposeForCaller } from "@/lib/enrollment/auto-compose";

interface CliArgs {
  execute: boolean;
  dryRun: boolean;
  delayMs: number;
  explicitCallerId: string | null;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const callerFlagIdx = args.indexOf("--caller");
  const explicitCallerId =
    callerFlagIdx >= 0 && args[callerFlagIdx + 1] ? args[callerFlagIdx + 1] : null;
  const delayFlagIdx = args.indexOf("--delay-ms");
  const delayMs =
    delayFlagIdx >= 0 && args[delayFlagIdx + 1]
      ? Math.max(0, parseInt(args[delayFlagIdx + 1], 10) || 0)
      : 100; // default 100ms between writes to avoid hot-write storms
  return { execute, dryRun: !execute, delayMs, explicitCallerId };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const { dryRun, delayMs, explicitCallerId } = parseArgs();

  console.log(
    `\n=== Backfill enrollment-bootstrap compose (#1420) ===\n` +
      `  mode: ${dryRun ? "DRY-RUN (pass --execute to apply)" : "EXECUTE"}\n` +
      (explicitCallerId ? `  caller filter: ${explicitCallerId}\n` : "") +
      `  inter-write delay: ${delayMs}ms\n`,
  );

  // 1. Find every ACTIVE enrollment.
  const enrollments = await prisma.callerPlaybook.findMany({
    where: {
      status: "ACTIVE",
      ...(explicitCallerId ? { callerId: explicitCallerId } : {}),
    },
    select: {
      callerId: true,
      playbookId: true,
      enrolledAt: true,
    },
    orderBy: { enrolledAt: "asc" },
  });

  if (enrollments.length === 0) {
    console.log("No ACTIVE enrollments match the filter — nothing to do.\n");
    return;
  }
  console.log(`  scanned ${enrollments.length} ACTIVE enrollment(s)...`);

  // 2. Filter to ones with no ACTIVE ComposedPrompt.
  const missing: typeof enrollments = [];
  for (const e of enrollments) {
    const hasPrompt = await prisma.composedPrompt.findFirst({
      where: { callerId: e.callerId, playbookId: e.playbookId, status: "active" },
      select: { id: true },
    });
    if (!hasPrompt) missing.push(e);
  }

  console.log(`  ${missing.length} enrollment(s) have no ACTIVE composed prompt — they need bootstrap.\n`);

  if (missing.length === 0) {
    console.log("Nothing to backfill. Clean.\n");
    return;
  }

  // Print a few for visibility.
  console.log("  First few that need bootstrap:");
  for (const e of missing.slice(0, 5)) {
    console.log(
      `    callerId=${e.callerId.slice(0, 8)} playbookId=${e.playbookId.slice(0, 8)} ` +
        `enrolledAt=${e.enrolledAt.toISOString()}`,
    );
  }
  if (missing.length > 5) {
    console.log(`    ...and ${missing.length - 5} more`);
  }
  console.log();

  if (dryRun) {
    console.log("DRY-RUN — no writes performed. Re-run with --execute to apply.\n");
    return;
  }

  // 3. Execute — fire autoCompose for each, in series, with delay.
  let composed = 0;
  let failed = 0;
  for (let i = 0; i < missing.length; i++) {
    const e = missing[i];
    try {
      await autoComposeForCaller(e.callerId, e.playbookId);
      composed += 1;
      console.log(
        `  [${i + 1}/${missing.length}] composed bootstrap for caller=${e.callerId.slice(0, 8)} ` +
          `playbook=${e.playbookId.slice(0, 8)}`,
      );
    } catch (err) {
      failed += 1;
      const reason = err instanceof Error ? err.message : String(err);
      console.error(
        `  [${i + 1}/${missing.length}] FAILED caller=${e.callerId.slice(0, 8)} ` +
          `playbook=${e.playbookId.slice(0, 8)}: ${reason}`,
      );
    }
    if (delayMs > 0 && i < missing.length - 1) {
      await sleep(delayMs);
    }
  }

  // 4. Final count: re-query to confirm.
  let stillMissing = 0;
  for (const e of missing) {
    const hasPrompt = await prisma.composedPrompt.findFirst({
      where: { callerId: e.callerId, playbookId: e.playbookId, status: "active" },
      select: { id: true },
    });
    if (!hasPrompt) stillMissing += 1;
  }

  console.log(
    `\n=== Backfill complete ===\n` +
      `  attempted: ${missing.length}\n` +
      `  composed:  ${composed}\n` +
      `  failed:    ${failed}\n` +
      `  still missing after writes: ${stillMissing}\n`,
  );

  if (stillMissing > 0) {
    console.warn(
      "Some enrollments still have no bootstrap prompt — check `compose_error` CallerAttribute rows for cause.\n",
    );
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error("[backfill-enrollment-bootstrap] FATAL:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
