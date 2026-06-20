/**
 * IELTS Course Seed — IELTS Speaking Practice
 *
 * Creates an IELTS Speaking Practice course on the Abacus Academy domain
 * (created by seed-golden.ts), driven by the canonical course-reference
 * markdown at `docs/external/ielts/ielts-speaking/Upload Docs/course-ref.md`
 * — the SAME doc an operator would upload through the wizard. This is what
 * makes "seed parity with wizard" achievable: both paths read the same
 * bytes. PR #2125 PR1 moved the seed off the truncated 227-line fixture
 * at `tests/fixtures/course-reference-ielts-v2.2.md` so the demo set
 * matches production output. The old fixture is kept on disk for now
 * (referenced by `tests/lib/seed-ielts-fixture.test.ts` history); cleanup
 * is a follow-on concern.
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
import { findOrCreateSeedPlaybook } from "../lib/seed/find-or-create-seed-playbook";

const DOMAIN_SLUG = "abacus-academy";
const SUBJECT_SLUG = "ielts-speaking";
const PLAYBOOK_NAME = "IELTS Speaking Practice";
const PLAYBOOK_SEED_TAG = "ielts-seed-v1";
const CONTENT_SOURCE_SLUG = "ielts-speaking-course-ref";

const FIXTURE_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "docs",
  "external",
  "ielts",
  "ielts-speaking",
  "Upload Docs",
  "course-ref.md",
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

  // ── 3. Playbook — tag-first idempotent lookup ──
  //
  // Resolution: (1) cross-domain `config.seedSourceTag`, (2) legacy
  // `(domainId, name)`, (3) create. Step 2 attaches the tag so the
  // next run hits step 1 — wizard-created playbooks with the same
  // name converge with the seed without being silently duplicated
  // when they happen to live on a different domain. (2026-05-19
  // testing: wizard had created `IELTS Speaking Practice` on
  // `ielts-prep-lab` while the seed targeted `abacus-academy`;
  // re-seeding created a duplicate.)
  const playbook = await findOrCreateSeedPlaybook(prisma, {
    seedSourceTag: PLAYBOOK_SEED_TAG,
    domainId: domain.id,
    name: PLAYBOOK_NAME,
    createData: {
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

  // ── 4b. Post-projection coversModules upsert for the Mock module (#550) ──
  // The fixture parser (`detectAuthoredModules`) does not yet handle a
  // `coversModules` column in the module table. The IELTS Mock module
  // walks a learner through Part 1, Part 2, Part 3 in one call — the
  // EXTRACT transcript segmenter needs `coversModules` populated to
  // attribute per-part `CallScore` rows. Set it here as an idempotent
  // post-projection step, scoped to this seed's curriculum to avoid
  // touching any other playbook's `mock` slug (#407 slug-scope discipline).
  // #1177 Slice 6 — canonical PlaybookCurriculum primary join.
  const ieltsCurriculum = await prisma.curriculum.findFirst({
    where: { playbookLinks: { some: { playbookId: playbook.id, role: "primary" } } },
    select: { id: true },
  });
  if (ieltsCurriculum) {
    const mockSet = await prisma.curriculumModule.updateMany({
      where: { curriculumId: ieltsCurriculum.id, slug: "mock" },
      data: { coversModules: ["part1", "part2", "part3"] },
    });
    if (mockSet.count > 0) {
      console.log(`  Mock module coversModules → [part1, part2, part3] (${mockSet.count} row)`);
    }

    // #1785 — Per-sub-module segmentation cues for `segmentMockTranscript`.
    // Mirror the legacy IELTS-hardcoded `HEURISTIC_PATTERNS` so behaviour
    // matches pre-refactor exactly. Each cue string is a regex SOURCE
    // (alternation / `\s+` / `\b`); the segmenter compiles with the `i`
    // flag. Patterns deliberately omit a trailing `\b` because some cue
    // phrases end in punctuation (`say:`, `card:`) — see
    // `lib/curriculum/segment-mock-transcript.ts` header.
    const IELTS_SEGMENT_CUES: Record<string, string[]> = {
      part1: [
        "\\b(let'?s\\s+(?:start|begin)\\s+with\\s+part\\s*1|part\\s*1\\s*\\.\\s*[A-Z]|now\\s+(?:in|for)\\s+part\\s*1|i'?ll?\\s+ask\\s+you\\s+some\\s+(?:general|familiar)\\s+questions)",
      ],
      part2: [
        "\\b(now\\s+(?:let'?s\\s+)?(?:move\\s+(?:on\\s+)?to|move\\s+into|turn\\s+to|go\\s+to)\\s+part\\s*2|let'?s\\s+(?:start|begin)\\s+part\\s*2|here'?s?\\s+your\\s+(?:cue\\s+card|topic\\s+card)|i'?ll?\\s+(?:now\\s+)?(?:give|hand)\\s+you\\s+(?:a|your)\\s+(?:cue|topic)\\s+card|you'?ll?\\s+have\\s+(?:one\\s+minute|1\\s+minute)\\s+to\\s+prepare|describe\\s+a\\s+[a-z]+\\s+(?:you|that)|you\\s+should\\s+say)",
      ],
      part3: [
        "\\b(now\\s+(?:let'?s\\s+)?(?:move\\s+(?:on\\s+)?to|move\\s+into|turn\\s+to|go\\s+to)\\s+part\\s*3|let'?s\\s+(?:start|begin)\\s+part\\s*3|i'?d?\\s+like\\s+to\\s+(?:discuss|talk\\s+about)\\s+(?:some\\s+)?(?:more\\s+)?(?:general|abstract|broader)|let'?s\\s+(?:now\\s+)?(?:discuss|talk\\s+about)\\s+(?:this|the\\s+topic)\\s+more\\s+(?:broadly|generally|abstractly)|now\\s+we'?ll?\\s+discuss|now\\s+(?:i'?d?\\s+like\\s+to\\s+)?(?:explore|consider)\\s+(?:some\\s+)?broader)",
      ],
    };
    for (const [slug, cues] of Object.entries(IELTS_SEGMENT_CUES)) {
      const cuesSet = await prisma.curriculumModule.updateMany({
        where: { curriculumId: ieltsCurriculum.id, slug },
        data: { segmentCues: cues },
      });
      if (cuesSet.count > 0) {
        console.log(`  ${slug} segmentCues populated (${cuesSet.count} row)`);
      }
    }
  }

  // ── 5. CONTENT-role spec for trust-weighted certification progress (#457) ──
  // `computeTrustWeightedProgress` reads module trust levels off a CONTENT
  // spec's `config.modules[].sourceRefs[].trustLevel`. The trust-progress
  // route (`app/api/callers/[callerId]/trust-progress/route.ts`) matches the
  // CONTENT spec to the caller's curriculum BY SHARED SLUG — so this spec
  // MUST use the same slug the Curriculum row uses. Without that match,
  // `getActiveCurricula(callerId)` returns the curriculum slug but
  // `analysisSpec.findFirst({slug: ...})` returns null → 0/0 modules.
  // The 4 IELTS Speaking modules are official Cambridge IELTS rubric content
  // → `PUBLISHED_REFERENCE` (weight 1.0, above the 0.80 L3+ cert threshold).
  const playbookForModules = await prisma.playbook.findUnique({
    where: { id: playbook.id },
    select: {
      config: true,
      // #1205 — canonical PlaybookCurriculum primary join.
      playbookCurricula: {
        where: { role: "primary" },
        take: 1,
        select: { curriculum: { select: { slug: true } } },
      },
    },
  });
  const authoredModules = Array.isArray(
    (playbookForModules?.config as Record<string, any>)?.modules,
  )
    ? ((playbookForModules!.config as Record<string, any>).modules as Array<{ id: string }>)
    : [];
  const contentSpecSlug = playbookForModules?.playbookCurricula[0]?.curriculum.slug;
  if (authoredModules.length > 0 && contentSpecSlug) {
    const contentSpec = await prisma.analysisSpec.upsert({
      where: { slug: contentSpecSlug },
      update: {
        config: {
          modules: authoredModules.map((m) => ({
            id: m.id,
            sourceRefs: [{ trustLevel: "PUBLISHED_REFERENCE" }],
          })),
        },
        isDirty: false,
        compiledAt: new Date(),
        isActive: true,
      },
      create: {
        slug: contentSpecSlug,
        name: "IELTS Speaking Practice — Content",
        description:
          "CONTENT-role spec listing curriculum modules and their source trust levels for L3+ certification progress (#457).",
        scope: "DOMAIN",
        specType: "DOMAIN",
        specRole: "CONTENT",
        outputType: "MEASURE",
        domain: "ielts-speaking",
        isActive: true,
        isDirty: false,
        compiledAt: new Date(),
        config: {
          modules: authoredModules.map((m) => ({
            id: m.id,
            sourceRefs: [{ trustLevel: "PUBLISHED_REFERENCE" }],
          })),
        },
      },
      select: { id: true, slug: true },
    });
    // PlaybookItem has no (playbookId, specId) unique constraint, so we
    // pre-check before creating. Idempotent on re-seed.
    const existingLink = await prisma.playbookItem.findFirst({
      where: { playbookId: playbook.id, specId: contentSpec.id },
      select: { id: true },
    });
    if (existingLink) {
      await prisma.playbookItem.update({
        where: { id: existingLink.id },
        data: { isEnabled: true },
      });
    } else {
      await prisma.playbookItem.create({
        data: {
          playbookId: playbook.id,
          specId: contentSpec.id,
          itemType: "SPEC",
          isEnabled: true,
        },
      });
    }
    console.log(
      `  Content spec: ${contentSpec.slug} (${authoredModules.length} modules @ PUBLISHED_REFERENCE)`,
    );
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
