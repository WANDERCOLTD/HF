/**
 * Snapshot Caleb's IELTS course progression from the dev DB. Used to
 * eyeball measurement integrity during the mode-kill epic (#566).
 *
 * Usage:
 *   npx tsx scripts/snap-ielts-progress.ts
 *
 * Prints per-call score counts, module mastery percentages, and per-LO
 * sub-scores. Intentionally read-only.
 */

import { PrismaClient } from "@prisma/client";

const CALEB_CALLER_ID = "17b1b0b7-4837-4ece-9ae5-f94a967e5ff9";
const IELTS_PLAYBOOK_ID = "e460cd6f-0d0c-4948-9d8e-1ce696d4dfd3";

const p = new PrismaClient();

async function main() {
  const curric = await p.curriculum.findFirst({
    where: { playbookId: IELTS_PLAYBOOK_ID },
    select: { id: true },
  });
  const modules = curric
    ? await p.curriculumModule.findMany({
        where: { curriculumId: curric.id },
        orderBy: { sortOrder: "asc" },
        select: { id: true, slug: true, title: true },
      })
    : [];
  const progress = await p.callerModuleProgress.findMany({
    where: { callerId: CALEB_CALLER_ID, moduleId: { in: modules.map((m) => m.id) } },
  });
  const calls = await p.call.findMany({
    where: { callerId: CALEB_CALLER_ID, playbookId: IELTS_PLAYBOOK_ID },
    orderBy: { callSequence: "asc" },
    select: {
      id: true,
      callSequence: true,
      source: true,
      endedAt: true,
      requestedModuleId: true,
      curriculumModuleId: true,
      transcript: true,
      _count: { select: { scores: true } },
    },
  });
  const scores = await p.callScore.findMany({
    where: { callerId: CALEB_CALLER_ID },
    select: {
      callId: true,
      parameterId: true,
      score: true,
      moduleId: true,
      hasLearnerEvidence: true,
      evidenceQuality: true,
    },
  });
  const paramRows = await p.parameter.findMany({
    where: { id: { in: scores.map((s) => s.parameterId) } },
    select: { id: true, parameterId: true, name: true },
  });
  const paramMap: Record<string, string> = Object.fromEntries(
    paramRows.map((p) => [p.id, (p.parameterId || p.name || p.id.slice(0, 6)).toString()]),
  );
  const moduleMap: Record<string, string> = Object.fromEntries(modules.map((m) => [m.id, m.slug]));

  console.log("=== MODULE MASTERY ===");
  for (const m of modules) {
    const pr = progress.find((x) => x.moduleId === m.id);
    const lo = pr?.loScoresJson as Record<string, { mastery: number; callCount: number }> | null | undefined;
    const loSummary = lo
      ? Object.entries(lo)
          .map(([k, v]) => `${k}=${(v.mastery * 100).toFixed(0)}%`)
          .join(",")
      : "(none)";
    console.log(
      `  [${m.slug.padEnd(6)}] ${m.title.padEnd(34)} status=${(pr?.status ?? "—").padEnd(11)} mastery=${pr ? (pr.mastery * 100).toFixed(1).padStart(5) + "%" : "    —"}  calls=${pr?.callCount ?? 0}  loScores=${loSummary}`,
    );
  }

  console.log("\n=== CALLS ===");
  for (const c of calls) {
    const len = c.transcript?.length ?? 0;
    const moduleSlug = c.curriculumModuleId ? moduleMap[c.curriculumModuleId] : c.requestedModuleId ?? "(none)";
    console.log(
      `  #${c.callSequence} ${c.id.slice(0, 8)} src=${c.source} ended=${c.endedAt ? "Y" : "N"} module=${(moduleSlug || "(none)").padEnd(6)} transcript=${String(len).padStart(5)}ch scores=${c._count.scores}`,
    );
  }

  console.log("\n=== CALL SCORES (by parameter) ===");
  const scoresByCall: Record<string, typeof scores> = {};
  for (const s of scores) {
    (scoresByCall[s.callId] = scoresByCall[s.callId] || []).push(s);
  }
  for (const c of calls) {
    const ss = scoresByCall[c.id] || [];
    if (ss.length === 0) {
      console.log(`  #${c.callSequence} (no scores)`);
      continue;
    }
    const line = ss
      .map((s) => {
        const key = paramMap[s.parameterId] || s.parameterId.slice(0, 6);
        const mod = s.moduleId ? `@${moduleMap[s.moduleId] || s.moduleId.slice(0, 6)}` : "";
        const he = s.hasLearnerEvidence === null ? "" : ` he=${s.hasLearnerEvidence ? "Y" : "N"}`;
        return `${key}=${s.score.toFixed(2)}${mod}${he}`;
      })
      .join("  ");
    console.log(`  #${c.callSequence}: ${line}`);
  }

  await p.$disconnect();
}

main().catch((e) => {
  console.error("[snap-ielts-progress]", e);
  process.exit(1);
});
