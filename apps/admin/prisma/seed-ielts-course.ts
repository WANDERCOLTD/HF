/**
 * IELTS Course Seed — IELTS Speaking Practice
 *
 * Creates an IELTS Speaking Practice course on the Abacus Academy domain
 * (created by seed-golden.ts), driven by the canonical course-reference
 * markdown at `tests/fixtures/course-reference-ielts-v2.2.md`.
 *
 * Unlike `seed-demo-course.ts` — which hand-rolls every row — this seed
 * uses the live projection pipeline: read the markdown, call
 * `projectCourseReference()` (pure parser, no AI) + `applyProjection()`
 * (pure DB writes inside a transaction). Same code path the wizard runs
 * for an educator-uploaded course reference.
 *
 * What lands in the DB:
 *   - Subject "IELTS Speaking" + SubjectDomain link
 *   - ContentSource (COURSE_REFERENCE) + SubjectSource + PlaybookSource links
 *   - Playbook "IELTS Speaking Practice" (status: PUBLISHED)
 *   - 4 Parameters (`skill_fluency_and_coherence`, `skill_lexical_resource`,
 *     `skill_grammatical_range_and_accuracy`, `skill_pronunciation`)
 *   - 4 PLAYBOOK-scope BehaviorTargets (skillRef SKILL-01..SKILL-04,
 *     targetValue 1.0)
 *   - 1 per-playbook MEASURE spec (`skill-measure-<playbookId-prefix>`)
 *     with 4 triggers
 *   - Curriculum + 4 CurriculumModules (`baseline`, `part1`, `part2`,
 *     `part3`) + LearningObjective rows derived from the modules'
 *     `outcomesPrimary` × the doc's outcome statements
 *   - `Playbook.config.goals[]` — 4 ACHIEVE goal templates (one per skill)
 *     + 8 LEARN goal templates (one per OUT-NN outcome)
 *
 * When an educator enrols a caller, `instantiatePlaybookGoals` produces
 * 12 Goal rows and `instantiatePlaybookTargets` (Story C) produces 4
 * CallerTarget placeholders.
 *
 * Idempotent: re-running this seed is a near no-op. The Playbook +
 * Subject + ContentSource are upserts; `applyProjection` is itself
 * diff-based and skips identical rows.
 *
 * Depends on: seed-golden (creates Abacus Academy institution + domain)
 * Profiles: demo + full
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

import { projectCourseReference } from "../lib/wizard/project-course-reference";
import { applyProjection } from "../lib/wizard/apply-projection";

const DOMAIN_SLUG = "abacus-academy";
const SUBJECT_SLUG = "ielts-speaking";
const PLAYBOOK_NAME = "IELTS Speaking Practice";
const CONTENT_SOURCE_SLUG = "ielts-speaking-course-ref";

const FIXTURE_PATH = path.join(
  __dirname,
  "..",
  "tests",
  "fixtures",
  "course-reference-ielts-v2.2.md",
);

export async function main(prisma: PrismaClient): Promise<void> {
  console.log("\n→ Seeding IELTS Speaking Practice course");

  const domain = await prisma.domain.findUnique({ where: { slug: DOMAIN_SLUG } });
  if (!domain) {
    console.error(`  ⚠ Domain "${DOMAIN_SLUG}" not found — run seed-golden first`);
    return;
  }

  // ── 1. Subject ──
  const subject = await prisma.subject.upsert({
    where: { slug: SUBJECT_SLUG },
    update: {},
    create: {
      slug: SUBJECT_SLUG,
      name: "IELTS Speaking",
      description: "Adult IELTS Speaking test preparation — Bands 6.0–7.5.",
      defaultTrustLevel: "EXPERT_CURATED",
      isActive: true,
      teachingProfile: "skill-led",
    },
  });

  await prisma.subjectDomain.upsert({
    where: { subjectId_domainId: { subjectId: subject.id, domainId: domain.id } },
    update: {},
    create: { subjectId: subject.id, domainId: domain.id },
  });

  // ── 2. ContentSource (COURSE_REFERENCE) ──
  let source = await prisma.contentSource.findFirst({ where: { slug: CONTENT_SOURCE_SLUG } });
  if (!source) {
    source = await prisma.contentSource.create({
      data: {
        slug: CONTENT_SOURCE_SLUG,
        name: "IELTS Speaking Practice — Course Reference",
        description: "Canonical course reference driving the IELTS playbook seed. Defines 4 IELTS skills, 8 outcomes, and 4 modules.",
        documentType: "COURSE_REFERENCE",
      },
    });
  }

  await prisma.subjectSource.upsert({
    where: { subjectId_sourceId: { subjectId: subject.id, sourceId: source.id } },
    update: {},
    create: { subjectId: subject.id, sourceId: source.id },
  });

  // ── 3. Playbook ──
  let playbook = await prisma.playbook.findFirst({
    where: { domainId: domain.id, name: PLAYBOOK_NAME },
  });

  if (!playbook) {
    playbook = await prisma.playbook.create({
      data: {
        name: PLAYBOOK_NAME,
        description: "IELTS Speaking test preparation for adult learners targeting Band 6.0–7.5. Four modules (Baseline, Part 1, Part 2, Part 3) measuring four IELTS criteria (Fluency & Coherence, Lexical Resource, Grammatical Range & Accuracy, Pronunciation).",
        domainId: domain.id,
        status: "PUBLISHED",
        version: "1.0",
        publishedAt: new Date(),
        validationPassed: true,
        measureSpecCount: 0,
        learnSpecCount: 0,
        adaptSpecCount: 0,
        parameterCount: 0,
        config: {
          interactionPattern: "tutor",
          teachingMode: "directive",
          subjectDiscipline: "IELTS Speaking",
          audience: "Adult learners with B1+ general English preparing for IELTS",
          sessionCount: 12,
          durationMins: 20,
          planEmphasis: "exam preparation — spoken performance with correction",
          welcome: {
            goals: { enabled: true },
            aboutYou: { enabled: true },
            knowledgeCheck: { enabled: false },
            aiIntroCall: { enabled: false },
          },
          // No nps / surveys configured here — projection's goalTemplates carry
          // the learning + skill goals; the wizard adds engagement goals later.
        },
      },
    });
  }

  await prisma.playbookSubject.upsert({
    where: { playbookId_subjectId: { playbookId: playbook.id, subjectId: subject.id } },
    update: {},
    create: { playbookId: playbook.id, subjectId: subject.id },
  });

  await prisma.playbookSource.upsert({
    where: { playbookId_sourceId: { playbookId: playbook.id, sourceId: source.id } },
    update: {},
    create: { playbookId: playbook.id, sourceId: source.id, tags: ["course-reference"] },
  });

  console.log(`  Playbook: ${playbook.name} (${playbook.id.slice(0, 8)}…)`);

  // ── 4. Run projection — pure parser + diff-based applier ──
  // We bypass run-projection-for-playbook.ts (which expects a MediaAsset +
  // storage adapter download) because the fixture is on local disk and we
  // can read it directly. The parser + applier are pure DB operations with
  // no AI dependency.
  const bodyText = fs.readFileSync(FIXTURE_PATH, "utf-8");
  const projection = projectCourseReference(bodyText, { sourceContentId: source.id });
  const result = await applyProjection(projection, {
    playbookId: playbook.id,
    sourceContentId: source.id,
  });

  console.log(
    `  Projection: params=+${result.parametersUpserted} ` +
      `bt=+${result.behaviorTargetsCreated}/~${result.behaviorTargetsUpdated}/-${result.behaviorTargetsRemoved} ` +
      `cm=+${result.curriculumModulesCreated}/~${result.curriculumModulesUpdated}/-${result.curriculumModulesRemoved} ` +
      `lo=+${result.learningObjectivesCreated}/~${result.learningObjectivesUpdated}/-${result.learningObjectivesRemoved} ` +
      `goals=${result.goalTemplatesWritten} ` +
      `measure-spec=${result.measureSpecId ? "yes" : "no"} ` +
      `noop=${result.noop}`,
  );

  if (result.warnings.length > 0) {
    for (const w of result.warnings) {
      console.warn(`  ⚠ ${w.severity}: [${w.code}] ${w.message}`);
    }
  }

  console.log("✓ IELTS Speaking Practice seeded");
}

// CLI entry-point — `tsx prisma/seed-ielts-course.ts`
if (require.main === module) {
  const prisma = new PrismaClient();
  main(prisma)
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
