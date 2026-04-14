/**
 * Golden Path Seed — Demo Edition
 *
 * Creates a clean, focused demo dataset:
 *   1 institution: Abacus Academy (school) — 1 course, 1 class, 4 students
 *   1 educator login: sarah@abacus.academy (hff2026)
 *   1 fully seeded course: Year 5 Maths with teaching points, curriculum, and lesson plan
 *
 * ENRICHMENT: ~50% of learners get "lived data" (calls, scores, memories,
 * personality profiles, goals, targets, onboarding). The rest are "new"
 * (enrolled but not yet called). This creates realistic empty vs populated states.
 *
 * All entities tagged with "golden-" externalId prefix for idempotent cleanup.
 * Non-PROD only — refuses to run when NEXT_PUBLIC_APP_ENV=LIVE.
 *
 * Usage:
 *   SEED_PROFILE=golden npx tsx prisma/seed-full.ts --reset
 *   npx tsx prisma/seed-golden.ts          # standalone
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { categoryToTeachMethod } from "../lib/content-trust/resolve-config";

const DEMO_PASSWORD = "hff2026";
const TAG = "golden-";

// ══════════════════════════════════════════════════════════
// DATA DEFINITIONS
// ══════════════════════════════════════════════════════════

interface InstitutionDef {
  slug: string;
  name: string;
  typeSlug: string;
  primaryColor: string;
  secondaryColor: string;
  welcomeMessage: string;
  login: { email: string; name: string };
  domain: DomainDef;
}

interface SubjectDef {
  slug: string;
  name: string;
  description: string;
  teachingProfile?: string;
  teachingOverrides?: Record<string, unknown>;
}

interface DomainDef {
  slug: string;
  name: string;
  description: string;
  kind?: "INSTITUTION" | "COMMUNITY";
  subjects?: SubjectDef[];
  groups?: GroupDef[];
  playbooks: PlaybookDef[];
  cohorts: CohortDef[];
}

interface GroupDef {
  slug: string;
  name: string;
  groupType: "DEPARTMENT" | "YEAR_GROUP" | "DIVISION" | "TRACK" | "CUSTOM";
  styleNotes?: string;
  playbookSlugs?: string[]; // which playbooks belong to this group
}

interface PlaybookDef {
  slug: string;
  name: string;
  description: string;
}

interface CohortDef {
  name: string;
  teacher: { name: string; email: string };
  members: string[]; // learner names
}

/** Collected during institution loop, passed to enrichment */
interface LearnerRecord {
  id: string;
  name: string;
  externalId: string;
  typeSlug: string;
  domainId: string;
  playbookIds: string[];
  isActive: boolean;
}

// ── Persona labels per institution type ──
const PERSONA_LABELS: Record<string, string> = {
  school: "tutor",
};

const INSTITUTIONS: InstitutionDef[] = [
  {
    slug: "abacus-academy",
    name: "Abacus Academy",
    typeSlug: "school",
    primaryColor: "#166534",
    secondaryColor: "#ca8a04",
    welcomeMessage: "Welcome to Abacus Academy! Our AI tutors help every student build confidence and understanding.",
    login: { email: "sarah@abacus.academy", name: "Sarah Thompson" },
    domain: {
      slug: "abacus-academy",
      name: "Abacus Academy",
      description: "Primary school with focus on literacy and numeracy across Key Stage 2.",
      subjects: [
        { slug: "golden-english-ks2", name: "Year 5 English", description: "Key Stage 2 English — reading comprehension, creative writing, and grammar for Year 5.", teachingProfile: "comprehension-led", teachingOverrides: { teachingFocus: "Teach transferable comprehension techniques — skimming, scanning, inference, PEE paragraphs, question-type recognition. Use the class texts as practice material, not as the goal. Students should leave with a reusable framework for attacking any comprehension question." } },
        { slug: "golden-maths-ks2", name: "Year 5 Mathematics", description: "Key Stage 2 Mathematics — number, fractions, geometry, and problem-solving for Year 5.", teachingProfile: "practice-led" },
      ],
      groups: [
        {
          slug: "english-dept",
          name: "English",
          groupType: "DEPARTMENT",
          styleNotes: "Expressive, discussion-led, creative and analytical thinking. Encourage reading for pleasure.",
          playbookSlugs: [],
        },
        {
          slug: "maths-dept",
          name: "Mathematics",
          groupType: "DEPARTMENT",
          styleNotes: "Logical reasoning, step-by-step problem solving. Use concrete examples before abstract concepts.",
          playbookSlugs: ["golden-year5-maths"],
        },
      ],
      playbooks: [
        { slug: "golden-year5-maths", name: "Year 5 Maths", description: "Number, fractions, geometry, and problem-solving for Year 5 students." },
      ],
      cohorts: [
        {
          name: "Class 5B",
          teacher: { name: "Mr. David Clarke", email: "d.clarke@abacus.academy" },
          members: ["Aaron Brown", "Aaliyah Martinez", "Aanya Ali", "Aarav O'Connor"],
        },
      ],
    },
  },
];

// ── Default onboarding flow phases (inlined from fallback-settings.ts) ──
const DEFAULT_FLOW_PHASES = [
  { phase: "greeting", label: "Greeting & welcome" },
  { phase: "rapport", label: "Build rapport" },
  { phase: "assessment", label: "Quick assessment" },
  { phase: "teaching", label: "Teaching interaction" },
  { phase: "summary", label: "Session summary" },
];

// ══════════════════════════════════════════════════════════
// TRANSCRIPT TEMPLATES (3 school transcripts)
// ══════════════════════════════════════════════════════════

const TRANSCRIPTS: Record<string, string[]> = {
  school: [
    `AI: Good morning, {{name}}! Today we're going to work on reading comprehension. I've got a really interesting passage about the rainforest. Ready?\nUser: Yeah, I like animals so that sounds good.\nAI: Perfect! Here's the first paragraph. Read it carefully and tell me what the main idea is.\nUser: It's about how animals in the rainforest depend on each other?\nAI: Exactly right! That's called an ecosystem. Can you find a specific example from the text?\nUser: The bit about the toucan eating berries and then spreading the seeds?\nAI: Brilliant! That's a great example of how animals help plants reproduce. What word in the text describes this relationship?\nUser: Symbiotic?\nAI: Well done! You're really getting the hang of finding key vocabulary in context.`,
    `AI: Hi {{name}}! Let's practise some maths today. We're going to work on fractions. What do you already know about adding fractions?\nUser: You need the same bottom number... the denominator?\nAI: That's right! When the denominators are the same, we can add the numerators. What about when they're different?\nUser: I think you have to make them the same first? Like find a common number?\nAI: Spot on! Let's try this: what's 1/3 + 1/4?\nUser: Um... 12 is a common number for both. So... 4/12 + 3/12 = 7/12?\nAI: That's perfect! You found the lowest common denominator and converted both fractions correctly. How are you feeling about that?\nUser: Actually quite good! It makes more sense when you explain it step by step.`,
    `AI: Welcome back, {{name}}! Today we're going to do some creative writing. I'd like you to write the opening paragraph of a story set in space. What ideas come to mind?\nUser: Maybe something about an astronaut who finds a strange signal?\nAI: Ooh, I love that idea! Think about your senses — what would the astronaut see, hear, and feel? That'll make your opening really vivid.\nUser: The lights on the dashboard are flickering and there's a low humming sound that wasn't there before?\nAI: That's fantastic sensory detail! Now turn that into a sentence. Remember, strong openings often start with action.\nUser: "Captain Reyes gripped the armrest as the dashboard lights flickered red, and a low hum filled the cockpit."\nAI: What a brilliant opening sentence! You've created tension immediately. The reader wants to know what happens next.`,
  ],
};

// ══════════════════════════════════════════════════════════
// ENRICHMENT DATA TEMPLATES
// ══════════════════════════════════════════════════════════

/** Memory templates per institution type */
const MEMORY_TEMPLATES: Record<string, Array<{ category: "FACT" | "PREFERENCE" | "TOPIC" | "CONTEXT"; key: string; valueFn: (name: string) => string }>> = {
  school: [
    { category: "FACT", key: "year_group", valueFn: () => "Year 5" },
    { category: "FACT", key: "school", valueFn: () => "Abacus Academy" },
    { category: "PREFERENCE", key: "learning_style", valueFn: (n) => `${n} prefers visual explanations with diagrams` },
    { category: "PREFERENCE", key: "pace", valueFn: () => "Likes time to think before answering" },
    { category: "TOPIC", key: "current_focus", valueFn: () => "Reading comprehension and inference skills" },
    { category: "TOPIC", key: "strength", valueFn: (n) => `${n} is strong at creative writing` },
  ],
};

/** Goal templates per institution type */
const GOAL_TEMPLATES: Record<string, Array<{ name: string; description: string }>> = {
  school: [
    { name: "Reading Comprehension Mastery", description: "Achieve confident, independent inference and deduction from age-appropriate texts." },
    { name: "Maths Confidence", description: "Build fluency with fractions, decimals, and problem-solving strategies." },
  ],
};

// ══════════════════════════════════════════════════════════
// COURSE CONTENT — Year 5 Maths (pre-built for learner demo)
// ══════════════════════════════════════════════════════════

const COURSE_CONTENT = {
  source: {
    slug: "golden-year5-maths-nc",
    name: "National Curriculum Year 5 Mathematics",
    description: "Key Stage 2 mathematics programme of study — statutory requirements for Year 5.",
    documentType: "CURRICULUM" as const,
    trustLevel: "EXPERT_CURATED" as const,
    publisherOrg: "Department for Education",
  },
  curriculum: {
    slug: "golden-year5-maths-curriculum",
    name: "Year 5 Mathematics",
    description: "Full Year 5 maths curriculum covering fractions, decimals, geometry, and problem-solving.",
  },
  modules: [
    {
      slug: "MOD-1",
      title: "Fractions & Decimals",
      description: "Adding and subtracting fractions, equivalent fractions, decimal place value, and converting between fractions and decimals.",
      sortOrder: 0,
      learningObjectives: [
        { ref: "MATHS-LO1", description: "Add and subtract fractions with unlike denominators by finding a common denominator", sortOrder: 0 },
        { ref: "MATHS-LO2", description: "Identify and write equivalent fractions including simplifying", sortOrder: 1 },
        { ref: "MATHS-LO3", description: "Convert between improper fractions and mixed numbers", sortOrder: 2 },
        { ref: "MATHS-LO4", description: "Read, write, and compare decimals to thousandths", sortOrder: 3 },
        { ref: "MATHS-LO5", description: "Round decimals to the nearest whole number, tenth, or hundredth", sortOrder: 4 },
      ],
    },
    {
      slug: "MOD-2",
      title: "Geometry & Measurement",
      description: "Properties of 2D shapes, measuring and drawing angles, coordinates in the first quadrant, and calculating perimeter and area.",
      sortOrder: 1,
      learningObjectives: [
        { ref: "MATHS-LO6", description: "Identify properties of 2D shapes including angles and lines of symmetry", sortOrder: 0 },
        { ref: "MATHS-LO7", description: "Measure and draw angles using a protractor to the nearest degree", sortOrder: 1 },
        { ref: "MATHS-LO8", description: "Describe positions on the first quadrant of a coordinate grid", sortOrder: 2 },
        { ref: "MATHS-LO9", description: "Calculate the perimeter and area of rectangles and compound shapes", sortOrder: 3 },
      ],
    },
    {
      slug: "MOD-3",
      title: "Problem Solving",
      description: "Multi-step word problems combining all four operations, checking answers using inverse operations, and explaining mathematical reasoning.",
      sortOrder: 2,
      learningObjectives: [
        { ref: "MATHS-LO10", description: "Solve multi-step word problems involving addition, subtraction, multiplication, and division", sortOrder: 0 },
        { ref: "MATHS-LO11", description: "Check answers using inverse operations and estimation", sortOrder: 1 },
        { ref: "MATHS-LO12", description: "Explain and justify mathematical reasoning using correct vocabulary", sortOrder: 2 },
      ],
    },
  ],
  assertions: [
    // MOD-1: Fractions & Decimals
    { assertion: "To add fractions with different denominators, first find the lowest common multiple (LCM) of both denominators, convert each fraction to an equivalent fraction with that denominator, then add the numerators.", category: "process", chapter: "Fractions", section: "Adding fractions", tags: ["fractions", "addition", "LCM"], learningOutcomeRef: "MATHS-LO1", topicSlug: "adding-fractions" },
    { assertion: "To subtract fractions with unlike denominators, convert both fractions to equivalent fractions with a common denominator, then subtract the numerators.", category: "process", chapter: "Fractions", section: "Subtracting fractions", tags: ["fractions", "subtraction"], learningOutcomeRef: "MATHS-LO1", topicSlug: "subtracting-fractions" },
    { assertion: "Equivalent fractions represent the same value. You can find equivalent fractions by multiplying or dividing both the numerator and denominator by the same number.", category: "concept", chapter: "Fractions", section: "Equivalent fractions", tags: ["fractions", "equivalence"], learningOutcomeRef: "MATHS-LO2", topicSlug: "equivalent-fractions" },
    { assertion: "To simplify a fraction, divide the numerator and denominator by their highest common factor (HCF).", category: "process", chapter: "Fractions", section: "Simplifying", tags: ["fractions", "simplifying", "HCF"], learningOutcomeRef: "MATHS-LO2", topicSlug: "simplifying-fractions" },
    { assertion: "An improper fraction has a numerator greater than or equal to its denominator (e.g. 7/4). A mixed number has a whole number part and a fraction part (e.g. 1 3/4).", category: "definition", chapter: "Fractions", section: "Mixed numbers", tags: ["fractions", "mixed-numbers", "improper"], learningOutcomeRef: "MATHS-LO3", topicSlug: "mixed-numbers" },
    { assertion: "To convert an improper fraction to a mixed number, divide the numerator by the denominator. The quotient is the whole number part; the remainder over the denominator is the fraction part.", category: "process", chapter: "Fractions", section: "Converting", tags: ["fractions", "conversion"], learningOutcomeRef: "MATHS-LO3", topicSlug: "mixed-numbers" },
    { assertion: "Each decimal place is worth ten times less than the one to its left: ones (1), tenths (0.1), hundredths (0.01), thousandths (0.001).", category: "concept", chapter: "Decimals", section: "Place value", tags: ["decimals", "place-value"], learningOutcomeRef: "MATHS-LO4", topicSlug: "decimal-place-value" },
    { assertion: "When rounding decimals, look at the digit to the right of the rounding position: if it is 5 or more, round up; if it is less than 5, round down.", category: "rule", chapter: "Decimals", section: "Rounding", tags: ["decimals", "rounding"], learningOutcomeRef: "MATHS-LO5", topicSlug: "rounding-decimals" },
    // MOD-2: Geometry & Measurement
    { assertion: "A triangle has 3 sides and interior angles that always sum to 180°. Types include equilateral (all sides equal), isosceles (two sides equal), and scalene (no sides equal).", category: "fact", chapter: "Geometry", section: "2D shapes", tags: ["geometry", "triangles", "angles"], learningOutcomeRef: "MATHS-LO6", topicSlug: "triangle-properties" },
    { assertion: "A line of symmetry divides a shape into two identical halves that are mirror images of each other.", category: "definition", chapter: "Geometry", section: "Symmetry", tags: ["geometry", "symmetry"], learningOutcomeRef: "MATHS-LO6", topicSlug: "symmetry" },
    { assertion: "Angles are measured in degrees (°). A right angle is exactly 90°, an acute angle is less than 90°, an obtuse angle is between 90° and 180°, and a straight angle is exactly 180°.", category: "definition", chapter: "Geometry", section: "Angles", tags: ["geometry", "angles", "measurement"], learningOutcomeRef: "MATHS-LO7", topicSlug: "angle-types" },
    { assertion: "To measure an angle with a protractor, place the centre point on the vertex and align the baseline with one arm of the angle, then read the scale where the other arm crosses.", category: "process", chapter: "Geometry", section: "Using a protractor", tags: ["geometry", "protractor", "measurement"], learningOutcomeRef: "MATHS-LO7", topicSlug: "measuring-angles" },
    { assertion: "On a coordinate grid, the horizontal axis is the x-axis and the vertical axis is the y-axis. A point is described as (x, y), where x is the distance along and y is the distance up.", category: "concept", chapter: "Geometry", section: "Coordinates", tags: ["geometry", "coordinates", "grid"], learningOutcomeRef: "MATHS-LO8", topicSlug: "coordinates" },
    { assertion: "The perimeter of a rectangle is 2 × (length + width). The area of a rectangle is length × width, measured in square units (cm², m²).", category: "rule", chapter: "Measurement", section: "Perimeter and area", tags: ["measurement", "perimeter", "area", "rectangle"], learningOutcomeRef: "MATHS-LO9", topicSlug: "perimeter-and-area" },
    { assertion: "To find the area of a compound shape (L-shape, T-shape), split it into rectangles, calculate the area of each, and add them together.", category: "process", chapter: "Measurement", section: "Compound shapes", tags: ["measurement", "area", "compound-shapes"], learningOutcomeRef: "MATHS-LO9", topicSlug: "compound-shapes" },
    // MOD-3: Problem Solving
    { assertion: "Multi-step word problems require reading carefully, identifying what is being asked, choosing the correct operations, and working through each step in order.", category: "process", chapter: "Problem Solving", section: "Multi-step problems", tags: ["problem-solving", "word-problems", "strategy"], learningOutcomeRef: "MATHS-LO10", topicSlug: "multi-step-problems" },
    { assertion: "Inverse operations can be used to check answers: addition is the inverse of subtraction, and multiplication is the inverse of division.", category: "concept", chapter: "Problem Solving", section: "Checking answers", tags: ["problem-solving", "inverse", "checking"], learningOutcomeRef: "MATHS-LO11", topicSlug: "inverse-operations" },
    { assertion: "Estimation means rounding numbers to make a rough calculation. It helps check whether an answer is reasonable before or after solving.", category: "concept", chapter: "Problem Solving", section: "Estimation", tags: ["problem-solving", "estimation", "rounding"], learningOutcomeRef: "MATHS-LO11", topicSlug: "estimation" },
    { assertion: "When explaining mathematical reasoning, use precise vocabulary (e.g. 'I multiplied because...', 'The denominator must be the same because...') and show each step clearly.", category: "process", chapter: "Problem Solving", section: "Reasoning", tags: ["problem-solving", "reasoning", "vocabulary"], learningOutcomeRef: "MATHS-LO12", topicSlug: "mathematical-reasoning" },
  ],
  lessonPlanEntries: [
    {
      session: 1,
      type: "introduce",
      label: "Fractions Fundamentals",
      moduleSlug: "MOD-1",
      moduleLabel: "Fractions & Decimals",
      estimatedDurationMins: 30,
      learningOutcomeRefs: ["MATHS-LO1", "MATHS-LO2", "MATHS-LO3"],
    },
    {
      session: 2,
      type: "introduce",
      label: "Decimals & Place Value",
      moduleSlug: "MOD-1",
      moduleLabel: "Fractions & Decimals",
      estimatedDurationMins: 30,
      learningOutcomeRefs: ["MATHS-LO4", "MATHS-LO5"],
    },
    {
      session: 3,
      type: "introduce",
      label: "Shape & Space",
      moduleSlug: "MOD-2",
      moduleLabel: "Geometry & Measurement",
      estimatedDurationMins: 30,
      learningOutcomeRefs: ["MATHS-LO6", "MATHS-LO7", "MATHS-LO8", "MATHS-LO9"],
    },
    {
      session: 4,
      type: "consolidate",
      label: "Problem Solving Challenge",
      moduleSlug: "MOD-3",
      moduleLabel: "Problem Solving",
      estimatedDurationMins: 30,
      learningOutcomeRefs: ["MATHS-LO10", "MATHS-LO11", "MATHS-LO12"],
    },
  ],
};

// ══════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════

export async function main(externalPrisma?: PrismaClient, opts?: { skipCleanup?: boolean }): Promise<void> {
  // PROD guard
  const env = process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV;
  if (env === "LIVE" || env === "production") {
    console.log("  ⛔ Skipping golden seed — PROD environment detected");
    return;
  }

  const prisma = externalPrisma || new PrismaClient();
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  console.log("\n  🌟 Seeding Golden Path data...\n");

  // ── 1. Cleanup existing golden data (FK-safe order) ────
  // Skip when running as part of a larger seed (e.g. full profile) to avoid
  // wiping data created by earlier steps.
  if (!opts?.skipCleanup) {
    await cleanup(prisma);
  }

  // ── 2. Create institutions, domains, playbooks, cohorts ─
  let totalPlaybooks = 0;
  let totalGroups = 0;
  let totalCohorts = 0;
  let totalTeachers = 0;
  let totalLearners = 0;
  let totalSubjects = 0;
  const allLearners: LearnerRecord[] = [];

  // Track subject IDs for course content seeding
  let mathsSubjectId: string | null = null;

  for (const inst of INSTITUTIONS) {
    console.log(`  ── ${inst.name} (${inst.typeSlug}) ──`);

    // Find institution type
    const instType = await prisma.institutionType.findUnique({
      where: { slug: inst.typeSlug },
    });
    if (!instType) {
      console.warn(`  ⚠ Institution type "${inst.typeSlug}" not found — skipping`);
      continue;
    }

    // Create institution
    const institution = await prisma.institution.upsert({
      where: { slug: inst.slug },
      update: {
        name: inst.name,
        typeId: instType.id,
        primaryColor: inst.primaryColor,
        secondaryColor: inst.secondaryColor,
        welcomeMessage: inst.welcomeMessage,
      },
      create: {
        name: inst.name,
        slug: inst.slug,
        typeId: instType.id,
        primaryColor: inst.primaryColor,
        secondaryColor: inst.secondaryColor,
        welcomeMessage: inst.welcomeMessage,
      },
    });
    console.log(`    + Institution: ${institution.name}`);

    // Create domain
    const domain = await prisma.domain.upsert({
      where: { slug: inst.domain.slug },
      update: {
        name: inst.domain.name,
        description: inst.domain.description,
        institutionId: institution.id,
        isActive: true,
        ...(inst.domain.kind ? { kind: inst.domain.kind } : {}),
      },
      create: {
        slug: inst.domain.slug,
        name: inst.domain.name,
        description: inst.domain.description,
        isActive: true,
        institutionId: institution.id,
        ...(inst.domain.kind ? { kind: inst.domain.kind } : {}),
      },
    });
    console.log(`    + Domain: ${domain.name}`);

    // Create Subjects + SubjectDomain links
    if (inst.domain.subjects && inst.domain.subjects.length > 0) {
      for (const subjectDef of inst.domain.subjects) {
        const subject = await prisma.subject.upsert({
          where: { slug: subjectDef.slug },
          update: { name: subjectDef.name, description: subjectDef.description, isActive: true, teachingProfile: subjectDef.teachingProfile ?? null, ...(subjectDef.teachingOverrides ? { teachingOverrides: subjectDef.teachingOverrides as any } : {}) },
          create: {
            slug: subjectDef.slug,
            name: subjectDef.name,
            description: subjectDef.description,
            defaultTrustLevel: "EXPERT_CURATED",
            isActive: true,
            teachingProfile: subjectDef.teachingProfile ?? null,
            ...(subjectDef.teachingOverrides ? { teachingOverrides: subjectDef.teachingOverrides as any } : {}),
          },
        });
        await prisma.subjectDomain.upsert({
          where: { subjectId_domainId: { subjectId: subject.id, domainId: domain.id } },
          update: {},
          create: { subjectId: subject.id, domainId: domain.id },
        });

        // Track maths subject for course content
        if (subjectDef.slug === "golden-maths-ks2") {
          mathsSubjectId = subject.id;
        }

        totalSubjects++;
        console.log(`      + Subject: ${subject.name}`);
      }
    }

    // Create PlaybookGroups (departments/tracks)
    const playbookSlugToGroupId = new Map<string, string>();

    if (inst.domain.groups) {
      for (let g = 0; g < inst.domain.groups.length; g++) {
        const groupDef = inst.domain.groups[g];
        const group = await prisma.playbookGroup.upsert({
          where: {
            domainId_slug: { domainId: domain.id, slug: groupDef.slug },
          },
          update: {
            name: groupDef.name,
            groupType: groupDef.groupType,
            identityOverride: groupDef.styleNotes
              ? { toneSliders: {}, styleNotes: groupDef.styleNotes }
              : undefined,
            sortOrder: g,
            isActive: true,
          },
          create: {
            domainId: domain.id,
            slug: groupDef.slug,
            name: groupDef.name,
            groupType: groupDef.groupType,
            identityOverride: groupDef.styleNotes
              ? { toneSliders: {}, styleNotes: groupDef.styleNotes }
              : undefined,
            sortOrder: g,
            isActive: true,
          },
        });
        for (const pbSlug of groupDef.playbookSlugs || []) {
          playbookSlugToGroupId.set(pbSlug, group.id);
        }
        console.log(`    + Group: ${group.name} (${groupDef.groupType})`);
        totalGroups++;
      }
    }

    // Create identity spec — use type-appropriate archetype
    const archetypeSlug = instType.defaultArchetypeSlug || "TUT-001";
    const personaLabel = PERSONA_LABELS[inst.typeSlug] || "tutor";
    const identitySlug = `${domain.slug}-identity`;

    const identitySpec = await prisma.analysisSpec.upsert({
      where: { slug: identitySlug },
      update: {
        name: `${domain.name} Identity`,
        extendsAgent: archetypeSlug,
        isActive: true,
      },
      create: {
        slug: identitySlug,
        name: `${domain.name} Identity`,
        description: `Domain overlay for ${domain.name} — extends the base ${personaLabel} archetype.`,
        outputType: "COMPOSE",
        specRole: "IDENTITY",
        specType: "DOMAIN",
        domain: "identity",
        scope: "DOMAIN",
        isActive: true,
        isDirty: false,
        isDeletable: true,
        extendsAgent: archetypeSlug,
        config: {
          parameters: [
            {
              id: "tutor_role",
              name: "Domain Role Override",
              section: "identity",
              config: {
                roleStatement: `You are a friendly, patient ${personaLabel} specializing in ${domain.name}. You adapt to each learner's pace and style while maintaining high standards for understanding.`,
                primaryGoal: `Help learners build genuine understanding of ${domain.name}`,
              },
            },
          ],
        },
        triggers: {
          create: [
            {
              given: `A ${domain.name} session`,
              when: "The system needs to establish agent identity and tone",
              then: `A consistent, domain-appropriate ${personaLabel} personality is presented`,
              name: "Identity establishment",
              sortOrder: 0,
            },
          ],
        },
      },
    });

    // All system specs enabled EXCEPT unused archetype identities
    const systemSpecs = await prisma.analysisSpec.findMany({
      where: { specType: "SYSTEM", isActive: true },
      select: { id: true, slug: true, specRole: true },
    });
    const disabledIds = new Set<string>(
      systemSpecs
        .filter((s) => s.specRole === "IDENTITY" && s.slug !== archetypeSlug)
        .map((s) => s.id)
    );
    const systemSpecToggles: Record<string, { isEnabled: boolean }> = {};
    for (const ss of systemSpecs) {
      systemSpecToggles[ss.id] = { isEnabled: !disabledIds.has(ss.id) };
    }

    // Create playbooks (idempotent — reuse existing by name+domain)
    const playbooks: Array<{ id: string; name: string }> = [];

    for (let i = 0; i < inst.domain.playbooks.length; i++) {
      const pbDef = inst.domain.playbooks[i];

      let playbook = await prisma.playbook.findFirst({
        where: { domainId: domain.id, name: pbDef.name },
      });

      if (!playbook) {
        playbook = await prisma.playbook.create({
          data: {
            name: pbDef.name,
            description: pbDef.description,
            domainId: domain.id,
            groupId: playbookSlugToGroupId.get(pbDef.slug) || undefined,
            status: "PUBLISHED",
            version: "1.0",
            publishedAt: new Date(),
            validationPassed: true,
            measureSpecCount: 0,
            learnSpecCount: 0,
            adaptSpecCount: 0,
            parameterCount: 0,
            config: {
              systemSpecToggles,
              audience: "primary",
              surveys: {
                pre: { enabled: true },
                mid: { enabled: false },
                post: { enabled: true },
              },
              assessment: {
                preTest: { enabled: true },
                postTest: { enabled: true },
              },
              goals: [
                { type: "LEARN", name: "Master core topics" },
                { type: "CHANGE", name: "Build confidence" },
              ],
            },
          },
        });

        // Link identity spec to playbook (only for new playbooks)
        await prisma.playbookItem.create({
          data: {
            playbookId: playbook.id,
            itemType: "SPEC",
            specId: identitySpec.id,
            sortOrder: 0,
            isEnabled: true,
          },
        });

        console.log(`    + Playbook: ${playbook.name} (created)`);
      } else {
        console.log(`    = Playbook: ${playbook.name} (exists)`);
      }

      playbooks.push({ id: playbook.id, name: playbook.name });
    }
    totalPlaybooks += playbooks.length;

    // Configure onboarding on domain
    await prisma.domain.update({
      where: { id: domain.id },
      data: {
        onboardingIdentitySpecId: identitySpec.id,
        onboardingFlowPhases: DEFAULT_FLOW_PHASES,
      },
    });

    // Create cohorts, teachers, and learners
    let learnerIndex = 0;
    for (const cohortDef of inst.domain.cohorts) {
      // Create teacher caller first (needed as cohort owner)
      const teacherExternalId = `${TAG}teacher-${inst.slug}-${slugify(cohortDef.name)}`;
      const teacherCaller = await prisma.caller.upsert({
        where: { externalId: teacherExternalId },
        update: {
          name: cohortDef.teacher.name,
          email: cohortDef.teacher.email,
          role: "TEACHER",
          domainId: domain.id,
        },
        create: {
          name: cohortDef.teacher.name,
          email: cohortDef.teacher.email,
          externalId: teacherExternalId,
          role: "TEACHER",
          domainId: domain.id,
        },
      });
      totalTeachers++;

      // Create cohort group (upsert by name + domainId)
      let cohort = await prisma.cohortGroup.findFirst({
        where: { name: cohortDef.name, domainId: domain.id },
      });
      if (!cohort) {
        cohort = await prisma.cohortGroup.create({
          data: {
            name: cohortDef.name,
            domainId: domain.id,
            ownerId: teacherCaller.id,
            institutionId: institution.id,
            maxMembers: 50,
            isActive: true,
            joinToken: crypto.randomUUID().slice(0, 12),
          },
        });
      }
      console.log(`    + Cohort: ${cohort.name} (${cohortDef.members.length} members)`);
      totalCohorts++;

      // Create learner callers
      for (const memberName of cohortDef.members) {
        const learnerExternalId = `${TAG}learner-${inst.slug}-${slugify(memberName)}`;
        const learner = await prisma.caller.upsert({
          where: { externalId: learnerExternalId },
          update: {
            name: memberName,
            role: "LEARNER",
            domainId: domain.id,
            cohortGroupId: cohort.id,
          },
          create: {
            name: memberName,
            externalId: learnerExternalId,
            role: "LEARNER",
            domainId: domain.id,
            cohortGroupId: cohort.id,
          },
        });
        totalLearners++;

        // Multi-cohort membership (join table)
        await prisma.callerCohortMembership.upsert({
          where: {
            callerId_cohortGroupId: {
              callerId: learner.id,
              cohortGroupId: cohort.id,
            },
          },
          update: {},
          create: {
            callerId: learner.id,
            cohortGroupId: cohort.id,
            role: "MEMBER",
          },
        });

        // Enroll in all playbooks for this domain
        for (const pb of playbooks) {
          await prisma.callerPlaybook.upsert({
            where: { callerId_playbookId: { callerId: learner.id, playbookId: pb.id } },
            update: { status: "ACTIVE" },
            create: {
              callerId: learner.id,
              playbookId: pb.id,
              status: "ACTIVE",
              enrolledBy: "golden-seed",
            },
          });
        }

        // Collect for enrichment — even index = active
        allLearners.push({
          id: learner.id,
          name: memberName,
          externalId: learner.externalId || "",
          typeSlug: inst.typeSlug,
          domainId: domain.id,
          playbookIds: playbooks.map((p) => p.id),
          isActive: learnerIndex % 2 === 0,
        });
        learnerIndex++;
      }

      // Link cohort to playbooks
      for (const pb of playbooks) {
        await prisma.cohortPlaybook.upsert({
          where: { cohortGroupId_playbookId: { cohortGroupId: cohort.id, playbookId: pb.id } },
          update: {},
          create: {
            cohortGroupId: cohort.id,
            playbookId: pb.id,
            assignedBy: "golden-seed",
          },
        });
      }
    }

    // Create EDUCATOR login for this institution
    await prisma.user.upsert({
      where: { email: inst.login.email },
      update: {
        name: inst.login.name,
        passwordHash,
        role: "EDUCATOR",
        isActive: true,
        institutionId: institution.id,
      },
      create: {
        email: inst.login.email,
        name: inst.login.name,
        passwordHash,
        role: "EDUCATOR",
        isActive: true,
        institutionId: institution.id,
      },
    });
    console.log(`    + Login: ${inst.login.email}`);
    console.log("");

    // ── 2b. Seed course content for working demo ────────
    if (mathsSubjectId && playbooks.length > 0) {
      await seedCourseContent(prisma, mathsSubjectId, playbooks[0].id);
    }
  }

  // ── Link SUPERADMIN to Abacus Academy ──────────────────
  // SUPERADMIN needs institutionId so get-started-v5 loads with full context
  // (wizard greeting, domain, Reset Demo button). The cleanup step clears this
  // on every seed run so we always restore it here.
  const abacus = await prisma.institution.findUnique({
    where: { slug: "abacus-academy" },
    select: { id: true },
  });
  if (abacus) {
    await prisma.user.updateMany({
      where: { role: "SUPERADMIN" },
      data: { institutionId: abacus.id },
    });
    console.log("  + SUPERADMIN linked to Abacus Academy (for demo flow)");
  }
  console.log("");

  // ── 3. Enrich learners with lived data ─────────────────
  console.log("  ── Enriching learners with lived data ──\n");
  const stats = await enrichLearners(prisma, allLearners);

  // ── Summary ────────────────────────────────────────────
  console.log("  ─────────────────────────────────────────────");
  console.log(`  ✓ Golden Path seed complete`);
  console.log(`    Institutions:    ${INSTITUTIONS.length}`);
  console.log(`    Domains:         ${INSTITUTIONS.length}`);
  console.log(`    Subjects:        ${totalSubjects}`);
  console.log(`    Groups:          ${totalGroups}`);
  console.log(`    Playbooks:       ${totalPlaybooks}`);
  console.log(`    Cohorts:         ${totalCohorts}`);
  console.log(`    Teachers:        ${totalTeachers}`);
  console.log(`    Learners:        ${totalLearners} (${stats.activeLearners} active, ${totalLearners - stats.activeLearners} new)`);
  console.log(`    Calls:           ${stats.calls}`);
  console.log(`    Call scores:     ${stats.scores}`);
  console.log(`    Memories:        ${stats.memories}`);
  console.log(`    Personalities:   ${stats.personalities}`);
  console.log(`    Goals:           ${stats.goals}`);
  console.log(`    Targets:         ${stats.targets}`);
  console.log(`    Onboarding:      ${stats.onboarding}`);
  console.log(`    Logins:          ${INSTITUTIONS.length} (${INSTITUTIONS.length} EDUCATOR)`);
  console.log("");

  if (!externalPrisma) {
    await prisma.$disconnect();
  }
}

// ══════════════════════════════════════════════════════════
// COURSE CONTENT SEEDING
// ══════════════════════════════════════════════════════════

async function seedCourseContent(
  prisma: PrismaClient,
  subjectId: string,
  playbookId: string
): Promise<void> {
  console.log("    ── Seeding course content ──");

  // ContentSource
  const source = await prisma.contentSource.upsert({
    where: { slug: COURSE_CONTENT.source.slug },
    update: {
      name: COURSE_CONTENT.source.name,
      description: COURSE_CONTENT.source.description,
    },
    create: {
      slug: COURSE_CONTENT.source.slug,
      name: COURSE_CONTENT.source.name,
      description: COURSE_CONTENT.source.description,
      documentType: COURSE_CONTENT.source.documentType,
      trustLevel: COURSE_CONTENT.source.trustLevel,
      publisherOrg: COURSE_CONTENT.source.publisherOrg,
    },
  });

  // SubjectSource link
  const subjectSource = await prisma.subjectSource.upsert({
    where: { subjectId_sourceId: { subjectId, sourceId: source.id } },
    update: {},
    create: { subjectId, sourceId: source.id, tags: ["content"] },
  });

  // PlaybookSubject link
  await prisma.playbookSubject.upsert({
    where: { playbookId_subjectId: { playbookId, subjectId } },
    update: {},
    create: { playbookId, subjectId },
  });

  // Curriculum — created with placeholder deliveryConfig, updated after assertions exist
  const curriculum = await prisma.curriculum.upsert({
    where: { slug: COURSE_CONTENT.curriculum.slug },
    update: {
      name: COURSE_CONTENT.curriculum.name,
      description: COURSE_CONTENT.curriculum.description,
    },
    create: {
      slug: COURSE_CONTENT.curriculum.slug,
      name: COURSE_CONTENT.curriculum.name,
      description: COURSE_CONTENT.curriculum.description,
      subjectId,
      primarySourceId: source.id,
      trustLevel: "EXPERT_CURATED",
      deliveryConfig: {},
    },
  });

  // Modules + LearningObjectives
  const loRefToId = new Map<string, string>();
  const moduleSlugToId = new Map<string, string>();

  for (const modDef of COURSE_CONTENT.modules) {
    const mod = await prisma.curriculumModule.upsert({
      where: { curriculumId_slug: { curriculumId: curriculum.id, slug: modDef.slug } },
      update: { title: modDef.title, description: modDef.description, sortOrder: modDef.sortOrder },
      create: {
        curriculumId: curriculum.id,
        slug: modDef.slug,
        title: modDef.title,
        description: modDef.description,
        sortOrder: modDef.sortOrder,
      },
    });
    moduleSlugToId.set(modDef.slug, mod.id);

    for (const loDef of modDef.learningObjectives) {
      const lo = await prisma.learningObjective.upsert({
        where: { moduleId_ref: { moduleId: mod.id, ref: loDef.ref } },
        update: { description: loDef.description, sortOrder: loDef.sortOrder },
        create: {
          moduleId: mod.id,
          ref: loDef.ref,
          description: loDef.description,
          sortOrder: loDef.sortOrder,
        },
      });
      loRefToId.set(loDef.ref, lo.id);
    }

    console.log(`      + Module: ${mod.title} (${modDef.learningObjectives.length} LOs)`);
  }

  // ContentAssertions (delete existing for this source, then bulk create)
  await prisma.contentAssertion.deleteMany({
    where: { sourceId: source.id },
  });

  // Build ref→assertionIds map for lesson plan binding
  const refToAssertionIds = new Map<string, string[]>();

  for (let i = 0; i < COURSE_CONTENT.assertions.length; i++) {
    const a = COURSE_CONTENT.assertions[i];
    const created = await prisma.contentAssertion.create({
      data: {
        sourceId: source.id,
        subjectSourceId: subjectSource.id,
        assertion: a.assertion,
        category: a.category,
        chapter: a.chapter,
        section: a.section,
        tags: a.tags,
        learningOutcomeRef: a.learningOutcomeRef,
        learningObjectiveId: loRefToId.get(a.learningOutcomeRef) ?? null,
        topicSlug: a.topicSlug,
        teachMethod: categoryToTeachMethod(a.category, "recall"),
        depth: 1,
        orderIndex: i,
        createdBy: "golden-seed",
      },
    });
    const existing = refToAssertionIds.get(a.learningOutcomeRef) ?? [];
    existing.push(created.id);
    refToAssertionIds.set(a.learningOutcomeRef, existing);
  }

  // Build teaching entries with assertionIds
  const teachingEntries = COURSE_CONTENT.lessonPlanEntries.map((entry) => ({
    session: entry.session,
    type: entry.type,
    label: entry.label,
    moduleId: moduleSlugToId.get(entry.moduleSlug) ?? null,
    moduleLabel: entry.moduleLabel,
    estimatedDurationMins: entry.estimatedDurationMins,
    learningOutcomeRefs: entry.learningOutcomeRefs,
    assertionIds: entry.learningOutcomeRefs.flatMap((ref) => refToAssertionIds.get(ref) ?? []),
  }));

  // Wrap teaching entries with structural + survey stops
  // (Inline instead of applyAutoIncludeStops to avoid contract DB dependency at seed time)
  const entries = [
    { session: 1, type: "pre_survey", label: "Pre-Survey", moduleId: null, moduleLabel: "", estimatedDurationMins: 2, isOptional: true },
    { session: 2, type: "onboarding", label: "First Call", moduleId: null, moduleLabel: "", isOptional: false },
    ...teachingEntries,
    { session: 0, type: "offboarding", label: "Last Call", moduleId: null, moduleLabel: "", isOptional: false },
    { session: 0, type: "post_survey", label: "Post-Survey", moduleId: null, moduleLabel: "", estimatedDurationMins: 2, isOptional: true },
  ];
  // Renumber sequentially
  entries.forEach((e, i) => { e.session = i + 1; });

  await prisma.curriculum.update({
    where: { id: curriculum.id },
    data: {
      deliveryConfig: {
        lessonPlan: {
          estimatedSessions: entries.length,
          generatedAt: new Date().toISOString(),
          generatedFrom: "golden-seed",
          entries,
        },
      },
    },
  });

  const totalAssigned = teachingEntries.reduce((sum, e) => sum + (e.assertionIds?.length ?? 0), 0);
  console.log(`      + ${COURSE_CONTENT.assertions.length} teaching points (${totalAssigned} assigned to sessions)`);
  console.log(`      + Curriculum: ${curriculum.name} (${COURSE_CONTENT.modules.length} modules, ${entries.length} stops incl. surveys)`);

  // ── Seed MCQ questions (for pre/post-test assessments) ──
  // Delete existing then create — idempotent
  await prisma.contentQuestion.deleteMany({ where: { sourceId: source.id } });

  const allAssertionIds = [...refToAssertionIds.values()].flat();
  const allAssertions = await prisma.contentAssertion.findMany({
    where: { id: { in: allAssertionIds } },
    select: { id: true, assertion: true, category: true, learningOutcomeRef: true, topicSlug: true, chapter: true, section: true, tags: true },
  });

  let mcqCount = 0;
  for (const a of allAssertions) {
    // Generate one MCQ per assertion — simple but covers the course
    const distractors = generateDistractors(a.assertion, a.category);
    const options = shuffleOptions([
      { label: "A", text: distractors.correct, isCorrect: true },
      { label: "B", text: distractors.wrong1, isCorrect: false },
      { label: "C", text: distractors.wrong2, isCorrect: false },
      { label: "D", text: distractors.wrong3, isCorrect: false },
    ]);
    // Re-label after shuffle
    options.forEach((o, i) => { o.label = String.fromCharCode(65 + i); });

    await prisma.contentQuestion.create({
      data: {
        sourceId: source.id,
        subjectSourceId: subjectSource.id,
        questionText: `Which of the following is correct about: ${a.assertion.slice(0, 80)}...?`,
        questionType: "MCQ",
        options,
        correctAnswer: options.find((o) => o.isCorrect)!.label,
        answerExplanation: a.assertion,
        assertionId: a.id,
        learningOutcomeRef: a.learningOutcomeRef,
        chapter: a.chapter,
        section: a.section,
        tags: a.tags ?? [],
        sortOrder: mcqCount,
        difficulty: 2,
        assessmentUse: mcqCount % 2 === 0 ? "PRE_TEST" : "POST_TEST",
      },
    });
    mcqCount++;
  }
  console.log(`      + ${mcqCount} MCQ questions (pre/post-test)`);
}

/** Generate plausible distractors from an assertion. Deterministic, no AI needed. */
function generateDistractors(assertion: string, category: string): { correct: string; wrong1: string; wrong2: string; wrong3: string } {
  const correct = assertion.length > 100 ? assertion.slice(0, 100) + "..." : assertion;
  // Category-aware wrong answers
  const wrongAnswers: Record<string, string[]> = {
    process: ["Skip the first step and go directly to the answer", "Use the opposite operation instead", "Apply the rule to only one side"],
    concept: ["The opposite is true in all cases", "This only applies to whole numbers", "This relationship is reversed"],
    definition: ["This term means the same as its opposite", "This is only true for negative values", "The definition excludes the most common case"],
    rule: ["The rule works in reverse order", "Exceptions are more common than the rule", "This rule was replaced by a newer method"],
    fact: ["The value is exactly double", "This only applies in special cases", "The opposite relationship holds"],
  };
  const pool = wrongAnswers[category] || wrongAnswers.fact!;
  return {
    correct,
    wrong1: pool[0],
    wrong2: pool[1],
    wrong3: pool[2],
  };
}

/** Shuffle array in place (Fisher-Yates) */
function shuffleOptions<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ══════════════════════════════════════════════════════════
// ENRICHMENT
// ══════════════════════════════════════════════════════════

interface EnrichmentStats {
  activeLearners: number;
  calls: number;
  scores: number;
  memories: number;
  personalities: number;
  goals: number;
  targets: number;
  onboarding: number;
}

async function enrichLearners(
  prisma: PrismaClient,
  learners: LearnerRecord[]
): Promise<EnrichmentStats> {
  const stats: EnrichmentStats = {
    activeLearners: 0,
    calls: 0,
    scores: 0,
    memories: 0,
    personalities: 0,
    goals: 0,
    targets: 0,
    onboarding: 0,
  };

  // Look up real parameter IDs from the DB (FK-safe)
  const allParams = await prisma.parameter.findMany({
    select: { parameterId: true },
    take: 20,
  });
  const paramIds = allParams.map((p) => p.parameterId);
  if (paramIds.length === 0) {
    console.log("    ⚠ No parameters found — skipping scores/targets enrichment");
  }

  for (let i = 0; i < learners.length; i++) {
    const learner = learners[i];

    // Everyone gets goals
    const goalCount = await createGoals(prisma, learner);
    stats.goals += goalCount;

    if (!learner.isActive) continue;

    stats.activeLearners++;

    // Active learners get the full cascade
    const callIds = await createCalls(prisma, learner, i);
    stats.calls += callIds.length;

    if (paramIds.length > 0) {
      const scoreCount = await createScores(prisma, learner.id, callIds, i, paramIds);
      stats.scores += scoreCount;
    }

    const memCount = await createMemories(prisma, learner);
    stats.memories += memCount;

    await createPersonality(prisma, learner.id, i);
    stats.personalities++;

    await createOnboarding(prisma, learner.id, learner.domainId, callIds[0]);
    stats.onboarding++;

    if (paramIds.length > 0) {
      const targetCount = await createTargets(prisma, learner.id, i, paramIds);
      stats.targets += targetCount;
    }
  }

  console.log(`    Enriched ${stats.activeLearners} active learners`);
  return stats;
}

// ── Calls ────────────────────────────────────────────────

async function createCalls(
  prisma: PrismaClient,
  learner: LearnerRecord,
  seed: number
): Promise<string[]> {
  const templates = TRANSCRIPTS[learner.typeSlug] || TRANSCRIPTS.school;
  const callCount = 3 + (seed % 3); // 3-5 calls
  const callIds: string[] = [];

  for (let c = 0; c < callCount; c++) {
    const template = templates[c % templates.length];
    const transcript = template.replace(/\{\{name\}\}/g, learner.name.split(" ")[0]);
    const daysBack = 45 - Math.floor((c / callCount) * 42); // spread over 45 days, most recent ~3 days ago

    const call = await prisma.call.create({
      data: {
        source: "golden-seed",
        externalId: `${TAG}call-${learner.externalId}-${c}`,
        callerId: learner.id,
        transcript,
        callSequence: c + 1,
        createdAt: daysAgo(daysBack),
        endedAt: daysAgo(daysBack, 25), // 25 mins after start
      },
    });
    callIds.push(call.id);
  }

  return callIds;
}

// ── Scores ───────────────────────────────────────────────

async function createScores(
  prisma: PrismaClient,
  callerId: string,
  callIds: string[],
  seed: number,
  paramIds: string[]
): Promise<number> {
  let count = 0;

  for (let c = 0; c < callIds.length; c++) {
    const paramsPerCall = Math.min(2 + (c % 2), paramIds.length); // 2-3 params per call
    const usedParams = new Set<string>();

    for (let p = 0; p < paramsPerCall; p++) {
      const paramIdx = (c * 3 + p + seed) % paramIds.length;
      const parameterId = paramIds[paramIdx];

      // Skip if already used for this call (unique constraint on callId+parameterId)
      if (usedParams.has(parameterId)) continue;
      usedParams.add(parameterId);

      const score = 0.35 + seededFloat(seed + c * 100 + p) * 0.55; // 0.35–0.90

      try {
        await prisma.callScore.create({
          data: {
            callId: callIds[c],
            callerId,
            parameterId,
            score,
            confidence: 0.6 + seededFloat(seed + c + p * 7) * 0.3, // 0.6–0.9
            evidence: [`Observed in session ${c + 1}`],
            reasoning: "Assessed from conversational indicators",
            scoredBy: "golden-seed",
          },
        });
        count++;
      } catch {
        // Skip on unique constraint violation
      }
    }
  }

  return count;
}

// ── Memories ─────────────────────────────────────────────

async function createMemories(
  prisma: PrismaClient,
  learner: LearnerRecord
): Promise<number> {
  const templates = MEMORY_TEMPLATES[learner.typeSlug] || MEMORY_TEMPLATES.school;
  let count = 0;

  for (const tmpl of templates) {
    await prisma.callerMemory.create({
      data: {
        callerId: learner.id,
        category: tmpl.category,
        source: "EXTRACTED",
        key: tmpl.key,
        value: tmpl.valueFn(learner.name.split(" ")[0]),
        confidence: 0.75 + seededFloat(count * 17) * 0.2, // 0.75–0.95
        extractedBy: "golden-seed",
      },
    });
    count++;
  }

  // Create memory summary
  const facts = templates.filter((t) => t.category === "FACT");
  const prefs = templates.filter((t) => t.category === "PREFERENCE");
  const topics = templates.filter((t) => t.category === "TOPIC");
  const firstName = learner.name.split(" ")[0];

  await prisma.callerMemorySummary.upsert({
    where: { callerId: learner.id },
    update: {},
    create: {
      callerId: learner.id,
      factCount: facts.length,
      preferenceCount: prefs.length,
      eventCount: 0,
      topicCount: topics.length,
      keyFacts: facts.map((f) => ({ key: f.key, value: f.valueFn(firstName), confidence: 0.9 })),
      topTopics: topics.map((t) => ({ topic: t.valueFn(firstName), frequency: 3, lastMentioned: new Date().toISOString() })),
      preferences: Object.fromEntries(prefs.map((p) => [p.key, p.valueFn(firstName)])),
      lastMemoryAt: new Date(),
      lastAggregatedAt: new Date(),
    },
  });

  return count;
}

// ── Personality Profile ──────────────────────────────────

async function createPersonality(
  prisma: PrismaClient,
  callerId: string,
  seed: number
): Promise<void> {
  await prisma.callerPersonalityProfile.upsert({
    where: { callerId },
    update: {},
    create: {
      callerId,
      parameterValues: {
        "B5-O": 0.5 + seededFloat(seed * 11) * 0.4,       // 0.50–0.90
        "B5-C": 0.4 + seededFloat(seed * 13) * 0.5,       // 0.40–0.90
        "B5-E": 0.3 + seededFloat(seed * 17) * 0.5,       // 0.30–0.80
        "B5-A": 0.5 + seededFloat(seed * 19) * 0.4,       // 0.50–0.90
        "B5-N": 0.15 + seededFloat(seed * 23) * 0.45,     // 0.15–0.60
        "VARK-VISUAL": 0.3 + seededFloat(seed * 29) * 0.6,
        "VARK-AUDITORY": 0.3 + seededFloat(seed * 31) * 0.6,
        "VARK-READWRITE": 0.3 + seededFloat(seed * 37) * 0.6,
        "VARK-KINESTHETIC": 0.3 + seededFloat(seed * 41) * 0.6,
      },
      callsUsed: 3 + (seed % 3),
      specsUsed: 2,
      lastUpdatedAt: new Date(),
    },
  });
}

// ── Goals ────────────────────────────────────────────────

async function createGoals(
  prisma: PrismaClient,
  learner: LearnerRecord
): Promise<number> {
  const templates = GOAL_TEMPLATES[learner.typeSlug] || GOAL_TEMPLATES.school;
  let count = 0;

  for (let g = 0; g < templates.length; g++) {
    const tmpl = templates[g];
    const progress = learner.isActive
      ? 0.2 + seededFloat(g * 7 + learner.id.charCodeAt(0)) * 0.6 // 0.20–0.80 for active
      : 0; // 0 for new learners

    await prisma.goal.create({
      data: {
        callerId: learner.id,
        type: "LEARN",
        name: tmpl.name,
        description: tmpl.description,
        status: progress >= 0.75 ? "COMPLETED" : "ACTIVE",
        progress,
        priority: g + 1,
        playbookId: learner.playbookIds[g % learner.playbookIds.length] || undefined,
        startedAt: daysAgo(60),
        targetDate: daysFromNow(120),
      },
    });
    count++;
  }

  return count;
}

// ── Onboarding Session ───────────────────────────────────

async function createOnboarding(
  prisma: PrismaClient,
  callerId: string,
  domainId: string,
  firstCallId: string
): Promise<void> {
  await prisma.onboardingSession.upsert({
    where: { callerId_domainId: { callerId, domainId } },
    update: {},
    create: {
      callerId,
      domainId,
      currentPhase: "summary",
      // Schema expects Array of {phase, completedAt, duration}
      completedPhases: DEFAULT_FLOW_PHASES.map((p, i) => ({
        phase: p.phase,
        completedAt: daysAgo(45 - i * 4).toISOString(),
        duration: 180 + i * 30, // seconds
      })),
      isComplete: true,
      wasSkipped: false,
      firstCallId: firstCallId,
      discoveredGoals: 2,
      completedAt: daysAgo(40),
    },
  });
}

// ── Caller Targets ───────────────────────────────────────

async function createTargets(
  prisma: PrismaClient,
  callerId: string,
  seed: number,
  paramIds: string[]
): Promise<number> {
  // Pick up to 3 real parameter IDs for this caller's targets
  const targetCount = Math.min(3, paramIds.length);
  let count = 0;

  for (let t = 0; t < targetCount; t++) {
    const paramIdx = (seed * 7 + t * 13) % paramIds.length;
    const parameterId = paramIds[paramIdx];

    try {
      await prisma.callerTarget.create({
        data: {
          callerId,
          parameterId,
          targetValue: 0.6 + seededFloat(seed * 43 + t) * 0.25, // 0.60–0.85
          callsUsed: 2 + (seed % 3),
          confidence: 0.5 + seededFloat(seed * 47 + t) * 0.4, // 0.50–0.90
          decayHalfLife: 7.0,
          lastUpdatedAt: daysAgo(5),
        },
      });
      count++;
    } catch {
      // Skip on unique constraint violation
    }
  }

  return count;
}

// ══════════════════════════════════════════════════════════
// CLEANUP
// ══════════════════════════════════════════════════════════

async function cleanup(prisma: PrismaClient): Promise<void> {
  // Nuclear cleanup: wipe ALL entity data for golden profile.
  // FK-safe order: leaf tables first, then parents.

  const tables = [
    // Enrichment leaf tables (depend on Call or Caller)
    "callScore",
    "callTarget",
    "behaviorMeasurement",
    "rewardScore",
    "personalityObservation",
    "callerTarget",
    "callerMemorySummary",
    "callerMemory",
    "callerPersonalityProfile",
    "conversationArtifact",
    "callAction",
    "callMessage",
    // onboardingSession BEFORE call — firstCallId → Call.id has no onDelete (RESTRICT)
    "onboardingSession",
    "call",
    // Enrollment and cohort join tables
    "callerPlaybook",
    "cohortPlaybook",
    "goal",
    // Content tables
    "invite",
    "channelConfig",
    "subjectSource",
    "contentVocabulary",
    "contentQuestion",
    "contentAssertion",
    "contentSource",
    // Curriculum tables (Curriculum.subjectId has onDelete: SetNull — won't cascade)
    "learningObjective",
    "callerModuleProgress",
    "curriculumModule",
    "curriculum",
    // Playbook-subject links
    "playbookSubject",
    // Subject + domain links
    "subjectDomain",
    "subject",
    "mediaAsset",
    "userTask",
    "callerPersonality",
  ];

  for (const table of tables) {
    try {
      // @ts-ignore — dynamic table access
      const count = await prisma[table].count();
      if (count > 0) {
        // @ts-ignore
        await prisma[table].deleteMany();
      }
    } catch {
      // Table might not exist in this schema version
    }
  }

  // Delete multi-cohort memberships before disconnecting legacy FK
  await prisma.callerCohortMembership.deleteMany();

  // Disconnect callers from cohort groups before deleting cohorts
  await prisma.caller.updateMany({
    where: { cohortGroupId: { not: null } },
    data: { cohortGroupId: null },
  });

  // Delete all cohort groups
  await prisma.cohortGroup.deleteMany();

  // Clear Call.usedPromptId → ComposedPrompt before deleting composed prompts
  // (circular: ComposedPrompt.callerId → Caller, Call.usedPromptId → ComposedPrompt)
  await prisma.call.updateMany({ where: { usedPromptId: { not: null } }, data: { usedPromptId: null } });
  await prisma.composedPrompt.deleteMany();

  // Delete all callers (seed-clean may have missed some)
  await prisma.caller.deleteMany();

  // Delete all playbook items, then playbooks, then groups
  await prisma.playbookItem.deleteMany();
  await prisma.playbook.deleteMany();
  try { await prisma.playbookGroup.deleteMany(); } catch { /* table may not exist yet */ }

  // Delete domain-scoped identity specs (DOMAIN type)
  await prisma.analysisSpec.deleteMany({
    where: { specType: "DOMAIN" },
  });

  // Delete all domains
  await prisma.domain.deleteMany();

  // Delete non-admin users BEFORE institutions — User.institutionId → Institution.id
  // has no onDelete, so deleting institutions while users reference them would fail.
  await prisma.user.deleteMany({
    where: { role: { not: "SUPERADMIN" } },
  });

  // Clear institutionId on any remaining SUPERADMIN users so institution delete succeeds
  await prisma.user.updateMany({
    where: { institutionId: { not: null } },
    data: { institutionId: null },
  });

  // Delete all institutions
  await prisma.institution.deleteMany();

  console.log("  🧹 Cleaned all entity data (keeping specs + admin users)\n");
}

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Deterministic float 0.0–1.0 from an integer seed */
function seededFloat(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

/** Date N days ago */
function daysAgo(days: number, extraMinutes = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  if (extraMinutes) d.setMinutes(d.getMinutes() + extraMinutes);
  return d;
}

/** Date N days from now */
function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

// Direct execution
if (require.main === module) {
  main().catch((e) => {
    console.error("Golden seed failed:", e);
    process.exit(1);
  });
}
