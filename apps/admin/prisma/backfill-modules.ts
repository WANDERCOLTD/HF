/**
 * backfill-modules.ts
 *
 * One-time migration: populate CurriculumModule + LearningObjective tables
 * from existing JSON data in Curriculum.notableInfo.modules[] and
 * AnalysisSpec.config.modules[].
 *
 * Also backfills CallerModuleProgress from CallerAttribute mastery keys.
 *
 * Run: npx tsx prisma/backfill-modules.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// LO ref parsing — extract short ref from text like "LO1: Identify..."
// ---------------------------------------------------------------------------

const LO_REF_PATTERN = /^(LO\d+|AC[\d.]+|R\d+-LO\d+(?:-AC[\d.]+)?)\s*[:\-–]\s*/i;

function parseLORef(text: string, index: number): { ref: string; description: string } {
  const match = text.match(LO_REF_PATTERN);
  if (match) {
    return {
      ref: match[1].toUpperCase(),
      description: text.slice(match[0].length).trim() || text,
    };
  }
  // No parseable ref — generate one
  return { ref: `LO-${index + 1}`, description: text };
}

// ---------------------------------------------------------------------------
// Phase 1: Backfill from Curriculum.notableInfo.modules
// ---------------------------------------------------------------------------

async function backfillFromCurricula(): Promise<{ modules: number; los: number }> {
  let moduleCount = 0;
  let loCount = 0;

  const curricula = await prisma.curriculum.findMany({
    select: { id: true, slug: true, notableInfo: true },
  });

  for (const curr of curricula) {
    const info = curr.notableInfo as Record<string, any> | null;
    const modules = info?.modules;
    if (!Array.isArray(modules) || modules.length === 0) continue;

    // Check if already backfilled
    const existing = await prisma.curriculumModule.count({
      where: { curriculumId: curr.id },
    });
    if (existing > 0) {
      console.log(`  [skip] ${curr.slug} — already has ${existing} modules`);
      continue;
    }

    for (const mod of modules) {
      const slug = mod.id || `MOD-${modules.indexOf(mod) + 1}`;
      const created = await prisma.curriculumModule.create({
        data: {
          curriculumId: curr.id,
          slug,
          title: mod.title || slug,
          description: mod.description || null,
          sortOrder: mod.sortOrder ?? modules.indexOf(mod),
          estimatedDurationMinutes: mod.estimatedDurationMinutes || null,
          keyTerms: mod.keyTerms || [],
          assessmentCriteria: mod.assessmentCriteria || [],
        },
      });
      moduleCount++;

      // Create LearningObjective records
      const los: string[] = mod.learningOutcomes || [];
      for (let i = 0; i < los.length; i++) {
        const { ref, description } = parseLORef(los[i], i);
        try {
          await prisma.learningObjective.create({
            data: {
              moduleId: created.id,
              ref,
              description,
              sortOrder: i,
            },
          });
          loCount++;
        } catch (e: any) {
          // Handle duplicate ref within same module (unlikely but safe)
          if (e.code === "P2002") {
            console.warn(`  [dup] ${curr.slug}/${slug}: duplicate ref "${ref}"`);
          } else {
            throw e;
          }
        }
      }
    }
    console.log(`  [ok] ${curr.slug}: ${modules.length} modules`);
  }

  return { modules: moduleCount, los: loCount };
}

// ---------------------------------------------------------------------------
// Phase 2: Backfill from AnalysisSpec.config.modules (CONTENT specs)
// ---------------------------------------------------------------------------

async function backfillFromSpecs(): Promise<{ modules: number; los: number }> {
  let moduleCount = 0;
  let loCount = 0;

  // Find CONTENT specs with modules in config
  const specs = await prisma.analysisSpec.findMany({
    where: { specRole: "CONTENT", isActive: true },
    select: { id: true, slug: true, config: true },
  });

  for (const spec of specs) {
    const config = spec.config as Record<string, any> | null;
    const modules = config?.modules || config?.curriculum?.modules;
    if (!Array.isArray(modules) || modules.length === 0) continue;

    // Find the curriculum linked to this spec
    const curriculum = await prisma.curriculum.findFirst({
      where: { sourceSpecId: spec.id },
      select: { id: true, slug: true },
    });
    if (!curriculum) {
      console.log(`  [skip] spec ${spec.slug} — no linked curriculum`);
      continue;
    }

    // Check if already backfilled
    const existing = await prisma.curriculumModule.count({
      where: { curriculumId: curriculum.id },
    });
    if (existing > 0) {
      console.log(`  [skip] spec ${spec.slug} → ${curriculum.slug} — already has ${existing} modules`);
      continue;
    }

    for (let i = 0; i < modules.length; i++) {
      const mod = modules[i];
      const slug = mod.slug || mod.id || `MOD-${i + 1}`;
      const created = await prisma.curriculumModule.create({
        data: {
          curriculumId: curriculum.id,
          slug,
          title: mod.name || mod.title || slug,
          description: mod.description || null,
          sortOrder: mod.sortOrder ?? mod.sequence ?? i,
          estimatedDurationMinutes: mod.estimatedDurationMinutes || null,
          keyTerms: mod.keyTerms || mod.concepts || [],
          assessmentCriteria: mod.assessmentCriteria || [],
          masteryThreshold: mod.masteryThreshold || null,
          prerequisites: mod.prerequisites || [],
        },
      });
      moduleCount++;

      const los: string[] = mod.learningOutcomes || [];
      for (let j = 0; j < los.length; j++) {
        const { ref, description } = parseLORef(los[j], j);
        try {
          await prisma.learningObjective.create({
            data: {
              moduleId: created.id,
              ref,
              description,
              sortOrder: j,
            },
          });
          loCount++;
        } catch (e: any) {
          if (e.code === "P2002") {
            console.warn(`  [dup] spec ${spec.slug}/${slug}: duplicate ref "${ref}"`);
          } else {
            throw e;
          }
        }
      }
    }
    console.log(`  [ok] spec ${spec.slug}: ${modules.length} modules`);
  }

  return { modules: moduleCount, los: loCount };
}

// ---------------------------------------------------------------------------
// Phase 3: Link ContentAssertion.learningOutcomeRef → LearningObjective
// ---------------------------------------------------------------------------

async function linkAssertions(): Promise<number> {
  let linked = 0;

  // Find all LOs with their curriculum chain (module → curriculum → subject)
  const objectives = await prisma.learningObjective.findMany({
    select: {
      id: true,
      ref: true,
      module: {
        select: {
          curriculum: {
            select: {
              subjectId: true,
            },
          },
        },
      },
    },
  });

  // Group LOs by subjectId + ref for efficient matching
  const loMap = new Map<string, string>(); // "subjectId:ref" → objectiveId
  for (const lo of objectives) {
    const subjectId = lo.module.curriculum.subjectId;
    if (!subjectId) continue;
    loMap.set(`${subjectId}:${lo.ref}`, lo.id);
  }

  if (loMap.size === 0) {
    console.log("  No LOs with subject links found — skipping assertion linkage");
    return 0;
  }

  // Find assertions with learningOutcomeRef that don't have a learningObjectiveId yet
  const assertions = await prisma.contentAssertion.findMany({
    where: {
      learningOutcomeRef: { not: null },
      learningObjectiveId: null,
    },
    select: {
      id: true,
      learningOutcomeRef: true,
      source: {
        select: {
          subjects: {
            select: { subjectId: true },
          },
        },
      },
    },
  });

  for (const assertion of assertions) {
    if (!assertion.learningOutcomeRef) continue;
    const ref = assertion.learningOutcomeRef.toUpperCase();

    // Try to match via any subject this source belongs to
    for (const ss of assertion.source.subjects) {
      const key = `${ss.subjectId}:${ref}`;
      const loId = loMap.get(key);
      if (loId) {
        await prisma.contentAssertion.update({
          where: { id: assertion.id },
          data: { learningObjectiveId: loId },
        });
        linked++;
        break;
      }
    }
  }

  return linked;
}

// ---------------------------------------------------------------------------
// Phase 4: Backfill CallerModuleProgress from CallerAttribute mastery keys
// ---------------------------------------------------------------------------

async function backfillProgress(): Promise<number> {
  let count = 0;

  // Find CallerAttribute records matching curriculum:*:mastery:* pattern
  const attrs = await prisma.callerAttribute.findMany({
    where: {
      scope: "CURRICULUM",
      key: { contains: "mastery" },
      numberValue: { not: null },
    },
    select: {
      callerId: true,
      key: true,
      numberValue: true,
      updatedAt: true,
    },
  });

  // Extract specSlug + moduleId from key pattern:
  //   curriculum:{specSlug}:mastery:{moduleId}
  //   curriculum:{specSlug}:mastery_{moduleId}  (legacy)
  // Capturing specSlug too lets us scope the module lookup by curriculumId
  // — slugs like "MOD-1"/"part1" are not globally unique (#407).
  const MASTERY_PATTERN = /^curriculum:([\w-]+):mastery[_:]([\w-]+)$/i;

  for (const attr of attrs) {
    const match = attr.key.match(MASTERY_PATTERN);
    if (!match || attr.numberValue === null) continue;

    const specSlug = match[1];
    const moduleSlug = match[2];
    const mastery = attr.numberValue;

    // Curriculum.slug is globally unique by schema — scoping the module
    // lookup by curriculumId prevents picking a module from a different
    // curriculum that happens to share the slug.
    const curriculum = await prisma.curriculum.findFirst({
      where: { slug: specSlug },
      select: { id: true },
    });
    if (!curriculum) {
      console.warn(`  [skip] progress: no curriculum for slug "${specSlug}" (caller ${attr.callerId})`);
      continue;
    }

    const mod = await prisma.curriculumModule.findFirst({
      where: { curriculumId: curriculum.id, slug: moduleSlug },
    });
    if (!mod) {
      console.warn(`  [skip] progress: no module "${moduleSlug}" in curriculum "${specSlug}" (caller ${attr.callerId})`);
      continue;
    }

    try {
      await prisma.callerModuleProgress.upsert({
        where: {
          callerId_moduleId: { callerId: attr.callerId, moduleId: mod.id },
        },
        create: {
          callerId: attr.callerId,
          moduleId: mod.id,
          mastery,
          status: mastery >= 1.0 ? "COMPLETED" : mastery > 0 ? "IN_PROGRESS" : "NOT_STARTED",
          startedAt: mastery > 0 ? attr.updatedAt : null,
          completedAt: mastery >= 1.0 ? attr.updatedAt : null,
        },
        update: {
          mastery,
          status: mastery >= 1.0 ? "COMPLETED" : mastery > 0 ? "IN_PROGRESS" : "NOT_STARTED",
        },
      });
      count++;
    } catch (e: any) {
      console.warn(`  [err] progress upsert failed for caller ${attr.callerId}, module ${moduleSlug}: ${e.message}`);
    }
  }

  return count;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Backfill CurriculumModule + LearningObjective ===\n");

  console.log("Phase 1: Backfill from Curriculum.notableInfo.modules...");
  const curricResult = await backfillFromCurricula();
  console.log(`  → ${curricResult.modules} modules, ${curricResult.los} LOs\n`);

  console.log("Phase 2: Backfill from AnalysisSpec.config.modules...");
  const specResult = await backfillFromSpecs();
  console.log(`  → ${specResult.modules} modules, ${specResult.los} LOs\n`);

  console.log("Phase 3: Link ContentAssertion → LearningObjective...");
  const linked = await linkAssertions();
  console.log(`  → ${linked} assertions linked\n`);

  console.log("Phase 4: Backfill CallerModuleProgress from CallerAttribute...");
  const progress = await backfillProgress();
  console.log(`  → ${progress} progress records\n`);

  const totalModules = curricResult.modules + specResult.modules;
  const totalLOs = curricResult.los + specResult.los;
  console.log("=== Summary ===");
  console.log(`  Modules:    ${totalModules}`);
  console.log(`  LOs:        ${totalLOs}`);
  console.log(`  Linked:     ${linked} assertions`);
  console.log(`  Progress:   ${progress} records`);
  console.log("\nDone.");
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
