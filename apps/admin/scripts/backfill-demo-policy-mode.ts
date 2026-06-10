/**
 * Backfill `CallerPlaybook.policyMode='demo'` for synthetic test
 * callers — #1429.
 *
 * Idempotent and dry-run by default. Run via:
 *
 *   npx tsx scripts/backfill-demo-policy-mode.ts            # dry-run
 *   npx tsx scripts/backfill-demo-policy-mode.ts --execute  # writes
 *
 * Selection: every `CallerPlaybook` row whose `Caller.email` matches
 * `%@hf-admin.local` (the marker used by `/api/intake/v2/admin-test-enrol`
 * since 2026-06-07). The `.local` TLD is non-routable so the email
 * predicate is a robust forensic marker even for callers whose
 * `externalId` no longer follows the `admin-test-*` convention.
 *
 * Idempotency: rows already at `policyMode='demo'` are skipped. Running
 * the script twice in a row updates zero rows on the second pass.
 *
 * Run from inside `apps/admin/`.
 */

import { prisma } from "@/lib/prisma";

interface BackfillSummary {
  dryRun: boolean;
  matched: number;
  alreadyDemo: number;
  willUpdate: number;
  updated: number;
}

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  const dryRun = !execute;

  console.log(
    `[backfill-demo-policy-mode] mode=${dryRun ? "DRY-RUN" : "EXECUTE"} — scanning @hf-admin.local callers...`,
  );

  // Pull every CallerPlaybook for callers with @hf-admin.local emails.
  // The join is on the `email` column directly — the rule-of-thumb for
  // synthetic-caller detection at the time #1429 lands.
  const rows = await prisma.callerPlaybook.findMany({
    where: {
      caller: {
        email: { endsWith: "@hf-admin.local" },
      },
    },
    select: {
      id: true,
      callerId: true,
      playbookId: true,
      policyMode: true,
      caller: { select: { email: true, name: true } },
    },
  });

  const summary: BackfillSummary = {
    dryRun,
    matched: rows.length,
    alreadyDemo: rows.filter((r) => r.policyMode === "demo").length,
    willUpdate: rows.filter((r) => r.policyMode !== "demo").length,
    updated: 0,
  };

  console.log(`[backfill-demo-policy-mode] matched=${summary.matched}`);
  console.log(
    `[backfill-demo-policy-mode] alreadyDemo=${summary.alreadyDemo} willUpdate=${summary.willUpdate}`,
  );

  for (const row of rows) {
    if (row.policyMode === "demo") continue;
    console.log(
      `[backfill-demo-policy-mode]   → ${row.caller?.name ?? row.callerId.slice(0, 8)} <${row.caller?.email}> playbook=${row.playbookId} ${row.policyMode} → demo`,
    );
  }

  if (dryRun) {
    console.log(
      "[backfill-demo-policy-mode] DRY-RUN — no writes performed. Re-run with --execute to apply.",
    );
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (summary.willUpdate === 0) {
    console.log("[backfill-demo-policy-mode] nothing to update — already idempotent.");
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const result = await prisma.callerPlaybook.updateMany({
    where: {
      caller: {
        email: { endsWith: "@hf-admin.local" },
      },
      policyMode: { not: "demo" },
    },
    data: { policyMode: "demo" },
  });

  summary.updated = result.count;
  console.log(`[backfill-demo-policy-mode] updated=${summary.updated} rows`);
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((err) => {
    console.error("[backfill-demo-policy-mode] FATAL:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
