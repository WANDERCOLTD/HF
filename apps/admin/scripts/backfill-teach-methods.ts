/**
 * One-off script: backfill teachMethod on ContentAssertion records.
 *
 * Two passes:
 *   1. Null backfill — rows with teachMethod IS NULL, classified via
 *      categoryToTeachMethod() using playbook/subject teachingMode.
 *   2. #605 INSTRUCTION_CATEGORIES re-tag — rows whose category is in
 *      INSTRUCTION_CATEGORIES but whose teachMethod is a learner-facing
 *      value (legacy: "recall_quiz", or anything ≠ "tutor_instruction").
 *      Reassigns them to "tutor_instruction" so the new
 *      categoryToTeachMethod guard takes effect on historical rows.
 *
 * Run: npx tsx scripts/backfill-teach-methods.ts
 */
import { PrismaClient } from "@prisma/client";
import {
  categoryToTeachMethod,
  INSTRUCTION_CATEGORIES,
  type TeachingMode,
} from "../lib/content-trust/resolve-config";
import { getTeachingProfile } from "../lib/content-trust/teaching-profiles";

async function main() {
  const prisma = new PrismaClient();

  const nullAssertions = await prisma.contentAssertion.findMany({
    where: { teachMethod: null },
    select: {
      id: true,
      category: true,
      source: {
        select: {
          subjects: {
            select: {
              subject: {
                select: {
                  id: true,
                  teachingProfile: true,
                  teachingOverrides: true,
                  domains: {
                    select: {
                      domain: {
                        select: {
                          playbooks: {
                            select: { config: true },
                            where: { status: { in: ["PUBLISHED", "DRAFT"] } },
                            take: 1,
                          },
                        },
                      },
                    },
                    take: 1,
                  },
                },
              },
            },
            take: 1,
          },
        },
      },
    },
  });

  console.log(`Found ${nullAssertions.length} assertions with null teachMethod`);

  if (nullAssertions.length === 0) {
    console.log("Nothing to backfill.");
    await prisma.$disconnect();
    return;
  }

  let updated = 0;
  const byCat = new Map<string, { ids: string[]; teachMethod: string }>();

  for (const a of nullAssertions) {
    const category = a.category || "fact";

    // Resolve teachingMode from playbook or subject profile
    let teachingMode: TeachingMode = "recall";
    const subject = a.source?.subjects?.[0]?.subject;
    if (subject) {
      const pb = subject.domains?.[0]?.domain?.playbooks?.[0];
      const pbConfig = pb?.config as Record<string, any> | null;
      if (pbConfig?.teachingMode) {
        teachingMode = pbConfig.teachingMode as TeachingMode;
      } else if (subject.teachingProfile) {
        const profile = getTeachingProfile(subject.teachingProfile as any);
        if (profile) {
          const overrides = (subject.teachingOverrides as Record<string, any>) || {};
          teachingMode = (overrides.teachingMode || profile.teachingMode) as TeachingMode;
        }
      }
    }

    const teachMethod = categoryToTeachMethod(category, teachingMode);
    const key = `${category}:${teachMethod}`;
    if (!byCat.has(key)) byCat.set(key, { ids: [], teachMethod });
    byCat.get(key)!.ids.push(a.id);
  }

  for (const [key, { ids, teachMethod }] of byCat) {
    const result = await prisma.contentAssertion.updateMany({
      where: { id: { in: ids } },
      data: { teachMethod },
    });
    updated += result.count;
    console.log(`  ${key} -> ${teachMethod} (${result.count} rows)`);
  }

  console.log(`\nPass 1 (null backfill): updated ${updated} / ${nullAssertions.length} assertions`);

  // ── Pass 2 — #605 INSTRUCTION_CATEGORIES re-tag ──────────────────────
  console.log(`\nPass 2 (#605 INSTRUCTION_CATEGORIES re-tag)`);
  const misTagged = await prisma.contentAssertion.findMany({
    where: {
      category: { in: [...INSTRUCTION_CATEGORIES] },
      NOT: { teachMethod: "tutor_instruction" },
    },
    select: { id: true, category: true, teachMethod: true },
  });
  console.log(`  found ${misTagged.length} rows with INSTRUCTION_CATEGORY + non-tutor_instruction teachMethod`);

  if (misTagged.length > 0) {
    const byPriorMethod = new Map<string, number>();
    for (const a of misTagged) {
      const k = a.teachMethod ?? "(null)";
      byPriorMethod.set(k, (byPriorMethod.get(k) ?? 0) + 1);
    }
    for (const [prior, count] of byPriorMethod) {
      console.log(`  prior teachMethod="${prior}": ${count} rows`);
    }
    const result = await prisma.contentAssertion.updateMany({
      where: { id: { in: misTagged.map((a) => a.id) } },
      data: { teachMethod: "tutor_instruction" },
    });
    console.log(`  re-tagged ${result.count} rows → "tutor_instruction"`);
  }

  // ── Post-migration audit ─────────────────────────────────────────────
  const remainingNulls = await prisma.contentAssertion.count({ where: { teachMethod: null } });
  const remainingMistags = await prisma.contentAssertion.count({
    where: {
      category: { in: [...INSTRUCTION_CATEGORIES] },
      teachMethod: "recall_quiz",
    },
  });
  console.log(`\nPost-migration audit:`);
  console.log(`  nulls remaining:                   ${remainingNulls}  (target 0)`);
  console.log(`  recall_quiz on INSTRUCTION_CATs:   ${remainingMistags}  (target 0, drives #605 counter)`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
