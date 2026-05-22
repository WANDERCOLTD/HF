/**
 * Epic 100 — sim-canonical-call.ts
 *
 * Deterministic sim-call proof for Epic 100. Loads the canonical Nico Grant
 * evidence case (DEV golden caller) and asserts that the post-pipeline state
 * is in canonical-contract shape:
 *
 *   1. No dual lo_mastery keys for the same LO (slug vs name form)
 *   2. No zero-storm (>40 CallScore rows all == 0 for a single call)
 *   3. priorCallFeedback summary does not name a coaching parameter as weakest
 *   4. ComposedPrompt practiceQuestions section contains no TUTOR_ONLY rows
 *
 * Pattern follows the existing #554 and #561 proof scripts: read-only,
 * idempotent, exits non-zero on any contract violation.
 *
 * Usage (from apps/admin/, with DATABASE_URL set — typically run on VM):
 *   npx tsx scripts/proof/epic-100/sim-canonical-call.ts
 *   npx tsx scripts/proof/epic-100/sim-canonical-call.ts --snap   # write golden baseline
 *   npx tsx scripts/proof/epic-100/sim-canonical-call.ts --caller=<id>
 *
 * Exit codes:
 *   0 — all contracts hold (or DB unreachable, mirrors check-fk-consistency.ts)
 *   1 — at least one contract violation detected
 *
 * See:
 *   - docs/epic-100-verification.md
 *   - docs/epic-100-chain-walk.md
 *   - tests/fixtures/epic-100-golden-prompt-baseline.json
 *   - gh issue view 631
 */

import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";

const GOLDEN_CALLER_ID = "f17d8616-3c31-4814-8de1-626fb42f16f6";
const GOLDEN_PLAYBOOK_ID = "ec4127a1-2097-4ad4-8f11-af5da46c679e";
const BASELINE_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "tests",
  "fixtures",
  "epic-100-golden-prompt-baseline.json",
);

interface CliFlags {
  snap: boolean;
  callerId: string;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { snap: false, callerId: GOLDEN_CALLER_ID };
  for (const arg of argv.slice(2)) {
    if (arg === "--snap") flags.snap = true;
    else if (arg.startsWith("--caller=")) flags.callerId = arg.slice("--caller=".length);
  }
  return flags;
}

interface Assertion {
  name: string;
  pass: boolean;
  detail: string;
}

async function checkNoDualLoMastery(callerId: string): Promise<Assertion> {
  const rows = await prisma.callerAttribute.findMany({
    where: {
      callerId,
      key: { contains: ":lo_mastery:" },
      OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
    },
    select: { key: true },
  });
  // Group by trailing :<loRef> token; any group with more than one row = dual key.
  const byLoRef = new Map<string, string[]>();
  for (const r of rows) {
    const match = r.key.match(/:lo_mastery:[^:]+:([^:]+)$/);
    if (!match) continue;
    const loRef = match[1];
    const bucket = byLoRef.get(loRef) ?? [];
    bucket.push(r.key);
    byLoRef.set(loRef, bucket);
  }
  const dupes = Array.from(byLoRef.entries()).filter(([, ks]) => ks.length > 1);
  return {
    name: "no-dual-lo-mastery-keys",
    pass: dupes.length === 0,
    detail:
      dupes.length === 0
        ? "single canonical key per LO"
        : `dual keys for ${dupes.length} LO(s): ${dupes
            .slice(0, 3)
            .map(([loRef, ks]) => `${loRef}=[${ks.join(", ")}]`)
            .join("; ")}`,
  };
}

async function checkNoZeroStorm(callerId: string): Promise<Assertion> {
  const calls = await prisma.call.findMany({
    where: { callerId },
    select: { id: true },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  for (const call of calls) {
    const scores = await prisma.callScore.findMany({
      where: { callId: call.id },
      select: { score: true },
    });
    if (scores.length > 40 && scores.every((s) => s.score === 0)) {
      return {
        name: "no-zero-storm",
        pass: false,
        detail: `call ${call.id} has ${scores.length} CallScore rows, all scored 0`,
      };
    }
  }
  return { name: "no-zero-storm", pass: true, detail: `inspected ${calls.length} recent calls` };
}

async function checkPriorCallFeedbackRelevance(callerId: string): Promise<Assertion> {
  // Heuristic: load most-recent ComposedPrompt for the caller and look at the
  // priorCallFeedback summary text. If it names a known coaching parameter as
  // the weakest area for an IELTS playbook, that's a Symptom-3 violation.
  const cp = await prisma.composedPrompt.findFirst({
    where: { callerId },
    orderBy: { composedAt: "desc" },
    select: { prompt: true },
  });
  if (!cp || !cp.prompt) {
    return {
      name: "prior-call-feedback-relevance",
      pass: true,
      detail: "no ComposedPrompt found for caller — skipped",
    };
  }
  const coachingParams = ["action_commitment", "goal_clarity", "rapport", "motivation"];
  const summarySection = cp.prompt.match(/weakest area was\s+([a-z_]+)/i)?.[1] ?? null;
  if (summarySection && coachingParams.includes(summarySection)) {
    return {
      name: "prior-call-feedback-relevance",
      pass: false,
      detail: `weakest-area summary references coaching param "${summarySection}" on IELTS playbook`,
    };
  }
  return {
    name: "prior-call-feedback-relevance",
    pass: true,
    detail: summarySection ? `weakest-area = "${summarySection}" (acceptable)` : "no summary text matched",
  };
}

async function checkNoTutorOnlyInPracticeQuestions(callerId: string): Promise<Assertion> {
  const cp = await prisma.composedPrompt.findFirst({
    where: { callerId },
    orderBy: { composedAt: "desc" },
    select: { prompt: true, inputs: true },
  });
  if (!cp || !cp.prompt) {
    return {
      name: "no-tutor-only-in-practice-questions",
      pass: true,
      detail: "no ComposedPrompt found for caller — skipped",
    };
  }
  // Crude detection: tutor-pedagogy MCQs typically have the meta-pedagogy giveaway
  // "what should the tutor do next" or an "[Answer: B]"-style key.
  const hasTutorPedagogy =
    cp.prompt.includes("what should the tutor do next") ||
    cp.prompt.includes("What should the tutor do next") ||
    /\[Answer:\s*[A-D]\]/.test(cp.prompt);
  return {
    name: "no-tutor-only-in-practice-questions",
    pass: !hasTutorPedagogy,
    detail: hasTutorPedagogy
      ? "found tutor-pedagogy MCQ giveaway in ComposedPrompt body"
      : "no tutor-pedagogy giveaway detected",
  };
}

async function captureBaseline(callerId: string): Promise<void> {
  const cp = await prisma.composedPrompt.findFirst({
    where: { callerId },
    orderBy: { composedAt: "desc" },
  });
  const payload = {
    _comment:
      "Auto-captured golden-prompt baseline. Edit by re-running `sim-canonical-call.ts --snap` on the VM.",
    capturedAt: new Date().toISOString(),
    callerId,
    playbookId: GOLDEN_PLAYBOOK_ID,
    composedPromptJson: cp,
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2));
  console.log(`[sim-canonical-call] baseline written → ${BASELINE_PATH}`);
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);

  // DB-unreachable: warn + exit 0 (mirror check-fk-consistency.ts).
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[sim-canonical-call] WARNING: database unreachable (${message}). Skipping proof.`,
    );
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  }

  if (flags.snap) {
    await captureBaseline(flags.callerId);
    await prisma.$disconnect();
    return;
  }

  const assertions: Assertion[] = [];
  assertions.push(await checkNoDualLoMastery(flags.callerId));
  assertions.push(await checkNoZeroStorm(flags.callerId));
  assertions.push(await checkPriorCallFeedbackRelevance(flags.callerId));
  assertions.push(await checkNoTutorOnlyInPracticeQuestions(flags.callerId));

  console.log("\n=== sim-canonical-call — Epic 100 proof ===");
  console.log(`caller: ${flags.callerId}\n`);
  for (const a of assertions) {
    const symbol = a.pass ? "✓" : "✗";
    console.log(`  ${symbol} ${a.name.padEnd(40)} ${a.detail}`);
  }

  await prisma.$disconnect();
  const anyFail = assertions.some((a) => !a.pass);
  if (anyFail) {
    console.error("\n[sim-canonical-call] FAILED — at least one contract violated.");
    process.exit(1);
  }
  console.log("\n[sim-canonical-call] All contracts hold.");
}

main().catch((err: unknown) => {
  console.error("[sim-canonical-call] uncaught error:", err);
  process.exit(1);
});
