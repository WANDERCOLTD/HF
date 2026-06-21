/**
 * 2150 — NULL out criterion-label `session_focus:next_*` CallerAttribute
 * rows written by the retired `derive-focus-area.ts` path.
 *
 * **Why NULL, not translate?**
 *
 * Per epic #2135 ("no hallucinated backfill") and the operator rule
 * captured in [feedback_no_hardcoded_score_backfill.md](~/.claude/projects/-Users-paulwander-projects-HF/memory/feedback_no_hardcoded_score_backfill.md):
 * the criterion → technique mapping is a pedagogy decision encoded in
 * `IELTS-P3-FOCUS-001.spec.json::config.selectionRules` (DRAFT mapping
 * at PR #2150 author time — flagged for product review). Backfilling
 * existing rows with the same draft mapping would:
 *
 *   1. Lock in an unreviewed pedagogy decision against historical data
 *      (and that data would survive future selectionRules edits).
 *   2. Silently project an internal criterion onto a learner-safe label
 *      without the runner having actually fired on the real scores.
 *   3. Mask the architectural gap that PR #2155 (#HF_IELTS_LLM_MEASURE_V1)
 *      is still flag-off — meaning many existing rows reflect prosody-
 *      consumer writes that aren't the canonical scoring path the
 *      runner expects to read.
 *
 * Honest empty state is the right answer. The next pipeline run for
 * each caller (with the flag on + real scores in CallerTarget) will
 * repopulate the row with a learner-safe technique label.
 *
 * **What this script does:**
 *
 * For every `CallerAttribute` row whose `key` starts with
 * `session_focus:next_`:
 *
 *   - If `stringValue` is in the set of retired IELTS criterion labels
 *     (Fluency and Coherence, Lexical Resource, Grammatical Range and
 *     Accuracy, Pronunciation) → DELETE the row.
 *   - If `stringValue` is already in the `Part3TechniqueFocus` union
 *     (giving reasons, structuring an argument, handling a challenge,
 *     expanding an answer) → LEAVE IT (already learner-safe).
 *   - If `stringValue` is empty / unrecognised → DELETE (defensive —
 *     anything not in the union is structurally suspect now that the
 *     runner is the single writer).
 *
 * **Idempotent.** Safe to re-run. Operator runs after merge — bot
 * SHOULD NOT execute this script against any DB.
 *
 * Usage:
 *   npx tsx apps/admin/scripts/2150-null-criterion-focus-attributes.ts            # dry-run
 *   npx tsx apps/admin/scripts/2150-null-criterion-focus-attributes.ts --apply    # execute
 *
 * Related:
 *   - Epic #2145 (Generic SessionFocus substrate)
 *   - Story #2150 (this PR — IELTS-P3-FOCUS-001 + retirement)
 *   - Story #1955 (the original criterion-leaking implementation)
 *   - Memory: feedback_no_hardcoded_score_backfill.md
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Criterion labels from the retired `IELTS_SKILL_LABELS` constant.
 *  Any CallerAttribute row carrying these values was written by the
 *  pre-#2150 bespoke path — DELETE so the runner can repopulate. */
const RETIRED_CRITERION_LABELS = new Set<string>([
  "Fluency and Coherence",
  "Lexical Resource",
  "Grammatical Range and Accuracy",
  "Pronunciation",
]);

/** Learner-safe technique labels from `Part3TechniqueFocus`. Rows
 *  carrying these are already projected correctly — leave them. */
const LEARNER_SAFE_LABELS = new Set<string>([
  "giving reasons",
  "structuring an argument",
  "handling a challenge",
  "expanding an answer",
]);

const KEY_PREFIX = "session_focus:next_";

interface ClassifiedRow {
  id: string;
  callerId: string;
  key: string;
  scope: string | null;
  stringValue: string | null;
  action: "delete-criterion" | "delete-unrecognised" | "leave-learner-safe";
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const rows = await prisma.callerAttribute.findMany({
    where: {
      key: { startsWith: KEY_PREFIX },
    },
    select: {
      id: true,
      callerId: true,
      key: true,
      scope: true,
      stringValue: true,
    },
  });

  console.log(`Found ${rows.length} CallerAttribute rows with key prefix "${KEY_PREFIX}"`);

  const classified: ClassifiedRow[] = rows.map((r) => {
    const v = r.stringValue?.trim() ?? "";
    let action: ClassifiedRow["action"];
    if (RETIRED_CRITERION_LABELS.has(v)) {
      action = "delete-criterion";
    } else if (LEARNER_SAFE_LABELS.has(v)) {
      action = "leave-learner-safe";
    } else {
      action = "delete-unrecognised";
    }
    return {
      id: r.id,
      callerId: r.callerId,
      key: r.key,
      scope: r.scope,
      stringValue: r.stringValue,
      action,
    };
  });

  const summary = {
    "delete-criterion": classified.filter((r) => r.action === "delete-criterion").length,
    "delete-unrecognised": classified.filter((r) => r.action === "delete-unrecognised").length,
    "leave-learner-safe": classified.filter((r) => r.action === "leave-learner-safe").length,
  };
  console.log("Classification:", summary);

  const toDelete = classified.filter((r) => r.action !== "leave-learner-safe");

  if (toDelete.length === 0) {
    console.log("Nothing to delete. Exiting.");
    await prisma.$disconnect();
    return;
  }

  console.log("\nSample rows scheduled for delete (first 10):");
  for (const r of toDelete.slice(0, 10)) {
    console.log(
      `  ${r.action.padEnd(20)} caller=${r.callerId} key=${r.key} scope=${r.scope} value="${r.stringValue}"`,
    );
  }

  if (!apply) {
    console.log(
      `\nDRY RUN. Pass --apply to delete ${toDelete.length} rows. NO writes performed.`,
    );
    await prisma.$disconnect();
    return;
  }

  console.log(`\nApplying — deleting ${toDelete.length} rows...`);
  const result = await prisma.callerAttribute.deleteMany({
    where: { id: { in: toDelete.map((r) => r.id) } },
  });
  console.log(`Deleted ${result.count} rows.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
