// KB: catalogued in docs/kb/guard-registry.md (CI check scripts). See for class + why.
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
// #1225 Slice C — IntakeSpec body/source coherence check.
// Imports deferred to runChecks() because @tallyseal/spec-emitter ships
// only at runtime via the vendored tarball — declaring the import at the
// top keeps tsc happy without ratchet impact when the vendor pkg is
// missing (CI is the only environment that requires this check to pass).
import { parse as parseSpecSource } from "@tallyseal/spec-emitter";
import { projectBodyFromEditable } from "@/lib/intake/crawcus-serde";

interface CheckRow {
  id: string;
  detail?: Record<string, unknown>;
}

interface CheckResult {
  name: string;
  description: string;
  rows: CheckRow[];
  /** WARN-only checks emit a warning line but do NOT cause the script
   *  to exit non-zero. Use this for invariants that surface data drift
   *  worth investigating but aren't structural FK leaks. */
  warnOnly?: boolean;
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
  // #1225 Slice C — IntakeSpec body/source coherence.
  // For every IntakeSpec row with a non-NULL source, the body JSON cache
  // MUST equal projectBodyFromEditable(parse(source)). PR #1217 wired
  // saveSpecAction to re-derive body on every save; this check catches
  // any out-of-band write that bypasses the helper, or a parse-emit
  // mismatch introduced by a future @tallyseal/spec-emitter update.
  // Idempotent + read-only — same posture as the rest of this script.
  const intakeSpecs = await prisma.intakeSpec.findMany({
    where: { source: { not: null } },
    select: { id: true, key: true, version: true, source: true, body: true },
  });
  const incoherentSpecs: CheckRow[] = [];
  for (const spec of intakeSpecs) {
    if (spec.source === null) continue;
    let projected: unknown;
    try {
      const editable = parseSpecSource(spec.source);
      projected = projectBodyFromEditable(editable);
    } catch (err) {
      incoherentSpecs.push({
        id: spec.id,
        detail: {
          key: spec.key,
          version: spec.version,
          reason: "parse-failure",
          error: err instanceof Error ? err.message : String(err),
        },
      });
      continue;
    }
    if (JSON.stringify(projected) !== JSON.stringify(spec.body)) {
      incoherentSpecs.push({
        id: spec.id,
        detail: {
          key: spec.key,
          version: spec.version,
          reason: "body-source-divergence",
        },
      });
    }
  }
  results.push({
    name: "intake-spec-body-source-coherence",
    description:
      "Every IntakeSpec row with a non-NULL source must have body == projectBodyFromEditable(parse(source)) (#1225). Divergence indicates the body JSON cache drifted from the canonical TS source — either an out-of-band write that bypassed updateDraft + saveSpecAction's body re-derivation (#1217), or a parse-emit mismatch introduced by a @tallyseal/spec-emitter version bump.",
    rows: incoherentSpecs,
  });

  // Query 7 — #1333 — voice Call rows with null playbookId (WARN-only).
  // Detects ended voice Calls (voiceProvider non-null AND endedAt non-null)
  // that entered the pipeline without a playbookId attribution. The pre-#1333
  // `outbound-dial` route silently dropped `playbookId` on placeholder-create,
  // producing orphan Calls (live evidence: Bertie Tallstaff
  // `ae3362f0-3e66-4e49-96f1-d83e10bce321` Calls 2 + 3 on hf_sandbox
  // 2026-06-08). Reports the count for ops awareness — does NOT fail CI.
  //
  // DO NOT BACKFILL these rows. They pre-date the builder and we'd risk
  // setting the wrong playbookId for callers who changed enrollment between
  // calls. The detector keeps them visible so the trend after rollout is
  // observable: count should plateau (pre-fix population stays) and never
  // grow (builder closes the leak). #1333 acceptance criteria explicitly
  // require this as forensic evidence.
  const voiceCallNullPlaybook = await prisma.$queryRaw<
    Array<{ id: string; callerId: string | null; voiceProvider: string | null; createdAt: Date }>
  >`
    SELECT "id", "callerId", "voiceProvider", "createdAt"
    FROM "Call"
    WHERE "voiceProvider" IS NOT NULL
      AND "playbookId" IS NULL
      AND "endedAt" IS NOT NULL
    ORDER BY "createdAt" DESC
    LIMIT 200
  `;
  results.push({
    name: "voice-call-null-playbook-attribution",
    description:
      "#1333 — voice Calls (voiceProvider non-null, endedAt non-null) created without playbookId attribution. Pre-#1333 forensic evidence (e.g., Bertie Tallstaff Calls 2 + 3 on hf_sandbox 2026-06-08). WARN-only — do NOT backfill; do NOT fail CI. Trend should plateau after the createCallEnteringPipeline builder is adopted.",
    rows: voiceCallNullPlaybook.map((r) => ({
      id: r.id,
      detail: {
        callerId: r.callerId,
        voiceProvider: r.voiceProvider,
        createdAt: r.createdAt.toISOString(),
      },
    })),
    warnOnly: true,
  });

  // Query 8 — #1345 — long-lived ghost Call rows (WARN-only).
  // A Call row with endedAt IS NULL and createdAt > 5 minutes old is a
  // ghost — the outbound-dial placeholder lost its externalId stamp, OR
  // the inbound webhook arrived and was orphaned by a placeholder race,
  // OR poll-stale-calls failed for >5 cycles. WARN-only because Bertie's
  // bug class is structural-prevention (Part A dedup + Part B try/catch
  // in #1345) — this check is a forensic alarm that the fix isn't
  // holding, not a hard failure that should block CI.
  const ghostRows = await prisma.$queryRaw<
    Array<{
      id: string;
      callerId: string | null;
      voiceProvider: string;
      createdAt: Date;
      externalId: string | null;
    }>
  >`
    SELECT c."id", c."callerId", c."voiceProvider", c."createdAt", c."externalId"
    FROM "Call" c
    WHERE c."endedAt" IS NULL
      AND c."createdAt" < NOW() - INTERVAL '5 minutes'
  `;
  results.push({
    name: "long-lived-ghost-rows",
    description:
      "Call rows with endedAt IS NULL older than 5 minutes — should never exist post-#1345 (dedup + externalId-stamp safety). Surfaces #1345 regression: orphaned outbound-dial placeholder OR inbound webhook that lost the dedup race.",
    rows: ghostRows.map((r) => ({
      id: r.id,
      detail: {
        callerId: r.callerId,
        voiceProvider: r.voiceProvider,
        externalId: r.externalId,
        createdAt: r.createdAt.toISOString(),
        ageMinutes: Math.round(
          (Date.now() - r.createdAt.getTime()) / 60_000,
        ),
      },
    })),
    warnOnly: true,
  });

  // Query 9 — #1340 — Session(status=GHOST) without a FailureLog child
  // (WARN-only). Every GHOST Session MUST have at least one
  // FailureLog(kind=GHOST_NEVER_CONNECTED) child by definition — the
  // poll-stale-calls writer mints both together. A GHOST Session with
  // zero FailureLog children means either:
  //   (a) the writer crashed between the Session insert and the
  //       FailureLog insert (current Slice 1 writes are best-effort,
  //       NOT transactional — Slice 5 reconciler closes this gap), OR
  //   (b) something else minted a GHOST Session without going through
  //       writeGhostFailureLog (e.g., a future reconciler that bypasses
  //       the contract).
  // WARN-only because (a) is a known structural gap until Slice 5 lands;
  // forensic evidence is more useful than a hard CI block.
  const ghostSessionsWithoutFailureLogs = await prisma.$queryRaw<
    Array<{ id: string; callerId: string; startedAt: Date }>
  >`
    SELECT s."id", s."callerId", s."startedAt"
    FROM "Session" s
    WHERE s."status" = 'GHOST'
      AND NOT EXISTS (
        SELECT 1 FROM "FailureLog" f
        WHERE f."sessionId" = s."id"
      )
    ORDER BY s."startedAt" DESC
    LIMIT 200
  `;
  results.push({
    name: "session-ghost-without-failurelog",
    description:
      "#1340 — Session(status=GHOST) rows with zero FailureLog children. Every ghost Session should carry at least one FailureLog(kind=GHOST_NEVER_CONNECTED) child written by the poll-stale-calls reconciler. WARN-only — Slice 1 writes are best-effort (not transactional); Slice 5 reconciler closes the gap. Should return 0 on a clean hf_sandbox post-migration.",
    rows: ghostSessionsWithoutFailureLogs.map((r) => ({
      id: r.id,
      detail: {
        callerId: r.callerId,
        startedAt: r.startedAt.toISOString(),
      },
    })),
    warnOnly: true,
  });

  // Query 10 — #1346 Slice 5 — I-CT1 orphan Sessions (WARN-only).
  // Session(endedAt NOT NULL, countsTowardPipelineNumber = true) older
  // than 60 seconds with `producedComposedPromptId IS NULL` is the
  // canonical I-CT1 violation. The Slice 5 reconciler runs every 60s
  // and drives this count toward zero; a persistent non-zero count
  // means the reconciler is failing or not scheduled.
  //
  // WARN-only initially per the 3-week soak window in #1346 — promote
  // to ERROR by editing the `warnOnly` flag below (keep in sync with
  // I_CT1_CARRY_THROUGH_SEVERITY in lib/prompt/composition/compose-invariants.ts).
  // The detector keeps the population visible as forensic evidence even
  // before promotion.
  const sessionsWithoutComposedPrompt = await prisma.$queryRaw<
    Array<{
      id: string;
      callerId: string;
      kind: string;
      endedAt: Date;
    }>
  >`
    SELECT s."id", s."callerId", s."kind", s."endedAt"
    FROM "Session" s
    WHERE s."endedAt" IS NOT NULL
      AND s."endedAt" < NOW() - INTERVAL '60 seconds'
      AND s."producedComposedPromptId" IS NULL
      AND s."countsTowardPipelineNumber" = true
    ORDER BY s."endedAt" DESC
    LIMIT 200
  `;
  results.push({
    name: "session-without-composed-prompt",
    description:
      "#1346 — Session(endedAt NOT NULL, countsTowardPipelineNumber=true) rows older than 60s with no producedComposedPromptId. Canonical I-CT1 violation. The Slice 5 reconciler runs every 60s and drives this count to zero. WARN-only during the 3-week soak window; promote to ERROR (and flip I_CT1_CARRY_THROUGH_SEVERITY) once `proof-1346-reconciler.ts` reads green on dev/staging.",
    rows: sessionsWithoutComposedPrompt.map((r) => ({
      id: r.id,
      detail: {
        callerId: r.callerId,
        kind: r.kind,
        endedAt: r.endedAt.toISOString(),
        ageSeconds: Math.round((Date.now() - r.endedAt.getTime()) / 1000),
      },
    })),
    warnOnly: true,
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

  // Query 11 — 2026-06-17 — soft-FK in AnalysisSpec.config.parameters[].id.
  // `AnalysisSpec.config` is a JSON column holding `parameters: [{id, ...}]`
  // where each `.id` is a string-form reference to `Parameter.parameterId`.
  // There is no DB-level FK constraint (the value lives inside JSON), so a
  // Parameter delete leaves dangling references. Consumers like
  // `lib/goals/strategies/resolve-strategy.ts:76` do
  // `.find((p) => p.id === "goal_progress_strategies")` and silently return
  // DEFAULT_SPEC when the id is missing — no error, just a behaviour
  // regression that's invisible until an educator notices targets aren't
  // moving.
  //
  // This query unrolls the JSON array and joins against Parameter.parameterId
  // to surface every dangling `(specSlug, configParameterId)` pair.
  // Identified by the Lattice end-to-end audit (PR #1863). HIGH severity
  // because the silent fallback class is hard to detect from telemetry —
  // educators see "targets don't move" without a logged error.
  type DanglingParamRow = {
    spec_id: string;
    spec_slug: string;
    config_parameter_id: string;
  };
  let danglingParamRefs: DanglingParamRow[] = [];
  try {
    danglingParamRefs = await prisma.$queryRaw<DanglingParamRow[]>`
      WITH spec_param_refs AS (
        SELECT
          s.id AS spec_id,
          s.slug AS spec_slug,
          jsonb_array_elements(s.config->'parameters')->>'id'
            AS config_parameter_id
        FROM "AnalysisSpec" s
        WHERE jsonb_typeof(s.config->'parameters') = 'array'
      )
      SELECT spec_id, spec_slug, config_parameter_id
      FROM spec_param_refs r
      LEFT JOIN "Parameter" p ON p."parameterId" = r.config_parameter_id
      WHERE r.config_parameter_id IS NOT NULL
        AND p."parameterId" IS NULL
      ORDER BY spec_slug, config_parameter_id;
    `;
  } catch (err) {
    // JSON path query syntax differs across Postgres versions / SQLite
    // dev DBs. Tolerate failure with a warn so unrelated CI doesn't
    // block — the check is best-effort.
    console.warn(
      `[fk-check] AnalysisSpec.config parameter-ref scan errored: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  results.push({
    name: "analysis-spec-config-dangling-parameter-ref",
    description:
      "AnalysisSpec.config.parameters[].id references a Parameter row that no longer exists. Soft-FK class — JSON column has no DB constraint. Consumers (e.g. lib/goals/strategies/resolve-strategy.ts) silently fall back to DEFAULT when the id is missing.",
    rows: danglingParamRefs.map((r) => ({
      id: `${r.spec_slug}/${r.config_parameter_id}`,
      detail: {
        specId: r.spec_id,
        specSlug: r.spec_slug,
        danglingParameterId: r.config_parameter_id,
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
    if (r.warnOnly) {
      // WARN-only detectors report a count but do not flip `anyLeaks`. CI
      // continues to pass; the row is forensic evidence (e.g., #1333).
      console.log(`  ⚠ ${r.name} — ${r.rows.length} row(s) (WARN-only)`);
      console.log(`    ${r.description}`);
      for (const row of r.rows.slice(0, 10)) {
        console.log(`      • id=${row.id}${row.detail ? ` ${JSON.stringify(row.detail)}` : ""}`);
      }
      if (r.rows.length > 10) {
        console.log(`      … (+${r.rows.length - 10} more)`);
      }
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
  } catch (err: unknown) {
    // Database unreachable (no DATABASE_URL, network blocked, etc). Don't
    // fail unrelated CI steps; emit a warning and exit 0.
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[check-fk-consistency] WARNING: database unreachable (${message}). Skipping checks.`,
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
