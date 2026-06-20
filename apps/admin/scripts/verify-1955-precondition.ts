/**
 * Pre-condition verification for issue #1955 — Part 3 focus selector.
 *
 * Verifies that Part 3 LOs in the IELTS Speaking Practice playbook are
 * tagged with the four IELTS skill `parameterId` values:
 *   - skill_fluency_and_coherence_fc
 *   - skill_pronunciation_p
 *   - skill_lexical_resource_lr
 *   - skill_grammatical_range_and_accuracy_gra
 *
 * Reports whether deriveFocusArea() will have data to act on.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const IELTS_PLAYBOOK_ID = "20b21160-0516-49c9-a8da-105772f41e64";

const IELTS_SKILL_PARAM_IDS = [
  "skill_fluency_and_coherence_fc",
  "skill_pronunciation_p",
  "skill_lexical_resource_lr",
  "skill_grammatical_range_and_accuracy_gra",
];

async function main() {
  // Find the playbook + its curriculum
  const playbook = await prisma.playbook.findUnique({
    where: { id: IELTS_PLAYBOOK_ID },
    select: { id: true, courseTitle: true, config: true },
  });
  if (!playbook) {
    console.log(`[ERROR] Playbook ${IELTS_PLAYBOOK_ID} not found`);
    return;
  }
  console.log(`[ok] Playbook: ${playbook.courseTitle}`);

  const link = await prisma.playbookCurriculum.findFirst({
    where: { playbookId: IELTS_PLAYBOOK_ID, role: "primary" },
    select: { curriculumId: true },
  });
  if (!link) {
    console.log("[ERROR] No primary curriculum");
    return;
  }
  console.log(`[ok] Curriculum: ${link.curriculumId}`);

  // Enumerate modules; look for Part 3
  const modules = await prisma.curriculumModule.findMany({
    where: { curriculumId: link.curriculumId },
    select: {
      id: true,
      slug: true,
      title: true,
      orderIndex: true,
      learningObjectives: {
        select: { id: true, ref: true, statement: true },
        orderBy: { ref: "asc" },
      },
    },
    orderBy: { orderIndex: "asc" },
  });

  console.log(`\n[modules] ${modules.length} total`);
  for (const m of modules) {
    console.log(`  - slug=${m.slug} title="${m.title}" (${m.learningObjectives.length} LOs)`);
  }

  // Find Part 3 module (slug or title containing part-3 / part_3 / discussion)
  const part3 = modules.find((m) => {
    const hay = `${m.slug} ${m.title}`.toLowerCase();
    return (
      hay.includes("part-3") ||
      hay.includes("part_3") ||
      hay.includes("part 3") ||
      hay.includes("discussion")
    );
  });
  if (!part3) {
    console.log("\n[ERROR] No Part 3 module found by slug/title heuristic");
    return;
  }
  console.log(`\n[part3] slug=${part3.slug} title="${part3.title}"`);
  console.log(`[part3] ${part3.learningObjectives.length} LO(s):`);
  for (const lo of part3.learningObjectives) {
    console.log(`  - ref=${lo.ref} statement="${(lo.statement ?? "").slice(0, 80)}"`);
  }

  // Look for CallerAttribute rows shaped lo_mastery:{moduleSlug}:{loRef}
  const masteryAttrs = await prisma.callerAttribute.findMany({
    where: {
      key: { contains: `lo_mastery:${part3.slug}:` },
    },
    select: {
      key: true,
      valueText: true,
      callerId: true,
    },
    take: 20,
  });
  console.log(
    `\n[CallerAttribute] lo_mastery rows keyed on Part 3 module: ${masteryAttrs.length}`
  );
  for (const a of masteryAttrs.slice(0, 5)) {
    console.log(`  - ${a.key} = ${a.valueText?.slice(0, 50)}`);
  }

  // CallerTarget — look for the 4 skill parameter IDs scoped to Part 3
  console.log(
    `\n[CallerTarget] Looking for the 4 IELTS skill parameterId values in CallerTarget...`
  );
  for (const paramId of IELTS_SKILL_PARAM_IDS) {
    const rows = await prisma.callerTarget.findMany({
      where: { parameterId: paramId },
      select: {
        callerId: true,
        parameterId: true,
        targetValue: true,
        scope: true,
      },
      take: 5,
    });
    console.log(`  ${paramId}: ${rows.length} CallerTarget row(s)`);
    for (const r of rows.slice(0, 2)) {
      console.log(
        `    - caller=${r.callerId} scope=${JSON.stringify(r.scope)} targetValue=${r.targetValue}`
      );
    }
  }

  // Look at the LOs themselves — is there a parameterId / skill tag in their statements or metadata?
  console.log(
    `\n[LO inspection] Are Part 3 LOs tagged with any of the 4 skill parameter IDs?`
  );
  for (const lo of part3.learningObjectives) {
    const stmt = (lo.statement ?? "").toLowerCase();
    const matches = IELTS_SKILL_PARAM_IDS.filter(
      (p) =>
        stmt.includes(p) ||
        stmt.includes("fluency") ||
        stmt.includes("pronunciation") ||
        stmt.includes("lexical") ||
        stmt.includes("grammatical")
    );
    if (matches.length > 0) {
      console.log(`  ${lo.ref}: hints of ${matches.length} skill ref(s)`);
    } else {
      console.log(`  ${lo.ref}: no skill ref in statement`);
    }
  }

  // Look at the LO records more deeply — are there per-LO skill tags via subjectGroup, structure, etc.?
  const sampleLO = await prisma.learningObjective.findFirst({
    where: { moduleId: part3.id },
    select: {
      id: true,
      ref: true,
      statement: true,
      subjectGroup: true,
      structureNodeId: true,
      teachMethod: true,
      bloomLevel: true,
    },
  });
  console.log(`\n[sample LO full shape]`);
  console.log(JSON.stringify(sampleLO, null, 2));

  // Look at ContentAssertion / structure node for Part 3 to see if skill tags live there
  const assertions = await prisma.contentAssertion.findMany({
    where: {
      OR: [
        { canonicalRef: { contains: part3.slug } },
        { titleHint: { contains: "Part 3" } },
      ],
    },
    select: {
      id: true,
      canonicalRef: true,
      titleHint: true,
      category: true,
    },
    take: 10,
  });
  console.log(`\n[ContentAssertion] ${assertions.length} row(s) hinting Part 3:`);
  for (const a of assertions.slice(0, 5)) {
    console.log(`  - ${a.canonicalRef} cat=${a.category} title="${a.titleHint}"`);
  }

  // Verdict
  console.log("\n=== VERDICT ===");
  const anyCallerTargetForSkillParams = await prisma.callerTarget.count({
    where: { parameterId: { in: IELTS_SKILL_PARAM_IDS } },
  });
  console.log(
    `Total CallerTarget rows across all callers for the 4 IELTS skill params: ${anyCallerTargetForSkillParams}`
  );
  if (anyCallerTargetForSkillParams === 0) {
    console.log(
      "[GAP] No CallerTarget data for the 4 IELTS skill params exists yet. deriveFocusArea() will safely return null. The compose surface should still be wired so the feature lights up automatically when tagging+scoring lands."
    );
  } else {
    console.log("[ok] CallerTarget data exists for at least one IELTS skill param.");
  }

  // Also probe Parameter table for the 4 IDs to confirm they exist canonically
  const params = await prisma.parameter.findMany({
    where: { id: { in: IELTS_SKILL_PARAM_IDS } },
    select: { id: true, name: true, domainGroup: true },
  });
  console.log(`\n[Parameter table] ${params.length}/4 canonical params present:`);
  for (const p of params) {
    console.log(`  - ${p.id}: name="${p.name}" domainGroup="${p.domainGroup}"`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
