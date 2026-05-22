/**
 * fix-ielts-prep-lab-data.ts — issue #600 demo-day data cleanup
 *
 * Idempotent DB-only fixes for the IELTS Prep Lab playbook. No code deploy needed.
 *
 * Usage (run on hf-dev VM where DATABASE_URL points at hf_dev):
 *   npx tsx scripts/fix-ielts-prep-lab-data.ts            # dry-run, prints what would change
 *   npx tsx scripts/fix-ielts-prep-lab-data.ts --apply    # actually write
 *
 * What it does:
 *   P0 — Detaches `spec-advisor-001` from the IELTS playbook (PlaybookItem rows)
 *   P1 — Deletes tutor-training MCQs (PRACTICE QUESTIONS) from tutor-briefing/course-ref sources
 *   P2 — Clears `teachMethod = "recall_quiz"` on ContentAssertion rows where the source is a
 *        pedagogy/tutor pack (course-ref, tutor-briefing) — they are NOT learner-facing recall items
 *   P3 — Removes the duplicate ESOL Subject↔Playbook join (keeps IELTS Speaking Practice)
 *   P4 — Adds an anti-contradiction critical rule to TUT-001 (AnalysisSpec.config.criticalRules)
 *
 * After running:
 *   POST /api/callers/{callerId}/compose-prompt   (recompose for the caller)
 *
 * Linked issue: https://github.com/WANDERCOLTD/HF/issues/600
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PLAYBOOK_ID = "ec4127a1-2097-4ad4-8f11-af5da46c679e"; // IELTS Speaking Practice
const ADVISOR_SPEC_SLUG = "spec-advisor-001";
const TUTOR_PEDAGOGY_SOURCE_SLUGS = [
  "ielts-prep-lab-course-ref-1779378752269",
  "ielts-prep-lab-tutor-briefing-1779378752478",
];
const ESOL_SUBJECT_NAME = "ESOL";
const TUT_001_SLUG_CANDIDATES = ["tut-001", "TUT-001"];

const ANTI_CONTRADICTION_RULE =
  "If the caller states a fact about themselves that contradicts your stored memory of them, ASK to confirm — never assert the older fact. Treat learner statements as ground truth in the moment.";

const NO_DOUBLE_CHECK_RULE =
  "Never run two recall checks in a row. After one check (right or wrong), you MUST move into substantive teaching or practice — do not chain a second 'let me just check' before the learner has done any new work.";

type Mode = "dry-run" | "apply";

const mode: Mode = process.argv.includes("--apply") ? "apply" : "dry-run";

function header(name: string) {
  console.log(`\n${"─".repeat(60)}\n  ${name}\n${"─".repeat(60)}`);
}

function note(...args: unknown[]) {
  console.log("  ·", ...args);
}

async function p0_detachAdvisorSpec() {
  header("P0 — Detach spec-advisor-001 from IELTS playbook");
  const spec = await prisma.analysisSpec.findUnique({
    where: { slug: ADVISOR_SPEC_SLUG },
    select: { id: true, slug: true, name: true },
  });
  if (!spec) {
    note(`spec ${ADVISOR_SPEC_SLUG} not found — nothing to detach`);
    return { detached: 0 };
  }
  const items = await prisma.playbookItem.findMany({
    where: { playbookId: PLAYBOOK_ID, specId: spec.id },
    select: { id: true, groupLabel: true, sortOrder: true },
  });
  note(`found ${items.length} PlaybookItem row(s) linking advisor spec to IELTS playbook`);
  items.forEach((i) =>
    note(`  - PlaybookItem ${i.id} (group: ${i.groupLabel ?? "—"}, order: ${i.sortOrder})`),
  );
  if (mode === "apply" && items.length > 0) {
    const { count } = await prisma.playbookItem.deleteMany({
      where: { playbookId: PLAYBOOK_ID, specId: spec.id },
    });
    note(`DELETED ${count} PlaybookItem row(s)`);
    return { detached: count };
  }
  return { detached: items.length };
}

async function p1_deleteTutorTrainingMCQs() {
  header("P1 — Delete tutor-training MCQs (PRACTICE QUESTIONS) from pedagogy sources");
  const sources = await prisma.contentSource.findMany({
    where: { slug: { in: TUTOR_PEDAGOGY_SOURCE_SLUGS } },
    select: { id: true, slug: true, name: true },
  });
  note(`pedagogy sources matched: ${sources.length}`);
  sources.forEach((s) => note(`  - ${s.slug} (${s.name})`));
  if (sources.length === 0) return { deletedQuestions: 0 };
  const sourceIds = sources.map((s) => s.id);
  // Target: MCQs that look like tutor-training (have [Answer: X] pattern in correctAnswer
  // or are simply MCQs against pedagogy/tutor-briefing sources, since those sources shouldn't
  // produce learner-facing assessment questions at all)
  const questions = await prisma.contentQuestion.findMany({
    where: {
      sourceId: { in: sourceIds },
      questionType: "MCQ",
    },
    select: { id: true, questionText: true, correctAnswer: true, sourceId: true },
    take: 200,
  });
  note(`MCQ rows on pedagogy sources: ${questions.length}`);
  questions.slice(0, 5).forEach((q) =>
    note(
      `  - "${q.questionText.slice(0, 80)}..." (answer: ${q.correctAnswer?.slice(0, 20) ?? "—"})`,
    ),
  );
  if (questions.length > 5) note(`  ... and ${questions.length - 5} more`);
  if (mode === "apply" && questions.length > 0) {
    const ids = questions.map((q) => q.id);
    const { count } = await prisma.contentQuestion.deleteMany({ where: { id: { in: ids } } });
    note(`DELETED ${count} ContentQuestion row(s)`);
    return { deletedQuestions: count };
  }
  return { deletedQuestions: questions.length };
}

async function p2_clearRecallQuizOnPedagogyAssertions() {
  header("P2 — Clear teachMethod=recall_quiz on pedagogy assertions");
  const sources = await prisma.contentSource.findMany({
    where: { slug: { in: TUTOR_PEDAGOGY_SOURCE_SLUGS } },
    select: { id: true, slug: true },
  });
  if (sources.length === 0) {
    note("no pedagogy sources found — skipping");
    return { cleared: 0 };
  }
  const sourceIds = sources.map((s) => s.id);
  const assertions = await prisma.contentAssertion.findMany({
    where: {
      sourceId: { in: sourceIds },
      teachMethod: "recall_quiz",
    },
    select: { id: true, assertion: true, category: true },
    take: 500,
  });
  note(
    `assertions with teachMethod=recall_quiz on pedagogy sources: ${assertions.length}`,
  );
  assertions
    .slice(0, 5)
    .forEach((a) => note(`  - [${a.category}] "${a.assertion.slice(0, 80)}..."`));
  if (assertions.length > 5) note(`  ... and ${assertions.length - 5} more`);
  if (mode === "apply" && assertions.length > 0) {
    const { count } = await prisma.contentAssertion.updateMany({
      where: { id: { in: assertions.map((a) => a.id) } },
      data: { teachMethod: null },
    });
    note(`UPDATED ${count} ContentAssertion row(s) — teachMethod cleared`);
    return { cleared: count };
  }
  return { cleared: assertions.length };
}

async function p3_removeDuplicateEsolSubject() {
  header("P3 — Remove duplicate ESOL Subject↔Playbook join");
  const esolSubjects = await prisma.subject.findMany({
    where: { name: ESOL_SUBJECT_NAME },
    select: { id: true, slug: true, name: true },
  });
  note(`Subject(name="${ESOL_SUBJECT_NAME}") rows: ${esolSubjects.length}`);
  if (esolSubjects.length === 0) return { unlinked: 0 };
  const subjectIds = esolSubjects.map((s) => s.id);
  const joins = await prisma.playbookSubject.findMany({
    where: { playbookId: PLAYBOOK_ID, subjectId: { in: subjectIds } },
    select: { id: true, subjectId: true },
  });
  note(`PlaybookSubject join rows on IELTS playbook for ESOL subject(s): ${joins.length}`);
  if (mode === "apply" && joins.length > 0) {
    const { count } = await prisma.playbookSubject.deleteMany({
      where: { id: { in: joins.map((j) => j.id) } },
    });
    note(`DELETED ${count} PlaybookSubject join(s) — IELTS Speaking Practice subject remains`);
    return { unlinked: count };
  }
  return { unlinked: joins.length };
}

async function p4_addAntiContradictionRule() {
  header("P4 — Add anti-contradiction + no-double-check rules to TUT-001");
  const spec = await prisma.analysisSpec.findFirst({
    where: { slug: { in: TUT_001_SLUG_CANDIDATES } },
    select: { id: true, slug: true, config: true },
  });
  if (!spec) {
    note(
      `TUT-001 spec not found (tried slugs: ${TUT_001_SLUG_CANDIDATES.join(", ")}) — skipping`,
    );
    return { ruleAdded: false };
  }
  note(`found spec ${spec.slug} (id: ${spec.id})`);
  const config = (spec.config as Record<string, unknown> | null) ?? {};
  const existingRules = Array.isArray(config.criticalRules) ? (config.criticalRules as string[]) : [];
  const hasAntiContradiction = existingRules.some((r) => r.includes("contradicts your stored memory"));
  const hasNoDoubleCheck = existingRules.some((r) => r.includes("Never run two recall checks"));
  note(`existing criticalRules count: ${existingRules.length}`);
  note(`  - anti-contradiction rule present: ${hasAntiContradiction}`);
  note(`  - no-double-check rule present:    ${hasNoDoubleCheck}`);
  if (hasAntiContradiction && hasNoDoubleCheck) {
    note("both rules already present — nothing to do");
    return { ruleAdded: false };
  }
  const newRules = [...existingRules];
  if (!hasAntiContradiction) newRules.push(ANTI_CONTRADICTION_RULE);
  if (!hasNoDoubleCheck) newRules.push(NO_DOUBLE_CHECK_RULE);
  if (mode === "apply") {
    await prisma.analysisSpec.update({
      where: { id: spec.id },
      data: { config: { ...config, criticalRules: newRules }, isDirty: true },
    });
    note(`UPDATED ${spec.slug}.config.criticalRules → now ${newRules.length} rules`);
    return { ruleAdded: true };
  }
  note(`WOULD ADD ${newRules.length - existingRules.length} new rule(s) — preview:`);
  if (!hasAntiContradiction) note(`  + ${ANTI_CONTRADICTION_RULE}`);
  if (!hasNoDoubleCheck) note(`  + ${NO_DOUBLE_CHECK_RULE}`);
  return { ruleAdded: true };
}

async function main() {
  console.log(`\n#600 IELTS Prep Lab data fix — mode: ${mode.toUpperCase()}`);
  console.log(`Playbook: ${PLAYBOOK_ID} (IELTS Speaking Practice)\n`);

  const results = await prisma.$transaction(async (_tx) => {
    // Note: prisma.* (not _tx.*) inside helpers — Prisma will pick up the active txn from
    // the connection. If you want strict tx isolation, refactor helpers to accept tx.
    const p0 = await p0_detachAdvisorSpec();
    const p1 = await p1_deleteTutorTrainingMCQs();
    const p2 = await p2_clearRecallQuizOnPedagogyAssertions();
    const p3 = await p3_removeDuplicateEsolSubject();
    const p4 = await p4_addAntiContradictionRule();
    return { p0, p1, p2, p3, p4 };
  });

  header("SUMMARY");
  console.log(JSON.stringify(results, null, 2));
  if (mode === "dry-run") {
    console.log("\n  Dry-run only. Re-run with --apply to make changes.\n");
  } else {
    console.log("\n  Done. Next steps:\n");
    console.log(
      "  1. Recompose prompt:  curl -X POST https://dev.humanfirstfoundation.com/api/callers/f17d8616-3c31-4814-8de1-626fb42f16f6/compose-prompt -H 'Cookie: <your session cookie>'\n",
    );
    console.log("  2. Start a fresh call as that caller and verify the tutor:\n");
    console.log("     - opens by acknowledging Part 1 and asks a real Part 1 question\n");
    console.log("     - does NOT do two consecutive recall checks\n");
    console.log("     - does NOT ask meta-pedagogy questions ('minimum length you should aim for')\n");
    console.log("     - if the learner contradicts a memory, the tutor asks rather than asserts\n");
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error("\n  ✗ ERROR:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
