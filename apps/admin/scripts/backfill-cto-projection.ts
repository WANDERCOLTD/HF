/**
 * Backfill CTO/CIO Skills Framework projection.
 *
 * Confirmed live on hf_sandbox 2026-06-13:
 *   - Global skill_* Parameter rows: 21 (includes all 10 CTO ones)
 *   - BehaviorTargets for SKILL-* on CTO Revision Aid: 0
 *   - Cyrus (Cyrus Horváth) CallerTarget rows for skill_*: 0
 *   - Cyrus BehaviorMeasurement rows for skill_*: 0
 *
 * Root cause: the CTO playbooks were seeded by `scripts/fix-cio-cto-playbooks.ts`
 * which bypassed `runProjectionForPlaybook()`. The Skills Framework projection
 * (Parameter + BehaviorTarget + MEASURE spec + PlaybookItem) never fired.
 *
 * This script:
 *   1. Locates the three CIO/CTO playbooks by name match
 *   2. Reads the local course-ref markdown from
 *      `docs/courses/cio-cto-standard/*.course-ref.md`
 *   3. Calls `projectCourseReference(text)` (pure)
 *   4. Calls `applyProjection(projection, { playbookId, sourceContentId })`
 *      where `sourceContentId` is the existing COURSE_REFERENCE_CANONICAL
 *      PlaybookSource (creates one if missing, deduping by name).
 *
 * Idempotent — re-running produces zero net DB mutations beyond updatedAt
 * bumps. `applyProjection` dedupes by `sourceContentId` + ref.
 *
 * Run:  npx tsx scripts/backfill-cto-projection.ts [--dry-run]
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { projectCourseReference } from "@/lib/wizard/project-course-reference";
import { applyProjection } from "@/lib/wizard/apply-projection";

interface Mapping {
  /** Playbook.name substring match. */
  playbookNameMatch: string;
  /** Path relative to repo root. */
  courseRefPath: string;
}

const MAPPINGS: Mapping[] = [
  {
    playbookNameMatch: "Revision Aid",
    courseRefPath: "docs/courses/cio-cto-standard/cio-cto-standard-revision-aid.course-ref.md",
  },
  {
    playbookNameMatch: "Pop Quiz",
    courseRefPath: "docs/courses/cio-cto-standard/cio-cto-standard-pop-quiz.course-ref.md",
  },
  {
    playbookNameMatch: "Exam Assessment",
    courseRefPath: "docs/courses/cio-cto-standard/cio-cto-standard-exam-assessment.course-ref.md",
  },
];

const REPO_ROOT = path.resolve(__dirname, "../../..");

async function findPlaybook(nameMatch: string): Promise<{ id: string; name: string } | null> {
  const row = await prisma.playbook.findFirst({
    where: { name: { contains: nameMatch } },
    select: { id: true, name: true },
  });
  return row;
}

async function ensureCourseReferenceSource(
  playbookId: string,
  playbookName: string,
): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.playbookSource.findFirst({
    where: {
      playbookId,
      source: {
        documentType: { in: ["COURSE_REFERENCE_CANONICAL", "COURSE_REFERENCE"] },
      },
    },
    select: { source: { select: { id: true, name: true, documentType: true } } },
  });
  if (existing) {
    console.log(
      `  found existing source ${existing.source.id.slice(0, 8)} (${existing.source.documentType}) — ${existing.source.name}`,
    );
    return { id: existing.source.id, created: false };
  }

  const slug = `cto-backfill-${playbookId.slice(0, 8)}-${Date.now()}`;
  const source = await prisma.contentSource.create({
    data: {
      slug,
      name: `${playbookName} — Course Reference (backfill 2026-06-13)`,
      documentType: "COURSE_REFERENCE_CANONICAL",
      trustLevel: "PUBLISHED_REFERENCE",
    },
    select: { id: true },
  });
  await prisma.playbookSource.create({
    data: { playbookId, sourceId: source.id },
  });
  console.log(`  created new ContentSource ${source.id.slice(0, 8)} + PlaybookSource link`);
  return { id: source.id, created: true };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`Backfill CTO projection ${dryRun ? "(DRY RUN)" : ""}`);
  console.log(`Repo root: ${REPO_ROOT}`);

  for (const mapping of MAPPINGS) {
    console.log(`\n=== ${mapping.playbookNameMatch} ===`);

    const playbook = await findPlaybook(mapping.playbookNameMatch);
    if (!playbook) {
      console.log(`  no playbook found matching "${mapping.playbookNameMatch}" — skip`);
      continue;
    }
    console.log(`  playbook=${playbook.id.slice(0, 8)} "${playbook.name}"`);

    const courseRefFullPath = path.join(REPO_ROOT, mapping.courseRefPath);
    let text: string;
    try {
      text = await fs.readFile(courseRefFullPath, "utf-8");
    } catch (err: any) {
      console.log(`  failed to read ${mapping.courseRefPath}: ${err.message} — skip`);
      continue;
    }
    console.log(`  loaded course-ref: ${text.length} bytes`);

    if (dryRun) {
      const projection = projectCourseReference(text, { sourceContentId: "DRY-RUN-FAKE" });
      console.log(
        `  [dry] projection: params=${projection.parameters.length}, ` +
          `behaviorTargets=${projection.behaviorTargets.length}, ` +
          `curriculumModules=${projection.curriculumModules.length}, ` +
          `goalTemplates=${projection.configPatch.goalTemplates.length}, ` +
          `measureSpec=${projection.measureSpec ? "yes" : "no"}`,
      );
      continue;
    }

    const { id: sourceContentId } = await ensureCourseReferenceSource(playbook.id, playbook.name);
    const projection = projectCourseReference(text, { sourceContentId });
    const result = await applyProjection(projection, {
      playbookId: playbook.id,
      sourceContentId,
    });
    console.log(
      `  applied: params=+${result.parametersUpserted} ` +
        `bt=+${result.behaviorTargetsCreated}/~${result.behaviorTargetsUpdated}/-${result.behaviorTargetsRemoved} ` +
        `cm=+${result.curriculumModulesCreated}/~${result.curriculumModulesUpdated}/-${result.curriculumModulesRemoved} ` +
        `lo=+${result.learningObjectivesCreated}/~${result.learningObjectivesUpdated}/-${result.learningObjectivesRemoved} ` +
        `goals=${result.goalTemplatesWritten} noop=${result.noop}`,
    );
  }

  console.log("\nDone.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
