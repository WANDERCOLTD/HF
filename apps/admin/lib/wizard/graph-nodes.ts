/**
 * Wizard Graph Nodes — static definitions for all wizard fields.
 *
 * 21 user-facing nodes + 4 auto-resolved nodes.
 * These are the DAG vertices; dependsOn arrays are the edges.
 *
 * Pure data — no React, no side effects, no DB calls.
 */

import type { WizardGraphNode } from "./graph-schema";

/**
 * Institution types and audience values that auto-activate the deep
 * pedagogy interview (courseRefEnabled). If a user's typeSlug or
 * audience matches any of these, the wizard offers skills framework,
 * teaching principles, course phases, and edge case sections.
 */
export const PEDAGOGY_TRIGGER_SLUGS = new Set(["higher-ed"]);

// ── Domain dependency shorthand ───────────────────────────
// Institution resolution produces EITHER existingDomainId (found in DB)
// OR the wizard tracks a draftDomainId (new institution). Either satisfies
// the dependency for subject/course lookup.
const DOMAIN_DEP = "existingDomainId|draftDomainId";

// ── User-facing nodes (18) ────────────────────────────────

export const WIZARD_GRAPH_NODES: WizardGraphNode[] = [
  // ── INSTITUTION GROUP ──────────────────────────────────

  {
    key: "institutionName",
    label: "Organisation name",
    group: "institution",
    inputType: "free-text",
    required: true,
    priority: 1,
    dependsOn: [],
    resolvedBy: ["file-upload"],
    promptHint: "Ask for their school or organisation name. Extract it if mentioned casually.",
    mutablePostScaffold: false,
    affinityTags: ["identity", "institution"],
    satisfiedAlso: ["existingInstitutionId"],
  },
  {
    key: "typeSlug",
    label: "Organisation type",
    group: "institution",
    inputType: "options",
    required: false,
    priority: 3,
    dependsOn: [], // No hard dep — can be answered independently or auto-inferred
    resolvedBy: ["institution-lookup", "name-type-inference"],
    optionsKey: "institutionTypes",
    promptHint: "Only ask if not auto-inferred from institution name. Usually resolved automatically.",
    mutablePostScaffold: false,
    affinityTags: ["identity", "institution"],
  },
  {
    key: "websiteUrl",
    label: "Website URL",
    group: "institution",
    inputType: "free-text",
    required: false,
    priority: 4,
    dependsOn: [],
    skipWhen: { type: "truthy", key: "existingDomainId" },
    promptHint: "Optional. Offer to skip. Used for logo/branding extraction.",
    mutablePostScaffold: true,
    affinityTags: ["identity", "institution"],
  },

  // ── COURSE GROUP ───────────────────────────────────────

  {
    key: "subjectDiscipline",
    label: "Subject area",
    group: "course",
    inputType: "free-text",
    required: false,
    priority: 2,
    dependsOn: [DOMAIN_DEP],
    resolvedBy: ["institution-lookup", "file-upload", "subject-lookup"],
    optionsKey: "subjectsCatalog",
    skipWhen: { type: "community" },
    promptHint: "Broad academic discipline (Biology, English, Maths). NOT a specific course.",
    mutablePostScaffold: false,
    affinityTags: ["course", "subject"],
  },
  {
    key: "courseName",
    label: "Course name",
    group: "course",
    inputType: "free-text",
    required: true,
    priority: 1,
    dependsOn: [DOMAIN_DEP],
    resolvedBy: ["course-lookup", "entity-chain"],
    promptHint: "Specific offering within the subject (GCSE Biology, 11+ Comprehension).",
    mutablePostScaffold: false,
    affinityTags: ["course"],
  },
  {
    // #253: mandatory choice between AI-scheduler-led teaching and
    // learner-picks-from-menu. Maps to PlaybookConfig.modulesAuthored
    // (true = learner picks; false = AI scheduler decides each call).
    // Required and EARLY in the graph so downstream nodes (modules, picker
    // wiring, journey-position routing) can branch on it cleanly.
    key: "progressionMode",
    label: "Module progression",
    group: "course",
    inputType: "options",
    required: true,
    priority: 1,
    dependsOn: ["courseName"],
    resolvedBy: ["course-lookup"],
    optionsKey: "progressionModes",
    promptHint:
      "How do learners progress through the course? Two options:\n" +
      "- 'AI-led' (modulesAuthored=false): the scheduler picks what to cover each call. Learner just calls in.\n" +
      "- 'Learner picks' (modulesAuthored=true): learner sees a module menu before each session and picks. REQUIRES a Module Catalogue table in the Course Reference markdown — surface a friendly error if 'Learner picks' is chosen but courseRefDigest is missing or has no Module Catalogue.\n" +
      "PROPOSE based on evidence: if Course Reference has a Module Catalogue table, propose 'Learner picks'. If the user described the course as 'adaptive' or 'AI decides each call', propose 'AI-led'. State your reasoning. Save as 'ai-led' or 'learner-picks' (string), then mirror to PlaybookConfig.modulesAuthored when persisting.",
    mutablePostScaffold: true,
    affinityTags: ["course", "progression"],
  },
  {
    key: "interactionPattern",
    label: "Teaching approach",
    group: "course",
    inputType: "options",
    required: true,
    priority: 1,
    dependsOn: [],
    resolvedBy: ["course-lookup", "entity-chain"],
    optionsKey: "interactionPatterns",
    promptHint: "PROPOSE based on EVIDENCE: read uploaded content (courseRefDigest) and user description. If content shows question-based scaffolding, propose socratic. If step-by-step instruction, propose directive. State rationale grounded in what you've seen. Never assume exam prep = directive.",
    mutablePostScaffold: false,
    affinityTags: ["course", "pedagogy"],
  },
  {
    key: "teachingMode",
    label: "Teaching emphasis",
    group: "course",
    inputType: "options",
    required: false,
    priority: 3,
    dependsOn: [],
    optionsKey: "teachingModes",
    skipWhen: { type: "community" },
    promptHint: "Recall, Comprehension, Practice, or Syllabus.",
    mutablePostScaffold: true,
    affinityTags: ["course", "pedagogy"],
  },
  {
    key: "audience",
    label: "Audience",
    group: "course",
    inputType: "options",
    required: false,
    priority: 3,
    dependsOn: [],
    optionsKey: "audiences",
    promptHint: "PROPOSE based on what the user has said about their students. If they said 'primary' or '11+', use that. If institution type implies an age range, infer from that. State your reasoning.",
    mutablePostScaffold: true,
    affinityTags: ["audience", "course"],
  },
  {
    key: "learningOutcomes",
    label: "Learning outcomes",
    group: "course",
    inputType: "free-text",
    required: true,
    priority: 2, // Lowered from 1 — let upload happen first so outcomes can be extracted from content
    dependsOn: [],
    resolvedBy: ["file-upload"],
    promptHint: "REQUIRED. If content has been uploaded (courseRefDigest exists), extract 3-6 learning outcomes from it and call update_setup immediately — do NOT ask the user. If no content uploaded, ask: 'What should students be able to do by the end?' Save as array of strings.",
    mutablePostScaffold: true,
    affinityTags: ["course", "goals"],
  },

  // ── PEDAGOGY GROUP (optional, activated by courseRefEnabled/courseRefDigest) ──

  {
    key: "skillsFramework",
    label: "Skills framework",
    group: "pedagogy",
    inputType: "free-text",
    required: false,
    priority: 2,
    dependsOn: ["courseName"],
    skipWhen: { type: "all-falsy", keys: ["courseRefEnabled", "courseRefDigest"] },
    promptHint: "Ask: 'What core skills are you developing?' For each skill: name, description, then proficiency tiers (emerging / developing / secure). Minimum 3 skills with all 3 tiers. Also ask: 'How do you know when a student is progressing?' (for learner model dimensions).",
    mutablePostScaffold: true,
    affinityTags: ["pedagogy", "reference", "skills"],
  },
  {
    key: "teachingPrinciples",
    label: "Teaching principles",
    group: "pedagogy",
    inputType: "free-text",
    required: false,
    priority: 2,
    dependsOn: ["interactionPattern"],
    skipWhen: { type: "all-falsy", keys: ["courseRefEnabled", "courseRefDigest"] },
    promptHint: "Deepen the teaching approach: 'You chose Socratic — what are your core teaching rules?' Get minimum 2 principles. Then: 'Walk me through a typical session — what happens first, middle, end?' If content was uploaded, ask about content strategy: 'When should the tutor use each type of material?'",
    mutablePostScaffold: true,
    affinityTags: ["pedagogy", "reference", "teaching"],
  },
  {
    key: "coursePhases",
    label: "Course phases",
    group: "pedagogy",
    inputType: "free-text",
    required: false,
    priority: 3,
    dependsOn: [],
    skipWhen: { type: "all-falsy", keys: ["courseRefEnabled", "courseRefDigest"] },
    promptHint: "How does the course evolve as the learner progresses? Any distinct phases? For each: name, goal, tutor behaviour. Ask about checkpoints: 'What are the milestones? How do you know a student can move on?'",
    mutablePostScaffold: true,
    affinityTags: ["pedagogy", "reference", "structure"],
  },
  {
    key: "edgeCases",
    label: "Edge cases",
    group: "pedagogy",
    inputType: "free-text",
    required: false,
    priority: 3,
    dependsOn: ["teachingPrinciples"],
    skipWhen: { type: "all-falsy", keys: ["courseRefEnabled", "courseRefDigest"] },
    promptHint: "Ask: 'What situations might go wrong? Student distressed, off-topic, uncommunicative?' For each scenario: what should the tutor DO? Minimum 2 scenarios with concrete responses. For HE: also ask 'When should the tutor escalate to you? What do you want in a post-session report?'",
    mutablePostScaffold: true,
    affinityTags: ["pedagogy", "reference", "safety"],
  },
  {
    key: "assessmentBoundaries",
    label: "Assessment boundaries",
    group: "pedagogy",
    inputType: "free-text",
    required: false,
    priority: 3,
    dependsOn: ["teachingPrinciples"],
    skipWhen: { type: "all-falsy", keys: ["courseRefEnabled", "courseRefDigest"] },
    promptHint: "Ask: 'What is this course NOT? What should the tutor refuse to do?' Capture scope constraints — things the AI must never offer to teach or assess.",
    mutablePostScaffold: true,
    affinityTags: ["pedagogy", "reference", "safety"],
  },

  // ── WELCOME GROUP ──────────────────────────────────────

  {
    key: "welcomeMessage",
    label: "Welcome message",
    group: "welcome",
    inputType: "free-text",
    required: false,
    priority: 3,
    dependsOn: [],
    resolvedBy: ["auto-default"],
    skipWhen: { type: "truthy", key: "welcomeSkipped" },
    promptHint: "What the student hears on their first call. Offer a default. Use suggest_welcome_message to generate one.",
    mutablePostScaffold: true,
    affinityTags: ["welcome", "experience"],
  },
  {
    key: "sessionCount",
    label: "Session budget",
    group: "welcome",
    inputType: "options",
    required: false,
    priority: 3,
    dependsOn: [],
    resolvedBy: ["file-upload"],
    optionsKey: "sessionCounts",
    skipWhen: { type: "community" },
    promptHint: "Optional cap on number of sessions (e.g. for pricing packages). Leave blank for open-ended.",
    mutablePostScaffold: true,
    affinityTags: ["timing", "commercial"],
  },
  {
    key: "durationMins",
    label: "Session duration",
    group: "welcome",
    inputType: "options",
    required: false,
    priority: 3,
    dependsOn: [],
    optionsKey: "durations",
    promptHint: "Only propose if user or course reference specifies. Ask if unspecified.",
    mutablePostScaffold: true,
    affinityTags: ["timing"],
  },
  {
    key: "planEmphasis",
    label: "Breadth vs depth",
    group: "welcome",
    inputType: "options",
    required: false,
    priority: 4,
    dependsOn: [],
    optionsKey: "planEmphases",
    skipWhen: { type: "community" },
    promptHint: "Breadth, Balanced, or Depth.",
    mutablePostScaffold: true,
    affinityTags: ["structure", "pedagogy"],
  },
  {
    key: "assessments",
    label: "Assessment style",
    group: "welcome",
    inputType: "options",
    required: false,
    priority: 4,
    dependsOn: [],
    optionsKey: "assessmentStyles",
    skipWhen: { type: "community" },
    promptHint: "Formal (structured quizzes), Light (gentle check-ins), or None (conversational only). PROPOSE based on context.",
    mutablePostScaffold: true,
    affinityTags: ["assessment", "pedagogy"],
  },

  // ── EXPERIENCE GROUP ───────────────────────────────────
  // Student welcome flow + NPS configuration.
  // Auto-defaulted — wizard presents suggested config and asks if educator wants to adjust.

  {
    key: "welcomeGoals",
    label: "Goals step in welcome",
    group: "experience",
    inputType: "options",
    required: false,
    priority: 4,
    dependsOn: [],
    resolvedBy: ["auto-default"],
    promptHint: "Whether students set learning goals before their first session. Default: on. Part of the student welcome flow.",
    mutablePostScaffold: true,
    affinityTags: ["experience", "welcome"],
  },
  {
    key: "welcomeAboutYou",
    label: "About You step in welcome",
    group: "experience",
    inputType: "options",
    required: false,
    priority: 4,
    dependsOn: [],
    resolvedBy: ["auto-default"],
    promptHint: "Whether students answer confidence + motivation questions before their first session. Default: on. Part of the student welcome flow.",
    mutablePostScaffold: true,
    affinityTags: ["experience", "welcome"],
  },
  {
    key: "welcomeKnowledgeCheck",
    label: "Baseline knowledge check in welcome",
    group: "experience",
    inputType: "options",
    required: false,
    priority: 4,
    dependsOn: [],
    resolvedBy: ["auto-default"],
    promptHint: "Whether students take baseline MCQs before their first session AND whether the AI probes prior knowledge with open-ended questions in the first call. Default: off (unless curriculum content has been uploaded). Part of the student welcome flow.",
    mutablePostScaffold: true,
    affinityTags: ["experience", "assessment"],
  },
  {
    key: "welcomeAiIntro",
    label: "AI introduction call in welcome",
    group: "experience",
    inputType: "options",
    required: false,
    priority: 4,
    dependsOn: [],
    resolvedBy: ["auto-default"],
    promptHint: "Whether students have a warm-up voice/chat call with the AI before the first teaching session. Default: off. Part of the student welcome flow.",
    mutablePostScaffold: true,
    affinityTags: ["experience", "welcome"],
  },
  {
    key: "npsEnabled",
    label: "Student feedback (NPS)",
    group: "experience",
    inputType: "options",
    required: false,
    priority: 4,
    dependsOn: [],
    resolvedBy: ["auto-default"],
    promptHint: "Whether to ask students for feedback (NPS/satisfaction) after they reach mastery. Default: on.",
    mutablePostScaffold: true,
    affinityTags: ["experience", "feedback"],
  },

  // ── TUNE GROUP ─────────────────────────────────────────

  {
    key: "behaviorTargets",
    label: "Personality",
    group: "tune",
    inputType: "sliders",
    required: false,
    priority: 4,
    dependsOn: [],
    resolvedBy: ["auto-default"],
    promptHint: "Warmth, directiveness, pace, encouragement sliders.",
    mutablePostScaffold: true,
    affinityTags: ["personality"],
  },
  {
    key: "lessonPlanModel",
    label: "Lesson plan model",
    group: "tune",
    inputType: "options",
    required: false,
    priority: 4,
    dependsOn: [],
    optionsKey: "lessonModels",
    skipWhen: { type: "community" },
    promptHint: "Direct, 5E, Spiral, Mastery, or Project-Based. Suggest based on subject.",
    mutablePostScaffold: true,
    affinityTags: ["structure", "pedagogy"],
  },
];

// ── Auto-resolved nodes (4) ──────────────────────────────
// Not asked by the AI — populated by resolvers. Tracked so that
// other nodes can depend on them and the evaluator can check their status.

export const AUTO_NODES: WizardGraphNode[] = [
  {
    key: "existingInstitutionId",
    label: "Institution ID",
    group: "institution",
    inputType: "auto-resolved",
    required: false,
    priority: 1,
    dependsOn: ["institutionName"],
    resolvedBy: ["institution-lookup"],
    promptHint: "",
    mutablePostScaffold: false,
    affinityTags: [],
  },
  {
    key: "existingDomainId",
    label: "Domain ID",
    group: "institution",
    inputType: "auto-resolved",
    required: false,
    priority: 1,
    dependsOn: ["institutionName"],
    resolvedBy: ["institution-lookup"],
    promptHint: "",
    mutablePostScaffold: false,
    affinityTags: [],
  },
  {
    key: "defaultDomainKind",
    label: "Domain kind",
    group: "institution",
    inputType: "auto-resolved",
    required: false,
    priority: 1,
    dependsOn: ["institutionName"],
    resolvedBy: ["institution-lookup"],
    promptHint: "",
    mutablePostScaffold: false,
    affinityTags: [],
  },
  {
    key: "draftPlaybookId",
    label: "Playbook ID",
    group: "course",
    inputType: "auto-resolved",
    required: false,
    priority: 1,
    dependsOn: [DOMAIN_DEP],
    resolvedBy: ["course-lookup", "entity-chain"],
    promptHint: "",
    mutablePostScaffold: false,
    affinityTags: [],
  },
];

/** All nodes — user-facing + auto-resolved */
export const ALL_NODES: WizardGraphNode[] = [...WIZARD_GRAPH_NODES, ...AUTO_NODES];
