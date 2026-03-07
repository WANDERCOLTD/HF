/**
 * seed-english-modules.ts
 *
 * Seeds CurriculumModule records for the English Language Curriculum
 * and updates the deliveryConfig lesson plan entries with moduleIds.
 *
 * Run: npx tsx prisma/seed-english-modules.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CURRICULUM_SLUG = "english-language-curriculum";

const MODULES = [
  {
    slug: "reading-comprehension-skills",
    title: "Reading Comprehension Skills",
    description: "Identifying main ideas, supporting detail, and inference in unseen texts.",
    sortOrder: 0,
    estimatedDurationMinutes: 48, // sessions 1+2
    masteryThreshold: 0.75,
    keyTerms: ["inference", "retrieval", "implicit meaning", "tone", "purpose"],
    assessmentCriteria: [
      "Retrieve explicit information from a passage",
      "Make supported inferences from textual evidence",
      "Identify the main idea and supporting detail",
    ],
    // Matches lesson plan labels containing "reading-comprehension-skills"
    lessonPlanLabelPattern: "reading-comprehension-skills",
  },
  {
    slug: "vocabulary-context-skills",
    title: "Vocabulary & Context Skills",
    description: "Deriving meaning of unfamiliar words from context, and applying vocabulary precisely.",
    sortOrder: 1,
    estimatedDurationMinutes: 22,
    masteryThreshold: 0.75,
    keyTerms: ["context clues", "synonyms", "connotation", "word meaning", "register"],
    assessmentCriteria: [
      "Determine the meaning of a word from context",
      "Select the most precise synonym for a given use",
      "Explain how word choice affects tone or meaning",
    ],
    lessonPlanLabelPattern: "vocabulary-context-skills",
  },
  {
    slug: "retrieval-inference-development",
    title: "Retrieval, Inference & Text Development",
    description: "Advanced retrieval, authorial intent, structural choices, and extended inference chains.",
    sortOrder: 2,
    estimatedDurationMinutes: 46,
    masteryThreshold: 0.75,
    keyTerms: ["authorial intent", "structural choice", "inference chain", "text development", "language techniques"],
    assessmentCriteria: [
      "Trace how a text develops across paragraphs",
      "Identify and explain authorial techniques",
      "Construct extended inference chains with evidence",
    ],
    lessonPlanLabelPattern: "retrieval-inference-development",
  },
];

async function main() {
  console.log("=== Seed English Curriculum Modules ===\n");

  const curriculum = await prisma.curriculum.findUnique({
    where: { slug: CURRICULUM_SLUG },
  });

  if (!curriculum) {
    console.error(`Curriculum "${CURRICULUM_SLUG}" not found — run full seed first.`);
    process.exit(1);
  }

  console.log(`Found curriculum: ${curriculum.name} (${curriculum.id})\n`);

  const createdModules: Record<string, string> = {}; // slug → id

  for (const mod of MODULES) {
    const existing = await prisma.curriculumModule.findFirst({
      where: { curriculumId: curriculum.id, slug: mod.slug },
    });

    if (existing) {
      console.log(`  [skip] ${mod.slug} — already exists (${existing.id})`);
      createdModules[mod.slug] = existing.id;
      continue;
    }

    const { lessonPlanLabelPattern: _, ...moduleData } = mod;
    const created = await prisma.curriculumModule.create({
      data: {
        curriculumId: curriculum.id,
        slug: moduleData.slug,
        title: moduleData.title,
        description: moduleData.description,
        sortOrder: moduleData.sortOrder,
        estimatedDurationMinutes: moduleData.estimatedDurationMinutes,
        masteryThreshold: moduleData.masteryThreshold,
        keyTerms: moduleData.keyTerms,
        assessmentCriteria: moduleData.assessmentCriteria,
      },
    });

    createdModules[mod.slug] = created.id;
    console.log(`  [ok] ${mod.slug}: ${created.id}`);
  }

  // Update deliveryConfig lesson plan entries with moduleIds
  const deliveryConfig = curriculum.deliveryConfig as Record<string, any> | null;
  if (deliveryConfig?.lessonPlan?.entries) {
    const entries = deliveryConfig.lessonPlan.entries as Array<Record<string, any>>;
    let updated = 0;

    for (const entry of entries) {
      // Match entry label to module by pattern
      const label: string = entry.label ?? "";
      const matchedMod = MODULES.find((m) => label.includes(m.lessonPlanLabelPattern));

      if (matchedMod && createdModules[matchedMod.slug]) {
        const moduleId = createdModules[matchedMod.slug];
        if (entry.moduleId !== moduleId) {
          entry.moduleId = moduleId;
          entry.moduleLabel = matchedMod.title;
          updated++;
        }
      }
    }

    if (updated > 0) {
      await prisma.curriculum.update({
        where: { id: curriculum.id },
        data: {
          deliveryConfig: {
            ...deliveryConfig,
            lessonPlan: {
              ...deliveryConfig.lessonPlan,
              entries,
            },
          },
        },
      });
      console.log(`\n  [ok] Updated ${updated} lesson plan entries with moduleIds`);
    } else {
      console.log(`\n  [skip] Lesson plan entries already have moduleIds`);
    }
  }

  console.log("\n=== Done ===");
  console.log(`  Modules: ${Object.keys(createdModules).length}`);
  console.log(`  IDs: ${JSON.stringify(createdModules, null, 2)}`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
