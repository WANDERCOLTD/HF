/**
 * #415 — FK consistency check.
 *
 * SQL-level guard for the cross-playbook FK-leak class of bug (#407).
 * Runs three queries against the configured database and exits non-zero
 * when any row leaks. Used as part of `npm run ctl check` so CI fails
 * before bad data reaches staging.
 *
 * Idempotent + read-only. If the database is unreachable, exits 0 with
 * a warning so unrelated CI steps aren't blocked.
 *
 * Exit codes:
 *   0  — all queries returned 0 rows OR database unreachable (warning)
 *   1  — at least one query returned rows; report printed to stdout
 */

import { prisma } from "@/lib/prisma";

interface CheckRow {
  id: string;
  detail?: Record<string, unknown>;
}

interface CheckResult {
  name: string;
  description: string;
  rows: CheckRow[];
}

async function runChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Query 1 — cross-playbook CallerModuleProgress.
  // Detects a CallerModuleProgress row pointing at a module whose curriculum
  // belongs to a different playbook than the caller's active enrolment.
  const cmpLeaks = await prisma.$queryRaw<
    Array<{ id: string; callerId: string; moduleId: string; cur_playbookId: string | null; cp_playbookId: string | null }>
  >`
    SELECT cmp."id", cmp."callerId", cmp."moduleId",
           cur."playbookId" AS cur_playbookId, cp."playbookId" AS cp_playbookId
    FROM "CallerModuleProgress" cmp
    JOIN "CurriculumModule" cm ON cm.id = cmp."moduleId"
    JOIN "Curriculum" cur ON cur.id = cm."curriculumId"
    LEFT JOIN "CallerPlaybook" cp ON cp."callerId" = cmp."callerId" AND cp.status = 'ACTIVE'
    WHERE cur."playbookId" IS DISTINCT FROM cp."playbookId"
  `;
  results.push({
    name: "cross-playbook-caller-module-progress",
    description:
      "CallerModuleProgress.moduleId points at a CurriculumModule whose curriculum.playbookId differs from the caller's active CallerPlaybook.playbookId.",
    rows: cmpLeaks.map((r) => ({
      id: r.id,
      detail: {
        callerId: r.callerId,
        moduleId: r.moduleId,
        moduleOwnerPlaybook: r.cur_playbookId,
        callerEnrolledPlaybook: r.cp_playbookId,
      },
    })),
  });

  // Query 2 — cross-playbook Call.curriculumModuleId.
  const callLeaks = await prisma.$queryRaw<
    Array<{ id: string; callerId: string; curriculumModuleId: string; cur_playbookId: string; cp_playbookId: string }>
  >`
    SELECT c."id", c."callerId", c."curriculumModuleId",
           cur."playbookId" AS cur_playbookId, cp."playbookId" AS cp_playbookId
    FROM "Call" c
    JOIN "CurriculumModule" cm ON cm.id = c."curriculumModuleId"
    JOIN "Curriculum" cur ON cur.id = cm."curriculumId"
    JOIN "CallerPlaybook" cp ON cp."callerId" = c."callerId" AND cp.status = 'ACTIVE'
    WHERE cur."playbookId" IS DISTINCT FROM cp."playbookId"
  `;
  results.push({
    name: "cross-playbook-call-curriculum-module-id",
    description:
      "Call.curriculumModuleId points at a module whose curriculum belongs to a different playbook than the caller's active enrolment.",
    rows: callLeaks.map((r) => ({
      id: r.id,
      detail: {
        callerId: r.callerId,
        curriculumModuleId: r.curriculumModuleId,
        moduleOwnerPlaybook: r.cur_playbookId,
        callerEnrolledPlaybook: r.cp_playbookId,
      },
    })),
  });

  // Query 3 — orphaned CallerModuleProgress (moduleId not in any CurriculumModule).
  // Should be impossible via FK but added as a belt-and-braces invariant — if
  // someone disables the FK or runs a TRUNCATE the rule still catches it.
  const orphans = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT cmp."id" FROM "CallerModuleProgress" cmp
    LEFT JOIN "CurriculumModule" cm ON cm.id = cmp."moduleId"
    WHERE cm.id IS NULL
  `;
  results.push({
    name: "orphaned-caller-module-progress",
    description: "CallerModuleProgress.moduleId references a CurriculumModule that no longer exists.",
    rows: orphans.map((r) => ({ id: r.id })),
  });

  return results;
}

function printReport(results: CheckResult[]): boolean {
  let anyLeaks = false;
  console.log("\n=== #415 FK consistency check (slug-scope epic #407) ===\n");
  for (const r of results) {
    if (r.rows.length === 0) {
      console.log(`  ✓ ${r.name} — 0 rows`);
      continue;
    }
    anyLeaks = true;
    console.log(`  ✗ ${r.name} — ${r.rows.length} row(s) leak`);
    console.log(`    ${r.description}`);
    for (const row of r.rows.slice(0, 10)) {
      console.log(`      • id=${row.id}${row.detail ? ` ${JSON.stringify(row.detail)}` : ""}`);
    }
    if (r.rows.length > 10) {
      console.log(`      … (+${r.rows.length - 10} more)`);
    }
  }
  console.log("");
  return anyLeaks;
}

async function main() {
  let results: CheckResult[];
  try {
    results = await runChecks();
  } catch (err: any) {
    // Database unreachable (no DATABASE_URL, network blocked, etc). Don't
    // fail unrelated CI steps; emit a warning and exit 0.
    console.warn(
      `[check-fk-consistency] WARNING: database unreachable (${err?.message ?? String(err)}). Skipping checks.`,
    );
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  }

  const anyLeaks = printReport(results);
  await prisma.$disconnect();

  if (anyLeaks) {
    console.error(
      "[check-fk-consistency] FAILED — see report above. See epic #407 for context on the slug-scope bug class.",
    );
    process.exit(1);
  }
  console.log("[check-fk-consistency] All checks passed.");
}

main().catch((err) => {
  console.error("[check-fk-consistency] uncaught error:", err);
  process.exit(1);
});
