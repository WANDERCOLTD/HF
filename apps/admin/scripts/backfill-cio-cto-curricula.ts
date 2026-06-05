/**
 * Backfill — mirror the Revision Aid Curriculum onto Pop Quiz + Exam Assessment
 * Playbooks for the CIO/CTO Standard pilot.
 *
 * Why this script exists
 * ----------------------
 * The CIO/CTO Standard pilot has three Playbooks but only ONE has a Curriculum
 * wired (Revision Aid). Mastery is keyed `lo_mastery:{moduleSlug}:{loRef}` per
 * `.claude/rules/ai-to-db-guard.md` (#611 / #614 drain) — keyed by SLUG, not by
 * UUID. So if all three Playbooks have Curricula whose modules use the SAME
 * slug + LO ref set, mastery will share across all three courses automatically
 * with no schema change. Today, Pop Quiz + Exam Assessment have no Curriculum
 * → no modules → no LO mastery → tutor dead-ends when asked to scope per Unit.
 *
 * Fix: clone Revision Aid's curriculum structure (slug-for-slug, ref-for-ref)
 * onto each of the two missing Playbooks. Modules get NEW UUIDs but IDENTICAL
 * slugs (per-curriculum unique — see #407 / `lib/curriculum/resolve-module.ts`).
 * LearningObjectives get NEW UUIDs but IDENTICAL refs.
 *
 * Safety
 * ------
 * - DRY RUN by default. `--apply` actually writes.
 * - Wrapped in `prisma.$transaction` per target (partial failures roll back).
 * - Idempotent: if a Curriculum already exists for a target Playbook (either
 *   via `Curriculum.playbookId` or via `PlaybookCurriculum`), that target is
 *   skipped — no clobbering.
 * - Verification summary at the end confirms identical slugs + refs across
 *   all three Playbooks.
 *
 * Usage
 * -----
 *   npx tsx scripts/backfill-cio-cto-curricula.ts            # dry run
 *   npx tsx scripts/backfill-cio-cto-curricula.ts --apply    # commit
 */

import { ContentTrustLevel, LoSystemRole } from "@prisma/client";
import slugify from "slugify";

import { prisma } from "../lib/prisma";
import { resolveCurriculumIdForPlaybook } from "../lib/curriculum/resolve-module";

// =============================================================================
// Constants
// =============================================================================

const SOURCE_PLAYBOOK_ID = "5bbdbe7e-c32f-490e-8ff8-a938ddfc49a0"; // Revision Aid
const SOURCE_CURRICULUM_ID = "0ccb2874-f2d5-4431-96d0-0c0faf342636";
const SHARED_SUBJECT_ID = "a52307dd-d49c-4c8e-b080-22288aadab43";

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
// Types — narrow rows so we copy "every field that exists" deterministically
// =============================================================================

type SourceLO = {
  ref: string;
  description: string;
  sortOrder: number;
  masteryThreshold: number | null;
  originalText: string | null;
  learnerVisible: boolean;
  performanceStatement: string | null;
  systemRole: LoSystemRole;
  humanOverriddenAt: Date | null;
};

type SourceModule = {
  slug: string;
  title: string;
  description: string | null;
  sortOrder: number;
  estimatedDurationMinutes: number | null;
  masteryThreshold: number | null;
  prerequisites: string[];
  keyTerms: string[];
  assessmentCriteria: string[];
  terminal: boolean;
  coversModules: string[];
  isActive: boolean;
  sourceContentId: string | null;
  learningObjectives: SourceLO[];
};

type SourceCurriculum = {
  id: string;
  name: string;
  description: string | null;
  authors: string[];
  sourceTitle: string | null;
  sourceYear: number | null;
  notableInfo: unknown;
  coreArgument: unknown;
  caseStudies: unknown;
  discussionQuestions: unknown;
  critiques: unknown;
  deliveryConfig: unknown;
  constraints: unknown;
  sourceSpecId: string | null;
  version: string;
  trustLevel: ContentTrustLevel;
  primarySourceId: string | null;
  qualificationBody: string | null;
  qualificationNumber: string | null;
  qualificationLevel: string | null;
  validFrom: Date | null;
  validUntil: Date | null;
  subjectId: string | null;
  modules: SourceModule[];
};

// =============================================================================
// Source-of-truth read
// =============================================================================

async function loadSourceCurriculum(): Promise<SourceCurriculum> {
  const row = await prisma.curriculum.findUnique({
    where: { id: SOURCE_CURRICULUM_ID },
    include: {
      modules: {
        orderBy: { sortOrder: "asc" },
        include: {
          learningObjectives: {
            orderBy: { sortOrder: "asc" },
          },
        },
      },
    },
  });

  if (!row) {
    throw new Error(
      `Source curriculum ${SOURCE_CURRICULUM_ID} not found in DB. ` +
        `Cannot proceed — verify you are connected to the correct database.`,
    );
  }

  if (row.modules.length === 0) {
    throw new Error(
      `Source curriculum ${SOURCE_CURRICULUM_ID} has zero modules. ` +
        `Refusing to clone an empty structure.`,
    );
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    authors: row.authors,
    sourceTitle: row.sourceTitle,
    sourceYear: row.sourceYear,
    notableInfo: row.notableInfo,
    coreArgument: row.coreArgument,
    caseStudies: row.caseStudies,
    discussionQuestions: row.discussionQuestions,
    critiques: row.critiques,
    deliveryConfig: row.deliveryConfig,
    constraints: row.constraints,
    sourceSpecId: row.sourceSpecId,
    version: row.version,
    trustLevel: row.trustLevel,
    primarySourceId: row.primarySourceId,
    qualificationBody: row.qualificationBody,
    qualificationNumber: row.qualificationNumber,
    qualificationLevel: row.qualificationLevel,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    subjectId: row.subjectId,
    modules: row.modules.map((m) => ({
      slug: m.slug,
      title: m.title,
      description: m.description,
      sortOrder: m.sortOrder,
      estimatedDurationMinutes: m.estimatedDurationMinutes,
      masteryThreshold: m.masteryThreshold,
      prerequisites: m.prerequisites,
      keyTerms: m.keyTerms,
      assessmentCriteria: m.assessmentCriteria,
      terminal: m.terminal,
      coversModules: m.coversModules,
      isActive: m.isActive,
      sourceContentId: m.sourceContentId,
      learningObjectives: m.learningObjectives.map((lo) => ({
        ref: lo.ref,
        description: lo.description,
        sortOrder: lo.sortOrder,
        masteryThreshold: lo.masteryThreshold,
        originalText: lo.originalText,
        learnerVisible: lo.learnerVisible,
        performanceStatement: lo.performanceStatement,
        systemRole: lo.systemRole,
        humanOverriddenAt: lo.humanOverriddenAt,
      })),
    })),
  };
}

// =============================================================================
// Target enumeration
// =============================================================================

type TargetPlan =
  | {
      kind: "skip";
      playbookId: string;
      label: string;
      reason: string;
      existingCurriculumId: string;
    }
  | {
      kind: "clone";
      playbookId: string;
      label: string;
      playbookName: string;
      newCurriculumSlug: string;
    };

async function planTargets(): Promise<TargetPlan[]> {
  const plans: TargetPlan[] = [];

  for (const t of TARGETS) {
    const playbook = await prisma.playbook.findUnique({
      where: { id: t.playbookId },
      select: { id: true, name: true },
    });

    if (!playbook) {
      throw new Error(
        `Target Playbook ${t.playbookId} (${t.label}) not found in DB. ` +
          `Aborting — wrong environment, or pilot data not yet seeded.`,
      );
    }

    // Use the canonical resolver so we honour BOTH the deprecated
    // `Curriculum.playbookId` pointer AND the new `PlaybookCurriculum`
    // join (#1034). Either match means "already wired — leave alone".
    const existingCurriculumId = await resolveCurriculumIdForPlaybook(
      t.playbookId,
    );

    if (existingCurriculumId) {
      plans.push({
        kind: "skip",
        playbookId: t.playbookId,
        label: t.label,
        existingCurriculumId,
        reason: "Curriculum already exists for this playbookId",
      });
      continue;
    }

    // Curriculum slug is globally unique — generate a stable derivation
    // from the playbook name. e.g. "The CIO/CTO Standard — Pop Quiz"
    // → "the-cio-cto-standard-pop-quiz-curriculum".
    const baseSlug = slugify(playbook.name, { lower: true, strict: true });
    const newCurriculumSlug = `${baseSlug}-curriculum`;

    // Pre-flight: refuse to collide on the global unique slug.
    const collision = await prisma.curriculum.findUnique({
      where: { slug: newCurriculumSlug },
      select: { id: true, playbookId: true },
    });
    if (collision) {
      throw new Error(
        `Generated curriculum slug "${newCurriculumSlug}" already exists ` +
          `(curriculum id ${collision.id}, playbookId ${collision.playbookId ?? "null"}). ` +
          `This indicates a partial prior run — investigate before re-running.`,
      );
    }

    plans.push({
      kind: "clone",
      playbookId: t.playbookId,
      label: t.label,
      playbookName: playbook.name,
      newCurriculumSlug,
    });
  }

  return plans;
}

// =============================================================================
// Clone (transactional, one target at a time)
// =============================================================================

async function cloneCurriculum(
  source: SourceCurriculum,
  plan: Extract<TargetPlan, { kind: "clone" }>,
): Promise<{
  curriculumId: string;
  moduleCount: number;
  loCount: number;
}> {
  return prisma.$transaction(async (tx) => {
    // Defensive re-check inside the txn: a peer process could have wired
    // a Curriculum between planTargets() and now. Bail out gracefully.
    const racedJoin = await tx.playbookCurriculum.findFirst({
      where: { playbookId: plan.playbookId },
      select: { curriculumId: true },
    });
    if (racedJoin) {
      throw new Error(
        `Race condition: PlaybookCurriculum row for ${plan.playbookId} ` +
          `appeared between plan and write (curriculumId ${racedJoin.curriculumId}). ` +
          `Aborting this target's transaction.`,
      );
    }
    const racedDeprecated = await tx.curriculum.findFirst({
      where: { playbookId: plan.playbookId },
      select: { id: true },
    });
    if (racedDeprecated) {
      throw new Error(
        `Race condition: Curriculum.playbookId pointer for ${plan.playbookId} ` +
          `appeared between plan and write (curriculum id ${racedDeprecated.id}). ` +
          `Aborting this target's transaction.`,
      );
    }

    const newCurriculum = await tx.curriculum.create({
      data: {
        // id, createdAt, updatedAt — auto-generated
        slug: plan.newCurriculumSlug,
        name: `${plan.playbookName} — Curriculum`,
        description: source.description,
        authors: source.authors,
        sourceTitle: source.sourceTitle,
        sourceYear: source.sourceYear,
        notableInfo: source.notableInfo as never,
        coreArgument: source.coreArgument as never,
        caseStudies: source.caseStudies as never,
        discussionQuestions: source.discussionQuestions as never,
        critiques: source.critiques as never,
        deliveryConfig: source.deliveryConfig as never,
        constraints: source.constraints as never,
        sourceSpecId: source.sourceSpecId,
        version: source.version,
        trustLevel: source.trustLevel,
        primarySourceId: source.primarySourceId,
        qualificationBody: source.qualificationBody,
        qualificationNumber: source.qualificationNumber,
        qualificationLevel: source.qualificationLevel,
        validFrom: source.validFrom,
        validUntil: source.validUntil,
        subjectId: SHARED_SUBJECT_ID,
        // playbookId: deprecated pointer (#1034) — write it for back-compat
        // with any reader that hasn't yet migrated to PlaybookCurriculum.
        // Dropped in #1038; harmless to write now.
        playbookId: plan.playbookId,
      },
    });

    // Dual-write to PlaybookCurriculum (canonical join — #1034).
    await tx.playbookCurriculum.create({
      data: {
        playbookId: plan.playbookId,
        curriculumId: newCurriculum.id,
        role: "primary",
      },
    });

    let loCount = 0;

    for (const m of source.modules) {
      const newModule = await tx.curriculumModule.create({
        data: {
          curriculumId: newCurriculum.id,
          slug: m.slug, // IDENTICAL to source — required for mastery sharing
          title: m.title,
          description: m.description,
          sortOrder: m.sortOrder,
          estimatedDurationMinutes: m.estimatedDurationMinutes,
          masteryThreshold: m.masteryThreshold,
          prerequisites: m.prerequisites,
          keyTerms: m.keyTerms,
          assessmentCriteria: m.assessmentCriteria,
          terminal: m.terminal,
          coversModules: m.coversModules,
          isActive: m.isActive,
          sourceContentId: m.sourceContentId,
        },
      });

      if (m.learningObjectives.length > 0) {
        await tx.learningObjective.createMany({
          data: m.learningObjectives.map((lo) => ({
            moduleId: newModule.id,
            ref: lo.ref, // IDENTICAL to source — required for mastery sharing
            description: lo.description,
            sortOrder: lo.sortOrder,
            masteryThreshold: lo.masteryThreshold,
            originalText: lo.originalText,
            learnerVisible: lo.learnerVisible,
            performanceStatement: lo.performanceStatement,
            systemRole: lo.systemRole,
            humanOverriddenAt: lo.humanOverriddenAt,
          })),
        });
        loCount += m.learningObjectives.length;
      }
    }

    return {
      curriculumId: newCurriculum.id,
      moduleCount: source.modules.length,
      loCount,
    };
  });
}

// =============================================================================
// Verification — confirm all three Playbooks have identical structure
// =============================================================================

async function verifyAllThree(): Promise<void> {
  const playbookIds = [SOURCE_PLAYBOOK_ID, ...TARGETS.map((t) => t.playbookId)];
  const rows: Array<{
    playbookId: string;
    label: string;
    curriculumId: string | null;
    moduleSlugs: string[];
    moduleCount: number;
    loCount: number;
    loRefsSorted: string[];
  }> = [];

  for (const playbookId of playbookIds) {
    const label =
      playbookId === SOURCE_PLAYBOOK_ID
        ? "Revision Aid (source)"
        : TARGETS.find((t) => t.playbookId === playbookId)?.label ?? "(unknown)";

    const curriculumId = await resolveCurriculumIdForPlaybook(playbookId);
    if (!curriculumId) {
      rows.push({
        playbookId,
        label,
        curriculumId: null,
        moduleSlugs: [],
        moduleCount: 0,
        loCount: 0,
        loRefsSorted: [],
      });
      continue;
    }

    const modules = await prisma.curriculumModule.findMany({
      where: { curriculumId },
      orderBy: { sortOrder: "asc" },
      select: {
        slug: true,
        learningObjectives: {
          select: { ref: true },
        },
      },
    });

    const moduleSlugs = modules.map((m) => m.slug);
    const loRefs = modules.flatMap((m) =>
      m.learningObjectives.map((lo) => `${m.slug}/${lo.ref}`),
    );

    rows.push({
      playbookId,
      label,
      curriculumId,
      moduleSlugs,
      moduleCount: modules.length,
      loCount: loRefs.length,
      loRefsSorted: loRefs.sort(),
    });
  }

  console.log("");
  console.log("=== Verification ===");
  for (const r of rows) {
    console.log(
      `  ${r.label.padEnd(28)} curriculum=${r.curriculumId ?? "(none)"} modules=${r.moduleCount} LOs=${r.loCount}`,
    );
    console.log(`    moduleSlugs: [${r.moduleSlugs.join(", ")}]`);
  }

  // Identity check across all three (only meaningful when all three have rows).
  const wired = rows.filter((r) => r.curriculumId !== null);
  if (wired.length === 3) {
    const baselineSlugs = JSON.stringify(wired[0].moduleSlugs);
    const baselineLORefs = JSON.stringify(wired[0].loRefsSorted);
    const slugsMatch = wired.every(
      (r) => JSON.stringify(r.moduleSlugs) === baselineSlugs,
    );
    const lorefsMatch = wired.every(
      (r) => JSON.stringify(r.loRefsSorted) === baselineLORefs,
    );

    console.log("");
    console.log(
      `  module-slug identity:  ${slugsMatch ? "OK — all three share identical module slugs" : "MISMATCH — mastery will NOT share across courses"}`,
    );
    console.log(
      `  LO-ref identity:       ${lorefsMatch ? "OK — all three share identical LO refs" : "MISMATCH — mastery will NOT share across courses"}`,
    );
  } else {
    console.log("");
    console.log(
      `  (skipped identity check — only ${wired.length}/3 Playbooks have a Curriculum wired)`,
    );
  }
}

// =============================================================================
// Dry-run rendering
// =============================================================================

function renderPlanTree(
  source: SourceCurriculum,
  plans: TargetPlan[],
): void {
  console.log("");
  console.log("=== Source (template) ===");
  console.log(
    `  Curriculum ${source.id} "${source.name}"`,
  );
  console.log(`    ${source.modules.length} modules:`);
  for (const m of source.modules) {
    console.log(
      `      - slug="${m.slug}" title="${m.title}" sortOrder=${m.sortOrder} LOs=${m.learningObjectives.length}`,
    );
    for (const lo of m.learningObjectives) {
      console.log(
        `          ref="${lo.ref}" sortOrder=${lo.sortOrder} learnerVisible=${lo.learnerVisible}`,
      );
    }
  }

  console.log("");
  console.log("=== Plan ===");
  for (const p of plans) {
    if (p.kind === "skip") {
      console.log(
        `  SKIP   ${p.label} (playbook=${p.playbookId}) — ${p.reason} (existing curriculum=${p.existingCurriculumId})`,
      );
    } else {
      const totalLOs = source.modules.reduce(
        (sum, m) => sum + m.learningObjectives.length,
        0,
      );
      console.log(
        `  CLONE  ${p.label} (playbook=${p.playbookId})`,
      );
      console.log(`         → new Curriculum slug="${p.newCurriculumSlug}"`);
      console.log(`         → new Curriculum name="${p.playbookName} — Curriculum"`);
      console.log(`         → subjectId=${SHARED_SUBJECT_ID} (shared)`);
      console.log(
        `         → will create ${source.modules.length} CurriculumModule rows (identical slugs)`,
      );
      console.log(
        `         → will create ${totalLOs} LearningObjective rows (identical refs)`,
      );
      console.log(
        `         → will create 1 PlaybookCurriculum (role=primary) + write Curriculum.playbookId for back-compat`,
      );
    }
  }
}

// =============================================================================
// Entry point
// =============================================================================

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const mode = apply ? "APPLY" : "DRY-RUN";

  console.log(`[backfill-cio-cto-curricula] mode=${mode}`);
  console.log(
    `[backfill-cio-cto-curricula] source playbook=${SOURCE_PLAYBOOK_ID} (Revision Aid)`,
  );
  console.log(
    `[backfill-cio-cto-curricula] source curriculum=${SOURCE_CURRICULUM_ID}`,
  );
  console.log(
    `[backfill-cio-cto-curricula] shared subject=${SHARED_SUBJECT_ID}`,
  );

  // Sanity: ensure the source Playbook also points at the source Curriculum.
  // If not, the operator is pointed at the wrong DB or the IDs have drifted.
  const sourcePlaybookCurriculumId = await resolveCurriculumIdForPlaybook(
    SOURCE_PLAYBOOK_ID,
  );
  if (sourcePlaybookCurriculumId !== SOURCE_CURRICULUM_ID) {
    console.error(
      `[backfill-cio-cto-curricula] FATAL: source Playbook ${SOURCE_PLAYBOOK_ID} ` +
        `resolves to curriculum ${sourcePlaybookCurriculumId ?? "(none)"}, ` +
        `expected ${SOURCE_CURRICULUM_ID}. Wrong DB or drifted IDs.`,
    );
    process.exit(2);
  }

  const source = await loadSourceCurriculum();
  console.log(
    `[backfill-cio-cto-curricula] loaded source: ${source.modules.length} modules, ` +
      `${source.modules.reduce((s, m) => s + m.learningObjectives.length, 0)} LOs`,
  );

  const plans = await planTargets();
  renderPlanTree(source, plans);

  if (!apply) {
    console.log("");
    console.log("Run with --apply to commit.");
    await verifyAllThree();
    await prisma.$disconnect();
    return;
  }

  console.log("");
  console.log("=== Apply ===");
  for (const p of plans) {
    if (p.kind === "skip") {
      console.log(`  SKIP   ${p.label} — ${p.reason}`);
      continue;
    }
    console.log(`  CLONE  ${p.label}...`);
    try {
      const result = await cloneCurriculum(source, p);
      console.log(
        `         OK — curriculum=${result.curriculumId} modules=${result.moduleCount} LOs=${result.loCount}`,
      );
    } catch (err) {
      console.error(`         FAIL — ${(err as Error).message}`);
      throw err;
    }
  }

  await verifyAllThree();
  console.log("");
  console.log("Backfill complete.");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[backfill-cio-cto-curricula] FATAL:", err);
  process.exit(1);
});
