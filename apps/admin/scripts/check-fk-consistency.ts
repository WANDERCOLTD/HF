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
import { findAnchorDivergence, type AnchorCurriculum } from "./check-anchor-divergence";

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
  // #1177 Slice 6 — `cur."playbookId"` was dropped; the curriculum's owning
  // playbook now lives on PlaybookCurriculum(role='primary').
  const cmpLeaks = await prisma.$queryRaw<
    Array<{ id: string; callerId: string; moduleId: string; cur_playbookId: string | null; cp_playbookId: string | null }>
  >`
    SELECT cmp."id", cmp."callerId", cmp."moduleId",
           pbc."playbookId" AS cur_playbookId, cp."playbookId" AS cp_playbookId
    FROM "CallerModuleProgress" cmp
    JOIN "CurriculumModule" cm ON cm.id = cmp."moduleId"
    LEFT JOIN "PlaybookCurriculum" pbc ON pbc."curriculumId" = cm."curriculumId" AND pbc.role = 'primary'
    LEFT JOIN "CallerPlaybook" cp ON cp."callerId" = cmp."callerId" AND cp.status = 'ACTIVE'
    WHERE pbc."playbookId" IS DISTINCT FROM cp."playbookId"
  `;
  results.push({
    name: "cross-playbook-caller-module-progress",
    description:
      "CallerModuleProgress.moduleId points at a CurriculumModule whose owning playbook (via PlaybookCurriculum primary) differs from the caller's active CallerPlaybook.playbookId.",
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
  // Same rewrite as Query 1.
  const callLeaks = await prisma.$queryRaw<
    Array<{ id: string; callerId: string; curriculumModuleId: string; cur_playbookId: string; cp_playbookId: string }>
  >`
    SELECT c."id", c."callerId", c."curriculumModuleId",
           pbc."playbookId" AS cur_playbookId, cp."playbookId" AS cp_playbookId
    FROM "Call" c
    JOIN "CurriculumModule" cm ON cm.id = c."curriculumModuleId"
    LEFT JOIN "PlaybookCurriculum" pbc ON pbc."curriculumId" = cm."curriculumId" AND pbc.role = 'primary'
    JOIN "CallerPlaybook" cp ON cp."callerId" = c."callerId" AND cp.status = 'ACTIVE'
    WHERE pbc."playbookId" IS DISTINCT FROM cp."playbookId"
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

  // Query 4 — #615 — orphan LearningObjective.
  // A LearningObjective whose moduleId references a CurriculumModule that
  // no longer exists. Should be impossible via the FK but added as a
  // belt-and-braces invariant — same pattern as Query 3 for the LO ↔ module
  // soft-FK shape. Mirrors audit-epic-100 counter `orphanLearningObjectives`
  // so the failure surfaces at CI step 5 (check-fk-consistency) before
  // step 6 (audit) re-detects it.
  const orphanLOs = await prisma.$queryRaw<Array<{ id: string; moduleId: string }>>`
    SELECT lo."id", lo."moduleId"
    FROM "LearningObjective" lo
    LEFT JOIN "CurriculumModule" cm ON cm.id = lo."moduleId"
    WHERE cm.id IS NULL
  `;
  results.push({
    name: "orphan-learning-objective",
    description:
      "LearningObjective.moduleId references a CurriculumModule that no longer exists. #615 — surfaces after #607's PlaybookSubject unlink if an empty subject was the LO's only host.",
    rows: orphanLOs.map((r) => ({ id: r.id, detail: { moduleId: r.moduleId } })),
  });

  // Query 5 — #615 — dangling ContentAssertion.learningObjectiveId.
  // `ContentAssertion.learningObjectiveId` is a SOFT FK (nullable column,
  // no DB-level enforcement). `reconcile-lo-linkage.ts` is supposed to
  // null these out when the LO disappears, but it runs on a cadence and
  // can lag a delete. This check fails CI before the lag becomes a silent
  // mastery-derivation bug.
  const danglingCAs = await prisma.$queryRaw<Array<{ id: string; learningObjectiveId: string }>>`
    SELECT ca."id", ca."learningObjectiveId"
    FROM "ContentAssertion" ca
    LEFT JOIN "LearningObjective" lo ON lo.id = ca."learningObjectiveId"
    WHERE ca."learningObjectiveId" IS NOT NULL AND lo.id IS NULL
  `;
  results.push({
    name: "dangling-content-assertion-lo",
    description:
      "ContentAssertion.learningObjectiveId is non-null but the referenced LearningObjective no longer exists (soft-FK). `reconcile-lo-linkage.ts` should null these; #615 catches lag.",
    rows: danglingCAs.map((r) => ({ id: r.id, detail: { learningObjectiveId: r.learningObjectiveId } })),
  });

  // Query 6 — #1081 Slice 2B.3 — qualificationAnchor slug-set divergence.
  // For every distinct non-null qualificationAnchor, all Curricula in the
  // group must agree on their CurriculumModule.slug set + LearningObjective.ref
  // set per module. Divergence indicates two Curricula are labelled as the
  // same regulated qualification but teach materially different things — a
  // data-integrity break the CI must catch before downstream rollups (Slice 3)
  // can trust the anchor.
  //
  // Null-anchor Curricula are ignored — legacy data predating Slice 2B.1 and
  // ad-hoc/internal Curricula carry no anchor and are not comparable.
  const anchorCurricula: AnchorCurriculum[] = await prisma.curriculum.findMany({
    where: { qualificationAnchor: { not: null } },
    select: {
      id: true,
      slug: true,
      name: true,
      qualificationAnchor: true,
      createdAt: true,
      modules: {
        select: {
          slug: true,
          learningObjectives: { select: { ref: true } },
        },
      },
    },
  });
  const divergences = findAnchorDivergence(anchorCurricula);
  results.push({
    name: "qualification-anchor-divergence",
    description:
      "Curricula sharing a non-null qualificationAnchor must agree on their CurriculumModule.slug set and LearningObjective.ref set per module. Divergence indicates two Curricula labelled as the same regulated qualification teach materially different things (#1081 Slice 2B.3).",
    rows: divergences.map((d) => ({
      id: d.otherCurriculumId,
      detail: {
        anchor: d.anchor,
        canonicalCurriculum: { id: d.canonicalCurriculumId, slug: d.canonicalCurriculumSlug },
        otherCurriculum: { id: d.otherCurriculumId, slug: d.otherCurriculumSlug },
        kind: d.kind,
        ...(d.kind === "modules"
          ? {
              modulesOnlyInCanonical: d.modulesOnlyInCanonical,
              modulesOnlyInOther: d.modulesOnlyInOther,
            }
          : {
              moduleSlug: d.moduleSlug,
              loRefsOnlyInCanonical: d.loRefsOnlyInCanonical,
              loRefsOnlyInOther: d.loRefsOnlyInOther,
            }),
      },
    })),
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
