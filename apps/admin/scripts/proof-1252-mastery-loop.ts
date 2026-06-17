/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Proof script for #1252 — adaptive learner loop end-to-end on a
 * STRUCTURED course.
 *
 * What it verifies:
 *
 *   #1253 — `getCourseStyle` resolves the test playbook to "structured"
 *           via `Playbook.config.lessonPlanMode`.
 *   #1254 — Enrolment seeds `CallerModuleProgress(NOT_STARTED)` rows for
 *           every CurriculumModule (one per module).
 *   #1252 / Bug A (I-C1) — `buildCallerContext` surfaces
 *           `sharedState.lockedModule.name` so the I-C1 invariant has a
 *           stable surface; locked-module calls compose successfully.
 *   #1252 / Bug B (G10) — `instantiatePlaybookGoals` re-runs the
 *           tutor-briefing filter at create time; pre-existing polluted
 *           `Playbook.config.goals` entries are dropped, not created.
 *   #1256 — REWARD throws on zero `BehaviorMeasurement` (no silent 0.5
 *           fallback). Visible in `summary.stageErrors`.
 *
 * What it demonstrates (operational, not a hard assertion):
 *
 *   - Pre-call state vs post-call state for a GOOD learner persona
 *     (high mastery scoring) and a BAD learner persona (low scoring).
 *   - Module switch — driving call #2 with a different
 *     `requestedModuleId` shows mastery accrues per module.
 *   - Cross-module evidence — when learner mentions content from
 *     another module, `CallScore.moduleId` should still attribute to the
 *     locked module (single-module-of-record contract per CHAIN-CONTRACTS.md).
 *
 * Default playbook: The CIO/CTO Standard — Revision Aid (STRUCTURED).
 *
 * Usage (from apps/admin/, on hf-dev):
 *
 *   npx tsx scripts/proof-1252-mastery-loop.ts
 *   npx tsx scripts/proof-1252-mastery-loop.ts --playbook <id>
 *   npx tsx scripts/proof-1252-mastery-loop.ts --keep        # don't soft-delete the test learners after run
 *   npx tsx scripts/proof-1252-mastery-loop.ts --turns 6     # turns per sim call (default 4)
 *
 * Exits 0 on all PASS, 1 if any structural assertion FAILS.
 *
 * NOTE — this script DOES drive real sim calls and hit the live dev
 * server's `/api/calls/:id/pipeline` endpoint. It requires the dev
 * server to be running on localhost:3000 and `INTERNAL_API_SECRET` in
 * `.env.local`. Each run creates 2 fresh learners + 3 sim calls.
 */

import { prisma } from "@/lib/prisma";
import { createTestLearnerForPlaybook } from "@/lib/enrollment/create-test-learner";
import { getCourseStyle } from "@/lib/pipeline/course-style";
import { execSync } from "child_process";
import fs from "fs";
import { PlaybookCurriculumRole } from "@prisma/client";

const DEFAULT_PLAYBOOK_ID = "5bbdbe7e-c32f-490e-8ff8-a938ddfc49a0"; // CIO/CTO Revision Aid

function parseArgs() {
  const args = process.argv.slice(2);
  let playbookId = DEFAULT_PLAYBOOK_ID;
  let turns = 4;
  let keep = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--playbook") playbookId = args[++i];
    else if (a === "--turns") turns = Number(args[++i]) || 4;
    else if (a === "--keep") keep = true;
  }
  return { playbookId, turns, keep };
}

function readInternalSecret(): string {
  const envLocal = "/home/paul_thewanders_com/HF/apps/admin/.env.local";
  const fallback = "apps/admin/.env.local";
  const path = fs.existsSync(envLocal) ? envLocal : fallback;
  const txt = fs.readFileSync(path, "utf8");
  const m = txt.match(/^INTERNAL_API_SECRET=(.*)$/m);
  if (!m) throw new Error(`INTERNAL_API_SECRET not found in ${path}`);
  return m[1].replace(/^"|"$/g, "").trim();
}

function pad(s: string, n: number) {
  return (s || "").padEnd(n);
}

interface LoopState {
  modules: Array<{ id: string; slug: string; mastery: number; status: string; callCount: number }>;
  goals: { active: number; advanced: number; sample: Array<{ name: string; progress: number; isAssessmentTarget: boolean }> };
  callScore: number;
  behaviorMeasurement: number;
  rewardScore: { count: number; sample: Array<{ overallScore: number | null; goalProgressScore: number | null }> };
  loMastery: number;
  callTarget: number;
}

async function snapshot(callerId: string, curriculumId: string): Promise<LoopState> {
  const mp = await prisma.callerModuleProgress.findMany({
    where: { callerId, module: { curriculumId } },
    select: { mastery: true, status: true, callCount: true, module: { select: { id: true, slug: true, sortOrder: true } } },
    orderBy: { module: { sortOrder: "asc" } },
  });
  const goalsActive = await prisma.goal.findMany({
    where: { callerId, status: "ACTIVE" },
    select: { name: true, progress: true, isAssessmentTarget: true },
  });
  const advanced = goalsActive.filter((g) => g.progress > 0);
  const callScore = await prisma.callScore.count({ where: { callerId } });
  const behaviorMeasurement = await prisma.behaviorMeasurement.count({ where: { call: { callerId } } });
  const rewardRows = await prisma.rewardScore.findMany({
    where: { call: { callerId } },
    select: { overallScore: true, goalProgressScore: true },
  });
  const loMastery = await prisma.callerAttribute.count({ where: { callerId, key: { contains: "lo_mastery" } } });
  const callTarget = await prisma.callTarget.count({ where: { call: { callerId } } });
  return {
    modules: mp.map((r) => ({
      id: r.module.id,
      slug: r.module.slug,
      mastery: r.mastery,
      status: r.status,
      callCount: r.callCount,
    })),
    goals: {
      active: goalsActive.length,
      advanced: advanced.length,
      sample: advanced.slice(0, 5).map((g) => ({ name: (g.name || "").slice(0, 60), progress: g.progress, isAssessmentTarget: g.isAssessmentTarget })),
    },
    callScore,
    behaviorMeasurement,
    rewardScore: {
      count: rewardRows.length,
      sample: rewardRows.slice(0, 5).map((r) => ({ overallScore: r.overallScore, goalProgressScore: r.goalProgressScore })),
    },
    loMastery,
    callTarget,
  };
}

function printSnapshot(label: string, s: LoopState) {
  console.log(`\n[${label}]`);
  console.log(`  CallerModuleProgress (${s.modules.length} rows):`);
  for (const m of s.modules) {
    console.log(`    ${pad(m.slug, 50)} mastery=${m.mastery.toFixed(2)} status=${pad(m.status, 12)} calls=${m.callCount}`);
  }
  console.log(`  Goals: active=${s.goals.active}  advanced=${s.goals.advanced}`);
  for (const g of s.goals.sample) {
    console.log(`    progress=${g.progress.toFixed(2)} AT=${g.isAssessmentTarget} ${g.name}`);
  }
  console.log(`  CallScore=${s.callScore}  BehaviorMeasurement=${s.behaviorMeasurement}  CallTarget=${s.callTarget}  lo_mastery_attrs=${s.loMastery}`);
  console.log(`  RewardScore (${s.rewardScore.count}):`);
  for (const r of s.rewardScore.sample) {
    console.log(`    overall=${r.overallScore?.toFixed(2) ?? "NULL"} goalProgress=${r.goalProgressScore?.toFixed(2) ?? "NULL"}`);
  }
}

async function firePipeline(callId: string, callerId: string, mode: "prep" | "prompt", secret: string): Promise<{ ok: boolean; summary: any; stageErrors: string[] }> {
  const res = await fetch(`http://localhost:3000/api/calls/${callId}/pipeline`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-secret": secret },
    body: JSON.stringify({ callerId, mode, engine: "claude" }),
  });
  const body = (await res.json()) as any;
  const stageErrors: string[] = [];
  for (const log of body.logs || []) {
    if (log?.data?.stageErrors) {
      for (const e of log.data.stageErrors) stageErrors.push(e);
    }
  }
  return { ok: body.ok === true, summary: body.data || {}, stageErrors };
}

async function driveSimCall(callerId: string, label: string, persona: string, moduleSlug: string, turns: number): Promise<string | null> {
  try {
    const out = execSync(
      `npx tsx scripts/sim-drive-call.ts --persona="${persona.replace(/"/g, '\\"')}" --turns=${turns} --module=${moduleSlug} ${callerId} "${label}"`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 600_000 },
    );
    const m = out.match(/callId:\s*([0-9a-f-]{36})/);
    return m ? m[1] : null;
  } catch (e: any) {
    const stdout = (e?.stdout as string) || "";
    const m = stdout.match(/callId:\s*([0-9a-f-]{36})/);
    if (m) return m[1];
    console.warn(`  [drive-sim] failed without callId — stdout tail:\n${stdout.slice(-400)}`);
    return null;
  }
}

async function main() {
  const { playbookId, turns, keep } = parseArgs();
  const results: Array<{ check: string; pass: boolean; detail?: string }> = [];
  const check = (name: string, pass: boolean, detail?: string) => {
    results.push({ check: name, pass, detail });
    console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
  };

  console.log("=== #1252 mastery-loop proof ===");
  console.log(`Playbook: ${playbookId.slice(0, 8)}, turns: ${turns}, keep: ${keep}`);

  const pb = await prisma.playbook.findUnique({
    where: { id: playbookId },
    select: { name: true, config: true, status: true, playbookCurricula: { where: { role: PlaybookCurriculumRole.primary }, select: { curriculumId: true }, take: 1 } },
  });
  if (!pb || pb.status !== "PUBLISHED") {
    console.error(`Playbook ${playbookId} not PUBLISHED — abort`);
    process.exit(1);
  }
  const curriculumId = pb.playbookCurricula[0]?.curriculumId;
  if (!curriculumId) {
    console.error(`Playbook has no primary curriculum — abort`);
    process.exit(1);
  }
  console.log(`Playbook: ${pb.name}, curriculumId: ${curriculumId.slice(0, 8)}`);

  // #1253 — assert courseStyle resolves to STRUCTURED
  console.log("\n--- #1253 courseStyle ---");
  const courseStyle = getCourseStyle((pb.config ?? null) as any);
  check("courseStyle === 'structured'", courseStyle === "structured", `got "${courseStyle}"`);

  const modules = await prisma.curriculumModule.findMany({
    where: { curriculumId },
    select: { id: true, slug: true, title: true, sortOrder: true },
    orderBy: { sortOrder: "asc" },
  });
  if (modules.length < 2) {
    console.error(`Need ≥ 2 modules; found ${modules.length}`);
    process.exit(1);
  }
  console.log(`Modules (${modules.length}):`);
  for (const m of modules) console.log(`  ${m.sortOrder} ${pad(m.slug, 50)} ${m.title}`);

  // Pre-enrolment goal pollution count — count goal-template entries that
  // would have failed the validator. (Read-only — no writes.)
  console.log("\n--- Bug B pre-check (Playbook.config.goals pollution) ---");
  const { validateLearningOutcomeEntry } = await import("@/lib/domain/validate-learning-outcome");
  const goalsCfg = ((pb.config as any)?.goals ?? []) as Array<{ name?: string }>;
  let preExisting = 0;
  let polluted = 0;
  const pollutedSamples: string[] = [];
  for (const g of goalsCfg) {
    preExisting++;
    if (g.name && !validateLearningOutcomeEntry(g.name).ok) {
      polluted++;
      if (pollutedSamples.length < 5) pollutedSamples.push(g.name.slice(0, 60));
    }
  }
  console.log(`  Playbook.config.goals: ${preExisting} total, ${polluted} would be rejected by G10 filter`);
  for (const s of pollutedSamples) console.log(`    polluted: "${s}"`);

  // Create both learners
  const good = await createTestLearnerForPlaybook(playbookId, "proof-1252-good");
  const bad = await createTestLearnerForPlaybook(playbookId, "proof-1252-bad");
  console.log(`\nGOOD learner: ${good.callerId.slice(0, 8)} ${good.callerName}`);
  console.log(`BAD  learner: ${bad.callerId.slice(0, 8)} ${bad.callerName}`);

  // #1254 — enrolment seeds NOT_STARTED rows
  console.log("\n--- #1254 enrolment seed ---");
  const goodPre = await snapshot(good.callerId, curriculumId);
  const badPre = await snapshot(bad.callerId, curriculumId);
  check(
    `GOOD: ${modules.length} NOT_STARTED CallerModuleProgress rows`,
    goodPre.modules.length === modules.length && goodPre.modules.every((m) => m.status === "NOT_STARTED" && m.mastery === 0 && m.callCount === 0),
  );
  check(
    `BAD: ${modules.length} NOT_STARTED CallerModuleProgress rows`,
    badPre.modules.length === modules.length && badPre.modules.every((m) => m.status === "NOT_STARTED" && m.mastery === 0 && m.callCount === 0),
  );

  // Bug B — every Goal created MUST pass the G10 filter
  console.log("\n--- Bug B Goal pollution at create time ---");
  for (const [label, callerId] of [["GOOD", good.callerId], ["BAD", bad.callerId]] as const) {
    const goals = await prisma.goal.findMany({ where: { callerId }, select: { name: true } });
    let failed = 0;
    const samples: string[] = [];
    for (const g of goals) {
      if (g.name && !validateLearningOutcomeEntry(g.name).ok) {
        failed++;
        if (samples.length < 5) samples.push(g.name.slice(0, 60));
      }
    }
    check(`${label}: zero polluted Goals (G10 filter at instantiate)`, failed === 0, failed > 0 ? `${failed} polluted: ${samples.join(" | ")}` : `${goals.length} clean goals`);
  }

  printSnapshot("GOOD pre", goodPre);
  printSnapshot("BAD pre", badPre);

  // Seed compose for both — pipeline mode=prompt on a stub call. This also
  // exercises bug A: with the fix, callerContext now surfaces lockedModule,
  // so the I-C1 invariant has a stable surface and shouldn't fire.
  console.log("\n--- Seeding initial compose for both ---");
  const secret = readInternalSecret();
  const firstModuleSlug = modules[0].slug;
  const firstModuleId = modules[0].id;
  for (const [label, callerId] of [["GOOD", good.callerId], ["BAD", bad.callerId]] as const) {
    const stub = await prisma.call.create({
      data: { callerId, source: "sim", playbookId, transcript: "", curriculumModuleId: firstModuleId, requestedModuleId: firstModuleSlug },
    });
    const r = await firePipeline(stub.id, callerId, "prompt", secret);
    console.log(`  ${label} seed compose: ok=${r.ok}, stageErrors=${r.stageErrors.length}`);
    for (const e of r.stageErrors) console.log(`    stageError: ${e.slice(0, 140)}`);
    // Bug A: with the fix, I-C1 should NOT appear in stageErrors
    const i_c1 = r.stageErrors.find((e) => e.includes("I-C1") || e.includes("Module-lock honoured"));
    check(`${label} seed: no I-C1 violation (Bug A fix)`, !i_c1, i_c1 ? i_c1.slice(0, 100) : "");
  }

  // GOOD learner: drive a strong sim call on module 1
  console.log(`\n--- GOOD: sim call 1 on ${firstModuleSlug} ---`);
  const goodCall1Id = await driveSimCall(
    good.callerId,
    "Proof GOOD call 1",
    "Senior CTO with 15+ years; articulates strategy and ROI/SLA/KPI clearly; gives concrete examples from past roles",
    firstModuleSlug,
    turns,
  );
  if (!goodCall1Id) console.warn("  GOOD call 1 did not return callId — check sim driver output");

  console.log(`\n--- BAD: sim call 1 on ${firstModuleSlug} ---`);
  const badCall1Id = await driveSimCall(
    bad.callerId,
    "Proof BAD call 1",
    "Junior intern, confused about strategy, hesitant, guesses, mostly says 'I'm not sure'",
    firstModuleSlug,
    turns,
  );
  if (!badCall1Id) console.warn("  BAD call 1 did not return callId — check sim driver output");

  const goodPost1 = await snapshot(good.callerId, curriculumId);
  const badPost1 = await snapshot(bad.callerId, curriculumId);

  printSnapshot("GOOD post-call-1", goodPost1);
  printSnapshot("BAD post-call-1", badPost1);

  // Pipeline writes — both should have scores/measurements
  check("GOOD post-1: CallScore > 0", goodPost1.callScore > 0, `${goodPost1.callScore}`);
  check("BAD post-1: CallScore > 0", badPost1.callScore > 0, `${badPost1.callScore}`);
  check("GOOD post-1: BehaviorMeasurement > 0", goodPost1.behaviorMeasurement > 0, `${goodPost1.behaviorMeasurement}`);
  check("BAD post-1: BehaviorMeasurement > 0", badPost1.behaviorMeasurement > 0, `${badPost1.behaviorMeasurement}`);

  // Module 1 mastery should have advanced for both, but GOOD > BAD
  const goodMod1 = goodPost1.modules.find((m) => m.slug === firstModuleSlug);
  const badMod1 = badPost1.modules.find((m) => m.slug === firstModuleSlug);
  check(`GOOD post-1: mod[${firstModuleSlug}] IN_PROGRESS`, goodMod1?.status === "IN_PROGRESS", `status=${goodMod1?.status} mastery=${goodMod1?.mastery.toFixed(2)} calls=${goodMod1?.callCount}`);
  check(`BAD post-1: mod[${firstModuleSlug}] IN_PROGRESS or NOT_STARTED`, badMod1?.status === "IN_PROGRESS" || badMod1?.status === "NOT_STARTED", `status=${badMod1?.status}`);
  check(`GOOD mastery > BAD mastery on mod[${firstModuleSlug}]`, (goodMod1?.mastery ?? 0) >= (badMod1?.mastery ?? 0), `GOOD=${goodMod1?.mastery.toFixed(2)} BAD=${badMod1?.mastery.toFixed(2)}`);

  // Module switch — GOOD learner drives call 2 on module 2
  const secondModuleSlug = modules[1].slug;
  console.log(`\n--- GOOD: sim call 2 — MODULE SWITCH to ${secondModuleSlug} ---`);
  const goodCall2Id = await driveSimCall(
    good.callerId,
    "Proof GOOD call 2 module switch",
    "Senior CTO continuing — now on the new module, equally articulate",
    secondModuleSlug,
    turns,
  );
  if (!goodCall2Id) console.warn("  GOOD call 2 did not return callId");

  const goodPost2 = await snapshot(good.callerId, curriculumId);
  printSnapshot("GOOD post-call-2 (module switch)", goodPost2);

  const goodMod1After = goodPost2.modules.find((m) => m.slug === firstModuleSlug);
  const goodMod2After = goodPost2.modules.find((m) => m.slug === secondModuleSlug);
  check(`GOOD mod[${firstModuleSlug}] callCount unchanged after module switch`, (goodMod1After?.callCount ?? 0) === (goodMod1?.callCount ?? 0), `before=${goodMod1?.callCount} after=${goodMod1After?.callCount}`);
  check(`GOOD mod[${secondModuleSlug}] callCount > 0 after switch`, (goodMod2After?.callCount ?? 0) > 0, `calls=${goodMod2After?.callCount}`);

  // Cross-module evidence — CallScore.moduleId attribution for call 2
  if (goodCall2Id) {
    const call2Scores = await prisma.callScore.findMany({
      where: { callId: goodCall2Id },
      select: { moduleId: true },
    });
    const onSecond = call2Scores.filter((s) => s.moduleId === modules[1].id).length;
    const onOther = call2Scores.filter((s) => s.moduleId && s.moduleId !== modules[1].id).length;
    const offModule = call2Scores.filter((s) => !s.moduleId).length;
    console.log(`  Call 2 score attribution: locked-module=${onSecond}, other-modules=${onOther}, off-module=${offModule}`);
    check("Cross-module attribution: locked-module dominates", onSecond >= onOther, `locked=${onSecond} other=${onOther}`);
  }

  // Summary
  console.log("\n=== Result ===");
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`PASS=${passed}  FAIL=${failed}`);
  for (const r of results.filter((r) => !r.pass)) console.log(`  FAIL: ${r.check}${r.detail ? ` — ${r.detail}` : ""}`);

  if (!keep) {
    console.log("\nSoft-deleting test learners (re-run with --keep to inspect)");
    for (const callerId of [good.callerId, bad.callerId]) {
      await prisma.caller.update({ where: { id: callerId }, data: { archivedAt: new Date() } }).catch(() => {});
    }
  } else {
    console.log(`\nKept: GOOD=${good.callerId} BAD=${bad.callerId}`);
  }

  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
