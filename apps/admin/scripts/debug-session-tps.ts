/**
 * Debug: check why TPs aren't matching to sessions
 * Run: npx tsx scripts/debug-session-tps.ts
 */
import { prisma } from "@/lib/prisma";

async function main() {
  // Find the 11+ Comprehension course
  const pb = await prisma.playbook.findFirst({
    where: { name: { contains: "Comprehension 11" } },
    select: { id: true, name: true },
  });
  if (pb === null) {
    console.log("Course not found");
    return;
  }
  console.log("Course:", pb.id, pb.name);

  // Get its curriculum
  const cur = await prisma.curriculum.findFirst({
    where: { playbookId: pb.id },
    select: { id: true, subjectId: true, deliveryConfig: true },
  });
  if (cur === null) {
    console.log("No curriculum");
    return;
  }
  console.log("Curriculum:", cur.id, "subjectId:", cur.subjectId);

  const dc = (cur.deliveryConfig as any) || {};
  const entries = dc.lessonPlan?.entries || [];
  console.log("\nLesson plan entries:", entries.length);
  for (const e of entries.slice(0, 4)) {
    console.log(
      `  Session ${e.session} "${e.label}" | loRefs: ${e.learningOutcomeRefs?.length ?? 0} | assertionIds: ${e.assertionIds?.length ?? 0}`,
    );
    if (e.learningOutcomeRefs?.length) {
      console.log("    refs:", e.learningOutcomeRefs.slice(0, 3));
    }
  }

  // Check assertions
  if (cur.subjectId) {
    const withRef = await prisma.contentAssertion.count({
      where: {
        source: { subjects: { some: { subjectId: cur.subjectId } } },
        learningOutcomeRef: { not: null },
      },
    });
    const total = await prisma.contentAssertion.count({
      where: {
        source: { subjects: { some: { subjectId: cur.subjectId } } },
      },
    });
    console.log("\nAssertions total:", total, "| with learningOutcomeRef:", withRef);

    // Sample some assertion refs
    if (withRef > 0) {
      const samples = await prisma.contentAssertion.findMany({
        where: {
          source: { subjects: { some: { subjectId: cur.subjectId } } },
          learningOutcomeRef: { not: null },
        },
        select: { learningOutcomeRef: true },
        take: 5,
      });
      console.log(
        "\nSample assertion learningOutcomeRefs:",
        samples.map((s) => s.learningOutcomeRef),
      );
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
