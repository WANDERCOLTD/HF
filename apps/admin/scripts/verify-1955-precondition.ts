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

import { PrismaClient, PlaybookCurriculumRole } from "@prisma/client";

const prisma = new PrismaClient();

const IELTS_PLAYBOOK_ID = "20b21160-0516-49c9-a8da-105772f41e64";

const IELTS_SKILL_PARAM_IDS = [
  "skill_fluency_and_coherence_fc",
  "skill_pronunciation_p",
  "skill_lexical_resource_lr",
  "skill_grammatical_range_and_accuracy_gra",
];

async function main() {
  const playbook = await prisma.playbook.findUnique({
    where: { id: IELTS_PLAYBOOK_ID },
    select: { id: true, name: true },
  });
  if (!playbook) {
    console.log(`[ERROR] Playbook ${IELTS_PLAYBOOK_ID} not found`);
    return;
  }
  console.log(`[ok] Playbook: ${playbook.name}`);

  const link = await prisma.playbookCurriculum.findFirst({
    where: { playbookId: IELTS_PLAYBOOK_ID, role: PlaybookCurriculumRole.primary },
    select: { curriculumId: true },
  });
  if (!link) {
    console.log("[ERROR] No primary curriculum");
    return;
  }
  console.log(`[ok] Curriculum: ${link.curriculumId}`);

  const modules = await prisma.curriculumModule.findMany({
    where: { curriculumId: link.curriculumId },
    select: {
      id: true,
      slug: true,
      title: true,
      sortOrder: true,
      learningObjectives: {
        select: { id: true, ref: true, description: true },
        orderBy: { ref: "asc" },
      },
    },
    orderBy: { sortOrder: "asc" },
  });

  console.log(`\n[modules] ${modules.length} total`);
  for (const m of modules) {
    console.log(`  - slug=${m.slug} title="${m.title}" (${m.learningObjectives.length} LOs)`);
  }

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
    console.log(`  - ref=${lo.ref} description="${(lo.description ?? "").slice(0, 80)}"`);
  }

  // CallerAttribute lo_mastery rows keyed on Part 3 slug
  const masteryAttrs = await prisma.callerAttribute.findMany({
    where: {
      key: { contains: `lo_mastery:${part3.slug}:` },
    },
    select: {
      key: true,
      stringValue: true,
      numberValue: true,
      callerId: true,
    },
    take: 20,
  });
  console.log(
    `\n[CallerAttribute] lo_mastery rows keyed on Part 3 module: ${masteryAttrs.length}`
  );
  for (const a of masteryAttrs.slice(0, 5)) {
    console.log(`  - ${a.key} = string:${a.stringValue?.slice(0, 30) ?? "null"} number:${a.numberValue ?? "null"}`);
  }

  // CallerTarget rows for the 4 IELTS skill params
  console.log(
    `\n[CallerTarget] Looking for the 4 IELTS skill parameterId values...`
  );
  let totalCallerTargetRows = 0;
  for (const paramId of IELTS_SKILL_PARAM_IDS) {
    const rows = await prisma.callerTarget.findMany({
      where: { parameterId: paramId },
      select: {
        callerId: true,
        parameterId: true,
        targetValue: true,
        currentScore: true,
      },
      take: 5,
    });
    totalCallerTargetRows += rows.length;
    console.log(`  ${paramId}: ${rows.length} CallerTarget row(s)`);
    for (const r of rows.slice(0, 2)) {
      console.log(
        `    - caller=${r.callerId.slice(0, 8)} target=${r.targetValue} current=${r.currentScore}`
      );
    }
  }

  // Probe Parameter table — do the 4 canonical IDs exist?
  const params = await prisma.parameter.findMany({
    where: { parameterId: { in: IELTS_SKILL_PARAM_IDS } },
    select: { parameterId: true, name: true, domainGroup: true },
  });
  console.log(`\n[Parameter table] ${params.length}/4 canonical params present:`);
  for (const p of params) {
    console.log(`  - ${p.parameterId}: name="${p.name}" domainGroup="${p.domainGroup}"`);
  }

  // LO description scan for skill hints
  console.log(`\n[LO descriptions] keyword presence in Part 3 LO descriptions:`);
  const skillKeywords: Record<string, string[]> = {
    fluency: ["fluency", "coherence"],
    pronunciation: ["pronunciation", "intonation"],
    lexical: ["lexical", "vocabulary", "lexis"],
    grammatical: ["grammatical", "grammar", "syntax"],
  };
  for (const lo of part3.learningObjectives) {
    const desc = (lo.description ?? "").toLowerCase();
    const found = Object.entries(skillKeywords)
      .filter(([, kws]) => kws.some((k) => desc.includes(k)))
      .map(([name]) => name);
    console.log(`  ${lo.ref}: ${found.length ? found.join(", ") : "(no skill keyword)"}`);
  }

  // === VERDICT ===
  console.log("\n=== VERDICT ===");
  console.log(
    `Total CallerTarget rows across all callers for the 4 IELTS skill params: ${totalCallerTargetRows}`
  );
  console.log(
    `Parameter table coverage: ${params.length}/4 canonical IDs present`
  );
  if (params.length < 4) {
    console.log(
      "[GAP] Canonical Parameter rows for the 4 IELTS skill params are NOT all present. Tagging is incomplete at the catalogue level."
    );
  }
  if (totalCallerTargetRows === 0) {
    console.log(
      "[GAP] No CallerTarget data exists for the 4 IELTS skill params yet. deriveFocusArea() will safely return null. The compose surface should still be wired so the feature lights up automatically when scoring writes appear."
    );
  } else {
    console.log("[ok] CallerTarget data exists — feature will function for at least one caller today.");
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
