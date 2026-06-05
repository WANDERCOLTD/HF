/**
 * Backfill — LINK the Revision Aid Curriculum onto Pop Quiz + Exam Assessment
 * Playbooks for the CIO/CTO Standard pilot.
 *
 * Why this script exists
 * ----------------------
 * The CIO/CTO Standard pilot has three Playbooks but only ONE has a Curriculum
 * wired (Revision Aid). The other two (Pop Quiz, Exam Assessment) need to share
 * the SAME modules + LOs so mastery accumulates across all three courses for
 * the same Caller.
 *
 * Tech Lead review (Stream B) found that mastery sharing requires a SINGLE
 * Curriculum + multiple Playbooks linked via `PlaybookCurriculum(role: linked)`
 * rows — NOT three separate cloned Curricula. The compose layer (#1034 /
 * `lib/prompt/composition/lo-mastery-map.ts`) keys mastery reads by
 * `curriculum:<slug>:lo_mastery:<...>`. Separate Curricula (even with matching
 * module slugs + LO refs) produce DIFFERENT prefixes — mastery would silently
 * fragment per Playbook. The variant-route mechanism shipped in #1034 already
 * solves this with `PlaybookCurriculum(role: linked)`.
 *
 * What this script does
 * ---------------------
 * For each target Playbook (Pop Quiz, Exam Assessment):
 *   - Create ONE `PlaybookCurriculum(role: linked)` row pointing at Revision
 *     Aid's existing Curriculum.
 *
 * This script makes NO writes to:
 *   - The Curriculum table (no clones)
 *   - CurriculumModule / LearningObjective (no module/LO writes at all)
 *   - Revision Aid's existing PlaybookCurriculum row (untouched)
 *
 * Safety
 * ------
 * - DRY RUN by default. `--apply` actually writes.
 * - Wrapped in `prisma.$transaction` per target.
 * - Defensive re-check inside the transaction (peer-write race).
 * - Idempotent: skips targets already linked to the source Curriculum.
 * - Aborts (exit 2) if a target Playbook is already linked to a DIFFERENT
 *   Curriculum (either via PlaybookCurriculum or via the deprecated
 *   `Curriculum.playbookId` pointer). Operator must investigate.
 * - Verification summary at the end confirms 1 primary + 2 linked PlaybookCurriculum
 *   rows on the source Curriculum, and that `resolveCurriculumIdForPlaybook`
 *   returns the SAME curriculumId for all three Playbooks (→ same mastery prefix).
 *
 * Usage
 * -----
 *   npx tsx scripts/backfill-cio-cto-curricula.ts            # dry run
 *   npx tsx scripts/backfill-cio-cto-curricula.ts --apply    # commit
 *
 * Exit codes
 * ----------
 *   0  — clean run (dry or applied)
 *   1  — unexpected error
 *   2  — validation abort (e.g. target already links a different Curriculum)
 */

import { prisma } from "../lib/prisma";
import { resolveCurriculumIdForPlaybook } from "../lib/curriculum/resolve-module";

// =============================================================================
// Constants
// =============================================================================

const SOURCE_PLAYBOOK_ID = "5bbdbe7e-c32f-490e-8ff8-a938ddfc49a0"; // Revision Aid
const SOURCE_CURRICULUM_ID = "0ccb2874-f2d5-4431-96d0-0c0faf342636";

const TARGETS: Array<{ playbookId: string; label: string }> = [
  {
    playbookId: "405b210f-9a2b-4aca-b906-edcc758534a2",
    label: "Pop Quiz",
  },
  {
    playbookId: "2d04ded7-19dc-46d3-afa5-b85d073778b4",
    label: "Exam Assessment",
  },
];

// =============================================================================
// CLI
// =============================================================================

const APPLY = process.argv.includes("--apply");

// =============================================================================
// Per-target plan
// =============================================================================

type Plan =
  | { kind: "skip"; reason: string }
  | { kind: "link" }
  | { kind: "abort"; reason: string };

async function planForTarget(playbookId: string, label: string): Promise<Plan> {
  // 1. Existing PlaybookCurriculum rows on this Playbook (any role).
  const existingLinks = await prisma.playbookCurriculum.findMany({
    where: { playbookId },
    select: { curriculumId: true, role: true },
  });

  const alreadyLinkedToSource = existingLinks.find(
    (l) => l.curriculumId === SOURCE_CURRICULUM_ID,
  );
  if (alreadyLinkedToSource) {
    return {
      kind: "skip",
      reason: `PlaybookCurriculum(role=${alreadyLinkedToSource.role}) already points at source Curriculum`,
    };
  }

  const linkedElsewhere = existingLinks.find(
    (l) => l.curriculumId !== SOURCE_CURRICULUM_ID,
  );
  if (linkedElsewhere) {
    return {
      kind: "abort",
      reason: `${label} already has PlaybookCurriculum(role=${linkedElsewhere.role}, curriculumId=${linkedElsewhere.curriculumId}) — investigate before re-running`,
    };
  }

  // 2. Deprecated `Curriculum.playbookId` pointer.
  const deprecatedOwned = await prisma.curriculum.findFirst({
    where: { playbookId },
    select: { id: true, slug: true },
  });
  if (deprecatedOwned) {
    return {
      kind: "abort",
      reason: `${label} is owned by Curriculum(id=${deprecatedOwned.id}, slug=${deprecatedOwned.slug}) via the deprecated Curriculum.playbookId pointer — investigate before re-running`,
    };
  }

  return { kind: "link" };
}

// =============================================================================
// Apply (per-target transaction with defensive re-check)
// =============================================================================

async function applyLink(playbookId: string, label: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Re-check inside the transaction — defends against a peer that linked
    // the target between plan and apply.
    const existing = await tx.playbookCurriculum.findFirst({
      where: { playbookId },
      select: { curriculumId: true, role: true },
    });
    if (existing && existing.curriculumId === SOURCE_CURRICULUM_ID) {
      console.log(
        `  [${label}] already linked (race with peer) — no-op`,
      );
      return;
    }
    if (existing && existing.curriculumId !== SOURCE_CURRICULUM_ID) {
      throw new Error(
        `[${label}] race detected: PlaybookCurriculum(role=${existing.role}, curriculumId=${existing.curriculumId}) appeared mid-flight — abort`,
      );
    }
    const deprecated = await tx.curriculum.findFirst({
      where: { playbookId },
      select: { id: true },
    });
    if (deprecated) {
      throw new Error(
        `[${label}] race detected: Curriculum.playbookId=${playbookId} appeared mid-flight — abort`,
      );
    }

    await tx.playbookCurriculum.create({
      data: {
        playbookId,
        curriculumId: SOURCE_CURRICULUM_ID,
        role: "linked",
      },
    });
  });
}

// =============================================================================
// Source verification — sanity check before any per-target work
// =============================================================================

async function verifySource(): Promise<void> {
  const curr = await prisma.curriculum.findUnique({
    where: { id: SOURCE_CURRICULUM_ID },
    select: {
      id: true,
      slug: true,
      name: true,
      playbookId: true,
      _count: { select: { modules: true } },
    },
  });
  if (!curr) {
    throw new Error(
      `Source Curriculum ${SOURCE_CURRICULUM_ID} not found — aborting`,
    );
  }
  if (curr._count.modules === 0) {
    throw new Error(
      `Source Curriculum ${SOURCE_CURRICULUM_ID} has 0 modules — aborting`,
    );
  }

  const loCount = await prisma.learningObjective.count({
    where: { module: { curriculumId: SOURCE_CURRICULUM_ID } },
  });
  if (loCount === 0) {
    throw new Error(
      `Source Curriculum ${SOURCE_CURRICULUM_ID} has 0 LearningObjectives — aborting`,
    );
  }

  // Confirm Revision Aid already has its primary row (or owns via deprecated col).
  const sourcePbcRow = await prisma.playbookCurriculum.findUnique({
    where: {
      playbookId_curriculumId: {
        playbookId: SOURCE_PLAYBOOK_ID,
        curriculumId: SOURCE_CURRICULUM_ID,
      },
    },
    select: { role: true },
  });

  console.log("Source:");
  console.log(
    `  Revision Aid Playbook    : ${SOURCE_PLAYBOOK_ID}`,
  );
  console.log(
    `  Curriculum               : ${curr.slug} (${curr.id})`,
  );
  console.log(`  Curriculum.name          : ${curr.name}`);
  console.log(`  Curriculum.playbookId    : ${curr.playbookId ?? "(null)"}`);
  console.log(`  Modules                  : ${curr._count.modules}`);
  console.log(`  LearningObjectives       : ${loCount}`);
  console.log(
    `  PlaybookCurriculum row   : ${sourcePbcRow ? `role=${sourcePbcRow.role}` : "(missing — Revision Aid has no PlaybookCurriculum row, relying on deprecated col)"}`,
  );
  console.log("");
}

// =============================================================================
// Post-apply verification
// =============================================================================

async function verifyPostApply(): Promise<void> {
  console.log("Post-apply verification:");

  const rows = await prisma.playbookCurriculum.findMany({
    where: { curriculumId: SOURCE_CURRICULUM_ID },
    select: {
      playbookId: true,
      role: true,
      playbook: { select: { name: true } },
    },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });

  console.log(
    `  PlaybookCurriculum rows on Curriculum ${SOURCE_CURRICULUM_ID}:`,
  );
  for (const r of rows) {
    console.log(
      `    - ${r.playbook.name.padEnd(20)} role=${r.role.padEnd(7)} playbookId=${r.playbookId}`,
    );
  }

  // Confirm resolveCurriculumIdForPlaybook returns the SAME curriculumId for all
  // three Playbooks (→ buildLoMasteryMap produces the same prefix).
  const allThree = [
    { id: SOURCE_PLAYBOOK_ID, label: "Revision Aid" },
    ...TARGETS,
  ];
  console.log("");
  console.log(
    "  resolveCurriculumIdForPlaybook (drives buildLoMasteryMap prefix):",
  );
  let allMatch = true;
  for (const p of allThree) {
    const resolved = await resolveCurriculumIdForPlaybook(
      "id" in p ? p.id : p.playbookId,
    );
    const matches = resolved === SOURCE_CURRICULUM_ID;
    if (!matches) allMatch = false;
    console.log(
      `    - ${p.label.padEnd(20)} -> ${resolved ?? "(null)"}  ${matches ? "OK" : "MISMATCH"}`,
    );
  }
  if (!allMatch) {
    throw new Error(
      "Verification FAILED: not all three Playbooks resolve to the source Curriculum",
    );
  }

  // The slug-prefix produced by `buildLoMasteryMap`.
  const curr = await prisma.curriculum.findUnique({
    where: { id: SOURCE_CURRICULUM_ID },
    select: { slug: true },
  });
  console.log("");
  console.log(
    `  Shared mastery prefix    : curriculum:${curr?.slug ?? "?"}:lo_mastery:`,
  );
  console.log("");
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<number> {
  console.log("=".repeat(72));
  console.log(`Backfill CIO/CTO Curricula — LINK mode (${APPLY ? "APPLY" : "DRY RUN"})`);
  console.log("=".repeat(72));
  console.log("");

  await verifySource();

  // Plan first.
  console.log("Plan:");
  const plans: Array<{ target: (typeof TARGETS)[number]; plan: Plan }> = [];
  let abortReason: string | null = null;
  for (const target of TARGETS) {
    const plan = await planForTarget(target.playbookId, target.label);
    plans.push({ target, plan });
    if (plan.kind === "abort") {
      abortReason = `${target.label}: ${plan.reason}`;
    }
    const verb =
      plan.kind === "skip"
        ? `SKIP   (${plan.reason})`
        : plan.kind === "abort"
          ? `ABORT  (${plan.reason})`
          : `LINK   PlaybookCurriculum(role=linked) -> Curriculum ${SOURCE_CURRICULUM_ID}`;
    console.log(`  - ${target.label.padEnd(20)} : ${verb}`);
  }
  console.log("");

  if (abortReason) {
    console.error("ABORT: " + abortReason);
    console.error("");
    console.error(
      "No writes performed. Investigate the conflicting link(s) and re-run.",
    );
    return 2;
  }

  if (!APPLY) {
    console.log("[dry run] No DB writes. Re-run with --apply to commit.");
    console.log("");
    return 0;
  }

  // Apply.
  console.log("Applying...");
  for (const { target, plan } of plans) {
    if (plan.kind === "skip") {
      console.log(`  [${target.label}] SKIP — ${plan.reason}`);
      continue;
    }
    if (plan.kind !== "link") continue;
    await applyLink(target.playbookId, target.label);
    console.log(
      `  [${target.label}] LINKED → PlaybookCurriculum(role=linked, curriculumId=${SOURCE_CURRICULUM_ID})`,
    );
  }
  console.log("");

  await verifyPostApply();

  console.log("Done.");
  return 0;
}

main()
  .catch((err) => {
    console.error("");
    console.error("FATAL:", err instanceof Error ? err.message : err);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    process.exitCode = 1;
  })
  .then((code) => {
    if (typeof code === "number" && process.exitCode == null) {
      process.exitCode = code;
    }
    return prisma.$disconnect();
  });
