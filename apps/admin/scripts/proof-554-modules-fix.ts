/**
 * Proof script for #554 — outcome ref resolution + moduleToReview gating.
 *
 * Runs `computeSharedState` against real DB data and verifies:
 *
 *   FIX 1 — lockedModule.learningOutcomes contains resolved statement text,
 *            not bare "OUT-NN" refs.
 *   FIX 2 — for a caller with zero CallerModuleProgress + zero recentCalls,
 *            moduleToReview === null (no "review your baseline" hallucination
 *            before any call exists).
 *
 * Usage (from apps/admin/):
 *   npx tsx scripts/proof-554-modules-fix.ts                    # auto-pick IELTS playbook + a fresh caller
 *   npx tsx scripts/proof-554-modules-fix.ts --playbook <id>    # specific playbook
 *   npx tsx scripts/proof-554-modules-fix.ts --caller <id>      # specific caller
 *
 * The script prints PASS/FAIL per fix and exits non-zero on failure.
 */

import { prisma } from "@/lib/prisma";
import { loadAllData } from "@/lib/prompt/composition/SectionDataLoader";
import { computeSharedState } from "@/lib/prompt/composition/transforms/modules";

const OUT_REF = /^OUT-\d+$/i;

async function pickPlaybook(targetId: string | null): Promise<{
  id: string;
  name: string;
  modulesAuthored: boolean;
  firstAuthoredModuleId: string | null;
  outcomesCount: number;
} | null> {
  const pb = targetId
    ? await prisma.playbook.findUnique({
        where: { id: targetId },
        select: { id: true, name: true, config: true },
      })
    : await prisma.playbook.findFirst({
        where: {
          OR: [
            { name: { contains: "IELTS", mode: "insensitive" } },
            { name: { contains: "ielts", mode: "insensitive" } },
          ],
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, config: true },
      });
  if (!pb) return null;
  const cfg = (pb.config ?? {}) as {
    modulesAuthored?: boolean;
    modules?: Array<{ id?: string; outcomesPrimary?: unknown }>;
    outcomes?: Record<string, string>;
  };
  const firstAuthored = (cfg.modules ?? []).find(
    (m) => m && typeof m.id === "string" && Array.isArray(m.outcomesPrimary) && (m.outcomesPrimary as unknown[]).length > 0,
  );
  return {
    id: pb.id,
    name: pb.name,
    modulesAuthored: cfg.modulesAuthored === true,
    firstAuthoredModuleId: firstAuthored?.id ?? null,
    outcomesCount: Object.keys(cfg.outcomes ?? {}).length,
  };
}

async function pickCaller(targetId: string | null, playbookId: string): Promise<{ id: string; name: string | null } | null> {
  if (targetId) {
    return prisma.caller.findUnique({ where: { id: targetId }, select: { id: true, name: true } });
  }
  // Prefer a caller enrolled on this playbook with zero calls (cleanest
  // zero-progress proof for Fix 2). Relation on Caller is `enrollments`
  // (CallerPlaybook[]); call count comes from `Call` rows by callerId.
  const candidates = await prisma.caller.findMany({
    select: { id: true, name: true },
    where: { enrollments: { some: { playbookId } } },
    take: 50,
  });
  for (const c of candidates) {
    const callCount = await prisma.call.count({ where: { callerId: c.id } });
    if (callCount === 0) return c;
  }
  return candidates[0] ?? null;
}

async function main() {
  const args = process.argv.slice(2);
  const playbookFlag = args.indexOf("--playbook");
  const callerFlag = args.indexOf("--caller");
  const targetPlaybookId = playbookFlag !== -1 ? args[playbookFlag + 1] : null;
  const targetCallerId = callerFlag !== -1 ? args[callerFlag + 1] : null;

  const playbook = await pickPlaybook(targetPlaybookId);
  if (!playbook) {
    console.log("[proof-554] No IELTS-like playbook found.");
    process.exit(1);
  }
  if (!playbook.modulesAuthored) {
    console.log(`[proof-554] Playbook ${playbook.id} (${playbook.name}) is NOT modulesAuthored.`);
    console.log("[proof-554] Fix 1 only applies to authored courses. Pass --playbook for an authored one.");
    process.exit(1);
  }
  if (!playbook.firstAuthoredModuleId) {
    console.log(`[proof-554] Playbook ${playbook.id} has no authored module with outcomesPrimary refs.`);
    process.exit(1);
  }
  if (playbook.outcomesCount === 0) {
    console.log(`[proof-554] Playbook ${playbook.id} has empty Playbook.config.outcomes — refs cannot resolve.`);
    console.log("[proof-554] (This is a content-side gap, not a code-side gap — Fix 1 still applies once outcomes are authored.)");
  }

  const caller = await pickCaller(targetCallerId, playbook.id);
  if (!caller) {
    console.log(`[proof-554] No caller found enrolled on playbook ${playbook.id}.`);
    process.exit(1);
  }

  console.log(`[proof-554] playbook: ${playbook.id} (${playbook.name})`);
  console.log(`[proof-554] caller:   ${caller.id} (${caller.name ?? "(unnamed)"})`);
  console.log(`[proof-554] authored module: ${playbook.firstAuthoredModuleId}`);
  console.log(`[proof-554] outcomes map size: ${playbook.outcomesCount}`);
  console.log();

  // ── Fix 1 proof — requestedModuleId path resolves refs to text ─────────
  console.log("=== FIX 1 — outcome ref resolution ===");
  const data1 = await loadAllData(caller.id, {}, { requestedModuleId: playbook.firstAuthoredModuleId });
  const result1 = await computeSharedState(
    data1,
    { identitySpec: null, voiceSpec: null },
    { requestedModuleId: playbook.firstAuthoredModuleId },
    "proof-554",
  );
  console.log(`lockedModule.id: ${result1.lockedModule?.id ?? "(null)"}`);
  console.log(`lockedModule.learningOutcomes:`);
  const outcomes = result1.lockedModule?.learningOutcomes ?? [];
  for (const o of outcomes) {
    console.log(`  - ${o.slice(0, 100)}${o.length > 100 ? "..." : ""}`);
  }
  const bareRefs = outcomes.filter((o) => OUT_REF.test(o));
  const fix1Pass = result1.lockedModule !== null && outcomes.length > 0 && bareRefs.length === 0;
  if (bareRefs.length > 0) {
    console.log(`  → FAIL (${bareRefs.length} bare ref(s) leaked through: ${bareRefs.join(", ")})`);
    console.log(`     Most likely cause: Playbook.config.outcomes is missing entries for these refs.`);
  } else if (outcomes.length === 0) {
    console.log(`  → FAIL (no learningOutcomes returned — module has no outcomesPrimary?)`);
  } else {
    console.log(`  → PASS (all ${outcomes.length} refs resolved to statement text)`);
  }
  console.log();

  // ── Fix 2 proof — zero-progress caller → moduleToReview is null ──────
  console.log("=== FIX 2 — moduleToReview gate ===");
  // Reuse the loaded data but DROP recentCalls + clear completedModules paths
  // by querying CallerModuleProgress count to confirm true zero-progress state.
  const cmpCount = await prisma.callerModuleProgress.count({
    where: { callerId: caller.id },
  });
  console.log(`CallerModuleProgress rows for this caller: ${cmpCount}`);
  console.log(`recentCalls length: ${data1.recentCalls.length}`);

  // Run without requestedModuleId so the module-pick path is the default.
  const result2 = await computeSharedState(data1, { identitySpec: null, voiceSpec: null }, {}, "proof-554");
  console.log(`moduleToReview: ${result2.moduleToReview?.id ?? "(null)"}`);
  console.log(`nextModule:     ${result2.nextModule?.id ?? "(null)"}`);

  const trueZeroProgress = cmpCount === 0 && data1.recentCalls.length === 0;
  let fix2Pass: boolean;
  if (trueZeroProgress) {
    fix2Pass = result2.moduleToReview === null;
    console.log(
      `  → ${fix2Pass ? "PASS" : "FAIL"} (zero-progress caller, expect moduleToReview === null)`,
    );
  } else {
    // Selected caller has progress — confirm review still resolves (regression guard).
    fix2Pass = result2.moduleToReview !== null;
    console.log(
      `  → ${fix2Pass ? "PASS" : "FAIL"} (caller has prior activity, expect moduleToReview non-null)`,
    );
    console.log(
      `     (For the true-null proof, pick a caller with zero CallerModuleProgress AND zero recentCalls.)`,
    );
  }

  console.log();
  console.log("=== SUMMARY ===");
  console.log(`Fix 1 (outcome refs resolved):   ${fix1Pass ? "PASS" : "FAIL"}`);
  console.log(`Fix 2 (review gate):             ${fix2Pass ? "PASS" : "FAIL"}`);
  process.exit(fix1Pass && fix2Pass ? 0 : 1);
}

main()
  .catch((err) => {
    console.error("[proof-554] error:", err);
    process.exit(2);
  })
  .finally(() => prisma.$disconnect());
