/**
 * One-off script: backfill null teachMethod on ContentAssertion records.
 * Run: npx tsx scripts/backfill-teach-methods.ts
 */
import { PrismaClient } from "@prisma/client";
import { categoryToTeachMethod, type TeachingMode } from "../lib/content-trust/resolve-config";
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

  console.log(`\nUpdated ${updated} / ${nullAssertions.length} assertions`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
