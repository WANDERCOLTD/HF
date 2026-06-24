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

import * as crypto from "crypto";

import { projectCourseReference } from "../lib/wizard/project-course-reference";
import { applyProjection } from "../lib/wizard/apply-projection";
// #2266 follow-on — same source-ref resolver the wizard route uses, so
// SEED + WIZARD paths produce identical module-settings inline content.
// Prior to this, the seed's `applyProjection` left `cueCardPool` /
// `topicPool` etc. as `source:<slug>` STRING refs in the playbook config
// — only the wizard route inlined them. Hoisting the resolver into the
// seed closes the convergence gap.
import { resolveModuleSourceRefs } from "../lib/wizard/resolve-module-source-refs";
import type { AuthoredModuleSettings } from "../lib/types/json-fields";
import { findOrCreateSeedPlaybook } from "../lib/seed/find-or-create-seed-playbook";
import { saveAssertions } from "../lib/content-trust/save-assertions";
import type { ExtractedAssertion } from "../lib/content-trust/extract-assertions";
import { categoryToTeachMethod } from "../lib/content-trust/resolve-config";

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

  const subjectSource = await prisma.subjectSource.upsert({
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
        // "directive" is not in VALID_TEACHING_MODES — the read-side guard
        // at preamble.ts:189-190 silently maps invalid values to the
        // recall-mode preamble, so the LLM heard recall rules on every
        // first call. "practice" is the correct mode for IELTS exam-prep
        // (WHAT to emphasise = practice, with the directive POSTURE
        // carried by the project's pedagogy assertions, not this enum).
        teachingMode: "practice",
        // First call is a diagnostic baseline — pairs with
        // assessmentPlan.upfront.kind === "upfront-baseline" below
        // (chain-contract per json-fields.ts:1879).
        firstCallMode: "baseline_assessment",
        subjectDiscipline: "IELTS Speaking",
        audience: "Adult learners with B1+ general English preparing for IELTS",
        sessionCount: 12,
        durationMins: 20,
        planEmphasis: "exam preparation — spoken performance with correction",
        // FOH onboarding greeting + closing CTA — surfaced via the
        // welcomeMessage cascade and the onboardingClosingLine course-only
        // knob (see hooks/useJourneyChat.ts::loadOnboardingPhase). Operator-
        // tunable via the Course Pane Inspector.
        welcomeMessage: "Welcome to your I E L T S coaching session",
        onboardingClosingLine: "Click start when you are ready",
        // PR #2266 S1 — 8 more FOH copy knobs lifted from useJourneyChat
        // + WelcomeSurveyFlow. Each falls back to canonical defaults in
        // lib/learner/onboarding-copy-defaults.ts when left blank; IELTS
        // seeds reasonable course-specific copy.
        goalsPreamble: "Here's what we'll work on together:",
        aboutYouIntro:
          "Hello! I'm your I E L T S study partner. {teacherName} Before we dive in, I'd love to learn a bit about you.",
        preTestIntro:
          "Now let's do a quick knowledge check on I E L T S Speaking — just {questionCount} questions. Don't worry about getting them right; this just helps me calibrate to where you're starting from.",
        preTestClosing:
          "Brilliant! I've got what I need. Let's begin your first I E L T S Speaking practice — you'll do great.",
        postTestIntro:
          "One last thing — let's see how much your I E L T S Speaking confidence has grown. {questionCount} questions, same skills we've been working on.",
        postTestClosing: "Brilliant! Let's wrap up with some quick feedback.",
        journeyExitIntro:
          "You've finished your I E L T S Speaking sessions — amazing work! Before you go, I'd love to hear how it went.",
        journeyExitClosing:
          "Thanks so much for your feedback! You've been brilliant. Good luck with your I E L T S Speaking test!",
        // PR #2266 S2 — HTML onboarding wizard copy (StudentOnboarding.tsx).
        studentOnboardingStep1Body:
          "You're about to start your personalised I E L T S Speaking practice journey. Let's get you set up in just a few steps.",
        studentOnboardingGoalsHintWithItems:
          "These I E L T S Speaking targets have been set for your journey. You can confirm or adjust them.",
        studentOnboardingGoalsHintEmpty:
          "What would you most like to work on for I E L T S Speaking? Add a goal below.",
        studentOnboardingHowItWorksIntro:
          "You'll have voice conversations with an I E L T S study partner that adapts to you.",
        studentOnboardingReadyBody:
          "Start your first I E L T S Speaking practice and your study partner will take it from there.",
        studentOnboardingReadyCta: "Start Your First Practice Session",
        // IELTS Speaking Practice is a structured course with 5 authored
        // modules (Baseline, Part 1, Part 2, Part 3, Mock Exam). The
        // pipeline reads `lessonPlanMode === "structured"` to keep
        // `CallerModuleProgress` writes active and the admin Modules
        // tab populated. Without this stamp the admin UI's default-deny
        // (`lessonPlanMode === undefined` → "continuous") hides the
        // 5 authored modules from operators. Detector at
        // `lib/wizard/detect-pedagogy.ts` only emits "continuous" or
        // null — never "structured" — so this stamp must live in the
        // seed payload (and in the wizard authoring inference; see
        // `lib/chat/wizard-tool-executor/tools/create_course/_*-config-merge.ts`).
        lessonPlanMode: "structured",
        welcome: {
          goals: { enabled: true },
          aboutYou: { enabled: true },
          knowledgeCheck: { enabled: false },
          aiIntroCall: { enabled: false },
        },
        // No nps / surveys configured here — projection's goalTemplates carry
        // the learning + skill goals; the wizard adds engagement goals later.
        //
        // ── B4-impl of epic #2225 — approved cascade values (op approval:
        //    https://github.com/WANDERCOLTD/HF/issues/2225#issuecomment-4763486228).
        //    Storage paths verified via lib/settings/voice-setting-contracts.ts
        //    (maxCallDuration → playbook.voiceConfig.maxDurationSeconds) +
        //    lib/cascade/resolvers/mastery-policy.ts (tierPresetId +
        //    skillScoringEmaHalfLifeDays both in CASCADABLE_KEYS).
        voiceConfig: {
          maxDurationSeconds: 1800,
        },
        tierPresetId: "ielts-speaking",
        skillScoringEmaHalfLifeDays: 14,
        // ── CourseAssessmentPlan (epic #2176 / PR #2254 S1) ──
        // BDD-shaped: upfront baseline + end mock. Speaking is examiner-
        // mode, conversational — contentKind:"topic-prompt" (not mcq).
        // Stratification.perCriterion=1 ensures one task per IELTS
        // criterion (FC / LR / GRA / Pron) per moment.
        // shellKind:"exam" mounts ExamModeShell (board-chair frame).
        // Per Part modules (Part 1 / 2 / 3) are practice sessions,
        // not formal moments — no midpoints declared.
        assessmentPlan: {
          upfront: {
            kind: "upfront-baseline",
            moduleSlug: "baseline",
            samplingPolicy: {
              scope: "cross-curriculum",
              count: { min: 4, target: 4, max: 4 },
              contentKind: "topic-prompt",
              stratification: { perCriterion: 1 },
            },
            shellKind: "exam",
            scoringSpec: "spec-ielts-measure-001",
          },
          end: {
            kind: "end-mock",
            moduleSlug: "mock",
            samplingPolicy: {
              scope: "cross-curriculum",
              count: { min: 4, target: 4, max: 4 },
              contentKind: "topic-prompt",
              stratification: { perCriterion: 1 },
            },
            shellKind: "exam",
            scoringSpec: "spec-ielts-measure-001",
          },
        },
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

  // ── 4a. Resolve `source:<id>` refs into inlined arrays (#2266 follow-on) ──
  //
  // The wizard route at `lib/wizard/run-projection-for-playbook.ts:203-226`
  // does this same step — it hoists the resolver call between projection
  // and applyProjection so the playbook config's module settings carry
  // the FULL inlined content (parsed cue cards, topic pools, scaffolds,
  // profile fields) rather than just the `source:<slug>` ref string.
  //
  // Without this step the seed leaves the source-ref strings in place
  // and the AI tutor has no structured content to draw from at runtime.
  // Hoisting the resolver here makes SEED + WIZARD paths produce the
  // SAME module settings shape — convergence per "ALL paths work".
  if (projection.configPatch?.modules && projection.configPatch.modules.length > 0) {
    const byModuleId = new Map<string, Partial<AuthoredModuleSettings>>();
    for (const m of projection.configPatch.modules) {
      if (m.settings) byModuleId.set(m.id, { ...m.settings });
      else byModuleId.set(m.id, {});
    }
    const repoRoot = path.resolve(__dirname, "..", "..", "..");
    const resolution = resolveModuleSourceRefs(byModuleId, bodyText, { repoRoot });
    projection.configPatch.modules = projection.configPatch.modules.map((m) => {
      const resolved = resolution.byModuleId.get(m.id);
      if (!resolved || Object.keys(resolved).length === 0) return m;
      return { ...m, settings: { ...(m.settings ?? {}), ...resolved } };
    });
    for (const w of resolution.validationWarnings) {
      projection.validationWarnings.push(w);
    }
    const resolvedCount = resolution.resolutions.filter((r) => r.status === "resolved").length;
    const skippedCount = resolution.resolutions.filter((r) => r.status === "skipped").length;
    if (resolvedCount > 0 || skippedCount > 0) {
      console.log(
        `  Source-ref resolution: ${resolvedCount} inlined, ${skippedCount} skipped`,
      );
    }
  }

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

  // ── 4a. Derived ContentAssertion rows (#2125 PR2) ──
  // Without these the Content tab on /x/courses/<id> shows "No categories
  // yet" + the Course Map / Teaching Points panels are empty. Derive a
  // small set of assertions from the projection output we already have in
  // memory — skills (skill_framework), modules (session_flow), and the
  // course's directive teaching approach (teaching_rule). This is
  // intentionally narrower than wizard AI extraction would produce on
  // the same doc — the operator can upgrade with richer assertions via a
  // CourseRefData fixture or AI re-extract once this is in place.
  //
  // Writes route through `saveAssertions(sourceId, assertions,
  // subjectSourceId)` — the canonical chokepoint. This (a) honours the
  // ai-to-db-guard `maxAssertionsPerDocument` cap, (b) dedups by
  // contentHash so re-seed is idempotent, and (c) passes subjectSourceId
  // to close the ENTITIES.md §6 I1 invariant (without it, assertions
  // leak cross-course in SectionDataLoader's curriculumAssertions filter).
  const derivedAssertions: ExtractedAssertion[] = [];

  // All three categories below are INSTRUCTION_CATEGORIES → categoryToTeachMethod
  // returns "tutor_instruction" (short-circuited per #605 so tutor-facing
  // directives never inherit a learner-facing method). Stamped here so the
  // per-subject methods breakdown shows them grouped correctly instead of
  // bucketing under "unassigned".
  for (const skill of projection.skills) {
    const tierText =
      skill.tiers?.secure || skill.tiers?.developing || skill.tiers?.emerging || skill.name;
    const text = `${skill.name} (${skill.ref}). Secure tier: ${tierText}`;
    derivedAssertions.push({
      assertion: text,
      category: "skill_framework",
      chapter: "Skills Framework",
      section: skill.ref,
      tags: ["ielts", "skill", skill.ref.toLowerCase()],
      examRelevance: 1.0,
      contentHash: crypto.createHash("sha256").update(text).digest("hex"),
      teachMethod: categoryToTeachMethod("skill_framework", "practice"),
    });
  }

  for (const mod of projection.curriculumModules) {
    const loRefs = mod.learningObjectives.map((lo) => lo.ref).join(", ");
    const text = `${mod.title}${mod.description ? `. ${mod.description}` : ""}${loRefs ? ` Primary outcomes: ${loRefs}.` : ""}`;
    derivedAssertions.push({
      assertion: text,
      category: "session_flow",
      chapter: "Modules",
      section: mod.slug,
      tags: ["ielts", "module", mod.slug],
      examRelevance: 1.0,
      contentHash: crypto.createHash("sha256").update(text).digest("hex"),
      teachMethod: categoryToTeachMethod("session_flow", "practice"),
    });
  }

  const teachingText =
    "IELTS Speaking tutor uses a directive correction-retry cycle. Names the single most score-limiting issue after each answer, provides the correction, and asks for an immediate retry. Theory is embedded in practice — never standalone lectures. Target speech ratio ~80% student / ~20% tutor.";
  derivedAssertions.push({
    assertion: teachingText,
    category: "teaching_rule",
    chapter: "Teaching Approach",
    tags: ["ielts", "pedagogy", "directive", "correction-retry"],
    examRelevance: 0.5,
    contentHash: crypto.createHash("sha256").update(teachingText).digest("hex"),
    teachMethod: categoryToTeachMethod("teaching_rule", "practice"),
  });

  const saveResult = await saveAssertions(source.id, derivedAssertions, subjectSource.id);
  console.log(
    `  Assertions: +${saveResult.created} written, ` +
      `dedup ${saveResult.duplicatesSkipped}` +
      (saveResult.truncatedByCap ? `, truncated ${saveResult.truncatedByCap} by cap` : ""),
  );

  // Self-heal teachMethod on already-existing rows from the previous seed
  // run that wrote them with teachMethod=null (PR #2130 shipped without
  // the categoryToTeachMethod call — assertions dedup on contentHash so
  // saveAssertions above won't rewrite them; this fills the column in
  // place). Idempotent: WHERE teachMethod IS NULL means subsequent runs
  // touch zero rows.
  const teachMethodBackfill = await prisma.contentAssertion.updateMany({
    where: {
      sourceId: source.id,
      teachMethod: null,
      category: { in: ["skill_framework", "session_flow", "teaching_rule"] },
    },
    data: { teachMethod: "tutor_instruction" },
  });
  if (teachMethodBackfill.count > 0) {
    console.log(`  teachMethod backfilled on ${teachMethodBackfill.count} legacy row(s)`);
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

  // ── 4c. Baseline module — 4 upfront IELTS intake questions ──
  // Pure DATA. Lives in
  // `Playbook.config.modules[baseline].settings.{firstTimeOrientationLine,topicPool}`.
  // The existing `module_topic_pool_directive` transform (instructions.ts
  // :resolveModuleTopicPool, ~line 870) renders the topicPool to the AI as:
  //
  //   "TOPIC LIBRARY for this module — anchor on this topic and ask
  //    these questions: Topic: IELTS Goals & Baseline. Practice
  //    questions: <4 questions>"
  //
  // Pairs with `firstCallMode: "baseline_assessment"` + the
  // `assessmentPlan.upfront` moment already declared on the playbook
  // config above (chain-contract per json-fields.ts:1879).
  //
  // **Runtime gate:** the directive is wrapped by
  // `isIeltsModuleSettingsEnabled()` — operator MUST set the env var
  // `HF_FLAG_IELTS_MODULE_SETTINGS=true` on hf-dev VM and Cloud Run
  // for the directive to fire (per epic #1700 decision 5). Without
  // the flag, the topicPool is present in DB but the AI never sees
  // it and improvises an opener.
  //
  // Operator edits the 4 questions via the Modules Inspector
  // (G8 settings panel). `persistAuthoredModules.preserveManualEdits`
  // ensures re-projection of the course-ref doc never clobbers them.
  //
  // Per-call answer extraction is the responsibility of the
  // IELTS-MEASURE-001 AnalysisSpec (epic #2135, in flight). Until it
  // ships, the standard MEASURE pipeline still scores the transcript
  // and answers are inspectable in the Call transcript view.
  const baselineCfgRead = await prisma.playbook.findUnique({
    where: { id: playbook.id },
    select: { config: true },
  });
  const baselineCfg = baselineCfgRead?.config as Record<string, any> | undefined;
  const baselineMod = Array.isArray(baselineCfg?.modules)
    ? (baselineCfg!.modules as Array<Record<string, any>>).find(
        (m) => m.id === "baseline",
      )
    : undefined;
  if (baselineCfg && baselineMod) {
    baselineMod.settings = {
      ...(baselineMod.settings ?? {}),
      // BDD `HF-IELTS-Pre-Voice-Testing-Checklist.md` §Unit 1 Scenario
      // "Part A — Context collection":
      //   "the tutor introduces itself warmly
      //    AND says once: 'If you're ever unsure about anything —
      //    just ask me.'"
      // and Scenario "Part B feels like a natural conversation":
      //   "the tutor does not announce it is assessing the learner
      //    AND the transition from Part A to Part B is seamless"
      // So the orientation MUST NOT announce "4 questions" / "an
      // assessment" — it's a warm hello + the one-time "just ask me"
      // line. Identity directive composes the tutor name separately.
      firstTimeOrientationLine:
        "If you're ever unsure about anything — just ask me. Let's just have a relaxed chat and I'll get to know you a bit.",
      // BDD §Unit 1 Scenario "Part A — Context collection":
      //   "collects through natural conversation:
      //      | Reason for IELTS        |
      //      | Target band             |
      //      | Exam timeline           |
      //      | Learner self-assessment |"
      // Framed as topics-to-collect, not as scripted questions, so
      // the AI weaves them conversationally per BDD. The topic
      // string itself instructs the AI on the framing.
      topicPool: [
        {
          topic:
            "Learner context — weave these into a natural opening chat. Do NOT list them as a numbered questionnaire. Do NOT announce that this is an assessment. Each item is a fact to capture; not a script.",
          questions: [
            "Reason for taking the IELTS test",
            "Target IELTS speaking band",
            "Exam timeline (planned IELTS test date)",
            "Current self-assessed IELTS speaking band",
          ],
        },
      ],
      // BDD §Unit 1 Scenario "Session close and output":
      //   the tutor says: "That gives me a good picture of where you
      //   are. Give me a moment, and we'll get you started."
      // Overrides the course-ref v2.3 line ("That's the end of your
      // Baseline. I'll share your focus area on screen.") per the
      // checklist-vs-course-ref discrepancy noted in #2269 US-A-07
      // — operator confirmed checklist is authoritative.
      closingLine:
        "That gives me a good picture of where you are. Give me a moment, and we'll get you started.",
      // Projection bug workaround — `applyProjection` writes some YAML
      // settings (firstTimeOrientationLine, closingLine) to
      // config.modules[].settings but NOT cueCardPool / scoringCriteria
      // / scaffoldPool / scoreReadoutMode. Until projection is fixed,
      // we set these directly here so the runtime directives fire.
      //
      // cueCardPool: course-ref v2.3 YAML says `cue-card-bank-baseline-v1`
      // (Source 4); per PR #2241 D2 the BDD-sanctioned reuse path is to
      // repoint to `cue-card-bank-v1` (Source 2 — the canonical Part 2
      // cue-card bank, EXPERT_CURATED). Unblocks `module_cue_card_directive`
      // → AI gets real cue-card content for the Part B speaking sample.
      cueCardPool: "source:cue-card-bank-v1",
      // BDD §"Part B": tutor asks questions in Part 1 style. The
      // baseline session uses Part 1 stall scaffolds for short stalls
      // (Part 1 reuse Part 3 scaffold shape per course-ref YAML).
      scaffoldPool: "source:stall-scaffolds-monologue",
      // BDD §"Assessment produces a complete learner profile": all 4
      // IELTS criteria must have non-null scores. end-session.ts reads
      // scoringCriteria to gate `validateIeltsCompletion`. Until
      // epic #2135 (LLM MEASURE) ships, these may still come back null
      // — but the field needs to be set for the pipeline to attempt.
      scoringCriteria: ["FC", "LR", "GRA", "Pron"],
      // BDD §"no scores are shown to the learner" — bands appear
      // on-screen post-session but are NOT spoken aloud during the
      // call. Matches course-ref v2.3 YAML.
      scoreReadoutMode: "on-screen",
      // BDD §"Part A — Context collection" / "And all collected
      // information is persisted to the learner profile" — the
      // profile-fields source defines the typed schema (key + prompt
      // + type) the MEASURE spec extracts from the transcript.
      profileFieldsToCapture: "source:ielts-speaking-profile-fields",
    };
    await prisma.playbook.update({
      where: { id: playbook.id },
      data: { config: baselineCfg as any },
    });
    console.log(
      "  Baseline module: BDD-aligned orientation + topicPool (4 context fields) + closingLine",
    );
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

  // ── 6. Canonical Source 1–5 ContentSource rows (#2266 follow-on) ──
  //
  // The course-ref doc declares 5 named source pools that the playbook
  // module config references by their canonical names — the
  // module-summary table at line 133-137 lists each module's source as
  // "Source 1 — Part 1 topic library", "Source 4 — Baseline topic pool",
  // etc. The `applyProjection` step above creates ContentSource rows
  // for the 3 inline-defined banks (`part1-topic-library-v1`,
  // `cue-card-bank-v1`, `part3-theme-library-v1`) but names them with
  // the doc's H3 heading ("IELTS Speaking — Part 1 topic set library")
  // — NOT the shorter canonical name the module config references.
  //
  // Without this step, `resolveModuleSourceRefs` returns null for those
  // 5 refs, the AI tutor has no structured content to draw from in
  // Parts 1/2/3 and Baseline/Mock, and the FOH session improvises
  // topics on the fly. Confirmed live on hf_sandbox 2026-06-24.
  //
  // Fix is data-first: alias the 3 existing sources to their canonical
  // names (no schema change), create new ContentSource rows for the 2
  // sources the projection doesn't materialise (Baseline + Mock pools
  // per course-ref doc lines 1093/1101). Idempotent — re-seed updates
  // names in place; create-on-miss for the 2 new rows.
  //
  // Long-term, `applyProjection` should align source names to the
  // module-table-column convention (story TBD); this seed-side step
  // keeps the IELTS market test unblocked in the meantime.
  type SourceAlias = {
    bySlug?: string;
    canonicalName: string;
    description?: string;
    documentType?: "QUESTION_BANK" | "REFERENCE";
  };
  const CANONICAL_SOURCES: SourceAlias[] = [
    { bySlug: "part1-topic-library-v1", canonicalName: "Source 1 — Part 1 topic library" },
    { bySlug: "cue-card-bank-v1", canonicalName: "Source 2 — Cue card bank" },
    { bySlug: "part3-theme-library-v1", canonicalName: "Source 3 — Part 3 theme library" },
    {
      canonicalName: "Source 4 — Baseline topic pool",
      description:
        "Separate pool of Part 1 topics, Part 2 cue cards, and Part 3 themes used ONLY in Baseline Assessment. Kept separate so Baseline content isn't practised before the student takes their Baseline.",
      documentType: "QUESTION_BANK",
    },
    {
      canonicalName: "Source 5 — Mock Exam topic pool",
      description:
        "Separate pool of full three-part Mock Exam scenarios. Each scenario is a Part 1 topic set, a Part 2 cue card, and a thematically connected Part 3 theme, designed to function together as a coherent test simulation.",
      documentType: "QUESTION_BANK",
    },
  ];
  let aliased = 0;
  let created = 0;
  for (const entry of CANONICAL_SOURCES) {
    if (entry.bySlug) {
      const existing = await prisma.contentSource.findFirst({
        where: { slug: entry.bySlug },
        select: { id: true, name: true },
      });
      if (existing && existing.name !== entry.canonicalName) {
        await prisma.contentSource.update({
          where: { id: existing.id },
          data: { name: entry.canonicalName },
        });
        aliased += 1;
      }
    } else {
      const existing = await prisma.contentSource.findFirst({
        where: { name: entry.canonicalName },
      });
      if (!existing) {
        await prisma.contentSource.create({
          data: {
            slug: entry.canonicalName
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, ""),
            name: entry.canonicalName,
            description: entry.description ?? "",
            documentType: entry.documentType ?? "QUESTION_BANK",
          },
        });
        created += 1;
      }
    }
  }
  if (aliased > 0 || created > 0) {
    console.log(`  Canonical Source 1-5 names: aliased ${aliased}, created ${created}`);
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
