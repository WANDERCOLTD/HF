/**
 * Seed Holographic Demo — Two fully fleshed-out school domains
 *
 * Creates two domains so the Holographic editor has multiple entries
 * to choose from, both with every section populated:
 *
 *   1. Aldermoor College       (A — appears first in domain picker)
 *   2. Greenfield Academy      (G — appears second)
 *
 * Each domain populates all 8 Holographic sections:
 *   Identity, Curriculum, Behavior, Onboarding, Channels,
 *   Readiness, Structure, Prompt Preview
 *
 * Idempotent: tagged with "holo-demo" source markers, cleanup-first.
 *
 * Usage:
 *   npx tsx prisma/seed-holographic-demo.ts
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

let prisma: PrismaClient;

const TAG = "holo-demo";

// ══════════════════════════════════════════════════════════
// DOMAIN CONFIGS
// ══════════════════════════════════════════════════════════

interface DomainConfig {
  slug: string;
  name: string;
  description: string;
  institutionSlug: string;
  institutionName: string;
  institutionColors: [string, string];
  institutionWelcome: string;
  onboardingWelcome: string;
  onboardingFlowPhases: { phases: Array<{ phase: string; duration: string; goals: string[] }> };
  onboardingDefaultTargets: Record<string, any>;
  subjects: Array<{ slug: string; name: string; description: string; qualificationBody: string; qualificationLevel: string }>;
  sources: Array<{ slug: string; name: string; description: string; trustLevel: string; documentType: string; publisherOrg: string; subjectSlug: string }>;
  assertions: Record<string, Array<{ assertion: string; category: string; tags: string[] }>>;
  channels: Array<{ channelType: string; isEnabled: boolean; priority: number }>;
  teachers: Array<{ firstName: string; lastName: string; email: string; role: "ADMIN" | "EDUCATOR"; className: string | null }>;
  cohorts: Array<{ name: string; teacherEmail: string; pupilCount: number }>;
  pupils: string[];
  playbookName: string;
  playbookDescription: string;
  playbookConfig: Record<string, any>;
}

// ── Aldermoor College (A-Level STEM) ─────────────────────

const ALDERMOOR: DomainConfig = {
  slug: "aldermoor-college",
  name: "Aldermoor College",
  description:
    "Sixth form college in Bristol specialising in STEM subjects. A-Level Mathematics and Computer Science with AI-assisted exam preparation for Years 12-13.",
  institutionSlug: "aldermoor-college",
  institutionName: "Aldermoor College",
  institutionColors: ["#2563eb", "#3b82f6"],
  institutionWelcome: "Welcome to Aldermoor College — excellence through inquiry.",

  onboardingWelcome:
    "Hi there! I'm your AI study partner for A-Level Maths and Computer Science. I'll challenge you with problems, explain tricky concepts, and help you build exam-ready confidence. Let's get started.",
  onboardingFlowPhases: {
    phases: [
      {
        phase: "welcome",
        duration: "1-2 minutes",
        goals: [
          "Introduce yourself as a rigorous but supportive study partner",
          "Emphasise that getting stuck is part of learning STEM",
          "Set the tone: precision matters, but so does curiosity",
        ],
      },
      {
        phase: "diagnostic",
        duration: "5 minutes",
        goals: [
          "Ask which A-Level modules they're covering this term",
          "Identify topics they feel confident vs uncertain about",
          "Probe for study habits — do they prefer worked examples or problem sets?",
          "Check if any exams or coursework deadlines are upcoming",
        ],
      },
      {
        phase: "challenge",
        duration: "12-15 minutes",
        goals: [
          "Present a scaffolded problem in their chosen topic",
          "Let them attempt before hinting — resist giving the answer early",
          "Model step-by-step reasoning when they're stuck",
          "Increase difficulty if they solve quickly",
        ],
      },
      {
        phase: "review",
        duration: "2-3 minutes",
        goals: [
          "Highlight what they solved well and where they hesitated",
          "Recommend one specific technique to practise before next session",
          "Preview what you'll tackle next time",
        ],
      },
    ],
  },
  onboardingDefaultTargets: {
    "BEH-WARMTH": { value: 0.5, confidence: 0.6 },
    "BEH-FORMALITY": { value: 0.8, confidence: 0.6 },
    "BEH-DIRECTNESS": { value: 0.7, confidence: 0.6 },
    "BEH-CHALLENGE-LEVEL": { value: 0.8, confidence: 0.6 },
    _matrixPositions: {
      "communication-style": { x: 0.5, y: 0.8 },
      "teaching-approach": { x: 0.7, y: 0.8 },
    },
  },

  subjects: [
    {
      slug: `${TAG}-maths`,
      name: "Mathematics",
      description:
        "A-Level Mathematics: Pure maths (algebra, calculus, trigonometry), statistics, and mechanics. Problem-solving and mathematical proof.",
      qualificationBody: "Edexcel / OCR",
      qualificationLevel: "A-Level",
    },
    {
      slug: `${TAG}-compsci`,
      name: "Computer Science",
      description:
        "A-Level Computer Science: Programming fundamentals, data structures, algorithms, databases, and computational thinking.",
      qualificationBody: "OCR",
      qualificationLevel: "A-Level",
    },
  ],

  sources: [
    {
      slug: `${TAG}-maths-spec`,
      name: "A-Level Mathematics Specification",
      description:
        "Edexcel A-Level Pure Mathematics, Statistics, and Mechanics specification with topic weighting and assessment objectives.",
      trustLevel: "ACCREDITED_MATERIAL",
      documentType: "CURRICULUM",
      publisherOrg: "Edexcel",
      subjectSlug: `${TAG}-maths`,
    },
    {
      slug: `${TAG}-maths-textbook`,
      name: "Pure Mathematics: Year 2 Revision Guide",
      description:
        "Worked examples and exam-style questions for differentiation, integration, sequences, and trigonometric identities.",
      trustLevel: "PUBLISHED_REFERENCE",
      documentType: "TEXTBOOK",
      publisherOrg: "Pearson",
      subjectSlug: `${TAG}-maths`,
    },
    {
      slug: `${TAG}-cs-spec`,
      name: "A-Level Computer Science Specification",
      description:
        "OCR A-Level CS specification: programming, data structures, algorithms, hardware, software, and theory of computation.",
      trustLevel: "ACCREDITED_MATERIAL",
      documentType: "CURRICULUM",
      publisherOrg: "OCR",
      subjectSlug: `${TAG}-compsci`,
    },
    {
      slug: `${TAG}-cs-projects`,
      name: "Algorithmic Problem-Solving Workbook",
      description:
        "Collection of algorithm challenges covering sorting, searching, graph traversal, recursion, and dynamic programming.",
      trustLevel: "PUBLISHED_REFERENCE",
      documentType: "TEXTBOOK",
      publisherOrg: "Cambridge University Press",
      subjectSlug: `${TAG}-compsci`,
    },
  ],

  assertions: {
    [`${TAG}-maths-spec`]: [
      { assertion: "The derivative of sin(x) is cos(x), and the derivative of cos(x) is -sin(x)", category: "fact", tags: ["calculus", "trigonometry"] },
      { assertion: "Integration by parts: ∫u dv = uv - ∫v du, used when the integrand is a product of two functions", category: "rule", tags: ["calculus", "integration"] },
      { assertion: "The binomial expansion of (1+x)^n for |x|<1 uses the formula: 1 + nx + n(n-1)x²/2! + ...", category: "fact", tags: ["algebra", "series"] },
      { assertion: "A geometric series converges if and only if the common ratio r satisfies |r| < 1, with sum a/(1-r)", category: "fact", tags: ["sequences", "series"] },
      { assertion: "Students must show clear logical steps in proof questions — a correct answer without working scores zero", category: "rule", tags: ["exam-technique", "proof"] },
    ],
    [`${TAG}-maths-textbook`]: [
      { assertion: "The chain rule: d/dx[f(g(x))] = f'(g(x)) · g'(x) — decompose complex functions into nested layers", category: "rule", tags: ["calculus", "differentiation"] },
      { assertion: "Partial fractions decompose rational expressions for easier integration: A/(x-a) + B/(x-b)", category: "rule", tags: ["algebra", "integration"] },
      { assertion: "Parametric equations express x and y in terms of parameter t; eliminate t to find the Cartesian equation", category: "definition", tags: ["coordinate-geometry", "parametric"] },
      { assertion: "The trapezium rule approximates ∫f(x)dx using h/2[y₀ + 2(y₁+...+yₙ₋₁) + yₙ] where h = (b-a)/n", category: "fact", tags: ["numerical-methods", "integration"] },
      { assertion: "For hypothesis testing, if the test statistic falls in the critical region, reject H₀ at the given significance level", category: "rule", tags: ["statistics", "hypothesis-testing"] },
    ],
    [`${TAG}-cs-spec`]: [
      { assertion: "Big-O notation describes worst-case time complexity: O(1) constant, O(n) linear, O(n²) quadratic, O(log n) logarithmic", category: "fact", tags: ["algorithms", "complexity"] },
      { assertion: "A binary search tree maintains the invariant: left child < parent < right child for all nodes", category: "definition", tags: ["data-structures", "trees"] },
      { assertion: "Normalisation (1NF → 2NF → 3NF) reduces data redundancy by eliminating partial and transitive dependencies", category: "rule", tags: ["databases", "normalisation"] },
      { assertion: "TCP provides reliable, ordered delivery with error checking; UDP provides faster, connectionless communication without guarantees", category: "fact", tags: ["networking", "protocols"] },
      { assertion: "The fetch-decode-execute cycle: fetch instruction from RAM → decode opcode → execute via ALU/registers → store result", category: "fact", tags: ["hardware", "cpu"] },
    ],
    [`${TAG}-cs-projects`]: [
      { assertion: "Dijkstra's algorithm finds the shortest path in a weighted graph using a priority queue and greedy selection", category: "fact", tags: ["algorithms", "graphs"] },
      { assertion: "Merge sort divides the list recursively, sorts sublists, and merges them — O(n log n) worst case, stable", category: "fact", tags: ["algorithms", "sorting"] },
      { assertion: "Dynamic programming stores solutions to overlapping subproblems to avoid redundant computation (memoisation or tabulation)", category: "definition", tags: ["algorithms", "dynamic-programming"] },
      { assertion: "A hash table provides O(1) average-case lookup by mapping keys to indices via a hash function; collisions handled by chaining or probing", category: "fact", tags: ["data-structures", "hashing"] },
      { assertion: "Recursion requires a base case to terminate and a recursive case that reduces the problem size with each call", category: "rule", tags: ["programming", "recursion"] },
    ],
  },

  channels: [
    { channelType: "sim", isEnabled: true, priority: 0 },
    { channelType: "whatsapp", isEnabled: false, priority: 1 },
    { channelType: "sms", isEnabled: false, priority: 2 },
  ],

  teachers: [
    { firstName: "James", lastName: "Hartley", email: `${TAG}-j.hartley@aldermoor.ac.uk`, role: "ADMIN", className: null },
    { firstName: "Priya", lastName: "Nair", email: `${TAG}-p.nair@aldermoor.ac.uk`, role: "EDUCATOR", className: "12A Maths" },
    { firstName: "Tom", lastName: "Beckett", email: `${TAG}-t.beckett@aldermoor.ac.uk`, role: "EDUCATOR", className: "12B CompSci" },
  ],

  cohorts: [
    { name: "12A Pure Mathematics", teacherEmail: `${TAG}-p.nair@aldermoor.ac.uk`, pupilCount: 10 },
    { name: "12B Computer Science", teacherEmail: `${TAG}-t.beckett@aldermoor.ac.uk`, pupilCount: 10 },
    { name: "13 Exam Prep", teacherEmail: `${TAG}-j.hartley@aldermoor.ac.uk`, pupilCount: 5 },
  ],

  pupils: [
    "Aisha Rahman", "Ben Carter", "Charlotte Liu", "David Okonkwo", "Elena Petrova",
    "Felix Andersson", "Grace Kim", "Harry Singh", "Isabelle Martin", "Jack Thompson",
    "Kira Watanabe", "Liam O'Sullivan", "Mia Jensen", "Nathan Cross", "Olivia Barnes",
    "Patrick Zhao", "Quinn Reeves", "Rosa Alvarez", "Sam Holloway", "Tara Begum",
    "Uma Desai", "Victor Ruiz", "Wren Taylor", "Xander Frost", "Yuki Tanaka",
  ],

  playbookName: "Aldermoor A-Level STEM Programme",
  playbookDescription:
    "A-Level Mathematics and Computer Science — rigorous problem-solving with scaffolded AI support for Years 12-13.",
  playbookConfig: {
    teachingMode: "Directive",
    subjectDiscipline: "mathematics",
  },
};

// ── Greenfield Academy (GCSE Humanities) ─────────────────

const GREENFIELD: DomainConfig = {
  slug: "greenfield-academy",
  name: "Greenfield Academy",
  description:
    "Mixed comprehensive secondary school in Hertfordshire. GCSE History and English Language with AI-assisted tutoring for Years 10-11.",
  institutionSlug: "greenfield-academy",
  institutionName: "Greenfield Academy",
  institutionColors: ["#16a34a", "#22c55e"],
  institutionWelcome: "Welcome to Greenfield Academy — where every learner thrives.",

  onboardingWelcome:
    "Welcome to Greenfield Academy! I'm your personal AI tutor. We'll be working on your GCSE subjects together — think of me as a study partner who's always ready to help, whether it's unpicking a Tudor source or crafting the perfect essay paragraph.",
  onboardingFlowPhases: {
    phases: [
      {
        phase: "welcome",
        duration: "2 minutes",
        goals: [
          "Greet the student warmly and introduce yourself as their AI tutor",
          "Explain that sessions are conversational — not a test",
          "Set expectations: we'll explore topics together at their pace",
        ],
      },
      {
        phase: "discovery",
        duration: "3-4 minutes",
        goals: [
          "Ask which GCSE subjects they're studying with us (History / English)",
          "Find out which topics they find interesting vs challenging",
          "Learn about upcoming exams or coursework deadlines",
          "Discover their preferred study style (examples, practice questions, discussion)",
        ],
      },
      {
        phase: "first-topic",
        duration: "10-15 minutes",
        goals: [
          "Choose a starter topic based on their preference or upcoming assessment",
          "Work through 2-3 questions or analysis tasks together",
          "Model good exam technique (PEE paragraphs, source evaluation, language analysis)",
          "Scaffold rather than give answers — ask leading questions",
        ],
      },
      {
        phase: "wrap-up",
        duration: "2 minutes",
        goals: [
          "Summarise what they practised and what they did well",
          "Identify one area to focus on next session",
          "End with encouragement about their GCSE preparation",
        ],
      },
    ],
  },
  onboardingDefaultTargets: {
    "BEH-WARMTH": { value: 0.8, confidence: 0.5 },
    "BEH-FORMALITY": { value: 0.7, confidence: 0.5 },
    "BEH-DIRECTNESS": { value: 0.2, confidence: 0.5 },
    "BEH-CHALLENGE-LEVEL": { value: 0.3, confidence: 0.5 },
    _matrixPositions: {
      "communication-style": { x: 0.8, y: 0.7 },
      "teaching-approach": { x: 0.2, y: 0.3 },
    },
  },

  subjects: [
    {
      slug: `${TAG}-history`,
      name: "History",
      description:
        "GCSE History: The Tudors, Victorian Britain, and World War II. Source analysis, chronological understanding, and historical interpretation.",
      qualificationBody: "AQA / Edexcel",
      qualificationLevel: "GCSE",
    },
    {
      slug: `${TAG}-english`,
      name: "English Language",
      description:
        "GCSE English Language: Reading comprehension, creative writing, spoken language, and analytical response.",
      qualificationBody: "AQA",
      qualificationLevel: "GCSE",
    },
  ],

  sources: [
    {
      slug: `${TAG}-history-syllabus`,
      name: "GCSE History: Tudors & Victorians Syllabus",
      description:
        "AQA-aligned syllabus covering Tudor monarchy, Victorian social reform, and primary source analysis.",
      trustLevel: "ACCREDITED_MATERIAL",
      documentType: "CURRICULUM",
      publisherOrg: "AQA",
      subjectSlug: `${TAG}-history`,
    },
    {
      slug: `${TAG}-history-textbook`,
      name: "History in Focus: KS4 Revision Guide",
      description:
        "Chapter summaries, timelines, and practice questions covering the Tudors and Victorian Britain.",
      trustLevel: "PUBLISHED_REFERENCE",
      documentType: "TEXTBOOK",
      publisherOrg: "CGP Books",
      subjectSlug: `${TAG}-history`,
    },
    {
      slug: `${TAG}-english-syllabus`,
      name: "GCSE English Language Specification",
      description:
        "AQA English Language specification: Paper 1 (creative reading/writing), Paper 2 (viewpoints/perspectives).",
      trustLevel: "ACCREDITED_MATERIAL",
      documentType: "CURRICULUM",
      publisherOrg: "AQA",
      subjectSlug: `${TAG}-english`,
    },
    {
      slug: `${TAG}-english-anthology`,
      name: "Modern Short Stories Anthology",
      description:
        "Collection of 20th-century short stories for close reading practice, inference, and language analysis.",
      trustLevel: "PUBLISHED_REFERENCE",
      documentType: "READING_PASSAGE",
      publisherOrg: "Penguin Classics",
      subjectSlug: `${TAG}-english`,
    },
  ],

  assertions: {
    [`${TAG}-history-syllabus`]: [
      { assertion: "Henry VIII broke with Rome in 1534 to annul his marriage to Catherine of Aragon, establishing the Church of England", category: "fact", tags: ["tudor", "reformation"] },
      { assertion: "The Dissolution of the Monasteries (1536-1541) transferred vast Church wealth to the Crown and gentry", category: "fact", tags: ["tudor", "monasteries"] },
      { assertion: "Elizabeth I's reign (1558-1603) is known as the Elizabethan Golden Age for cultural and maritime achievements", category: "fact", tags: ["tudor", "elizabethan"] },
      { assertion: "The Spanish Armada of 1588 was defeated by a combination of English naval tactics and severe weather", category: "fact", tags: ["tudor", "armada"] },
      { assertion: "Students should evaluate the reliability of primary sources by considering provenance, purpose, and context", category: "rule", tags: ["skills", "source-analysis"] },
      { assertion: "The Factory Act of 1833 banned employment of children under 9 in textile factories and limited working hours for older children", category: "fact", tags: ["victorian", "reform"] },
    ],
    [`${TAG}-history-textbook`]: [
      { assertion: "The Great Exhibition of 1851 showcased British industrial innovation and attracted over 6 million visitors", category: "fact", tags: ["victorian", "industry"] },
      { assertion: "The Public Health Act of 1875 required local authorities to provide clean water, sewers, and street lighting", category: "fact", tags: ["victorian", "health"] },
      { assertion: "Queen Victoria reigned from 1837 to 1901, making hers the longest reign in British history at that time", category: "fact", tags: ["victorian", "monarchy"] },
      { assertion: "Chronological understanding requires ordering events accurately and explaining cause-and-consequence chains", category: "rule", tags: ["skills", "chronology"] },
      { assertion: "A strong historical argument uses specific evidence, considers alternative interpretations, and reaches a supported conclusion", category: "rule", tags: ["skills", "argument"] },
      { assertion: "Comparing first-hand accounts (diaries, letters) with official records reveals biases and gaps in the historical record", category: "rule", tags: ["skills", "source-analysis"] },
    ],
    [`${TAG}-english-syllabus`]: [
      { assertion: "Paper 1, Question 2 requires identification and analysis of language features with effect on the reader", category: "rule", tags: ["paper1", "language-analysis"] },
      { assertion: "Students should use subject terminology accurately: metaphor, simile, personification, pathetic fallacy, sibilance", category: "rule", tags: ["terminology", "literary-devices"] },
      { assertion: "A thesis statement in analytical writing establishes the writer's argument before supporting paragraphs develop it", category: "rule", tags: ["writing", "structure"] },
      { assertion: "Paper 2, Question 5 assesses writing to present a viewpoint using rhetorical devices: tricolon, anaphora, direct address", category: "rule", tags: ["paper2", "rhetoric"] },
      { assertion: "Close reading requires annotating structural choices (sentence length, paragraph breaks, shifts in tone) not just language", category: "rule", tags: ["skills", "close-reading"] },
    ],
    [`${TAG}-english-anthology`]: [
      { assertion: "Writers use short sentences for impact, long sentences for description, and fragments for emphasis or shock", category: "rule", tags: ["writing", "sentence-craft"] },
      { assertion: "Inference questions require 'reading between the lines' — deducing feelings, motivations, or atmosphere from implicit clues", category: "definition", tags: ["skills", "inference"] },
      { assertion: "A well-structured creative writing response uses a clear narrative arc: exposition, rising action, climax, resolution", category: "rule", tags: ["writing", "narrative"] },
      { assertion: "Evaluative responses must weigh the effectiveness of authorial choices, not simply list techniques identified", category: "rule", tags: ["skills", "evaluation"] },
      { assertion: "Ambitious vocabulary should feel natural — forced or inappropriate word choices undermine rather than enhance writing quality", category: "rule", tags: ["writing", "vocabulary"] },
    ],
  },

  channels: [
    { channelType: "sim", isEnabled: true, priority: 0 },
    { channelType: "whatsapp", isEnabled: true, priority: 1 },
    { channelType: "sms", isEnabled: false, priority: 2 },
  ],

  teachers: [
    { firstName: "Helen", lastName: "Whitmore", email: `${TAG}-h.whitmore@greenfield.sch.uk`, role: "ADMIN", className: null },
    { firstName: "Marcus", lastName: "Osei", email: `${TAG}-m.osei@greenfield.sch.uk`, role: "EDUCATOR", className: "10A History" },
    { firstName: "Laura", lastName: "Brennan", email: `${TAG}-l.brennan@greenfield.sch.uk`, role: "EDUCATOR", className: "10B English" },
  ],

  cohorts: [
    { name: "10A History", teacherEmail: `${TAG}-m.osei@greenfield.sch.uk`, pupilCount: 12 },
    { name: "10B English", teacherEmail: `${TAG}-l.brennan@greenfield.sch.uk`, pupilCount: 12 },
    { name: "11 Revision", teacherEmail: `${TAG}-h.whitmore@greenfield.sch.uk`, pupilCount: 6 },
  ],

  pupils: [
    "Amira Hussain", "Jake Fletcher", "Priya Kapoor", "Callum Wright", "Sofia Rodriguez",
    "Ethan Nakamura", "Maisie O'Brien", "Ravi Patel", "Chloe Davies", "Omar Bensalem",
    "Freya Lindström", "Leo Chen", "Isla Campbell", "Ryan Murphy", "Hannah Kowalski",
    "Noah Williams", "Daisy Grant", "Kai Zhang", "Amber Singh", "Tyler Brooks",
    "Eva Fernandez", "Lucas Green", "Ruby Clarke", "Daniel Okonkwo", "Scarlett Murray",
    "Finn McCarthy", "Layla Noor", "George Mitchell", "Bethany Stone", "Archie West",
  ],

  playbookName: "Greenfield Academy GCSE Programme",
  playbookDescription:
    "GCSE History and English Language — AI-assisted revision and exam technique practice for Years 10-11.",
  playbookConfig: {
    teachingMode: "Socratic",
    subjectDiscipline: "history",
  },
};

const ALL_DOMAINS: DomainConfig[] = [ALDERMOOR, GREENFIELD];

// ══════════════════════════════════════════════════════════
// CLEANUP
// ══════════════════════════════════════════════════════════

async function cleanup() {
  console.log("  Cleaning up previous holo-demo data...");

  for (const cfg of ALL_DOMAINS) {
    const domain = await prisma.domain.findUnique({
      where: { slug: cfg.slug },
      select: { id: true },
    });

    if (!domain) continue;

    const domainId = domain.id;

    // FK-safe order (leaves → roots)
    await prisma.callerPlaybook.deleteMany({ where: { caller: { domainId } } });
    await prisma.cohortPlaybook.deleteMany({ where: { cohortGroup: { domainId } } });
    await prisma.callerCohortMembership.deleteMany({ where: { caller: { domainId } } });
    await prisma.callScore.deleteMany({ where: { caller: { domainId } } });
    await prisma.callerMemory.deleteMany({ where: { caller: { domainId } } });
    await prisma.call.deleteMany({ where: { caller: { domainId } } });
    await prisma.caller.deleteMany({ where: { domainId } });
    await prisma.cohortGroup.deleteMany({ where: { domainId } });
    await prisma.channelConfig.deleteMany({ where: { domainId } });
    await prisma.playbookItem.deleteMany({ where: { playbook: { domainId } } });
    await prisma.playbookSubject.deleteMany({ where: { playbook: { domainId } } });
    await prisma.playbook.deleteMany({ where: { domainId } });
    await prisma.subjectDomain.deleteMany({ where: { domainId } });
    await prisma.domain.delete({ where: { id: domainId } });

    console.log(`    Removed domain: ${cfg.name}`);
  }

  // Shared cleanup (tag-scoped)
  await prisma.contentAssertion.deleteMany({ where: { createdBy: TAG } });
  await prisma.subjectSource.deleteMany({
    where: { source: { slug: { startsWith: `${TAG}-` } } },
  });
  await prisma.contentSource.deleteMany({ where: { slug: { startsWith: `${TAG}-` } } });
  await prisma.subject.deleteMany({ where: { slug: { startsWith: `${TAG}-` } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: `${TAG}-` } } });

  // Clean up institutions (only our tagged ones)
  for (const cfg of ALL_DOMAINS) {
    await prisma.institution.deleteMany({ where: { slug: cfg.institutionSlug } });
  }

  console.log("    Cleanup complete.");
}

// ══════════════════════════════════════════════════════════
// INSTITUTION
// ══════════════════════════════════════════════════════════

async function ensureInstitution(cfg: DomainConfig): Promise<string> {
  // Ensure "School" institution type exists (shared across domains)
  let instType = await prisma.institutionType.findUnique({
    where: { slug: "school" },
  });

  if (!instType) {
    instType = await prisma.institutionType.create({
      data: {
        slug: "school",
        name: "School",
        description: "Primary or secondary school",
        terminology: {
          domain: "School",
          playbook: "Subject",
          spec: "Content",
          caller: "Student",
          cohort: "Class",
          instructor: "Teacher",
          session: "Lesson",
          session_short: "Lesson",
          persona: "Teaching Style",
          supervisor: "My Teacher",
          mentor: "Teacher",
          teach_action: "Teach",
          learning_noun: "Learning",
          group: "Department",
        },
        defaultArchetypeSlug: "TUT-001",
      },
    });
  }

  // Create institution for this domain
  const institution = await prisma.institution.create({
    data: {
      slug: cfg.institutionSlug,
      name: cfg.institutionName,
      primaryColor: cfg.institutionColors[0],
      secondaryColor: cfg.institutionColors[1],
      welcomeMessage: cfg.institutionWelcome,
      typeId: instType.id,
    },
  });

  console.log(`    Institution: ${cfg.institutionName}`);
  return institution.id;
}

// ══════════════════════════════════════════════════════════
// SUBJECTS + CONTENT
// ══════════════════════════════════════════════════════════

async function createSubjects(
  cfg: DomainConfig,
  domainId: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  for (const s of cfg.subjects) {
    const subject = await prisma.subject.create({
      data: {
        slug: s.slug,
        name: s.name,
        description: s.description,
        qualificationBody: s.qualificationBody,
        qualificationLevel: s.qualificationLevel,
        defaultTrustLevel: "EXPERT_CURATED",
        isActive: true,
      },
    });
    map.set(s.slug, subject.id);

    await prisma.subjectDomain.create({
      data: { subjectId: subject.id, domainId },
    });

    console.log(`    Subject: ${s.name}`);
  }

  return map;
}

async function createSources(
  cfg: DomainConfig,
  subjectMap: Map<string, string>,
): Promise<Map<string, string>> {
  const sourceMap = new Map<string, string>();

  for (const s of cfg.sources) {
    const source = await prisma.contentSource.create({
      data: {
        slug: s.slug,
        name: s.name,
        description: s.description,
        trustLevel: s.trustLevel,
        documentType: s.documentType,
        documentTypeSource: TAG,
        publisherOrg: s.publisherOrg,
        isActive: true,
      },
    });
    sourceMap.set(s.slug, source.id);

    const subjectId = subjectMap.get(s.subjectSlug)!;
    await prisma.subjectSource.create({
      data: { subjectId, sourceId: source.id },
    });

    console.log(`    Source: ${s.name}`);
  }

  return sourceMap;
}

async function createAssertions(
  cfg: DomainConfig,
  sourceMap: Map<string, string>,
): Promise<number> {
  const batch: Array<{
    sourceId: string;
    assertion: string;
    category: string;
    tags: string[];
    createdBy: string;
  }> = [];

  for (const [sourceSlug, assertions] of Object.entries(cfg.assertions)) {
    const sourceId = sourceMap.get(sourceSlug)!;
    for (const a of assertions) {
      batch.push({
        sourceId,
        assertion: a.assertion,
        category: a.category,
        tags: a.tags,
        createdBy: TAG,
      });
    }
  }

  await prisma.contentAssertion.createMany({ data: batch });
  console.log(`    Assertions: ${batch.length}`);
  return batch.length;
}

// ══════════════════════════════════════════════════════════
// DOMAIN + PLAYBOOK + STRUCTURE
// ══════════════════════════════════════════════════════════

async function createDomain(
  cfg: DomainConfig,
  institutionId: string,
): Promise<string> {
  const domain = await prisma.domain.create({
    data: {
      slug: cfg.slug,
      name: cfg.name,
      description: cfg.description,
      isActive: true,
      institutionId,
      onboardingWelcome: cfg.onboardingWelcome,
      onboardingFlowPhases: cfg.onboardingFlowPhases,
      onboardingDefaultTargets: cfg.onboardingDefaultTargets,
    },
  });

  console.log(`    Domain: ${domain.name} (${domain.id})`);
  return domain.id;
}

async function createPlaybook(
  cfg: DomainConfig,
  domainId: string,
  subjectMap: Map<string, string>,
): Promise<string> {
  // Find system specs to enable
  const systemSpecs = await prisma.analysisSpec.findMany({
    where: { specType: "SYSTEM", isActive: true },
    select: { id: true },
  });
  const systemSpecToggles: Record<string, { isEnabled: boolean }> = {};
  for (const ss of systemSpecs) {
    systemSpecToggles[ss.id] = { isEnabled: true };
  }

  const playbook = await prisma.playbook.create({
    data: {
      name: cfg.playbookName,
      description: cfg.playbookDescription,
      domainId,
      status: "PUBLISHED",
      version: "1.0",
      publishedAt: new Date(),
      publishedBy: TAG,
      config: {
        systemSpecToggles,
        ...cfg.playbookConfig,
      },
      measureSpecCount: 2,
      learnSpecCount: 1,
      adaptSpecCount: 1,
      parameterCount: 8,
    },
  });

  // Link identity spec to playbook
  const identitySpec = await prisma.analysisSpec.findFirst({
    where: { slug: { contains: "tut-001", mode: "insensitive" }, isActive: true },
    select: { id: true },
  });

  if (identitySpec) {
    await prisma.playbookItem.create({
      data: {
        playbookId: playbook.id,
        itemType: "SPEC",
        specId: identitySpec.id,
        isEnabled: true,
        sortOrder: 0,
      },
    });

    await prisma.domain.update({
      where: { id: domainId },
      data: { onboardingIdentitySpecId: identitySpec.id },
    });
  }

  // Link subjects to playbook
  for (const [, subjectId] of subjectMap) {
    await prisma.playbookSubject.create({
      data: { playbookId: playbook.id, subjectId },
    });
  }

  console.log(`    Playbook: ${playbook.name}`);
  return playbook.id;
}

// ══════════════════════════════════════════════════════════
// CHANNELS
// ══════════════════════════════════════════════════════════

async function createChannels(cfg: DomainConfig, domainId: string): Promise<void> {
  for (const ch of cfg.channels) {
    await prisma.channelConfig.create({
      data: { ...ch, domainId, config: {} },
    });
  }

  const active = cfg.channels.filter((c) => c.isEnabled).length;
  console.log(`    Channels: ${cfg.channels.length} (${active} enabled)`);
}

// ══════════════════════════════════════════════════════════
// PEOPLE (Teachers + Cohorts + Pupils)
// ══════════════════════════════════════════════════════════

async function createPeople(
  cfg: DomainConfig,
  domainId: string,
  playbookId: string,
): Promise<{ teachers: number; cohorts: number; pupils: number }> {
  const seedPassword = process.env.SEED_ADMIN_PASSWORD || "admin123";
  const hash = await bcrypt.hash(seedPassword, 10);

  // Teachers
  const teacherMap = new Map<string, { userId: string; callerId: string }>();

  for (const t of cfg.teachers) {
    const fullName = `${t.firstName} ${t.lastName}`;
    const user = await prisma.user.create({
      data: {
        email: t.email,
        name: fullName,
        displayName: fullName,
        role: t.role,
        passwordHash: hash,
        assignedDomainId: domainId,
        isActive: true,
      },
    });
    const caller = await prisma.caller.create({
      data: {
        externalId: `${TAG}-teacher-${t.email.split("@")[0]}`,
        name: fullName,
        email: t.email,
        role: "TEACHER",
        userId: user.id,
        domainId,
      },
    });
    teacherMap.set(t.email, { userId: user.id, callerId: caller.id });
  }

  // Cohorts + pupils
  let pupilIndex = 0;
  let totalPupils = 0;

  for (const c of cfg.cohorts) {
    const teacher = teacherMap.get(c.teacherEmail)!;
    const cohort = await prisma.cohortGroup.create({
      data: {
        name: c.name,
        description: `${c.name} at ${cfg.name}`,
        domainId,
        ownerId: teacher.callerId,
        maxMembers: 35,
        isActive: true,
      },
    });

    await prisma.cohortPlaybook.create({
      data: {
        cohortGroupId: cohort.id,
        playbookId,
        assignedBy: TAG,
      },
    });

    for (let i = 0; i < c.pupilCount && pupilIndex < cfg.pupils.length; i++) {
      const name = cfg.pupils[pupilIndex++];
      const pupil = await prisma.caller.create({
        data: {
          externalId: `${TAG}-pupil-${name.toLowerCase().replace(/\s+/g, "-").replace(/'/g, "")}`,
          name,
          role: "LEARNER",
          domainId,
        },
      });

      await prisma.callerCohortMembership.create({
        data: {
          callerId: pupil.id,
          cohortGroupId: cohort.id,
          role: "MEMBER",
        },
      });

      await prisma.callerPlaybook.create({
        data: {
          callerId: pupil.id,
          playbookId,
          status: "ACTIVE",
          enrolledBy: TAG,
        },
      });

      totalPupils++;
    }
  }

  return {
    teachers: cfg.teachers.length,
    cohorts: cfg.cohorts.length,
    pupils: totalPupils,
  };
}

// ══════════════════════════════════════════════════════════
// ORCHESTRATE ONE DOMAIN
// ══════════════════════════════════════════════════════════

async function seedDomain(cfg: DomainConfig): Promise<{
  assertions: number;
  teachers: number;
  cohorts: number;
  pupils: number;
}> {
  console.log(`\n── ${cfg.name} ──────────────────────────────────`);

  const institutionId = await ensureInstitution(cfg);
  const domainId = await createDomain(cfg, institutionId);
  const subjectMap = await createSubjects(cfg, domainId);
  const sourceMap = await createSources(cfg, subjectMap);
  const assertions = await createAssertions(cfg, sourceMap);
  const playbookId = await createPlaybook(cfg, domainId, subjectMap);
  await createChannels(cfg, domainId);
  const people = await createPeople(cfg, domainId, playbookId);

  return { assertions, ...people };
}

// ══════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════

export async function main(externalPrisma?: PrismaClient) {
  prisma = externalPrisma || new PrismaClient();
  console.log("\n══════════════════════════════════════════════");
  console.log("  HOLOGRAPHIC DEMO SEED");
  console.log("══════════════════════════════════════════════\n");

  const t0 = Date.now();

  await cleanup();

  let totalAssertions = 0;
  let totalTeachers = 0;
  let totalCohorts = 0;
  let totalPupils = 0;

  for (const cfg of ALL_DOMAINS) {
    const result = await seedDomain(cfg);
    totalAssertions += result.assertions;
    totalTeachers += result.teachers;
    totalCohorts += result.cohorts;
    totalPupils += result.pupils;
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log("\n══════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("══════════════════════════════════════════════");
  console.log(`  Domains:      ${ALL_DOMAINS.length} (${ALL_DOMAINS.map((d) => d.name).join(", ")})`);
  console.log(`  Subjects:     ${ALL_DOMAINS.reduce((n, d) => n + d.subjects.length, 0)}`);
  console.log(`  Sources:      ${ALL_DOMAINS.reduce((n, d) => n + d.sources.length, 0)}`);
  console.log(`  Assertions:   ${totalAssertions}`);
  console.log(`  Playbooks:    ${ALL_DOMAINS.length} (all PUBLISHED)`);
  console.log(`  Channels:     ${ALL_DOMAINS.reduce((n, d) => n + d.channels.length, 0)}`);
  console.log(`  Teachers:     ${totalTeachers}`);
  console.log(`  Cohorts:      ${totalCohorts}`);
  console.log(`  Pupils:       ${totalPupils}`);
  console.log(`  Time:         ${elapsed}s`);
  console.log("══════════════════════════════════════════════");
  console.log(`\n  Open: /x/holographic`);
  console.log(`  Domains will appear in picker: Aldermoor College, Greenfield Academy\n`);
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error("\nSeed failed:", e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
